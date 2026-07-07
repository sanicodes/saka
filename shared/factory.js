// Builders + player input helpers shared by the local sandbox and the server Room,
// so client-feel and server-truth never diverge.

import { Disc, dist, clamp } from './physics.js';
import {
  HANDLE_RANGE,
  HANDLE_GAP,
  HANDLE_PULL,
  HANDLE_MAX_PULL,
  HANDLE_TURN_RATE,
  TRAP_BLEND,
  TURN_RATE_MAX,
  TURN_SPEED_FACTOR,
  KICK_AIM_CONE,
  CURVE_SPIN_FACTOR,
  CURVE_SPIN_MAX,
  CURVE_SPIN_DECAY,
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
  PLAYER_BRAKE,
  PLAYER_BRAKE_SNAP,
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
  d.heading = team === 'blue' ? Math.PI : 0; // face the opponent's goal
  resetPlayerStamina(d);
  return d;
}

// smallest signed angle from `from` to `to`, in (-PI, PI]
export function angleDiff(to, from) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
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

  if (len > 0) {
    // FC-style momentum: input steers the HEADING (fast when slow, sluggish at
    // speed), and thrust is applied along the heading — so a reversal at
    // sprint speed carves an arc instead of flipping instantly.
    if (player.heading === undefined) player.heading = Math.atan2(iy, ix);
    const speed = Math.hypot(player.vx, player.vy);
    const rate = TURN_RATE_MAX / (1 + speed * TURN_SPEED_FACTOR);
    const diff = angleDiff(Math.atan2(iy, ix), player.heading);
    player.heading += clamp(diff, -rate, rate);

    const baseAccel = input.kick ? KICK_ACCEL : canSprint ? SPRINT_ACCEL : MOVE_ACCEL;
    const accel = baseAccel * (mods.accelMul ?? 1);
    player.vx += Math.cos(player.heading) * accel;
    player.vy += Math.sin(player.heading) * accel;
  } else {
    // No directional input: brake the player's OWN velocity so releasing keys
    // stops you in ~0.3 s instead of the ~1.5 s that PLAYER_DAMP alone gives.
    // Only scales this disc's velocity — collision impulses (applied later in
    // stepWorld) still move a braking player, they just bleed off quickly.
    player.vx *= PLAYER_BRAKE;
    player.vy *= PLAYER_BRAKE;
    if (Math.hypot(player.vx, player.vy) < PLAYER_BRAKE_SNAP) {
      player.vx = 0;
      player.vy = 0;
    }
  }
}

// Edge-triggered kick. Pass whether kick went up->down THIS tick. `strength` lets
// the caller request a harder (power) kick.
// AIMING: when the ball sits within KICK_AIM_CONE of the player's facing, the
// kick fires ALONG THE FACING with a set (predictable) velocity — the facing
// notch/aim line is the sight. A ball behind the player is cleared along the
// player→ball line instead, so a scramble kick never fires through your disc.
// Returns true if the ball was struck.
export function tryKick(player, ball, kickPressedThisTick, strength = KICK_STRENGTH) {
  if (!kickPressedThisTick) return false;
  const gap = dist(player, ball) - player.radius - ball.radius;
  if (gap > KICK_RANGE) return false;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const d = Math.hypot(dx, dy) || 1;
  let nx = dx / d;
  let ny = dy / d;
  const aimed =
    typeof player.heading === 'number' &&
    Math.abs(angleDiff(Math.atan2(dy, dx), player.heading)) <= KICK_AIM_CONE;
  if (aimed) {
    nx = Math.cos(player.heading);
    ny = Math.sin(player.heading);
    ball.vx = nx * strength;
    ball.vy = ny * strength;
  } else {
    ball.vx += nx * strength;
    ball.vy += ny * strength;
  }
  // curve: the kicker's motion ACROSS the kick direction shears the ball and
  // puts spin on it — running past the ball while kicking bends the shot
  const lateral = player.vx * -ny + player.vy * nx;
  ball.spin = clamp(lateral * CURVE_SPIN_FACTOR, -CURVE_SPIN_MAX, CURVE_SPIN_MAX);
  return true;
}

// Ball handling for the (single, uncontested) player in close control:
// 1. First touch — blend the ball's velocity toward the handler's, so an
//    incoming pass cushions against them instead of ricocheting off.
// 2. Close control — steer the ball toward a carry point on a ring around the
//    player, capped weak so kicks, tackles, and bumps overpower it.
// The carry point sits at the ball's CURRENT angle and only rotates toward the
// player's heading at a capped rate — the ball stays roughly where you put it
// around your disc, so you can shape kicks in any direction.
// The caller (server Room / sandbox) decides WHO the handler is each tick.
export function applyBallHandling(player, ball) {
  ball.vx += (player.vx - ball.vx) * TRAP_BLEND;
  ball.vy += (player.vy - ball.vy) * TRAP_BLEND;

  // swing the carry point toward the FACING (even while standing, so tapping
  // a direction to aim visibly brings the ball around in front of you)
  let angle = Math.atan2(ball.y - player.y, ball.x - player.x);
  const sp = Math.hypot(player.vx, player.vy);
  const face = player.heading ?? (sp > 0.05 ? Math.atan2(player.vy, player.vx) : angle);
  angle += clamp(angleDiff(face, angle), -HANDLE_TURN_RATE, HANDLE_TURN_RATE);
  const offset = player.radius + ball.radius + HANDLE_GAP;
  const tx = player.x + Math.cos(angle) * offset;
  const ty = player.y + Math.sin(angle) * offset;
  ball.vx += clamp((tx - ball.x) * HANDLE_PULL, -HANDLE_MAX_PULL, HANDLE_MAX_PULL);
  ball.vy += clamp((ty - ball.y) * HANDLE_PULL, -HANDLE_MAX_PULL, HANDLE_MAX_PULL);
  ball.spin = 0; // a controlled touch kills any curve on the ball
}

// gap between a player and the ball, for handler-eligibility checks
export function handleGap(player, ball) {
  return dist(player, ball) - player.radius - ball.radius;
}

export function inHandleRange(player, ball) {
  return handleGap(player, ball) <= HANDLE_RANGE;
}

// Magnus-lite: spin rotates the velocity vector a little each tick (preserves
// speed, so the ball bends without slowing beyond its normal damping), then
// decays. Call once per tick before stepping the world.
export function applyBallSpin(ball) {
  const s = ball.spin || 0;
  if (Math.abs(s) < 0.0005) {
    ball.spin = 0;
    return;
  }
  const cos = Math.cos(s);
  const sin = Math.sin(s);
  const vx = ball.vx * cos - ball.vy * sin;
  ball.vy = ball.vx * sin + ball.vy * cos;
  ball.vx = vx;
  ball.spin = s * CURVE_SPIN_DECAY;
}
