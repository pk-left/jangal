'use strict';

/* =========================================================================
   Rewards — XP, levels and badges.
   Everything here is worked out from the study history, so it can never
   drift out of step with the stats. Only the unlock dates are stored.
   ========================================================================= */

const XP_PER_GOAL_DAY = 50;
const XP_PER_TASK = 10;
const XP_PER_BOSS = 100;
const LEVEL_TITLES = ['Spark', 'Ember', 'Candle', 'Lantern', 'Lamp', 'Torch', 'Beacon', 'Lighthouse', 'Star', 'Sun'];

// Level L starts at 50·L·(L−1) XP: 100 XP for level 2, 300 for level 3, 600 for level 4 …
const xpForLevel = (l) => 50 * l * (l - 1);
function levelInfo(xp) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2));
  const from = xpForLevel(level), to = xpForLevel(level + 1);
  return {
    level, xp, from, to,
    pct: Math.min(100, ((xp - from) / (to - from)) * 100),
    title: LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((level - 1) / 3))],
  };
}

const weekStartOf = (k) => addDays(k, -((keyDate(k).getDay() + 6) % 7));
function weekKeys(k = todayKey()) {
  const start = weekStartOf(k);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function rewardStats() {
  const goal = S().goalMin * MIN;
  const tk = todayKey();
  const keys = new Set(days().keys());
  keys.add(tk); // today may only have live, unsaved time
  let totalMs = 0, goalDays = 0, maxDay = 0, maxSubjects = 0;
  const weekBy = new Map(); // "weekStart|subjectId" -> ms
  for (const k of keys) {
    const d = dayData(k);
    totalMs += d.total;
    if (d.total >= goal) goalDays++;
    if (d.total > maxDay) maxDay = d.total;
    const subs = Object.entries(d.by).filter(([, ms]) => ms >= 10 * MIN);
    if (subs.length > maxSubjects) maxSubjects = subs.length;
    const ws = weekStartOf(k);
    for (const [id, ms] of Object.entries(d.by)) weekBy.set(`${ws}|${id}`, (weekBy.get(`${ws}|${id}`) || 0) + ms);
  }
  let owl = false, bird = false;
  for (const x of db.sessions) {
    if (x.b - x.a < 10 * MIN) continue;
    const h = new Date(x.a).getHours();
    if (h < 4) owl = true;
    else if (h < 7) bird = true;
  }
  let targetsHit = 0;
  for (const [key, ms] of weekBy) {
    const s = subjectById(key.split('|')[1]);
    if (s && s.weekGoalMin > 0 && ms >= s.weekGoalMin * MIN) targetsHit++;
  }
  const tasksDone = db.tasks.filter((t) => t.done).length + (db.tasksCleared || 0);
  const st = streakInfo();
  const bosses = db.exams.filter((e) => e.defeatedAt).length + (db.bossesCleared || 0);
  const xp = Math.floor(totalMs / MIN) + goalDays * XP_PER_GOAL_DAY + tasksDone * XP_PER_TASK + bosses * XP_PER_BOSS;
  return { totalMs, hours: totalMs / HOUR, goalDays, maxDay, maxSubjects, owl, bird, targetsHit, tasksDone, bosses, streak: st.best, xp };
}

// prog(s) -> [current, target] drives both the unlock test and the progress bar.
const BADGES = [
  { id: 'first', icon: 'bolt', name: 'First light', desc: 'Log your first study session', prog: (s) => [s.totalMs >= MIN ? 1 : 0, 1] },
  { id: 'h10', icon: 'clock', name: 'Ten hours', desc: 'Study for 10 hours in total', prog: (s) => [s.hours, 10] },
  { id: 'h50', icon: 'clock', name: 'Fifty hours', desc: 'Study for 50 hours in total', prog: (s) => [s.hours, 50] },
  { id: 'h100', icon: 'star', name: 'Centurion', desc: 'Study for 100 hours in total', prog: (s) => [s.hours, 100] },
  { id: 'h250', icon: 'star', name: 'Dedicated', desc: 'Study for 250 hours in total', prog: (s) => [s.hours, 250] },
  { id: 'h500', icon: 'cap', name: 'Scholar', desc: 'Study for 500 hours in total', prog: (s) => [s.hours, 500] },
  { id: 'goal1', icon: 'target', name: 'Goal getter', desc: 'Reach your daily goal', prog: (s) => [s.goalDays, 1] },
  { id: 'goal7', icon: 'target', name: 'On target', desc: 'Reach your daily goal on 7 days', prog: (s) => [s.goalDays, 7] },
  { id: 'goal30', icon: 'trophy', name: 'Relentless', desc: 'Reach your daily goal on 30 days', prog: (s) => [s.goalDays, 30] },
  { id: 'streak3', icon: 'flame', name: 'Warming up', desc: 'Study 3 days in a row', prog: (s) => [s.streak, 3] },
  { id: 'streak7', icon: 'flame', name: 'One week strong', desc: 'Study 7 days in a row', prog: (s) => [s.streak, 7] },
  { id: 'streak14', icon: 'flame', name: 'Fortnight', desc: 'Study 14 days in a row', prog: (s) => [s.streak, 14] },
  { id: 'streak30', icon: 'trophy', name: 'Unbroken month', desc: 'Study 30 days in a row', prog: (s) => [s.streak, 30] },
  { id: 'streak100', icon: 'trophy', name: 'Hundred days', desc: 'Study 100 days in a row', prog: (s) => [s.streak, 100] },
  { id: 'day4', icon: 'timer', name: 'Marathon', desc: 'Study 4 hours in one day', prog: (s) => [s.maxDay / HOUR, 4] },
  { id: 'day6', icon: 'timer', name: 'Deep work', desc: 'Study 6 hours in one day', prog: (s) => [s.maxDay / HOUR, 6] },
  { id: 'allround', icon: 'layers', name: 'All-rounder', desc: 'Study 3 subjects in one day', prog: (s) => [s.maxSubjects, 3] },
  { id: 'bird', icon: 'sun', name: 'Early bird', desc: 'Start a session before 7 AM', prog: (s) => [s.bird ? 1 : 0, 1] },
  { id: 'owl', icon: 'moon', name: 'Night owl', desc: 'Start a session after midnight', prog: (s) => [s.owl ? 1 : 0, 1] },
  { id: 'target', icon: 'target', name: 'Bullseye', desc: 'Hit a weekly subject target', prog: (s) => [s.targetsHit, 1] },
  { id: 'boss1', icon: 'skull', name: 'Boss slayer', desc: 'Defeat an exam boss', prog: (s) => [s.bosses, 1] },
  { id: 'boss5', icon: 'skull', name: 'Exam hunter', desc: 'Defeat 5 exam bosses', prog: (s) => [s.bosses, 5] },
  { id: 'task10', icon: 'check', name: 'Finisher', desc: 'Complete 10 tasks', prog: (s) => [s.tasksDone, 10] },
  { id: 'task50', icon: 'list', name: 'Closer', desc: 'Complete 50 tasks', prog: (s) => [s.tasksDone, 50] },
];

// Records newly earned badges. silent = no toast (first run after upgrading, restores).
let lastLevel = 0;
function checkRewards(silent = false) {
  const beaten = checkBosses();
  const s = rewardStats();
  const fresh = BADGES.filter((b) => !db.badges[b.id] && b.prog(s)[0] >= b.prog(s)[1]);
  fresh.forEach((b) => (db.badges[b.id] = Date.now()));
  const lv = levelInfo(s.xp).level;
  const leveled = lastLevel > 0 && lv > lastLevel;
  lastLevel = lv;
  if (fresh.length || beaten.length) save();
  if (silent) return;
  if (beaten.length) {
    toast(`Boss defeated: ${beaten[0].name} · +${XP_PER_BOSS} XP`);
    sound('done');
    if (ui.view === 'plan' || ui.view === 'timer') refreshViews();
  } else if (fresh.length) {
    toast(fresh.length === 1 ? `Badge unlocked: ${fresh[0].name}` : `${fresh.length} badges unlocked`);
    sound('done');
  } else if (leveled) {
    toast(`Level ${lv} reached`);
    sound('done');
  }
  if ((fresh.length || leveled || beaten.length) && ui.view === 'rewards') renderRewards();
}

function renderSideLevel() {
  const li = levelInfo(rewardStats().xp);
  $('#levelChip').innerHTML = `<span class="lv-num">${li.level}</span>
    <span class="lv-text"><div class="lv-title">${li.title}</div><div class="lv-bar"><div style="width:${li.pct}%"></div></div></span>`;
  $('#levelChip').title = `Level ${li.level} · ${li.xp} XP`;
}

function renderRewards() {
  const s = rewardStats();
  const li = levelInfo(s.xp);
  const earned = BADGES.filter((b) => db.badges[b.id]);
  const num = (n) => Math.round(n).toLocaleString();
  $('#rewardsBody').innerHTML = `
    <div class="card level-card">
      <div class="level-orb" style="--p:${li.pct}"><div><span class="lo-l">Level</span><span class="lo-n">${li.level}</span></div></div>
      <div class="level-info">
        <h2>${li.title}</h2>
        <div class="muted">${num(li.xp)} XP · ${num(li.to - li.xp)} XP to level ${li.level + 1}</div>
        <div class="xp-bar"><div style="width:${li.pct}%"></div></div>
        <div class="xp-rules">
          <span><b>1 XP</b> per minute studied</span>
          <span><b>${XP_PER_GOAL_DAY} XP</b> each day you reach your goal</span>
          <span><b>${XP_PER_TASK} XP</b> per finished task</span>
          <span><b>${XP_PER_BOSS} XP</b> per exam boss defeated</span>
        </div>
      </div>
    </div>
    <div class="badge-head"><h3>Badges</h3><span class="muted">${earned.length} of ${BADGES.length} unlocked</span></div>
    <div class="badge-grid">${[...BADGES].sort((a, b) => !!db.badges[b.id] - !!db.badges[a.id]).map((b) => {
      const got = db.badges[b.id];
      const [cur, target] = b.prog(s);
      const pct = Math.min(100, (cur / target) * 100);
      return `<div class="badge ${got ? '' : 'locked'}">
        <div class="b-icon">${icon(b.icon, 22)}</div>
        <div><div class="b-name">${b.name}</div><div class="b-desc">${b.desc}</div>
          ${got ? `<div class="b-date">Unlocked ${new Date(got).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>`
                : target > 1 ? `<div class="b-prog"><div style="width:${pct}%"></div></div>` : ''}</div></div>`;
    }).join('')}</div>`;
}
