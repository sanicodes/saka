// One game room. Phases: lobby -> kickoff -> play -> goal -> (kickoff | ended).
// In `lobby`, players pick teams/spectate and the OWNER configures settings and
// starts the match; the 60 Hz physics loop only runs while a match is live.
// The server is the only source of truth; clients send inputs, never positions.

import { stepWorld } from '../shared/physics.js';
import { STADIUMS, getStadium } from '../shared/stadiums.js';
import {
  makeBall,
  makePosts,
  makePlayer,
  applyMoveInput,
  resetPlayerStamina,
  tryKick,
} from '../shared/factory.js';
import { clamp } from '../shared/physics.js';
import {
  SOLVER_PASSES,
  SNAPSHOT_HZ,
  SCORE_LIMIT,
  TIME_LIMIT_MS,
  GOAL_CELEBRATION_MS,
  END_SCREEN_MS,
  MAX_PLAYERS_PER_ROOM,
  CGROUP_ALL,
  CGROUP_BALL,
  KICKOFF_START_SPEED,
  KICKOFF_KEEPOUT_RADIUS,
  STAMINA_MAX,
  KICK_STRENGTH,
  POWER_KICK_STRENGTH,
  PLAYER_RADIUS,
  POWERUP_TYPES,
  POWERUP_RADIUS,
  POWERUP_FIRST_SPAWN_MS,
  POWERUP_RESPAWN_MS,
  POWERUP_BUFF_MS,
  POWERUP_FREEZE_MS,
  SPEED_BUFF_MULT,
  MEGA_KICK_MULT,
  GIANT_SCALE,
} from '../shared/constants.js';

const TICK_HZ = 60;
const MS_PER_TICK = 1000 / TICK_HZ;
const SNAPSHOT_EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ);
const msToTicks = (ms) => Math.round((ms / 1000) * TICK_HZ);

// settings bounds (server clamps everything — clients are hostile)
const MAX_SCORE_LIMIT = 20; // 0 = unlimited
const MIN_TIME_MS = 60 * 1000;
const MAX_TIME_MS = 30 * 60 * 1000; // 0 = unlimited

export class Room {
  constructor(io, { id, name, stadiumKey = 'classic', password = null }) {
    this.io = io;
    this.id = id;
    this.name = name;
    this.password = password || null; // null = open room
    this.stadiumKey = STADIUMS[stadiumKey] ? stadiumKey : 'classic';
    this.stadium = getStadium(this.stadiumKey);

    this.settings = {
      scoreLimit: SCORE_LIMIT,
      timeLimitMs: TIME_LIMIT_MS,
      stadiumKey: this.stadiumKey,
      mode: 'classic', // 'classic' | 'powerups'
    };

    this.powerup = null; // { type, x, y } currently on the pitch (powerups mode)
    this.powerupTimer = 0; // ticks until the next power-up spawns

    this.players = new Map(); // socketId -> player (insertion order = join order)
    this.ownerId = null;
    this.ball = makeBall(this.stadium);
    this.posts = makePosts(this.stadium);

    this.score = { red: 0, blue: 0 };
    this.state = 'lobby';
    this.stateTicks = 0;
    this.elapsedMs = 0;
    this.tick = 0;
    this.lastScorer = null;
    this.kickoffLockTeam = null; // team barred from the ball during a kickoff (the scorers)

    this.loop = null;
    this.endTimer = null; // schedules auto-return to lobby after a match ends
  }

  // discs the engine sees: active (non-spectator) players + ball + posts
  get discs() {
    const arr = [];
    for (const p of this.players.values()) {
      if (p.team !== 'spec' && p.disc) arr.push(p.disc);
    }
    arr.push(this.ball);
    for (const post of this.posts) arr.push(post);
    return arr;
  }

  get count() {
    return this.players.size;
  }
  isFull() {
    return this.players.size >= MAX_PLAYERS_PER_ROOM;
  }
  isOwner(socketId) {
    return this.ownerId === socketId;
  }
  _teamCounts() {
    const counts = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      if (p.team === 'red' || p.team === 'blue') counts[p.team]++;
    }
    return counts;
  }

  _endIfTeamForfeit() {
    if (!this._isLive()) return false;
    const counts = this._teamCounts();
    if (counts.red > 0 && counts.blue === 0) {
      this._endMatch('red');
      return true;
    }
    if (counts.blue > 0 && counts.red === 0) {
      this._endMatch('blue');
      return true;
    }
    if (counts.red === 0 && counts.blue === 0) {
      this._endMatch();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- players
  addPlayer(socketId, name) {
    const player = {
      id: socketId,
      name: (name || 'Player').slice(0, 16),
      team: 'spec', // default: spectator — players explicitly pick a side
      input: { u: false, d: false, l: false, r: false, run: false },
      kickHeld: false,
      pendingKick: false,
      powerHeld: false,
      pendingPower: false,
      disc: null,
    };
    this.players.set(socketId, player);
    if (!this.ownerId) this.ownerId = socketId;
    this.sendRoom();
    return player;
  }

  removePlayer(socketId) {
    const wasOwner = this.ownerId === socketId;
    this.players.delete(socketId);
    if (this.players.size === 0) {
      this._clearEndTimer();
      this.stop();
      return;
    }
    if (wasOwner) this.ownerId = this.players.keys().next().value; // earliest joiner
    if (this._endIfTeamForfeit()) return;
    this.sendRoom();
    if (this._isLive()) this.sendInit(); // disc set may have changed mid-match
  }

  setInput(socketId, input) {
    const p = this.players.get(socketId);
    if (!p) return;
    p.input = { u: !!input.u, d: !!input.d, l: !!input.l, r: !!input.r, run: !!input.run };
    const kick = !!input.kick;
    if (kick && !p.kickHeld) p.pendingKick = true; // rising edge
    p.kickHeld = kick;
    const power = !!input.pkick;
    if (power && !p.powerHeld) p.pendingPower = true; // rising edge
    p.powerHeld = power;
  }

  setTeam(socketId, team) {
    const p = this.players.get(socketId);
    if (!p || !['red', 'blue', 'spec'].includes(team)) return;
    p.team = team;
    if (team === 'spec') p.disc = null;
    else this._placePlayer(p);
    if (this.state === 'kickoff') this._applyKickoffMasks(); // keep the lock consistent
    if (this._endIfTeamForfeit()) return;
    this.sendRoom();
    if (this._isLive()) this.sendInit();
  }

  // owner-only, lobby-only: randomly re-deal the current participants (everyone
  // already on red/blue) into two balanced teams. Spectators are left alone.
  shuffleTeams(socketId) {
    if (!this.isOwner(socketId) || this.state !== 'lobby') return;
    const pool = [...this.players.values()].filter((p) => p.team === 'red' || p.team === 'blue');
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1)); // Fisher-Yates
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool.forEach((p, i) => {
      p.team = i % 2 === 0 ? 'red' : 'blue';
      this._placePlayer(p);
    });
    this.sendRoom();
  }

  _placePlayer(player) {
    const team = player.team === 'blue' ? 'blue' : 'red';
    const spawns = team === 'blue' ? this.stadium.spawnBlue : this.stadium.spawnRed;
    let idx = 0;
    for (const p of this.players.values()) {
      if (p === player) break;
      if (p.team === player.team) idx++;
    }
    const [x, y] = spawns[idx % spawns.length];
    if (!player.disc) player.disc = makePlayer(x, y, team);
    player.disc.team = team;
    player.disc.x = x;
    player.disc.y = y;
    player.disc.vx = 0;
    player.disc.vy = 0;
    resetPlayerStamina(player.disc);
  }

  // ---------------------------------------------------------------- owner actions
  setSettings(socketId, s = {}) {
    if (!this.isOwner(socketId) || this.state !== 'lobby') return;
    if (s.scoreLimit !== undefined) {
      this.settings.scoreLimit = clamp(Math.round(+s.scoreLimit) || 0, 0, MAX_SCORE_LIMIT);
    }
    if (s.timeLimitMs !== undefined) {
      const t = Math.round(+s.timeLimitMs) || 0;
      this.settings.timeLimitMs = t === 0 ? 0 : clamp(t, MIN_TIME_MS, MAX_TIME_MS);
    }
    if (s.stadiumKey !== undefined && STADIUMS[s.stadiumKey]) {
      this._setStadium(s.stadiumKey);
    }
    if (s.mode === 'classic' || s.mode === 'powerups') {
      this.settings.mode = s.mode;
    }
    this.sendRoom();
  }

  _setStadium(key) {
    this.stadiumKey = key;
    this.settings.stadiumKey = key;
    this.stadium = getStadium(key);
    this.ball = makeBall(this.stadium);
    this.posts = makePosts(this.stadium);
    for (const p of this.players.values()) {
      if (p.team !== 'spec') this._placePlayer(p);
    }
  }

  startMatch(socketId) {
    if (!this.isOwner(socketId) || this.state !== 'lobby') return;
    const counts = this._teamCounts();
    if (counts.red < 1 || counts.blue < 1) return; // need one player on each side
    this.score = { red: 0, blue: 0 };
    this.elapsedMs = 0;
    this.lastScorer = null;
    this._enterKickoff();
    if (!this.loop) this.loop = setInterval(() => this._frame(), MS_PER_TICK);
  }

  // host early-out: skip the end screen and replay immediately with same teams
  rematch(socketId) {
    if (!this.isOwner(socketId) || this.state !== 'ended') return;
    this._clearEndTimer();
    this.score = { red: 0, blue: 0 };
    this.elapsedMs = 0;
    this.lastScorer = null;
    this._enterKickoff();
    if (!this.loop) this.loop = setInterval(() => this._frame(), MS_PER_TICK);
  }

  // return to the room lobby (roster + settings), keeping everyone in the room
  _toLobby() {
    this._clearEndTimer();
    this.stop();
    this.state = 'lobby';
    this.score = { red: 0, blue: 0 };
    this.elapsedMs = 0;
    this.lastScorer = null;
    this._resetPositions();
    this.sendRoom();
  }

  // ---------------------------------------------------------------- loop
  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  _clearEndTimer() {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  _isLive() {
    return this.state === 'kickoff' || this.state === 'play' || this.state === 'goal';
  }

  _frame() {
    this.tick++;
    this._simulate();
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  _simulate() {
    for (const p of this.players.values()) {
      if (p.team === 'spec' || !p.disc) continue;
      const buffs = p.disc.buffs || {};
      const frozen = (buffs.frozen ?? 0) > 0;
      const mods = { frozen, accelMul: (buffs.speed ?? 0) > 0 ? SPEED_BUFF_MULT : 1 };
      applyMoveInput(p.disc, { ...p.input, kick: p.kickHeld || p.powerHeld }, mods);
      if ((p.pendingKick || p.pendingPower) && !frozen) {
        // kicks land during play, and during a kickoff only for the team that
        // is allowed to take it (the scoring team is locked out until live)
        const canKick =
          this.state === 'play' ||
          (this.state === 'kickoff' && p.team !== this.kickoffLockTeam);
        if (canKick) {
          let strength = p.pendingPower ? POWER_KICK_STRENGTH : KICK_STRENGTH;
          if ((buffs.mega ?? 0) > 0) strength *= MEGA_KICK_MULT;
          this.broadcastKick(p.disc.id);
          tryKick(p.disc, this.ball, true, strength);
        }
      }
      p.pendingKick = false;
      p.pendingPower = false;
    }

    stepWorld(this.discs, this.stadium.segments, SOLVER_PASSES);
    this._containDiscs();
    this._tickBuffs();
    this._updatePowerups();

    if (this.state === 'kickoff') {
      // keep the scoring team physically away from the ball, then start the round
      // only when an ELIGIBLE player (not the scoring team) touches it.
      this._enforceKickoffKeepOut();
      const ballMoving = Math.hypot(this.ball.vx, this.ball.vy) > KICKOFF_START_SPEED;
      if (ballMoving || this._eligibleTouchedBall()) this._enterPlay();
    } else if (this.state === 'goal') {
      if (--this.stateTicks <= 0) this._enterKickoff();
    } else if (this.state === 'play') {
      this.elapsedMs += MS_PER_TICK;
      this._checkGoal();
      const tl = this.settings.timeLimitMs;
      if (tl > 0 && this.elapsedMs >= tl) this._endMatch();
    }
  }

  // Last-resort safety net: pin every disc inside the pitch bounds. Substepping
  // in stepWorld already stops fast movers from tunnelling through walls, so
  // this should never fire in normal play — but if anything (a NaN-adjacent
  // velocity, a spawn overlap, an unforeseen edge) ever pushes a disc out of
  // the world, we clamp it back rather than let it fly off and "disappear".
  // Net pockets sit within [r, dim-r], so this doesn't interfere with goals.
  _containDiscs() {
    const W = this.stadium.width,
      H = this.stadium.height;
    for (const d of this.discs) {
      if (d.invMass === 0) continue;
      const r = d.radius;
      if (d.x < r) {
        d.x = r;
        if (d.vx < 0) d.vx = 0;
      } else if (d.x > W - r) {
        d.x = W - r;
        if (d.vx > 0) d.vx = 0;
      }
      if (d.y < r) {
        d.y = r;
        if (d.vy < 0) d.vy = 0;
      } else if (d.y > H - r) {
        d.y = H - r;
        if (d.vy > 0) d.vy = 0;
      }
    }
  }

  // make the locked (scoring) team's discs pass through the ball; everyone else
  // collides with it normally
  _applyKickoffMasks() {
    for (const p of this.players.values()) {
      if (!p.disc) continue;
      const locked = this.kickoffLockTeam && p.team === this.kickoffLockTeam;
      p.disc.cMask = locked ? CGROUP_ALL & ~CGROUP_BALL : CGROUP_ALL;
    }
  }

  // push the scoring team out of a keep-out bubble around the ball so they can't
  // crowd it during the kickoff (an invisible circular wall, ball-centered)
  _enforceKickoffKeepOut() {
    if (!this.kickoffLockTeam) return;
    const b = this.ball;
    for (const p of this.players.values()) {
      if (p.team !== this.kickoffLockTeam || !p.disc) continue;
      const d = p.disc;
      const minDist = KICKOFF_KEEPOUT_RADIUS + d.radius;
      let dx = d.x - b.x;
      let dy = d.y - b.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= minDist) continue;
      if (dist === 0) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const nx = dx / dist;
      const ny = dy / dist;
      d.x = b.x + nx * minDist; // place exactly on the bubble edge
      d.y = b.y + ny * minDist;
      const vn = d.vx * nx + d.vy * ny; // kill velocity heading into the ball
      if (vn < 0) {
        d.vx -= vn * nx;
        d.vy -= vn * ny;
      }
    }
  }

  // has a player who is NOT on the locked (scoring) team made contact with the ball?
  _eligibleTouchedBall() {
    const b = this.ball;
    for (const p of this.players.values()) {
      if (p.team === 'spec' || !p.disc) continue;
      if (this.kickoffLockTeam && p.team === this.kickoffLockTeam) continue;
      const gap = Math.hypot(b.x - p.disc.x, b.y - p.disc.y) - p.disc.radius - b.radius;
      if (gap <= 1.5) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- power-ups
  // count down every active buff/debuff; restore radius when 'giant' expires
  _tickBuffs() {
    for (const p of this.players.values()) {
      const d = p.disc;
      if (!d || !d.buffs) continue;
      for (const k of Object.keys(d.buffs)) {
        if (--d.buffs[k] <= 0) {
          delete d.buffs[k];
          if (k === 'giant') d.radius = PLAYER_RADIUS;
        }
      }
    }
  }

  // spawn a power-up on a timer and hand it to the first player who touches it
  _updatePowerups() {
    if (this.settings.mode !== 'powerups' || this.state !== 'play') return;
    if (!this.powerup) {
      if (--this.powerupTimer <= 0) this._spawnPowerup();
      return;
    }
    const pu = this.powerup;
    for (const p of this.players.values()) {
      if (p.team === 'spec' || !p.disc) continue;
      const gap = Math.hypot(p.disc.x - pu.x, p.disc.y - pu.y) - p.disc.radius - POWERUP_RADIUS;
      if (gap <= 0) {
        this._collectPowerup(p, pu.type);
        this.powerup = null;
        this.powerupTimer = msToTicks(POWERUP_RESPAWN_MS);
        return;
      }
    }
  }

  _spawnPowerup() {
    const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const m = 80; // keep orbs off the walls/goal mouths
    const x = m + Math.random() * (this.stadium.width - 2 * m);
    const y = m + Math.random() * (this.stadium.height - 2 * m);
    this.powerup = { type, x, y };
  }

  _collectPowerup(player, type) {
    const d = player.disc;
    d.buffs = d.buffs || {};
    if (type === 'freeze') {
      // freeze every opponent for a short window
      const ticks = msToTicks(POWERUP_FREEZE_MS);
      for (const o of this.players.values()) {
        if (o === player || o.team === 'spec' || !o.disc || o.team === player.team) continue;
        o.disc.buffs = o.disc.buffs || {};
        o.disc.buffs.frozen = ticks;
      }
    } else {
      d.buffs[type] = msToTicks(POWERUP_BUFF_MS);
      if (type === 'giant') d.radius = PLAYER_RADIUS * GIANT_SCALE;
    }
  }

  // wipe buffs + any active orb (called each kickoff so every play starts clean)
  _resetPowerState() {
    for (const p of this.players.values()) {
      if (!p.disc) continue;
      p.disc.buffs = {};
      if (p.disc.kind === 'player') p.disc.radius = PLAYER_RADIUS;
    }
    this.powerup = null;
    this.powerupTimer = msToTicks(POWERUP_FIRST_SPAWN_MS);
  }

  _checkGoal() {
    const b = this.ball;
    for (const g of this.stadium.goals) {
      const inMouth = b.y >= g.yTop && b.y <= g.yBottom;
      const crossed = g.side === 'left' ? b.x < g.x : b.x > g.x;
      if (inMouth && crossed) {
        this.score[g.scorer]++;
        this.lastScorer = g.scorer;
        const lim = this.settings.scoreLimit;
        if (lim > 0 && (this.score.red >= lim || this.score.blue >= lim)) {
          this._endMatch();
        } else {
          this._enterGoal();
        }
        return;
      }
    }
  }

  _resetPositions() {
    for (const p of this.players.values()) {
      if (p.team !== 'spec') this._placePlayer(p);
    }
    const [bx, by] = this.stadium.ballSpawn;
    this.ball.x = bx;
    this.ball.y = by;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  _enterKickoff() {
    this._resetPositions();
    this._resetPowerState();
    this.state = 'kickoff';
    // after a goal, the scorers are locked out of the ball until the conceding
    // team takes the kickoff; the very first kickoff of a match has no lock
    this.kickoffLockTeam = this.lastScorer;
    this._applyKickoffMasks();
    this.sendInit(); // static render data for the (possibly new) match
    this.broadcastState();
  }
  _enterPlay() {
    this.state = 'play';
    this.kickoffLockTeam = null; // ball is live for everyone now
    this._applyKickoffMasks();
    this.broadcastState();
  }
  _enterGoal() {
    this.state = 'goal';
    this.stateTicks = msToTicks(GOAL_CELEBRATION_MS);
    this.broadcastState();
  }
  _endMatch(winner = null) {
    if (winner) {
      const loser = winner === 'red' ? 'blue' : 'red';
      this.score[winner] = Math.max(this.score[winner], this.score[loser] + 1);
      this.lastScorer = winner;
    }
    this.state = 'ended';
    this.kickoffLockTeam = null;
    this.stop();
    this.sendRoom();
    this.broadcastState();
    // show the winner overlay, then automatically return everyone to the room lobby
    this.endTimer = setTimeout(() => {
      if (this.state === 'ended') this._toLobby();
    }, END_SCREEN_MS);
  }

  // ---------------------------------------------------------------- net out
  timeLeftMs() {
    const tl = this.settings.timeLimitMs;
    return tl > 0 ? Math.max(0, tl - this.elapsedMs) : null; // null = unlimited
  }

  // lobby/meta state: roster, owner, settings, phase
  roomData() {
    return {
      roomId: this.id,
      name: this.name,
      ownerId: this.ownerId,
      state: this.state,
      score: this.score,
      settings: this.settings,
      stadiums: Object.keys(STADIUMS).map((k) => ({ key: k, name: STADIUMS[k].name })),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
      })),
    };
  }
  sendRoom() {
    this.io.to(this.id).emit('room', this.roomData());
  }

  // static render data: stadium geometry + disc identities
  initData() {
    return {
      roomId: this.id,
      name: this.name,
      stadium: {
        width: this.stadium.width,
        height: this.stadium.height,
        segments: this.stadium.segments,
        goals: this.stadium.goals,
      },
      discs: this.discs.map((d) => ({
        id: d.id,
        kind: d.kind,
        radius: d.radius,
        team: d.team || null,
      })),
      players: [...this.players.values()]
        .filter((p) => p.team !== 'spec' && p.disc)
        .map((p) => ({ id: p.id, name: p.name, team: p.team, discId: p.disc.id })),
      score: this.score,
      settings: this.settings,
      state: this.state,
    };
  }
  sendInit() {
    this.io.to(this.id).emit('gameInit', this.initData());
  }

  broadcastState() {
    this.io.to(this.id).emit('state', {
      state: this.state,
      score: this.score,
      lastScorer: this.lastScorer,
      // team taking the kickoff = whoever the scorers are NOT (null on first kickoff)
      kickoffTeam: this.kickoffLockTeam ? (this.kickoffLockTeam === 'red' ? 'blue' : 'red') : null,
      timeLeftMs: this.timeLeftMs(),
    });
  }
  broadcastKick(discId) {
    this.io.to(this.id).emit('kick', { discId });
  }

  snapshot() {
    return {
      t: this.tick,
      discs: this.discs.map((d) => ({
        id: d.id,
        x: Math.round(d.x),
        y: Math.round(d.y),
        vx: Math.round(d.vx * 100),
        vy: Math.round(d.vy * 100),
        stamina:
          d.kind === 'player' ? Math.round(((d.stamina ?? STAMINA_MAX) / STAMINA_MAX) * 100) : null,
        exhausted: d.kind === 'player' ? !!d.exhausted : false,
        sprinting: d.kind === 'player' ? !!d.isSprinting : false,
        buffs:
          d.kind === 'player' && d.buffs && Object.keys(d.buffs).length ? Object.keys(d.buffs) : null,
      })),
      powerup: this.powerup ? { type: this.powerup.type, x: Math.round(this.powerup.x), y: Math.round(this.powerup.y) } : null,
      score: [this.score.red, this.score.blue],
      state: this.state,
      timeLeftMs: this.timeLeftMs(),
    };
  }
  broadcastSnapshot() {
    this.io.to(this.id).emit('snapshot', this.snapshot());
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      max: MAX_PLAYERS_PER_ROOM,
      state: this.state,
      locked: !!this.password, // never expose the password itself
    };
  }
}
