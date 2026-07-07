// Canvas rendering with entity interpolation. The client renders the world
// ~INTERP_DELAY_MS in the past, lerping between the two surrounding snapshots.
// This hides jitter and packet loss. Decoupled from the network rate via rAF.

import {
  INTERP_DELAY_MS,
  KICKOFF_KEEPOUT_RADIUS,
  POWERUP_RADIUS,
  GIANT_SCALE,
  KICK_CHARGE_FULL_MS,
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

// Viewport: stadiums up to this size render 1:1 (no camera). Bigger stadiums
// get a scrolling camera that follows YOUR disc (spectators follow the ball),
// plus a minimap. Purely client-side — every player has their own view.
const VIEW_W = 1200;
const VIEW_H = 600;
const CAM_LERP = 0.12; // per-frame smoothing toward the camera target

const clampv = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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
    this.handlerId = null; // disc in close control of the ball (possession ring)
    this.chargeStart = null; // performance.now() when we began charging a kick
    this.cam = null; // {x,y} viewport origin in world coords (big stadiums only)
  }

  // main.js calls this on kick key down (timestamp) / up (null)
  setKickCharge(startTime) {
    this.chargeStart = startTime;
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
    // canvas = viewport; small stadiums render 1:1, big ones scroll
    this.canvas.width = Math.min(init.stadium.width, VIEW_W);
    this.canvas.height = Math.min(init.stadium.height, VIEW_H);
    this.cam = null; // snaps to the target on the first frame
    this._buildGrass();
  }

  // Pre-render the pitch texture once per stadium: alternating mowing stripes
  // with a subtle blade speckle. Drawn as one image each frame — cheap.
  _buildGrass() {
    const W = this.init.stadium.width;
    const H = this.init.stadium.height;
    const g = document.createElement('canvas');
    g.width = W;
    g.height = H;
    const gx = g.getContext('2d');
    const stripe = 80; // mowing band width (vertical bands, like a real pitch)
    for (let x = 0, i = 0; x < W; x += stripe, i++) {
      gx.fillStyle = i % 2 === 0 ? '#3e6f3e' : '#356335';
      gx.fillRect(x, 0, stripe, H);
    }
    // grass blades: tiny vertical flecks, a mix of lighter and darker greens
    const n = Math.floor((W * H) / 200);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      gx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.06)';
      gx.fillRect(x, y, 1, 1.5 + Math.random() * 2);
    }
    // soft edge shading so the pitch reads as lit from the center
    const vg = gx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.18)');
    gx.fillStyle = vg;
    gx.fillRect(0, 0, W, H);
    this.grass = g;
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
        hd: d.hd, // facing (degrees) for the notch
        buffs: d.buffs || null,
      });
    }
    this.buffer.push({ recvTime: performance.now(), byId });
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
    this.powerup = snap.powerup || null; // not interpolated — static while present
    this.handlerId = snap.handler ?? null;
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
          hd: pb.hd, // not interpolated — 30 Hz is smooth enough for a notch
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

    const positions = this._interpolated(performance.now() - INTERP_DELAY_MS);
    const camOn = this._updateCamera(positions);

    ctx.save();
    if (camOn) ctx.translate(-this.cam.x, -this.cam.y);

    this._drawField();

    if (positions) {
      // post-goal kickoff: show the scoring team's keep-out ring around the ball
      if (this.phase === 'kickoff' && this.kickoffTeam) this._drawKeepOut(positions);

      // power-up orb sits under the discs so players visibly cover it on pickup
      if (this.powerup) this._drawPowerup();

      // possession ring sits under the ball, in the handler's team color
      if (this.handlerId != null) this._drawPossession(positions);

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

      // charge meter arc around our own disc while the kick key is held
      this._drawCharge(positions, now);
    }

    ctx.restore();

    // minimap only when there's more pitch than viewport
    if (camOn && positions) this._drawMinimap(positions);
  }

  // Follow-cam for stadiums bigger than the viewport: center on our own disc
  // (spectators / not-yet-spawned follow the ball), clamped to the pitch and
  // smoothed. Returns whether the camera is active.
  _updateCamera(positions) {
    const W = this.init.stadium.width;
    const H = this.init.stadium.height;
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    if (W <= vw && H <= vh) {
      this.cam = null;
      return false;
    }
    let t = null;
    if (positions) {
      if (this.selfDiscId != null) t = positions.get(this.selfDiscId);
      if (!t) {
        for (const [id, s] of this.staticById) {
          if (s.kind === 'ball') {
            t = positions.get(id);
            break;
          }
        }
      }
    }
    const tx = clampv((t ? t.x : W / 2) - vw / 2, 0, W - vw);
    const ty = clampv((t ? t.y : H / 2) - vh / 2, 0, H - vh);
    if (!this.cam) {
      this.cam = { x: tx, y: ty };
    } else {
      this.cam.x += (tx - this.cam.x) * CAM_LERP;
      this.cam.y += (ty - this.cam.y) * CAM_LERP;
    }
    return true;
  }

  _drawMinimap(positions) {
    const { ctx } = this;
    const W = this.init.stadium.width;
    const H = this.init.stadium.height;
    const mw = 150;
    const mh = Math.round((mw * H) / W);
    const mx = this.canvas.width - mw - 12;
    const my = this.canvas.height - mh - 12;
    const s = mw / W;
    ctx.save();
    ctx.fillStyle = 'rgba(8,20,12,.72)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    // current viewport
    if (this.cam) {
      ctx.strokeStyle = 'rgba(255,255,255,.6)';
      ctx.strokeRect(mx + this.cam.x * s, my + this.cam.y * s, this.canvas.width * s, this.canvas.height * s);
    }
    for (const [id, p] of positions) {
      const st = this.staticById.get(id);
      if (!st || st.kind === 'post') continue;
      ctx.beginPath();
      if (st.kind === 'ball') {
        ctx.fillStyle = '#ffffff';
        ctx.arc(mx + p.x * s, my + p.y * s, 2.5, 0, Math.PI * 2);
      } else {
        ctx.fillStyle = st.team === 'blue' ? COLORS.blue : COLORS.red;
        ctx.arc(mx + p.x * s, my + p.y * s, id === this.selfDiscId ? 3 : 2, 0, Math.PI * 2);
      }
      ctx.fill();
      if (id === this.selfDiscId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawField() {
    const { ctx, init } = this;
    if (this.grass) ctx.drawImage(this.grass, 0, 0);
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
    if (s.kind === 'player' && typeof p.hd === 'number') {
      // facing notch — shows which way this player's kicks/momentum point
      const a = (p.hd * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(a) * radius * 0.35, p.y + Math.sin(a) * radius * 0.35);
      ctx.lineTo(p.x + Math.cos(a) * radius * 0.95, p.y + Math.sin(a) * radius * 0.95);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
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

  // soft ring around the ball in the handler's team color — shows who has
  // close control without covering the ball itself
  _drawPossession(positions) {
    let ballId = null;
    for (const [id, s] of this.staticById) {
      if (s.kind === 'ball') {
        ballId = id;
        break;
      }
    }
    const b = ballId != null ? positions.get(ballId) : null;
    const handler = this.staticById.get(this.handlerId);
    if (!b || !handler) return;
    const ballR = this.staticById.get(ballId)?.radius ?? 10;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle =
      handler.team === 'blue' ? 'rgba(74,120,225,.75)' : 'rgba(225,90,74,.75)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, ballR + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // arc filling clockwise from 12 o'clock while charging; shifts yellow -> red
  _drawCharge(positions, now) {
    if (this.chargeStart == null || this.selfDiscId == null) return;
    const p = positions.get(this.selfDiscId);
    const s = this.staticById.get(this.selfDiscId);
    if (!p || !s) return;
    const t = Math.min(1, (now - this.chargeStart) / KICK_CHARGE_FULL_MS);
    const r = this._effRadius(p, s) + 6;
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `hsl(${55 - 50 * t} 85% ${62 - 8 * t}%)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
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
