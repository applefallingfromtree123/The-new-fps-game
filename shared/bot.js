// Bot AI. Each brain writes into its entity's input struct, so bots drive the
// exact same movement/weapon code path as human players.

import { PLAYER } from './constants.js';
import { getWeapon, fireInterval } from './weapons.js';
import { OBJECTIVE } from './modes.js';

export const BOT_NAMES = [
  'Ghost', 'Roach', 'Soap', 'Price', 'Gaz', 'Nikolai', 'Yuri', 'Wolf',
  'Reaper', 'Viper', 'Falcon', 'Hawk', 'Raven', 'Cobra', 'Bravo-6',
  'Talon', 'Kestrel', 'Nomad', 'Mako', 'Outlaw', 'Rook', 'Sierra',
  'Vulcan', 'Zulu', 'Echo-3', 'Juno', 'Pike', 'Stalker', 'Warden', 'Drift',
];

const STATE = { PATROL: 'patrol', ENGAGE: 'engage', SEEK: 'seek', REGROUP: 'regroup' };

export class BotBrain {
  constructor(sim, entity, difficulty) {
    this.sim = sim;
    this.e = entity;
    this.d = difficulty;
    this.state = STATE.PATROL;
    this.target = null;
    this.lastSeen = null;
    this.senseAt = 0;
    this.repathAt = 0;
    this.path = null;
    this.pathIndex = 0;
    this.goal = null;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.fireUntil = 0;
    this.holdFireUntil = 0;
    this.aimYaw = entity.yaw;
    this.aimPitch = 0;
    this.reactAt = 0;
    this.nextGrenadeAt = 6 + Math.random() * 20;
    this.jitterPhase = Math.random() * 100;
    this.stuckTimer = 0;
    this.lastPos = { x: 0, z: 0 };
  }

  onRespawn() {
    this.state = STATE.PATROL;
    this.target = null;
    this.lastSeen = null;
    this.path = null;
    this.goal = null;
    this.repathAt = 0;
    this.aimYaw = this.e.yaw;
    this.aimPitch = 0;
  }

  think(dt) {
    const e = this.e;
    const sim = this.sim;
    const input = e.input;

    // reset the per-tick action flags
    input.fire = false; input.jump = false; input.melee = false;
    input.lethal = false; input.tactical = false; input.reload = false;
    input.streak = !!e.pendingStreak;

    if (!e.alive) { input.forward = 0; input.right = 0; return; }

    if (sim.time >= this.senseAt) {
      this.senseAt = sim.time + 0.12 + Math.random() * 0.08;
      this.sense();
    }

    if (sim.time < e.blindUntil) {
      // blinded: back off and spray in the last known direction
      input.forward = -0.6; input.right = this.strafeDir * 0.5;
      input.sprint = false; input.ads = false;
      input.fire = Math.random() < 0.25;
      this.applyLook(dt, 2.0);
      return;
    }

    switch (this.state) {
      case STATE.ENGAGE: this.engage(dt); break;
      case STATE.SEEK: this.seek(dt); break;
      default: this.patrol(dt); break;
    }

    this.maybeReload();
    this.maybeGrenade(dt);
    this.unstick(dt);
  }

  // ------------------------------------------------------------ perception
  sense() {
    const e = this.e, sim = this.sim;
    let best = null, bestScore = -Infinity;
    const fovCos = Math.cos((this.d.fov * Math.PI) / 180 / 2);
    const maxRange = e.weaponDef.cls === 'sniper' ? 160 : 95;

    for (const other of sim.entities.values()) {
      if (other === e || !other.alive || other.team === e.team) continue;
      const dx = other.pos.x - e.pos.x, dz = other.pos.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > maxRange) continue;
      const l = dist || 1;
      const facing = (Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz) / l;
      const inFov = facing >= fovCos || dist < 8;
      if (!inFov && !(sim.uav[e.team] > sim.time && sim.isRevealed(other, e.team))) continue;
      if (!sim.world.visible(e.pos.x, e.eyeY, e.pos.z, other.pos.x, other.eyeY, other.pos.z)) continue;
      const score = 200 - dist + (other.health < 50 ? 40 : 0) + (this.target === other ? 30 : 0);
      if (score > bestScore) { bestScore = score; best = other; }
    }

    if (best) {
      if (this.target !== best) this.reactAt = this.sim.time + this.d.reaction * (0.6 + Math.random() * 0.8);
      this.target = best;
      this.lastSeen = { x: best.pos.x, y: best.pos.y, z: best.pos.z, at: sim.time };
      this.state = STATE.ENGAGE;
    } else if (this.state === STATE.ENGAGE) {
      this.state = this.lastSeen ? STATE.SEEK : STATE.PATROL;
      this.target = null;
      this.path = null;
    }
  }

  // ---------------------------------------------------------------- combat
  engage(dt) {
    const e = this.e, sim = this.sim, input = e.input;
    const t = this.target;
    if (!t || !t.alive) { this.state = STATE.PATROL; return; }

    const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const def = e.weaponDef;

    // aim at the chest, drifting toward the head as skill increases
    const aimY = t.pos.y + t.height * (0.62 + this.d.aim * 0.28);
    this.faceTarget(t.pos.x, aimY, t.pos.z, dist);
    this.applyLook(dt, 6.5 + this.d.aim * 9);

    // preferred engagement distance per weapon class
    const ideal = def.cls === 'sniper' ? 45 : def.cls === 'shotgun' ? 6 : def.cls === 'smg' ? 12 : 22;
    const wantClose = dist > ideal * 1.5;
    const wantBack = dist < ideal * 0.45;

    if (sim.time >= this.strafeUntil) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = sim.time + 0.5 + Math.random() * 1.1;
    }

    input.forward = wantClose ? 1 : wantBack ? -0.8 : (Math.random() < 0.02 ? 0.4 : 0);
    input.right = this.strafeDir * (0.5 + this.d.aggression * 0.5);
    input.sprint = wantClose && dist > ideal * 2.4 && e.health > 55;
    input.crouch = !input.sprint && dist > 28 && Math.random() < 0.01 ? !input.crouch : input.crouch && dist > 20;
    input.ads = !input.sprint && (dist > 9 || def.cls === 'sniper');

    // low health: break contact
    if (e.health < 32 && Math.random() < 0.02) {
      this.state = STATE.REGROUP;
      this.goal = this.pickCover();
      this.path = null;
    }

    if (sim.time < this.reactAt) return;

    // fire discipline: bursts, with a skill-scaled chance to hold
    const inRange = dist < def.farRange * 1.25;
    const aimErr = this.aimError(t, dist);
    const maxErr = 0.035 + (1 - this.d.aim) * 0.09 + (dist > 40 ? 0.02 : 0);
    if (inRange && aimErr < maxErr && sim.world.visible(e.pos.x, e.eyeY, e.pos.z, t.pos.x, t.eyeY, t.pos.z)) {
      if (sim.time >= this.holdFireUntil) {
        input.fire = true;
        const auto = def.rpm > 300;
        if (auto && sim.time >= this.fireUntil) {
          // burst on, then a short pause so bots do not laser across the map
          this.fireUntil = sim.time + (0.18 + Math.random() * 0.35) * (0.6 + this.d.aggression);
          this.holdFireUntil = this.fireUntil + (0.12 + Math.random() * 0.3) * (1.4 - this.d.aggression);
        } else if (!auto) {
          this.holdFireUntil = sim.time + fireInterval(def) * (1.1 + Math.random() * 0.8);
        }
      }
    }
    if (dist < 2.2 && Math.random() < 0.08) input.melee = true;
  }

  aimError(t, dist) {
    const e = this.e;
    const dx = t.pos.x - e.pos.x;
    const dz = t.pos.z - e.pos.z;
    const desiredYaw = Math.atan2(dx, dz);
    let dy = desiredYaw - e.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const desiredPitch = Math.atan2(t.pos.y + t.height * 0.7 - e.eyeY, dist);
    const dp = desiredPitch - e.pitch;
    return Math.hypot(dy, dp);
  }

  faceTarget(x, y, z, dist) {
    const e = this.e;
    const dx = x - e.pos.x, dz = z - e.pos.z;
    // skill-scaled aim jitter, larger at range
    const j = (1 - this.d.aim) * 0.06 * (1 + dist / 60);
    const n = this.sim.time * 2.7 + this.jitterPhase;
    // better bots pull down against their own recoil, like a human would
    const comp = this.d.aim;
    this.aimYaw = Math.atan2(dx, dz) + Math.sin(n) * j - e.recoil.h * comp;
    this.aimPitch = Math.atan2(y - e.eyeY, dist || 0.01) + Math.cos(n * 1.3) * j * 0.6 - e.recoil.v * comp;
  }

  applyLook(dt, speed) {
    const e = this.e;
    let dy = this.aimYaw - e.input.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const k = Math.min(1, speed * dt);
    e.input.yaw += dy * k;
    e.input.pitch += (this.aimPitch - e.input.pitch) * k;
  }

  // -------------------------------------------------------------- movement
  seek(dt) {
    const e = this.e, input = e.input;
    if (!this.lastSeen || this.sim.time - this.lastSeen.at > 9) {
      this.state = STATE.PATROL; this.lastSeen = null; this.path = null; return;
    }
    this.goal = { x: this.lastSeen.x, z: this.lastSeen.z };
    const arrived = this.followPath(dt, 1.0);
    input.sprint = true;
    input.ads = false;
    if (arrived) { this.state = STATE.PATROL; this.lastSeen = null; }
  }

  patrol(dt) {
    const e = this.e, input = e.input;
    if (!this.goal || this.reachedGoal()) this.goal = this.pickGoal();
    const arrived = this.followPath(dt, 1.0);
    input.sprint = true;
    input.ads = false;
    input.crouch = false;
    if (arrived) this.goal = this.pickGoal();
  }

  reachedGoal() {
    if (!this.goal) return true;
    return Math.hypot(this.e.pos.x - this.goal.x, this.e.pos.z - this.goal.z) < 3.0;
  }

  pickGoal() {
    const sim = this.sim, e = this.e;
    if (sim.mode.objective === OBJECTIVE.DOMINATION) {
      // head for the most valuable point: not ours, and reasonably close
      let best = null, bestScore = -Infinity;
      for (const o of sim.objectives) {
        const d = Math.hypot(e.pos.x - o.x, e.pos.z - o.z);
        let score = 120 - d * 0.8;
        if (o.owner !== e.team) score += 70;
        if (o.contested) score += 50;
        score += Math.random() * 40;
        if (score > bestScore) { bestScore = score; best = o; }
      }
      if (best) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * best.radius * 0.8;
        return { x: best.x + Math.cos(a) * r, z: best.z + Math.sin(a) * r };
      }
    }
    if (sim.mode.objective === OBJECTIVE.ROUNDS) {
      const enemy = [...sim.entities.values()].find((o) => o.team !== e.team && o.alive);
      if (enemy) {
        const a = Math.random() * Math.PI * 2;
        return { x: enemy.pos.x + Math.cos(a) * 8, z: enemy.pos.z + Math.sin(a) * 8 };
      }
    }
    // team deathmatch: push toward the enemy half, with variety
    const enemies = [...sim.entities.values()].filter((o) => o.team !== e.team && o.alive);
    if (enemies.length && Math.random() < 0.6) {
      const t = enemies[Math.floor(Math.random() * enemies.length)];
      return { x: t.pos.x + (Math.random() - 0.5) * 16, z: t.pos.z + (Math.random() - 0.5) * 16 };
    }
    return sim.nav.randomPoint();
  }

  pickCover() {
    const e = this.e, sim = this.sim;
    const away = this.target
      ? Math.atan2(e.pos.x - this.target.pos.x, e.pos.z - this.target.pos.z)
      : Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 10;
    const p = { x: e.pos.x + Math.sin(away) * dist, z: e.pos.z + Math.cos(away) * dist };
    if (sim.nav.isWalkable(p.x, p.z)) return p;
    return sim.nav.randomPoint();
  }

  followPath(dt, speedScale) {
    const e = this.e, sim = this.sim, input = e.input;
    if (!this.goal) return true;

    if (!this.path || sim.time >= this.repathAt || this.pathIndex >= this.path.length) {
      this.path = sim.nav.findPath(e.pos.x, e.pos.z, this.goal.x, this.goal.z);
      this.pathIndex = 0;
      this.repathAt = sim.time + 1.6 + Math.random() * 1.2;
      if (!this.path) { this.goal = sim.nav.randomPoint(); return false; }
    }

    let wp = this.path[this.pathIndex];
    while (wp && Math.hypot(e.pos.x - wp.x, e.pos.z - wp.z) < 1.6) {
      this.pathIndex++;
      wp = this.path[this.pathIndex];
    }
    if (!wp) return true;

    const dx = wp.x - e.pos.x, dz = wp.z - e.pos.z;
    const desiredYaw = Math.atan2(dx, dz);
    if (this.state !== STATE.ENGAGE) {
      this.aimYaw = desiredYaw;
      this.aimPitch = 0;
      this.applyLook(dt, 5.5);
      input.forward = 1 * speedScale;
      input.right = 0;
    } else {
      // keep facing the enemy while walking toward the waypoint
      let rel = desiredYaw - e.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      input.forward = Math.cos(rel) * speedScale;
      input.right = Math.sin(rel) * speedScale;
    }

    // hop small ledges
    if (e.onGround && Math.random() < 0.006) input.jump = true;
    return false;
  }

  unstick(dt) {
    const e = this.e;
    const moved = Math.hypot(e.pos.x - this.lastPos.x, e.pos.z - this.lastPos.z);
    this.lastPos.x = e.pos.x; this.lastPos.z = e.pos.z;
    const wantsToMove = Math.abs(e.input.forward) + Math.abs(e.input.right) > 0.2;
    if (wantsToMove && moved < 0.02) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.6) {
        this.stuckTimer = 0;
        this.path = null;
        this.repathAt = 0;
        this.goal = this.sim.nav.randomPoint();
        e.input.jump = true;
        this.strafeDir *= -1;
      }
    } else {
      this.stuckTimer = 0;
    }
  }

  maybeReload() {
    const e = this.e;
    const def = e.weaponDef;
    const w = e.weapon;
    if (e.reloadEndAt > 0 || w.reserve <= 0) return;
    const low = w.ammo <= Math.max(1, Math.floor(def.magazine * 0.22));
    const safe = this.state !== STATE.ENGAGE;
    if (w.ammo === 0 || (low && safe)) e.input.reload = true;
  }

  maybeGrenade(dt) {
    const e = this.e, sim = this.sim;
    this.nextGrenadeAt -= dt;
    if (this.nextGrenadeAt > 0) return;
    const t = this.target;
    if (!t || !t.alive || e.lethalCount <= 0) return;
    const dist = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    if (dist < 9 || dist > 32) return;
    if (Math.random() > this.d.aggression * 0.6) { this.nextGrenadeAt = 4; return; }
    // aim slightly above the target so the arc lands near them
    this.aimYaw = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    this.aimPitch = Math.atan2(t.pos.y - e.eyeY, dist) + 0.12 + dist * 0.004;
    e.input.yaw = this.aimYaw; e.input.pitch = this.aimPitch;
    e.input.lethal = true;
    this.nextGrenadeAt = 14 + Math.random() * 20;
  }
}
