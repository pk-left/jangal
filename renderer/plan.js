'use strict';

/* =========================================================================
   Plan — tasks and exam countdowns.
   db.tasks: { id, text, s (subject id or ''), due ('YYYY-MM-DD' or ''), done, doneAt, created }
   db.exams: { id, name, s, date ('YYYY-MM-DD') }
   ========================================================================= */

const planUi = { showDone: false };

/* ---- Boss battles: every exam is a boss whose HP is the study hours it needs.
   Time studied on the exam's subject since it was added wears the HP down. ---- */
const DEFAULT_BOSS_HP = 20; // hours
const BOSS_TIERS = [[10, 'Minion'], [25, 'Guardian'], [50, 'Warlord'], [Infinity, 'Final boss']];
const bossTier = (hours) => BOSS_TIERS.find(([max]) => hours <= max)[1];

function bossInfo(e) {
  const hours = e.hp || DEFAULT_BOSS_HP;
  const hp = hours * HOUR;
  const tk = todayKey();
  const studied = (k) => { const d = dayData(k); return e.s ? d.by[e.s] || 0 : d.total; };
  const end = e.date < tk ? e.date : tk;
  let dealt = 0;
  for (let k = dayKey(e.created || Date.now()); k <= end; k = addDays(k, 1)) dealt += studied(k);
  const left = Math.max(0, hp - dealt);
  const n = daysUntil(e.date);
  const perDay = n >= 0 ? left / (n + 1) : 0; // today counts as a day you can still use
  let recent = 0;
  for (let i = 0; i < 7; i++) recent += studied(addDays(tk, -i));
  return {
    hours, hp, dealt, left, perDay,
    pct: (left / hp) * 100,
    defeated: !!e.defeatedAt || dealt >= hp,
    onPace: recent / 7 >= perDay * 0.9,
    tier: bossTier(hours),
  };
}

// Marks bosses whose HP has just hit zero; returns the newly beaten ones.
function checkBosses() {
  const tk = todayKey();
  const beaten = db.exams.filter((e) => !e.defeatedAt && e.date >= tk && bossInfo(e).defeated);
  beaten.forEach((e) => (e.defeatedAt = Date.now()));
  return beaten;
}

const daysUntil = (k) => Math.round((keyDate(k) - keyDate(todayKey())) / 86400000);
const fmtDate = (k) => keyDate(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

function dueLabel(k) {
  const n = daysUntil(k);
  if (n === 0) return ['Today', 'soon'];
  if (n === 1) return ['Tomorrow', 'soon'];
  if (n > 1) return [n <= 6 ? `in ${n} days` : fmtDate(k), ''];
  return [n === -1 ? '1 day late' : `${-n} days late`, 'late'];
}

function openTasks() {
  return db.tasks.filter((t) => !t.done).sort((a, b) =>
    (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);
}
function upcomingExams() {
  const tk = todayKey();
  return db.exams.filter((e) => e.date >= tk).sort((a, b) => a.date.localeCompare(b.date));
}

function subjectOptions(sel, noneLabel) {
  return `<option value="">${noneLabel}</option>` + activeSubjects().map((s) =>
    `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function taskRow(t, compact = false) {
  const sub = t.s && subjectById(t.s);
  const due = t.due && !t.done ? dueLabel(t.due) : null;
  return `<div class="task-row ${t.done ? 'done' : ''}" data-task="${t.id}">
    <button class="check" data-toggle aria-label="${t.done ? 'Mark as not done' : 'Mark as done'}">${icon('check', 13)}</button>
    <div class="t-main"><div class="t-text" ${compact ? '' : 'data-edit title="Click to edit"'}>${esc(t.text)}</div>
      ${!compact && sub ? `<div class="t-sub"><span class="dot" style="background:${colorOf(sub.id)}"></span>${esc(sub.name)}</div>` : ''}</div>
    ${due ? `<span class="due ${due[1]}">${due[0]}</span>` : '<span></span>'}
    ${compact ? '' : `<button class="row-del" data-del title="Delete task">${icon('trash', 15)}</button>`}</div>`;
}

function toggleTask(id) {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  if (t.done) checkRewards();
  refreshViews();
}

/* ---- Plan page ---- */
function renderPlan() {
  // keep whatever is being typed when the page re-renders
  const keep = {};
  $$('#view-plan form [name]').forEach((el) => (keep[`${el.form.id}.${el.name}`] = el.value));
  const act = document.activeElement;
  const focused = act && act.form && act.closest('#view-plan') ? `#${act.form.id} [name="${act.name}"]` : null;

  const open = openTasks();
  const done = db.tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
  const tk = todayKey();
  const exams = [...db.exams].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = exams.filter((e) => e.date >= tk);
  const past = exams.filter((e) => e.date < tk).reverse();

  const examCard = (e) => {
    const n = daysUntil(e.date);
    const sub = e.s && subjectById(e.s);
    const b = bossInfo(e);
    const boss = n < 0 ? '' : `<div class="boss ${b.defeated ? 'beaten' : ''}">
        <div class="boss-top"><span class="boss-tier">${icon('skull', 14)}${b.tier}</span>
          <span class="boss-hp">${b.defeated ? 'Defeated' : `${fmtHM(b.left)} HP left`}</span></div>
        <div class="hp-bar"><div style="width:${b.pct}%"></div></div>
        <div class="boss-meta"><span>${b.defeated ? 'You put in the hours. Keep it sharp until the day.'
          : `${fmtHM(b.dealt)} dealt · ${fmtHM(b.perDay)}/day needed · <b class="${b.onPace ? 'ok' : 'bad'}">${b.onPace ? 'on pace' : 'behind pace'}</b>`}</span>
          <span class="stepper mini" title="Study hours needed to beat it"><button data-hp="-1" aria-label="Fewer hours">−</button><span class="v">${b.hours}h</span><button data-hp="1" aria-label="More hours">+</button></span></div></div>`;
    return `<div class="exam-card ${n < 0 ? 'past' : n <= 7 ? 'urgent' : ''}" data-exam="${e.id}" style="${sub ? `--c:${colorOf(sub.id)}` : ''}">
      <div class="e-days"><div class="e-num">${n < 0 ? (b.defeated ? '✓' : '—') : n}</div><div class="e-unit">${n < 0 ? (b.defeated ? 'defeated' : 'escaped') : n === 0 ? 'today' : n === 1 ? 'day left' : 'days left'}</div></div>
      <div style="min-width:0"><div class="e-name">${esc(e.name)}</div>
        <div class="e-meta">${fmtDate(e.date)}${sub ? ` · ${esc(sub.name)}` : ''}</div>
        ${n < 0 && !b.defeated ? `<div class="e-meta">Got away with ${Math.round(b.pct)}% HP</div>` : ''}${boss}</div>
      <button class="row-del" data-del title="Remove exam">${icon('trash', 15)}</button></div>`;
  };

  $('#planBody').innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Tasks</h3><span class="muted">${open.length} open</span></div>
      <form class="add-row tasks" id="taskForm">
        <input class="field wide" name="text" maxlength="120" placeholder="Add a task, e.g. Finish problem set 4" autocomplete="off" required />
        <select class="field" name="s" aria-label="Subject">${subjectOptions(db.selected, 'No subject')}</select>
        <input class="field" name="due" type="date" aria-label="Due date" min="${tk}" />
        <button class="btn primary" type="submit">${icon('plus', 16)}Add</button>
      </form>
      <div class="task-list">${open.map((t) => taskRow(t)).join('') || '<div class="plan-empty">No open tasks. Add what you need to get done and tick things off as you study.</div>'}</div>
      ${done.length ? `<div class="done-head">
          <button class="fold ${planUi.showDone ? 'open' : ''}" data-fold>${icon('chevR', 14)}Completed (${done.length})</button>
          ${planUi.showDone ? '<button class="text-btn small" data-clear>Clear completed</button>' : ''}</div>
        ${planUi.showDone ? `<div class="task-list">${done.slice(0, 50).map((t) => taskRow(t)).join('')}</div>` : ''}` : ''}
    </div>
    <div class="card">
      <div class="card-head"><h3>Exam bosses</h3><span class="muted">Study the subject to drain their HP</span></div>
      <form class="add-row exams" id="examForm">
        <input class="field name" name="name" maxlength="60" placeholder="Exam, e.g. Thermodynamics final" autocomplete="off" required />
        <label class="hp-field" title="Study hours needed to beat it"><input class="field" name="hp" type="number" min="1" max="300" value="${DEFAULT_BOSS_HP}" aria-label="Study hours needed" /><span>hours</span></label>
        <select class="field" name="s" aria-label="Subject">${subjectOptions('', 'No subject')}</select>
        <input class="field" name="date" type="date" aria-label="Date" required />
        <button class="btn primary" type="submit">${icon('plus', 16)}Add</button>
      </form>
      <div class="exam-list">${upcoming.map(examCard).join('') || '<div class="plan-empty">No bosses yet. Add an exam, say how many hours of study it deserves, and wear it down before the day.</div>'}
        ${past.slice(0, 5).map(examCard).join('')}</div>
    </div>`;

  $$('#view-plan form [name]').forEach((el) => {
    const v = keep[`${el.form.id}.${el.name}`];
    if (v !== undefined && v !== '') el.value = v;
  });
  if (focused) $(focused)?.focus();
}

function bindPlan() {
  const body = $('#planBody');
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (e.target.id === 'taskForm') {
      const text = String(f.get('text')).trim();
      if (!text) return;
      db.tasks.push({ id: uid(), text, s: f.get('s') || '', due: f.get('due') || '', done: false, doneAt: null, created: Date.now() });
    } else {
      const name = String(f.get('name')).trim();
      if (!name || !f.get('date')) return;
      db.exams.push({ id: uid(), name, s: f.get('s') || '', date: f.get('date'), hp: Math.min(300, Math.max(1, Number(f.get('hp')) || DEFAULT_BOSS_HP)), created: Date.now() });
    }
    e.target.reset();
    save();
    refreshViews();
    $(`#${e.target.id} input`)?.focus();
  });

  body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-task]');
    if (row) {
      const id = row.dataset.task;
      if (e.target.closest('[data-toggle]')) { toggleTask(id); return; }
      if (e.target.closest('[data-del]')) {
        // finished tasks keep counting toward XP after they are removed
        if (db.tasks.find((t) => t.id === id)?.done) db.tasksCleared = (db.tasksCleared || 0) + 1;
        db.tasks = db.tasks.filter((t) => t.id !== id);
        save(); refreshViews(); return;
      }
      const textEl = e.target.closest('[data-edit]');
      if (textEl) {
        const t = db.tasks.find((x) => x.id === id);
        textEl.outerHTML = `<input class="t-edit" value="${esc(t.text)}" maxlength="120" />`;
        const inp = row.querySelector('.t-edit');
        inp.focus(); inp.select();
        inp.onblur = () => { const v = inp.value.trim(); if (v) t.text = v; save(); refreshViews(); };
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.value = t.text; inp.blur(); } };
      }
      return;
    }
    const exam = e.target.closest('[data-exam]');
    const hpBtn = exam && e.target.closest('[data-hp]');
    if (hpBtn) {
      const x = db.exams.find((y) => y.id === exam.dataset.exam);
      x.hp = Math.min(300, Math.max(5, (x.hp || DEFAULT_BOSS_HP) + Number(hpBtn.dataset.hp) * 5));
      save(); checkRewards(); refreshViews(); return;
    }
    if (exam && e.target.closest('[data-del]')) {
      // beaten bosses keep counting toward XP after they are removed
      if (db.exams.find((x) => x.id === exam.dataset.exam)?.defeatedAt) db.bossesCleared = (db.bossesCleared || 0) + 1;
      db.exams = db.exams.filter((x) => x.id !== exam.dataset.exam);
      save(); refreshViews(); return;
    }
    if (e.target.closest('[data-fold]')) { planUi.showDone = !planUi.showDone; renderPlan(); return; }
    if (e.target.closest('[data-clear]')) {
      // finished tasks keep counting toward XP after they are cleared
      db.tasksCleared = (db.tasksCleared || 0) + db.tasks.filter((t) => t.done).length;
      db.tasks = db.tasks.filter((t) => !t.done);
      save(); refreshViews();
    }
  });

  $('#upNext').addEventListener('click', (e) => {
    const row = e.target.closest('[data-task]');
    if (row && e.target.closest('[data-toggle]')) { toggleTask(row.dataset.task); return; }
    if (e.target.closest('[data-open-plan]')) switchView('plan');
  });
}

/* ---- Focus page card: the next exam and the next few tasks ---- */
function renderUpNext() {
  const el = $('#upNext');
  const exam = upcomingExams()[0];
  const open = openTasks();
  const mine = open.filter((t) => t.s === db.selected);
  const tasks = (mine.length ? mine : open).slice(0, 3);
  if (!exam && !tasks.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const n = exam ? daysUntil(exam.date) : 0;
  el.innerHTML = `<div class="card-head"><h3>Up next</h3><button class="text-btn small" data-open-plan>Open plan</button></div>
    ${exam ? `<div class="un-exam"><span class="un-days">${n === 0 ? 'Today' : n}${n === 0 ? '' : `<small>${n === 1 ? 'day' : 'days'}</small>`}</span>
      <span class="un-name">${n === 0 ? '' : 'until '}${esc(exam.name)}</span></div>
      ${(() => { const b = bossInfo(exam); return `<div class="un-boss ${b.defeated ? 'beaten' : ''}"><div class="hp-bar"><div style="width:${b.pct}%"></div></div>
        <span>${b.defeated ? 'Boss defeated' : `${fmtHM(b.left)} HP left`}</span></div>`; })()}` : ''}
    ${exam && tasks.length ? '<div class="un-sep"></div>' : ''}
    ${tasks.length ? `<div class="task-list">${tasks.map((t) => taskRow(t, true)).join('')}</div>` : ''}`;
}
