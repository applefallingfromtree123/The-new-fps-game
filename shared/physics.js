// AABB collision world, character movement and hitscan raycasting.
// The client runs this for prediction; the server runs the identical code for
// validation, so both sides agree on where players can stand and what they see.

import { PLAYER, COLLISION_EPS } from './constants.js';

const CELL = 8;

export class CollisionWorld {
  constructor(map) {
    this.map = map;
    this.blocks = map.blocks.map((b) => ({
      ...b,
      minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
      minY: b.y - b.h / 2, maxY: b.y + b.h / 2,
      minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    }));
    this.originX = -map.hx - CELL * 2;
    this.originZ = -map.hz - CELL * 2;
    this.cols = Math.ceil((map.hx * 2 + CELL * 4) / CELL);
    this.rows = Math.ceil((map.hz * 2 + CELL * 4) / CELL);
    this.grid = new Array(this.cols * this.rows);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    for (const b of this.blocks) this._insert(b);
  }

  _cellRange(minX, maxX, minZ, maxZ) {
    const c0 = Math.max(0, Math.floor((minX - this.originX) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((maxX - this.originX) / CELL));
    const r0 = Math.max(0, Math.floor((minZ - this.originZ) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((maxZ - this.originZ) / CELL));
    return { c0, c1, r0, r1 };
  }

  _insert(b) {
    const { c0, c1, r0, r1 } = this._cellRange(b.minX, b.maxX, b.minZ, b.maxZ);
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) this.grid[r * this.cols + c].push(b);
    }
  }

  /** Unique blocks overlapping an XZ region. */
  query(minX, maxX, minZ, maxZ, out = []) {
    out.length = 0;
    const { c0, c1, r0, r1 } = this._cellRange(minX, maxX, minZ, maxZ);
    const seen = _seen;
    _stamp++;
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const cell = this.grid[r * this.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (seen.get(b.i) === _stamp) continue;
          seen.set(b.i, _stamp);
          out.push(b);
        }
      }
    }
    return out;
  }

  /** True when an axis-aligned player box at (x,y,z) overlaps solid geometry. */
  boxBlocked(x, y, z, radius, height) {
    const minX = x - radius, maxX = x + radius;
    const minZ = z - radius, maxZ = z + radius;
    const minY = y, maxY = y + height;
    const cands = this.query(minX, maxX, minZ, maxZ, _scratch);
    for (let i = 0; i < cands.length; i++) {
      const b = cands[i];
      if (maxX <= b.minX + COLLISION_EPS || minX >= b.maxX - COLLISION_EPS) continue;
      if (maxZ <= b.minZ + COLLISION_EPS || minZ >= b.maxZ - COLLISION_EPS) continue;
      if (maxY <= b.minY + COLLISION_EPS || minY >= b.maxY - COLLISION_EPS) continue;
      return b;
    }
    return null;
  }

  /** Highest surface directly under a player box, used for stepping / landing. */
  groundBelow(x, y, z, radius, maxDrop = 2.0) {
    const cands = this.query(x - radius, x + radius, z - radius, z + radius, _scratch);
    let best = 0;                                    // world floor
    for (let i = 0; i < cands.length; i++) {
      const b = cands[i];
      if (x + radius <= b.minX || x - radius >= b.maxX) continue;
      if (z + radius <= b.minZ || z - radius >= b.maxZ) continue;
      if (b.maxY <= y + 0.05 && b.maxY > best && b.maxY >= y - maxDrop) best = b.maxY;
    }
    return best;
  }

  /**
   * Ray vs. world. Returns the nearest hit or null.
   * Uses a DDA walk over the broadphase grid so long rays stay cheap.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let nearest = null;
    let nearestT = maxDist;

    // Ground plane (y = 0) counts as solid.
    if (dy < -1e-6) {
      const t = -oy / dy;
      if (t >= 0 && t < nearestT) {
        nearest = { t, block: null, nx: 0, ny: 1, nz: 0, ground: true };
        nearestT = t;
      }
    }

    let cx = Math.floor((ox - this.originX) / CELL);
    let cz = Math.floor((oz - this.originZ) / CELL);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const invDx = dx !== 0 ? 1 / dx : Infinity;
    const invDz = dz !== 0 ? 1 / dz : Infinity;
    const nextBoundaryX = this.originX + (cx + (stepX > 0 ? 1 : 0)) * CELL;
    const nextBoundaryZ = this.originZ + (cz + (stepZ > 0 ? 1 : 0)) * CELL;
    let tMaxX = stepX !== 0 ? (nextBoundaryX - ox) * invDx : Infinity;
    let tMaxZ = stepZ !== 0 ? (nextBoundaryZ - oz) * invDz : Infinity;
    const tDeltaX = stepX !== 0 ? CELL * Math.abs(invDx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? CELL * Math.abs(invDz) : Infinity;

    _stamp++;
    const seen = _seen;
    let guard = 0;
    while (guard++ < 4096) {
      if (cx >= 0 && cx < this.cols && cz >= 0 && cz < this.rows) {
        const cell = this.grid[cz * this.cols + cx];
        for (let i = 0; i < cell.length; i++) {
          const b = cell[i];
          if (seen.get(b.i) === _stamp) continue;
          seen.set(b.i, _stamp);
          const hit = rayBox(ox, oy, oz, dx, dy, dz, b, nearestT);
          if (hit && hit.t < nearestT) { nearest = hit; nearestT = hit.t; }
        }
      }
      const tNext = Math.min(tMaxX, tMaxZ);
      if (tNext > nearestT || tNext > maxDist) break;
      if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDeltaX; } else { cz += stepZ; tMaxZ += tDeltaZ; }
      if (stepX === 0 && stepZ === 0) break;
    }
    if (!nearest) return null;
    nearest.x = ox + dx * nearest.t;
    nearest.y = oy + dy * nearest.t;
    nearest.z = oz + dz * nearest.t;
    nearest.dist = nearest.t;
    return nearest;
  }

  /** Simple line-of-sight test used by bot perception. */
  visible(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.15);
    return !hit;
  }
}

let _stamp = 0;
const _seen = new Map();
const _scratch = [];

function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  let tmin = 0, tmax = maxT;
  let nx = 0, ny = 0, nz = 0;

  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (b.minX - ox) * inv, t2 = (b.maxX - ox) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = sign; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Y slab
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.minY || oy > b.maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (b.minY - oy) * inv, t2 = (b.maxY - oy) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = sign; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (b.minZ - oz) * inv, t2 = (b.maxZ - oz) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0 || tmin > maxT) return null;
  return { t: tmin, block: b, nx, ny, nz };
}

/**
 * Move a character with axis-separated resolution and automatic step-up.
 * `state` carries { pos:{x,y,z}, vel:{x,y,z}, onGround, height }.
 */
export function moveCharacter(world, state, dt) {
  const r = PLAYER.radius;
  const h = state.height ?? PLAYER.height;
  const p = state.pos, v = state.vel;

  // --- vertical -----------------------------------------------------------
  v.y -= PLAYER.gravity * dt;
  let ny = p.y + v.y * dt;
  if (v.y <= 0) {
    const ground = world.groundBelow(p.x, p.y + 0.05, p.z, r, Math.max(0.6, -v.y * dt + 0.2));
    if (ny <= ground) {
      ny = ground;
      state.landedVel = v.y;
      v.y = 0;
      state.onGround = true;
    } else {
      state.onGround = false;
    }
  } else {
    // head bump
    if (world.boxBlocked(p.x, ny, p.z, r, h)) { ny = p.y; v.y = 0; }
    state.onGround = false;
  }
  p.y = ny;

  // --- horizontal ---------------------------------------------------------
  const moveAxis = (axis) => {
    const delta = v[axis] * dt;
    if (delta === 0) return;
    const prev = p[axis];
    p[axis] = prev + delta;
    if (!world.boxBlocked(p.x, p.y, p.z, r, h)) return;
    // try stepping up onto low geometry
    const stepY = p.y + PLAYER.stepHeight;
    if (state.onGround && !world.boxBlocked(p.x, stepY, p.z, r, h)) {
      const g = world.groundBelow(p.x, stepY + 0.05, p.z, r, PLAYER.stepHeight + 0.2);
      if (g > p.y && g - p.y <= PLAYER.stepHeight + 0.01) { p.y = g; return; }
    }
    p[axis] = prev;
    v[axis] = 0;
  };
  // move along the larger component first for smoother wall sliding
  if (Math.abs(v.x) >= Math.abs(v.z)) { moveAxis('x'); moveAxis('z'); } else { moveAxis('z'); moveAxis('x'); }

  // keep the player inside the arena
  const hx = world.map.hx - r - 0.2, hz = world.map.hz - r - 0.2;
  if (p.x < -hx) { p.x = -hx; v.x = 0; }
  if (p.x > hx) { p.x = hx; v.x = 0; }
  if (p.z < -hz) { p.z = -hz; v.z = 0; }
  if (p.z > hz) { p.z = hz; v.z = 0; }
  return state;
}

/** Horizontal acceleration with ground friction, Quake-style. */
export function applyMovementInput(state, wishX, wishZ, wishSpeed, dt) {
  const v = state.vel;
  const speed = Math.hypot(v.x, v.z);
  if (state.onGround) {
    if (speed > 0) {
      const drop = Math.max(speed, 1.0) * PLAYER.friction * dt;
      const scale = Math.max(0, speed - drop) / speed;
      v.x *= scale; v.z *= scale;
    }
  }
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen < 1e-4) return;
  const nx = wishX / wishLen, nz = wishZ / wishLen;
  const current = v.x * nx + v.z * nz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accel = (state.onGround ? PLAYER.acceleration : PLAYER.airAcceleration) * dt * wishSpeed;
  const applied = Math.min(accel, add);
  v.x += nx * applied;
  v.z += nz * applied;
}

/** Hitbox description for a standing/crouching soldier. */
export function playerHitboxes(x, y, z, height = PLAYER.height) {
  const s = height / PLAYER.height;
  return [
    { part: 'head', minX: x - 0.16, maxX: x + 0.16, minY: y + 1.56 * s, maxY: y + 1.82 * s, minZ: z - 0.16, maxZ: z + 0.16 },
    { part: 'chest', minX: x - 0.3, maxX: x + 0.3, minY: y + 1.05 * s, maxY: y + 1.56 * s, minZ: z - 0.22, maxZ: z + 0.22 },
    { part: 'stomach', minX: x - 0.28, maxX: x + 0.28, minY: y + 0.75 * s, maxY: y + 1.05 * s, minZ: z - 0.2, maxZ: z + 0.2 },
    { part: 'limb', minX: x - 0.42, maxX: x + 0.42, minY: y, maxY: y + 0.75 * s, minZ: z - 0.28, maxZ: z + 0.28 },
  ];
}

/** Ray vs. a single player's hitboxes. Returns { t, part } or null. */
export function rayPlayer(ox, oy, oz, dx, dy, dz, maxDist, px, py, pz, height) {
  // cheap reject: distance from the ray to the player's vertical axis
  const toX = px - ox, toZ = pz - oz;
  const along = toX * dx + toZ * dz + (py + height / 2 - oy) * dy;
  if (along < -1.5 || along > maxDist + 1.5) return null;
  let best = null;
  for (const hb of playerHitboxes(px, py, pz, height)) {
    const hit = rayBox(ox, oy, oz, dx, dy, dz, hb, maxDist);
    if (hit && (!best || hit.t < best.t)) best = { t: hit.t, part: hb.part };
  }
  return best;
}
