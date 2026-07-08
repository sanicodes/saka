// Spoken match commentary via the Web Speech API — lines are composed from
// randomized pools and synthesized on the fly (no audio assets, same idea as
// sfx.js). Every line also flashes as a text caption under the banner, so the
// commentary still reads if the voice is off, missing, or just bad. The 🔊
// master mute silences the voice too; 🎙️ toggles commentary on its own.

import { sfx } from '/sfx.js';

let enabled = (() => {
  try {
    return localStorage.getItem('saka:commentary') !== '0';
  } catch {
    return true;
  }
})();

// prefer a British voice for the football-broadcast feel, then any English one
let voice = null;
let voicesStale = true;
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = () => (voicesStale = true);
}
function pickVoice() {
  if (!voicesStale) return voice;
  voicesStale = false;
  const all = speechSynthesis.getVoices();
  voice =
    all.find((v) => v.lang === 'en-GB' && v.localService) ||
    all.find((v) => v.lang === 'en-GB') ||
    all.find((v) => v.lang?.startsWith('en')) ||
    null;
  return voice;
}

// Deterministic PRNG (mulberry32) seeded by the server per event, so every
// client in the room picks the same line variants. Pools must be consumed in
// the same order on every client for the sequence to stay in lockstep.
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = (seed) => mulberry32((seed ?? Math.random() * 0x100000000) >>> 0);

// line from a pool via the event's rng, never the same one twice in a row
const lastPick = new WeakMap(); // pool -> index used last time
function pick(pool, rnd) {
  let i = Math.floor(rnd() * pool.length);
  if (pool.length > 1 && i === lastPick.get(pool)) i = (i + 1) % pool.length;
  lastPick.set(pool, i);
  return pool[i];
}

const T = (team) => (team === 'red' ? 'Red' : 'Blue');

const WELCOME = [
  () => 'Welcome to the match — Red against Blue, and we are moments from kickoff!',
  () => "Here we go! It's Red versus Blue!",
  () => 'The players are in position — we are ready for kickoff!',
];
const RESTART = [
  (c) => `${T(c.team)} to restart play.`,
  (c) => `${T(c.team)} take the kickoff.`,
  (c) => `We go again — ${T(c.team)} with the restart.`,
];
const GOAL_SCORER = [
  (c) => `GOAL! ${c.scorer} strikes for ${T(c.team)}!`,
  (c) => `${c.scorer} finds the net — a goal for ${T(c.team)}!`,
  (c) => `What a finish from ${c.scorer}!`,
  (c) => `${c.scorer} buries it, and ${T(c.team)} celebrate!`,
];
const GOAL_TEAM = [(c) => `GOAL for ${T(c.team)}!`, (c) => `${T(c.team)} find the net!`];
const OWN_GOAL = [
  (c) => `Oh no — ${c.scorer} turns it into their own net! A gift for ${T(c.team)}!`,
  (c) => `Disaster for ${c.scorer} — that's an own goal!`,
  (c) => `It's in off ${c.scorer} — an own goal, and ${T(c.team)} will gladly take it!`,
];
const ASSIST = [
  (c) => `${c.assist} with the assist.`,
  (c) => `Teed up beautifully by ${c.assist}.`,
  (c) => `All the work done by ${c.assist}.`,
];
const WINNER_GOAL = [
  (c) => `${c.scorer} wins it for ${T(c.team)}!`,
  (c) => `And that is the match — ${c.scorer} with the decider for ${T(c.team)}!`,
];
const FT_WIN = [
  (c) => `Full time! ${T(c.team)} take it, ${c.hi} to ${c.lo}!`,
  (c) => `There's the final whistle — ${T(c.team)} win ${c.hi} to ${c.lo}!`,
  (c) => `It's all over! Victory for ${T(c.team)}, ${c.hi} to ${c.lo}!`,
];
const FT_DRAW = [
  (c) => `Full time — it ends all square at ${c.hi} apiece!`,
  (c) => `There's the whistle, and honours are even at ${c.hi} to ${c.hi}!`,
];

function scorePhrase(score) {
  const { red: r, blue: b } = score;
  if (r === b) return `It's level at ${r} apiece.`;
  return `${r > b ? 'Red' : 'Blue'} lead ${Math.max(r, b)} to ${Math.min(r, b)}.`;
}

// the caption doubles as a text ticker — shown even when the voice is off
let captionTimer = null;
function caption(text) {
  const el = document.getElementById('commentary');
  if (!el) return;
  el.textContent = `🎙️ ${text}`;
  el.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// big moments (goals, full time) interrupt whatever is still being said;
// flavour lines (restarts) yield instead of piling up in the queue
function speak(text, { interrupt = false } = {}) {
  caption(text);
  if (!enabled || sfx.muted || !window.speechSynthesis) return;
  if (interrupt) speechSynthesis.cancel();
  else if (speechSynthesis.speaking || speechSynthesis.pending) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.08; // a touch quicker than default — match-commentator energy
  speechSynthesis.speak(u);
}

export const commentary = {
  get enabled() {
    return enabled;
  },
  toggle() {
    enabled = !enabled;
    try {
      localStorage.setItem('saka:commentary', enabled ? '1' : '0');
    } catch {}
    if (!enabled && window.speechSynthesis) speechSynthesis.cancel();
    return enabled;
  },

  matchStart(seed) {
    speak(pick(WELCOME, rng(seed))());
  },

  // team = the side taking the kickoff (null on the first kickoff of a match)
  kickoff(team, seed) {
    if (team) speak(pick(RESTART, rng(seed))({ team }));
  },

  // g comes from the server's state broadcast: { team, scorer, assist, ownGoal, final }
  goal(g, score, seed) {
    if (!g) return;
    const rnd = rng(seed);
    let line;
    if (g.ownGoal && g.scorer) line = pick(OWN_GOAL, rnd)(g);
    else if (g.scorer) {
      line = pick(GOAL_SCORER, rnd)(g);
      if (g.assist) line += ` ${pick(ASSIST, rnd)(g)}`;
    } else line = pick(GOAL_TEAM, rnd)(g);
    speak(`${line} ${scorePhrase(score)}`, { interrupt: true });
  },

  fullTime(score, g, seed) {
    const rnd = rng(seed);
    const { red: r, blue: b } = score;
    const ctx = { team: r > b ? 'red' : 'blue', hi: Math.max(r, b), lo: Math.min(r, b) };
    let line = '';
    // score-limit finishes skip the goal phase — call the winning goal here
    if (g?.final && g.scorer && !g.ownGoal) line = `${pick(WINNER_GOAL, rnd)(g)} `;
    line += r === b ? pick(FT_DRAW, rnd)(ctx) : pick(FT_WIN, rnd)(ctx);
    speak(line, { interrupt: true });
  },
};
