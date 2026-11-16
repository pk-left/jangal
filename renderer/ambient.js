'use strict';

/* =========================================================================
   Ambient focus sounds — synthesised with Web Audio, so there are no audio
   files to ship and it works fully offline.
   ========================================================================= */

const AMBIENT_KINDS = [
  ['off', 'Off'],
  ['rain', 'Rain'],
  ['waves', 'Waves'],
  ['brown', 'Deep hum'],
  ['white', 'White noise'],
];
const ambientName = (k) => (AMBIENT_KINDS.find((x) => x[0] === k) || AMBIENT_KINDS[0])[1];

const Ambient = (() => {
  let ctx = null;
  let master = null;
  let current = 'off';
  let nodes = [];
  const buffers = {};

  // A few seconds of noise whose end is cross-faded into its start, so it loops without a click.
  function noiseBuffer(type) {
    if (buffers[type]) return buffers[type];
    const rate = ctx.sampleRate;
    const len = rate * 6;
    const fade = Math.floor(rate * 0.5);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(len + fade);
      let last = 0;
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          raw[i] = last * 3.5;
        } else if (type === 'pink') {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          raw[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
        } else raw[i] = w * 0.5;
      }
      const out = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) out[i] = raw[i];
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        out[i] = raw[i] * t + raw[len + i] * (1 - t);
      }
    }
    buffers[type] = buf;
    return buf;
  }

  function source(type) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(type);
    s.loop = true;
    return s;
  }
  function filter(type, freq, q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  function build(kind, out) {
    const made = [];
    const chain = (...list) => {
      list.reduce((a, b) => (a.connect(b), b));
      made.push(...list);
      return list[0];
    };
    if (kind === 'rain') {
      const g = ctx.createGain(); g.gain.value = 0.9;
      chain(source('pink'), filter('highpass', 500), filter('lowpass', 7000), g, out).start();
      const low = ctx.createGain(); low.gain.value = 0.25;
      chain(source('brown'), filter('lowpass', 300), low, out).start();
    } else if (kind === 'waves') {
      const g = ctx.createGain(); g.gain.value = 0.55;
      chain(source('brown'), filter('lowpass', 700), g, out).start();
      // slow swell, like surf coming in and out
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
      const depth = ctx.createGain(); depth.gain.value = 0.4;
      lfo.connect(depth).connect(g.gain); lfo.start();
      made.push(lfo, depth);
    } else if (kind === 'brown') {
      const g = ctx.createGain(); g.gain.value = 0.9;
      chain(source('brown'), filter('lowpass', 450), g, out).start();
    } else if (kind === 'white') {
      const g = ctx.createGain(); g.gain.value = 0.3;
      chain(source('white'), filter('lowpass', 9000), g, out).start();
    }
    return made;
  }

  function teardown(list) {
    list.forEach((n) => {
      try { if (n.stop) n.stop(); } catch { /* already stopped */ }
      try { n.disconnect(); } catch { /* already gone */ }
    });
  }

  // kind: one of AMBIENT_KINDS; volume: 0–100
  function set(kind, volume) {
    try {
      if (kind === 'off' && !ctx) return;
      ctx = ctx || new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const level = Math.max(0, Math.min(1, volume / 100)) * 0.5;
      if (kind !== current) {
        // fade the old sound out on its own gain, then drop it
        if (master) {
          const old = master, oldNodes = nodes;
          old.gain.cancelScheduledValues(now);
          old.gain.setTargetAtTime(0, now, 0.25);
          setTimeout(() => { teardown(oldNodes); old.disconnect(); }, 1500);
        }
        master = null; nodes = [];
        current = kind;
        if (kind !== 'off') {
          master = ctx.createGain();
          master.gain.value = 0;
          master.connect(ctx.destination);
          nodes = build(kind, master);
        }
      }
      if (master) master.gain.setTargetAtTime(level, now, 0.4);
    } catch { /* audio unavailable */ }
  }

  return { set, get current() { return current; } };
})();
