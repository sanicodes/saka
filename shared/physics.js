// Core disc physics. Pure, isomorphic ESM — the server runs this for real;
// the client can import it for prediction (v2). No Node- or DOM-specific APIs.
//
// Everything dynamic is a Disc. Walls are line Segments. Posts are immovable discs.

import { CGROUP_ALL } from './constants.js';

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

let _nextId = 1;

export class Disc {
  constructor(opts = {}) {
    this.id = opts.id ?? _nextId++;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;
    this.radius = opts.radius ?? 10;
    this.invMass = opts.invMass ?? 1; // 0 = immovable
    this.bCoeff = opts.bCoeff ?? 0.5;
    this.damping = opts.damping ?? 1.0;
    this.cGroup = opts.cGroup ?? CGROUP_ALL; // which group(s) this disc belongs to
    this.cMask = opts.cMask ?? CGROUP_ALL; // which groups this disc collides with
    this.kind = opts.kind ?? 'disc'; // 'player' | 'ball' | 'post'
  }
}

// --- Integration (per disc, per tick): drag then move. Immovable discs skip. ---
export function integrate(d) {
  if (d.invMass === 0) return;
  d.vx *= d.damping;
  d.vy *= d.damping;
  d.x += d.vx;
  d.y += d.vy;
}

// --- Disc vs disc: positional correction + normal impulse. ---
export function collideDiscs(a, b) {
  // collide only if each disc's group is in the other's mask
  if ((a.cGroup & b.cMask) === 0 || (b.cGroup & a.cMask) === 0) return;
  const invSum = a.invMass + b.invMass;
  if (invSum === 0) return; // both immovable

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = a.radius + b.radius;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist >= r) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = r - dist;

  // positional correction, weighted by inverse mass
  a.x -= nx * overlap * (a.invMass / invSum);
  a.y -= ny * overlap * (a.invMass / invSum);
  b.x += nx * overlap * (b.invMass / invSum);
  b.y += ny * overlap * (b.invMass / invSum);

  // velocity resolution along the normal, only if approaching
  const relN = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relN < 0) {
    const e = Math.min(a.bCoeff, b.bCoeff);
    const j = (-(1 + e) * relN) / invSum;
    a.vx -= j * nx * a.invMass;
    a.vy -= j * ny * a.invMass;
    b.vx += j * nx * b.invMass;
    b.vy += j * ny * b.invMass;
  }
}

// closest point on segment AB to point P
export function closestOnSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const denom = abx * abx + aby * aby;
  let t = denom === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / denom;
  t = clamp(t, 0, 1);
  return [ax + abx * t, ay + aby * t];
}

// --- Disc vs wall segment: push out of penetration + reflect velocity. ---
export function collideSegment(d, seg) {
  if (d.invMass === 0) return;
  const [cx, cy] = closestOnSeg(d.x, d.y, seg.ax, seg.ay, seg.bx, seg.by);
  let nx = d.x - cx;
  let ny = d.y - cy;
  let dist = Math.hypot(nx, ny);
  if (dist >= d.radius) return;

  if (dist === 0) {
    // center exactly on the segment: use segment normal as fallback
    const abx = seg.bx - seg.ax;
    const aby = seg.by - seg.ay;
    const len = Math.hypot(abx, aby) || 1;
    nx = -aby / len;
    ny = abx / len;
    dist = 0.0001;
  } else {
    nx /= dist;
    ny /= dist;
  }

  const overlap = d.radius - dist;
  d.x += nx * overlap;
  d.y += ny * overlap;

  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) {
    const e = seg.bCoeff ?? 1.0;
    d.vx -= (1 + e) * vn * nx;
    d.vy -= (1 + e) * vn * ny;
  }
}

// Resolve all overlaps for one tick. Fixed iteration order = deterministic.
export function resolveCollisions(discs, segments, passes) {
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        collideDiscs(discs[i], discs[j]);
      }
    }
    for (let i = 0; i < discs.length; i++) {
      const d = discs[i];
      for (let s = 0; s < segments.length; s++) {
        collideSegment(d, segments[s]);
      }
    }
  }
}

// One full physics tick: integrate every disc, then resolve. Player input
// acceleration must be applied to velocities BEFORE calling this.
export function stepWorld(discs, segments, passes) {
  for (let i = 0; i < discs.length; i++) integrate(discs[i]);
  resolveCollisions(discs, segments, passes);
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
