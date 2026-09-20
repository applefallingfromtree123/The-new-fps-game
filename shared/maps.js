// Twenty maps, generated deterministically from a seed + archetype so that the
// renderer, the collision solver and the bot navigation grid always agree.
//
// Every layout is built in one half of the arena and then copied with 180°
// rotational symmetry (x -> -x, z -> -z). That is how competitive shooters keep
// both spawns fair, and it means we only have to author half a map.

import { makeRng } from './rng.js';
import { CollisionWorld } from './physics.js';
import { PLAYER } from './constants.js';

export const THEMES = {
  desert: {
    sky: 0xf0c98a, fog: 0xe8c48f, fogDensity: 0.0042, ground: 0xc9a476,
    palette: [0xcbb392, 0xb89d78, 0xa78a64, 0xd9c6a3], accent: 0x8a6f4e,
    sun: 0xfff1d0, sunIntensity: 1.35, ambient: 0x8d7a5e, ambientIntensity: 0.75,
    label: '사막',
  },
  urban: {
    sky: 0x9fb2c4, fog: 0xa8b6c2, fogDensity: 0.0055, ground: 0x6f7378,
    palette: [0x8b8f94, 0x757a80, 0x9aa0a6, 0x62666b], accent: 0x4a4e53,
    sun: 0xfdf6e8, sunIntensity: 1.1, ambient: 0x6b7480, ambientIntensity: 0.8,
    label: '도심',
  },
  snow: {
    sky: 0xd7e4f0, fog: 0xcfdce8, fogDensity: 0.007, ground: 0xe8eef4,
    palette: [0xc3ccd6, 0xaeb8c4, 0xd6dee6, 0x98a3b0], accent: 0x6d7a88,
    sun: 0xe8f2ff, sunIntensity: 1.2, ambient: 0x9fb2c6, ambientIntensity: 0.95,
    label: '설원',
  },
  night: {
    sky: 0x1b2433, fog: 0x1d2736, fogDensity: 0.0072, ground: 0x394352,
    palette: [0x4d586a, 0x414b5b, 0x5c6878, 0x36404e], accent: 0x7b8a9e,
    sun: 0xa8c0e4, sunIntensity: 0.78, ambient: 0x5a6c8a, ambientIntensity: 1.15,
    label: '야간',
  },
  jungle: {
    sky: 0xb9cfa4, fog: 0xa9c497, fogDensity: 0.0075, ground: 0x4f6b3c,
    palette: [0x6b7f57, 0x5b6f49, 0x7d8f68, 0x4a5c3a], accent: 0x3c4a2e,
    sun: 0xf3ffdc, sunIntensity: 1.05, ambient: 0x66794f, ambientIntensity: 0.85,
    label: '정글',
  },
  industrial: {
    sky: 0xb0aca4, fog: 0xa8a49c, fogDensity: 0.006, ground: 0x585048,
    palette: [0x7a7268, 0x8d8579, 0x655e56, 0x9b9084], accent: 0xa8562f,
    sun: 0xfff4e2, sunIntensity: 1.15, ambient: 0x6f6a62, ambientIntensity: 0.8,
    label: '산업',
  },
  indoor: {
    sky: 0x525a66, fog: 0x4c545f, fogDensity: 0.009, ground: 0x6d727a,
    palette: [0x8e949d, 0x7b818a, 0x9ea5ae, 0x6f757e], accent: 0xc2a15a,
    sun: 0xffe9c4, sunIntensity: 0.95, ambient: 0xaeb6c2, ambientIntensity: 1.5,
    label: '실내',
  },
};

let _uid = 0;
function box(out, x, y, z, w, h, d, color, type = 'wall', extra) {
  out.push({ i: _uid++, x, y, z, w, h, d, c: color, t: type, ...(extra || {}) });
}

// Pair-place: adds the block and its 180°-rotated twin.
function pair(out, x, y, z, w, h, d, color, type, extra) {
  box(out, x, y, z, w, h, d, color, type, extra);
  box(out, -x, y, -z, w, h, d, color, type, extra);
}

/** Hollow structure with door gaps; players can walk inside. */
function structure(out, rng, cfg) {
  const { x, z, w, d, h, color, roofColor, doors = ['s'], windows = true, floorY = 0 } = cfg;
  const t = 0.4;                      // wall thickness
  const doorW = 2.6;
  const hw = w / 2, hd = d / 2;

  const sides = [
    { key: 'n', axis: 'x', len: w, cx: x, cz: z - hd },
    { key: 's', axis: 'x', len: w, cx: x, cz: z + hd },
    { key: 'w', axis: 'z', len: d, cx: x - hw, cz: z },
    { key: 'e', axis: 'z', len: d, cx: x + hw, cz: z },
  ];

  for (const s of sides) {
    const hasDoor = doors.includes(s.key);
    const along = s.axis === 'x' ? 'w' : 'd';
    const seg = (offset, length) => {
      if (length <= 0.15) return;
      const cx = s.axis === 'x' ? s.cx + offset : s.cx;
      const cz = s.axis === 'x' ? s.cz : s.cz + offset;
      const bw = s.axis === 'x' ? length : t;
      const bd = s.axis === 'x' ? t : length;
      if (windows && h > 3.2 && length > 3.4 && !hasDoor) {
        // lintel + sill so the wall reads as a window opening
        box(out, cx, floorY + 0.55, cz, bw, 1.1, bd, color, 'wall');
        box(out, cx, floorY + h - 0.6, cz, bw, 1.2, bd, color, 'wall');
        return;
      }
      box(out, cx, floorY + h / 2, cz, bw, h, bd, color, 'wall');
    };
    if (hasDoor) {
      const half = (s.len - doorW) / 2;
      seg(-(doorW / 2 + half / 2), half);
      seg(doorW / 2 + half / 2, half);
      // lintel above the doorway
      const cx = s.axis === 'x' ? s.cx : s.cx;
      const cz = s.axis === 'x' ? s.cz : s.cz;
      const bw = s.axis === 'x' ? doorW : t;
      const bd = s.axis === 'x' ? t : doorW;
      if (h > 3.0) box(out, cx, floorY + h - 0.45, cz, bw, 0.9, bd, color, 'wall');
    } else {
      seg(0, s.len);
    }
  }
  // roof (walkable)
  box(out, x, floorY + h + 0.15, z, w + t, 0.3, d + t, roofColor || color, 'roof');
  return { x, z, w, d, h, roofY: floorY + h + 0.3 };
}

/** Staircase built from discrete steps the movement code can walk up. */
function stairs(out, x, z, dir, width, topY, color) {
  const steps = Math.max(2, Math.round(topY / 0.42));
  const stepH = topY / steps;
  const stepD = 0.62;
  for (let i = 0; i < steps; i++) {
    const h = stepH * (i + 1);
    const off = (i + 0.5) * stepD;
    const px = dir === 'x' ? x + off : x;
    const pz = dir === 'z' ? z + off : z;
    const w = dir === 'x' ? stepD : width;
    const d = dir === 'z' ? stepD : width;
    box(out, px, h / 2, pz, w, h, d, color, 'stair');
  }
}

function container(out, x, y, z, rot, color) {
  const w = rot ? 2.5 : 6.1, d = rot ? 6.1 : 2.5;
  box(out, x, y + 1.3, z, w, 2.6, d, color, 'container');
}

function crateStack(out, rng, x, z, color, max = 3) {
  const n = rng.int(1, max);
  for (let i = 0; i < n; i++) {
    const s = rng.range(1.0, 1.6);
    box(out, x + rng.range(-0.4, 0.4), i * 1.2 + s / 2, z + rng.range(-0.4, 0.4), s, Math.min(1.2, s), s, color, 'crate');
  }
}

function perimeter(out, hx, hz, h, color) {
  const t = 1.0;
  box(out, 0, h / 2, -hz - t / 2, hx * 2 + t * 2, h, t, color, 'bound');
  box(out, 0, h / 2, hz + t / 2, hx * 2 + t * 2, h, t, color, 'bound');
  box(out, -hx - t / 2, h / 2, 0, t, h, hz * 2 + t * 2, color, 'bound');
  box(out, hx + t / 2, h / 2, 0, t, h, hz * 2 + t * 2, color, 'bound');
}

// ---------------------------------------------------------------- archetypes

function genUrban(out, rng, S, pal) {
  const { hx, hz } = S;
  const cols = Math.max(2, Math.round(hx / 16));
  const rows = Math.max(2, Math.round(hz / 18));
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = -hx + 8 + (c + 0.5) * ((hx * 2 - 16) / cols) * 0.5 - hx * 0.0;
      const bx = -hx + ((c + 0.5) / cols) * (hx * 2) * 0.5 - 0;
      const x = -hx * 0.95 + (c + 0.5) * ((hx * 1.9) / cols);
      const z = -hz * 0.95 + (r + 0.5) * ((hz * 0.85) / rows);
      if (Math.abs(x) < 7 && Math.abs(z) < 12) continue;
      if (!rng.chance(0.82)) { crateStack(out, rng, x, z, pal.accent); continue; }
      const w = rng.range(8, 13), d = rng.range(8, 12);
      const h = rng.range(3.6, 7.5);
      const doors = rng.chance(0.5) ? ['s', 'w'] : ['n', 'e'];
      structure(out, rng, { x, z, w, d, h, color: rng.pick(pal.palette), roofColor: pal.accent, doors });
      if (rng.chance(0.55)) stairs(out, x + w / 2 + 0.6, z - d / 2, 'z', 2.0, h + 0.3, pal.accent);
      // street clutter
      if (rng.chance(0.6)) crateStack(out, rng, x + rng.range(-w, w), z + d * 0.85, pal.accent);
    }
  }
  // long cover walls down the flanks
  pair(out, -hx * 0.62, 1.1, -hz * 0.18, 1.0, 2.2, hz * 0.4, pal.accent, 'wall');
  pair(out, hx * 0.62, 1.1, -hz * 0.3, 1.0, 2.2, hz * 0.3, pal.accent, 'wall');
}

function genIndustrial(out, rng, S, pal) {
  const { hx, hz } = S;
  const rowsZ = Math.max(2, Math.round(hz / 14));
  for (let r = 0; r < rowsZ; r++) {
    const z = -hz * 0.9 + (r + 0.5) * ((hz * 0.82) / rowsZ);
    const lanes = rng.int(2, 4);
    for (let i = 0; i < lanes; i++) {
      const x = rng.range(-hx * 0.88, hx * 0.88);
      if (Math.abs(x) < 5 && Math.abs(z) < 8) continue;
      const rot = rng.chance(0.45);
      const stack = rng.int(1, 3);
      const col = rng.pick([0xa8562f, 0x2f6ea8, 0x3f7a4a, 0xa89a2f, 0x8d3f58]);
      for (let s = 0; s < stack; s++) {
        container(out, x, s * 2.65, z + (rot ? 0 : s * rng.range(-0.3, 0.3)), rot, col);
      }
      if (stack > 1 && rng.chance(0.6)) stairs(out, x + 3.6, z, 'x', 2.2, stack * 2.65, pal.accent);
    }
  }
  // warehouse shells near the spawns
  structure(out, rng, { x: -hx * 0.5, z: -hz * 0.62, w: 20, d: 14, h: 6.5, color: pal.palette[1], roofColor: pal.accent, doors: ['s', 'e'] });
  structure(out, rng, { x: hx * 0.5, z: hz * 0.62, w: 20, d: 14, h: 6.5, color: pal.palette[1], roofColor: pal.accent, doors: ['n', 'w'] });
  // central gantry
  box(out, 0, 5.2, 0, hx * 0.5, 0.4, 5, pal.accent, 'roof');
  stairs(out, -hx * 0.27, 3.2, 'x', 2.4, 5.0, pal.accent);
  stairs(out, hx * 0.22, -3.2, 'x', 2.4, 5.0, pal.accent);
}

function genCompound(out, rng, S, pal) {
  const { hx, hz } = S;
  // walled compound in the middle
  const cw = hx * 0.55, cd = hz * 0.42;
  const t = 0.8, wh = 3.2;
  const gate = 4.0;
  // north/south walls with gate openings
  for (const sign of [-1, 1]) {
    const z = sign * cd;
    const half = (cw * 2 - gate) / 2;
    box(out, -(gate / 2 + half / 2), wh / 2, z, half, wh, t, pal.palette[0], 'wall');
    box(out, (gate / 2 + half / 2), wh / 2, z, half, wh, t, pal.palette[0], 'wall');
  }
  for (const sign of [-1, 1]) {
    const x = sign * cw;
    const half = (cd * 2 - gate) / 2;
    box(out, x, wh / 2, -(gate / 2 + half / 2), t, wh, half, pal.palette[0], 'wall');
    box(out, x, wh / 2, (gate / 2 + half / 2), t, wh, half, pal.palette[0], 'wall');
  }
  // main house
  structure(out, rng, { x: 0, z: 0, w: 18, d: 14, h: 4.2, color: pal.palette[2], roofColor: pal.accent, doors: ['n', 's'] });
  structure(out, rng, { x: 0, z: 0, w: 11, d: 8, h: 3.6, color: pal.palette[2], roofColor: pal.accent, doors: ['w', 'e'], floorY: 4.5 });
  stairs(out, 9.6, -4, 'x', 2.2, 4.5, pal.accent);
  stairs(out, -12.0, 4, 'x', 2.2, 4.5, pal.accent);
  // outbuildings, rotationally paired
  const spots = [[-hx * 0.72, -hz * 0.55], [hx * 0.68, -hz * 0.35], [-hx * 0.35, -hz * 0.78]];
  for (const [sx, sz] of spots) {
    structure(out, rng, { x: sx, z: sz, w: rng.range(9, 13), d: rng.range(8, 11), h: rng.range(3.4, 5.0), color: rng.pick(pal.palette), roofColor: pal.accent, doors: ['s'] });
    structure(out, rng, { x: -sx, z: -sz, w: rng.range(9, 13), d: rng.range(8, 11), h: rng.range(3.4, 5.0), color: rng.pick(pal.palette), roofColor: pal.accent, doors: ['n'] });
  }
  for (let i = 0; i < 8; i++) {
    const x = rng.range(-hx * 0.9, hx * 0.9), z = rng.range(-hz * 0.9, -hz * 0.1);
    pair(out, x, 1.0, z, rng.range(2.5, 6), 2.0, 0.8, pal.accent, 'wall');
  }
}

function genVillage(out, rng, S, pal) {
  const { hx, hz } = S;
  const count = Math.round((hx * hz) / 260);
  for (let i = 0; i < count; i++) {
    const x = rng.range(-hx * 0.88, hx * 0.88);
    const z = rng.range(-hz * 0.9, -hz * 0.08);
    if (Math.abs(x) < 6 && Math.abs(z) < 9) continue;
    const w = rng.range(6.5, 10.5), d = rng.range(6, 9.5), h = rng.range(3.2, 6.0);
    const doorsA = rng.pick([['s'], ['n'], ['w'], ['e'], ['s', 'w']]);
    structure(out, rng, { x, z, w, d, h, color: rng.pick(pal.palette), roofColor: pal.accent, doors: doorsA });
    structure(out, rng, { x: -x, z: -z, w, d, h, color: rng.pick(pal.palette), roofColor: pal.accent, doors: doorsA.map(flipDoor) });
    if (rng.chance(0.4)) {
      stairs(out, x + w / 2 + 0.5, z - d / 2, 'z', 1.8, h + 0.3, pal.accent);
      stairs(out, -(x + w / 2 + 0.5), -(z - d / 2), 'z', 1.8, h + 0.3, pal.accent);
    }
  }
  // market stalls + low walls in the middle
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-hx * 0.75, hx * 0.75), z = rng.range(-hz * 0.35, -0.5);
    pair(out, x, 1.05, z, rng.range(2.2, 5.0), 2.1, 0.7, pal.accent, 'wall');
  }
  for (let i = 0; i < 12; i++) {
    const x = rng.range(-hx * 0.85, hx * 0.85), z = rng.range(-hz * 0.85, -1);
    crateStack(out, rng, x, z, pal.palette[3]);
    crateStack(out, rng, -x, -z, pal.palette[3]);
  }
}

function flipDoor(k) {
  return ({ n: 's', s: 'n', w: 'e', e: 'w' })[k] || k;
}

function genFacility(out, rng, S, pal) {
  const { hx, hz } = S;
  const h = 4.0;
  box(out, 0, h + 0.4, 0, hx * 2, 0.5, hz * 2, pal.palette[3], 'roof');

  const cell = hx < 30 ? 6.5 : 9;
  const cols = Math.max(3, Math.round(hx / cell));
  const rows = Math.max(3, Math.round(hz / cell));
  const cw = (hx * 2) / cols;
  const cd = (hz * 2) / rows;

  // Carve a spanning tree over the room grid so every room is reachable,
  // then knock extra holes through for flanking routes.
  const open = { v: new Set(), h: new Set() };   // v: wall between (c,r)-(c+1,r)
  const visited = new Set(['0,0']);
  const stack = [[0, 0]];
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const neighbours = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]
      .filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < cols && nr < rows && !visited.has(`${nc},${nr}`));
    if (!neighbours.length) { stack.pop(); continue; }
    const [nc, nr] = neighbours[Math.floor(rng() * neighbours.length)];
    visited.add(`${nc},${nr}`);
    if (nc !== c) open.v.add(`${Math.min(c, nc)},${r}`);
    else open.h.add(`${c},${Math.min(r, nr)}`);
    stack.push([nc, nr]);
  }
  for (let c = 0; c < cols - 1; c++) for (let r = 0; r < rows; r++) if (rng.chance(0.42)) open.v.add(`${c},${r}`);
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows - 1; r++) if (rng.chance(0.42)) open.h.add(`${c},${r}`);

  const doorW = 2.8;
  // vertical walls (running along z) between horizontally adjacent rooms
  for (let c = 0; c < cols - 1; c++) {
    for (let r = 0; r < rows; r++) {
      const x = -hx + (c + 1) * cw;
      const z0 = -hz + r * cd;
      const color = pal.palette[(c + r) % 2];
      if (open.v.has(`${c},${r}`)) {
        const seg = (cd - doorW) / 2;
        box(out, x, h / 2, z0 + seg / 2, 0.45, h, seg, color, 'wall');
        box(out, x, h / 2, z0 + cd - seg / 2, 0.45, h, seg, color, 'wall');
        box(out, x, h - 0.4, z0 + cd / 2, 0.45, 0.8, doorW, color, 'wall');
      } else {
        box(out, x, h / 2, z0 + cd / 2, 0.45, h, cd, color, 'wall');
      }
    }
  }
  // horizontal walls (running along x) between vertically adjacent rooms
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows - 1; r++) {
      const z = -hz + (r + 1) * cd;
      const x0 = -hx + c * cw;
      const color = pal.palette[(c + r + 1) % 2];
      if (open.h.has(`${c},${r}`)) {
        const seg = (cw - doorW) / 2;
        box(out, x0 + seg / 2, h / 2, z, seg, h, 0.45, color, 'wall');
        box(out, x0 + cw - seg / 2, h / 2, z, seg, h, 0.45, color, 'wall');
        box(out, x0 + cw / 2, h - 0.4, z, doorW, 0.8, 0.45, color, 'wall');
      } else {
        box(out, x0 + cw / 2, h / 2, z, cw, h, 0.45, color, 'wall');
      }
    }
  }

  // support pillars and crates for cover inside the rooms
  for (let c = 1; c < cols; c++) {
    for (let r = 1; r < rows; r++) {
      if (!rng.chance(0.3)) continue;
      box(out, -hx + c * cw, h / 2, -hz + r * cd, 0.9, h, 0.9, pal.accent, 'pillar');
    }
  }
  for (let i = 0; i < Math.round((hx * hz) / 70); i++) {
    const x = rng.range(-hx * 0.9, hx * 0.9), z = rng.range(-hz * 0.9, -0.5);
    crateStack(out, rng, x, z, pal.accent, 2);
    crateStack(out, rng, -x, -z, pal.accent, 2);
  }
}

function genArena(out, rng, S, pal) {
  const { hx, hz } = S;
  // raised centre platform with ramps
  box(out, 0, 1.0, 0, hx * 0.5, 2.0, hz * 0.34, pal.palette[1], 'platform');
  stairs(out, -hx * 0.25 - 2.6, 0, 'x', hz * 0.22, 2.0, pal.accent);
  stairs(out, hx * 0.25 + 2.6, 0, 'x', hz * 0.22, 2.0, pal.accent);
  // side cover
  for (let i = 0; i < 7; i++) {
    const x = rng.range(-hx * 0.85, hx * 0.85);
    const z = rng.range(-hz * 0.88, -hz * 0.12);
    if (rng.chance(0.45)) {
      pair(out, x, 1.1, z, rng.range(2.4, 5.2), 2.2, 0.7, pal.accent, 'wall');
    } else {
      container(out, x, 0, z, rng.chance(0.5), rng.pick([0xa8562f, 0x2f6ea8, 0x3f7a4a]));
      container(out, -x, 0, -z, rng.chance(0.5), rng.pick([0xa8562f, 0x2f6ea8, 0x3f7a4a]));
    }
  }
  // corner shacks
  const corners = [[-hx * 0.78, -hz * 0.74], [hx * 0.78, -hz * 0.74]];
  for (const [cx, cz] of corners) {
    structure(out, rng, { x: cx, z: cz, w: 7, d: 6, h: 3.4, color: pal.palette[0], roofColor: pal.accent, doors: ['s'] });
    structure(out, rng, { x: -cx, z: -cz, w: 7, d: 6, h: 3.4, color: pal.palette[0], roofColor: pal.accent, doors: ['n'] });
  }
}

function genPort(out, rng, S, pal) {
  const { hx, hz } = S;
  genIndustrial(out, rng, { hx: hx * 0.85, hz: hz * 0.7 }, pal);
  // quay walls and cranes
  pair(out, -hx * 0.82, 1.6, -hz * 0.85, hx * 0.3, 3.2, 1.2, pal.palette[2], 'wall');
  for (const sign of [-1, 1]) {
    const x = sign * hx * 0.6, z = sign * hz * 0.8;
    box(out, x, 6.0, z, 2.0, 12.0, 2.0, pal.accent, 'wall');
    box(out, x, 12.2, z, 22.0, 0.8, 2.0, pal.accent, 'roof');
  }
}

const ARCHETYPES = {
  urban: genUrban,
  industrial: genIndustrial,
  compound: genCompound,
  village: genVillage,
  facility: genFacility,
  arena: genArena,
  port: genPort,
};

// ------------------------------------------------------------------ map list

export const MAP_DEFS = [
  // --- large (전장 / 12v12) -------------------------------------------------
  { id: 'sandstorm', name: '모래폭풍', en: 'Sandstorm', size: 'large', arch: 'village', theme: 'desert', seed: 'sandstorm-7', desc: '광활한 사막 마을. 장거리 교전과 시가전이 공존합니다.' },
  { id: 'highlands', name: '고원 전초기지', en: 'Highlands', size: 'large', arch: 'compound', theme: 'jungle', seed: 'highlands-3', desc: '고지대 전초기지. 중앙 본관을 둘러싼 공방전.' },
  { id: 'port_karachi', name: '카라치 항만', en: 'Port Karachi', size: 'large', arch: 'port', theme: 'industrial', seed: 'port-11', desc: '컨테이너가 쌓인 항만. 수직 교전이 잦습니다.' },
  { id: 'frostline', name: '동토 전선', en: 'Frostline', size: 'large', arch: 'urban', theme: 'snow', seed: 'frost-5', desc: '눈 덮인 전선 도시. 시야가 짧고 측면이 열려 있습니다.' },
  { id: 'oilfield', name: '유전 지대', en: 'Oilfield', size: 'large', arch: 'industrial', theme: 'desert', seed: 'oil-19', desc: '시추 시설과 파이프라인. 엄폐물이 빽빽합니다.' },
  { id: 'dam', name: '댐 방어선', en: 'Dam Line', size: 'large', arch: 'urban', theme: 'night', seed: 'dam-23', desc: '야간 댐 시설. 조명 아래 좁은 통로가 얽혀 있습니다.' },

  // --- medium (격돌 / 12v12) -----------------------------------------------
  { id: 'crossfire', name: '교차사격', en: 'Crossfire', size: 'medium', arch: 'village', theme: 'desert', seed: 'cross-2', desc: '세 갈래 길이 중앙에서 교차하는 클래식 구조.' },
  { id: 'terminal', name: '터미널', en: 'Terminal', size: 'medium', arch: 'facility', theme: 'indoor', seed: 'term-8', desc: '공항 터미널 내부. 기둥과 게이트가 엄폐를 만듭니다.' },
  { id: 'favela', name: '파벨라', en: 'Favela', size: 'medium', arch: 'village', theme: 'jungle', seed: 'favela-13', desc: '층층이 쌓인 판자촌. 옥상 이동이 핵심입니다.' },
  { id: 'cargo_yard', name: '화물 적치장', en: 'Cargo Yard', size: 'medium', arch: 'industrial', theme: 'industrial', seed: 'cargo-4', desc: '컨테이너 미로. 코너 싸움이 끊이지 않습니다.' },
  { id: 'backlot', name: '뒷골목', en: 'Backlot', size: 'medium', arch: 'urban', theme: 'urban', seed: 'backlot-17', desc: '좁은 골목과 건물 내부가 이어진 도심 맵.' },
  { id: 'estate', name: '대저택', en: 'Estate', size: 'medium', arch: 'compound', theme: 'jungle', seed: 'estate-9', desc: '2층 저택과 정원. 실내외 전환이 빠릅니다.' },
  { id: 'subway', name: '지하철역', en: 'Subway', size: 'medium', arch: 'facility', theme: 'indoor', seed: 'subway-21', desc: '승강장과 대합실. 전형적인 근·중거리 맵.' },
  { id: 'refinery', name: '정유소', en: 'Refinery', size: 'medium', arch: 'industrial', theme: 'night', seed: 'refine-6', desc: '야간 정유 시설. 상부 통로가 전장을 지배합니다.' },

  // --- small (1대1 / 격돌) --------------------------------------------------
  { id: 'the_pit', name: '더 핏', en: 'The Pit', size: 'small', arch: 'arena', theme: 'desert', seed: 'pit-1', desc: '사격 훈련장. 1대1 결투의 정석.' },
  { id: 'shoothouse', name: '슛하우스', en: 'Shoothouse', size: 'small', arch: 'facility', theme: 'indoor', seed: 'shoot-14', desc: '3레인 구조의 초고속 교전 맵.' },
  { id: 'rust', name: '러스트', en: 'Rust', size: 'small', arch: 'industrial', theme: 'desert', seed: 'rust-10', desc: '중앙 탑을 둘러싼 전설적인 소형 맵.' },
  { id: 'dome', name: '돔', en: 'Dome', size: 'small', arch: 'arena', theme: 'snow', seed: 'dome-18', desc: '원형 구조의 대칭 아레나.' },
  { id: 'killhouse', name: '킬하우스', en: 'Killhouse', size: 'small', arch: 'facility', theme: 'indoor', seed: 'kill-16', desc: 'SAS 훈련장. 총성이 멈추지 않습니다.' },
  { id: 'vault', name: '금고', en: 'Vault', size: 'small', arch: 'arena', theme: 'night', seed: 'vault-12', desc: '야간 금고동. 엄폐물 사이 짧은 시야 싸움.' },
];

export const SIZE_PRESETS = {
  small: { hx: 22, hz: 22, objectives: 1 },
  medium: { hx: 44, hz: 44, objectives: 3 },
  large: { hx: 78, hz: 78, objectives: 5 },
};

const OBJ_NAMES = ['A', 'B', 'C', 'D', 'E'];

function makeObjectives(count, hx, hz) {
  const objs = [];
  if (count <= 1) {
    objs.push({ id: 'A', x: 0, z: 0, radius: 6 });
    return objs;
  }
  if (count === 3) {
    objs.push({ id: 'A', x: -hx * 0.55, z: -hz * 0.42, radius: 6.5 });
    objs.push({ id: 'B', x: 0, z: 0, radius: 7 });
    objs.push({ id: 'C', x: hx * 0.55, z: hz * 0.42, radius: 6.5 });
    return objs;
  }
  // five points: two rotational pairs plus the centre
  objs.push({ id: 'A', x: -hx * 0.62, z: -hz * 0.52, radius: 8 });
  objs.push({ id: 'B', x: hx * 0.5, z: -hz * 0.3, radius: 8 });
  objs.push({ id: 'C', x: 0, z: 0, radius: 9 });
  objs.push({ id: 'D', x: -hx * 0.5, z: hz * 0.3, radius: 8 });
  objs.push({ id: 'E', x: hx * 0.62, z: hz * 0.52, radius: 8 });
  return objs;
}

function makeSpawns(hx, hz, rng) {
  const mk = (sign) => {
    const list = [];
    const z = sign * (hz - 4.5);
    for (let i = 0; i < 12; i++) {
      const x = -hx * 0.72 + (i / 11) * hx * 1.44;
      list.push({ x, z: z - sign * rng.range(0, 3.5), yaw: sign < 0 ? 0 : Math.PI });
    }
    return list;
  };
  return { 0: mk(-1), 1: mk(1) };
}

const _cache = new Map();

/** Build (and memoise) the full geometry for a map id. */
export function buildMap(mapId) {
  if (_cache.has(mapId)) return _cache.get(mapId);
  const def = MAP_DEFS.find((m) => m.id === mapId);
  if (!def) throw new Error(`unknown map: ${mapId}`);
  const preset = SIZE_PRESETS[def.size];
  const theme = THEMES[def.theme];
  const rng = makeRng(def.seed);
  _uid = 0;

  const blocks = [];
  const S = { hx: preset.hx, hz: preset.hz };
  perimeter(blocks, preset.hx, preset.hz, def.size === 'small' ? 6 : 9, theme.palette[0]);
  ARCHETYPES[def.arch](blocks, rng, S, { ...theme, palette: theme.palette, accent: theme.accent });

  const map = {
    id: def.id,
    name: def.name,
    en: def.en,
    desc: def.desc,
    size: def.size,
    theme: def.theme,
    themeData: theme,
    hx: preset.hx,
    hz: preset.hz,
    blocks: blocks.filter((b) => b.t !== 'noop' && b.w > 0 && b.d > 0 && b.h > 0),
    objectives: makeObjectives(preset.objectives, preset.hx, preset.hz),
    spawns: makeSpawns(preset.hx, preset.hz, rng),
    killZ: -14,
  };
  relocateBlockedSpawns(map);
  _cache.set(mapId, map);
  return map;
}

/**
 * Nudge any spawn point that ended up inside generated geometry to the nearest
 * clear tile, so nobody ever spawns stuck inside a crate or a wall.
 */
function relocateBlockedSpawns(map) {
  const world = new CollisionWorld(map);
  const r = PLAYER.radius;
  const clear = (x, z) => {
    if (Math.abs(x) > map.hx - 1.5 || Math.abs(z) > map.hz - 1.5) return null;
    const y = world.groundBelow(x, 4, z, r, 8);
    if (y > 3) return null;                       // do not spawn on rooftops
    return world.boxBlocked(x, y, z, r, PLAYER.height) ? null : y;
  };
  for (const team of [0, 1]) {
    for (const spawn of map.spawns[team]) {
      if (clear(spawn.x, spawn.z) !== null) continue;
      let moved = false;
      for (let radius = 1.5; radius <= 12 && !moved; radius += 1.5) {
        for (let a = 0; a < 12 && !moved; a++) {
          const ang = (a / 12) * Math.PI * 2;
          const nx = spawn.x + Math.cos(ang) * radius;
          const nz = spawn.z + Math.sin(ang) * radius;
          if (clear(nx, nz) !== null) { spawn.x = nx; spawn.z = nz; moved = true; }
        }
      }
    }
  }
}

export function mapsBySize(size) {
  return MAP_DEFS.filter((m) => m.size === size).map((m) => m.id);
}

export function mapSummary(id) {
  return MAP_DEFS.find((m) => m.id === id);
}
