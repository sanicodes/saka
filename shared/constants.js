// All tunables live here so "feel" can be iterated without touching logic.
// Imported by both server (real sim) and client (rendering / prediction).

export const DT = 1 / 60; // fixed physics timestep, always 60 Hz on the server

// --- Player disc ---
export const PLAYER_RADIUS = 15;
export const PLAYER_INVMASS = 1 / 0.5; // 1/mass
export const PLAYER_BCOEFF = 0.5; // restitution
export const PLAYER_DAMP = 0.96; // per-tick velocity multiplier (drag)

// --- Ball disc ---
export const BALL_RADIUS = 10;
export const BALL_INVMASS = 1 / 1.0;
export const BALL_BCOEFF = 0.5;
export const BALL_DAMP = 0.99;

// --- Movement & kick ---
export const MOVE_ACCEL = 0.12;
export const KICK_ACCEL = 0.07; // slower while charging a kick
export const KICK_RANGE = 4; // gap (px) within which a kick connects
export const KICK_STRENGTH = 5.0;

// --- Walls ---
export const WALL_BCOEFF = 1.0; // perimeter walls are bouncy

// --- Collision groups/masks (bitmask). A disc collides with another only if
// each one's group is in the other's mask. Lets us make the scoring team's disc
// pass THROUGH the ball during a kickoff without affecting any other collision. ---
export const CGROUP_ALL = 0xffffffff;
export const CGROUP_BALL = 1;
export const CGROUP_PLAYER = 2;
export const CGROUP_POST = 4;

// kickoff: the round goes "live" once the ball is nudged faster than this
export const KICKOFF_START_SPEED = 0.08;
// kickoff: the scoring team can't enter this radius (px, from ball center) until live
export const KICKOFF_KEEPOUT_RADIUS = 90;

// --- Solver ---
export const SOLVER_PASSES = 3; // resolution passes per tick (reduces tunneling)

// --- Netcode ---
export const SNAPSHOT_HZ = 30; // server -> client broadcast rate
export const INTERP_DELAY_MS = 100; // client renders this far in the past

// --- Match rules ---
export const SCORE_LIMIT = 3; // first to N goals
export const TIME_LIMIT_MS = 5 * 60 * 1000; // or this many ms
export const KICKOFF_COUNTDOWN_MS = 2000;
export const GOAL_CELEBRATION_MS = 2000;
export const END_SCREEN_MS = 6000; // winner overlay shows this long, then auto-return to room lobby

// --- Server / room caps (abuse protection) ---
export const MAX_ROOMS = 50;
export const MAX_PLAYERS_PER_ROOM = 12;
export const ROOM_CREATE_COOLDOWN_MS = 3000;
export const MAX_PASSWORD_LEN = 32;
