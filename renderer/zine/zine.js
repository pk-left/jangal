'use strict';
/* Zine theme helpers: hand-drawn scribbles and the theme's own wording. */
const Zine = (() => {
  // Small seeded random so each scribble looks hand-drawn but stays the same between launches.
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // A loose loop drawn 1.5-2 times around an ellipse, like circling something with a marker.
  function loopPath(seed, cx, cy, rx, ry, turns = 1.8, wob = 0.06) {
    const r = rng(seed);
    const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    const amp = [wob, wob * 0.6, wob * 0.35];
    const start = r() * 6.28, steps = Math.round(64 * turns);
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = start + (i / steps) * turns * Math.PI * 2;
      const drift = 1 + (i / steps) * 0.06 - 0.03; // each pass lands a little wider
      const k = 1 + amp[0] * Math.sin(t * 2 + ph[0]) + amp[1] * Math.sin(t * 3 + ph[1]) + amp[2] * Math.sin(t * 5 + ph[2]);
      const x = cx + Math.cos(t) * rx * k * drift, y = cy + Math.sin(t) * ry * k * drift;
      d += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }
  // A quick marker underline with a little hook at the end.
  function underline(seed, w) {
    const r = rng(seed), y = 8;
    let d = `M2 ${(y + r() * 3).toFixed(1)}`;
    for (let x = 12; x <= w; x += 10) d += ` Q${x - 5} ${(y - 3 + r() * 6).toFixed(1)} ${x} ${(y + (r() - 0.5) * 4).toFixed(1)}`;
    return d + ' q6 -4 4 -7';
  }
  const NS = 'http://www.w3.org/2000/svg';
  function scribble(cls, vb, d) {
    const el = document.createElementNS(NS, 'svg');
    el.setAttribute('class', cls); el.setAttribute('viewBox', vb); el.setAttribute('preserveAspectRatio', 'none');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `<path class="k" pathLength="1" d="${d}"/><path class="w" pathLength="1" d="${d}"/>`;
    return el;
  }

  let built = false;
  function build() {
    if (built) return; built = true;
    const ring = document.getElementById('ringWrap');
    if (ring) ring.prepend(scribble('z-scribble', '0 0 200 200', loopPath(7, 100, 100, 88, 86, 1.85, 0.05)));
    const brand = document.querySelector('.brand');
    if (brand) brand.prepend(scribble('z-oval', '0 0 150 66', loopPath(3, 75, 33, 70, 26, 1.6, 0.05)));
    document.querySelectorAll('.nav-item').forEach((b, i) => {
      const u = document.createElementNS(NS, 'svg');
      u.setAttribute('class', 'z-under'); u.setAttribute('viewBox', '0 0 100 14'); u.setAttribute('preserveAspectRatio', 'none');
      u.setAttribute('aria-hidden', 'true');
      const d = underline(11 + i, 92);
      u.innerHTML = `<path d="${d}" fill="none" stroke="#111" stroke-width="6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#ffe33b" stroke-width="3" stroke-linecap="round"/>`;
      b.appendChild(u);
    });
  }

  // The theme's own voice for page names and timer phases. Everything else keeps the usual wording.
  const COPY = { timer: 'Lock in', plan: 'The plan', stats: 'Receipts', subjects: 'Subjects', rewards: 'Loot', settings: 'Knobs' };
  const PHASE = { Focus: 'lock in', 'Short break': 'breathe', 'Long break': 'touch grass', Break: 'breathe', Stopwatch: 'free run', 'Final seconds': 'final seconds!!' };
  const orig = new Map();
  let on = false;

  function apply(themeId) {
    on = themeId === 'zine';
    if (on) build();
    document.querySelectorAll('.nav-item').forEach((b) => {
      const span = b.querySelector('span');
      if (!orig.has(b)) orig.set(b, span.textContent);
      span.textContent = on ? COPY[b.dataset.view] || orig.get(b) : orig.get(b);
    });
  }
  const title = (view, fallback) => (on && COPY[view]) || fallback;
  const phase = (label) => (on && PHASE[label]) || label;
  return { apply, title, phase, get on() { return on; } };
})();
