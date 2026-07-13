/* ════════════════════════════════════════════
   SUIVI DE VIE — app.js (v2)
   • Authentification Firebase : e-mail / mot de passe + Google
   • Mode local sans compte (données sur l'appareil)
   • Données par utilisateur dans Firestore + cache hors-ligne
   • Synchronisation temps réel entre appareils
════════════════════════════════════════════ */
'use strict';

/* ── CONSTANTES ── */
const APP_VERSION   = '2.0.1';
const STEPS_PER_KM  = 1300;
const DEFAULT_GOALS = { steps: 10000, sport: 150, budget: 500, work: 35 };

function newState() {
  return { days: {}, deleted: {}, planning: {}, birthdays: [], goals: { ...DEFAULT_GOALS }, profile: {} };
}

/* ── ÉTAT GLOBAL ── */
let S            = newState();
let mode         = null;   // 'cloud' | 'local'
let currentUser  = null;   // { uid?, email?, name }
let currentTheme = localStorage.getItem('vieTheme') || 'dark';
let activeView   = 'today';
let statsPeriod  = 'week';
let calY, calM;

/* Firebase */
let fbAuth = null, fbDb = null, unsubData = null;
let pushTimer = null, pushPending = false, lastPushedAt = 0, pendingSignupName = '';
let lastLocalEditAt = 0, lastSyncedEditAt = 0;

/* ── HELPERS ── */
const $   = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const numOr = (v, def) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };

/* ── TOAST ── */
let _tt;
function showToast(msg, dur = 2400) {
  clearTimeout(_tt);
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  _tt = setTimeout(() => t.classList.remove('show'), dur);
}

/* ── DATES / FORMATS ── */
const pad      = n => String(n).padStart(2, '0');
const todayKey = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`; };
const fmtDate  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseT   = s => { if (!s) return 0; const [h, m] = s.split(':').map(Number); return h*60 + m; };
const minToHM  = m => { const h = Math.floor(m/60), mi = Math.round(m%60); return `${h}h${pad(mi)}`; };
const fmtMoney = n => (+n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const dayNames   = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function prettyDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).replace(/^\w/, c => c.toUpperCase());
}

function getDayStatus(dateStr) {
  const day = S.days[dateStr];
  if (!day) return 'empty';
  const hasWork       = day.work && (day.work.start || day.work.end);
  const hasSport      = day.sport && (day.sport.done || day.sport.time > 0);
  const hasWalk       = day.walk && day.walk.km > 0;
  const hasExpenses   = day.expenses && day.expenses.length > 0;
  const hasActivities = day.activities && day.activities.length > 0;
  const hasNotes      = day.notes && day.notes.trim();
  const count = [hasWork, hasSport, hasWalk, hasExpenses, hasActivities, hasNotes].filter(Boolean).length;
  if (count >= 3) return 'complete';
  if (count >= 1) return 'partial';
  return 'empty';
}

/* ════════════════════════════════════════════
   THÈMES
════════════════════════════════════════════ */
function setTheme(theme, save = true) {
  currentTheme = theme;
  document.body.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
  if (save) {
    localStorage.setItem('vieTheme', theme);
    showToast('🎨 Thème appliqué');
  }
}
const THEMES = ['dark', 'light', 'blue', 'green'];
function cycleTheme() {
  const idx = THEMES.indexOf(currentTheme);
  setTheme(THEMES[(idx + 1) % THEMES.length]);
}

/* ════════════════════════════════════════════
   MENU LATÉRAL
════════════════════════════════════════════ */
function toggleMenu() {
  $('sideMenu').classList.toggle('open');
  $('sideMenuBg').classList.toggle('show');
}
function closeMenu() {
  $('sideMenu').classList.remove('open');
  $('sideMenuBg').classList.remove('show');
}

/* ════════════════════════════════════════════
   CONFIGURATION FIREBASE
════════════════════════════════════════════ */
function getFirebaseConfig() {
  const c = window.FIREBASE_CONFIG;
  if (c && c.apiKey && c.projectId) return c;
  try {
    const stored = JSON.parse(localStorage.getItem('vieFirebaseConfig') || 'null');
    if (stored && stored.apiKey && stored.projectId) return stored;
  } catch (e) {}
  // Migration : ancienne config du système de "code de synchronisation"
  try {
    const old = JSON.parse(localStorage.getItem('vieSyncConfig') || 'null');
    if (old && old.config && old.config.apiKey && old.config.projectId) {
      localStorage.setItem('vieFirebaseConfig', JSON.stringify(old.config));
      return old.config;
    }
  } catch (e) {}
  return null;
}

function applyFbConfigText(text, errTargetId) {
  let cfg;
  try { cfg = JSON.parse(text.trim()); }
  catch (e) {
    const el = $(errTargetId);
    if (el) { el.textContent = '❌ JSON invalide — copiez la configuration complète depuis la console Firebase.'; el.style.display = 'block'; }
    else showToast('❌ JSON invalide');
    return;
  }
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    const el = $(errTargetId);
    const msg = '❌ Configuration incomplète (apiKey et projectId requis).';
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    else showToast(msg);
    return;
  }
  localStorage.setItem('vieFirebaseConfig', JSON.stringify(cfg));
  showToast('☁️ Configuration enregistrée — rechargement…');
  setTimeout(() => location.reload(), 700);
}
function saveFbConfig()             { applyFbConfigText($('fbConfigInput').value, 'localError'); }
function saveFbConfigFromSettings() { applyFbConfigText($('fbConfigSettings').value, null); }

/* ════════════════════════════════════════════
   AUTHENTIFICATION
════════════════════════════════════════════ */
const AUTH_ERRORS = {
  'auth/invalid-email':          'Adresse e-mail invalide.',
  'auth/user-disabled':          'Ce compte a été désactivé.',
  'auth/user-not-found':         'Aucun compte trouvé avec cet e-mail.',
  'auth/wrong-password':         'Mot de passe incorrect.',
  'auth/invalid-credential':     'E-mail ou mot de passe incorrect.',
  'auth/invalid-login-credentials': 'E-mail ou mot de passe incorrect.',
  'auth/email-already-in-use':   'Un compte existe déjà avec cet e-mail. Utilisez l\'onglet Connexion.',
  'auth/weak-password':          'Mot de passe trop faible (6 caractères minimum).',
  'auth/too-many-requests':      'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion.',
  'auth/popup-blocked':          'Popup bloquée par le navigateur. Autorisez les popups pour ce site.',
  'auth/operation-not-allowed':  'Méthode de connexion désactivée. Activez-la dans la console Firebase (Authentication → Sign-in method).',
  'auth/unauthorized-domain':    'Domaine non autorisé. Ajoutez-le dans la console Firebase (Authentication → Settings → Authorized domains).',
};
const mapAuthError = e => AUTH_ERRORS[e && e.code] || (e && e.message) || 'Erreur inconnue';

let authTab = 'login';

function setAuthTab(tab) {
  authTab = tab;
  $('tabLogin').classList.toggle('active', tab === 'login');
  $('tabSignup').classList.toggle('active', tab === 'signup');
  $('signupNameWrap').style.display = tab === 'signup' ? '' : 'none';
  $('forgotLink').style.display = tab === 'login' ? '' : 'none';
  $('authSubmit').innerHTML = tab === 'login' ? 'Se connecter <span>→</span>' : 'Créer mon compte <span>→</span>';
  $('authPassword').setAttribute('autocomplete', tab === 'login' ? 'current-password' : 'new-password');
  clearAuthErrors();
}

function showAuthError(id, msg) {
  const el = $(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function clearAuthErrors() {
  ['authError', 'localError'].forEach(id => {
    const el = $(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  });
}

async function submitAuth() {
  clearAuthErrors();
  const email = $('authEmail').value.trim();
  const pw    = $('authPassword').value;
  if (!email)            return showAuthError('authError', 'Entrez votre adresse e-mail.');
  if (!pw || pw.length < 6) return showAuthError('authError', 'Mot de passe : 6 caractères minimum.');

  const btn = $('authSubmit');
  const oldHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = authTab === 'login' ? 'Connexion…' : 'Création du compte…';
  try {
    if (authTab === 'signup') {
      const name = $('authName').value.trim();
      if (!name) { showAuthError('authError', 'Entrez votre prénom.'); return; }
      pendingSignupName = name;
      const cred = await fbAuth.createUserWithEmailAndPassword(email, pw);
      try { await cred.user.updateProfile({ displayName: name }); } catch (e) {}
    } else {
      await fbAuth.signInWithEmailAndPassword(email, pw);
    }
    // onAuthStateChanged prend le relais
  } catch (e) {
    showAuthError('authError', '❌ ' + mapAuthError(e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldHTML;
  }
}

async function googleSignIn() {
  clearAuthErrors();
  try {
    await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
    showAuthError('authError', '❌ ' + mapAuthError(e));
  }
}

async function forgotPassword() {
  clearAuthErrors();
  const email = $('authEmail').value.trim();
  if (!email) return showAuthError('authError', 'Entrez votre e-mail ci-dessus, puis cliquez à nouveau sur « Mot de passe oublié ».');
  try {
    await fbAuth.sendPasswordResetEmail(email);
    showToast('📧 E-mail de réinitialisation envoyé', 3200);
  } catch (e) {
    showAuthError('authError', '❌ ' + mapAuthError(e));
  }
}

function togglePw() {
  const i = $('authPassword');
  i.type = i.type === 'password' ? 'text' : 'password';
}

function showLocalPanel() {
  $('authCloud').style.display = 'none';
  $('authLocal').style.display = '';
  if (fbAuth) {
    $('switchCloudLink').style.display = '';
    $('fbSetupBox').style.display = 'none';
  }
  clearAuthErrors();
}
function showCloudPanel() {
  $('authLocal').style.display = 'none';
  $('authCloud').style.display = '';
  clearAuthErrors();
}

function localLogin() {
  clearAuthErrors();
  const name = $('loginInput').value.trim();
  if (!name) { showAuthError('localError', 'Entrez votre prénom pour commencer.'); $('loginInput').focus(); return; }
  localStorage.setItem('vieUser', name);
  localStorage.setItem('vieMode', 'local');
  enterLocal(name);
}

/* ════════════════════════════════════════════
   DÉMARRAGE / SESSIONS
════════════════════════════════════════════ */
function boot() {
  const cfg = getFirebaseConfig();
  if (cfg && typeof firebase !== 'undefined') {
    try {
      firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
      fbAuth = firebase.auth();
      fbDb   = firebase.firestore();
      // Cache hors-ligne Firestore (best effort)
      try { fbDb.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}
    } catch (e) {
      console.error('Firebase init:', e);
      fbAuth = null; fbDb = null;
    }
  }

  setupAuthScreen();

  if (fbAuth) {
    let first = true;
    fbAuth.onAuthStateChanged(user => {
      const isFirst = first; first = false;
      if (user) { enterCloud(user); return; }
      // Déconnexion externe (autre onglet, jeton révoqué) : nettoyer la session
      if (mode === 'cloud') {
        stopCloudListener();
        mode = null; currentUser = null; S = newState();
        showAuth();
        return;
      }
      // Pas de session cloud : reprendre une éventuelle session locale.
      // (uniquement un vrai mode local choisi, ou une installation v1 qui
      // n'a jamais eu de compte cloud)
      const localName = localStorage.getItem('vieUser');
      const vieMode = localStorage.getItem('vieMode');
      const canResumeLocal = vieMode === 'local' || (!vieMode && !localStorage.getItem('vieHadCloud'));
      if (isFirst && localName && canResumeLocal) { enterLocal(localName); return; }
      if (mode !== 'local') showAuth();
    });
    // Garde-fou : si l'auth ne répond pas (réseau), afficher l'écran de connexion
    setTimeout(() => { if (!currentUser && $('bootScreen').style.display !== 'none') showAuth(); }, 6000);
  } else {
    const saved = localStorage.getItem('vieUser');
    if (saved) enterLocal(saved); else showAuth();
  }
}

function setupAuthScreen() {
  const cloud = !!fbAuth;
  $('authCloud').style.display = cloud ? '' : 'none';
  $('authLocal').style.display = cloud ? 'none' : '';
  $('fbSetupBox').style.display = cloud ? 'none' : '';
  $('switchCloudLink').style.display = cloud ? '' : 'none';
  $('authModeNote').textContent = cloud
    ? '🔒 Vos données sont stockées de façon sécurisée dans votre projet Firebase et synchronisées entre vos appareils.'
    : '💡 Mode local : vos données restent sur cet appareil. Configurez Firebase ci-dessus pour activer le compte cloud.';
}

function showAuth() {
  $('bootScreen').style.display = 'none';
  $('app').style.display = 'none';
  $('authScreen').style.display = 'flex';
}

function enterLocal(name) {
  mode = 'local';
  currentUser = { name };
  S = newState();
  loadLocal('vie_data_' + name);
  openApp();
  setSyncUI('local');
}

function enterCloud(user) {
  if (mode === 'cloud' && currentUser && currentUser.uid === user.uid) return; // déjà connecté
  mode = 'cloud';
  localStorage.setItem('vieMode', 'cloud');
  localStorage.setItem('vieHadCloud', '1');
  currentUser = {
    uid:   user.uid,
    email: user.email || '',
    name:  user.displayName || pendingSignupName || (user.email || '').split('@')[0] || 'Moi',
  };
  pendingSignupName = '';
  S = newState();
  loadLocal(cacheKey()); // cache hors-ligne → affichage instantané
  openApp();
  setSyncUI('syncing');
  startCloudListener();
}

const cacheKey = () => 'vie_cloud_cache_' + (currentUser && currentUser.uid || '');

function openApp() {
  $('bootScreen').style.display = 'none';
  $('authScreen').style.display = 'none';
  $('app').style.display = 'flex';
  // Réinitialiser le formulaire d'auth
  const pw = $('authPassword'); if (pw) pw.value = '';
  refreshIdentityUI();
  setTheme(currentTheme, false);
  const n = new Date();
  calY = n.getFullYear(); calM = n.getMonth();
  $('topbarDate').textContent = n.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  sv('today');
  checkBirthdays();
}

function refreshIdentityUI() {
  if (!currentUser) return;
  $('sidemenuAvatar').textContent = (currentUser.name || '?').charAt(0).toUpperCase();
  $('sidemenuName').textContent   = currentUser.name || '—';
  $('sidemenuRole').textContent   = mode === 'cloud' ? (currentUser.email || 'Compte cloud') : 'Mode local';
}

async function logout() {
  const ok = await confirmDialog({
    title: 'Se déconnecter ?',
    message: mode === 'cloud'
      ? 'Vos données restent sauvegardées dans le cloud.'
      : 'Vos données restent enregistrées sur cet appareil.',
    okLabel: 'Déconnexion', icon: '🚪',
  });
  if (!ok) return;
  closeMenu();
  // Ne pas perdre les modifications encore en file d'attente
  if (mode === 'cloud' && (pushPending || lastLocalEditAt > lastSyncedEditAt)) {
    await pushNow();
  }
  stopCloudListener();
  const wasCloud = mode === 'cloud';
  mode = null; currentUser = null; S = newState();
  if (wasCloud && fbAuth) {
    localStorage.removeItem('vieMode');
    try { await fbAuth.signOut(); } catch (e) { console.error(e); }
  } else {
    localStorage.removeItem('vieUser');
    localStorage.removeItem('vieMode');
  }
  showAuth();
}

function goCreateAccount() {
  closeMenu();
  showAuth();
  showCloudPanel();
  setAuthTab('signup');
}

/* ════════════════════════════════════════════
   PERSISTANCE — LOCAL + CLOUD
════════════════════════════════════════════ */
function loadLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const d = JSON.parse(raw);
    S = {
      ...newState(),
      ...d,
      goals:   { ...DEFAULT_GOALS, ...(d.goals || {}) },
      profile: { ...(d.profile || {}) },
    };
  } catch (e) { console.error('loadLocal:', e); }
}

function persist() {
  if (!currentUser) return;
  lastLocalEditAt = Date.now();
  try {
    const key = mode === 'cloud' ? cacheKey() : 'vie_data_' + currentUser.name;
    localStorage.setItem(key, JSON.stringify(S));
  } catch (e) { console.error('persist:', e); }
  if (mode === 'cloud') schedulePush();
}

const userDocRef = () => fbDb.collection('users').doc(currentUser.uid);

function startCloudListener() {
  stopCloudListener();
  unsubData = userDocRef().onSnapshot(snap => {
    if (snap.metadata.hasPendingWrites) return;       // notre propre écriture
    if (!snap.exists) {
      // Hors-ligne avec cache vide : on ne sait rien, ne surtout pas initialiser
      if (snap.metadata.fromCache) return;
      firstCloudInit();                               // compte réellement vierge
      return;
    }
    const d = snap.data() || {};
    if (d.updatedAt && d.updatedAt === lastPushedAt) { setSyncUI('ok'); return; }
    applyRemote(d);
  }, err => {
    console.error('Sync:', err);
    setSyncUI('error', err.message);
  });
}
function stopCloudListener() {
  if (unsubData) { unsubData(); unsubData = null; }
  clearTimeout(pushTimer);
}

/* Premier passage sur un compte vierge : importer les éventuelles données
   locales de l'appareil, une seule fois, et uniquement si l'état est vide. */
async function firstCloudInit() {
  const legacyName = localStorage.getItem('vieUser');
  const legacyKey  = legacyName ? 'vie_data_' + legacyName : null;
  const legacyRaw  = legacyKey ? localStorage.getItem(legacyKey) : null;
  let imported = false;
  if (legacyRaw && !Object.keys(S.days).length) {
    try {
      const d = JSON.parse(legacyRaw);
      if (d && d.days && Object.keys(d.days).length) {
        S = { ...newState(), ...d, goals: { ...DEFAULT_GOALS, ...(d.goals || {}) }, profile: { ...(d.profile || {}) } };
        imported = true;
        showToast('📦 Données locales importées dans votre compte', 3200);
        renderActiveView();
      }
    } catch (e) {}
  }
  if (!S.profile) S.profile = {};
  if (!S.profile.name) S.profile.name = currentUser.name;
  const ok = await pushNow();
  if (ok && imported) {
    // Migration terminée : ne plus jamais réimporter ces données (ni les
    // injecter dans le compte de quelqu'un d'autre sur le même appareil)
    localStorage.removeItem(legacyKey);
    localStorage.removeItem('vieUser');
  }
}

function schedulePush() {
  if (mode !== 'cloud' || !fbDb) return;
  setSyncUI('syncing');
  pushPending = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1200);
}

async function pushNow() {
  if (mode !== 'cloud' || !fbDb || !currentUser || !currentUser.uid) return false;
  clearTimeout(pushTimer);
  try {
    pruneTombstones();
    const editStamp = lastLocalEditAt;
    const payload = JSON.parse(JSON.stringify({
      days: S.days, deleted: S.deleted || {}, planning: S.planning,
      birthdays: S.birthdays, goals: S.goals, profile: S.profile || {},
      updatedAt: Date.now(), appVersion: APP_VERSION,
    }));
    lastPushedAt = payload.updatedAt;
    await userDocRef().set(payload);
    lastSyncedEditAt = editStamp;
    pushPending = false;
    setSyncUI('ok');
    return true;
  } catch (e) {
    console.error('Push:', e);
    setSyncUI('error', e.message);
    return false;
  }
}

/* Purge des marqueurs de suppression de plus de 90 jours */
function pruneTombstones() {
  const limit = Date.now() - 90 * 864e5;
  const t = S.deleted || {};
  Object.keys(t).forEach(k => { if (t[k] < limit) delete t[k]; });
}

/* Fusion jour par jour quand des modifications locales n'ont pas encore été
   envoyées : le jour le plus récent gagne, les suppressions sont respectées. */
function mergeRemote(remote) {
  const local = S;
  const deleted = { ...(remote.deleted || {}) };
  Object.entries(local.deleted || {}).forEach(([ds, t]) => {
    deleted[ds] = Math.max(t, deleted[ds] || 0);
  });
  const days = {};
  const allDs = new Set([...Object.keys(local.days || {}), ...Object.keys(remote.days || {})]);
  allDs.forEach(ds => {
    const l = (local.days || {})[ds], r = (remote.days || {})[ds];
    const lt = l ? (l.updatedAt || 0) : -1;
    const rt = r ? (r.updatedAt || 0) : -1;
    const best = lt >= rt ? l : r;
    if (best && Math.max(lt, rt) >= (deleted[ds] || 0)) days[ds] = best;
  });
  const localNewer = lastLocalEditAt > (remote.updatedAt || 0);
  return {
    days, deleted,
    planning:  localNewer ? (local.planning || {})  : (remote.planning || {}),
    birthdays: localNewer ? (local.birthdays || []) : (remote.birthdays || []),
    goals:     { ...DEFAULT_GOALS, ...(localNewer ? local.goals : remote.goals || {}) },
    profile:   localNewer ? (local.profile || {})   : (remote.profile || {}),
  };
}

function applyRemote(d) {
  const hasPendingLocal = pushPending || lastLocalEditAt > lastSyncedEditAt;
  if (hasPendingLocal) {
    S = mergeRemote(d);
    schedulePush(); // renvoyer l'état fusionné pour faire converger les appareils
  } else {
    S = {
      days:      d.days      || {},
      deleted:   d.deleted   || {},
      planning:  d.planning  || {},
      birthdays: d.birthdays || [],
      goals:     { ...DEFAULT_GOALS, ...(d.goals || {}) },
      profile:   d.profile   || {},
    };
    setSyncUI('ok');
  }
  if (S.profile.name && currentUser) {
    currentUser.name = S.profile.name;
    refreshIdentityUI();
  }
  try { localStorage.setItem(cacheKey(), JSON.stringify(S)); } catch (e) {}
  // Ne pas écraser une saisie en cours
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && $('view-today').contains(ae);
  if (!typing) renderActiveView();
}

async function forcePush() {
  if (mode !== 'cloud') return;
  const ok = await pushNow();
  showToast(ok ? '⬆️ Données envoyées dans le cloud' : '❌ Échec de l\'envoi — voir le statut ci-dessus');
}
async function forcePull() {
  if (mode !== 'cloud') return;
  try {
    setSyncUI('syncing');
    const snap = await userDocRef().get();
    if (snap.exists) { applyRemote(snap.data()); showToast('⬇️ Données récupérées'); }
    else showToast('Aucune donnée cloud pour ce compte');
    setSyncUI('ok');
  } catch (e) {
    setSyncUI('error', e.message);
    showToast('❌ Erreur cloud');
  }
}

function setSyncUI(state, detail) {
  const map = {
    local:   { dot: '',        txt: '📴 Mode local — données sur cet appareil' },
    off:     { dot: '',        txt: '⚪ Cloud non configuré' },
    syncing: { dot: 'syncing', txt: '🔄 Synchronisation…' },
    ok:      { dot: 'ok',      txt: '🟢 Synchronisé' + (currentUser && currentUser.email ? ' — ' + currentUser.email : '') },
    error:   { dot: 'err',     txt: '🔴 Erreur : ' + (detail || 'voir la console') },
  };
  const s = map[state] || map.off;
  const dot = $('syncDot');      if (dot) dot.className = 'sync-dot ' + s.dot;
  const bar = $('syncStatusBar');if (bar) bar.textContent = s.txt;
  const sm  = $('sidemenuSync'); if (sm) sm.textContent = s.txt;
  const w   = $('syncDotWrap');  if (w) w.title = s.txt;
}

function syncInfo() {
  if (mode === 'cloud') { pushNow(); showToast('🔄 Synchronisation forcée'); }
  else showToast('📴 Mode local — pas de synchronisation cloud');
}

/* ════════════════════════════════════════════
   NAVIGATION ENTRE VUES
════════════════════════════════════════════ */
const VIEW_TITLES = {
  today: 'Aujourd\'hui', calendar: 'Calendrier', history: 'Historique',
  stats: 'Statistiques', planning: 'Planning', birthdays: 'Anniversaires',
  goals: 'Objectifs', more: 'Paramètres',
};

function sv(name) {
  activeView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.bnav,.smitem').forEach(n => n.classList.remove('active'));
  const v = $('view-' + name);
  if (v) v.classList.add('active');
  document.querySelectorAll(`[data-v="${name}"]`).forEach(el => el.classList.add('active'));
  $('topbarTitle').textContent = VIEW_TITLES[name] || name;
  renderActiveView();
}

function renderActiveView() {
  switch (activeView) {
    case 'today':     loadTodayView();   break;
    case 'calendar':  renderCalendar();  break;
    case 'history':   renderHistory();   break;
    case 'stats':     renderStats();     break;
    case 'planning':  renderPlanning();  break;
    case 'birthdays': renderBirthdays(); break;
    case 'goals':     renderGoals();     break;
    case 'more':      renderSettings();  break;
  }
}

/* ════════════════════════════════════════════
   VUE : AUJOURD'HUI
════════════════════════════════════════════ */
/* Date affichée par la vue « Aujourd'hui » — capturée au chargement pour que
   les saisies après minuit restent rattachées au jour affiché */
let todayViewDate = null;
const activeDayKey = () => todayViewDate || todayKey();

function loadTodayView() {
  const dateStr = todayViewDate = todayKey();
  const day = S.days[dateStr] || {};

  // Accueil
  renderGreeting();

  // Sport
  const sport = day.sport || {};
  $('sportDone').checked = !!sport.done;
  $('sportTime').value   = sport.time || '';
  $('sportType').value   = sport.type || '';

  // Marche
  const walk = day.walk || {};
  $('walkKm').value = walk.km || '';
  updateSteps(false);

  // Travail — pré-remplir depuis le planning si vide
  const work = day.work || {};
  const dow  = (new Date(dateStr + 'T00:00:00').getDay() + 6) % 7; // 0 = lundi
  const plan = S.planning[dow] || {};
  $('workStart').value = work.start || (plan.enabled ? plan.start || '' : '');
  $('workEnd').value   = work.end   || (plan.enabled ? plan.end   || '' : '');
  $('workBreak').value = work.pause !== undefined ? work.pause : (plan.enabled && plan.pause !== undefined ? plan.pause : 60);
  calcWork(false);

  // Dépenses / activités / notes
  renderExpenses(day.expenses || []);
  renderActivities(day.activities || []);
  $('notesText').value = day.notes || '';
}

function renderGreeting() {
  if (!currentUser) return;
  const h = new Date().getHours();
  const hello = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  const emoji = h < 5 ? '🌙' : h < 12 ? '👋' : h < 18 ? '☀️' : '🌆';
  $('greetEmoji').textContent = emoji;
  $('greetTitle').textContent = `${hello}, ${currentUser.name} !`;
  const st = getDayStatus(todayKey());
  $('greetSub').textContent = st === 'empty'
    ? 'Rien d\'enregistré pour l\'instant — c\'est parti ! ✍️'
    : st === 'partial'
      ? 'Bon début ! Continuez à remplir votre journée.'
      : 'Belle journée bien remplie ! 💪';
  $('greetStreak').textContent = '🔥 ' + calcStreak();
}

function calcStreak() {
  let streak = 0;
  const d = new Date();
  if (getDayStatus(fmtDate(d)) === 'empty') d.setDate(d.getDate() - 1); // aujourd'hui pas encore rempli : ne casse pas la série
  while (getDayStatus(fmtDate(d)) !== 'empty') {
    streak++;
    d.setDate(d.getDate() - 1);
    if (streak > 3650) break; // garde-fou
  }
  return streak;
}

function saveToday(manual = false) {
  const dateStr  = activeDayKey();
  const existing = S.days[dateStr] || {};

  const sport = {
    done: $('sportDone').checked,
    time: parseFloat($('sportTime').value) || 0,
    type: $('sportType').value.trim(),
  };
  const walkKm = parseFloat($('walkKm').value) || 0;
  const walk   = { km: walkKm, steps: Math.round(walkKm * STEPS_PER_KM) };
  const work   = {
    start: $('workStart').value,
    end:   $('workEnd').value,
    pause: parseFloat($('workBreak').value) || 0,
    total: calcWorkMinutes(),
  };
  const notes = $('notesText').value.trim();

  S.days[dateStr] = {
    ...existing,
    sport, walk, work, notes,
    expenses:   existing.expenses   || [],
    activities: existing.activities || [],
    updatedAt:  Date.now(),
  };
  persist();
  renderGreeting();
  if (manual) { showToast('✅ Journée sauvegardée !'); confetti(); }
}

function updateSteps(save = true) {
  const km = parseFloat($('walkKm').value) || 0;
  const steps = Math.round(km * STEPS_PER_KM);
  $('stepsDisplay').textContent = steps > 0 ? steps.toLocaleString('fr-FR') + ' pas' : '— pas';
  if (save) saveToday();
}

function calcWorkMinutes() {
  const start = $('workStart').value;
  const end   = $('workEnd').value;
  const pause = parseFloat($('workBreak').value) || 0;
  if (!start || !end) return 0;
  return Math.max(0, parseT(end) - parseT(start) - pause);
}

function calcWork(save = true) {
  const total  = calcWorkMinutes();
  const dispEl = $('workTotalDisp');
  const resEl  = $('workResult');
  if (total > 0) {
    dispEl.textContent = minToHM(total);
    resEl.textContent  = `⏱ ${minToHM(total)} de travail effectif`;
    resEl.classList.add('show');
  } else {
    dispEl.textContent = '— h';
    resEl.classList.remove('show');
  }
  if (save) saveToday();
}

/* ── DÉPENSES (aujourd'hui) ── */
function addExpense() {
  const amtEl = $('expenseAmt'), lblEl = $('expenseLabel');
  const amt = parseFloat(amtEl.value);
  if (!amt || isNaN(amt) || amt <= 0) { showToast('⚠️ Entrez un montant valide'); amtEl.focus(); return; }
  const dateStr = activeDayKey();
  const day = S.days[dateStr] = S.days[dateStr] || {};
  (day.expenses = day.expenses || []).push({
    id: uid(),
    amount: amt,
    label: lblEl.value.trim() || 'Dépense',
    time: new Date().toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }),
  });
  day.updatedAt = Date.now();
  amtEl.value = ''; lblEl.value = '';
  persist();
  renderExpenses(day.expenses);
  renderGreeting();
  showToast('💰 +' + fmtMoney(amt) + ' ajouté');
}

function deleteExpense(id) {
  const day = S.days[activeDayKey()];
  if (!day) return;
  day.expenses = (day.expenses || []).filter(e => String(e.id) !== String(id));
  day.updatedAt = Date.now();
  persist();
  renderExpenses(day.expenses);
  renderGreeting();
}

function renderExpenses(list) {
  const el = $('expenseList');
  const total = list.reduce((s, e) => s + (+e.amount || 0), 0);
  $('moneyTotalDisp').textContent = fmtMoney(total);
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(e => `
    <div class="expense-item">
      <span class="expense-item-label">${esc(e.label)}<span class="expense-item-time">${esc(e.time || e.date || '')}</span></span>
      <span class="expense-item-amount">${fmtMoney(e.amount)}</span>
      <button class="expense-delete" onclick="deleteExpense('${esc(e.id)}')" title="Supprimer" aria-label="Supprimer la dépense">✕</button>
    </div>`).join('');
}

/* ── ACTIVITÉS (aujourd'hui) ── */
function addActivity() {
  const input = $('activityInput');
  const txt = input.value.trim();
  if (!txt) return;
  const dateStr = activeDayKey();
  const day = S.days[dateStr] = S.days[dateStr] || {};
  (day.activities = day.activities || []).push({ id: uid(), text: txt });
  day.updatedAt = Date.now();
  input.value = '';
  persist();
  renderActivities(day.activities);
  renderGreeting();
}

function deleteActivity(id) {
  const day = S.days[activeDayKey()];
  if (!day) return;
  day.activities = (day.activities || []).filter(a => String(a.id) !== String(id));
  day.updatedAt = Date.now();
  persist();
  renderActivities(day.activities);
  renderGreeting();
}

function renderActivities(list) {
  const el = $('activityList');
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = list.map(a => `
    <div class="activity-item">
      <span class="activity-item-text">🏷 ${esc(a.text)}</span>
      <button class="expense-delete" onclick="deleteActivity('${esc(a.id)}')" title="Supprimer" aria-label="Supprimer l'activité">✕</button>
    </div>`).join('');
}

/* ════════════════════════════════════════════
   CALENDRIER
════════════════════════════════════════════ */
function renderCalendar() {
  $('calMonthLabel').textContent = `${monthNames[calM]} ${calY}`;
  const grid = $('calGrid');
  const todayStr = todayKey();
  grid.innerHTML = '';
  const firstDay = (new Date(calY, calM, 1).getDay() + 6) % 7;
  const dIM = new Date(calY, calM + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell cal-empty';
    grid.appendChild(el);
  }
  for (let day = 1; day <= dIM; day++) {
    const ds = `${calY}-${pad(calM + 1)}-${pad(day)}`;
    const status = getDayStatus(ds);
    const el = document.createElement('div');
    el.className = 'cal-cell' + (ds === todayStr ? ' today' : '');
    if (status === 'complete') el.classList.add('cal-green');
    else if (status === 'partial') el.classList.add('cal-orange');
    else if (ds < todayStr) el.classList.add('cal-red');
    el.innerHTML = `${day}${status !== 'empty' ? '<div class="cal-dot"></div>' : ''}`;
    el.onclick = () => showDayDetail(ds);
    grid.appendChild(el);
  }
}

function calNav(dir) {
  calM += dir;
  if (calM > 11) { calM = 0; calY++; }
  if (calM < 0)  { calM = 11; calY--; }
  renderCalendar();
}
function calGoToday() {
  const n = new Date();
  calY = n.getFullYear(); calM = n.getMonth();
  renderCalendar();
}

function showDayDetail(ds) {
  const detail = $('dayDetailCard');
  $('dayDetailTitle').textContent = prettyDate(ds);
  $('dayDetailContent').innerHTML = buildDayDetailHTML(ds);
  detail.style.display = '';
  detail.dataset.date = ds;
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideDayDetail() {
  $('dayDetailCard').style.display = 'none';
}

function buildDayDetailHTML(ds) {
  const day = S.days[ds];
  if (!day) return '<p style="color:var(--text3);font-size:13px;padding:8px 0">Aucune donnée pour ce jour. Cliquez sur « Modifier » pour en ajouter.</p>';
  const rows = [];
  if (day.sport && (day.sport.done || day.sport.time)) {
    rows.push(`<div class="detail-row"><span class="detail-icon">🏃</span><span class="detail-label">Sport</span><span class="detail-value">${day.sport.done ? '✅' : '❌'} ${day.sport.time ? day.sport.time + ' min' : ''} ${esc(day.sport.type || '')}</span></div>`);
  }
  if (day.walk && day.walk.km) {
    rows.push(`<div class="detail-row"><span class="detail-icon">🚶</span><span class="detail-label">Marche</span><span class="detail-value">${day.walk.km} km · ${(day.walk.steps || 0).toLocaleString('fr-FR')} pas</span></div>`);
  }
  if (day.work && (day.work.start || day.work.total)) {
    rows.push(`<div class="detail-row"><span class="detail-icon">💼</span><span class="detail-label">Travail</span><span class="detail-value">${esc(day.work.start || '?')} → ${esc(day.work.end || '?')} · <strong>${minToHM(day.work.total || 0)}</strong></span></div>`);
  }
  if (day.expenses && day.expenses.length) {
    const total = day.expenses.reduce((s, e) => s + (+e.amount || 0), 0);
    rows.push(`<div class="detail-row"><span class="detail-icon">💰</span><span class="detail-label">Dépenses</span><span class="detail-value">${fmtMoney(total)} (${day.expenses.length} entrée${day.expenses.length > 1 ? 's' : ''})</span></div>`);
    day.expenses.forEach(e => rows.push(`<div class="detail-row" style="padding-left:38px"><span class="detail-label" style="font-size:11px">${esc(e.label)}</span><span class="detail-value" style="color:var(--money)">${fmtMoney(e.amount)}</span></div>`));
  }
  if (day.activities && day.activities.length) {
    rows.push(`<div class="detail-row"><span class="detail-icon">🏷</span><span class="detail-label">Activités</span><span class="detail-value">${day.activities.map(a => esc(a.text)).join(', ')}</span></div>`);
  }
  if (day.notes) {
    rows.push(`<div class="detail-row"><span class="detail-icon">📝</span><span class="detail-label">Notes</span><span class="detail-value">${esc(day.notes)}</span></div>`);
  }
  return rows.length ? rows.join('') : '<p style="color:var(--text3);font-size:13px;padding:8px 0">Journée enregistrée mais sans détails.</p>';
}

function editDayFromDetail() {
  openEditDayModal($('dayDetailCard').dataset.date);
}
function deleteDayFromDetail() {
  deleteDay($('dayDetailCard').dataset.date);
}

/* Suppression d'une journée complète (détail, historique, modale) */
async function deleteDay(ds) {
  if (!ds || !S.days[ds]) { showToast('Rien à supprimer pour ce jour'); return false; }
  const ok = await confirmDialog({
    title: 'Supprimer cette journée ?',
    message: prettyDate(ds) + '\nToutes les données de ce jour (sport, travail, dépenses, notes…) seront définitivement supprimées.',
    okLabel: 'Supprimer', icon: '🗑',
  });
  if (!ok) return false;
  delete S.days[ds];
  (S.deleted = S.deleted || {})[ds] = Date.now();
  persist();
  const detail = $('dayDetailCard');
  if (detail.dataset.date === ds) detail.style.display = 'none';
  renderActiveView();
  showToast('🗑 Journée supprimée');
  return true;
}

/* ════════════════════════════════════════════
   MODALE DE MODIFICATION D'UN JOUR
   (brouillon : rien n'est enregistré avant « Sauvegarder »)
════════════════════════════════════════════ */
let editingDate = null;
let editDraft   = null;

function openEditDayModal(ds) {
  editingDate = ds;
  const src = S.days[ds] || {};
  editDraft = JSON.parse(JSON.stringify(src));
  editDraft.sport      = editDraft.sport      || {};
  editDraft.walk       = editDraft.walk       || {};
  editDraft.work       = editDraft.work       || {};
  editDraft.expenses   = editDraft.expenses   || [];
  editDraft.activities = editDraft.activities || [];

  $('editModalTitle').textContent = '✏️ ' + prettyDate(ds);
  $('editModalContent').innerHTML = buildEditModalHTML();

  renderEditExpenses();
  renderEditActivities();
  updateEditWorkTotal();

  $('esWalkKm').addEventListener('input', () => {
    const km = parseFloat($('esWalkKm').value) || 0;
    $('esStepsDisp').textContent = km > 0 ? Math.round(km * STEPS_PER_KM).toLocaleString('fr-FR') + ' pas' : '— pas';
  });
  ['esWorkStart', 'esWorkEnd', 'esWorkBreak'].forEach(id => $(id).addEventListener('input', updateEditWorkTotal));
  $('eeLabel').addEventListener('keydown', e => { if (e.key === 'Enter') editAddExpense(); });
  $('eeActivity').addEventListener('keydown', e => { if (e.key === 'Enter') editAddActivity(); });

  $('editModal').classList.remove('hidden');
}

function buildEditModalHTML() {
  const d = editDraft;
  return `
  <div class="edit-sections">
    <div class="esec">
      <div class="esec-title">🏃 Sport</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <label class="toggle-check"><input type="checkbox" id="esSportDone" ${d.sport.done ? 'checked' : ''}><span class="toggle-slider"></span></label>
        <span style="font-size:13px;color:var(--text2)">Fait</span>
      </div>
      <div class="input-row">
        <div class="input-group"><label>Durée (min)</label><input type="number" id="esSportTime" value="${esc(d.sport.time || '')}" min="0" placeholder="30"></div>
        <div class="input-group"><label>Type</label><input type="text" id="esSportType" value="${esc(d.sport.type || '')}" maxlength="60" placeholder="Course…"></div>
      </div>
    </div>

    <div class="esec">
      <div class="esec-title">🚶 Marche</div>
      <div class="input-row">
        <div class="input-group"><label>Distance (km)</label><input type="number" id="esWalkKm" value="${esc(d.walk.km || '')}" min="0" step="0.1" placeholder="2.5"></div>
        <div class="input-group"><label>Pas estimés</label><div class="steps-display" id="esStepsDisp">${d.walk.steps ? d.walk.steps.toLocaleString('fr-FR') + ' pas' : '— pas'}</div></div>
      </div>
    </div>

    <div class="esec">
      <div class="esec-title">💼 Travail</div>
      <div class="input-row triple">
        <div class="input-group"><label>Début</label><input type="time" id="esWorkStart" value="${esc(d.work.start || '')}"></div>
        <div class="input-group"><label>Fin</label><input type="time" id="esWorkEnd" value="${esc(d.work.end || '')}"></div>
        <div class="input-group"><label>Pause (min)</label><input type="number" id="esWorkBreak" value="${esc(d.work.pause !== undefined ? d.work.pause : 60)}" min="0"></div>
      </div>
      <div class="work-total-preview" id="esWorkTotal">—</div>
    </div>

    <div class="esec">
      <div class="esec-title">💰 Dépenses <span class="esec-total" id="eeTotal">0,00 €</span></div>
      <div id="editExpenseList" class="expense-list" style="margin-bottom:10px"></div>
      <div class="expense-add-row" style="margin-bottom:0">
        <input type="number" id="eeAmt" min="0" step="0.01" placeholder="Montant (€)" inputmode="decimal">
        <input type="text" id="eeLabel" placeholder="Description…" maxlength="80">
        <button class="btn btn-primary btn-sm" onclick="editAddExpense()" aria-label="Ajouter la dépense">+</button>
      </div>
    </div>

    <div class="esec">
      <div class="esec-title">🏷 Activités</div>
      <div id="editActivityList" class="activity-list"></div>
      <div class="activity-add-row" style="margin-bottom:0">
        <input type="text" id="eeActivity" placeholder="Voyage, sortie…" maxlength="120">
        <button class="btn btn-primary btn-sm" onclick="editAddActivity()" aria-label="Ajouter l'activité">+</button>
      </div>
    </div>

    <div class="esec">
      <div class="esec-title">📝 Notes</div>
      <textarea id="esNotes" rows="3" placeholder="Notes…">${esc(d.notes || '')}</textarea>
    </div>
  </div>`;
}

function updateEditWorkTotal() {
  const s = $('esWorkStart').value, e = $('esWorkEnd').value;
  const p = parseFloat($('esWorkBreak').value) || 0;
  const total = s && e ? Math.max(0, parseT(e) - parseT(s) - p) : 0;
  $('esWorkTotal').textContent = total > 0 ? `⏱ ${minToHM(total)} de travail effectif` : '—';
}

/* Dépenses dans la modale (sur le brouillon) */
function renderEditExpenses() {
  const list = editDraft.expenses;
  const total = list.reduce((s, e) => s + (+e.amount || 0), 0);
  $('eeTotal').textContent = fmtMoney(total);
  $('editExpenseList').innerHTML = list.length ? list.map(e => `
    <div class="expense-item">
      <span class="expense-item-label">${esc(e.label)}</span>
      <span class="expense-item-amount">${fmtMoney(e.amount)}</span>
      <button class="expense-delete" onclick="editDeleteExpense('${esc(e.id)}')" title="Supprimer" aria-label="Supprimer la dépense">✕</button>
    </div>`).join('') : '<div class="empty-mini">Aucune dépense ce jour-là</div>';
}
function editAddExpense() {
  const amt = parseFloat($('eeAmt').value);
  if (!amt || isNaN(amt) || amt <= 0) { showToast('⚠️ Entrez un montant valide'); return; }
  editDraft.expenses.push({ id: uid(), amount: amt, label: $('eeLabel').value.trim() || 'Dépense' });
  $('eeAmt').value = ''; $('eeLabel').value = '';
  renderEditExpenses();
}
function editDeleteExpense(id) {
  editDraft.expenses = editDraft.expenses.filter(e => String(e.id) !== String(id));
  renderEditExpenses();
}

/* Activités dans la modale (sur le brouillon) */
function renderEditActivities() {
  const list = editDraft.activities;
  $('editActivityList').innerHTML = list.length ? list.map(a => `
    <div class="activity-item">
      <span class="activity-item-text">🏷 ${esc(a.text)}</span>
      <button class="expense-delete" onclick="editDeleteActivity('${esc(a.id)}')" title="Supprimer" aria-label="Supprimer l'activité">✕</button>
    </div>`).join('') : '<div class="empty-mini">Aucune activité ce jour-là</div>';
}
function editAddActivity() {
  const txt = $('eeActivity').value.trim();
  if (!txt) return;
  editDraft.activities.push({ id: uid(), text: txt });
  $('eeActivity').value = '';
  renderEditActivities();
}
function editDeleteActivity(id) {
  editDraft.activities = editDraft.activities.filter(a => String(a.id) !== String(id));
  renderEditActivities();
}

function closeEditModal() {
  editingDate = null;
  editDraft = null;
  $('editModal').classList.add('hidden');
}

function saveEditModal() {
  const ds = editingDate;
  if (!ds || !editDraft) return;
  const walkKm = parseFloat($('esWalkKm').value) || 0;
  const ws = $('esWorkStart').value, we = $('esWorkEnd').value;
  const wb = parseFloat($('esWorkBreak').value) || 0;
  S.days[ds] = {
    ...editDraft,
    sport: {
      done: $('esSportDone').checked,
      time: parseFloat($('esSportTime').value) || 0,
      type: $('esSportType').value.trim(),
    },
    walk: { km: walkKm, steps: Math.round(walkKm * STEPS_PER_KM) },
    work: { start: ws, end: we, pause: wb, total: ws && we ? Math.max(0, parseT(we) - parseT(ws) - wb) : 0 },
    notes: $('esNotes').value.trim(),
    expenses: editDraft.expenses,
    activities: editDraft.activities,
    updatedAt: Date.now(),
  };
  persist();
  closeEditModal();
  renderActiveView();
  const detail = $('dayDetailCard');
  if (detail.style.display !== 'none' && detail.dataset.date === ds) showDayDetail(ds);
  showToast('✅ Journée modifiée');
}

async function deleteEditDay() {
  const ds = editingDate;
  if (!ds) return;
  if (!S.days[ds]) { closeEditModal(); return; } // jour jamais enregistré : rien à supprimer
  const ok = await deleteDay(ds);
  if (ok) closeEditModal();
}

/* ════════════════════════════════════════════
   HISTORIQUE
════════════════════════════════════════════ */
function clearHistFilters() {
  $('histMonthFilter').value = '';
  $('histSearch').value = '';
  renderHistory();
}

function dayMatchesSearch(d, q) {
  const hay = [
    d.notes || '',
    (d.sport && d.sport.type) || '',
    ...(d.activities || []).map(a => a.text || ''),
    ...(d.expenses || []).map(e => e.label || ''),
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderHistory() {
  const el = $('historyList');
  const monthF = $('histMonthFilter').value;
  const q = ($('histSearch').value || '').trim().toLowerCase();
  const entries = Object.entries(S.days)
    .filter(([k, v]) => v && getDayStatus(k) !== 'empty')
    .filter(([k]) => !monthF || k.startsWith(monthF))
    .filter(([, v]) => !q || dayMatchesSearch(v, q))
    .sort(([a], [b]) => b.localeCompare(a));

  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-emoji">📭</span>${q || monthF ? 'Aucune journée ne correspond à ce filtre.' : 'Aucune journée enregistrée pour l\'instant.'}</div>`;
    return;
  }
  el.innerHTML = entries.map(([ds, day]) => {
    const status = getDayStatus(ds);
    const dotColor = status === 'complete' ? 'var(--neon)' : status === 'partial' ? 'var(--gold)' : 'var(--red)';
    const d = new Date(ds + 'T00:00:00');
    const chips = [];
    if (day.sport && (day.sport.done || day.sport.time)) chips.push(`<span class="hist-chip chip-sport">🏃 ${day.sport.time || 0} min</span>`);
    if (day.walk && day.walk.km)       chips.push(`<span class="hist-chip chip-walk">🚶 ${day.walk.km} km</span>`);
    if (day.work && day.work.total)    chips.push(`<span class="hist-chip chip-work">💼 ${minToHM(day.work.total)}</span>`);
    if (day.expenses && day.expenses.length) chips.push(`<span class="hist-chip chip-money">💰 ${fmtMoney(day.expenses.reduce((s, e) => s + (+e.amount || 0), 0))}</span>`);
    if (day.activities && day.activities.length) chips.push(`<span class="hist-chip chip-sport" style="background:rgba(167,139,250,.1);color:var(--note)">🏷 ${day.activities.length}</span>`);
    return `<div class="hist-item" onclick="sv('calendar');showDayDetail('${ds}')">
      <div class="hist-item-header">
        <div class="hist-dot" style="background:${dotColor}"></div>
        <div class="hist-date">${d.toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}</div>
        <div class="hist-actions">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditDayModal('${ds}')" title="Modifier" aria-label="Modifier">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteDay('${ds}')" title="Supprimer" aria-label="Supprimer">🗑</button>
        </div>
      </div>
      <div class="hist-chips">${chips.join('')}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   STATISTIQUES
════════════════════════════════════════════ */
function setStatsPeriod(p, btn) {
  statsPeriod = p;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderStats();
}

function getStatsDays() {
  const now = new Date(), entries = [];
  if (statsPeriod === 'week') {
    const dow = (now.getDay() + 6) % 7;
    for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(now.getDate() - dow + i); entries.push(fmtDate(d)); }
  } else if (statsPeriod === 'month') {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) entries.push(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(i)}`);
  } else {
    for (let m = 0; m < 12; m++) {
      const days = new Date(now.getFullYear(), m + 1, 0).getDate();
      for (let i = 1; i <= days; i++) { const dd = new Date(now.getFullYear(), m, i); if (dd <= now) entries.push(fmtDate(dd)); }
    }
  }
  return entries;
}

function renderStats() {
  const days = getStatsDays();
  let totalSport = 0, totalKm = 0, totalSteps = 0, totalMoney = 0, totalWork = 0, sportDays = 0;
  const sportByDay = [], workByDay = [], moneyByDay = [];

  days.forEach(ds => {
    const day = S.days[ds] || {};
    const s     = (day.sport && day.sport.time) || 0;
    const km    = (day.walk && day.walk.km) || 0;
    const steps = (day.walk && day.walk.steps) || 0;
    const money = (day.expenses || []).reduce((a, e) => a + (+e.amount || 0), 0);
    const work  = (day.work && day.work.total) || 0;
    totalSport += s; totalKm += km; totalSteps += steps; totalMoney += money; totalWork += work;
    if (s > 0 || (day.sport && day.sport.done)) sportDays++;
    sportByDay.push({ date: ds, val: s });
    workByDay.push({ date: ds, val: work / 60 });
    moneyByDay.push({ date: ds, val: money });
  });

  const periodLabel = statsPeriod === 'week' ? 'cette semaine' : statsPeriod === 'month' ? 'ce mois-ci' : 'cette année';

  $('statsGrid').innerHTML = `
    <div class="stat-tile"><div class="stat-tile-icon">🏃</div><div class="stat-tile-label">Sport</div><div class="stat-tile-val sv-sport">${totalSport} min</div><div class="stat-tile-sub">${sportDays} séance${sportDays > 1 ? 's' : ''} ${periodLabel}</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">🚶</div><div class="stat-tile-label">Marche</div><div class="stat-tile-val sv-walk">${totalKm.toFixed(1)} km</div><div class="stat-tile-sub">${totalSteps.toLocaleString('fr-FR')} pas</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">💼</div><div class="stat-tile-label">Travail</div><div class="stat-tile-val sv-work">${minToHM(totalWork)}</div><div class="stat-tile-sub">${periodLabel}</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">💰</div><div class="stat-tile-label">Dépenses</div><div class="stat-tile-val sv-money">${fmtMoney(totalMoney)}</div><div class="stat-tile-sub">${periodLabel}</div></div>
  `;

  const maxSport = Math.max(...sportByDay.map(d => d.val), 1);
  const maxWork  = Math.max(...workByDay.map(d => d.val), 1);
  const maxMoney = Math.max(...moneyByDay.map(d => d.val), 1);
  const show = data => statsPeriod === 'year' ? data.filter((_, i, a) => i % Math.ceil(a.length / 12) === 0) : data;

  $('statsCharts').innerHTML = `
    ${renderMiniChart('Sport (min)', show(sportByDay), maxSport, 'var(--sport)')}
    ${renderMiniChart('Travail (h)', show(workByDay), maxWork, 'var(--work)')}
    ${renderMiniChart('Dépenses (€)', show(moneyByDay), maxMoney, 'var(--money)')}
  `;
}

function renderMiniChart(title, data, maxV, color) {
  const bars = data.map(d => {
    const pct = maxV > 0 ? Math.max((d.val / maxV) * 100, d.val > 0 ? 4 : 0) : 0;
    const lbl = new Date(d.date + 'T00:00:00').toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
    return `<div class="mini-bar-col"><div class="mini-bar" style="height:${pct}%;background:${color};opacity:.85"></div><div class="mini-bar-lbl">${lbl}</div></div>`;
  }).join('');
  return `<div class="chart-card"><div class="chart-title">${title}</div><div class="mini-bar-chart">${bars}</div></div>`;
}

/* ════════════════════════════════════════════
   PLANNING
════════════════════════════════════════════ */
function renderPlanning() {
  const el = $('planningGrid');
  el.innerHTML = dayNames.map((name, i) => {
    const p = S.planning[i] || {};
    return `<div class="plan-day-card">
      <div class="plan-day-name">
        <span>${name}</span>
        <label class="toggle-check plan-day-toggle">
          <input type="checkbox" id="plen_${i}" ${p.enabled ? 'checked' : ''} onchange="togglePlanDay(${i})">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="plan-day-fields" id="planFields_${i}" style="${p.enabled ? '' : 'opacity:.4;pointer-events:none'}">
        <div class="plan-field"><label>Début</label><input type="time" id="plstart_${i}" value="${esc(p.start || '')}"></div>
        <div class="plan-field"><label>Fin</label><input type="time" id="plend_${i}" value="${esc(p.end || '')}"></div>
        <div class="plan-field"><label>Pause (min)</label><input type="number" id="plbreak_${i}" value="${esc(p.pause !== undefined ? p.pause : 60)}" min="0"></div>
      </div>
    </div>`;
  }).join('');
}

function togglePlanDay(i) {
  const enabled = $(`plen_${i}`).checked;
  const fields  = $(`planFields_${i}`);
  fields.style.opacity = enabled ? '1' : '.4';
  fields.style.pointerEvents = enabled ? '' : 'none';
}

function savePlanning() {
  for (let i = 0; i < 7; i++) {
    S.planning[i] = {
      enabled: ($(`plen_${i}`) && $(`plen_${i}`).checked) || false,
      start:   ($(`plstart_${i}`) && $(`plstart_${i}`).value) || '',
      end:     ($(`plend_${i}`) && $(`plend_${i}`).value) || '',
      pause:   numOr($(`plbreak_${i}`) && $(`plbreak_${i}`).value, 60),
    };
  }
  persist();
  showToast('📆 Planning sauvegardé !');
}

/* ════════════════════════════════════════════
   ANNIVERSAIRES
════════════════════════════════════════════ */
function addBirthday() {
  const name = $('bdayName').value.trim();
  const date = $('bdayDate').value;
  if (!name || !date) { showToast('⚠️ Remplissez le nom et la date'); return; }
  S.birthdays.push({ id: uid(), name, date });
  $('bdayName').value = '';
  $('bdayDate').value = '';
  persist();
  renderBirthdays();
  showToast(`🎂 ${name} ajouté !`);
}

async function deleteBirthday(id) {
  const b = S.birthdays.find(x => String(x.id) === String(id));
  const ok = await confirmDialog({
    title: 'Supprimer cet anniversaire ?',
    message: b ? b.name : '',
    okLabel: 'Supprimer', icon: '🗑',
  });
  if (!ok) return;
  S.birthdays = S.birthdays.filter(x => String(x.id) !== String(id));
  persist();
  renderBirthdays();
  showToast('🗑 Anniversaire supprimé');
}

function renderBirthdays() {
  const el = $('bdayList');
  if (!S.birthdays.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-emoji">🎂</span>Aucun anniversaire enregistré.<br>Ajoutez vos proches pour ne plus jamais oublier !</div>';
    return;
  }
  const withNext = S.birthdays.map(b => ({ ...b, ...nextBdayInfo(b.date) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  el.innerHTML = withNext.map(b => {
    const isToday = b.daysLeft === 0;
    const countdown = isToday
      ? `🎉 ${b.turning} an${b.turning > 1 ? 's' : ''} aujourd'hui !`
      : b.daysLeft === 1
        ? `Demain — fêtera ${b.turning} an${b.turning > 1 ? 's' : ''}`
        : `Dans ${b.daysLeft} jours — fêtera ${b.turning} an${b.turning > 1 ? 's' : ''}`;
    return `<div class="bday-item ${isToday ? 'bday-today' : ''}">
      <div class="bday-emoji-big">${isToday ? '🎂🎉' : '🎂'}</div>
      <div class="bday-info">
        <div class="bday-name">${esc(b.name)} ${isToday ? '🥳' : ''}</div>
        <div class="bday-date-text">${b.bdate.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })}</div>
        <div class="bday-countdown">${countdown}</div>
      </div>
      <div class="bday-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteBirthday('${esc(b.id)}')" aria-label="Supprimer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

const identityKey = () => mode === 'cloud' ? (currentUser && currentUser.uid) : (currentUser && currentUser.name);

/* Prochaine occurrence d'un anniversaire (un 29/02 devient le 01/03 les
   années non bissextiles — même règle pour la liste et le popup) */
function nextBdayInfo(dateStr) {
  const t0 = new Date();
  const today = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
  const bdate = new Date(dateStr + 'T00:00:00');
  let next = new Date(today.getFullYear(), bdate.getMonth(), bdate.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, bdate.getMonth(), bdate.getDate());
  const daysLeft = Math.round((next - today) / 864e5);
  return { bdate, daysLeft, turning: next.getFullYear() - bdate.getFullYear() };
}

function checkBirthdays() {
  const todayBdays = S.birthdays.filter(b => b.date && nextBdayInfo(b.date).daysLeft === 0);
  if (!todayBdays.length) return;
  const flagKey = 'bdayShown_' + identityKey();
  if (localStorage.getItem(flagKey) === todayKey()) return;
  localStorage.setItem(flagKey, todayKey());
  showBdayPopup(todayBdays);
}

function showBdayPopup(bdays) {
  $('bdayNames').innerHTML = bdays.map(b => {
    const age = nextBdayInfo(b.date).turning;
    return `<div>🎂 ${esc(b.name)} — ${age} an${age > 1 ? 's' : ''} !</div>`;
  }).join('');
  const popup = $('birthdayPopup');
  popup.style.display = '';
  popup.classList.remove('hidden');
  spawnBdayConfetti();
}

function closeBdayPopup() {
  $('birthdayPopup').classList.add('hidden');
}

function testBdayPopup() {
  localStorage.removeItem('bdayShown_' + identityKey());
  const n = new Date();
  showBdayPopup([{ name: currentUser ? currentUser.name + ' (démo)' : 'Marie (démo)', date: `1990-${pad(n.getMonth() + 1)}-${pad(n.getDate())}` }]);
}

function spawnBdayConfetti() {
  const colors = ['#FBBF24', '#F472B6', '#34D399', '#60A5FA', '#F87171', '#A78BFA'];
  const container = $('popupConfetti');
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.className = 'cfp';
      p.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*40}%;width:${6+Math.random()*7}px;height:${6+Math.random()*7}px;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*.5}s;animation-duration:${1+Math.random()*.8}s;position:absolute`;
      container.appendChild(p);
      setTimeout(() => p.remove(), 2000);
    }, i * 60);
  }
}

/* ════════════════════════════════════════════
   OBJECTIFS
════════════════════════════════════════════ */
function saveGoals() {
  S.goals = {
    steps:  numOr($('goalSteps').value,  DEFAULT_GOALS.steps),
    sport:  numOr($('goalSport').value,  DEFAULT_GOALS.sport),
    budget: numOr($('goalBudget').value, DEFAULT_GOALS.budget),
    work:   numOr($('goalWork').value,   DEFAULT_GOALS.work),
  };
  persist();
  showToast('🎯 Objectifs enregistrés !');
  renderGoals();
}

function renderGoals() {
  $('goalSteps').value  = S.goals.steps;
  $('goalSport').value  = S.goals.sport;
  $('goalBudget').value = S.goals.budget;
  $('goalWork').value   = S.goals.work;

  const now = new Date(), dow = (now.getDay() + 6) % 7;
  let weekSteps = 0, weekSport = 0, weekMoney = 0, weekWork = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() - dow + i);
    const day = S.days[fmtDate(d)] || {};
    weekSteps += (day.walk && day.walk.steps) || 0;
    weekSport += (day.sport && day.sport.time) || 0;
    weekMoney += (day.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
    weekWork  += ((day.work && day.work.total) || 0) / 60;
  }

  const goals = [
    { name: '👟 Pas / jour (moyenne)', val: Math.round(weekSteps / 7), target: S.goals.steps, unit: 'pas', color: 'var(--walk)' },
    { name: '🏃 Sport / semaine', val: weekSport, target: S.goals.sport, unit: 'min', color: 'var(--sport)' },
    { name: '💰 Budget / semaine', val: weekMoney, target: S.goals.budget / 4, unit: '€', color: 'var(--money)', inverse: true },
    { name: '💼 Travail / semaine', val: weekWork, target: S.goals.work, unit: 'h', color: 'var(--work)' },
  ];

  $('goalsProgress').innerHTML = goals.map(g => {
    const rawPct = g.target > 0 ? (g.val / g.target) * 100 : 0;
    const pct = Math.min(100, rawPct);
    const ok = g.inverse ? rawPct <= 100 : rawPct >= 80;
    const displayVal = Number.isInteger(g.val) ? g.val.toLocaleString('fr-FR') : g.val.toFixed(1);
    const displayTarget = Number.isInteger(g.target) ? g.target.toLocaleString('fr-FR') : g.target.toFixed(1);
    return `<div class="goal-progress">
      <div class="goal-header">
        <div class="goal-name">${g.name}</div>
        <div class="goal-pct" style="color:${ok ? 'var(--neon)' : 'var(--gold)'}">${Math.round(pct)}%</div>
      </div>
      <div class="goal-bar-bg"><div class="goal-bar-fill" style="width:${pct}%;background:${g.color}"></div></div>
      <div class="goal-sub">${displayVal} ${g.unit} / ${displayTarget} ${g.unit}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   PARAMÈTRES
════════════════════════════════════════════ */
function renderSettings() {
  document.querySelectorAll('.theme-opt').forEach(el => el.classList.toggle('active', el.dataset.theme === currentTheme));
  $('cloudTools').style.display = mode === 'cloud' ? '' : 'none';

  const box = $('accountBox');
  if (!currentUser) { box.innerHTML = ''; return; }

  if (mode === 'cloud') {
    box.innerHTML = `
      <div class="account-row">
        <div class="sidemenu-avatar" style="margin:0;width:42px;height:42px;font-size:17px">${esc((currentUser.name || '?').charAt(0).toUpperCase())}</div>
        <div style="flex:1;min-width:0">
          <div class="account-name">${esc(currentUser.name)}</div>
          <div class="account-email">${esc(currentUser.email || 'Compte cloud')}</div>
        </div>
      </div>
      <div class="input-group"><label>Prénom affiché</label><input type="text" id="profileNameInput" value="${esc(currentUser.name)}" maxlength="40"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="saveProfileName()">💾 Enregistrer</button>
        <button class="btn btn-ghost btn-sm" onclick="changePassword()">🔑 Changer le mot de passe</button>
        <button class="btn btn-ghost btn-sm" onclick="logout()">🚪 Déconnexion</button>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteAccount()" style="align-self:flex-start">❌ Supprimer mon compte</button>`;
  } else {
    box.innerHTML = `
      <div class="account-name">👤 ${esc(currentUser.name || '')} — mode local</div>
      <p class="view-desc">Vos données sont enregistrées uniquement sur cet appareil.${fbAuth ? ' Créez un compte pour les synchroniser dans le cloud (vos données locales seront importées automatiquement).' : ' Configurez Firebase pour activer le compte cloud et la synchronisation multi-appareils.'}</p>
      ${fbAuth
        ? '<button class="btn btn-primary btn-sm" onclick="goCreateAccount()" style="align-self:flex-start">☁️ Créer un compte / me connecter</button>'
        : `<textarea id="fbConfigSettings" rows="5" spellcheck="false" placeholder='{ "apiKey": "AIza…", "authDomain": "…", "projectId": "…" }'></textarea>
           <button class="btn btn-primary btn-sm" onclick="saveFbConfigFromSettings()" style="align-self:flex-start">☁️ Enregistrer la config Firebase</button>`}
      <button class="btn btn-ghost btn-sm" onclick="logout()" style="align-self:flex-start">🚪 Déconnexion</button>`;
  }
}

async function saveProfileName() {
  const name = $('profileNameInput').value.trim();
  if (!name) { showToast('⚠️ Entrez un prénom'); return; }
  currentUser.name = name;
  S.profile = S.profile || {};
  S.profile.name = name;
  if (fbAuth && fbAuth.currentUser) {
    try { await fbAuth.currentUser.updateProfile({ displayName: name }); } catch (e) {}
  }
  persist();
  refreshIdentityUI();
  renderSettings();
  showToast('✅ Prénom mis à jour');
}

async function changePassword() {
  if (!fbAuth || !currentUser || !currentUser.email) return;
  const ok = await confirmDialog({
    title: 'Changer le mot de passe ?',
    message: 'Un e-mail de réinitialisation sera envoyé à ' + currentUser.email + '.',
    okLabel: 'Envoyer l\'e-mail', icon: '🔑', danger: false,
  });
  if (!ok) return;
  try {
    await fbAuth.sendPasswordResetEmail(currentUser.email);
    showToast('📧 E-mail de réinitialisation envoyé', 3200);
  } catch (e) {
    showToast('❌ ' + mapAuthError(e), 3500);
  }
}

async function deleteAccount() {
  if (mode !== 'cloud' || !fbAuth || !fbAuth.currentUser) return;
  const ok1 = await confirmDialog({
    title: 'Supprimer votre compte ?',
    message: 'Toutes vos données cloud seront définitivement effacées. Cette action est irréversible.',
    okLabel: 'Continuer', icon: '⚠️',
  });
  if (!ok1) return;
  const ok2 = await confirmDialog({
    title: 'Dernière confirmation',
    message: 'Supprimer définitivement le compte ' + (currentUser.email || '') + ' et toutes ses données ?',
    okLabel: 'Tout supprimer', icon: '❌',
  });
  if (!ok2) return;
  try {
    stopCloudListener();
    await userDocRef().delete();
    await fbAuth.currentUser.delete();
    // Succès seulement : on peut nettoyer le cache local
    try { localStorage.removeItem(cacheKey()); } catch (e) {}
    localStorage.removeItem('vieMode');
    showToast('Compte supprimé. Au revoir 👋', 3200);
    // onAuthStateChanged ramène à l'écran de connexion
  } catch (e) {
    // Restaurer immédiatement le document cloud si sa suppression a eu lieu
    // mais pas celle du compte (les données sont toujours en mémoire)
    await pushNow();
    startCloudListener();
    if (e && e.code === 'auth/requires-recent-login') {
      showToast('🔒 Par sécurité, reconnectez-vous puis réessayez la suppression.', 4200);
    } else {
      showToast('❌ ' + (e && e.message || 'Erreur'), 3500);
    }
  }
}

/* ════════════════════════════════════════════
   EXPORT / IMPORT
════════════════════════════════════════════ */
function exportJSON() {
  const data = JSON.stringify({ ...S, user: currentUser && currentUser.name, exportDate: new Date().toISOString(), appVersion: APP_VERSION }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `suivi-vie-${(currentUser && currentUser.name || 'export').replace(/[^\w-]/g, '_')}-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('🗄 Sauvegarde téléchargée');
}

function exportCSV() {
  const csvQuote = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const hdr = 'Date,Sport fait,Sport min,Sport type,Marche km,Pas,Travail début,Travail fin,Pause min,Travail total (h),Dépenses €,Activités,Notes\n';
  const rows = Object.entries(S.days).sort(([a], [b]) => a.localeCompare(b)).map(([ds, d]) => {
    const money = (d.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
    const acts  = (d.activities || []).map(a => a.text).join(' | ');
    return [
      ds,
      d.sport && d.sport.done ? 'Oui' : 'Non',
      (d.sport && d.sport.time) || 0,
      csvQuote((d.sport && d.sport.type) || ''),
      (d.walk && d.walk.km) || 0,
      (d.walk && d.walk.steps) || 0,
      (d.work && d.work.start) || '',
      (d.work && d.work.end) || '',
      (d.work && d.work.pause) || 0,
      (((d.work && d.work.total) || 0) / 60).toFixed(2),
      money.toFixed(2),
      csvQuote(acts),
      csvQuote(d.notes || ''),
    ].join(',');
  }).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + hdr + rows], { type: 'text/csv;charset=utf-8' }));
  a.download = `suivi-vie-${(currentUser && currentUser.name || 'export').replace(/[^\w-]/g, '_')}-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('📊 CSV téléchargé');
}

function importJSON(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const r = new FileReader();
  r.onload = async ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      if (!imp || typeof imp !== 'object') throw new Error('format');
      const ok = await confirmDialog({
        title: 'Importer ce fichier ?',
        message: 'Vos données actuelles seront remplacées par celles du fichier de sauvegarde.',
        okLabel: 'Importer', icon: '📥',
      });
      if (!ok) return;
      if (imp.days)      S.days      = imp.days;
      if (imp.deleted)   S.deleted   = imp.deleted;
      if (imp.planning)  S.planning  = imp.planning;
      if (imp.birthdays) S.birthdays = imp.birthdays;
      if (imp.goals)     S.goals     = { ...DEFAULT_GOALS, ...imp.goals };
      persist();
      renderActiveView();
      showToast('✅ Données importées !');
    } catch (err) {
      showToast('❌ Fichier invalide');
    }
  };
  r.readAsText(f);
}

/* ════════════════════════════════════════════
   RÉINITIALISATION
════════════════════════════════════════════ */
async function resetTodayConfirm() {
  const ok = await confirmDialog({
    title: 'Réinitialiser aujourd\'hui ?',
    message: 'Les données du jour (sport, travail, dépenses, notes…) seront supprimées.',
    okLabel: 'Réinitialiser', icon: '🗑',
  });
  if (!ok) return;
  delete S.days[todayKey()];
  (S.deleted = S.deleted || {})[todayKey()] = Date.now();
  persist();
  renderActiveView();
  showToast('🗑 Journée réinitialisée');
}

async function resetAllConfirm() {
  const ok1 = await confirmDialog({
    title: 'Tout effacer ?',
    message: 'Toutes vos journées, anniversaires, plannings et objectifs seront supprimés' + (mode === 'cloud' ? ' (y compris dans le cloud)' : '') + '.',
    okLabel: 'Continuer', icon: '⚠️',
  });
  if (!ok1) return;
  const ok2 = await confirmDialog({
    title: 'Dernière confirmation',
    message: 'Vraiment tout supprimer ? Cette action est irréversible.',
    okLabel: 'Tout effacer', icon: '💣',
  });
  if (!ok2) return;
  const name = currentUser && currentUser.name;
  const now = Date.now();
  const wiped = {};
  Object.keys(S.days).forEach(ds => { wiped[ds] = now; });
  S = newState();
  S.deleted = wiped; // empêche un autre appareil de « ressusciter » les jours
  if (name) S.profile.name = name;
  persist();
  renderActiveView();
  showToast('💣 Données supprimées');
}

/* ════════════════════════════════════════════
   MODALE DE CONFIRMATION (Promise)
════════════════════════════════════════════ */
let _confirmResolve = null;

function confirmDialog({ title, message = '', okLabel = 'Confirmer', icon = '⚠️', danger = true }) {
  return new Promise(resolve => {
    // Si une confirmation était déjà ouverte, l'annuler proprement
    if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(false); }
    _confirmResolve = resolve;
    $('confirmIcon').textContent = icon;
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    const ok = $('confirmOk');
    ok.textContent = okLabel;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    $('confirmModal').classList.remove('hidden');
    setTimeout(() => ok.focus(), 50);
  });
}

function resolveConfirm(value) {
  $('confirmModal').classList.add('hidden');
  const r = _confirmResolve;
  _confirmResolve = null;
  if (r) r(value);
}

/* ════════════════════════════════════════════
   CONFETTIS
════════════════════════════════════════════ */
function confetti() {
  const colors = ['#6366F1', '#34D399', '#FBBF24', '#60A5FA', '#F87171', '#F472B6'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'cfp';
    p.style.cssText = `left:${Math.random()*100}vw;top:20vh;width:${5+Math.random()*7}px;height:${5+Math.random()*7}px;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*.3}s;animation-duration:${.8+Math.random()*.7}s`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1800);
  }
}

/* ════════════════════════════════════════════
   ÉVÉNEMENTS GLOBAUX
════════════════════════════════════════════ */
// Entrée = valider sur les écrans d'auth
$('loginInput').addEventListener('keydown', e => { if (e.key === 'Enter') localLogin(); });
$('authEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('authPassword').focus(); });
$('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });

// Boutons de la modale de confirmation
$('confirmOk').addEventListener('click', () => resolveConfirm(true));
$('confirmCancel').addEventListener('click', () => resolveConfirm(false));
$('confirmModal').addEventListener('click', e => { if (e.target.id === 'confirmModal') resolveConfirm(false); });

// Fermeture des modales au clic sur le fond
$('editModal').addEventListener('click', e => { if (e.target.id === 'editModal') closeEditModal(); });
$('birthdayPopup').addEventListener('click', e => { if (e.target.id === 'birthdayPopup') closeBdayPopup(); });

// Retour sur l'app (PWA rouverte, onglet réactivé) : gérer le changement de jour
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !currentUser) return;
  if (todayViewDate && todayViewDate !== todayKey()) {
    $('topbarDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
    if (activeView === 'today') loadTodayView();
    else todayViewDate = null; // sera recapturée à la prochaine ouverture de la vue
    checkBirthdays();
  }
});

// Échap : fermer la surcouche la plus haute
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (_confirmResolve) { resolveConfirm(false); return; }
  if (!$('editModal').classList.contains('hidden')) { closeEditModal(); return; }
  if (!$('birthdayPopup').classList.contains('hidden')) { closeBdayPopup(); return; }
  closeMenu();
});

/* ════════════════════════════════════════════
   PWA — SERVICE WORKER
════════════════════════════════════════════ */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('✅ Service worker enregistré'))
      .catch(e => console.warn('SW:', e));
  });
}

/* ════════════════════════════════════════════
   GO !
════════════════════════════════════════════ */
boot();
