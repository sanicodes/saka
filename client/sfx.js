// Synthesized sound effects via the Web Audio API — no asset files, no network
// cost. Browsers start the context suspended under autoplay rules; resume() is
// called on the first user gesture (the name-gate "Enter" button). All sounds
// are short oscillator/noise bursts shaped by a per-voice gain envelope.

let ctx = null;
let master = null;
let muted = (() => {
  try {
    return localStorage.getItem('saka:muted') === '1';
  } catch {
    return false;
  }
})();

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null; // no Web Audio: sfx become no-ops
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

// one oscillator voice with an attack/decay envelope; optional pitch slide
function tone({ freq, type = 'sine', dur = 0.15, gain = 0.5, attack = 0.005, slideTo = null, when = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// short filtered white-noise burst (used for the "click" transient of a kick)
function noise({ dur = 0.08, gain = 0.4, when = 0 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  // call from a user gesture so the context is allowed to produce sound
  resume() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  },

  get muted() {
    return muted;
  },
  toggleMuted() {
    muted = !muted;
    try {
      localStorage.setItem('saka:muted', muted ? '1' : '0');
    } catch {}
    return muted;
  },

  // a thumping low sine sweep plus a noise click — the ball getting struck
  kick() {
    if (muted || !ensure()) return;
    tone({ freq: 240, type: 'sine', dur: 0.13, gain: 0.55, slideTo: 90 });
    noise({ dur: 0.05, gain: 0.25 });
  },

  // celebratory ascending triad (C5–E5–G5)
  goal() {
    if (muted || !ensure()) return;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.18, gain: 0.32, when: i * 0.1 }));
    tone({ freq: 1046.5, type: 'triangle', dur: 0.3, gain: 0.28, when: 0.3 });
  },

  // referee whistle: high tone with a fast vibrato-ish double chirp
  whistle() {
    if (muted || !ensure()) return;
    tone({ freq: 2300, type: 'square', dur: 0.12, gain: 0.22 });
    tone({ freq: 2500, type: 'square', dur: 0.18, gain: 0.22, when: 0.16 });
  },

  // longer single blast for full time
  fullTime() {
    if (muted || !ensure()) return;
    tone({ freq: 2400, type: 'square', dur: 0.6, gain: 0.24 });
  },

  // bright little chime when a power-up is grabbed
  powerup() {
    if (muted || !ensure()) return;
    tone({ freq: 880, type: 'triangle', dur: 0.1, gain: 0.3 });
    tone({ freq: 1318.5, type: 'triangle', dur: 0.16, gain: 0.3, when: 0.08 });
  },
};
