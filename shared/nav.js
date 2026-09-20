// Ground-level navigation grid + A* used by the bot AI.
// Cells are marked walkable when a standing player box fits at floor height,
// which naturally opens up building interiors (our structures are hollow).

import { PLAYER } from './constants.js';

const CELL = 2.0;

export class NavGrid {
  constructor(world) {
    this.world = world;
    const map = world.map;
    this.originX = -map.hx;
    this.originZ = -map.hz;
    this.cols = Math.ceil((map.hx * 2) / CELL);
    this.rows = Math.ceil((map.hz * 2) / CELL);
    this.cell = CELL;
    this.walk = new Uint8Array(this.cols * this.rows);
    this.floor = new Float32Array(this.cols * this.rows);
    this.cost = new Float32Array(this.cols * this.rows);
    // Waypoints are stored per cell rather than assumed to be the cell centre:
    // a doorway can sit anywhere inside a cell, and pinning the waypoint to the
    // clear spot is what keeps narrow gaps traversable.
    this.px = new Float32Array(this.cols * this.rows);
    this.pz = new Float32Array(this.cols * this.rows);

    const r = PLAYER.radius * 0.95;
    const offsets = [0, -0.62, 0.62];
    for (let c = 0; c < this.cols; c++) {
      for (let rr = 0; rr < this.rows; rr++) {
        const cx = this.originX + (c + 0.5) * CELL;
        const cz = this.originZ + (rr + 0.5) * CELL;
        const idx = rr * this.cols + c;
        let ok = false, floorY = 0, bestX = cx, bestZ = cz, bestD = Infinity;
        for (const ox of offsets) {
          for (const oz of offsets) {
            const x = cx + ox, z = cz + oz;
            // allow a small step up so ramps and kerbs stay connected
            for (const y of [0, 0.45, 0.9]) {
              const g = world.groundBelow(x, y + 0.05, z, r, 1.2);
              if (Math.abs(g - y) > 0.6) continue;
              if (world.boxBlocked(x, g, z, r, PLAYER.height * 0.95)) continue;
              const d = ox * ox + oz * oz;
              if (d < bestD) { bestD = d; bestX = x; bestZ = z; floorY = g; }
              ok = true;
              break;
            }
          }
        }
        this.walk[idx] = ok ? 1 : 0;
        this.floor[idx] = floorY;
        this.px[idx] = bestX;
        this.pz[idx] = bestZ;
      }
    }
    // cells hugging geometry cost a little more, so bots prefer open lanes
    for (let c = 0; c < this.cols; c++) {
      for (let rr = 0; rr < this.rows; rr++) {
        const idx = rr * this.cols + c;
        if (!this.walk[idx]) continue;
        let blocked = 0;
        for (let dc = -1; dc <= 1; dc++) {
          for (let dr = -1; dr <= 1; dr++) {
            const nc = c + dc, nr = rr + dr;
            if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) { blocked++; continue; }
            if (!this.walk[nr * this.cols + nc]) blocked++;
          }
        }
        this.cost[idx] = 1 + blocked * 0.12;
      }
    }
    this._open = new Float32Array(this.cols * this.rows);
    this._g = new Float32Array(this.cols * this.rows);
    this._from = new Int32Array(this.cols * this.rows);
    this._stamp = new Int32Array(this.cols * this.rows);
    this._tick = 0;
  }

  /** The usable waypoint for a cell (the clear spot found while building). */
  cellCenter(c, r) {
    const i = r * this.cols + c;
    if (this.walk[i]) return { x: this.px[i], z: this.pz[i] };
    return { x: this.originX + (c + 0.5) * CELL, z: this.originZ + (r + 0.5) * CELL };
  }

  toCell(x, z) {
    return {
      c: Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.originX) / CELL))),
      r: Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.originZ) / CELL))),
    };
  }

  isWalkable(x, z) {
    const { c, r } = this.toCell(x, z);
    return this.walk[r * this.cols + c] === 1;
  }

  /** Nearest walkable cell index to a world position (spiral search). */
  nearestWalkable(x, z) {
    const { c, r } = this.toCell(x, z);
    if (this.walk[r * this.cols + c]) return r * this.cols + c;
    for (let ring = 1; ring < 12; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const i = nr * this.cols + nc;
          if (this.walk[i]) return i;
        }
      }
    }
    return -1;
  }

  /** A* path as a list of world waypoints, or null when unreachable. */
  findPath(sx, sz, tx, tz, maxNodes = 6000) {
    const start = this.nearestWalkable(sx, sz);
    const goal = this.nearestWalkable(tx, tz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];

    this._tick++;
    const tick = this._tick;
    const { cols, rows } = this;
    const gScore = this._g, cameFrom = this._from, stamp = this._stamp;
    const heap = new MinHeap();

    const hx = (i) => {
      const c = i % cols, r = (i / cols) | 0;
      const gc = goal % cols, gr = (goal / cols) | 0;
      const dx = Math.abs(c - gc), dz = Math.abs(r - gr);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    stamp[start] = tick; gScore[start] = 0; cameFrom[start] = -1;
    heap.push(start, hx(start));
    let expanded = 0;

    while (heap.size > 0 && expanded < maxNodes) {
      const cur = heap.pop();
      if (cur === goal) return this._reconstruct(cameFrom, cur, tx, tz);
      expanded++;
      const cc = cur % cols, cr = (cur / cols) | 0;
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (dc === 0 && dr === 0) continue;
          const nc = cc + dc, nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (!this.walk[ni]) continue;
          if (dc !== 0 && dr !== 0) {
            // no corner cutting
            if (!this.walk[cr * cols + nc] || !this.walk[nr * cols + cc]) continue;
          }
          const step = (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1) * this.cost[ni];
          const tentative = gScore[cur] + step;
          if (stamp[ni] !== tick || tentative < gScore[ni]) {
            stamp[ni] = tick;
            gScore[ni] = tentative;
            cameFrom[ni] = cur;
            heap.push(ni, tentative + hx(ni) * 1.05);
          }
        }
      }
    }
    return null;
  }

  _reconstruct(cameFrom, goal, tx, tz) {
    const raw = [];
    let cur = goal;
    while (cur !== -1) {
      const c = cur % this.cols, r = (cur / this.cols) | 0;
      raw.push(this.cellCenter(c, r));
      cur = cameFrom[cur];
    }
    raw.reverse();
    // string-pull: drop waypoints we can walk straight past
    const pts = [];
    let i = 0;
    while (i < raw.length) {
      let j = raw.length - 1;
      for (; j > i + 1; j--) {
        if (this._clearLine(raw[i].x, raw[i].z, raw[j].x, raw[j].z)) break;
      }
      pts.push(raw[j]);
      i = j;
      if (j === raw.length - 1) break;
    }
    pts.push({ x: tx, z: tz });
    return pts;
  }

  _clearLine(ax, az, bx, bz) {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / (CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.isWalkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  randomPoint(rng = Math.random) {
    for (let i = 0; i < 64; i++) {
      const c = Math.floor(rng() * this.cols), r = Math.floor(rng() * this.rows);
      if (this.walk[r * this.cols + c]) return this.cellCenter(c, r);
    }
    return { x: 0, z: 0 };
  }
}

class MinHeap {
  constructor() { this.items = []; this.prio = []; this.size = 0; }
  push(item, priority) {
    let i = this.size++;
    this.items[i] = item; this.prio[i] = priority;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prio[p] <= this.prio[i]) break;
      this._swap(p, i); i = p;
    }
  }
  pop() {
    const top = this.items[0];
    this.size--;
    if (this.size > 0) {
      this.items[0] = this.items[this.size];
      this.prio[0] = this.prio[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.size && this.prio[l] < this.prio[m]) m = l;
        if (r < this.size && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this._swap(m, i); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    const ti = this.items[a]; this.items[a] = this.items[b]; this.items[b] = ti;
    const tp = this.prio[a]; this.prio[a] = this.prio[b]; this.prio[b] = tp;
  }
}
