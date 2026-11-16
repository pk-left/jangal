'use strict';

/* =========================================================================
   Constants
   ========================================================================= */

// Categorical palette (dark-mode steps), fixed order. Validated for CVD separation.
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const PALETTE_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red'];
// Sequential ramp for heatmaps: index 0 = no study. The colours come from the active theme.
const SEQ = [0, 1, 2, 3, 4, 5].map((i) => `var(--seq-${i})`);

// id, name, then preview colours: background, surface, accent, text
const THEMES = [
  ['zine', 'Zine', '#1b2bff', '#fbf8ef', '#ff2d1f', '#111111'],
  ['midnight', 'Midnight', '#0f0f0e', '#1a1a19', '#3987e5', '#f0efec'],
  ['ember', 'Ember', '#12100d', '#1c1915', '#e8913a', '#f3eee6'],
  ['forest', 'Forest', '#0c110e', '#141b16', '#3fb27f', '#ecf1ec'],
  ['paper', 'Paper', '#f6f2ea', '#fffdf8', '#c2571a', '#24211c'],
  ['sky', 'Sky', '#f3f5f9', '#ffffff', '#2a6fd6', '#1b2130'],
  ['shinigami', 'Shinigami', '#0a0908', '#141211', '#c1272d', '#e9e2d0'],
];
const VIEWS = ['timer', 'plan', 'stats', 'subjects', 'rewards', 'settings'];

const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15, longEvery: 4,
  autoBreaks: true, autoFocus: false,
  goalMin: 240, dayStart: 4,
  sound: true, volume: 70, notify: true,
  theme: 'zine',
  ambient: 'off', ambientVol: 40,
  drama: true,          // red ring + heartbeat in the last 40 seconds of a focus session
  stretchEvery: 50,     // stopwatch mode: nudge to take a break every N minutes (0 = off)
};

const MIN = 60000;
const HOUR = 3600000;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* =========================================================================
   State
   ========================================================================= */

let db = null;
let dayCache = null;
const T = {
  mode: 'pomodoro',     // 'pomodoro' | 'stopwatch'
  phase: 'focus',       // 'focus' | 'short' | 'long'
  running: false,
  runStart: 0,          // wall-clock time the current run (since last start/resume) began
  elapsedBefore: 0,     // ms accumulated in this phase before the current run
  cycle: 0,             // completed focus sessions in the current set
};
const ui = { view: 'timer', month: null, lastTimeText: '', todayKey: '', showTable: false, stretchCount: 0, ready: false };

/* =========================================================================
   Utilities
   ========================================================================= */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = () => db.settings;

function fmtHM(ms) {
  const m = Math.floor(ms / MIN);
  const h = Math.floor(m / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${pad(m % 60)}m`;
}
function fmtShort(ms) {
  if (ms < MIN) return '';
  if (ms < HOUR) return `${Math.floor(ms / MIN)}m`;
  const h = ms / HOUR;
  return `${h >= 10 ? Math.round(h) : h.toFixed(1).replace(/\.0$/, '')}h`;
}
function fmtClock(ms, forceHours = false) {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 || forceHours ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtHourLabel(h) {
  return new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
}
function fmtGoal(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ---- day keys: a "study day" starts at settings.dayStart (e.g. 4 AM) ---- */
function dayKey(ts) {
  const d = new Date(ts);
  const shift = d.getHours() < S().dayStart ? 1 : 0;
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - shift);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function keyOf(y, m, d) {
  const x = new Date(y, m, d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function keyDate(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function dayBounds(k) {
  const d = keyDate(k);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate(), S().dayStart).getTime(),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, S().dayStart).getTime(),
  };
}
function splitByDay(a, b) {
  const out = [];
  while (a < b) {
    const e = Math.min(b, dayBounds(dayKey(a)).end);
    out.push([a, e]);
    a = e;
  }
  return out;
}
const todayKey = () => dayKey(Date.now());
function addDays(k, n) {
  const d = keyDate(k);
  return keyOf(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/* =========================================================================
   Persistence
   ========================================================================= */

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.jangal.save(db), 250);
}
function saveNow() {
  clearTimeout(saveTimer);
  window.jangal.saveSync(db);
}

function seed() {
  return {
    version: 2,
    subjects: [
      { id: uid(), name: 'Mathematics', color: 0 },
      { id: uid(), name: 'Science', color: 1 },
      { id: uid(), name: 'English', color: 2 },
    ],
    sessions: [],
    tasks: [],
    exams: [],
    badges: {},
    tasksCleared: 0,
    settings: { ...DEFAULT_SETTINGS },
    selected: null,
    mode: 'pomodoro',
    active: null,
  };
}

// Bring data from any earlier version (or a restored backup) up to the current shape.
function normalizeDb() {
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  db.subjects = Array.isArray(db.subjects) ? db.subjects : [];
  db.tasks = Array.isArray(db.tasks) ? db.tasks : [];
  db.exams = Array.isArray(db.exams) ? db.exams : [];
  db.badges = db.badges && typeof db.badges === 'object' ? db.badges : {};
  db.tasksCleared = Number(db.tasksCleared) || 0;
  db.bossesCleared = Number(db.bossesCleared) || 0;
  // every exam is a boss: hp = study hours needed, created = when the fight started
  db.exams.forEach((e) => { e.hp = Number(e.hp) || DEFAULT_BOSS_HP; e.created = e.created || Date.now(); });
  // 2.2 introduced the Zine look; switch to it once, after that the choice in Settings sticks
  if (!db.settings.zineIntro) { db.settings.theme = 'zine'; db.settings.zineIntro = true; }
  db.version = 2;
  if (!db.selected || !subjectById(db.selected) || subjectById(db.selected).archived) {
    db.selected = activeSubjects()[0]?.id || null;
  }
}

async function loadDb() {
  const data = await window.jangal.load();
  db = data && Array.isArray(data.sessions) ? data : seed();
  normalizeDb();
  T.mode = db.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro';
  // Recover a session that was running when the app closed unexpectedly.
  if (db.active && db.active.start && db.active.seen > db.active.start) {
    const got = recordRange(db.active.subjectId, db.active.start, db.active.seen);
    if (got >= MIN) setTimeout(() => toast(`Recovered ${fmtHM(got)} from your last session`), 600);
  }
  db.active = null;
  checkRewards(true); // badges already earned by existing history unlock quietly
  ui.ready = true;
  save();
}

/* =========================================================================
   Subjects & sessions
   ========================================================================= */

const subjectById = (id) => db.subjects.find((s) => s.id === id);
const activeSubjects = () => db.subjects.filter((s) => !s.archived);
const colorOf = (id) => {
  const s = subjectById(id);
  return s ? PALETTE[s.color % PALETTE.length] : '#8d8c86';
};
const nameOf = (id) => subjectById(id)?.name || 'Unknown';

function recordRange(subjectId, a, b) {
  if (b - a < 1000) return 0;
  splitByDay(a, b).forEach(([s, e]) => db.sessions.push({ id: uid(), s: subjectId, a: s, b: e }));
  dayCache = null;
  save();
  if (ui.ready) setTimeout(checkRewards, 0);
  return b - a;
}

function days() {
  if (dayCache) return dayCache;
  const m = new Map();
  for (const x of db.sessions) {
    const k = dayKey(x.a);
    let d = m.get(k);
    if (!d) m.set(k, (d = { total: 0, by: {}, list: [] }));
    const dur = x.b - x.a;
    d.total += dur;
    d.by[x.s] = (d.by[x.s] || 0) + dur;
    d.list.push(x);
  }
  dayCache = m;
  return m;
}

// The focus time currently on the clock and not yet saved.
function liveChunk() {
  if (!T.running || T.phase !== 'focus' || !db.selected) return null;
  return { id: 'live', s: db.selected, a: T.runStart, b: Date.now(), live: true };
}

function dayData(k) {
  const base = days().get(k) || { total: 0, by: {}, list: [] };
  const live = liveChunk();
  if (!live) return base;
  const parts = splitByDay(live.a, live.b).filter(([a]) => dayKey(a) === k);
  if (!parts.length) return base;
  const d = { total: base.total, by: { ...base.by }, list: [...base.list] };
  parts.forEach(([a, b]) => {
    d.total += b - a;
    d.by[live.s] = (d.by[live.s] || 0) + (b - a);
    d.list.push({ ...live, a, b });
  });
  return d;
}
const totalOf = (k) => dayData(k).total;

function streakInfo() {
  const minMs = MIN;
  let k = todayKey();
  if (totalOf(k) < minMs) k = addDays(k, -1);
  let current = 0;
  while (totalOf(k) >= minMs) { current++; k = addDays(k, -1); }
  // best streak across all history
  const keys = [...days().keys()].filter((x) => totalOf(x) >= minMs).sort();
  let best = 0, run = 0, prev = null;
  for (const x of keys) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  return { current, best: Math.max(best, current) };
}

/* =========================================================================
   Timer engine
   ========================================================================= */

const phaseLength = () => (T.phase === 'focus' ? S().focus : T.phase === 'short' ? S().short : S().long) * MIN;
const elapsed = () => T.elapsedBefore + (T.running ? Date.now() - T.runStart : 0);

function commitRun() {
  // Save the focus time from the current run and start a new run from now.
  if (!T.running || T.phase !== 'focus' || !db.selected) return 0;
  const now = Date.now();
  const saved = recordRange(db.selected, T.runStart, now);
  T.elapsedBefore += now - T.runStart;
  T.runStart = now;
  return saved;
}

function start(silent = false) {
  if (T.running) return;
  if (T.phase === 'focus' && !db.selected) {
    if (!activeSubjects().length) { toast('Add a subject first'); switchView('subjects'); return; }
    db.selected = activeSubjects()[0].id;
  }
  T.running = true;
  T.runStart = Date.now();
  heartbeat();
  if (!silent) sound('start');
  renderAll();
}

function pause() {
  if (!T.running) return;
  commitRun();
  T.elapsedBefore = elapsed();
  T.running = false;
  db.active = null;
  save();
  renderAll();
}

function toggle() { T.running ? pause() : start(); }

function stopAndSave() {
  const wasFocus = T.phase === 'focus';
  const before = T.elapsedBefore + (T.running ? Date.now() - T.runStart : 0);
  if (T.running) commitRun();
  T.running = false;
  T.elapsedBefore = 0;
  db.active = null;
  if (T.mode === 'pomodoro') T.phase = 'focus';
  save();
  if (wasFocus && before >= MIN) toast(`Saved ${fmtHM(before)} of ${nameOf(db.selected)}`);
  renderAll();
}

function setPhase(phase, autoStart) {
  T.phase = phase;
  T.elapsedBefore = 0;
  T.running = false;
  if (autoStart) start(true);
  renderAll();
}

function completePhase(skipped = false) {
  if (T.phase === 'focus') {
    const done = elapsed();
    if (T.running) commitRun();
    T.running = false;
    db.active = null;
    if (!skipped || done >= phaseLength() / 2) T.cycle++;
    const next = T.cycle > 0 && T.cycle % S().longEvery === 0 ? 'long' : 'short';
    if (!skipped) {
      sound('done');
      notify('Focus session complete', `Nice work. Take a ${next === 'long' ? S().long : S().short}-minute break.`);
    }
    setPhase(next, S().autoBreaks);
  } else {
    if (T.phase === 'long') T.cycle = 0;
    if (!skipped) {
      sound('break');
      notify('Break is over', `Ready for ${S().focus} minutes of ${nameOf(db.selected)}?`);
    }
    setPhase('focus', S().autoFocus);
  }
  save();
}

function skip() {
  if (T.mode === 'stopwatch') return;
  completePhase(true);
}

function setMode(mode) {
  if (mode === T.mode) return;
  if (T.running || T.elapsedBefore > 0) { toast('Stop the timer before switching modes'); return; }
  T.mode = mode;
  T.phase = 'focus';
  db.mode = mode;
  save();
  renderAll();
}

function selectSubject(id) {
  if (id === db.selected) return;
  if (T.running && T.phase === 'focus') commitRun();
  db.selected = id;
  if (T.running) heartbeat();
  save();
  renderAll();
}

let lastBeat = 0;
function heartbeat() {
  if (T.running && T.phase === 'focus' && db.selected) {
    db.active = { subjectId: db.selected, start: T.runStart, seen: Date.now() };
    lastBeat = Date.now();
    save();
    if (ui.ready) checkRewards(); // picks up goals and streaks reached mid-session
  }
}

/* ---- sound & notifications ---- */
let audioCtx = null;
function sound(kind) {
  if (!S().sound) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const vol = (S().volume / 100) * 0.35;
    const notes = { start: [660], done: [784, 988, 1175, 1568], break: [988, 784], test: [784, 988, 1175] }[kind] || [880];
    const step = kind === 'start' ? 0 : 0.16;
    notes.forEach((f, i) => {
      const t = audioCtx.currentTime + i * step;
      const o = audioCtx.createOscillator();
      const o2 = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      o2.type = 'sine'; o2.frequency.value = f * 2.01;
      const peak = kind === 'start' ? vol * 0.35 : vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'start' ? 0.25 : 1.4));
      const g2 = audioCtx.createGain();
      g2.gain.value = 0.18;
      o.connect(g); o2.connect(g2).connect(g); g.connect(audioCtx.destination);
      o.start(t); o2.start(t); o.stop(t + 1.5); o2.stop(t + 1.5);
    });
  } catch { /* audio unavailable */ }
}
function notify(title, body) {
  if (S().notify && !document.hasFocus()) window.jangal.notify(title, body);
}

/* =========================================================================
   Rendering — timer
   ========================================================================= */

const RING_R = 146;
const RING_C = 2 * Math.PI * RING_R;

function buildRingTicks() {
  const g = $('#ringTicks');
  let html = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r1 = i % 5 === 0 ? 124 : 128, r2 = 133;
    html += `<line x1="${160 + r1 * Math.cos(a)}" y1="${160 + r1 * Math.sin(a)}" x2="${160 + r2 * Math.cos(a)}" y2="${160 + r2 * Math.sin(a)}" />`;
  }
  g.innerHTML = html;
  $('#ringProgress').style.strokeDasharray = RING_C;
}

// The last 40 seconds of a running focus session.
const FINAL_MS = 40000;
function finalCount() {
  if (!S().drama || T.mode !== 'pomodoro' || T.phase !== 'focus' || !T.running) return false;
  const left = phaseLength() - elapsed();
  return left > 0 && left <= FINAL_MS;
}
// A low double thump, once a second, louder as the end gets close.
function heartbeatSound(leftMs) {
  if (!S().sound) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const vol = (S().volume / 100) * (leftMs <= 10000 ? 0.9 : 0.55);
    [0, 0.2].forEach((at, i) => {
      const t = audioCtx.currentTime + at;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(i ? 62 : 74, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * (i ? 0.7 : 1), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.25);
    });
  } catch { /* audio unavailable */ }
}

function renderTimer() {
  const e = elapsed();
  let text, frac, label;
  if (T.mode === 'pomodoro') {
    const len = phaseLength();
    text = fmtClock(len - e);
    frac = Math.min(1, e / len);
    label = { focus: 'Focus', short: 'Short break', long: 'Long break' }[T.phase];
    if (!T.running && e > 0) label = 'Paused';
  } else {
    text = fmtClock(e);
    frac = Math.min(1, totalOf(todayKey()) / (S().goalMin * MIN));
    label = T.running ? 'Studying' : e > 0 ? 'Paused' : 'Stopwatch';
  }
  if (text !== ui.lastTimeText) {
    const el = $('#timeDisplay');
    // one box per character so the clock does not wobble in fonts without fixed-width digits
    el.innerHTML = [...text].map((c) => `<span class="${c === ':' ? 'sep' : 'dg'}">${c}</span>`).join('');
    el.classList.toggle('long', text.length > 5);
    ui.lastTimeText = text;
    if (finalCount()) heartbeatSound(phaseLength() - e);
    const phaseName = T.mode === 'stopwatch' ? 'Studying' : label;
    document.title = T.running || e > 0 ? `${text} · ${phaseName} — Jangal` : 'Jangal';
  }
  document.body.classList.toggle('final-count', finalCount());
  $('#phaseLabel').textContent = Zine.phase(finalCount() ? 'Final seconds' : label);
  $('#ringProgress').style.strokeDashoffset = RING_C * (1 - frac);
  document.body.classList.toggle('phase-break', T.phase !== 'focus');
  const prog = T.mode === 'pomodoro' && (T.running || e > 0) ? Math.round(frac * 200) / 200 : -1;
  if (prog !== ui.lastProgress) { ui.lastProgress = prog; window.jangal.progress(prog); }
}

function renderTimerChrome() {
  // mode switch
  $$('#modeSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === T.mode));
  positionThumb();
  // start button
  $('#btnStart').innerHTML = icon(T.running ? 'pause' : 'play');
  $('#btnStart').setAttribute('aria-label', T.running ? 'Pause' : 'Start');
  $('#btnSkip').disabled = T.mode === 'stopwatch';
  $('#btnReset').disabled = !T.running && T.elapsedBefore === 0;
  // subject pill
  const sub = subjectById(db.selected);
  const pill = $('#subjectPill');
  pill.querySelector('.dot').style.background = sub ? colorOf(sub.id) : '';
  pill.querySelector('.name').textContent = T.phase !== 'focus' ? 'Rest your eyes' : sub ? sub.name : 'Pick a subject';
  // cycle dots
  const dots = $('#cycleDots');
  if (T.mode === 'pomodoro') {
    const n = S().longEvery;
    const doneCount = T.cycle % n === 0 && T.phase === 'long' ? n : T.cycle % n;
    dots.innerHTML = Array.from({ length: n }, (_, i) =>
      `<span class="${i < doneCount ? 'done' : i === doneCount && T.phase === 'focus' ? 'current' : ''}"></span>`).join('');
  } else dots.innerHTML = '';
  // subject chips
  $('#subjectRow').innerHTML = activeSubjects().map((s) =>
    `<button class="chip ${s.id === db.selected ? 'active' : ''}" data-id="${s.id}" style="--chip-color:${colorOf(s.id)}">
       <span class="dot" style="background:${colorOf(s.id)}"></span>${esc(s.name)}</button>`).join('') +
    `<button class="chip add" data-add="1">${icon('plus')}Subject</button>`;
  renderAmbient();
}

function renderAmbient() {
  const kind = S().ambient;
  const btn = $('#btnAmbient');
  btn.classList.toggle('on', kind !== 'off');
  btn.innerHTML = `${icon(kind === 'off' ? 'mute' : 'volume', 16)}<span>${kind === 'off' ? 'Sound' : ambientName(kind)}</span>`;
  $('#ambientPop').innerHTML = AMBIENT_KINDS.map(([id, name]) =>
    `<button class="opt ${id === kind ? 'sel' : ''}" data-ambient="${id}"><span>${name}</span>${id === kind ? icon('check', 15) : ''}</button>`).join('') +
    `<div class="pop-foot"><span>Volume</span><input type="range" class="range" min="5" max="100" value="${S().ambientVol}" id="ambientVol" aria-label="Ambient volume" /></div>
     <div class="pop-note">Plays while a focus session is running.</div>`;
}

// Ambient sound follows the timer: on during focus, silent on breaks and when paused.
let previewTimer = null;
function syncAmbient() {
  if (previewTimer) return;
  const on = T.running && T.phase === 'focus';
  Ambient.set(on ? S().ambient : 'off', S().ambientVol);
}
function pickAmbient(kind) {
  S().ambient = kind;
  save();
  clearTimeout(previewTimer);
  previewTimer = null;
  if (kind !== 'off' && !(T.running && T.phase === 'focus')) {
    // short preview so you can hear what you picked
    Ambient.set(kind, S().ambientVol);
    previewTimer = setTimeout(() => { previewTimer = null; syncAmbient(); }, 4000);
  } else syncAmbient();
  renderAmbient();
  if (ui.view === 'settings') renderSettings();
}

function applyTheme() {
  const id = THEMES.some((t) => t[0] === S().theme) ? S().theme : 'zine';
  document.documentElement.dataset.theme = id;
  Zine.apply(id);
  if (ui.view && VIEW_META[ui.view]) $('#viewTitle').textContent = Zine.title(ui.view, VIEW_META[ui.view][0]);
  const cs = getComputedStyle(document.documentElement);
  const chrome = { bg: cs.getPropertyValue('--bg').trim(), fg: cs.getPropertyValue('--text-secondary').trim() };
  S().chrome = chrome; // remembered so the window opens in the right colour next time
  window.jangal.setChrome(chrome);
}

function positionThumb() {
  const active = $('#modeSwitch button.active');
  const thumb = $('#modeSwitch .seg-thumb');
  if (!active || !active.offsetWidth) return;
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft - 4}px)`;
}

/* =========================================================================
   Rendering — today panel
   ========================================================================= */

function renderToday() {
  const k = todayKey();
  ui.todayKey = k;
  const d = dayData(k);
  const goal = S().goalMin * MIN;
  const pct = Math.round((d.total / goal) * 100);
  $('#todayDate').textContent = keyDate(k).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  $('#todayTotal').textContent = fmtHM(d.total);
  $('#goalFill').style.width = `${Math.min(100, pct)}%`;
  $('#goalFill').classList.toggle('met', pct >= 100);
  $('#goalPct').textContent = pct >= 100 ? 'Goal reached' : `${pct}%`;
  $('#goalText').textContent = pct >= 100 ? `· ${fmtGoal(S().goalMin)}` : `of ${fmtGoal(S().goalMin)} goal`;

  const subs = Object.entries(d.by).sort((a, b) => b[1] - a[1]);
  $('#todaySubjects').innerHTML = subs.length
    ? subs.map(([id, ms]) => `<div class="ts-row"><span class="dot" style="background:${colorOf(id)}"></span><span class="name">${esc(nameOf(id))}</span><span class="val">${fmtHM(ms)}</span></div>`).join('')
    : '<div class="empty">Nothing yet today. Press start when you sit down to study.</div>';

  renderTimeline(k, d);
  renderWeek();
  renderUpNext();
  const st = streakInfo();
  $('#sideStreak').textContent = st.current;
  $('.streak-card').classList.toggle('cold', st.current === 0);
}

function renderTimeline(k, d) {
  const el = $('#todayTimeline');
  const { start: dayStart } = dayBounds(k);
  const list = [...d.list].sort((a, b) => a.a - b.a);
  const now = Date.now();
  let from, to;
  if (list.length) {
    from = new Date(list[0].a); from.setMinutes(0, 0, 0); from = from.getTime();
    to = Math.max(list[list.length - 1].b, Math.min(now, dayStart + 24 * HOUR));
    to = Math.ceil(to / HOUR) * HOUR;
  } else {
    from = new Date(now); from.setMinutes(0, 0, 0); from = from.getTime() - 2 * HOUR;
    to = from + 6 * HOUR;
  }
  if (to - from < 6 * HOUR) to = from + 6 * HOUR;
  const span = to - from;
  const blocks = list.map((x) => {
    const left = ((x.a - from) / span) * 100;
    const width = ((x.b - x.a) / span) * 100;
    return `<div class="tl-block ${x.live ? 'live' : ''}" style="left:${left}%;width:${width}%;background:${colorOf(x.s)}"
      data-tip="${esc(nameOf(x.s))}|${fmtTime(x.a)} – ${x.live ? 'now' : fmtTime(x.b)}|${fmtHM(x.b - x.a)}"></div>`;
  }).join('');
  const hrs = span / HOUR;
  const step = hrs <= 8 ? 2 : hrs <= 14 ? 3 : 4;
  const labels = [];
  for (let t = from; t <= to; t += step * HOUR) labels.push(`<span>${fmtHourLabel(new Date(t).getHours())}</span>`);
  el.innerHTML = `<div class="tl-track">${blocks}</div><div class="tl-axis">${labels.join('')}</div>`;
}

function renderWeek() {
  const k = todayKey();
  const keys = Array.from({ length: 7 }, (_, i) => addDays(k, i - 6));
  const vals = keys.map(totalOf);
  const max = Math.max(S().goalMin * MIN, ...vals);
  $('#weekTotal').textContent = fmtHM(vals.reduce((a, b) => a + b, 0));
  $('#weekBars').innerHTML = keys.map((x, i) => {
    const h = (vals[i] / max) * 100;
    const date = keyDate(x);
    return `<div class="wb ${x === k ? 'today' : ''}" data-day="${x}">
      <div class="wb-col"><div class="wb-bar ${vals[i] < MIN ? 'zero' : ''}" style="height:${vals[i] < MIN ? 2 : Math.max(3, h)}%"></div></div>
      <div class="wb-label">${date.toLocaleDateString([], { weekday: 'narrow' })}</div></div>`;
  }).join('');
}

/* =========================================================================
   Rendering — insights
   ========================================================================= */

function bin(ms) {
  const g = S().goalMin * MIN;
  if (ms < MIN) return 0;
  if (ms < g * 0.25) return 1;
  if (ms < g * 0.5) return 2;
  if (ms < g * 0.75) return 3;
  if (ms < g) return 4;
  return 5;
}

function monthKeys(y, m) {
  const n = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => keyOf(y, m, i + 1));
}

function renderStats() {
  const { y, m } = ui.month;
  const now = new Date();
  const tk = todayKey();
  const isCurrent = keyDate(tk).getFullYear() === y && keyDate(tk).getMonth() === m;
  $('#monthLabel').textContent = new Date(y, m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('#nextMonth').disabled = new Date(y, m + 1, 1) > now;
  $('#thisMonth').style.visibility = isCurrent ? 'hidden' : 'visible';

  const keys = monthKeys(y, m);
  const pastKeys = keys.filter((k) => k <= tk);
  const vals = keys.map(totalOf);
  const total = vals.reduce((a, b) => a + b, 0);
  const goal = S().goalMin * MIN;

  // compare against the same span of the previous month
  const prevKeys = monthKeys(y, m - 1).slice(0, isCurrent ? pastKeys.length : undefined);
  const prevTotal = prevKeys.reduce((a, k) => a + totalOf(k), 0);
  const prevName = new Date(y, m - 1, 1).toLocaleDateString([], { month: 'short' });
  let delta = '';
  if (prevTotal > 0) {
    const p = Math.round(((total - prevTotal) / prevTotal) * 100);
    delta = `<span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs ${prevName}`;
  } else delta = total ? 'first month tracked' : '&nbsp;';

  const daysCount = Math.max(1, pastKeys.length);
  let bestIdx = -1;
  vals.forEach((v, i) => { if (v > 0 && (bestIdx < 0 || v > vals[bestIdx])) bestIdx = i; });
  const metDays = vals.filter((v) => v >= goal).length;
  const studiedDays = vals.filter((v) => v >= MIN).length;
  const st = streakInfo();

  const kpi = (label, value, sub) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
  $('#kpis').innerHTML =
    kpi('Total this month', fmtHM(total), delta) +
    kpi('Daily average', fmtHM(total / daysCount), `across ${daysCount} day${daysCount === 1 ? '' : 's'}`) +
    kpi('Best day', bestIdx >= 0 ? fmtHM(vals[bestIdx]) : '—', bestIdx >= 0 ? keyDate(keys[bestIdx]).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : 'no study yet') +
    kpi('Goal reached', `${metDays}<span class="muted" style="font-size:16px"> / ${daysCount}</span>`, `${studiedDays} day${studiedDays === 1 ? '' : 's'} studied`) +
    kpi('Current streak', `${st.current} day${st.current === 1 ? '' : 's'}`, `best ever: ${st.best}`);

  renderCalendar(y, m, keys, tk);
  renderSubjectBars(keys, total);
  renderDailyChart(keys, vals, tk);
  renderDailyTable(keys, vals, tk);
  renderYear(y, m, tk);
}

function rampLegend() {
  const g = S().goalMin;
  return `<span class="lbl">0</span>${SEQ.map((c) => `<span class="sw" style="background:${c}"></span>`).join('')}<span class="lbl">${fmtGoal(g)}+</span>`;
}

function renderCalendar(y, m, keys, tk) {
  $('#calLegend').innerHTML = rampLegend();
  const first = new Date(y, m, 1).getDay(); // 0 = Sunday
  const lead = (first + 6) % 7; // Monday-first
  const dows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = dows.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  html += '<div class="cal-day blank"></div>'.repeat(lead);
  keys.forEach((k, i) => {
    const v = totalOf(k);
    const b = bin(v);
    const future = k > tk;
    const cls = ['cal-day', future ? 'future' : '', k === tk ? 'today' : '', b >= 4 ? 'ink-hi' : '', b === 5 ? 'goal-met' : ''].join(' ');
    html += `<div class="${cls}" style="background:${SEQ[future ? 0 : b]}" data-day="${future ? '' : k}" ${future ? '' : 'tabindex="0"'}>
      <span class="cal-num">${i + 1}</span><span class="cal-val">${future ? '' : fmtShort(v)}</span></div>`;
  });
  $('#calendar').innerHTML = html;
}

function renderSubjectBars(keys, total) {
  const by = {};
  keys.forEach((k) => Object.entries(dayData(k).by).forEach(([id, ms]) => (by[id] = (by[id] || 0) + ms)));
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  $('#subjMonthTotal').textContent = rows.length ? `${rows.length} subject${rows.length === 1 ? '' : 's'}` : '';
  $('#subjectBars').innerHTML = rows.length
    ? rows.map(([id, ms]) => `<div class="sb-row">
        <div class="sb-name"><span class="dot" style="background:${colorOf(id)}"></span><span>${esc(nameOf(id))}</span></div>
        <div class="sb-val">${fmtHM(ms)}<small>${Math.round((ms / total) * 100)}%</small></div>
        <div class="sb-track"><div class="sb-fill" style="width:${(ms / max) * 100}%;background:${colorOf(id)}"></div></div></div>`).join('')
    : '<div class="empty">No study time recorded this month.</div>';
}

function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceStep(maxH) {
  for (const s of [0.5, 1, 2, 3, 4, 6]) if (maxH / s <= 5) return s;
  return 8;
}

function renderDailyChart(keys, vals, tk) {
  const el = $('#dailyChart');
  const W = el.clientWidth || 800, H = 230;
  const L = 40, R = 46, Tp = 12, B = 26;
  const goalH = S().goalMin / 60;
  const maxH = Math.max(goalH * 1.15, (Math.max(...vals) / HOUR) * 1.1, 1);
  const step = niceStep(maxH);
  const top = Math.ceil(maxH / step) * step;
  const iw = W - L - R, ih = H - Tp - B;
  const yS = (h) => Tp + ih - (h / top) * ih;
  const band = iw / keys.length;
  const bw = Math.max(4, Math.min(22, band * 0.62));

  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${yS(v)}" y2="${yS(v)}" /><text x="${L - 10}" y="${yS(v) + 4}" text-anchor="end">${v}h</text>`;
  }
  let bars = '';
  keys.forEach((k, i) => {
    const h = vals[i] / HOUR;
    const x = L + i * band + (band - bw) / 2;
    const y = yS(h);
    const cls = k === tk ? 'bar today-bar' : vals[i] >= S().goalMin * MIN ? 'bar met' : 'bar';
    const day = i + 1;
    const showLbl = band >= 24 || day === 1 || day % 5 === 0;
    const fut = k > tk;
    bars += `<g class="col ${fut ? 'future' : ''}" data-day="${fut ? '' : k}"><rect class="hit" x="${L + i * band}" y="${Tp}" width="${band}" height="${ih}" />
      ${vals[i] >= MIN ? `<path class="${cls}" d="${barPath(x, y, bw, yS(0) - y)}" />` : ''}
      ${showLbl ? `<text x="${L + i * band + band / 2}" y="${H - 6}" text-anchor="middle">${day}</text>` : ''}</g>`;
  });
  const gy = yS(goalH);
  el.innerHTML = `<svg width="${W}" height="${H}" role="img" aria-label="Daily study hours this month">
    <g class="grid">${grid}</g>${bars}
    <line class="goal-line" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}" />
    <text x="${W - R + 6}" y="${gy + 4}" style="fill:var(--text-secondary)">goal</text></svg>`;
}

function renderDailyTable(keys, vals, tk) {
  const goal = S().goalMin * MIN;
  const rows = keys.filter((k) => k <= tk).map((k, i) => {
    const d = dayData(k);
    const top = Object.entries(d.by).sort((a, b) => b[1] - a[1])[0];
    return `<tr><td>${keyDate(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td>
      <td class="num">${fmtHM(vals[i])}</td><td>${vals[i] >= goal ? '✓ Met' : '—'}</td><td>${top ? esc(nameOf(top[0])) : '—'}</td></tr>`;
  }).reverse();
  $('#dailyTable').innerHTML = `<table><thead><tr><th>Date</th><th class="num">Studied</th><th>Goal</th><th>Top subject</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  $('#dailyChart').classList.toggle('hidden', ui.showTable);
  $('#dailyTable').classList.toggle('hidden', !ui.showTable);
  $('#toggleTable').textContent = ui.showTable ? 'Show chart' : 'Show table';
}

function renderYear(y, viewM, tk) {
  $('#yearTitle').textContent = `${y} at a glance`;
  // GitHub-style heatmap
  const jan1 = new Date(y, 0, 1);
  const lead = (jan1.getDay() + 6) % 7;
  const ndays = (new Date(y + 1, 0, 1) - jan1) / 86400000;
  const cell = 13, gap = 3, L = 30, Tp = 18;
  const weeks = Math.ceil((ndays + lead) / 7);
  let rects = '', months = '';
  let yearTotal = 0;
  for (let i = 0; i < Math.round(ndays); i++) {
    const k = keyOf(y, 0, 1 + i);
    const col = Math.floor((i + lead) / 7), row = (i + lead) % 7;
    const v = k > tk ? 0 : totalOf(k);
    yearTotal += v;
    const x = L + col * (cell + gap), yy = Tp + row * (cell + gap);
    const fut = k > tk;
    rects += `<rect class="c${fut ? ' future' : ''}" data-day="${fut ? '' : k}" x="${x}" y="${yy}" width="${cell}" height="${cell}" style="fill:${SEQ[bin(v)]}"/>`;
    const d = keyDate(k);
    if (d.getDate() === 1) {
      months += `<text x="${x}" y="11" ${d.getMonth() === viewM ? 'style="fill:var(--text-primary);font-weight:600"' : ''}>${d.toLocaleDateString([], { month: 'short' })}</text>`;
    }
  }
  const dl = ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, r) => t ? `<text x="0" y="${Tp + r * (cell + gap) + 10}">${t}</text>` : '').join('');
  const W = L + weeks * (cell + gap);
  $('#yearHeat').innerHTML = `<svg width="${W}" height="${Tp + 7 * (cell + gap)}" role="img" aria-label="Study heatmap for ${y}">${months}${dl}${rects}</svg>`;
  $('#yearTotal').textContent = `${fmtHM(yearTotal)} this year`;

  // monthly totals
  const el = $('#monthChart');
  const mt = Array.from({ length: 12 }, (_, mi) => monthKeys(y, mi).reduce((a, k) => a + (k > tk ? 0 : totalOf(k)), 0));
  const Wc = el.clientWidth || 800, H = 170, Lc = 40, Rc = 46, Tc = 22, Bc = 24;
  const maxH = Math.max(1, Math.max(...mt) / HOUR * 1.12);
  const stepRaw = maxH / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= stepRaw);
  const top = Math.ceil(maxH / step) * step;
  const iw = Wc - Lc - Rc, ih = H - Tc - Bc;
  const yS = (h) => Tc + ih - (h / top) * ih;
  const band = iw / 12, bw = Math.min(44, band * 0.58);
  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) grid += `<line x1="${Lc}" x2="${Wc - Rc}" y1="${yS(v)}" y2="${yS(v)}" /><text x="${Lc - 10}" y="${yS(v) + 4}" text-anchor="end">${+v.toFixed(1)}h</text>`;
  let bars = '';
  mt.forEach((v, mi) => {
    const h = v / HOUR, x = Lc + mi * band + (band - bw) / 2, yy = yS(h);
    const sel = mi === viewM;
    bars += `<g class="col" data-month="${mi}"><rect class="hit" x="${Lc + mi * band}" y="${Tc}" width="${band}" height="${ih}" />
      ${v >= MIN ? `<path class="bar ${sel ? 'today-bar' : ''}" d="${barPath(x, yy, bw, yS(0) - yy)}" />` : ''}
      ${sel && v >= MIN ? `<text x="${x + bw / 2}" y="${yy - 7}" text-anchor="middle" style="fill:var(--text-primary);font-weight:600">${fmtHM(v)}</text>` : ''}
      <text x="${Lc + mi * band + band / 2}" y="${H - 6}" text-anchor="middle" ${sel ? 'style="fill:var(--text-primary);font-weight:600"' : ''}>${new Date(y, mi, 1).toLocaleDateString([], { month: 'short' })}</text></g>`;
  });
  el.innerHTML = `<svg width="${Wc}" height="${H}" role="img" aria-label="Monthly study totals for ${y}"><g class="grid">${grid}</g>${bars}</svg>`;
  el.dataset.year = y;
}

/* =========================================================================
   Day detail modal
   ========================================================================= */

function openDay(k) {
  if (!k || k > todayKey()) return;
  const render = () => {
    const d = dayData(k);
    const list = [...d.list].sort((a, b) => a.a - b.a);
    const subs = Object.entries(d.by).sort((a, b) => b[1] - a[1]);
    const max = subs[0]?.[1] || 1;
    const opts = activeSubjects().map((s) => `<option value="${s.id}" ${s.id === db.selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#modalBody').innerHTML = `
      <div class="modal-head"><div>
        <h2>${keyDate(k).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
        <div class="muted">${fmtHM(d.total)} studied · ${Math.round((d.total / (S().goalMin * MIN)) * 100)}% of goal</div></div>
        <button class="icon-btn" data-close>${icon('x')}</button></div>
      <div class="subject-bars">${subs.map(([id, ms]) => `<div class="sb-row">
        <div class="sb-name"><span class="dot" style="background:${colorOf(id)}"></span><span>${esc(nameOf(id))}</span></div>
        <div class="sb-val">${fmtHM(ms)}</div>
        <div class="sb-track"><div class="sb-fill" style="width:${(ms / max) * 100}%;background:${colorOf(id)}"></div></div></div>`).join('') || '<div class="empty">No sessions this day.</div>'}</div>
      ${list.length ? `<h3 style="margin-top:22px">Sessions</h3>` : ''}
      <div class="session-list">${list.map((x) => `<div class="session-item">
        <span class="dot" style="background:${colorOf(x.s)}"></span><span>${esc(nameOf(x.s))}</span>
        <span class="t">${fmtTime(x.a)} – ${x.live ? 'now' : fmtTime(x.b)}</span>
        <span class="d">${fmtHM(x.b - x.a)}${x.live ? '' : ` <button data-del="${x.id}" title="Delete session">${icon('trash')}</button>`}</span></div>`).join('')}</div>
      <h3 style="margin-top:22px">Add time manually</h3>
      <form class="add-manual" id="manualForm">
        <select class="field" name="s" required>${opts}</select>
        <input class="field" name="t" type="time" value="18:00" required />
        <input class="field" name="m" type="number" min="1" max="720" placeholder="Minutes" required />
        <button class="btn primary" type="submit">Add</button>
      </form>`;
    $('#modalBody [data-close]').onclick = closeModal;
    $$('#modalBody [data-del]').forEach((b) => (b.onclick = () => {
      db.sessions = db.sessions.filter((x) => x.id !== b.dataset.del);
      dayCache = null; save(); render(); refreshViews();
    }));
    $('#manualForm').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const [hh, mm] = String(f.get('t')).split(':').map(Number);
      const base = keyDate(k);
      const startTs = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (hh < S().dayStart ? 1 : 0), hh, mm).getTime();
      const dur = Number(f.get('m')) * MIN;
      if (!dur || startTs + dur > Date.now()) { toast('That time is in the future'); return; }
      recordRange(f.get('s'), startTs, startTs + dur);
      toast(`Added ${fmtHM(dur)}`);
      render(); refreshViews();
    };
  };
  render();
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

function confirmDialog({ title, body, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    $('#modalBody').innerHTML = `<div class="modal-head"><div><h2>${title}</h2></div></div>
      <p class="muted" style="line-height:1.55;margin:0 0 22px">${body}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${ok}</button></div>`;
    $('#modal').classList.remove('hidden');
    const done = (v) => { closeModal(); resolve(v); };
    $('#modalBody [data-no]').onclick = () => done(false);
    $('#modalBody [data-yes]').onclick = () => done(true);
    $('#modalBody [data-yes]').focus();
  });
}

/* =========================================================================
   Rendering — subjects page
   ========================================================================= */

let newColor = 0;
function nextFreeColor() {
  const used = new Set(activeSubjects().map((s) => s.color));
  for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
  return activeSubjects().length % PALETTE.length;
}
function swatches(sel, attr) {
  return PALETTE.map((c, i) => `<button type="button" class="swatch ${i === sel ? 'sel' : ''}" style="background:${c}" ${attr}="${i}" title="${PALETTE_NAMES[i]}"></button>`).join('');
}

function renderSubjectsPage() {
  $('#newSubjectColors').innerHTML = swatches(newColor, 'data-new-color');
  const tk = todayKey();
  const d = keyDate(tk);
  const mKeys = monthKeys(d.getFullYear(), d.getMonth());
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(tk, i - 29));
  const allTime = {};
  db.sessions.forEach((x) => (allTime[x.s] = (allTime[x.s] || 0) + (x.b - x.a)));
  const subs = activeSubjects();
  const wKeys = weekKeys(tk);
  $('#subjectList').innerHTML = subs.length ? subs.map((s) => {
    const today = dayData(tk).by[s.id] || 0;
    const week = wKeys.reduce((a, k) => a + (dayData(k).by[s.id] || 0), 0);
    const wg = (s.weekGoalMin || 0) * MIN;
    const month = mKeys.reduce((a, k) => a + (dayData(k).by[s.id] || 0), 0);
    const sp = last30.map((k) => dayData(k).by[s.id] || 0);
    const spMax = Math.max(...sp, 1);
    const sw = 8, sg = 2;
    const spark = sp.map((v, i) => {
      const h = v < MIN ? 2 : Math.max(3, (v / spMax) * 34);
      return `<rect class="${v < MIN ? 'z' : ''}" x="${i * (sw + sg)}" y="${36 - h}" width="${sw}" height="${h}" rx="2" />`;
    }).join('');
    return `<div class="card subject-card" style="--c:${colorOf(s.id)}" data-id="${s.id}">
      <div class="top"><div class="title">${esc(s.name)}</div>
        <div class="actions"><button data-edit="${s.id}" title="Rename">${icon('edit')}</button><button class="del" data-del="${s.id}" title="Delete">${icon('trash')}</button></div></div>
      <div class="stats">
        <div><div class="stat-l">Today</div><div class="stat-v">${fmtHM(today)}</div></div>
        <div><div class="stat-l">This month</div><div class="stat-v">${fmtHM(month)}</div></div>
        <div><div class="stat-l">All time</div><div class="stat-v">${fmtHM(allTime[s.id] || 0)}</div></div>
      </div>
      <svg class="spark" viewBox="0 0 ${30 * (sw + sg) - sg} 36" width="100%" height="36" preserveAspectRatio="none" aria-label="Last 30 days">${spark}</svg>
      <div class="color-pick">${swatches(s.color, 'data-color')}</div>
      <div class="wk-target">
        <div class="wk-head"><span>Weekly target</span>
          <div class="stepper"><button data-wg="-1" aria-label="Lower weekly target">−</button><span class="v">${wg ? fmtGoal(s.weekGoalMin) : 'Off'}</span><button data-wg="1" aria-label="Raise weekly target">+</button></div></div>
        ${wg ? `<div class="wk-bar"><div style="width:${Math.min(100, (week / wg) * 100)}%"></div></div>
          <div class="wk-meta"><b>${fmtHM(week)}</b> of ${fmtGoal(s.weekGoalMin)} this week${week >= wg ? ' · target hit' : ''}</div>` : ''}
      </div></div>`;
  }).join('') : '<div class="empty">No subjects yet. Add the first one above.</div>';
}

/* =========================================================================
   Rendering — settings
   ========================================================================= */

function stepperText(key, v) {
  const unit = $(`.stepper[data-key="${key}"]`).dataset.unit;
  if (unit === 'goal') return fmtGoal(v);
  if (unit === 'hour') return v === 0 ? 'Midnight' : fmtHourLabel(v);
  if (unit === 'sessions') return `${v} sessions`;
  if (unit === 'minOff' && v === 0) return 'Off';
  return `${v} min`;
}
function renderSettings() {
  $('#themeGrid').innerHTML = THEMES.map(([id, name, bg, surf, acc, text]) =>
    `<button class="theme-opt ${id === S().theme ? 'sel' : ''}" data-theme-id="${id}" aria-pressed="${id === S().theme}">
       <span class="theme-prev" style="background:${bg}"><i style="border-color:${acc};background:${surf}"></i><b style="background:${text}"></b><b style="background:${text}"></b></span>${name}</button>`).join('');
  $('#ambientChips').innerHTML = AMBIENT_KINDS.map(([id, name]) =>
    `<button class="${id === S().ambient ? 'sel' : ''}" data-ambient="${id}">${name}</button>`).join('');
  $$('#view-settings .stepper').forEach((el) => {
    const k = el.dataset.key;
    el.innerHTML = `<button data-dir="-1" aria-label="Decrease">−</button><span class="v">${stepperText(k, S()[k])}</span><button data-dir="1" aria-label="Increase">+</button>`;
  });
  $$('#view-settings input[type=checkbox][data-key]').forEach((el) => (el.checked = !!S()[el.dataset.key]));
  $$('#view-settings input[type=range][data-key]').forEach((el) => (el.value = S()[el.dataset.key]));
}

/* =========================================================================
   Navigation & global render
   ========================================================================= */

const VIEW_META = {
  timer: ['Focus', () => (T.mode === 'pomodoro' ? `${S().focus} min focus · ${S().short} min break` : 'Count up — study as long as you like')],
  plan: ['Plan', () => {
    const n = openTasks().length, e = upcomingExams()[0];
    return `${n} open task${n === 1 ? '' : 's'}${e ? ` · next exam ${dueLabel(e.date)[0].toLowerCase()}` : ''}`;
  }],
  rewards: ['Rewards', () => 'Levels and badges earned from your study time'],
  stats: ['Insights', () => 'Your study history, month by month'],
  subjects: ['Subjects', () => `${activeSubjects().length} active`],
  settings: ['Settings', () => 'Saved automatically'],
};

function switchView(v) {
  ui.view = v;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${v}`));
  refreshViews();
}

function refreshViews() {
  const [title, sub] = VIEW_META[ui.view];
  $('#viewTitle').textContent = Zine.title(ui.view, title);
  $('#viewSub').textContent = sub();
  if (ui.view === 'timer') { renderTimerChrome(); renderToday(); }
  if (ui.view === 'stats') renderStats();
  if (ui.view === 'subjects') renderSubjectsPage();
  if (ui.view === 'settings') renderSettings();
  if (ui.view === 'plan') renderPlan();
  if (ui.view === 'rewards') renderRewards();
  // sidebar streak and level are always visible
  renderSideLevel();
  const st = streakInfo();
  $('#sideStreak').textContent = st.current;
  $('.streak-card').classList.toggle('cold', st.current === 0);
}

function renderAll() {
  ui.lastTimeText = '';
  renderTimer();
  refreshViews();
  syncAmbient();
}

/* =========================================================================
   Tooltip & toast
   ========================================================================= */

const tip = $('#tooltip');
function showTip(html, e) {
  tip.innerHTML = html;
  tip.classList.add('show');
  moveTip(e);
}
function moveTip(e) {
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => tip.classList.remove('show');

function dayTip(k) {
  const d = dayData(k);
  const rows = Object.entries(d.by).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([id, ms]) => `<div class="tt-row"><span class="dot" style="background:${colorOf(id)}"></span><span>${esc(nameOf(id))}</span><b>${fmtHM(ms)}</b></div>`).join('');
  return `<div class="tt-title">${keyDate(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
    <div class="tt-total">${fmtHM(d.total)}</div>${rows ? `<div class="tt-rows">${rows}</div>` : ''}`;
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* =========================================================================
   Events
   ========================================================================= */

function bindEvents() {
  $$('.nav-item').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
  $$('#modeSwitch button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('#btnStart').onclick = toggle;
  $('#btnReset').onclick = stopAndSave;
  $('#btnSkip').onclick = skip;
  $('#btnMini').onclick = () => setMini(true);
  $('#btnMiniExit').onclick = () => setMini(false);
  $('#subjectPill').onclick = () => $('#subjectRow .chip')?.focus();
  $('#levelChip').onclick = () => switchView('rewards');

  // ambient sound menu
  $('#btnAmbient').onclick = (e) => { e.stopPropagation(); $('#ambientPop').classList.toggle('hidden'); };
  $('#ambientPop').addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-ambient]');
    if (b) pickAmbient(b.dataset.ambient);
  });
  $('#ambientPop').addEventListener('input', (e) => {
    if (e.target.id !== 'ambientVol') return;
    S().ambientVol = Number(e.target.value);
    save();
    if (Ambient.current !== 'off') Ambient.set(Ambient.current, S().ambientVol);
  });
  document.addEventListener('click', () => $('#ambientPop').classList.add('hidden'));
  bindPlan();

  $('#subjectRow').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (c.dataset.add) { switchView('subjects'); $('#newSubjectName').focus(); return; }
    selectSubject(c.dataset.id);
  });

  // stats navigation
  $('#prevMonth').onclick = () => { ui.month = { y: new Date(ui.month.y, ui.month.m - 1).getFullYear(), m: new Date(ui.month.y, ui.month.m - 1).getMonth() }; renderStats(); };
  $('#nextMonth').onclick = () => { ui.month = { y: new Date(ui.month.y, ui.month.m + 1).getFullYear(), m: new Date(ui.month.y, ui.month.m + 1).getMonth() }; renderStats(); };
  $('#thisMonth').onclick = () => { const d = keyDate(todayKey()); ui.month = { y: d.getFullYear(), m: d.getMonth() }; renderStats(); };
  $('#toggleTable').onclick = () => { ui.showTable = !ui.showTable; renderStats(); };

  // hover + click on anything carrying a day
  document.addEventListener('mouseover', (e) => {
    const dayEl = e.target.closest('[data-day]');
    const tipEl = e.target.closest('[data-tip]');
    const monthEl = e.target.closest('[data-month]');
    if (dayEl && dayEl.dataset.day) showTip(dayTip(dayEl.dataset.day), e);
    else if (tipEl) {
      const [a, b, c] = tipEl.dataset.tip.split('|');
      showTip(`<div class="tt-title">${esc(a)}</div><div class="muted">${b}</div><div class="tt-total" style="margin-top:4px">${c}</div>`, e);
    } else if (monthEl) {
      const y = Number($('#monthChart').dataset.year), mi = Number(monthEl.dataset.month);
      const v = monthKeys(y, mi).reduce((acc, k) => acc + totalOf(k), 0);
      showTip(`<div class="tt-title">${new Date(y, mi, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })}</div><div class="tt-total">${fmtHM(v)}</div><div class="muted">Click to open</div>`, e);
    } else hideTip();
  });
  document.addEventListener('mousemove', (e) => { if (tip.classList.contains('show')) moveTip(e); });
  document.addEventListener('click', (e) => {
    const dayEl = e.target.closest('#calendar [data-day], #dailyChart [data-day], #yearHeat [data-day], #weekBars [data-day]');
    if (dayEl && dayEl.dataset.day) { hideTip(); openDay(dayEl.dataset.day); return; }
    const monthEl = e.target.closest('#monthChart [data-month]');
    if (monthEl) { ui.month = { y: Number($('#monthChart').dataset.year), m: Number(monthEl.dataset.month) }; renderStats(); }
  });
  $('#calendar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.day) openDay(e.target.dataset.day);
  });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

  // subjects page
  $('#addSubjectForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('#newSubjectName').value.trim();
    if (!name) return;
    const s = { id: uid(), name, color: newColor };
    db.subjects.push(s);
    if (!db.selected) db.selected = s.id;
    $('#newSubjectName').value = '';
    newColor = nextFreeColor();
    save();
    toast(`Added ${name}`);
    refreshViews();
  };
  $('#newSubjectColors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-new-color]');
    if (b) { newColor = Number(b.dataset.newColor); renderSubjectsPage(); }
  });
  $('#subjectList').addEventListener('click', async (e) => {
    const wgBtn = e.target.closest('[data-wg]');
    if (wgBtn) {
      const s = subjectById(wgBtn.closest('.subject-card').dataset.id);
      s.weekGoalMin = Math.min(3600, Math.max(0, (s.weekGoalMin || 0) + Number(wgBtn.dataset.wg) * 60));
      save(); renderSubjectsPage(); checkRewards(); return;
    }
    const col = e.target.closest('[data-color]');
    if (col) {
      subjectById(col.closest('.subject-card').dataset.id).color = Number(col.dataset.color);
      save(); renderSubjectsPage(); return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const s = subjectById(ed.dataset.edit);
      const title = ed.closest('.subject-card').querySelector('.title');
      title.outerHTML = `<input class="title-input" value="${esc(s.name)}" maxlength="28" />`;
      const inp = $('#subjectList .title-input');
      inp.focus(); inp.select();
      const commit = () => { const v = inp.value.trim(); if (v) s.name = v; save(); refreshViews(); };
      inp.onblur = commit;
      inp.onkeydown = (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = s.name; inp.blur(); } };
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const s = subjectById(del.dataset.del);
      const ok = await confirmDialog({ title: `Delete “${esc(s.name)}”?`, body: 'It will be removed from your subject list. Study time you already logged stays in your history and stats.', ok: 'Delete', danger: true });
      if (!ok) return;
      if (db.selected === s.id && T.running && T.phase === 'focus') pause();
      s.archived = true;
      if (db.selected === s.id) db.selected = activeSubjects()[0]?.id || null;
      save(); refreshViews();
    }
  });

  // settings
  $('#view-settings').addEventListener('click', (e) => {
    const th = e.target.closest('[data-theme-id]');
    if (th) { S().theme = th.dataset.themeId; applyTheme(); save(); renderSettings(); return; }
    const amb = e.target.closest('[data-ambient]');
    if (amb) { pickAmbient(amb.dataset.ambient); return; }
    const b = e.target.closest('.stepper button');
    if (!b) return;
    const el = b.closest('.stepper');
    const k = el.dataset.key;
    const v = Math.min(Number(el.dataset.max), Math.max(Number(el.dataset.min), S()[k] + Number(b.dataset.dir) * Number(el.dataset.step)));
    S()[k] = v;
    if (k === 'dayStart') dayCache = null;
    save();
    el.querySelector('.v').textContent = stepperText(k, v);
    renderTimer();
  });
  $$('#view-settings input[data-key]').forEach((el) => (el.oninput = () => {
    S()[el.dataset.key] = el.type === 'checkbox' ? el.checked : Number(el.value);
    save();
    if (el.dataset.key === 'ambientVol' && Ambient.current !== 'off') Ambient.set(Ambient.current, S().ambientVol);
  }));
  $('#testSound').onclick = () => { const was = S().sound; S().sound = true; sound('test'); S().sound = was; };
  $('#exportJson').onclick = async () => {
    if (await window.jangal.exportFile(JSON.stringify(db, null, 2), `jangal-backup-${todayKey()}.json`, 'json')) toast('Backup saved');
  };
  $('#exportCsv').onclick = async () => {
    const rows = [['date', 'subject', 'start', 'end', 'minutes']];
    [...db.sessions].sort((a, b) => a.a - b.a).forEach((x) => rows.push([dayKey(x.a), nameOf(x.s), new Date(x.a).toISOString(), new Date(x.b).toISOString(), ((x.b - x.a) / MIN).toFixed(1)]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    if (await window.jangal.exportFile(csv, `jangal-sessions-${todayKey()}.csv`, 'csv')) toast('Sessions exported');
  };
  $('#importJson').onclick = async () => {
    const text = await window.jangal.importFile();
    if (!text) return;
    let data;
    try { data = JSON.parse(text); } catch { toast('That file is not a valid backup'); return; }
    if (!Array.isArray(data.sessions) || !Array.isArray(data.subjects)) { toast('That file is not a Jangal backup'); return; }
    const ok = await confirmDialog({ title: 'Restore this backup?', body: `It has ${data.sessions.length} sessions and ${data.subjects.length} subjects. Your current data will be replaced.`, ok: 'Restore' });
    if (!ok) return;
    if (T.running) pause();
    db = { ...seed(), ...data, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }, active: null };
    dayCache = null; normalizeDb(); applyTheme(); checkRewards(true);
    saveNow(); renderAll(); toast('Backup restored');
  };
  $('#resetData').onclick = async () => {
    const ok = await confirmDialog({ title: 'Erase all data?', body: 'This permanently deletes every session, subject and setting on this laptop. Export a backup first if you might want it back.', ok: 'Erase everything', danger: true });
    if (!ok) return;
    T.running = false; T.elapsedBefore = 0; T.phase = 'focus'; T.cycle = 0;
    db = seed(); dayCache = null; normalizeDb(); applyTheme(); checkRewards(true);
    saveNow(); renderAll(); toast('All data erased');
  };

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); $('#ambientPop').classList.add('hidden'); return; }
    if (e.target.closest('input, select, textarea') || !$('#modal').classList.contains('hidden')) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 's') skip();
    else if (k === 'r') stopAndSave();
    else if (k === 'm') setMini(!document.body.classList.contains('mini'));
    else if (k >= '1' && k <= String(VIEWS.length) && k.length === 1 && !document.body.classList.contains('mini')) switchView(VIEWS[Number(k) - 1]);
  });

  let rz;
  window.addEventListener('resize', () => {
    positionThumb();
    clearTimeout(rz);
    rz = setTimeout(() => { if (ui.view === 'stats') renderStats(); }, 120);
  });

  window.addEventListener('beforeunload', () => {
    if (T.running && T.phase === 'focus') commitRun();
    db.active = null;
    saveNow();
  });
}

async function setMini(on) {
  if (on) switchView('timer');
  document.body.classList.toggle('mini', on);
  await window.jangal.setMini(on);
  positionThumb();
}

/* =========================================================================
   Main loop
   ========================================================================= */

let lastSideRender = 0;
function tick() {
  if (T.running && T.mode === 'pomodoro' && elapsed() >= phaseLength()) {
    // finish exactly at the boundary, even if the tick was late
    T.runStart = Date.now() - (phaseLength() - T.elapsedBefore);
    completePhase(false);
  }
  renderTimer();
  const now = Date.now();
  // Stopwatch mode has no built-in breaks, so nudge every so often.
  if (T.mode === 'stopwatch' && S().stretchEvery > 0) {
    const n = Math.floor(elapsed() / (S().stretchEvery * MIN));
    if (T.running && n > ui.stretchCount) {
      sound('break');
      toast(`${fmtHM(elapsed())} without a break. Stand up, stretch, drink some water.`);
      notify('Time for a short break', `You have been studying for ${fmtHM(elapsed())}.`);
    }
    ui.stretchCount = n;
  }
  if (T.running && now - lastBeat > 30000) heartbeat();
  if (now - lastSideRender > 1000) {
    lastSideRender = now;
    const dayChanged = todayKey() !== ui.todayKey;
    if (ui.view === 'timer' && (T.running || dayChanged)) renderToday();
    if (dayChanged) refreshViews();
  }
}

async function init() {
  hydrateIcons();
  await loadDb();
  applyTheme();
  const d = keyDate(todayKey());
  ui.month = { y: d.getFullYear(), m: d.getMonth() };
  newColor = nextFreeColor();
  buildRingTicks();
  bindEvents();
  renderAll();
  requestAnimationFrame(positionThumb);
  window.jangal.onSuspend(() => {
    if (T.running) { pause(); toast('Paused while your laptop was asleep'); }
  });
  setInterval(tick, 200);
}

init();
