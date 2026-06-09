// Canvas rendering with entity interpolation. The client renders the world
// ~INTERP_DELAY_MS in the past, lerping between the two surrounding snapshots.
// This hides jitter and packet loss. Decoupled from the network rate via rAF.

import {
  INTERP_DELAY_MS,
  KICKOFF_KEEPOUT_RADIUS,
  POWERUP_RADIUS,
  GIANT_SCALE,
} from '/shared/constants.js';

const COLORS = {
  red: '#e15a4a',
  blue: '#4a78e1',
  ballFill: '#ffffff',
  ballStroke: '#222222',
  post: '#dddddd',
  line: 'rgba(255,255,255,.35)',
};
// per power-up colors + a single-char glyph drawn on the orb / used for buff auras
const PU_COLORS = {
  speed: '#7ed982',
  mega: '#f4b13e',
  freeze: '#5ad1e1',
  frozen: '#5ad1e1',
  giant: '#b67ae1',
};
const PU_GLYPH = { speed: 'S', mega: 'K', freeze: 'F', giant: 'G' };
const BUFFER_MAX = 30;
const KICK_FLASH_MS = 240;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.init = null; // gameInit: stadium + static disc info
    this.staticById = new Map(); // discId -> {kind, radius, team}
    this.nameByDisc = new Map(); // discId -> player name
    this.selfDiscId = null;
    this.buffer = []; // [{recvTime, byId:Map id->{x,y}}]
    this.phase = null; // current room state
    this.kickoffTeam = null; // team taking the kickoff (post-goal); null otherwise
    this.kickFlashById = new Map(); // discId -> performance.now()
    this.powerup = null; // { type, x, y } orb on the pitch (powerups mode)
  }

  setPhase(state, kickoffTeam) {
    this.phase = state;
    this.kickoffTeam = kickoffTeam || null;
  }

  setInit(init) {
    this.init = init;
    this.staticById.clear();
    for (const d of init.discs) this.staticById.set(d.id, d);
    this.kickFlashById.clear();
    this.nameByDisc.clear();
    for (const p of init.players || []) this.nameByDisc.set(p.discId, p.name);
    // resize canvas to stadium
    this.canvas.width = init.stadium.width;
    this.canvas.height = init.stadium.height;
  }

  setSelfDisc(id) {
    this.selfDiscId = id;
  }

  pushSnapshot(snap) {
    const byId = new Map();
    for (const d of snap.discs) {
      byId.set(d.id, {
        x: d.x,
        y: d.y,
        stamina: d.stamina,
        exhausted: !!d.exhausted,
        sprinting: !!d.sprinting,
        buffs: d.buffs || null,
      });
    }
    this.buffer.push({ recvTime: performance.now(), byId });
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
    this.powerup = snap.powerup || null; // not interpolated — static while present
  }

  flashKick(discId) {
    this.kickFlashById.set(discId, performance.now());
  }

  // positions for `renderTime`, interpolated between surrounding snapshots
  _interpolated(renderTime) {
    const buf = this.buffer;
    if (buf.length === 0) return null;
    if (buf.length === 1) return buf[0].byId;

    // find pair a,b with a.recvTime <= renderTime <= b.recvTime
    let a = buf[0],
      b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].recvTime <= renderTime && renderTime <= buf[i + 1].recvTime) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
    }
    if (renderTime <= buf[0].recvTime) return buf[0].byId;
    if (renderTime >= b.recvTime) return b.byId;

    const span = b.recvTime - a.recvTime || 1;
    const f = (renderTime - a.recvTime) / span;
    const out = new Map();
    for (const [id, pb] of b.byId) {
      const pa = a.byId.get(id);
      if (pa) {
        out.set(id, {
          x: pa.x + (pb.x - pa.x) * f,
          y: pa.y + (pb.y - pa.y) * f,
          stamina:
            typeof pa.stamina === 'number' && typeof pb.stamina === 'number'
              ? pa.stamina + (pb.stamina - pa.stamina) * f
              : pb.stamina,
          exhausted: pb.exhausted,
          sprinting: pb.sprinting,
          buffs: pb.buffs,
        });
      } else out.set(id, pb);
    }
    return out;
  }

  render() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.init) return;

    this._drawField();

    const positions = this._interpolated(performance.now() - INTERP_DELAY_MS);
    if (!positions) return;

    // post-goal kickoff: show the scoring team's keep-out ring around the ball
    if (this.phase === 'kickoff' && this.kickoffTeam) this._drawKeepOut(positions);

    // power-up orb sits under the discs so players visibly cover it on pickup
    if (this.powerup) this._drawPowerup();

    // posts first, then ball, then players (players on top)
    const now = performance.now();
    const order = { post: 0, ball: 1, player: 2 };
    const ids = [...positions.keys()].sort(
      (i, j) => (order[this.staticById.get(i)?.kind] ?? 1) - (order[this.staticById.get(j)?.kind] ?? 1)
    );
    for (const id of ids) {
      const s = this.staticById.get(id);
      const p = positions.get(id);
      if (!s) continue;
      this._drawDisc(p, s, id === this.selfDiscId, id, now);
    }
    // names go on top of all discs so they're never overlapped
    for (const id of ids) {
      const s = this.staticById.get(id);
      const p = positions.get(id);
      if (s && s.kind === 'player') this._drawName(p, s, this.nameByDisc.get(id), id === this.selfDiscId);
    }
  }

  _drawField() {
    const { ctx, init } = this;
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    for (const seg of init.stadium.segments) {
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
      ctx.stroke();
    }
    const w = init.stadium.width,
      h = init.stadium.height;
    ctx.beginPath();
    ctx.moveTo(w / 2, 40);
    ctx.lineTo(w / 2, h - 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 70, 0, Math.PI * 2);
    ctx.stroke();
  }

  // effective draw radius — 'giant' buff grows the disc to match the server
  _effRadius(p, s) {
    const giant = s.kind === 'player' && Array.isArray(p.buffs) && p.buffs.includes('giant');
    return s.radius * (giant ? GIANT_SCALE : 1);
  }

  _drawDisc(p, s, isSelf, id, now) {
    const { ctx } = this;
    const radius = this._effRadius(p, s);
    let fill = COLORS.post,
      stroke = null;
    if (s.kind === 'ball') {
      fill = COLORS.ballFill;
      stroke = COLORS.ballStroke;
    } else if (s.kind === 'player') {
      fill = s.team === 'blue' ? COLORS.blue : COLORS.red;
      stroke = isSelf ? '#fff' : 'rgba(0,0,0,.45)';
    }
    const kickFlash = s.kind === 'player' ? this._kickFlashAmount(id, now) : 0;
    if (kickFlash > 0) this._drawKickFlash(p, { radius }, kickFlash);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = isSelf && s.kind === 'player' ? 3 : 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    if (kickFlash > 0) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 2, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,245,170,${0.85 * kickFlash})`;
      ctx.stroke();
    }
    if (s.kind === 'player' && Array.isArray(p.buffs) && p.buffs.length) {
      this._drawBuffAuras(p, radius);
    }
    if (isSelf && s.kind === 'player') this._drawStamina(p, { radius });
  }

  // concentric glowing rings, one per active buff/debuff, in that buff's color
  _drawBuffAuras(p, radius) {
    const { ctx } = this;
    ctx.save();
    let i = 0;
    for (const b of p.buffs) {
      const c = PU_COLORS[b];
      if (!c) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4 + i * 3, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 8;
      ctx.stroke();
      i++;
    }
    ctx.restore();
  }

  _drawStamina(p, s) {
    if (typeof p.stamina !== 'number') return;
    const { ctx } = this;
    const pct = Math.max(0, Math.min(1, p.stamina / 100));
    const w = 38;
    const h = 5;
    const x = p.x - w / 2;
    const y = p.y + s.radius + 7;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.38)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = p.exhausted ? '#f06d5f' : p.sprinting ? '#f4d35e' : '#7ed982';
    ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * pct), h - 2);
    ctx.restore();
  }

  _kickFlashAmount(id, now) {
    const started = this.kickFlashById.get(id);
    if (started === undefined) return 0;
    const age = now - started;
    if (age >= KICK_FLASH_MS) {
      this.kickFlashById.delete(id);
      return 0;
    }
    return 1 - age / KICK_FLASH_MS;
  }

  _drawKickFlash(p, s, amount) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.38 * amount;
    ctx.shadowColor = 'rgba(255,245,170,.95)';
    ctx.shadowBlur = 18 * amount;
    ctx.fillStyle = '#fff5aa';
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.radius + 9 * amount, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawKeepOut(positions) {
    // find the ball's interpolated position
    let ballId = null;
    for (const [id, s] of this.staticById) {
      if (s.kind === 'ball') {
        ballId = id;
        break;
      }
    }
    const b = ballId != null ? positions.get(ballId) : null;
    if (!b) return;
    const lockedTeam = this.kickoffTeam === 'red' ? 'blue' : 'red';
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = lockedTeam === 'blue' ? 'rgba(74,120,225,.8)' : 'rgba(225,90,74,.8)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, KICKOFF_KEEPOUT_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawPowerup() {
    const pu = this.powerup;
    const { ctx } = this;
    const c = PU_COLORS[pu.type] || '#ffffff';
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, POWERUP_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1c1c1c';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PU_GLYPH[pu.type] || '?', pu.x, pu.y + 1);
    ctx.restore();
  }

  _drawName(p, s, name, isSelf) {
    if (!name) return;
    const { ctx } = this;
    ctx.font = `${isSelf ? '600 ' : ''}13px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const y = p.y - this._effRadius(p, s) - 5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(name, p.x, y); // outline for legibility on the pitch
    ctx.fillStyle = isSelf ? '#fff' : '#eaeaea';
    ctx.fillText(name, p.x, y);
  }
}
