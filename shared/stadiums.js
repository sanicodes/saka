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

export const STADIUMS = {
  classic: classicPitch(),
};

export function getStadium(key = 'classic') {
  return STADIUMS[key] || STADIUMS.classic;
}
