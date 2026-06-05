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
   Joining a locked room prompts for the password.
3. **Room lobby** — Red / Spectators / Blue columns. Everyone joins as a spectator and
   clicks **Join Red / Join Blue / Spectate**. The **host** (★, first player; reassigned
   if they leave) sets **time limit**, **score limit**, and **stadium**, then **Start
   match** (needs ≥1 player on a team). Non-hosts wait.
4. **Match** — play to the score/time limit. Player **names ride on the discs** and a
   **roster panel** beside the pitch lists each team. After a goal, the **scoring team is
   locked out of the ball** at kickoff — the round only goes live once the conceding team
   takes the kick. At full time a **winner overlay** shows the result, then the room
   **auto-returns to the room lobby** after a few seconds. The host can **Play again**
   (same teams) to skip the wait.

## What's built (v1, milestones 1–6)

- **Shared physics** (`shared/`) — `Disc` model, disc/disc + disc/wall collisions,
  fixed-step integration, classic stadium with goal pockets. Runs identically on the
  server and in the offline sandbox (no drift).
- **Offline sandbox** — `http://localhost:3000/sandbox.html`. One player + ball + the
  full pitch, no network. Use it to tune the feel in `shared/constants.js`.
- **Server** (`server/`) — Socket.IO, per-room 60 Hz loop (runs only while a match is
  live), 30 Hz snapshots, full `lobby → kickoff → play → goal → (kickoff | ended)`
  state machine, scoring, match clock, host ownership + owner-only settings/start,
  team picking + spectators, optional room passwords, auto-return to the room lobby
  after a match, and global lobby with create/join + room lifecycle.
- **Client** (`client/`) — canvas renderer with entity interpolation (renders ~100 ms
  in the past), input capture (sent only on change), lobby UI, scoreboard, team picker.

## Layout

```
shared/   constants.js  physics.js  factory.js  stadiums.js   # runs on both sides
server/   index.js (bootstrap)  net.js (sockets+registry)  Room.js (game loop)
client/   index.html  main.js  render.js  ui.js  sandbox.html
```
## Controls

Move `WASD` / arrows · Kick `Space` / `X` (edge-triggered — release and press again to
kick). `R` resets the sandbox.
# saka
