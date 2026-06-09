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
  SPRINT_ACCEL,
  KICK_ACCEL,
  KICK_RANGE,
  KICK_STRENGTH,
  STAMINA_DRAIN,
  STAMINA_EXHAUST_REENABLE,
  STAMINA_MAX,
  STAMINA_REGEN,
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
  resetPlayerStamina(d);
  return d;
}

export function resetPlayerStamina(player) {
  player.stamina = STAMINA_MAX;
  player.exhausted = false;
  player.isSprinting = false;
}

// Apply directional input acceleration to a player's velocity (before integrate).
// `input` = { u, d, l, r, kick, run }. Slower accel while the kick key is held.
// `mods` (powerups mode): { frozen } blocks all movement, { accelMul } scales accel.
export function applyMoveInput(player, input, mods = {}) {
  let ix = (input.r ? 1 : 0) - (input.l ? 1 : 0);
  let iy = (input.d ? 1 : 0) - (input.u ? 1 : 0);
  if (mods.frozen) {
    ix = 0;
    iy = 0;
  }
  const len = Math.hypot(ix, iy);
  if (len > 0) {
    ix /= len;
    iy /= len;
  }
  if (player.stamina === undefined) resetPlayerStamina(player);

  const wantsSprint = !!input.run && len > 0 && !input.kick;
  const canSprint = wantsSprint && !player.exhausted && player.stamina > 0;
  player.isSprinting = canSprint;

  if (canSprint) {
    player.stamina = Math.max(0, player.stamina - STAMINA_DRAIN);
    if (player.stamina <= 0) player.exhausted = true;
  } else {
    player.stamina = Math.min(STAMINA_MAX, player.stamina + STAMINA_REGEN);
    if (player.exhausted && player.stamina >= STAMINA_EXHAUST_REENABLE) {
      player.exhausted = false;
    }
  }

  const baseAccel = input.kick ? KICK_ACCEL : canSprint ? SPRINT_ACCEL : MOVE_ACCEL;
  const accel = baseAccel * (mods.accelMul ?? 1);
  player.vx += ix * accel;
  player.vy += iy * accel;
}

// Edge-triggered kick. Pass whether kick went up->down THIS tick. `strength` lets
// the caller request a harder (power) kick. Returns true if the ball was struck
// (so the caller can play a sound / effect).
export function tryKick(player, ball, kickPressedThisTick, strength = KICK_STRENGTH) {
  if (!kickPressedThisTick) return false;
  const gap = dist(player, ball) - player.radius - ball.radius;
  if (gap > KICK_RANGE) return false;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const d = Math.hypot(dx, dy) || 1;
  ball.vx += (dx / d) * strength;
  ball.vy += (dy / d) * strength;
  return true;
}
