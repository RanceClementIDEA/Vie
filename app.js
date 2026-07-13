/* ════════════════════════════════════════════
   SUIVI DE VIE — app.js (v2)
   • Authentification Firebase : e-mail / mot de passe + Google
   • Mode local sans compte (données sur l'appareil)
   • Données par utilisateur dans Firestore + cache hors-ligne
   • Synchronisation temps réel entre appareils
════════════════════════════════════════════ */
'use strict';

/* ── CONSTANTES ── */
const APP_VERSION   = '2.1.0';
const STEPS_PER_KM  = 1300;
const DEFAULT_GOALS = { steps: 10000, sport: 150, budget: 500, work: 35 };

/* ── CATALOGUE DE THÈMES ──
   Les 4 premiers existent déjà dans style.css ; les suivants sont injectés
   dynamiquement (voir injectDynamicStyles) pour que ce fichier reste autonome. */
const THEME_CATALOG = [
  { id: 'dark',     label: 'Sombre',    emoji: '🌙', bg: '#0F172A' },
  { id: 'light',    label: 'Clair',     emoji: '☀️', bg: '#F0F4FF' },
  { id: 'blue',     label: 'Océan',     emoji: '🌊', bg: '#0A0F2E' },
  { id: 'green',    label: 'Forêt',     emoji: '🌿', bg: '#052E16' },
  { id: 'sakura',   label: 'Sakura',    emoji: '🌸', bg: '#FFF1F5' },
  { id: 'cyberpunk',label: 'Cyberpunk', emoji: '🤖', bg: '#0A0016' },
  { id: 'sunset',   label: 'Sunset',    emoji: '🌇', bg: '#2B1530' },
  { id: 'emerald',  label: 'Émeraude',  emoji: '💎', bg: '#04231C' },
  { id: 'aurora',   label: 'Aurore',    emoji: '🌌', bg: '#0A1424' },
  { id: 'mono',     label: 'Graphite',  emoji: '⚫', bg: '#0C0C0E' },
];
const THEMES = THEME_CATALOG.map(t => t.id);

/* ── CATALOGUE DE SUIVIS D'ACTIVITÉ ──
   Types : counter (± entiers), number (valeur libre), scale (1→5), check (oui/non).
   inverse:true → l'objectif est un plafond à ne pas dépasser (café, écran, stress…). */
const TRACKER_CATALOG = [
  { id:'water',      emoji:'💧', label:'Hydratation',    type:'counter', unit:'verres',  goal:8,  step:1,   color:'#38BDF8' },
  { id:'sleep',      emoji:'😴', label:'Sommeil',        type:'number',  unit:'h',       goal:8,  step:0.5, color:'#818CF8' },
  { id:'mood',       emoji:'😊', label:'Humeur',         type:'scale',                              color:'#FBBF24' },
  { id:'energy',     emoji:'⚡', label:'Énergie',        type:'scale',                              color:'#F59E0B' },
  { id:'stress',     emoji:'😰', label:'Stress',         type:'scale',   inverse:true,              color:'#FB7185' },
  { id:'reading',    emoji:'📚', label:'Lecture',        type:'number',  unit:'min',     goal:30, step:5,   color:'#A78BFA' },
  { id:'meditation', emoji:'🧘', label:'Méditation',     type:'number',  unit:'min',     goal:10, step:5,   color:'#34D399' },
  { id:'coffee',     emoji:'☕', label:'Café',           type:'counter', unit:'tasses',  goal:2,  step:1,   color:'#B45309', inverse:true },
  { id:'screen',     emoji:'📱', label:'Temps d\'écran', type:'number',  unit:'h',       goal:3,  step:0.5, color:'#F472B6', inverse:true },
  { id:'fruits',     emoji:'🍎', label:'Fruits & légumes', type:'counter', unit:'portions', goal:5, step:1, color:'#4ADE80' },
  { id:'water_plant',emoji:'🌱', label:'Bonne action',   type:'check',                              color:'#22C55E' },
  { id:'vitamins',   emoji:'💊', label:'Vitamines',      type:'check',                              color:'#F97316' },
  { id:'gratitude',  emoji:'🙏', label:'Gratitude',      type:'check',                              color:'#FBBF24' },
  { id:'journaling', emoji:'✍️', label:'Journaling',     type:'check',                              color:'#A78BFA' },
  { id:'outdoors',   emoji:'🌳', label:'Temps dehors',   type:'number',  unit:'min',     goal:30, step:10,  color:'#34D399' },
  { id:'weight',     emoji:'⚖️', label:'Poids',          type:'number',  unit:'kg',               step:0.1, color:'#94A3B8' },
  { id:'mealhealthy',emoji:'🥗', label:'Repas sain',     type:'check',                              color:'#84CC16' },
  { id:'teeth',      emoji:'🦷', label:'Brossage',       type:'counter', unit:'',        goal:2,  step:1,   color:'#67E8F9' },
  { id:'cold_shower',emoji:'🚿', label:'Douche froide',  type:'check',                              color:'#38BDF8' },
  { id:'social',     emoji:'💬', label:'Temps social',   type:'number',  unit:'min',              step:15,  color:'#60A5FA' },
  { id:'productivity',emoji:'🎯',label:'Productivité',   type:'scale',                              color:'#6366F1' },
  { id:'pain',       emoji:'🤕', label:'Douleur',        type:'scale',   inverse:true,              color:'#F87171' },
  { id:'alcohol',    emoji:'🍷', label:'Alcool',         type:'counter', unit:'verres',  inverse:true, step:1, color:'#EF4444' },
  { id:'smoke',      emoji:'🚬', label:'Cigarettes',     type:'counter', unit:'',        inverse:true, step:1, color:'#9CA3AF' },
  { id:'music',      emoji:'🎵', label:'Créativité',     type:'check',                              color:'#F472B6' },
  { id:'nap',        emoji:'💤', label:'Sieste',         type:'check',                              color:'#A78BFA' },
];
const DEFAULT_TRACKERS = ['water', 'sleep', 'mood', 'reading'];

function newState() {
  return {
    days: {}, deleted: {}, planning: {}, birthdays: [],
    goals: { ...DEFAULT_GOALS }, profile: {},
    trackers: DEFAULT_TRACKERS.slice(), customTrackers: [],
  };
}

/* ── ÉTAT GLOBAL ── */
let S            = newState();
let mode         = null;   // 'cloud' | 'local'
let currentUser  = null;   // { uid?, email?, name }
let currentTheme = localStorage.getItem('vieTheme') || 'dark';
let activeView   = 'today';
let statsPeriod  = 'week';          // 'day' | 'week' | 'month' | 'year' | 'custom'
let statsAnchor  = new Date();      // date de référence de la période affichée
let statsCustom  = { start: '', end: '' };
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
  const hasTrackers   = day.trackers && Object.values(day.trackers).some(v => v === true || (typeof v === 'number' && v > 0));
  const count = [hasWork, hasSport, hasWalk, hasExpenses, hasActivities, hasNotes, hasTrackers].filter(Boolean).length;
  if (count >= 3) return 'complete';
  if (count >= 1) return 'partial';
  return 'empty';
}

/* ════════════════════════════════════════════
   THÈMES
════════════════════════════════════════════ */
function setTheme(theme, save = true) {
  if (!THEMES.includes(theme)) theme = 'dark';
  currentTheme = theme;
  document.body.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === theme);
  });
  // Couleur de la barre système (mobile) accordée au thème
  const meta = document.querySelector('meta[name="theme-color"]');
  const info = THEME_CATALOG.find(t => t.id === theme);
  if (meta && info) meta.setAttribute('content', info.bg);
  if (save) {
    localStorage.setItem('vieTheme', theme);
    showToast((info ? info.emoji + ' ' : '🎨 ') + 'Thème ' + (info ? info.label : '') + ' appliqué');
  }
}
function cycleTheme() {
  const idx = THEMES.indexOf(currentTheme);
  setTheme(THEMES[(idx + 1) % THEMES.length]);
}

/* Construit dynamiquement la grille de thèmes (Paramètres) à partir du catalogue */
function renderThemeGrid() {
  const grid = document.querySelector('.theme-grid');
  if (!grid) return;
  grid.innerHTML = THEME_CATALOG.map(t => `
    <div class="theme-opt ${t.id === currentTheme ? 'active' : ''}" data-theme="${t.id}" onclick="setTheme('${t.id}')">
      <span class="theme-swatch" data-theme="${t.id}"></span>
      <span>${t.emoji} ${t.label}</span>
    </div>`).join('');
}

/* ════════════════════════════════════════════
   STYLES DYNAMIQUES (thèmes additionnels + nouveaux composants)
   Injectés ici pour que la mise à jour ne concerne que app.js.
════════════════════════════════════════════ */
function injectDynamicStyles() {
  if ($('vieDynamicStyles')) return;
  const css = `
  /* ── NOUVEAUX THÈMES ── */
  [data-theme="sakura"]{
    --bg:#FFF1F5;--bg2:#FFFFFF;--surface:#FFFFFF;--surface2:#FCE1EC;
    --border:rgba(219,39,119,.12);--border2:rgba(219,39,119,.07);
    --primary:#EC4899;--primary-l:#F472B6;--primary-d:#DB2777;
    --neon:#10B981;--gold:#F59E0B;--red:#EF4444;--blue:#3B82F6;--orange:#FB923C;--pink:#EC4899;
    --text1:#4A2233;--text2:#8B5A72;--text3:#B98AA0;
    --sport:#10B981;--walk:#3B82F6;--work:#D97706;--money:#EC4899;--note:#8B5CF6;
    --gp:0 0 22px rgba(236,72,153,.28);
  }
  [data-theme="cyberpunk"]{
    --bg:#0A0016;--bg2:#140427;--surface:#170A2E;--surface2:#241046;
    --border:rgba(240,0,255,.22);--border2:rgba(0,240,255,.12);
    --primary:#F000FF;--primary-l:#FF5EF4;--primary-d:#C800E0;
    --neon:#00F5D4;--gold:#FCEE0A;--red:#FF3864;--blue:#00E5FF;--orange:#FF9E00;--pink:#FF5EF4;
    --text1:#F3E9FF;--text2:#B98FE0;--text3:#7C5BAE;
    --sport:#00F5D4;--walk:#00E5FF;--work:#FCEE0A;--money:#FF5EF4;--note:#B98FE0;
    --gp:0 0 26px rgba(240,0,255,.45);
  }
  [data-theme="sunset"]{
    --bg:#2B1530;--bg2:#3A1D3F;--surface:#3A1D3F;--surface2:#522A53;
    --border:rgba(251,146,60,.18);--border2:rgba(251,146,60,.10);
    --primary:#FB7185;--primary-l:#FDA4AF;--primary-d:#F43F5E;
    --neon:#34D399;--gold:#FBBF24;--red:#F87171;--blue:#818CF8;--orange:#FB923C;--pink:#F472B6;
    --text1:#FFF1F2;--text2:#E7B7C4;--text3:#B98597;
    --sport:#FBBF24;--walk:#FDA4AF;--work:#FB923C;--money:#F472B6;--note:#C4B5FD;
    --gp:0 0 24px rgba(251,113,133,.35);
  }
  [data-theme="emerald"]{
    --bg:#04231C;--bg2:#06342A;--surface:#06342A;--surface2:#0B4A3B;
    --border:rgba(16,185,129,.18);--border2:rgba(16,185,129,.10);
    --primary:#10B981;--primary-l:#34D399;--primary-d:#059669;
    --neon:#6EE7B7;--gold:#FCD34D;--red:#FB7185;--blue:#5EEAD4;--orange:#FBBF24;--pink:#F472B6;
    --text1:#ECFDF5;--text2:#8CD9BE;--text3:#4F8B76;
    --sport:#6EE7B7;--walk:#5EEAD4;--work:#FCD34D;--money:#F472B6;--note:#A7F3D0;
    --gp:0 0 24px rgba(16,185,129,.32);
  }
  [data-theme="aurora"]{
    --bg:#0A1424;--bg2:#0F1E38;--surface:#0F1E38;--surface2:#193052;
    --border:rgba(94,234,212,.16);--border2:rgba(129,140,248,.10);
    --primary:#22D3EE;--primary-l:#67E8F9;--primary-d:#06B6D4;
    --neon:#5EEAD4;--gold:#FDE68A;--red:#FB7185;--blue:#60A5FA;--orange:#FBBF24;--pink:#C084FC;
    --text1:#ECFEFF;--text2:#9EC5D8;--text3:#5E86A0;
    --sport:#5EEAD4;--walk:#60A5FA;--work:#FDE68A;--money:#C084FC;--note:#A5B4FC;
    --gp:0 0 24px rgba(34,211,238,.3);
  }
  [data-theme="mono"]{
    --bg:#0C0C0E;--bg2:#161618;--surface:#161618;--surface2:#242427;
    --border:rgba(255,255,255,.10);--border2:rgba(255,255,255,.06);
    --primary:#E5E5E7;--primary-l:#FFFFFF;--primary-d:#A1A1AA;
    --neon:#D4D4D8;--gold:#E4E4E7;--red:#F87171;--blue:#D4D4D8;--orange:#E4E4E7;--pink:#E5E5E7;
    --text1:#FAFAFA;--text2:#A1A1AA;--text3:#6B6B72;
    --sport:#E4E4E7;--walk:#D4D4D8;--work:#E5E5E7;--money:#FAFAFA;--note:#A1A1AA;
    --gp:0 0 20px rgba(255,255,255,.12);
  }
  [data-theme="sakura"] body,[data-theme="light"] body{--gp:0 0 20px rgba(99,102,241,.12)}

  /* ── APERÇU COULEUR DANS LA GRILLE DE THÈMES ── */
  .theme-opt{display:flex;align-items:center;gap:9px;justify-content:flex-start;text-align:left}
  .theme-swatch{width:22px;height:22px;border-radius:7px;flex-shrink:0;border:1px solid rgba(128,128,128,.25)}
  .theme-swatch[data-theme="dark"]{background:linear-gradient(135deg,#1E293B,#6366F1)}
  .theme-swatch[data-theme="light"]{background:linear-gradient(135deg,#FFFFFF,#6366F1)}
  .theme-swatch[data-theme="blue"]{background:linear-gradient(135deg,#0F1B4A,#3B82F6)}
  .theme-swatch[data-theme="green"]{background:linear-gradient(135deg,#064E3B,#10B981)}
  .theme-swatch[data-theme="sakura"]{background:linear-gradient(135deg,#FFE4EF,#EC4899)}
  .theme-swatch[data-theme="cyberpunk"]{background:linear-gradient(135deg,#F000FF,#00F5D4)}
  .theme-swatch[data-theme="sunset"]{background:linear-gradient(135deg,#FB7185,#FBBF24)}
  .theme-swatch[data-theme="emerald"]{background:linear-gradient(135deg,#06342A,#34D399)}
  .theme-swatch[data-theme="aurora"]{background:linear-gradient(135deg,#193052,#22D3EE)}
  .theme-swatch[data-theme="mono"]{background:linear-gradient(135deg,#242427,#FAFAFA)}

  /* ── SÉLECTEUR DE PÉRIODE (STATS) ── */
  .stats-period-row{flex-wrap:wrap}
  .stats-period-row .period-btn{flex:1 1 auto;min-width:60px;padding:9px 8px}
  .stats-nav-row{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .stats-nav-btn{width:38px;height:38px;border-radius:10px;background:var(--surface2);color:var(--text2);font-size:18px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);transition:all .2s;cursor:pointer;flex-shrink:0}
  .stats-nav-btn:hover:not(:disabled){border-color:var(--primary);color:var(--primary-l)}
  .stats-nav-btn:disabled{opacity:.35;cursor:default}
  .stats-range-label{flex:1;text-align:center;font-family:'Sora',sans-serif;font-weight:700;font-size:14px;color:var(--text1);text-transform:capitalize}
  .stats-custom-row{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}
  .stats-custom-row .input-group{flex:1;min-width:130px}

  /* ── SUIVI D'ACTIVITÉ (TRACKERS) ── */
  .tk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .tk-card{background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:9px;position:relative;transition:border-color .2s}
  .tk-card.tk-full{grid-column:1 / -1}
  .tk-card.tk-done{border-color:color-mix(in srgb,var(--tkc) 55%,transparent)}
  .tk-head{display:flex;align-items:flex-start;gap:8px}
  .tk-emoji{font-size:18px;line-height:1.2;flex-shrink:0}
  .tk-name{font-size:12.5px;font-weight:600;color:var(--text1);flex:1;min-width:0;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .tk-val{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:12.5px;color:var(--tkc);white-space:nowrap;flex-shrink:0;line-height:1.4}
  .tk-counter{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .tk-btn{width:34px;height:34px;border-radius:9px;background:var(--bg2);border:1px solid var(--border);color:var(--text1);font-size:19px;font-weight:600;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
  .tk-btn:hover{border-color:var(--tkc);color:var(--tkc)}
  .tk-btn:active{transform:scale(.9)}
  .tk-counter-val{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:20px;color:var(--text1);text-align:center;flex:1}
  .tk-counter-val small{display:block;font-size:9px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-top:1px}
  .tk-scale{display:flex;gap:6px;justify-content:space-between}
  .tk-dot{flex:1;height:32px;border-radius:8px;background:var(--bg2);border:1px solid var(--border);font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s;color:var(--text3)}
  .tk-dot:hover{border-color:var(--tkc)}
  .tk-dot.on{background:var(--tkc);border-color:var(--tkc);color:#fff;transform:scale(1.05)}
  .tk-num-wrap{display:flex;align-items:center;gap:6px}
  .tk-num-wrap input{flex:1;min-width:0;background:var(--bg2);border:1px solid var(--border);border-radius:9px;padding:8px 10px;color:var(--text1);outline:none;font-size:14px;font-weight:600;transition:border-color .2s}
  .tk-num-wrap input:focus{border-color:var(--tkc)}
  .tk-num-unit{font-size:11px;color:var(--text3);font-weight:600;flex-shrink:0}
  .tk-check-btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:9px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);color:var(--text2);font-size:13px;font-weight:600;transition:all .18s;width:100%}
  .tk-check-btn:hover{border-color:var(--tkc)}
  .tk-check-btn.on{background:color-mix(in srgb,var(--tkc) 16%,transparent);border-color:var(--tkc);color:var(--tkc)}
  .tk-bar{height:5px;border-radius:3px;background:var(--bg2);overflow:hidden}
  .tk-bar-fill{height:100%;border-radius:3px;background:var(--tkc);transition:width .4s cubic-bezier(.34,1.56,.64,1);max-width:100%}
  .tk-empty{grid-column:1 / -1;text-align:center;padding:18px 12px;color:var(--text3);font-size:12.5px;line-height:1.6}
  .tk-empty button{margin-top:8px}

  /* ── RÉGLAGES DES TRACKERS ── */
  .tk-cat-grid{display:flex;flex-wrap:wrap;gap:8px}
  .tk-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:20px;background:var(--surface2);border:1px solid var(--border);color:var(--text2);font-size:12.5px;font-weight:600;transition:all .18s;cursor:pointer}
  .tk-chip:hover{border-color:var(--primary)}
  .tk-chip.on{background:rgba(99,102,241,.15);border-color:var(--primary);color:var(--primary-l)}
  .tk-chip .tk-chip-x{opacity:.6;font-size:11px}
  .tk-custom-form{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:end}
  .tk-custom-form .input-group{min-width:0}
  .tk-custom-form input,.tk-custom-form select{background:var(--surface2);border:1px solid var(--border);border-radius:9px;padding:8px 10px;color:var(--text1);outline:none;width:100%}
  .tk-emoji-input{width:52px;text-align:center;font-size:18px}

  /* ── GRAPHIQUES : barres à hauteur fiable (les colonnes remplissent la hauteur) ── */
  .mini-bar-chart{height:96px}
  .mini-bar-col{height:100%;justify-content:flex-end}
  .mini-bar{opacity:.9}
  .mini-bar-col:hover .mini-bar{opacity:1}

  /* ── SYNTHÈSE TRACKERS (STATS) ── */
  .tk-stat-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border2)}
  .tk-stat-row:last-child{border-bottom:none}
  .tk-stat-emoji{font-size:17px;width:26px;text-align:center;flex-shrink:0}
  .tk-stat-name{font-size:12.5px;color:var(--text2);flex:1;min-width:0}
  .tk-stat-val{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;color:var(--text1);white-space:nowrap}
  .tk-stat-val small{color:var(--text3);font-weight:500}

  @media(max-width:360px){.tk-grid{grid-template-columns:minmax(0,1fr)}}
  `;
  const style = document.createElement('style');
  style.id = 'vieDynamicStyles';
  style.textContent = css;
  document.head.appendChild(style);
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
  injectDynamicStyles();
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
  ensureTrackerDom();
  renderThemeGrid();
  setTheme(currentTheme, false);
  const n = new Date();
  calY = n.getFullYear(); calM = n.getMonth();
  $('topbarDate').textContent = n.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
  const av = $('appVersion'); if (av) av.textContent = 'v' + APP_VERSION;
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
      trackers: S.trackers || DEFAULT_TRACKERS.slice(), customTrackers: S.customTrackers || [],
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
    trackers:  localNewer ? (local.trackers || DEFAULT_TRACKERS.slice()) : (remote.trackers || DEFAULT_TRACKERS.slice()),
    customTrackers: localNewer ? (local.customTrackers || []) : (remote.customTrackers || []),
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
      trackers:  d.trackers  || DEFAULT_TRACKERS.slice(),
      customTrackers: d.customTrackers || [],
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

  // Suivi d'activité personnalisable
  ensureTrackerDom();
  renderTrackers();
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
   SUIVI D'ACTIVITÉ PERSONNALISABLE (TRACKERS)
════════════════════════════════════════════ */
const SCALE_FACES = ['😣', '🙁', '😐', '🙂', '😄'];

function getTracker(id) {
  return (S.customTrackers || []).find(t => t.id === id)
      || TRACKER_CATALOG.find(t => t.id === id);
}
function enabledTrackers() {
  return (S.trackers || []).map(getTracker).filter(Boolean);
}
function trackerHasValue(def, v) {
  if (v === undefined || v === null || v === '') return false;
  if (def.type === 'check') return v === true;
  return (+v) > 0;
}

/* Injecte la section « Suivi d'activité » dans la vue Aujourd'hui (une fois) */
function ensureTrackerDom() {
  const view = $('view-today');
  if (!view || $('trackerSection')) return;
  const sec = document.createElement('div');
  sec.className = 'section-card';
  sec.id = 'trackerSection';
  const saveBtn = view.querySelector('.btn-save');
  view.insertBefore(sec, saveBtn);
}

function renderTrackers() {
  const sec = $('trackerSection');
  if (!sec) return;
  const list = enabledTrackers();
  const day = S.days[activeDayKey()] || {};
  const values = day.trackers || {};
  const cards = list.length
    ? `<div class="tk-grid">${list.map(def => trackerCardHTML(def, values[def.id], 'tk')).join('')}</div>`
    : `<div class="tk-grid"><div class="tk-empty">Aucun suivi activé.<br>Choisissez ceux qui comptent pour vous dans les Paramètres.<br><button class="btn btn-primary btn-sm" onclick="sv('more');setTimeout(()=>{const e=document.getElementById('trackerSettings');if(e)e.scrollIntoView({behavior:'smooth'})},60)">➕ Ajouter des suivis</button></div></div>`;
  sec.innerHTML = `
    <div class="section-header">
      <div class="section-icon" style="background:rgba(99,102,241,.15)">📿</div>
      <div class="section-title">Suivi d'activité</div>
      <button class="btn btn-ghost btn-sm" onclick="sv('more');setTimeout(()=>{const e=document.getElementById('trackerSettings');if(e)e.scrollIntoView({behavior:'smooth'})},60)" title="Personnaliser">⚙️</button>
    </div>
    <div class="section-body">${cards}</div>`;
}

/* Génère la carte d'un tracker. ns = préfixe des handlers ('tk' = aujourd'hui, 'etk' = modale) */
function trackerCardHTML(def, value, ns) {
  const c = def.color || 'var(--primary)';
  const full = def.type === 'scale' || def.type === 'counter';
  const done = trackerHasValue(def, value);
  let control = '';
  if (def.type === 'counter') {
    const v = +value || 0;
    control = `
      <div class="tk-counter">
        <button class="tk-btn" onclick="${ns}Inc('${def.id}',-1)" aria-label="Diminuer">−</button>
        <div class="tk-counter-val">${v}${def.unit ? `<small>${esc(def.unit)}</small>` : ''}</div>
        <button class="tk-btn" onclick="${ns}Inc('${def.id}',1)" aria-label="Augmenter">+</button>
      </div>${goalBarHTML(def, v, ns)}`;
  } else if (def.type === 'scale') {
    const v = +value || 0;
    control = `<div class="tk-scale">${SCALE_FACES.map((f, i) =>
      `<button class="tk-dot ${v === i + 1 ? 'on' : ''}" onclick="${ns}Scale('${def.id}',${i + 1})" aria-label="${i + 1}/5">${f}</button>`).join('')}</div>`;
  } else if (def.type === 'check') {
    control = `<button class="tk-check-btn ${done ? 'on' : ''}" onclick="${ns}Toggle('${def.id}')">${done ? '✓ Fait' : 'À faire'}</button>`;
  } else { // number
    const v = (value === undefined || value === null || value === '') ? '' : value;
    control = `
      <div class="tk-num-wrap">
        <input type="number" inputmode="decimal" id="${ns}_num_${def.id}" value="${esc(v)}" min="0" step="${def.step || 1}" placeholder="0" oninput="${ns}Num('${def.id}',this.value)">
        ${def.unit ? `<span class="tk-num-unit">${esc(def.unit)}</span>` : ''}
      </div>${goalBarHTML(def, +value || 0, ns)}`;
  }
  return `
    <div class="tk-card ${full ? 'tk-full' : ''} ${done ? 'tk-done' : ''}" id="${ns}_card_${def.id}" style="--tkc:${c}">
      <div class="tk-head">
        <span class="tk-emoji">${def.emoji || '•'}</span>
        <span class="tk-name">${esc(def.label)}</span>
        <span class="tk-val" id="${ns}_val_${def.id}">${trackerBadge(def, value)}</span>
      </div>
      ${control}
    </div>`;
}

function goalBarHTML(def, v, ns) {
  if (!def.goal) return '';
  const pct = Math.min(100, (v / def.goal) * 100);
  return `<div class="tk-bar"><div class="tk-bar-fill" id="${ns}_bar_${def.id}" style="width:${pct}%"></div></div>`;
}

/* Petit badge de valeur affiché en haut à droite de la carte.
   Compteurs (pleine largeur) : valeur + unité. Nombres (demi-largeur) : compact, sans unité
   car l'unité figure déjà à côté du champ de saisie. */
function trackerBadge(def, value) {
  if (def.type === 'scale') return (+value > 0) ? `${value}/5` : '—';
  if (def.type === 'check') return trackerHasValue(def, value) ? '✓' : '';
  const v = +value || 0;
  const shown = Number.isInteger(v) ? v : v.toFixed(1);
  if (def.type === 'number') {
    if (!v && !def.goal) return '—';
    return def.goal ? `${shown}/${def.goal}` : `${shown}`;
  }
  // counter
  if (def.goal) return `${shown}/${def.goal}${def.unit ? ' ' + def.unit : ''}`;
  return `${shown}${def.unit ? ' ' + def.unit : ''}`;
}

/* Valeur lisible d'un tracker (détail du jour, historique) */
function fmtTrackerDetail(def, val) {
  if (def.type === 'check') return 'Fait ✓';
  if (def.type === 'scale') return `${SCALE_FACES[(+val || 1) - 1] || ''} ${val}/5`;
  const v = +val || 0;
  const shown = Number.isInteger(v) ? v.toLocaleString('fr-FR') : v.toFixed(1);
  return `${shown}${def.unit ? ' ' + def.unit : ''}${def.goal ? ' / ' + def.goal : ''}`;
}

/* Rafraîchit uniquement le badge + la barre d'une carte (sans re-render → garde le focus) */
function updateTrackerVisual(def, value, ns) {
  const badge = $(`${ns}_val_${def.id}`);
  if (badge) badge.textContent = trackerBadge(def, value);
  const bar = $(`${ns}_bar_${def.id}`);
  if (bar && def.goal) bar.style.width = Math.min(100, ((+value || 0) / def.goal) * 100) + '%';
  const card = $(`${ns}_card_${def.id}`);
  if (card) card.classList.toggle('tk-done', trackerHasValue(def, value));
}

/* ── Handlers « Aujourd'hui » (écrivent dans S.days) ── */
function tkDay() {
  const ds = activeDayKey();
  const d = S.days[ds] = S.days[ds] || {};
  d.trackers = d.trackers || {};
  return d;
}
function tkCommit(rerender) {
  const d = S.days[activeDayKey()];
  d.updatedAt = Date.now();
  persist();
  renderGreeting();
  if (rerender) renderTrackers();
}
function tkInc(id, delta) {
  const def = getTracker(id); if (!def) return;
  const d = tkDay();
  let v = (+d.trackers[id] || 0) + delta * (def.step || 1);
  v = Math.max(0, Math.round(v * 100) / 100);
  d.trackers[id] = v;
  tkCommit(true);
}
function tkScale(id, v) {
  const d = tkDay();
  d.trackers[id] = (d.trackers[id] === v) ? 0 : v; // re-cliquer désélectionne
  tkCommit(true);
}
function tkToggle(id) {
  const d = tkDay();
  d.trackers[id] = !d.trackers[id];
  tkCommit(true);
}
function tkNum(id, val) {
  const def = getTracker(id); if (!def) return;
  const d = tkDay();
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) delete d.trackers[id];
  else d.trackers[id] = n;
  updateTrackerVisual(def, d.trackers[id], 'tk');
  tkCommit(false); // pas de re-render : conserve le focus dans le champ
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
  if (day.trackers) {
    Object.keys(day.trackers).forEach(id => {
      const def = getTracker(id);
      const val = day.trackers[id];
      if (!def || !trackerHasValue(def, val)) return;
      rows.push(`<div class="detail-row"><span class="detail-icon">${def.emoji || '•'}</span><span class="detail-label">${esc(def.label)}</span><span class="detail-value">${esc(fmtTrackerDetail(def, val))}</span></div>`);
    });
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
  editDraft.trackers   = editDraft.trackers   || {};

  $('editModalTitle').textContent = '✏️ ' + prettyDate(ds);
  $('editModalContent').innerHTML = buildEditModalHTML();

  renderEditExpenses();
  renderEditActivities();
  renderEditTrackers();
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

    <div class="esec" id="editTrackerSec">
      <div class="esec-title">📿 Suivi d'activité</div>
      <div id="editTrackerList"></div>
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

/* Suivi d'activité dans la modale (sur le brouillon) */
function renderEditTrackers() {
  const el = $('editTrackerList');
  if (!el) return;
  const list = enabledTrackers();
  const sec = $('editTrackerSec');
  if (!list.length) { if (sec) sec.style.display = 'none'; return; }
  if (sec) sec.style.display = '';
  el.innerHTML = `<div class="tk-grid">${list.map(def => trackerCardHTML(def, editDraft.trackers[def.id], 'etk')).join('')}</div>`;
}
function etkInc(id, delta) {
  const def = getTracker(id); if (!def) return;
  let v = (+editDraft.trackers[id] || 0) + delta * (def.step || 1);
  editDraft.trackers[id] = Math.max(0, Math.round(v * 100) / 100);
  renderEditTrackers();
}
function etkScale(id, v) {
  editDraft.trackers[id] = (editDraft.trackers[id] === v) ? 0 : v;
  renderEditTrackers();
}
function etkToggle(id) {
  editDraft.trackers[id] = !editDraft.trackers[id];
  renderEditTrackers();
}
function etkNum(id, val) {
  const def = getTracker(id); if (!def) return;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) delete editDraft.trackers[id];
  else editDraft.trackers[id] = n;
  updateTrackerVisual(def, editDraft.trackers[id], 'etk');
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
/* Injecte la barre de navigation + le panneau de dates personnalisées (une fois) */
function ensureStatsDom() {
  const row = document.querySelector('.stats-period-row');
  if (!row) return;
  row.id = 'statsPeriodRow';
  if (!$('statsNavRow')) {
    const nav = document.createElement('div');
    nav.className = 'stats-nav-row';
    nav.id = 'statsNavRow';
    nav.innerHTML = `
      <button class="stats-nav-btn" id="statsNavPrev" onclick="statsNav(-1)" aria-label="Période précédente">‹</button>
      <div class="stats-range-label" id="statsRangeLabel">—</div>
      <button class="stats-nav-btn" id="statsNavNext" onclick="statsNav(1)" aria-label="Période suivante">›</button>`;
    row.insertAdjacentElement('afterend', nav);
  }
  if (!$('statsCustomRow')) {
    const cr = document.createElement('div');
    cr.className = 'stats-custom-row';
    cr.id = 'statsCustomRow';
    cr.style.display = 'none';
    cr.innerHTML = `
      <div class="input-group"><label>Du</label><input type="date" id="statsCustomStart" onchange="applyCustomRange()"></div>
      <div class="input-group"><label>Au</label><input type="date" id="statsCustomEnd" onchange="applyCustomRange()"></div>`;
    $('statsNavRow').insertAdjacentElement('afterend', cr);
  }
}

const startOfWeek = d => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; };

/* Bornes + granularité de la période courante */
function getStatsRange() {
  const a = new Date(statsAnchor); a.setHours(0, 0, 0, 0);
  if (statsPeriod === 'day') {
    return { start: new Date(a), end: new Date(a), gran: 'day', navUnit: 'day',
      label: a.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), sub: 'ce jour' };
  }
  if (statsPeriod === 'week') {
    const s = startOfWeek(a); const e = new Date(s); e.setDate(s.getDate() + 6);
    return { start: s, end: e, gran: 'day', navUnit: 'week',
      label: 'Semaine du ' + s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), sub: 'cette semaine' };
  }
  if (statsPeriod === 'month') {
    const s = new Date(a.getFullYear(), a.getMonth(), 1);
    const e = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start: s, end: e, gran: 'day', navUnit: 'month',
      label: monthNames[a.getMonth()] + ' ' + a.getFullYear(), sub: 'ce mois-ci' };
  }
  if (statsPeriod === 'year') {
    return { start: new Date(a.getFullYear(), 0, 1), end: new Date(a.getFullYear(), 11, 31), gran: 'month', navUnit: 'year',
      label: 'Année ' + a.getFullYear(), sub: 'cette année' };
  }
  // custom
  let s = statsCustom.start ? new Date(statsCustom.start + 'T00:00:00') : startOfWeek(new Date());
  let e = statsCustom.end   ? new Date(statsCustom.end   + 'T00:00:00') : new Date();
  s.setHours(0, 0, 0, 0); e.setHours(0, 0, 0, 0);
  if (e < s) { const t = s; s = e; e = t; }
  const span = Math.round((e - s) / 864e5) + 1;
  return { start: s, end: e, gran: span > 62 ? 'month' : 'day', navUnit: null,
    label: s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' – ' + e.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
    sub: 'sur la période' };
}

/* Liste des jours de la période (bornée à aujourd'hui, pas de futur) */
function getStatsDays(range) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = range.end > today ? today : range.end;
  const out = [];
  const d = new Date(range.start); d.setHours(0, 0, 0, 0);
  let guard = 0;
  while (d <= end && guard++ < 4000) { out.push(fmtDate(d)); d.setDate(d.getDate() + 1); }
  return out;
}

function setStatsPeriod(p) {
  statsPeriod = p;
  if (p !== 'custom') statsAnchor = new Date();
  renderStats();
}

function statsNav(dir) {
  const u = getStatsRange().navUnit;
  const a = new Date(statsAnchor);
  if (u === 'day')        a.setDate(a.getDate() + dir);
  else if (u === 'week')  a.setDate(a.getDate() + 7 * dir);
  else if (u === 'month') a.setMonth(a.getMonth() + dir);
  else if (u === 'year')  a.setFullYear(a.getFullYear() + dir);
  else return;
  statsAnchor = a;
  renderStats();
}

function applyCustomRange() {
  statsCustom.start = $('statsCustomStart').value;
  statsCustom.end   = $('statsCustomEnd').value;
  renderStats();
}

function renderStatsControls(range) {
  ensureStatsDom();
  const row = $('statsPeriodRow');
  const periods = [['day', 'Jour'], ['week', 'Semaine'], ['month', 'Mois'], ['year', 'Année'], ['custom', 'Perso']];
  row.innerHTML = periods.map(([p, l]) =>
    `<button class="period-btn ${statsPeriod === p ? 'active' : ''}" onclick="setStatsPeriod('${p}')">${l}</button>`).join('');

  const isCustom = statsPeriod === 'custom';
  $('statsNavRow').style.display    = isCustom ? 'none' : 'flex';
  $('statsCustomRow').style.display = isCustom ? 'flex' : 'none';

  if (isCustom) {
    if (!statsCustom.start || !statsCustom.end) {
      const e = new Date(), s = new Date(); s.setDate(s.getDate() - 29);
      statsCustom.start = statsCustom.start || fmtDate(s);
      statsCustom.end   = statsCustom.end   || fmtDate(e);
    }
    $('statsCustomStart').value = statsCustom.start;
    $('statsCustomEnd').value   = statsCustom.end;
  } else {
    $('statsRangeLabel').textContent = range.label;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    $('statsNavNext').disabled = range.end >= today;
  }
}

function renderStats() {
  // Garantir des bornes personnalisées cohérentes AVANT de calculer la période
  if (statsPeriod === 'custom' && (!statsCustom.start || !statsCustom.end)) {
    const e = new Date(), s = new Date(); s.setDate(s.getDate() - 29);
    statsCustom.start = statsCustom.start || fmtDate(s);
    statsCustom.end   = statsCustom.end   || fmtDate(e);
  }
  const range = getStatsRange();
  renderStatsControls(range);
  const days = getStatsDays(range);

  let totalSport = 0, totalKm = 0, totalSteps = 0, totalMoney = 0, totalWork = 0, sportDays = 0;
  days.forEach(ds => {
    const day = S.days[ds] || {};
    totalSport += (day.sport && day.sport.time) || 0;
    totalKm    += (day.walk && day.walk.km) || 0;
    totalSteps += (day.walk && day.walk.steps) || 0;
    totalMoney += (day.expenses || []).reduce((a, e) => a + (+e.amount || 0), 0);
    totalWork  += (day.work && day.work.total) || 0;
    if (((day.sport && day.sport.time) || 0) > 0 || (day.sport && day.sport.done)) sportDays++;
  });

  const sub = range.sub;
  $('statsGrid').innerHTML = `
    <div class="stat-tile"><div class="stat-tile-icon">🏃</div><div class="stat-tile-label">Sport</div><div class="stat-tile-val sv-sport">${totalSport} min</div><div class="stat-tile-sub">${sportDays} séance${sportDays > 1 ? 's' : ''} ${sub}</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">🚶</div><div class="stat-tile-label">Marche</div><div class="stat-tile-val sv-walk">${totalKm.toFixed(1)} km</div><div class="stat-tile-sub">${totalSteps.toLocaleString('fr-FR')} pas</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">💼</div><div class="stat-tile-label">Travail</div><div class="stat-tile-val sv-work">${minToHM(totalWork)}</div><div class="stat-tile-sub">${sub}</div></div>
    <div class="stat-tile"><div class="stat-tile-icon">💰</div><div class="stat-tile-label">Dépenses</div><div class="stat-tile-val sv-money">${fmtMoney(totalMoney)}</div><div class="stat-tile-sub">${sub}</div></div>
  `;

  const sportSeries = aggregateSeries(days, day => (day.sport && day.sport.time) || 0, range);
  const stepsSeries = aggregateSeries(days, day => (day.walk && day.walk.steps) || 0, range);
  const workSeries  = aggregateSeries(days, day => ((day.work && day.work.total) || 0) / 60, range);
  const moneySeries = aggregateSeries(days, day => (day.expenses || []).reduce((a, e) => a + (+e.amount || 0), 0), range);

  $('statsCharts').innerHTML =
      renderMiniChart('Sport', sportSeries, 'var(--sport)', v => Math.round(v) + ' min')
    + renderMiniChart('Marche', stepsSeries, 'var(--walk)', v => Math.round(v).toLocaleString('fr-FR') + ' pas')
    + renderMiniChart('Travail', workSeries, 'var(--work)', v => v.toFixed(1) + ' h')
    + renderMiniChart('Dépenses', moneySeries, 'var(--money)', v => fmtMoney(v))
    + renderTrackerStats(days);
}

/* Regroupe les jours en barres — par jour, ou par mois pour les longues périodes */
function aggregateSeries(days, valueFn, range) {
  if (range.gran === 'month') {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = range.end > today ? today : range.end;
    const buckets = [], idx = {};
    const d = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    let guard = 0;
    while (d <= end && guard++ < 120) {
      idx[d.getFullYear() + '-' + pad(d.getMonth() + 1)] = buckets.length;
      buckets.push({ label: monthNames[d.getMonth()].slice(0, 3), val: 0 });
      d.setMonth(d.getMonth() + 1);
    }
    days.forEach(ds => {
      const k = ds.slice(0, 7);
      if (idx[k] !== undefined) buckets[idx[k]].val += valueFn(S.days[ds] || {});
    });
    return buckets;
  }
  return days.map(ds => ({
    label: new Date(ds + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    val: valueFn(S.days[ds] || {}),
  }));
}

function renderMiniChart(title, data, color, fmt) {
  if (!data.length) return `<div class="chart-card"><div class="chart-title">${title}</div><div class="empty-mini">Aucune donnée sur cette période.</div></div>`;
  const maxV = Math.max(...data.map(d => d.val), 1);
  const total = data.reduce((s, d) => s + d.val, 0);
  const step = Math.ceil(data.length / 13);
  const bars = data.map((d, i) => {
    const pct = maxV > 0 ? Math.max((d.val / maxV) * 100, d.val > 0 ? 4 : 0) : 0;
    const showLbl = data.length <= 13 || i % step === 0;
    return `<div class="mini-bar-col" title="${esc(d.label + ' · ' + fmt(d.val))}"><div class="mini-bar" style="height:${pct}%;background:${color};opacity:.85"></div><div class="mini-bar-lbl">${showLbl ? d.label : ''}</div></div>`;
  }).join('');
  return `<div class="chart-card"><div class="chart-title">${title} · <span style="color:var(--text3);font-weight:400">${fmt(total)} au total</span></div><div class="mini-bar-chart">${bars}</div></div>`;
}

/* Synthèse des suivis d'activité sur la période */
function renderTrackerStats(days) {
  const defs = enabledTrackers();
  if (!defs.length) return '';
  const rows = defs.map(def => {
    let sum = 0, cnt = 0, doneDays = 0;
    days.forEach(ds => {
      const v = ((S.days[ds] || {}).trackers || {})[def.id];
      if (!trackerHasValue(def, v)) return;
      cnt++;
      if (def.type === 'check') doneDays++;
      else if (def.type === 'scale') sum += (+v || 0);
      else { sum += (+v || 0); doneDays++; }
    });
    let valStr;
    if (def.type === 'check') {
      valStr = `${doneDays} <small>jour${doneDays > 1 ? 's' : ''}</small>`;
    } else if (def.type === 'scale') {
      const avg = cnt ? sum / cnt : 0;
      valStr = cnt ? `${avg.toFixed(1)}<small>/5</small> ${SCALE_FACES[Math.round(avg) - 1] || ''}` : '—';
    } else {
      const avg = cnt ? sum / cnt : 0;
      const sumStr = Number.isInteger(sum) ? sum.toLocaleString('fr-FR') : sum.toFixed(1);
      const avgStr = Number.isInteger(avg) ? avg : avg.toFixed(1);
      valStr = cnt ? `${sumStr}${def.unit ? ' ' + def.unit : ''} <small>(∅ ${avgStr}/j)</small>` : '—';
    }
    return `<div class="tk-stat-row"><span class="tk-stat-emoji">${def.emoji || '•'}</span><span class="tk-stat-name">${esc(def.label)}</span><span class="tk-stat-val">${valStr}</span></div>`;
  }).join('');
  return `<div class="chart-card"><div class="chart-title">📿 Suivi d'activité</div>${rows}</div>`;
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
   RÉGLAGES DES SUIVIS D'ACTIVITÉ
════════════════════════════════════════════ */
function ensureTrackerSettingsDom() {
  if ($('trackerSettings')) return;
  const grid = document.querySelector('.theme-grid');
  const themeSec = grid ? grid.closest('.settings-section') : null;
  const sec = document.createElement('div');
  sec.className = 'settings-section';
  sec.id = 'trackerSettings';
  if (themeSec && themeSec.parentNode) themeSec.parentNode.insertBefore(sec, themeSec.nextSibling);
  else { const v = $('view-more'); if (v) v.appendChild(sec); }
}

function renderTrackerSettings() {
  ensureTrackerSettingsDom();
  const sec = $('trackerSettings');
  if (!sec) return;
  const enabled = new Set(S.trackers || []);
  const custom = S.customTrackers || [];
  const all = [...TRACKER_CATALOG, ...custom];
  const enabledDefs = (S.trackers || []).map(getTracker).filter(Boolean);
  const disabledDefs = all.filter(d => !enabled.has(d.id));
  const isCustom = d => custom.some(c => c.id === d.id);
  const chip = (d, on) => `
    <button class="tk-chip ${on ? 'on' : ''}" onclick="toggleTracker('${d.id}')">
      <span>${d.emoji || '•'}</span><span>${esc(d.label)}</span>
      ${on ? '<span class="tk-chip-x">✓</span>' : ''}
      ${isCustom(d) ? `<span class="tk-chip-x" onclick="event.stopPropagation();deleteCustomTracker('${d.id}')" title="Supprimer" style="cursor:pointer">🗑</span>` : ''}
    </button>`;
  sec.innerHTML = `
    <div class="settings-label">📿 Suivi d'activité</div>
    <p class="view-desc" style="margin:0">Cochez les suivis à afficher dans « Aujourd'hui ». <strong>${enabledDefs.length}</strong> activé${enabledDefs.length > 1 ? 's' : ''}.</p>
    <div class="tk-cat-grid">
      ${enabledDefs.map(d => chip(d, true)).join('')}
      ${disabledDefs.map(d => chip(d, false)).join('')}
    </div>
    <details style="margin-top:4px">
      <summary style="font-size:12px;color:var(--text2);cursor:pointer;font-weight:600">➕ Créer un suivi personnalisé</summary>
      <div class="tk-custom-form" style="margin-top:10px">
        <div class="input-group"><label>Emoji</label><input type="text" id="tkNewEmoji" class="tk-emoji-input" maxlength="2" placeholder="🎯"></div>
        <div class="input-group"><label>Nom du suivi</label><input type="text" id="tkNewLabel" maxlength="24" placeholder="Ex : Yoga"></div>
        <div class="input-group"><label>Type</label>
          <select id="tkNewType">
            <option value="check">Oui / Non</option>
            <option value="counter">Compteur (±)</option>
            <option value="number">Valeur libre</option>
            <option value="scale">Note sur 5</option>
          </select>
        </div>
      </div>
      <div class="tk-custom-form" style="margin-top:8px">
        <div class="input-group"><label>Unité (option.)</label><input type="text" id="tkNewUnit" maxlength="10" placeholder="min, verres…"></div>
        <div class="input-group"><label>Objectif (option.)</label><input type="number" id="tkNewGoal" min="0" placeholder="—"></div>
        <button class="btn btn-primary btn-sm" onclick="addCustomTracker()" style="align-self:end">Ajouter</button>
      </div>
    </details>`;
}

function toggleTracker(id) {
  S.trackers = S.trackers || [];
  const i = S.trackers.indexOf(id);
  if (i >= 0) S.trackers.splice(i, 1);
  else S.trackers.push(id);
  persist();
  renderTrackerSettings();
  renderTrackers();
}

function addCustomTracker() {
  const label = $('tkNewLabel').value.trim();
  if (!label) { showToast('⚠️ Donnez un nom au suivi'); $('tkNewLabel').focus(); return; }
  const type  = $('tkNewType').value;
  const emoji = $('tkNewEmoji').value.trim() || '⭐';
  const unit  = $('tkNewUnit').value.trim();
  const goal  = parseFloat($('tkNewGoal').value);
  const def = { id: 'custom_' + uid(), emoji, label, type, color: '#6366F1' };
  if (unit) def.unit = unit;
  if (Number.isFinite(goal) && goal > 0) def.goal = goal;
  if (type === 'counter') def.step = 1;
  if (type === 'number')  def.step = unit === 'h' ? 0.5 : 1;
  S.customTrackers = S.customTrackers || [];
  S.customTrackers.push(def);
  S.trackers = S.trackers || [];
  S.trackers.push(def.id);
  persist();
  renderTrackerSettings();
  renderTrackers();
  showToast('✅ Suivi « ' + label + ' » ajouté');
}

async function deleteCustomTracker(id) {
  const def = getTracker(id);
  const ok = await confirmDialog({
    title: 'Supprimer ce suivi ?',
    message: (def ? def.label : '') + '\nLes valeurs déjà notées dans vos journées seront conservées mais masquées.',
    okLabel: 'Supprimer', icon: '🗑',
  });
  if (!ok) return;
  S.customTrackers = (S.customTrackers || []).filter(t => t.id !== id);
  S.trackers = (S.trackers || []).filter(t => t !== id);
  persist();
  renderTrackerSettings();
  renderTrackers();
}

/* ════════════════════════════════════════════
   PARAMÈTRES
════════════════════════════════════════════ */
function renderSettings() {
  renderThemeGrid();
  renderTrackerSettings();
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
  const hdr = 'Date,Sport fait,Sport min,Sport type,Marche km,Pas,Travail début,Travail fin,Pause min,Travail total (h),Dépenses €,Activités,Suivis,Notes\n';
  const rows = Object.entries(S.days).sort(([a], [b]) => a.localeCompare(b)).map(([ds, d]) => {
    const money = (d.expenses || []).reduce((s, e) => s + (+e.amount || 0), 0);
    const acts  = (d.activities || []).map(a => a.text).join(' | ');
    const trk = Object.keys(d.trackers || {}).map(id => {
      const def = getTracker(id);
      const v = d.trackers[id];
      return (def && trackerHasValue(def, v)) ? `${def.label}: ${fmtTrackerDetail(def, v)}` : '';
    }).filter(Boolean).join(' | ');
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
      csvQuote(trk),
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
      if (imp.days)           S.days           = imp.days;
      if (imp.deleted)        S.deleted        = imp.deleted;
      if (imp.planning)       S.planning       = imp.planning;
      if (imp.birthdays)      S.birthdays      = imp.birthdays;
      if (imp.goals)          S.goals          = { ...DEFAULT_GOALS, ...imp.goals };
      if (imp.trackers)       S.trackers       = imp.trackers;
      if (imp.customTrackers) S.customTrackers = imp.customTrackers;
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
