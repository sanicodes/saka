// Client entry: connects to the server, captures input, buffers snapshots,
// and drives the render loop. Sends INPUTS ONLY — never positions.
// Screens: global lobby (room list) -> room lobby (roster + host settings) -> match.

import { Renderer } from '/render.js';
import { ui } from '/ui.js';

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
  try {
    localStorage.setItem('saka:name', n);
  } catch {}
  $('whoami').textContent = n;
  ui.show('lobby');
  socket.emit('lobby:join'); // (re)subscribe + refresh room list
}

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

function joinRoom(roomId, locked) {
  let password;
  if (locked) {
    password = prompt('This room is locked. Enter the password:');
    if (password === null) return; // cancelled
  }
  ui.setError('');
  socket.emit('room:join', { roomId, playerName: playerName(), password }, (res) => {
    if (res?.error) return ui.setError(res.error);
    enterRoom(res.selfId);
  });
}

$('createBtn').onclick = () => {
  ui.setError('');
  const name = ($('roomName').value || '').trim() || `${playerName()}'s room`;
  const password = ($('roomPass').value || '').trim();
  socket.emit('room:create', { name, playerName: playerName(), password }, (res) => {
    if (res?.error) return ui.setError(res.error);
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
  inRoom = false;
  roomData = null;
  renderer.init = null;
  renderer.buffer = [];
  ui.setWinner('lobby'); // clear the result overlay
  ui.show('lobby');
}
$('leaveBtn').onclick = leaveRoom;
$('rlLeave').onclick = leaveRoom;

// ---------------------------------------------------------------- room actions
$('startBtn').onclick = () => socket.emit('room:start');
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

socket.on('snapshot', (snap) => {
  renderer.pushSnapshot(snap);
  ui.setScore(snap.score[0], snap.score[1]);
  ui.setClock(snap.timeLeftMs);
});

socket.on('kick', ({ discId }) => {
  renderer.flashKick(discId);
});

socket.on('state', (s) => {
  ui.setScore(s.score.red, s.score.blue);
  ui.setClock(s.timeLeftMs);
  ui.setBanner(s.state, s.lastScorer, s.kickoffTeam);
  renderer.setPhase(s.state, s.kickoffTeam);
  ui.setWinner(s.state, s.score);
  ui.setEndControls(s.state, isOwner());
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
function buildInput() {
  const down = (list) => list.some((k) => keys[k]);
  return {
    u: down(MOVE.u),
    d: down(MOVE.d),
    l: down(MOVE.l),
    r: down(MOVE.r),
    run: RUN_KEYS.some((k) => keys[k]),
    kick: KICK_KEYS.some((k) => keys[k]),
    pkick: POWER_KICK_KEYS.some((k) => keys[k]),
  };
}
function sendInputIfChanged() {
  if (!inRoom) return;
  const input = buildInput();
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
  sendInputIfChanged();
});

// ---------------------------------------------------------------- render loop
function frame() {
  renderer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
