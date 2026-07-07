// Data-driven stadium definitions. Add maps without touching engine code.
//
// Stadium {
//   width, height,
//   spawnRed:[[x,y]...], spawnBlue:[[x,y]...], ballSpawn:[x,y],
//   segments:[{ax,ay,bx,by,bCoeff}...],   // walls
//   posts:[{x,y,radius}...],              // immovable discs
//   goals:[{scorer, side, x, yTop, yBottom}...]
// }

import { WALL_BCOEFF } from './constants.js';

const NET = 0.3; // back-of-net walls absorb the ball so it settles

// Classic pitch: rectangle with a goal opening on each side wall.
// Red defends the LEFT goal, Blue defends the RIGHT goal.
function classicPitch() {
  const W = 1200,
    H = 600;
  const L = 40,
    R = 1160,
    T = 40,
    B = 560; // field rectangle
  const gT = 210,
    gB = 390; // goal mouth top / bottom (centered, height 180)
  const netL = 10,
    netR = 1190; // back of nets

  return {
    name: 'Classic',
    width: W,
    height: H,
    spawnRed: [
      [300, 300],
      [300, 200],
      [300, 400],
      [450, 250],
      [450, 350],
      [200, 300],
    ],
    spawnBlue: [
      [900, 300],
      [900, 200],
      [900, 400],
      [750, 250],
      [750, 350],
      [1000, 300],
    ],
    ballSpawn: [600, 300],
    segments: [
      // perimeter
      { ax: L, ay: T, bx: R, by: T, bCoeff: WALL_BCOEFF }, // top
      { ax: L, ay: B, bx: R, by: B, bCoeff: WALL_BCOEFF }, // bottom
      { ax: L, ay: T, bx: L, by: gT, bCoeff: WALL_BCOEFF }, // left upper
      { ax: L, ay: gB, bx: L, by: B, bCoeff: WALL_BCOEFF }, // left lower
      { ax: R, ay: T, bx: R, by: gT, bCoeff: WALL_BCOEFF }, // right upper
      { ax: R, ay: gB, bx: R, by: B, bCoeff: WALL_BCOEFF }, // right lower
      // left net pocket
      { ax: netL, ay: gT, bx: netL, by: gB, bCoeff: NET }, // back
      { ax: netL, ay: gT, bx: L, by: gT, bCoeff: NET }, // top
      { ax: netL, ay: gB, bx: L, by: gB, bCoeff: NET }, // bottom
      // right net pocket
      { ax: netR, ay: gT, bx: netR, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: R, by: gT, bCoeff: NET },
      { ax: netR, ay: gB, bx: R, by: gB, bCoeff: NET },
    ],
    posts: [
      { x: L, y: gT, radius: 8 },
      { x: L, y: gB, radius: 8 },
      { x: R, y: gT, radius: 8 },
      { x: R, y: gB, radius: 8 },
    ],
    goals: [
      // ball crossing the left line scores for BLUE; right line scores for RED
      { scorer: 'blue', side: 'left', x: L - 2, yTop: gT, yBottom: gB },
      { scorer: 'red', side: 'right', x: R + 2, yTop: gT, yBottom: gB },
    ],
  };
}

// Pillars pitch: same broad scale as Classic, but with tighter goals, corner
// bumpers, and two midfield posts that make rebounds less predictable.
function pillarsPitch() {
  const W = 1200,
    H = 600;
  const L = 60,
    R = 1140,
    T = 50,
    B = 550;
  const gT = 220,
    gB = 380;
  const netL = 20,
    netR = 1180;
  const cX = W / 2,
    cY = H / 2;

  return {
    name: 'Pillars',
    width: W,
    height: H,
    spawnRed: [
      [280, cY],
      [280, 210],
      [280, 390],
      [420, 245],
      [420, 355],
      [190, cY],
    ],
    spawnBlue: [
      [920, cY],
      [920, 210],
      [920, 390],
      [780, 245],
      [780, 355],
      [1010, cY],
    ],
    ballSpawn: [cX, cY],
    segments: [
      // perimeter with side goal openings
      { ax: L, ay: T, bx: R, by: T, bCoeff: WALL_BCOEFF },
      { ax: L, ay: B, bx: R, by: B, bCoeff: WALL_BCOEFF },
      { ax: L, ay: T, bx: L, by: gT, bCoeff: WALL_BCOEFF },
      { ax: L, ay: gB, bx: L, by: B, bCoeff: WALL_BCOEFF },
      { ax: R, ay: T, bx: R, by: gT, bCoeff: WALL_BCOEFF },
      { ax: R, ay: gB, bx: R, by: B, bCoeff: WALL_BCOEFF },
      // net pockets
      { ax: netL, ay: gT, bx: netL, by: gB, bCoeff: NET },
      { ax: netL, ay: gT, bx: L, by: gT, bCoeff: NET },
      { ax: netL, ay: gB, bx: L, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: netR, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: R, by: gT, bCoeff: NET },
      { ax: netR, ay: gB, bx: R, by: gB, bCoeff: NET },
      // diagonal corner bumpers
      { ax: L + 90, ay: T, bx: L, by: T + 90, bCoeff: WALL_BCOEFF },
      { ax: R - 90, ay: T, bx: R, by: T + 90, bCoeff: WALL_BCOEFF },
      { ax: L, ay: B - 90, bx: L + 90, by: B, bCoeff: WALL_BCOEFF },
      { ax: R, ay: B - 90, bx: R - 90, by: B, bCoeff: WALL_BCOEFF },
    ],
    posts: [
      { x: L, y: gT, radius: 8 },
      { x: L, y: gB, radius: 8 },
      { x: R, y: gT, radius: 8 },
      { x: R, y: gB, radius: 8 },
      { x: cX, y: cY - 110, radius: 14 },
      { x: cX, y: cY + 110, radius: 14 },
    ],
    goals: [
      { scorer: 'blue', side: 'left', x: L - 2, yTop: gT, yBottom: gB },
      { scorer: 'red', side: 'right', x: R + 2, yTop: gT, yBottom: gB },
    ],
  };
}

// Diamond pitch: open goals and standard width, with a compact midfield diamond
// that creates bounce angles without blocking the first kickoff.
function diamondPitch() {
  const W = 1200,
    H = 600;
  const L = 50,
    R = 1150,
    T = 45,
    B = 555;
  const gT = 205,
    gB = 395;
  const netL = 15,
    netR = 1185;
  const cX = W / 2,
    cY = H / 2;

  return {
    name: 'Diamond',
    width: W,
    height: H,
    spawnRed: [
      [260, cY],
      [305, 215],
      [305, 385],
      [430, 260],
      [430, 340],
      [170, cY],
    ],
    spawnBlue: [
      [940, cY],
      [895, 215],
      [895, 385],
      [770, 260],
      [770, 340],
      [1030, cY],
    ],
    ballSpawn: [cX, cY],
    segments: [
      // perimeter with side goal openings
      { ax: L, ay: T, bx: R, by: T, bCoeff: WALL_BCOEFF },
      { ax: L, ay: B, bx: R, by: B, bCoeff: WALL_BCOEFF },
      { ax: L, ay: T, bx: L, by: gT, bCoeff: WALL_BCOEFF },
      { ax: L, ay: gB, bx: L, by: B, bCoeff: WALL_BCOEFF },
      { ax: R, ay: T, bx: R, by: gT, bCoeff: WALL_BCOEFF },
      { ax: R, ay: gB, bx: R, by: B, bCoeff: WALL_BCOEFF },
      // net pockets
      { ax: netL, ay: gT, bx: netL, by: gB, bCoeff: NET },
      { ax: netL, ay: gT, bx: L, by: gT, bCoeff: NET },
      { ax: netL, ay: gB, bx: L, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: netR, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: R, by: gT, bCoeff: NET },
      { ax: netR, ay: gB, bx: R, by: gB, bCoeff: NET },
      // midfield diamond rails
      { ax: cX - 105, ay: cY - 105, bx: cX - 42, by: cY - 42, bCoeff: WALL_BCOEFF },
      { ax: cX + 105, ay: cY - 105, bx: cX + 42, by: cY - 42, bCoeff: WALL_BCOEFF },
      { ax: cX - 105, ay: cY + 105, bx: cX - 42, by: cY + 42, bCoeff: WALL_BCOEFF },
      { ax: cX + 105, ay: cY + 105, bx: cX + 42, by: cY + 42, bCoeff: WALL_BCOEFF },
      // shallow goal-lane deflectors
      { ax: L + 120, ay: gT - 70, bx: L + 40, by: gT - 12, bCoeff: WALL_BCOEFF },
      { ax: L + 40, ay: gB + 12, bx: L + 120, by: gB + 70, bCoeff: WALL_BCOEFF },
      { ax: R - 120, ay: gT - 70, bx: R - 40, by: gT - 12, bCoeff: WALL_BCOEFF },
      { ax: R - 40, ay: gB + 12, bx: R - 120, by: gB + 70, bCoeff: WALL_BCOEFF },
    ],
    posts: [
      { x: L, y: gT, radius: 8 },
      { x: L, y: gB, radius: 8 },
      { x: R, y: gT, radius: 8 },
      { x: R, y: gB, radius: 8 },
      { x: cX, y: cY - 95, radius: 10 },
      { x: cX + 95, y: cY, radius: 10 },
      { x: cX, y: cY + 95, radius: 10 },
      { x: cX - 95, y: cY, radius: 10 },
    ],
    goals: [
      { scorer: 'blue', side: 'left', x: L - 2, yTop: gT, yBottom: gB },
      { scorer: 'red', side: 'right', x: R + 2, yTop: gT, yBottom: gB },
    ],
  };
}

// Colossus pitch: Classic's clean layout scaled up ~1.5x for big-team games —
// more open space, longer runs, wider goal mouths.
function colossusPitch() {
  const W = 1800,
    H = 900;
  const L = 60,
    R = 1740,
    T = 60,
    B = 840; // field rectangle
  const gT = 330,
    gB = 570; // goal mouth (centered, height 240)
  const netL = 15,
    netR = 1785; // back of nets

  return {
    name: 'Colossus',
    width: W,
    height: H,
    spawnRed: [
      [450, 450],
      [450, 300],
      [450, 600],
      [675, 375],
      [675, 525],
      [300, 450],
    ],
    spawnBlue: [
      [1350, 450],
      [1350, 300],
      [1350, 600],
      [1125, 375],
      [1125, 525],
      [1500, 450],
    ],
    ballSpawn: [900, 450],
    segments: [
      // perimeter
      { ax: L, ay: T, bx: R, by: T, bCoeff: WALL_BCOEFF }, // top
      { ax: L, ay: B, bx: R, by: B, bCoeff: WALL_BCOEFF }, // bottom
      { ax: L, ay: T, bx: L, by: gT, bCoeff: WALL_BCOEFF }, // left upper
      { ax: L, ay: gB, bx: L, by: B, bCoeff: WALL_BCOEFF }, // left lower
      { ax: R, ay: T, bx: R, by: gT, bCoeff: WALL_BCOEFF }, // right upper
      { ax: R, ay: gB, bx: R, by: B, bCoeff: WALL_BCOEFF }, // right lower
      // left net pocket
      { ax: netL, ay: gT, bx: netL, by: gB, bCoeff: NET }, // back
      { ax: netL, ay: gT, bx: L, by: gT, bCoeff: NET }, // top
      { ax: netL, ay: gB, bx: L, by: gB, bCoeff: NET }, // bottom
      // right net pocket
      { ax: netR, ay: gT, bx: netR, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: R, by: gT, bCoeff: NET },
      { ax: netR, ay: gB, bx: R, by: gB, bCoeff: NET },
    ],
    posts: [
      { x: L, y: gT, radius: 8 },
      { x: L, y: gB, radius: 8 },
      { x: R, y: gT, radius: 8 },
      { x: R, y: gB, radius: 8 },
    ],
    goals: [
      { scorer: 'blue', side: 'left', x: L - 2, yTop: gT, yBottom: gB },
      { scorer: 'red', side: 'right', x: R + 2, yTop: gT, yBottom: gB },
    ],
  };
}

// Titan pitch: a properly huge field (2.5x Classic). Far bigger than the
// client viewport — players see a scrolling camera view + minimap. Long runs,
// real passing lanes, stamina management matters.
function titanPitch() {
  const W = 3000,
    H = 1500;
  const L = 80,
    R = 2920,
    T = 80,
    B = 1420; // field rectangle
  const gT = 600,
    gB = 900; // goal mouth (centered, height 300)
  const netL = 25,
    netR = 2975; // back of nets
  const cY = H / 2;

  return {
    name: 'Titan',
    width: W,
    height: H,
    spawnRed: [
      [750, cY],
      [750, 500],
      [750, 1000],
      [1120, 620],
      [1120, 880],
      [500, cY],
    ],
    spawnBlue: [
      [2250, cY],
      [2250, 500],
      [2250, 1000],
      [1880, 620],
      [1880, 880],
      [2500, cY],
    ],
    ballSpawn: [1500, cY],
    segments: [
      // perimeter
      { ax: L, ay: T, bx: R, by: T, bCoeff: WALL_BCOEFF }, // top
      { ax: L, ay: B, bx: R, by: B, bCoeff: WALL_BCOEFF }, // bottom
      { ax: L, ay: T, bx: L, by: gT, bCoeff: WALL_BCOEFF }, // left upper
      { ax: L, ay: gB, bx: L, by: B, bCoeff: WALL_BCOEFF }, // left lower
      { ax: R, ay: T, bx: R, by: gT, bCoeff: WALL_BCOEFF }, // right upper
      { ax: R, ay: gB, bx: R, by: B, bCoeff: WALL_BCOEFF }, // right lower
      // left net pocket
      { ax: netL, ay: gT, bx: netL, by: gB, bCoeff: NET },
      { ax: netL, ay: gT, bx: L, by: gT, bCoeff: NET },
      { ax: netL, ay: gB, bx: L, by: gB, bCoeff: NET },
      // right net pocket
      { ax: netR, ay: gT, bx: netR, by: gB, bCoeff: NET },
      { ax: netR, ay: gT, bx: R, by: gT, bCoeff: NET },
      { ax: netR, ay: gB, bx: R, by: gB, bCoeff: NET },
    ],
    posts: [
      { x: L, y: gT, radius: 10 },
      { x: L, y: gB, radius: 10 },
      { x: R, y: gT, radius: 10 },
      { x: R, y: gB, radius: 10 },
    ],
    goals: [
      { scorer: 'blue', side: 'left', x: L - 2, yTop: gT, yBottom: gB },
      { scorer: 'red', side: 'right', x: R + 2, yTop: gT, yBottom: gB },
    ],
  };
}

export const STADIUMS = {
  classic: classicPitch(),
  pillars: pillarsPitch(),
  diamond: diamondPitch(),
  colossus: colossusPitch(),
  titan: titanPitch(),
};

export function getStadium(key = 'classic') {
  return STADIUMS[key] || STADIUMS.classic;
}
