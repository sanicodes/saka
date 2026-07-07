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
export const SPRINT_ACCEL = 0.18;
// Active braking: with PLAYER_DAMP (0.96) alone, a released player coasts
// ~1.5 s / 50-90 px, which reads as "input latching". On any tick with NO
// directional input, applyMoveInput additionally scales the player's own
// velocity by PLAYER_BRAKE. Combined with PLAYER_DAMP that's ~0.82/tick, so a
// full-speed player settles in ~20 ticks (~0.33 s, ~12 px of glide) — stops
// feel deliberate but a little momentum survives, keeping bumps/collisions
// meaningful. Lives here (not in stepWorld) so ball damping is untouched and
// collision impulses can still shove a braking player.
export const PLAYER_BRAKE = 0.85; // extra per-tick velocity multiplier while no move key is held
export const PLAYER_BRAKE_SNAP = 0.02; // below this speed (px/tick) a braking player snaps to rest (kills sub-pixel drift)
export const KICK_ACCEL = 0.07; // slower while charging a kick
export const KICK_RANGE = 12; // gap (px) within which a kick connects — forgiving so timing isn't frame-perfect
export const KICK_STRENGTH = 5.0;
export const POWER_KICK_STRENGTH = 10.0; // a harder kick on a separate key
// Kicks are AIMED along your facing (the notch/aim line) when the ball is
// within this angle of it — predictable, steerable shots. A ball further
// around (behind you) is cleared along the player→ball line instead, so
// scramble kicks never fire "through" your own disc.
export const KICK_AIM_CONE = 1.9; // rad (~109°) either side of the facing

// --- Heading / turn radius (FC-style momentum) ---
// Players have a facing (heading) that slews toward the input direction at a
// speed-dependent rate, and thrust is applied ALONG the heading. Standing
// still you spin almost instantly; at sprint speed a reversal carves an arc.
export const TURN_RATE_MAX = 0.5; // rad/tick at a standstill (u-turn in ~6 ticks)
export const TURN_SPEED_FACTOR = 0.9; // turn rate divisor per px/tick of speed (sprint u-turn ~0.5 s)

// --- Ball handling (dribble / first touch) ---
// Close control engages for the single nearest eligible player within range:
// not sprinting, not fresh off a kick, and no opponent also in range (a
// contested ball stays loose and pure physics decides).
export const HANDLE_RANGE = 18; // gap (px) within which close control engages
export const HANDLE_GAP = 8; // carry point sits this far beyond touching distance (clearance so the carrier doesn't collide with their own ball)
export const HANDLE_PULL = 0.035; // spring accel per px of carry-point error
export const HANDLE_MAX_PULL = 0.22; // pull cap per tick — kicks and bumps still overpower it
export const HANDLE_TURN_RATE = 0.22; // rad/tick the carry point swings toward your FACING — the ball visibly follows your turns and sits in front of the aim line
export const TRAP_BLEND = 0.14; // per-tick blend of ball velocity toward the handler's (first touch)
export const HANDLE_KICK_COOLDOWN_TICKS = 12; // no handling right after your own kick

// --- Charged kick ---
// Space/X kicks instantly on press (unchanged feel). C charges while held and
// fires on release, scaling from KICK_STRENGTH (tap) to POWER_KICK_STRENGTH.
export const KICK_CHARGE_FULL_MS = 900;

// --- Curve / spin ---
// Moving sideways across the ball at kick time puts spin on it; spinning
// rotates the ball's velocity a little each tick (Magnus-lite) and decays.
export const CURVE_SPIN_FACTOR = 0.007; // kicker lateral speed -> spin (rad/tick)
export const CURVE_SPIN_MAX = 0.018; // curve rate cap (rad/tick)
export const CURVE_SPIN_DECAY = 0.985; // spin multiplier per tick

// --- Stamina ---
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 0.45; // per tick while sprinting
export const STAMINA_REGEN = 0.22; // per tick while not sprinting
export const STAMINA_EXHAUST_REENABLE = 25;

// --- Power-ups (only active in the 'powerups' game mode) ---
export const POWERUP_TYPES = ['speed', 'mega', 'freeze', 'giant'];
export const POWERUP_RADIUS = 14; // pickup orb size (px)
export const POWERUP_FIRST_SPAWN_MS = 5000; // first orb appears this long after a kickoff
export const POWERUP_RESPAWN_MS = 10000; // gap from a pickup to the next spawn
export const POWERUP_BUFF_MS = 6000; // how long speed/mega/giant last on the collector
export const POWERUP_FREEZE_MS = 1500; // how long opponents stay frozen
export const SPEED_BUFF_MULT = 1.6; // movement accel multiplier while 'speed' is active
export const MEGA_KICK_MULT = 2.2; // kick strength multiplier while 'mega' is active
export const GIANT_SCALE = 1.7; // disc radius multiplier while 'giant' is active

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
