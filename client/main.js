// Client entry: connects to the server, captures input, buffers snapshots,
// and drives the render loop. Sends INPUTS ONLY — never positions.
// Screens: global lobby (room list) -> room lobby (roster + host settings) -> match.

import { Renderer } from '/render.js';
import { ui } from '/ui.js';
import { sfx } from '/sfx.js';

/* global io */
const socket = io();
const canvas = document.getElementById('c');
const renderer = new Renderer(canvas);

let selfId = null; // our socket id
let inRoom = false;
let roomData = null; // latest 'room' payload (owner, settings, roster, phase)

const $ = (id) => document.getElementById(id);
const isOwner = () => !!roomData && roomData.ownerId === selfId;

let myName = '';
const playerName = () => myName || 'Player';

const settingHandlers = {
  onSetting: (s) => socket.emit('room:settings', s),
};

// route to the right screen for the room's phase
function route(state) {
  if (!inRoom) return;
  ui.show(state === 'lobby' ? 'roomlobby' : 'game');
}

// ---------------------------------------------------------------- name gate
const nameInput = $('name');
const enterBtn = $('enterBtn');
nameInput.value = (localStorage.getItem('saka:name') || '').slice(0, 16);
const syncEnter = () => {
  enterBtn.disabled = nameInput.value.trim().length === 0;
};
syncEnter();
nameInput.addEventListener('input', syncEnter);
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !enterBtn.disabled) enterName();
});
enterBtn.onclick = enterName;

function enterName() {
  const n = nameInput.value.trim().slice(0, 16);
  if (!n) return;
  myName = n;
  sfx.resume(); // first user gesture: unlock the audio context
  try {
    localStorage.setItem('saka:name', n);
  } catch {}
  $('whoami').textContent = n;
  if (inRoom) socket.emit('rename', { name: n }); // keep the room roster in sync
  ui.show('lobby');
  socket.emit('lobby:join'); // (re)subscribe + refresh room list
  // arrived via a share link (?room=...) — jump straight into that room
  if (pendingRoom) {
    const rid = pendingRoom;
    pendingRoom = null;
    joinRoom(rid, false);
  }
}

// ---------------------------------------------------------------- share links
// Joining/creating puts ?room=<id> in the address bar (shareable as-is); the
// Copy link button grabs it for you. Opening such a link auto-joins the room
// right after the name gate.
let pendingRoom = new URLSearchParams(location.search).get('room');

function setUrlRoom(roomId) {
  const url = roomId ? `${location.pathname}?room=${encodeURIComponent(roomId)}` : location.pathname;
  history.replaceState(null, '', url);
}

$('rlRename').onclick = () => {
  const n = (prompt('New name:', myName) || '').trim().slice(0, 16);
  if (!n || n === myName) return;
  myName = n;
  try {
    localStorage.setItem('saka:name', n);
  } catch {}
  $('whoami').textContent = n;
  socket.emit('rename', { name: n }); // server updates roster + disc labels
};

$('rlShare').onclick = () => {
  const rid = roomData?.roomId;
  if (!rid) return;
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(rid)}`;
  const btn = $('rlShare');
  const done = () => {
    btn.textContent = '✓ Copied';
    setTimeout(() => (btn.textContent = '🔗 Copy link'), 1200);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link));
  else prompt('Copy this link:', link);
};

$('changeName').onclick = (e) => {
  e.preventDefault();
  nameInput.value = myName;
  syncEnter();
  ui.show('welcome');
  nameInput.focus();
};

ui.show('welcome'); // first thing users see

// ---------------------------------------------------------------- connection
socket.on('connect', () => {
  selfId = socket.id;
  if (!inRoom) socket.emit('lobby:join');
});

// ---------------------------------------------------------------- global lobby
socket.on('lobby:rooms', (rooms) => {
  if (!inRoom) ui.renderRoomList(rooms, joinRoom);
});

function joinRoom(roomId, locked, password) {
  if (locked && password === undefined) {
    password = prompt('This room is locked. Enter the password:');
    if (password === null) return; // cancelled
  }
  ui.setError('');
  socket.emit('room:join', { roomId, playerName: playerName(), password }, (res) => {
    if (res?.error) {
      // a share link doesn't know the room is locked — ask and retry once
      if (res.locked && password === undefined) return joinRoom(roomId, true);
      return ui.setError(res.error);
    }
    setUrlRoom(res.roomId);
    enterRoom(res.selfId);
  });
}

$('createBtn').onclick = () => {
  ui.setError('');
  const name = ($('roomName').value || '').trim() || `${playerName()}'s room`;
  const password = ($('roomPass').value || '').trim();
  socket.emit('room:create', { name, playerName: playerName(), password }, (res) => {
    if (res?.error) return ui.setError(res.error);
    setUrlRoom(res.roomId);
    enterRoom(res.selfId);
  });
};

$('refreshBtn').onclick = () =>
  socket.emit('lobby:list', (rooms) => ui.renderRoomList(rooms, joinRoom));

function enterRoom(id) {
  selfId = id || selfId;
  inRoom = true;
  // the first 'room' event can arrive before this ack fired (and was dropped by
  // the !inRoom guard) — render from the stored payload if we already have it.
  if (roomData) {
    route(roomData.state);
    ui.renderMatchRoster(roomData.players, selfId);
    if (roomData.state === 'lobby') ui.renderRoom(roomData, selfId, settingHandlers);
  } else {
    ui.show('roomlobby');
  }
}

function leaveRoom() {
  socket.emit('room:leave');
  setUrlRoom(null);
  inRoom = false;
  roomData = null;
  renderer.init = null;
  renderer.buffer = [];
  renderer.setKickCharge(null);
  chargeWasDown = false;
  ui.setWinner('lobby'); // clear the result overlay
  ui.show('lobby');
}
$('leaveBtn').onclick = leaveRoom;
$('rlLeave').onclick = leaveRoom;

// ---------------------------------------------------------------- sound toggle
const muteBtn = $('muteBtn');
const syncMute = () => {
  muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
};
muteBtn.onclick = () => {
  sfx.toggleMuted();
  sfx.resume(); // also unlocks audio if this is the first gesture in the match
  syncMute();
};
syncMute();

// ---------------------------------------------------------------- room actions
$('startBtn').onclick = () => socket.emit('room:start');
$('shuffleBtn').onclick = () => socket.emit('room:shuffle');
$('rematchBtn').onclick = () => socket.emit('rematch');
for (const btn of document.querySelectorAll('[data-team]')) {
  btn.onclick = () => socket.emit('team', { team: btn.dataset.team });
}

// ---------------------------------------------------------------- server -> client
socket.on('room', (r) => {
  roomData = r;
  if (!inRoom) return;
  route(r.state);
  ui.renderMatchRoster(r.players, selfId); // side panel, kept current in all phases
  if (r.state === 'lobby') {
    ui.setWinner('lobby'); // clear any prior result
    ui.renderRoom(r, selfId, settingHandlers);
  }
});

socket.on('gameInit', (init) => {
  renderer.setInit(init);
  const me = init.players.find((p) => p.id === selfId);
  renderer.setSelfDisc(me ? me.discId : null);
  ui.setScore(init.score.red, init.score.blue);
});

let hadPowerup = false;
socket.on('snapshot', (snap) => {
  renderer.pushSnapshot(snap);
  ui.setScore(snap.score[0], snap.score[1]);
  ui.setClock(snap.timeLeftMs);
  // orb present last tick, gone this tick → someone picked it up
  if (hadPowerup && !snap.powerup) sfx.powerup();
  hadPowerup = !!snap.powerup;
});

socket.on('kick', ({ discId }) => {
  renderer.flashKick(discId);
  sfx.kick();
});

let lastPhase = null;
socket.on('state', (s) => {
  ui.setScore(s.score.red, s.score.blue);
  ui.setClock(s.timeLeftMs);
  ui.setBanner(s.state, s.lastScorer, s.kickoffTeam);
  renderer.setPhase(s.state, s.kickoffTeam);
  ui.setWinner(s.state, s.score);
  ui.setEndControls(s.state, isOwner());
  // sound only on the transition INTO a phase — `state` can resend the same one
  if (s.state !== lastPhase) {
    if (s.state === 'goal') sfx.goal();
    else if (s.state === 'kickoff') sfx.whistle();
    else if (s.state === 'ended') sfx.fullTime();
    lastPhase = s.state;
  }
  route(s.state);
});

// ---------------------------------------------------------------- input
const keys = {};
const MOVE = {
  u: ['KeyW', 'ArrowUp'],
  d: ['KeyS', 'ArrowDown'],
  l: ['KeyA', 'ArrowLeft'],
  r: ['KeyD', 'ArrowRight'],
};
const KICK_KEYS = ['Space', 'KeyX'];
const POWER_KICK_KEYS = ['KeyC'];
const RUN_KEYS = ['ShiftLeft', 'ShiftRight'];
const TRACKED = new Set([
  ...Object.values(MOVE).flat(),
  ...KICK_KEYS,
  ...POWER_KICK_KEYS,
  ...RUN_KEYS,
]);

let lastSent = '';
let chargeWasDown = false; // drives the local charge-meter arc (C key / right mouse)
let mouseKick = false; // left mouse button — same as Space
let mousePower = false; // right mouse button — same as C (hold to charge)
function buildInput() {
  const down = (list) => list.some((k) => keys[k]);
  return {
    u: down(MOVE.u),
    d: down(MOVE.d),
    l: down(MOVE.l),
    r: down(MOVE.r),
    run: RUN_KEYS.some((k) => keys[k]),
    kick: down(KICK_KEYS) || mouseKick,
    pkick: down(POWER_KICK_KEYS) || mousePower,
  };
}
function sendInputIfChanged() {
  if (!inRoom) return;
  const input = buildInput();
  // charge meter is purely visual — the server counts the real charge time
  if (input.pkick !== chargeWasDown) {
    chargeWasDown = input.pkick;
    renderer.setKickCharge(input.pkick ? performance.now() : null);
  }
  const sig = `${+input.u}${+input.d}${+input.l}${+input.r}${+input.run}${+input.kick}${+input.pkick}`;
  if (sig !== lastSent) {
    lastSent = sig;
    socket.emit('input', input);
  }
}

addEventListener('keydown', (e) => {
  if (!inRoom || !TRACKED.has(e.code)) return;
  e.preventDefault();
  if (!keys[e.code]) {
    keys[e.code] = true;
    sendInputIfChanged();
  }
});
addEventListener('keyup', (e) => {
  if (!TRACKED.has(e.code)) return;
  keys[e.code] = false;
  sendInputIfChanged();
});
addEventListener('blur', () => {
  for (const k of Object.keys(keys)) keys[k] = false;
  mouseKick = false;
  mousePower = false;
  sendInputIfChanged();
});

// ---------------------------------------------------------------- mouse kicks
// Left click = kick (Space), right click = charged kick (hold like C, release
// to shoot). Active only on the match screen, and never over UI controls.
const gameScreen = $('game');
const overUi = (e) => e.target.closest('button, input, a, select');
addEventListener('mousedown', (e) => {
  if (!inRoom || gameScreen.classList.contains('hidden') || overUi(e)) return;
  if (e.button === 0) mouseKick = true;
  else if (e.button === 2) mousePower = true;
  else return;
  e.preventDefault();
  sendInputIfChanged();
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseKick = false;
  else if (e.button === 2) mousePower = false;
  else return;
  sendInputIfChanged();
});
// right-click charging must not pop the context menu mid-match
gameScreen.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- render loop
function frame() {
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
