# ⚽ Saka

Server-authoritative multiplayer disc soccer (Haxball-style physics). One Node process hosts many rooms;
each room runs its own fixed 60 Hz physics loop. Clients send **inputs only** — the
server simulates and broadcasts, clients render and interpolate.

## Run it

```bash
npm install
npm start          # http://localhost:3000  (npm run dev for --watch)
```

Open the URL in two browser tabs, create a room in one, join it from the other, then
pick teams in the room lobby. The host (room creator) sets the match settings and
starts the match. `PORT` env var overrides the port.

### Flow

1. **Name gate** — enter a name (remembered via `localStorage`) before the lobby.
2. **Global lobby** — create a room (optionally **password-protected** 🔒) or join one.
   Joining a locked room prompts for the password. Every room has a **shareable
   link** (`?room=<id>` — the address bar updates when you join, and the room lobby
   has a **🔗 Copy link** button); opening one jumps straight into the room after
   the name gate, asking for the password if the room is locked.
3. **Room lobby** — Red / Spectators / Blue columns. Everyone joins as a spectator and
   clicks **Join Red / Join Blue / Spectate**. The **host** (★, first player; reassigned
   if they leave) sets **time limit**, **score limit**, and **stadium**, then **Start
   match** (needs ≥1 player on each team). Non-hosts wait.
4. **Match** — play to the score/time limit. Player **names ride on the discs** and a
   **roster panel** beside the pitch lists each team. Players can **sprint with stamina**
   for short bursts; your stamina bar appears under your disc. After a goal, the
   **scoring team is locked out of the ball** at kickoff — the round only goes live once
   the conceding team takes the kick. At full time a **winner overlay** shows the result,
   then the room **auto-returns to the room lobby** after a few seconds. The host can
   **Play again** (same teams) to skip the wait.

## What's built 

- **Shared physics** (`shared/`) — `Disc` model, disc/disc + disc/wall collisions,
  fixed-step integration, and selectable stadiums with goal pockets. Runs identically
  on the server and in the offline sandbox (no drift).
- **Offline sandbox** — `http://localhost:3000/sandbox.html`. One player + ball + the
  full pitch, no network. Use it to tune the feel in `shared/constants.js`.
- **Server** (`server/`) — Socket.IO, per-room 60 Hz loop (runs only while a match is
  live), 30 Hz snapshots, full `lobby → kickoff → play → goal → (kickoff | ended)`
  state machine, scoring, match clock, host ownership + owner-only settings/start,
  team picking + spectators, optional room passwords, auto-return to the room lobby
  after a match, and global lobby with create/join + room lifecycle.
- **Client** (`client/`) — canvas renderer with entity interpolation (renders ~100 ms
  in the past), stamina feedback, input capture (sent only on change), lobby UI,
  scoreboard, team picker.
- **Spoken commentary** (`client/commentary.js`) — a Web Speech API commentator calls
  kickoffs, goals (scorer, assist, own goals — the server attributes them via
  last-touch tracking), and full time, with each line also flashed as a text caption
  under the banner. Toggle with 🎙️ in the match controls; the master 🔊 mute silences
  it too. No audio assets, same philosophy as the synthesized sfx.

## Layout

```
shared/   constants.js  physics.js  factory.js  stadiums.js   # runs on both sides
server/   index.js (bootstrap)  net.js (sockets+registry)  Room.js (game loop)
client/   index.html  main.js  render.js  ui.js  sfx.js  commentary.js  sandbox.html
```
## Controls

Move `WASD` / arrows · Sprint `Shift` · Kick `Space` / `X` **or left click**
(instant, on press) · Charged kick `C` **or right click** — **hold to charge**,
release to shoot (tap = normal kick, full ~0.9 s hold = power strength; a meter
fills around your disc). `R` resets the sandbox.

## Aiming, movement & ball handling

- **Facing = aim** — players have a facing (the dark notch on the disc). Kicks fire
  **along your facing** when the ball is in front of you, so you steer shots by
  turning. Standing still, tapping a direction spins your facing almost instantly
  without moving you — that's your aiming mechanism. A ball behind you is cleared
  along the ball line instead (no through-body kicks).
- **Momentum & turn radius** — input steers the facing, thrust goes along it:
  standing you spin instantly, at sprint speed a reversal carves an arc. Releasing
  all keys brakes you to a stop in ~0.3 s.
- **Dribble / close control** — the nearest player within reach holds the ball on a
  carry ring (team-colored possession ring). The ball **swings around your disc to
  sit in front of your facing**, so where you look is where the ball — and your next
  kick — goes. Sprinting sacrifices control; kicks, bumps, and tackles overpower the
  carry. Both teams in reach = contested, ball stays loose.
- **First touch** — an incoming ball cushions against a player in control instead of
  ricocheting off.
- **Curve** — moving sideways across the ball as you kick puts spin on it, bending
  the shot in flight. A controlled touch kills the spin.

Tunables in `shared/constants.js` (`TURN_*`, `HANDLE_*`, `KICK_AIM_CONE`,
`TRAP_BLEND`, `KICK_CHARGE_FULL_MS`, `CURVE_*`).

## Camera & big stadiums

The canvas is a fixed 1200×600 viewport. Stadiums that fit render 1:1 exactly as
before; bigger ones (Colossus, and the huge **Titan** at 3000×1500) get a smoothed
per-player camera that follows **your own disc** (spectators follow the ball) plus a
minimap in the corner showing every disc and your current view. All client-side —
each player sees their own view of the same server simulation.
# saka
