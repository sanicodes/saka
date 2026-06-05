// Builders + player input helpers shared by the local sandbox and the server Room,
// so client-feel and server-truth never diverge.

import { Disc, dist } from './physics.js';
import {
  PLAYER_RADIUS,
  PLAYER_INVMASS,
  PLAYER_BCOEFF,
  PLAYER_DAMP,
  BALL_RADIUS,
  BALL_INVMASS,
  BALL_BCOEFF,
  BALL_DAMP,
  MOVE_ACCEL,
  KICK_ACCEL,
  KICK_RANGE,
  KICK_STRENGTH,
  CGROUP_BALL,
  CGROUP_PLAYER,
  CGROUP_POST,
} from './constants.js';

export function makeBall(stadium) {
  const [x, y] = stadium.ballSpawn;
  return new Disc({
    x,
    y,
    radius: BALL_RADIUS,
    invMass: BALL_INVMASS,
    bCoeff: BALL_BCOEFF,
    damping: BALL_DAMP,
    cGroup: CGROUP_BALL,
    kind: 'ball',
  });
}

export function makePosts(stadium) {
  return stadium.posts.map(
    (p) =>
      new Disc({
        x: p.x,
        y: p.y,
        radius: p.radius,
        invMass: 0, // immovable
        bCoeff: 0.5,
        damping: 1,
        cGroup: CGROUP_POST,
        kind: 'post',
      })
  );
}

export function makePlayer(x, y, team) {
  const d = new Disc({
    x,
    y,
    radius: PLAYER_RADIUS,
    invMass: PLAYER_INVMASS,
    bCoeff: PLAYER_BCOEFF,
    damping: PLAYER_DAMP,
    cGroup: CGROUP_PLAYER,
    kind: 'player',
  });
  d.team = team; // 'red' | 'blue'
  return d;
}

// Apply directional input acceleration to a player's velocity (before integrate).
// `input` = { u, d, l, r, kick }. Slower accel while the kick key is held.
export function applyMoveInput(player, input) {
  let ix = (input.r ? 1 : 0) - (input.l ? 1 : 0);
  let iy = (input.d ? 1 : 0) - (input.u ? 1 : 0);
  const len = Math.hypot(ix, iy);
  if (len > 0) {
    ix /= len;
    iy /= len;
  }
  const accel = input.kick ? KICK_ACCEL : MOVE_ACCEL;
  player.vx += ix * accel;
  player.vy += iy * accel;
}

// Edge-triggered kick. Pass whether kick went up->down THIS tick. Returns true
// if the ball was struck (so the caller can play a sound / effect).
export function tryKick(player, ball, kickPressedThisTick) {
  if (!kickPressedThisTick) return false;
  const gap = dist(player, ball) - player.radius - ball.radius;
  if (gap > KICK_RANGE) return false;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const d = Math.hypot(dx, dy) || 1;
  ball.vx += (dx / d) * KICK_STRENGTH;
  ball.vy += (dy / d) * KICK_STRENGTH;
  return true;
}
