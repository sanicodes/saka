// DOM helpers: global lobby list, room-lobby roster + settings, scoreboard,
// banner, post-match controls. Pure view layer — main.js owns state/sockets.

const $ = (id) => document.getElementById(id);

const STATE_LABEL = {
  lobby: '',
  waiting: 'Waiting for players…',
  kickoff: 'Get ready…',
  play: '',
  goal: 'GOAL!',
  ended: 'Full time',
};

const TIME_OPTS = [
  { label: '3 min', value: 180000 },
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '∞', value: 0 },
];
const SCORE_OPTS = [
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '10', value: 10 },
  { label: '∞', value: 0 },
];

export const ui = {
  show(screen) {
    $('welcome').classList.toggle('hidden', screen !== 'welcome');
    $('lobby').classList.toggle('hidden', screen !== 'lobby');
    $('roomlobby').classList.toggle('hidden', screen !== 'roomlobby');
    $('game').classList.toggle('hidden', screen !== 'game');
  },

  setError(msg) {
    $('lobbyErr').textContent = msg || '';
  },

  // ---- global lobby (room list) ----
  renderRoomList(rooms, onJoin) {
    const list = $('roomList');
    list.innerHTML = '';
    if (!rooms.length) {
      list.innerHTML = '<div class="empty">No rooms yet — create one!</div>';
      return;
    }
    for (const r of rooms) {
      const card = document.createElement('div');
      card.className = 'roomcard';
      const playing = r.state !== 'lobby' && r.state !== 'ended';
      const lock = r.locked ? '🔒 ' : '';
      card.innerHTML = `
        <div>
          <div>${lock}${escapeHtml(r.name)}</div>
          <div class="meta">${r.players}/${r.max} players · ${playing ? 'in progress' : 'open'}</div>
        </div>`;
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = r.players >= r.max ? 'Full' : 'Join';
      btn.disabled = r.players >= r.max;
      btn.onclick = () => onJoin(r.id, r.locked);
      card.appendChild(btn);
      list.appendChild(card);
    }
  },

  // ---- room lobby (roster + settings) ----
  renderRoom(room, selfId, handlers) {
    $('rlName').textContent = room.name;
    const isOwner = room.ownerId === selfId;
    $('rlHostTag').classList.toggle('hidden', !isOwner);

    const cols = { red: $('rlRed'), blue: $('rlBlue'), spec: $('rlSpec') };
    for (const k in cols) cols[k].innerHTML = '';
    for (const p of room.players) {
      const li = document.createElement('li');
      let label = p.id === room.ownerId ? `★ ${p.name}` : p.name;
      if (p.id === selfId) {
        label += ' (you)';
        li.className = 'self';
      }
      li.textContent = label;
      (cols[p.team] || cols.spec).appendChild(li);
    }

    renderOpts($('rlTime'), TIME_OPTS, room.settings.timeLimitMs, isOwner, (v) =>
      handlers.onSetting({ timeLimitMs: v })
    );
    renderOpts($('rlScore'), SCORE_OPTS, room.settings.scoreLimit, isOwner, (v) =>
      handlers.onSetting({ scoreLimit: v })
    );
    const stadiumOpts = room.stadiums.map((s) => ({ label: s.name, value: s.key }));
    renderOpts($('rlStadium'), stadiumOpts, room.settings.stadiumKey, isOwner, (v) =>
      handlers.onSetting({ stadiumKey: v })
    );

    const ready =
      room.players.some((p) => p.team === 'red') && room.players.some((p) => p.team === 'blue');
    $('startBtn').classList.toggle('hidden', !isOwner);
    $('startBtn').disabled = !ready;
    if (isOwner) {
      $('rlWait').textContent = ready ? '' : 'Put at least one player on each team to start.';
    } else {
      $('rlWait').textContent = 'Waiting for the host to start the match…';
    }
  },

  // ---- in-match ----
  setScore(red, blue) {
    $('scoreRed').textContent = red;
    $('scoreBlue').textContent = blue;
  },

  setClock(ms) {
    if (ms === null || ms === undefined) {
      $('clock').textContent = '∞';
      return;
    }
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    $('clock').textContent = `${m}:${String(s).padStart(2, '0')}`;
  },

  setBanner(state, lastScorer, kickoffTeam) {
    let text = STATE_LABEL[state] ?? '';
    if (state === 'goal' && lastScorer) {
      text = `GOAL — ${lastScorer === 'red' ? 'Red' : 'Blue'} scores!`;
    } else if (state === 'kickoff') {
      text = kickoffTeam
        ? `${kickoffTeam === 'red' ? 'Red' : 'Blue'} to kick off`
        : 'Kick off!';
    }
    $('banner').textContent = text;
  },

  // roster panel beside the pitch during a match
  renderMatchRoster(players, selfId) {
    const cols = { red: $('srRed'), blue: $('srBlue'), spec: $('srSpec') };
    const counts = { red: 0, blue: 0, spec: 0 };
    for (const k in cols) cols[k].innerHTML = '';
    for (const p of players) {
      const team = cols[p.team] ? p.team : 'spec';
      counts[team]++;
      const li = document.createElement('li');
      li.textContent = p.id === selfId ? `${p.name} (you)` : p.name;
      if (p.id === selfId) li.className = 'self';
      cols[team].appendChild(li);
    }
    for (const k of ['red', 'blue', 'spec']) {
      if (counts[k] === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '—';
        cols[k].appendChild(li);
      }
    }
    $('srRedCount').textContent = counts.red;
    $('srBlueCount').textContent = counts.blue;
    $('srSpecCount').textContent = counts.spec;
  },

  // big winner overlay on the pitch at full time
  setWinner(state, score) {
    const el = $('winner');
    if (state !== 'ended') {
      el.classList.add('hidden');
      return;
    }
    const r = Array.isArray(score) ? score[0] : score.red;
    const b = Array.isArray(score) ? score[1] : score.blue;
    let title, color;
    if (r > b) {
      title = 'Red wins!';
      color = 'var(--red)';
    } else if (b > r) {
      title = 'Blue wins!';
      color = 'var(--blue)';
    } else {
      title = "It's a draw";
      color = '#e8e8e8';
    }
    el.innerHTML =
      `<div class="big" style="color:${color}">${title}</div>` +
      `<div class="fin">Final score ${r} — ${b}</div>`;
    el.classList.remove('hidden');
  },

  // post-match controls. The room auto-returns to the lobby shortly; the host
  // can skip the wait with "Play again" (same teams).
  setEndControls(state, isOwner) {
    const ended = state === 'ended';
    $('rematchBtn').classList.toggle('hidden', !(ended && isOwner));
    const note = $('endNote');
    note.classList.toggle('hidden', !ended);
    if (ended) {
      note.textContent = isOwner
        ? 'Returning to the room lobby… (or play again)'
        : 'Returning to the room lobby…';
    }
  },
};

function renderOpts(container, opts, selected, editable, onPick) {
  container.innerHTML = '';
  for (const o of opts) {
    const b = document.createElement('button');
    b.textContent = o.label;
    if (o.value === selected) b.className = 'sel';
    b.disabled = !editable;
    b.onclick = () => onPick(o.value);
    container.appendChild(b);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
