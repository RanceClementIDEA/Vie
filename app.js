/* ════════════════════════════════════════════
   SUIVI DE VIE — app.js
   Login simple + localStorage + Firebase sync optionnel
════════════════════════════════════════════ */

/* ── ÉTAT GLOBAL ── */
let currentUser  = localStorage.getItem('vieUser');
let currentTheme = localStorage.getItem('vieTheme') || 'dark';
let statsPeriod  = 'week';
let editingDate  = null; // date en cours d'édition dans la modale
let calY, calM;

// Structure des données
let S = {
  days:       {},   // { "2025-01-15": { sport, walk, work, expenses, activities, notes } }
  planning:   {},   // { 0:lun, 1:mar, ... } horaires type
  birthdays:  [],   // [{ id, name, date }]
  goals:      { steps:10000, sport:150, budget:500, work:35 },
};

/* ── DOM ── */
const loginScreen = document.getElementById('loginScreen');
const loginInput  = document.getElementById('loginInput');
const loginBtn    = document.getElementById('loginBtn');
const toastEl     = document.getElementById('toast');

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
let _tt;
function showToast(msg, dur=2400) {
  clearTimeout(_tt);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  _tt = setTimeout(() => toastEl.classList.remove('show'), dur);
}

/* ════════════════════════════════════════════
   LOGIN / LOGOUT
════════════════════════════════════════════ */
loginBtn.addEventListener('click', () => {
  const u = loginInput.value.trim();
  if (!u) { loginInput.focus(); return; }
  doLogin(u);
});
loginInput.addEventListener('keydown', e => { if (e.key==='Enter') loginBtn.click(); });

function doLogin(user) {
  currentUser = user;
  localStorage.setItem('vieUser', user);
  loginScreen.style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('sidemenuAvatar').textContent = user.charAt(0).toUpperCase();
  document.getElementById('sidemenuName').textContent   = user;
  setTheme(currentTheme, false);
  loadState();
  initApp();
  try { connectSync(false); } catch(e) { console.error('Sync:', e); }
}

function doLogout() {
  localStorage.removeItem('vieUser');
  currentUser = null;
  S = { days:{}, planning:{}, birthdays:[], goals:{ steps:10000, sport:150, budget:500, work:35 } };
  document.getElementById('app').style.display = 'none';
  loginScreen.style.display = 'flex';
  loginInput.value = '';
}

/* ════════════════════════════════════════════
   PERSISTANCE LOCALE
════════════════════════════════════════════ */
const LS_KEY = () => 'vie_data_' + currentUser;

function saveState() {
  localStorage.setItem(LS_KEY(), JSON.stringify(S));
  scheduleAutoSync();
}
function loadState() {
  try {
    const r = localStorage.getItem(LS_KEY());
    if (r) S = { ...S, ...JSON.parse(r) };
  } catch(e) {}
}

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
const pad = (n) => String(n).padStart(2,'0');
const todayKey = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`; };
const fmtDate  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseT   = s => { if(!s)return 0; const[h,m]=s.split(':').map(Number); return h*60+m; };
const minToHM  = m => { const h=Math.floor(m/60),mi=Math.round(m%60); return `${h}h${pad(mi)}`; };
const fmtMoney = n => n.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const dayNames = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function prettyDate(dateStr) {
  const d = new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).replace(/^\w/,c=>c.toUpperCase());
}

function getDayStatus(dateStr) {
  const day = S.days[dateStr];
  if (!day) return 'empty';
  const hasWork   = day.work && (day.work.start || day.work.end);
  const hasSport  = day.sport && (day.sport.done || day.sport.time > 0);
  const hasWalk   = day.walk && day.walk.km > 0;
  const hasExpenses = day.expenses && day.expenses.length > 0;
  const hasActivities = day.activities && day.activities.length > 0;
  const hasNotes  = day.notes && day.notes.trim();
  const count = [hasWork,hasSport,hasWalk,hasExpenses,hasActivities,hasNotes].filter(Boolean).length;
  if (count >= 3) return 'complete';
  if (count >= 1) return 'partial';
  return 'empty';
}

/* ════════════════════════════════════════════
   THÈMES
════════════════════════════════════════════ */
function setTheme(theme, save=true) {
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
const THEMES = ['dark','light','blue','green'];
function cycleTheme() {
  const idx = THEMES.indexOf(currentTheme);
  setTheme(THEMES[(idx+1)%THEMES.length]);
}

/* ════════════════════════════════════════════
   SIDEBAR / MENU
════════════════════════════════════════════ */
function toggleMenu() {
  document.getElementById('sideMenu').classList.toggle('open');
  document.getElementById('sideMenuBg').classList.toggle('show');
}

/* ════════════════════════════════════════════
   VIEW SWITCHING
════════════════════════════════════════════ */
const VIEW_TITLES = {
  today:'Aujourd\'hui', calendar:'Calendrier', history:'Historique',
  stats:'Statistiques', planning:'Planning', birthdays:'Anniversaires',
  goals:'Objectifs', more:'Paramètres',
};
function sv(name, clickedEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.bnav,.smitem').forEach(n => n.classList.remove('active'));
  const v = document.getElementById('view-'+name);
  if (v) v.classList.add('active');
  document.querySelectorAll(`[data-v="${name}"]`).forEach(el => el.classList.add('active'));
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[name] || name;
  // Lazy render
  if (name==='calendar')  renderCalendar();
  if (name==='history')   renderHistory();
  if (name==='stats')     renderStats();
  if (name==='planning')  renderPlanning();
  if (name==='birthdays') renderBirthdays();
  if (name==='goals')     renderGoals();
  if (name==='today')     loadTodayView();
}

/* ════════════════════════════════════════════
   TODAY VIEW
════════════════════════════════════════════ */
function loadTodayView(dateStr) {
  dateStr = dateStr || todayKey();
  const day = S.days[dateStr] || {};

  // Sport
  const sport = day.sport || {};
  document.getElementById('sportDone').checked = !!sport.done;
  document.getElementById('sportTime').value   = sport.time || '';
  document.getElementById('sportType').value   = sport.type || '';

  // Marche
  const walk = day.walk || {};
  document.getElementById('walkKm').value = walk.km || '';
  updateSteps();

  // Travail — pré-remplir depuis planning si vide
  const work = day.work || {};
  const dow = (new Date(dateStr+'T00:00:00').getDay() + 6) % 7; // 0=lun
  const plan = S.planning[dow] || {};
  document.getElementById('workStart').value = work.start || (plan.enabled ? plan.start||'' : '');
  document.getElementById('workEnd').value   = work.end   || (plan.enabled ? plan.end||''   : '');
  document.getElementById('workBreak').value = work.pause !== undefined ? work.pause : (plan.pause !== undefined ? plan.pause : 60);
  calcWork();

  // Dépenses
  renderExpenses(day.expenses || []);

  // Activités
  renderActivities(day.activities || []);

  // Notes
  document.getElementById('notesText').value = day.notes || '';

  // Mettre à jour topbar date
  document.getElementById('topbarDate').textContent = new Date(dateStr+'T00:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
}

function saveToday(manual=false) {
  const dateStr = editingDate || todayKey();
  const existing = S.days[dateStr] || {};

  const expenses = existing.expenses || [];
  const activities = existing.activities || [];

  const sport = {
    done: document.getElementById('sportDone').checked,
    time: parseFloat(document.getElementById('sportTime').value)||0,
    type: document.getElementById('sportType').value.trim(),
  };
  const walkKm = parseFloat(document.getElementById('walkKm').value)||0;
  const walk = { km: walkKm, steps: Math.round(walkKm * 1300) };
  const work = {
    start: document.getElementById('workStart').value,
    end:   document.getElementById('workEnd').value,
    pause: parseFloat(document.getElementById('workBreak').value)||0,
    total: calcWorkMinutes(),
  };
  const notes = document.getElementById('notesText').value.trim();

  S.days[dateStr] = { ...existing, sport, walk, work, notes, expenses, activities, updatedAt: Date.now() };
  saveState();
  if (manual) { showToast('✅ Journée sauvegardée !'); confetti(); }
}

function updateSteps() {
  const km = parseFloat(document.getElementById('walkKm').value)||0;
  const steps = Math.round(km * 1300);
  document.getElementById('stepsDisplay').textContent = steps > 0 ? steps.toLocaleString('fr-FR') + ' pas' : '— pas';
  saveToday();
}

function calcWorkMinutes() {
  const start = document.getElementById('workStart').value;
  const end   = document.getElementById('workEnd').value;
  const pause = parseFloat(document.getElementById('workBreak').value)||0;
  if (!start || !end) return 0;
  const total = parseT(end) - parseT(start) - pause;
  return Math.max(0, total);
}

function calcWork() {
  const total = calcWorkMinutes();
  const dispEl = document.getElementById('workTotalDisp');
  const resEl  = document.getElementById('workResult');
  if (total > 0) {
    dispEl.textContent = minToHM(total);
    resEl.textContent  = `⏱ ${minToHM(total)} de travail effectif`;
    resEl.classList.add('show');
  } else {
    dispEl.textContent = '— h';
    resEl.classList.remove('show');
  }
  saveToday();
}

/* ── DÉPENSES ── */
function addExpense() {
  const amt   = parseFloat(document.getElementById('expenseAmt').value);
  const label = document.getElementById('expenseLabel').value.trim();
  if (!amt || isNaN(amt)) { showToast('⚠️ Entrez un montant'); return; }
  const dateStr = editingDate || todayKey();
  if (!S.days[dateStr]) S.days[dateStr] = {};
  if (!S.days[dateStr].expenses) S.days[dateStr].expenses = [];
  S.days[dateStr].expenses.push({ id: Date.now(), amount: amt, label: label || 'Dépense', date: new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) });
  document.getElementById('expenseAmt').value   = '';
  document.getElementById('expenseLabel').value = '';
  saveState();
  renderExpenses(S.days[dateStr].expenses);
  showToast(`💰 +${fmtMoney(amt)} ajouté`);
}

function deleteExpense(id) {
  const dateStr = editingDate || todayKey();
  if (!S.days[dateStr]) return;
  S.days[dateStr].expenses = (S.days[dateStr].expenses||[]).filter(e => e.id !== id);
  saveState();
  renderExpenses(S.days[dateStr].expenses);
}

function renderExpenses(list) {
  const el = document.getElementById('expenseList');
  const total = list.reduce((s,e) => s+e.amount, 0);
  document.getElementById('moneyTotalDisp').textContent = fmtMoney(total);
  if (!list.length) { el.innerHTML=''; return; }
  el.innerHTML = list.map(e => `
    <div class="expense-item">
      <span class="expense-item-label">${e.label}<span style="font-size:10px;color:var(--text3);margin-left:6px">${e.date||''}</span></span>
      <span class="expense-item-amount">${fmtMoney(e.amount)}</span>
      <button class="expense-delete" onclick="deleteExpense(${e.id})" title="Supprimer">✕</button>
    </div>`).join('');
}

/* ── ACTIVITÉS ── */
function addActivity() {
  const txt = document.getElementById('activityInput').value.trim();
  if (!txt) return;
  const dateStr = editingDate || todayKey();
  if (!S.days[dateStr]) S.days[dateStr] = {};
  if (!S.days[dateStr].activities) S.days[dateStr].activities = [];
  S.days[dateStr].activities.push({ id: Date.now(), text: txt });
  document.getElementById('activityInput').value = '';
  saveState();
  renderActivities(S.days[dateStr].activities);
}

function deleteActivity(id) {
  const dateStr = editingDate || todayKey();
  if (!S.days[dateStr]) return;
  S.days[dateStr].activities = (S.days[dateStr].activities||[]).filter(a => a.id !== id);
  saveState();
  renderActivities(S.days[dateStr].activities);
}

function renderActivities(list) {
  const el = document.getElementById('activityList');
  if (!list.length) { el.innerHTML=''; return; }
  el.innerHTML = list.map(a => `
    <div class="activity-item">
      <span class="activity-item-text">🏷 ${a.text}</span>
      <button class="expense-delete" onclick="deleteActivity(${a.id})">✕</button>
    </div>`).join('');
}

/* ════════════════════════════════════════════
   CALENDAR
════════════════════════════════════════════ */
function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = `${monthNames[calM]} ${calY}`;
  const grid = document.getElementById('calGrid');
  const todayStr = todayKey();
  grid.innerHTML = '';
  const firstDay = (new Date(calY,calM,1).getDay() + 6) % 7;
  const dIM = new Date(calY,calM+1,0).getDate();
  for (let i=0; i<firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell cal-empty';
    grid.appendChild(el);
  }
  for (let day=1; day<=dIM; day++) {
    const ds = `${calY}-${pad(calM+1)}-${pad(day)}`;
    const status = getDayStatus(ds);
    const el = document.createElement('div');
    el.className = 'cal-cell' + (ds===todayStr?' today':'');
    if (status==='complete') el.classList.add('cal-green');
    else if (status==='partial') el.classList.add('cal-orange');
    else if (ds < todayStr) el.classList.add('cal-red');
    el.innerHTML = `${day}${status!=='empty'?'<div class="cal-dot"></div>':''}`;
    el.onclick = () => showDayDetail(ds);
    grid.appendChild(el);
  }
}
function calNav(dir) {
  calM += dir;
  if (calM>11){calM=0;calY++;}
  if (calM<0){calM=11;calY--;}
  renderCalendar();
}
function calGoToday() {
  const n=new Date(); calY=n.getFullYear(); calM=n.getMonth();
  renderCalendar();
}

function showDayDetail(ds) {
  const detail = document.getElementById('dayDetailCard');
  document.getElementById('dayDetailTitle').textContent = prettyDate(ds);
  document.getElementById('dayDetailContent').innerHTML = buildDayDetailHTML(ds);
  detail.style.display = '';
  detail.dataset.date = ds;
  detail.scrollIntoView({behavior:'smooth'});
}

function buildDayDetailHTML(ds) {
  const day = S.days[ds];
  if (!day) return '<p style="color:var(--text3);font-size:13px;padding:8px 0">Aucune donnée pour ce jour.</p>';
  const rows = [];
  if (day.sport && (day.sport.done || day.sport.time)) {
    rows.push(`<div class="detail-row"><span class="detail-icon">🏃</span><span class="detail-label">Sport</span><span class="detail-value">${day.sport.done?'✅':'❌'} ${day.sport.time?day.sport.time+'min':''} ${day.sport.type||''}</span></div>`);
  }
  if (day.walk && day.walk.km) {
    rows.push(`<div class="detail-row"><span class="detail-icon">🚶</span><span class="detail-label">Marche</span><span class="detail-value">${day.walk.km} km · ${(day.walk.steps||0).toLocaleString('fr-FR')} pas</span></div>`);
  }
  if (day.work && (day.work.start || day.work.total)) {
    rows.push(`<div class="detail-row"><span class="detail-icon">💼</span><span class="detail-label">Travail</span><span class="detail-value">${day.work.start||'?'}→${day.work.end||'?'} · <strong>${minToHM(day.work.total||0)}</strong></span></div>`);
  }
  if (day.expenses && day.expenses.length) {
    const total = day.expenses.reduce((s,e)=>s+e.amount,0);
    rows.push(`<div class="detail-row"><span class="detail-icon">💰</span><span class="detail-label">Dépenses</span><span class="detail-value">${fmtMoney(total)} (${day.expenses.length} entrée${day.expenses.length>1?'s':''})</span></div>`);
    day.expenses.forEach(e => rows.push(`<div class="detail-row" style="padding-left:38px"><span class="detail-label" style="font-size:11px">${e.label}</span><span class="detail-value" style="color:var(--money)">${fmtMoney(e.amount)}</span></div>`));
  }
  if (day.activities && day.activities.length) {
    rows.push(`<div class="detail-row"><span class="detail-icon">🏷</span><span class="detail-label">Activités</span><span class="detail-value">${day.activities.map(a=>a.text).join(', ')}</span></div>`);
  }
  if (day.notes) {
    rows.push(`<div class="detail-row"><span class="detail-icon">📝</span><span class="detail-label">Notes</span><span class="detail-value">${day.notes}</span></div>`);
  }
  return rows.length ? rows.join('') : '<p style="color:var(--text3);font-size:13px;padding:8px 0">Journée enregistrée mais sans détails.</p>';
}

function editDayFromDetail() {
  const ds = document.getElementById('dayDetailCard').dataset.date;
  openEditDayModal(ds);
}

/* ════════════════════════════════════════════
   EDIT DAY MODAL
════════════════════════════════════════════ */
function openEditDayModal(ds) {
  editingDate = ds;
  const day = S.days[ds] || {};
  document.getElementById('editModalTitle').textContent = `✏️ ${prettyDate(ds)}`;

  // Remplir le contenu de la modale avec les mêmes champs que today
  document.getElementById('editModalContent').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <!-- Sport -->
      <div style="background:var(--surface2);border-radius:12px;padding:12px">
        <div style="font-weight:700;font-size:13px;color:var(--text1);margin-bottom:10px">🏃 Sport</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <label class="toggle-check"><input type="checkbox" id="esSportDone" ${day.sport?.done?'checked':''}><span class="toggle-slider"></span></label>
          <span style="font-size:13px;color:var(--text2)">Fait</span>
        </div>
        <div class="input-row">
          <div class="input-group"><label>Durée (min)</label><input type="number" id="esSportTime" value="${day.sport?.time||''}" placeholder="30"></div>
          <div class="input-group"><label>Type</label><input type="text" id="esSportType" value="${day.sport?.type||''}" placeholder="Course…"></div>
        </div>
      </div>
      <!-- Marche -->
      <div style="background:var(--surface2);border-radius:12px;padding:12px">
        <div style="font-weight:700;font-size:13px;color:var(--text1);margin-bottom:10px">🚶 Marche</div>
        <div class="input-row">
          <div class="input-group"><label>Distance (km)</label><input type="number" id="esWalkKm" value="${day.walk?.km||''}" step="0.1" placeholder="2.5"></div>
          <div class="input-group"><label>Pas estimés</label><div class="steps-display" id="esStepsDisp">${day.walk?.steps?day.walk.steps.toLocaleString('fr-FR')+' pas':'— pas'}</div></div>
        </div>
      </div>
      <!-- Travail -->
      <div style="background:var(--surface2);border-radius:12px;padding:12px">
        <div style="font-weight:700;font-size:13px;color:var(--text1);margin-bottom:10px">💼 Travail</div>
        <div class="input-row" style="grid-template-columns:1fr 1fr 1fr">
          <div class="input-group"><label>Début</label><input type="time" id="esWorkStart" value="${day.work?.start||''}"></div>
          <div class="input-group"><label>Fin</label><input type="time" id="esWorkEnd" value="${day.work?.end||''}"></div>
          <div class="input-group"><label>Pause (min)</label><input type="number" id="esWorkBreak" value="${day.work?.pause??60}" min="0"></div>
        </div>
      </div>
      <!-- Notes -->
      <div style="background:var(--surface2);border-radius:12px;padding:12px">
        <div style="font-weight:700;font-size:13px;color:var(--text1);margin-bottom:10px">📝 Notes</div>
        <textarea id="esNotes" rows="3" style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:9px 12px;color:var(--text1);outline:none;font-size:13px" placeholder="Notes…">${day.notes||''}</textarea>
      </div>
    </div>`;

  // Listener pour les pas
  document.getElementById('esWalkKm').addEventListener('input', () => {
    const km = parseFloat(document.getElementById('esWalkKm').value)||0;
    document.getElementById('esStepsDisp').textContent = km>0 ? Math.round(km*1300).toLocaleString('fr-FR')+' pas' : '— pas';
  });

  document.getElementById('editModal').classList.remove('hidden');
}

function closeEditModal() {
  editingDate = null;
  document.getElementById('editModal').classList.add('hidden');
}

function saveEditModal() {
  const ds = editingDate;
  if (!ds) return;
  const existing = S.days[ds] || {};
  const walkKm = parseFloat(document.getElementById('esWalkKm').value)||0;
  const workStart = document.getElementById('esWorkStart').value;
  const workEnd   = document.getElementById('esWorkEnd').value;
  const workBreak = parseFloat(document.getElementById('esWorkBreak').value)||0;
  const workTotal = workStart&&workEnd ? Math.max(0,parseT(workEnd)-parseT(workStart)-workBreak) : 0;
  S.days[ds] = {
    ...existing,
    sport: { done:document.getElementById('esSportDone').checked, time:parseFloat(document.getElementById('esSportTime').value)||0, type:document.getElementById('esSportType').value.trim() },
    walk: { km:walkKm, steps:Math.round(walkKm*1300) },
    work: { start:workStart, end:workEnd, pause:workBreak, total:workTotal },
    notes: document.getElementById('esNotes').value.trim(),
    updatedAt: Date.now(),
  };
  saveState();
  closeEditModal();
  renderCalendar();
  showDayDetail(ds);
  showToast('✅ Journée modifiée');
  if (ds === todayKey()) loadTodayView();
}

/* ════════════════════════════════════════════
   HISTORY
════════════════════════════════════════════ */
function renderHistory() {
  const el = document.getElementById('historyList');
  const f  = document.getElementById('histMonthFilter').value;
  const entries = Object.entries(S.days)
    .filter(([k,v]) => (!f || k.startsWith(f)) && v && Object.keys(v).length>1)
    .sort(([a],[b]) => b.localeCompare(a));
  if (!entries.length) { el.innerHTML=`<div style="text-align:center;padding:40px;color:var(--text3)">Aucune journée enregistrée</div>`; return; }
  el.innerHTML = entries.map(([ds,day]) => {
    const status = getDayStatus(ds);
    const dotColor = status==='complete'?'var(--neon)':status==='partial'?'var(--gold)':'var(--red)';
    const d = new Date(ds+'T00:00:00');
    const chips = [];
    if (day.sport?.done || day.sport?.time) chips.push(`<span class="hist-chip chip-sport">🏃 ${day.sport.time||0}min</span>`);
    if (day.walk?.km)    chips.push(`<span class="hist-chip chip-walk">🚶 ${day.walk.km}km</span>`);
    if (day.work?.total) chips.push(`<span class="hist-chip chip-work">💼 ${minToHM(day.work.total)}</span>`);
    if (day.expenses?.length) chips.push(`<span class="hist-chip chip-money">💰 ${fmtMoney(day.expenses.reduce((s,e)=>s+e.amount,0))}</span>`);
    return `<div class="hist-item" onclick="sv('calendar',null);showDayDetail('${ds}')">
      <div class="hist-item-header">
        <div class="hist-dot" style="background:${dotColor}"></div>
        <div class="hist-date">${d.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'})}</div>
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditDayModal('${ds}')" style="padding:4px 9px;font-size:11px">✏️</button>
      </div>
      <div class="hist-chips">${chips.join('')}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   STATS
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
    const dow = (now.getDay()+6)%7;
    for (let i=0; i<7; i++) { const d=new Date(now); d.setDate(now.getDate()-dow+i); entries.push(fmtDate(d)); }
  } else if (statsPeriod === 'month') {
    const days = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    for (let i=1; i<=days; i++) entries.push(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(i)}`);
  } else {
    for (let m=0; m<12; m++) {
      const d = new Date(now.getFullYear(),m,1);
      const days = new Date(now.getFullYear(),m+1,0).getDate();
      for (let i=1; i<=days; i++) { const dd=new Date(now.getFullYear(),m,i); if(dd<=now) entries.push(fmtDate(dd)); }
    }
  }
  return entries;
}

function renderStats() {
  const days = getStatsDays();
  let totalSport=0, totalKm=0, totalSteps=0, totalMoney=0, totalWork=0, sportDays=0;
  const sportByDay=[], workByDay=[], moneyByDay=[];

  days.forEach(ds => {
    const day = S.days[ds] || {};
    const s = day.sport?.time||0;
    const km = day.walk?.km||0;
    const steps = day.walk?.steps||0;
    const money = (day.expenses||[]).reduce((a,e)=>a+e.amount,0);
    const work = day.work?.total||0;
    totalSport += s; totalKm += km; totalSteps += steps; totalMoney += money; totalWork += work;
    if (s>0) sportDays++;
    sportByDay.push({date:ds,val:s});
    workByDay.push({date:ds,val:work/60});
    moneyByDay.push({date:ds,val:money});
  });

  const g = S.goals;
  const periodLabel = statsPeriod==='week'?'cette semaine':statsPeriod==='month'?'ce mois':'cette année';

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-tile"><div class="stat-tile-icon">🏃</div><div class="stat-tile-label">Sport</div><div class="stat-tile-val sv-sport">${totalSport}min</div><div class="stat-tile-sub">${sportDays} séances ${periodLabel}</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">🚶</div><div class="stat-tile-label">Marche</div><div class="stat-tile-val sv-walk">${totalKm.toFixed(1)}km</div><div class="stat-tile-sub">${totalSteps.toLocaleString('fr-FR')} pas</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">💼</div><div class="stat-tile-label">Travail</div><div class="stat-tile-val sv-work">${minToHM(totalWork)}</div><div class="stat-tile-sub">${periodLabel}</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">💰</div><div class="stat-tile-label">Dépenses</div><div class="stat-tile-val sv-money">${fmtMoney(totalMoney)}</div><div class="stat-tile-sub">${periodLabel}</div></div>
  `;

  // Charts
  const maxSport = Math.max(...sportByDay.map(d=>d.val), 1);
  const maxWork  = Math.max(...workByDay.map(d=>d.val), 1);
  const maxMoney = Math.max(...moneyByDay.map(d=>d.val), 1);
  const show = (data) => statsPeriod==='year' ? data.filter((_,i,a)=>i%Math.ceil(a.length/12)===0) : data;

  document.getElementById('statsCharts').innerHTML = `
    ${renderMiniChart('Sport (min)', show(sportByDay), maxSport, '#34D399')}
    ${renderMiniChart('Travail (h)', show(workByDay), maxWork, '#FBBF24')}
    ${renderMiniChart('Dépenses (€)', show(moneyByDay), maxMoney, '#F472B6')}
  `;
}

function renderMiniChart(title, data, maxV, color) {
  const bars = data.map(d => {
    const pct = maxV>0 ? Math.max((d.val/maxV)*100, d.val>0?4:0) : 0;
    const lbl = new Date(d.date+'T00:00:00').toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'});
    return `<div class="mini-bar-col"><div class="mini-bar" style="height:${pct}%;background:${color};opacity:.85"></div><div class="mini-bar-lbl">${lbl}</div></div>`;
  }).join('');
  return `<div class="chart-card"><div class="chart-title">${title}</div><div class="mini-bar-chart">${bars}</div></div>`;
}

/* ════════════════════════════════════════════
   PLANNING
════════════════════════════════════════════ */
function renderPlanning() {
  const el = document.getElementById('planningGrid');
  el.innerHTML = dayNames.map((name,i) => {
    const p = S.planning[i] || {};
    return `<div class="plan-day-card">
      <div class="plan-day-name">
        <span>${name}</span>
        <label class="toggle-check plan-day-toggle">
          <input type="checkbox" id="plen_${i}" ${p.enabled?'checked':''} onchange="togglePlanDay(${i})">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="plan-day-fields" id="planFields_${i}" style="${p.enabled?'':'opacity:.4;pointer-events:none'}">
        <div class="plan-field"><label>Début</label><input type="time" id="plstart_${i}" value="${p.start||''}"></div>
        <div class="plan-field"><label>Fin</label><input type="time" id="plend_${i}" value="${p.end||''}"></div>
        <div class="plan-field"><label>Pause (min)</label><input type="number" id="plbreak_${i}" value="${p.pause??60}" min="0"></div>
      </div>
    </div>`;
  }).join('');
}

function togglePlanDay(i) {
  const enabled = document.getElementById(`plen_${i}`).checked;
  const fields  = document.getElementById(`planFields_${i}`);
  fields.style.opacity = enabled ? '1' : '.4';
  fields.style.pointerEvents = enabled ? '' : 'none';
}

function savePlanning() {
  for (let i=0; i<7; i++) {
    S.planning[i] = {
      enabled: document.getElementById(`plen_${i}`)?.checked || false,
      start:   document.getElementById(`plstart_${i}`)?.value || '',
      end:     document.getElementById(`plend_${i}`)?.value || '',
      pause:   parseFloat(document.getElementById(`plbreak_${i}`)?.value)||60,
    };
  }
  saveState();
  showToast('📆 Planning sauvegardé !');
}

/* ════════════════════════════════════════════
   ANNIVERSAIRES
════════════════════════════════════════════ */
function addBirthday() {
  const name = document.getElementById('bdayName').value.trim();
  const date = document.getElementById('bdayDate').value;
  if (!name || !date) { showToast('⚠️ Remplissez le nom et la date'); return; }
  S.birthdays.push({ id: Date.now(), name, date });
  document.getElementById('bdayName').value = '';
  document.getElementById('bdayDate').value = '';
  saveState();
  renderBirthdays();
  showToast(`🎂 ${name} ajouté !`);
}

function deleteBirthday(id) {
  S.birthdays = S.birthdays.filter(b => b.id !== id);
  saveState();
  renderBirthdays();
}

function renderBirthdays() {
  const el = document.getElementById('bdayList');
  if (!S.birthdays.length) { el.innerHTML='<div style="text-align:center;padding:30px;color:var(--text3)">Aucun anniversaire enregistré</div>'; return; }
  const today = new Date();
  const todayMD = `${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const sorted = [...S.birthdays].sort((a,b) => {
    const amd = a.date.slice(5), bmd = b.date.slice(5);
    return amd.localeCompare(bmd);
  });
  el.innerHTML = sorted.map(b => {
    const bdate = new Date(b.date);
    const bMD = b.date.slice(5);
    const isToday = bMD === todayMD;
    const age = today.getFullYear() - bdate.getFullYear();
    // Jours restants
    const nextBday = new Date(today.getFullYear(), bdate.getMonth(), bdate.getDate());
    if (nextBday < today) nextBday.setFullYear(today.getFullYear()+1);
    const daysLeft = Math.ceil((nextBday - today) / (1000*60*60*24));
    return `<div class="bday-item ${isToday?'bday-today':''}">
      <div class="bday-emoji-big">${isToday?'🎂🎉':'🎂'}</div>
      <div class="bday-info">
        <div class="bday-name">${b.name} ${isToday?'🥳':''}</div>
        <div class="bday-date-text">${bdate.toLocaleDateString('fr-FR',{day:'numeric',month:'long'})} · ${age} ans</div>
        <div class="bday-countdown">${isToday?'🎉 C\'est aujourd\'hui !':daysLeft===0?'Demain !':'Dans '+daysLeft+' jour'+(daysLeft>1?'s':'')}</div>
      </div>
      <div class="bday-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteBirthday(${b.id})">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function checkBirthdays() {
  const today = new Date();
  const todayMD = `${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const todayBdays = S.birthdays.filter(b => b.date.slice(5) === todayMD);
  if (!todayBdays.length) return;
  const lastShown = localStorage.getItem('bdayShown_' + currentUser);
  if (lastShown === todayKey()) return;
  localStorage.setItem('bdayShown_' + currentUser, todayKey());
  showBdayPopup(todayBdays);
}

function showBdayPopup(bdays) {
  const today = new Date();
  document.getElementById('bdayNames').innerHTML = bdays.map(b => {
    const age = today.getFullYear() - new Date(b.date).getFullYear();
    return `<div>🎂 ${b.name} — ${age} ans !</div>`;
  }).join('');
  const popup = document.getElementById('birthdayPopup');
  popup.classList.remove('hidden');
  spawnBdayConfetti();
}

function closeBdayPopup() {
  const popup = document.getElementById('birthdayPopup');
  if (popup) {
    popup.classList.add('hidden');
    popup.style.display = 'none'; // sécurité anti-bug
  }
}

// Fermer en cliquant sur le fond
const popup = document.getElementById('birthdayPopup');

popup.addEventListener('click', (e) => {
  if (e.target.id === "birthdayPopup") {
    closeBdayPopup();
  }
});

// Fermer avec Echap
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeBdayPopup();
});

// Tester le popup (bouton démonstration)
function testBdayPopup() {
  // Réinitialiser le flag pour permettre le re-test
  localStorage.removeItem('bdayShown_' + currentUser);
  showBdayPopup([{ name: 'Marie (test)', date: '1990-' + pad(new Date().getMonth()+1) + '-' + pad(new Date().getDate()) }]);
}

function spawnBdayConfetti() {
  const colors = ['#FBBF24','#F472B6','#34D399','#60A5FA','#F87171','#A78BFA'];
  const container = document.getElementById('popupConfetti');
  for (let i=0; i<30; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.className = 'cfp';
      p.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*40}%;width:${6+Math.random()*7}px;height:${6+Math.random()*7}px;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*.5}s;animation-duration:${1+Math.random()*.8}s;position:absolute`;
      container.appendChild(p);
      setTimeout(()=>p.remove(),2000);
    }, i*60);
  }
}

/* ════════════════════════════════════════════
   OBJECTIFS
════════════════════════════════════════════ */
function saveGoals() {
  S.goals = {
    steps:  parseFloat(document.getElementById('goalSteps').value)||10000,
    sport:  parseFloat(document.getElementById('goalSport').value)||150,
    budget: parseFloat(document.getElementById('goalBudget').value)||500,
    work:   parseFloat(document.getElementById('goalWork').value)||35,
  };
  saveState();
  showToast('🎯 Objectifs enregistrés !');
  renderGoals();
}

function renderGoals() {
  // Pré-remplir les champs
  document.getElementById('goalSteps').value  = S.goals.steps;
  document.getElementById('goalSport').value  = S.goals.sport;
  document.getElementById('goalBudget').value = S.goals.budget;
  document.getElementById('goalWork').value   = S.goals.work;

  // Calculer les données de la semaine en cours
  const now=new Date(), dow=(now.getDay()+6)%7;
  let weekSteps=0, weekSport=0, weekMoney=0, weekWork=0;
  for (let i=0;i<7;i++) {
    const d=new Date(now); d.setDate(now.getDate()-dow+i);
    const k=fmtDate(d), day=S.days[k]||{};
    weekSteps += day.walk?.steps||0;
    weekSport += day.sport?.time||0;
    weekMoney += (day.expenses||[]).reduce((s,e)=>s+e.amount,0);
    weekWork  += (day.work?.total||0)/60;
  }

  const goals = [
    { name:'👟 Pas/jour (moy.)', val:Math.round(weekSteps/7), target:S.goals.steps, unit:'pas', color:'var(--walk)' },
    { name:'🏃 Sport semaine', val:weekSport, target:S.goals.sport, unit:'min', color:'var(--sport)' },
    { name:'💰 Budget semaine', val:weekMoney, target:S.goals.budget/4, unit:'€', color:'var(--money)', inverse:true },
    { name:'💼 Travail semaine', val:weekWork, target:S.goals.work, unit:'h', color:'var(--work)' },
  ];

  document.getElementById('goalsProgress').innerHTML = goals.map(g => {
    const pct = g.target>0 ? Math.min(100,(g.val/g.target)*100) : 0;
    const ok = g.inverse ? pct<=100 : pct>=80;
    const displayVal = Number.isInteger(g.val) ? g.val.toLocaleString('fr-FR') : g.val.toFixed(1);
    return `<div class="goal-progress">
      <div class="goal-header">
        <div class="goal-name">${g.name}</div>
        <div class="goal-pct" style="color:${ok?'var(--neon)':'var(--gold)'}">${Math.round(pct)}%</div>
      </div>
      <div class="goal-bar-bg"><div class="goal-bar-fill" style="width:${pct}%;background:${g.color}"></div></div>
      <div class="goal-sub">${displayVal} ${g.unit} / ${g.target} ${g.unit}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════
   EXPORT / IMPORT
════════════════════════════════════════════ */
function exportJSON() {
  const data = JSON.stringify({...S, user:currentUser, exportDate:new Date().toISOString()}, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data],{type:'application/json'}));
  a.download = `suivi-vie-${currentUser}-${todayKey()}.json`;
  a.click();
  showToast('🗄 Backup téléchargé');
}

function exportCSV() {
  const hdr = 'Date,Sport fait,Sport min,Sport type,Marche km,Pas,Travail début,Travail fin,Pause min,Travail total,Dépenses €,Notes\n';
  const rows = Object.entries(S.days).sort(([a],[b])=>a.localeCompare(b)).map(([ds,d]) => {
    const money = (d.expenses||[]).reduce((s,e)=>s+e.amount,0);
    return `${ds},${d.sport?.done?'Oui':'Non'},${d.sport?.time||0},"${d.sport?.type||''}",${d.walk?.km||0},${d.walk?.steps||0},${d.work?.start||''},${d.work?.end||''},${d.work?.pause||0},${(d.work?.total||0)/60},"${money.toFixed(2)}","${(d.notes||'').replace(/"/g,"'")}"`;
  }).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff'+hdr+rows],{type:'text/csv'}));
  a.download = `suivi-vie-${currentUser}-${todayKey()}.csv`;
  a.click();
  showToast('📊 CSV téléchargé');
}

function importJSON(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const imp = JSON.parse(ev.target.result);
      if (!confirm('Remplacer toutes vos données actuelles ?')) return;
      if (imp.days)      S.days      = imp.days;
      if (imp.planning)  S.planning  = imp.planning;
      if (imp.birthdays) S.birthdays = imp.birthdays;
      if (imp.goals)     S.goals     = {...S.goals,...imp.goals};
      saveState();
      initApp();
      showToast('✅ Données importées !');
    } catch(err) { showToast('❌ Fichier invalide'); }
  };
  r.readAsText(f);
}

/* ════════════════════════════════════════════
   RESET
════════════════════════════════════════════ */
function resetTodayConfirm() {
  if (!confirm('Supprimer les données d\'aujourd\'hui ?')) return;
  delete S.days[todayKey()];
  saveState();
  loadTodayView();
  showToast('🗑 Journée réinitialisée');
}
function resetAllConfirm() {
  if (!confirm('⚠️ Tout effacer ?')) return;
  if (!confirm('Dernière confirmation — vraiment tout supprimer ?')) return;
  S = { days:{}, planning:{}, birthdays:[], goals:{ steps:10000, sport:150, budget:500, work:35 } };
  saveState();
  initApp();
  showToast('💣 Données supprimées');
}

/* ════════════════════════════════════════════
   CONFETTI
════════════════════════════════════════════ */
function confetti() {
  const colors = ['#6366F1','#34D399','#FBBF24','#60A5FA','#F87171','#F472B6'];
  for (let i=0;i<18;i++) {
    const p = document.createElement('div');
    p.className = 'cfp';
    p.style.cssText = `left:${Math.random()*100}vw;top:20vh;width:${5+Math.random()*7}px;height:${5+Math.random()*7}px;background:${colors[Math.floor(Math.random()*colors.length)]};animation-delay:${Math.random()*.3}s;animation-duration:${.8+Math.random()*.7}s`;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),1800);
  }
}

/* ════════════════════════════════════════════
   SYNC FIREBASE — même système que Annuaire KPI
════════════════════════════════════════════ */
const LS_SYNC = 'vieSyncConfig';
const getSyncConfig = () => { try{return JSON.parse(localStorage.getItem(LS_SYNC));}catch{return null;} };
const setSyncConfig = cfg => cfg ? localStorage.setItem(LS_SYNC,JSON.stringify(cfg)) : localStorage.removeItem(LS_SYNC);

let fbApp=null,fbDb=null,fbUnsub=null,syncDebounce=null,lastPushAt=0,lastAppliedAt=0,connectedCode=null,applyingSync=false;

function setSyncUI(state, detail) {
  const dot = document.getElementById('syncDot');
  const bar = document.getElementById('syncStatusBar');
  const mod = document.getElementById('syncStatusModal');
  const map = {
    off:       {dot:'',      bar:'⚪ Non configuré',                    cls:''},
    connected: {dot:'ok',    bar:'🟢 Synchronisation active',           cls:'connected'},
    syncing:   {dot:'syncing',bar:'🔄 Synchronisation…',               cls:'syncing'},
    error:     {dot:'err',   bar:'🔴 Erreur : '+(detail||'voir console'),cls:'error'},
  };
  const s = map[state]||map.off;
  if (dot) dot.className='sync-dot '+(s.dot||'');
  if (bar) bar.textContent=s.bar;
  if (mod) { mod.textContent=s.bar; mod.className='sync-status-modal '+s.cls; }
}

function syncDocRef(code) { return fbDb.collection('vie_sync').doc(code); }
function buildPayload()    { return { days:S.days, planning:S.planning, birthdays:S.birthdays, goals:S.goals, user:currentUser, updatedAt:Date.now() }; }

function scheduleAutoSync() {
  const cfg=getSyncConfig();
  if(!cfg||!cfg.enabled||!fbDb||applyingSync)return;
  clearTimeout(syncDebounce);
  syncDebounce=setTimeout(()=>pushToCloud(false),1500);
}

async function pushToCloud(manual) {
  const cfg=getSyncConfig();if(!cfg||!fbDb)return;
  setSyncUI('syncing');
  try{
    const p=buildPayload();lastPushAt=p.updatedAt;
    await syncDocRef(cfg.code).set(p);
    setSyncUI('connected');
    if(manual)showToast('☁️ Données envoyées dans le cloud');
  }catch(err){setSyncUI('error',err.message);if(manual)showToast('❌ Erreur de synchronisation');}
}

function applyRemote(payload,fromListen) {
  applyingSync=true;
  if(payload.days)      S.days      =payload.days;
  if(payload.planning)  S.planning  =payload.planning;
  if(payload.birthdays) S.birthdays =payload.birthdays;
  if(payload.goals)     S.goals     ={...S.goals,...payload.goals};
  applyingSync=false;
  localStorage.setItem(LS_KEY(),JSON.stringify(S));
  loadTodayView();
  if(!fromListen)showToast('✅ Données récupérées depuis le cloud');
}

async function pullFromCloud(manual) {
  const cfg=getSyncConfig();if(!cfg||!fbDb)return;
  setSyncUI('syncing');
  try{
    const snap=await syncDocRef(cfg.code).get();
    if(!snap.exists){setSyncUI('connected');if(manual)showToast('Aucune donnée cloud pour ce code');return;}
    applyRemote(snap.data(),false);setSyncUI('connected');
  }catch(err){setSyncUI('error',err.message);if(manual)showToast('❌ Erreur cloud');}
}

function listenRemote(code) {
  if(fbUnsub){fbUnsub();fbUnsub=null;}
  fbUnsub=syncDocRef(code).onSnapshot(snap=>{
    if(!snap.exists)return;
    const p=snap.data();
    if(!p||!p.updatedAt)return;
    if(p.updatedAt===lastPushAt||p.updatedAt===lastAppliedAt)return;
    lastAppliedAt=p.updatedAt;
    applyRemote(p,true);
    showToast('☁️ Données mises à jour depuis un autre appareil');
  },err=>setSyncUI('error',err.message));
}

function connectSync(manual) {
  try{
    const cfg=getSyncConfig();
    if(!cfg||!cfg.config||!cfg.code){setSyncUI('off');return;}
    if(typeof firebase==='undefined'){setSyncUI('error','Firebase non chargé');return;}
    if(fbDb&&fbUnsub&&connectedCode===cfg.code){setSyncUI('connected');if(manual)showToast('Déjà connecté ☁️');return;}
    if(!fbApp){
      fbApp=firebase.apps&&firebase.apps.length?firebase.apps[0]:firebase.initializeApp(cfg.config);
      fbDb=firebase.firestore();
    }
    listenRemote(cfg.code);
    connectedCode=cfg.code;setSyncUI('connected');
    if(manual)showToast('☁️ Connecté — code : '+cfg.code);
  }catch(err){setSyncUI('error',err.message);if(manual)showToast('❌ Échec connexion');}
}

function disconnectSync(){
  if(fbUnsub){fbUnsub();fbUnsub=null;}
  connectedCode=null;setSyncConfig(null);setSyncUI('off');
  showToast('Synchronisation désactivée');
}

function openSyncModal(){
  const cfg=getSyncConfig();
  document.getElementById('syncConfigInput').value=cfg?.config?JSON.stringify(cfg.config,null,2):'';
  document.getElementById('syncCodeInput').value=cfg?.code||'';
  document.getElementById('syncEnabled').checked=!!cfg?.enabled;
  if(cfg&&cfg.config&&cfg.code)connectSync(false);else setSyncUI('off');
  document.getElementById('syncModal').classList.remove('hidden');
}
function closeSyncModal(){document.getElementById('syncModal').classList.add('hidden');}

document.getElementById('syncModal').addEventListener('click',e=>{if(e.target.id==='syncModal')closeSyncModal();});

document.getElementById('syncConfigInput')?.parentElement;
document.getElementById('syncModal').querySelector('#syncCodeInput');

// Boutons modal sync
document.addEventListener('click',e=>{
  if(e.target.id==='connectSyncBtnModal'){
    let cfg;try{cfg=JSON.parse(document.getElementById('syncConfigInput').value.trim());}catch{return showToast('❌ JSON invalide');}
    const code=document.getElementById('syncCodeInput').value.trim();
    if(!code)return showToast('⚠️ Entrez un code');
    fbApp=null;fbDb=null;connectedCode=null;
    setSyncConfig({config:cfg,code,enabled:true});connectSync(true);
  }
});

// Wire modal buttons via IDs in HTML
document.querySelector('#syncModal .modal-actions')?.addEventListener('click',e=>{
  const id=e.target.closest('.btn')?.getAttribute('onclick');
});

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
function initApp() {
  const now = new Date();
  calY = now.getFullYear(); calM = now.getMonth();
  document.getElementById('topbarDate').textContent = now.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});

  // Activer la vue today
  sv('today', null);
  document.querySelector('[data-v="today"]')?.classList.add('active');

  loadTodayView();
  checkBirthdays();
}

/* ════════════════════════════════════════════
   PWA — Service Worker (HTTP uniquement)
════════════════════════════════════════════ */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('✅ SW enregistré'))
      .catch(e => console.warn('SW:', e));
  });
}

/* ════════════════════════════════════════════
   AUTO-LOGIN
════════════════════════════════════════════ */
if (currentUser) {
  try { doLogin(currentUser); }
  catch(err) {
    console.error('Auto-login error:', err);
    loginScreen.style.display = 'flex';
  }
}
