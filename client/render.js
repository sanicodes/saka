// Canvas rendering with entity interpolation. The client renders the world
// ~INTERP_DELAY_MS in the past, lerping between the two surrounding snapshots.
// This hides jitter and packet loss. Decoupled from the network rate via rAF.

import { INTERP_DELAY_MS, KICKOFF_KEEPOUT_RADIUS } from '/shared/constants.js';

const COLORS = {
  red: '#e15a4a',
  blue: '#4a78e1',
  ballFill: '#ffffff',
  ballStroke: '#222222',
  post: '#dddddd',
  line: 'rgba(255,255,255,.35)',
};
const BUFFER_MAX = 30;

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
  }

  setPhase(state, kickoffTeam) {
    this.phase = state;
    this.kickoffTeam = kickoffTeam || null;
  }

  setInit(init) {
    this.init = init;
    this.staticById.clear();
    for (const d of init.discs) this.staticById.set(d.id, d);
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
    for (const d of snap.discs) byId.set(d.id, { x: d.x, y: d.y });
    this.buffer.push({ recvTime: performance.now(), byId });
    if (this.buffer.length > BUFFER_MAX) this.buffer.shift();
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
      if (pa) out.set(id, { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f });
      else out.set(id, pb);
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

    // posts first, then ball, then players (players on top)
    const order = { post: 0, ball: 1, player: 2 };
    const ids = [...positions.keys()].sort(
      (i, j) => (order[this.staticById.get(i)?.kind] ?? 1) - (order[this.staticById.get(j)?.kind] ?? 1)
    );
    for (const id of ids) {
      const s = this.staticById.get(id);
      const p = positions.get(id);
      if (!s) continue;
      this._drawDisc(p, s, id === this.selfDiscId);
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

  _drawDisc(p, s, isSelf) {
    const { ctx } = this;
    let fill = COLORS.post,
      stroke = null;
    if (s.kind === 'ball') {
      fill = COLORS.ballFill;
      stroke = COLORS.ballStroke;
    } else if (s.kind === 'player') {
      fill = s.team === 'blue' ? COLORS.blue : COLORS.red;
      stroke = isSelf ? '#fff' : 'rgba(0,0,0,.45)';
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = isSelf && s.kind === 'player' ? 3 : 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
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

  _drawName(p, s, name, isSelf) {
    if (!name) return;
    const { ctx } = this;
    ctx.font = `${isSelf ? '600 ' : ''}13px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const y = p.y - s.radius - 5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.strokeText(name, p.x, y); // outline for legibility on the pitch
    ctx.fillStyle = isSelf ? '#fff' : '#eaeaea';
    ctx.fillText(name, p.x, y);
  }
}
