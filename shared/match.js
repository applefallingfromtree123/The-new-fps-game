// Authoritative match simulation.
// The client runs this directly for offline matches; the server runs it for
// online rooms and streams snapshots. Identical rules on both sides.

import { PLAYER, TEAM, SCORE, DAMAGE_MULTIPLIER, KILLSTREAKS } from './constants.js';
import { WEAPONS, LOADOUTS, MELEE, LETHALS, TACTICALS, getWeapon, fireInterval, damageAtRange } from './weapons.js';
import { getMode, OBJECTIVE, DIFFICULTY } from './modes.js';
import { buildMap } from './maps.js';
import { CollisionWorld, moveCharacter, applyMovementInput, rayPlayer } from './physics.js';
import { NavGrid } from './nav.js';
import { makeRng } from './rng.js';
import { BotBrain, BOT_NAMES } from './bot.js';

export const MATCH_STATE = {
  WARMUP: 'warmup',
  LIVE: 'live',
  ROUND_END: 'round_end',
  ENDED: 'ended',
};

export function emptyInput() {
  return {
    forward: 0, right: 0, yaw: 0, pitch: 0,
    jump: false, crouch: false, sprint: false, ads: false,
    fire: false, reload: false, melee: false,
    weaponSlot: 0, lethal: false, tactical: false, streak: false,
    seq: 0,
  };
}

let _nextEntityId = 1;

export class Entity {
  constructor(opts) {
    this.id = opts.id ?? _nextEntityId++;
    this.name = opts.name || 'Soldier';
    this.team = opts.team;
    this.isBot = !!opts.isBot;
    this.loadoutId = opts.loadoutId || 'assault';
    const lo = LOADOUTS.find((l) => l.id === this.loadoutId) || LOADOUTS[0];
    this.loadout = lo;

    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.height = PLAYER.height;
    this.onGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.ads = false;
    this.adsAmount = 0;

    this.health = PLAYER.maxHealth;
    this.alive = false;
    this.respawnAt = 0;
    this.spawnProtectUntil = 0;
    this.lastDamageTime = -99;
    this.damagers = new Map();          // attackerId -> damage dealt

    this.slot = 0;                       // 0 primary, 1 secondary
    this.weapons = [
      makeWeaponState(lo.primary),
      makeWeaponState(lo.secondary),
    ];
    this.nextFireAt = 0;
    this.reloadEndAt = 0;
    this.swapEndAt = 0;
    this.meleeReadyAt = 0;
    this.recoil = { v: 0, h: 0 };
    this.spreadBloom = 0;

    this.lethalCount = LETHALS[lo.lethal]?.count ?? 1;
    this.tacticalCount = TACTICALS[lo.tactical]?.count ?? 1;
    this.nextThrowAt = 0;

    this.kills = 0; this.deaths = 0; this.assists = 0;
    this.score = 0; this.streak = 0; this.bestStreak = 0;
    this.captures = 0;
    this.pendingStreak = null;
    this.streakReadyAt = 0;
    this.blindUntil = 0;

    this.input = emptyInput();
    this.brain = null;
    this.ping = 0;
    this.connected = true;
  }

  get weapon() { return this.weapons[this.slot]; }
  get weaponDef() { return getWeapon(this.weapon.id); }
  get eyeY() { return this.pos.y + (this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight); }
}

function makeWeaponState(id) {
  const def = getWeapon(id);
  return { id, ammo: def.magazine, reserve: def.reserve };
}

export class MatchSim {
  constructor(opts) {
    this.modeId = opts.modeId;
    this.mode = getMode(opts.modeId);
    this.mapId = opts.mapId;
    this.map = buildMap(opts.mapId);
    this.world = new CollisionWorld(this.map);
    this.nav = new NavGrid(this.world);
    this.rng = makeRng(opts.seed ?? (Math.random() * 1e9) | 0);
    this.difficulty = DIFFICULTY[opts.difficulty || 'regular'];

    this.time = 0;
    this.state = MATCH_STATE.WARMUP;
    this.warmupEndsAt = opts.warmup ?? 3;
    this.timeLeft = this.mode.timeLimit || 0;
    this.scores = { 0: 0, 1: 0 };
    this.roundWins = { 0: 0, 1: 0 };
    this.round = 1;
    this.roundEndAt = 0;
    this.winner = null;

    this.entities = new Map();
    this.projectiles = [];
    this.events = [];
    this.uav = { 0: 0, 1: 0 };          // expiry timestamps per team
    this.counterUav = { 0: 0, 1: 0 };

    this.objectives = this.map.objectives.map((o) => ({
      ...o,
      owner: TEAM.NONE,
      progress: 0,                       // -1 .. 1, sign indicates capturing team
      contested: false,
      capturingTeam: TEAM.NONE,
    }));

    this._hitScratch = [];
    this._killfeed = [];
  }

  // ------------------------------------------------------------- entities
  addEntity(opts) {
    const e = new Entity(opts);
    if (e.isBot) e.brain = new BotBrain(this, e, opts.difficulty ? DIFFICULTY[opts.difficulty] : this.difficulty);
    this.entities.set(e.id, e);
    this.respawn(e, true);
    return e;
  }

  addBot(team, difficulty) {
    const used = new Set([...this.entities.values()].map((e) => e.name));
    let name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)];
    let guard = 0;
    while (used.has(name) && guard++ < 50) name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)];
    const pool = ['assault', 'raider', 'marksman', 'support', 'breacher', 'demolition'];
    return this.addEntity({
      name,
      team,
      isBot: true,
      difficulty,
      loadoutId: pool[Math.floor(this.rng() * pool.length)],
    });
  }

  removeEntity(id) {
    this.entities.delete(id);
  }

  teamCount(team) {
    let n = 0;
    for (const e of this.entities.values()) if (e.team === team) n++;
    return n;
  }

  /** Fill both teams with bots up to the mode's team size. */
  fillWithBots(difficulty) {
    for (const team of [TEAM.ALPHA, TEAM.BRAVO]) {
      while (this.teamCount(team) < this.mode.teamSize) this.addBot(team, difficulty);
    }
  }

  // --------------------------------------------------------------- spawning
  pickSpawn(entity) {
    const list = this.map.spawns[entity.team] || this.map.spawns[0];
    const enemies = [...this.entities.values()].filter((e) => e.team !== entity.team && e.alive);
    let best = list[0];
    let bestScore = -Infinity;
    for (const s of list) {
      let nearest = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.pos.x - s.x, e.pos.z - s.z);
        if (d < nearest) nearest = d;
      }
      // prefer spawns far from enemies, with a little randomness for variety
      const score = Math.min(nearest, 60) + this.rng() * 8;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  respawn(entity, initial = false) {
    const spawn = this.pickSpawn(entity);
    entity.pos.x = spawn.x + (this.rng() - 0.5) * 1.6;
    entity.pos.z = spawn.z + (this.rng() - 0.5) * 1.6;
    entity.pos.y = this.world.groundBelow(entity.pos.x, 4, entity.pos.z, PLAYER.radius, 6);
    entity.vel.x = entity.vel.y = entity.vel.z = 0;
    entity.yaw = spawn.yaw;
    entity.pitch = 0;
    entity.health = PLAYER.maxHealth;
    entity.alive = true;
    entity.crouching = false;
    entity.height = PLAYER.height;
    entity.spawnProtectUntil = this.time + PLAYER.spawnProtection;
    entity.damagers.clear();
    entity.lastDamageTime = -99;
    entity.blindUntil = 0;
    entity.streak = entity.streak || 0;
    for (const w of entity.weapons) {
      const def = getWeapon(w.id);
      w.ammo = def.magazine;
      if (initial) w.reserve = def.reserve;
    }
    entity.slot = 0;
    entity.reloadEndAt = 0;
    entity.lethalCount = LETHALS[entity.loadout.lethal]?.count ?? 1;
    entity.tacticalCount = TACTICALS[entity.loadout.tactical]?.count ?? 1;
    if (entity.brain) entity.brain.onRespawn();
    this.emit({ type: 'spawn', id: entity.id, x: entity.pos.x, y: entity.pos.y, z: entity.pos.z });
  }

  // ------------------------------------------------------------------ input
  setInput(id, input) {
    const e = this.entities.get(id);
    if (!e || e.isBot) return;
    Object.assign(e.input, input);
  }

  // ------------------------------------------------------------------- tick
  step(dt) {
    this.time += dt;

    if (this.state === MATCH_STATE.WARMUP) {
      if (this.time >= this.warmupEndsAt) {
        this.state = MATCH_STATE.LIVE;
        this.emit({ type: 'match_start' });
      }
    }

    const live = this.state === MATCH_STATE.LIVE;

    for (const e of this.entities.values()) {
      if (e.isBot && e.brain) e.brain.think(dt);
      if (!e.alive) {
        if (live && this.mode.objective !== OBJECTIVE.ROUNDS && this.time >= e.respawnAt) this.respawn(e);
        continue;
      }
      this.updateEntity(e, dt, live);
    }

    this.updateProjectiles(dt);
    if (live) {
      this.updateObjectives(dt);
      this.updateClock(dt);
    }
    if (this.state === MATCH_STATE.ROUND_END && this.time >= this.roundEndAt) this.beginRound();
  }

  updateEntity(e, dt, live) {
    const input = e.input;
    e.yaw = input.yaw;
    e.pitch = Math.max(-1.45, Math.min(1.45, input.pitch));

    // crouch / stance
    const wantCrouch = !!input.crouch;
    if (wantCrouch !== e.crouching) {
      if (!wantCrouch) {
        // only stand up when there is headroom
        if (!this.world.boxBlocked(e.pos.x, e.pos.y, e.pos.z, PLAYER.radius, PLAYER.height)) {
          e.crouching = false; e.height = PLAYER.height;
        }
      } else {
        e.crouching = true; e.height = PLAYER.crouchHeight;
      }
    }

    // aim-down-sights blend
    const def = e.weaponDef;
    const wantAds = !!input.ads && e.reloadEndAt <= this.time;
    e.ads = wantAds;
    const adsRate = dt / Math.max(0.05, def.adsTime);
    e.adsAmount = Math.max(0, Math.min(1, e.adsAmount + (wantAds ? adsRate : -adsRate * 1.4)));

    // movement
    const perks = e.loadout.perks || [];
    let speed = e.crouching ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
    const wantSprint = input.sprint && input.forward > 0.2 && !wantAds && !e.crouching;
    e.sprinting = wantSprint && e.onGround;
    if (e.sprinting) speed = PLAYER.sprintSpeed;
    if (wantAds) speed *= PLAYER.adsSpeedScale;
    if (perks.includes('lightweight')) speed *= 1.08;
    if (def.cls === 'lmg' || def.cls === 'sniper') speed *= 0.93;
    if (this.state !== MATCH_STATE.LIVE) speed *= 0.0;

    const sin = Math.sin(e.yaw), cos = Math.cos(e.yaw);
    // yaw 0 looks toward +z
    const wishX = input.right * cos + input.forward * sin;
    const wishZ = -input.right * sin + input.forward * cos;
    applyMovementInput(e, wishX, wishZ, speed, dt);

    if (input.jump && e.onGround && live) {
      e.vel.y = PLAYER.jumpVelocity;
      e.onGround = false;
    }

    moveCharacter(this.world, e, dt);

    // fall damage
    if (e.onGround && e.landedVel !== undefined && e.landedVel < -14) {
      const dmg = Math.min(95, (Math.abs(e.landedVel) - 14) * 7);
      if (dmg > 1 && !perks.includes('commando')) this.damage(e, null, dmg, 'fall', 'limb');
      e.landedVel = undefined;
    }
    if (e.pos.y < this.map.killZ) this.damage(e, null, 999, 'void', 'limb');
    if (!e.alive) return;

    // health regeneration
    if (this.time - e.lastDamageTime > PLAYER.regenDelay && e.health < PLAYER.maxHealth) {
      e.health = Math.min(PLAYER.maxHealth, e.health + PLAYER.regenRate * dt);
    }

    // weapon handling
    this.updateWeapon(e, dt, live);

    // recoil recovery
    e.recoil.v *= Math.max(0, 1 - def.recoilRecovery * dt);
    e.recoil.h *= Math.max(0, 1 - def.recoilRecovery * dt);
    e.spreadBloom = Math.max(0, e.spreadBloom - dt * 2.4);
  }

  updateWeapon(e, dt, live) {
    const input = e.input;
    const def = e.weaponDef;
    const w = e.weapon;

    if (typeof input.weaponSlot === 'number' && input.weaponSlot !== e.slot && this.time >= e.swapEndAt) {
      e.slot = input.weaponSlot === 1 ? 1 : 0;
      e.swapEndAt = this.time + def.swapTime;
      e.reloadEndAt = 0;
      this.emit({ type: 'swap', id: e.id, slot: e.slot });
    }
    if (this.time < e.swapEndAt) return;

    if (e.reloadEndAt > 0 && this.time >= e.reloadEndAt) {
      const need = def.magazine - w.ammo;
      const take = Math.min(need, w.reserve);
      w.ammo += take; w.reserve -= take;
      e.reloadEndAt = 0;
    }
    const reloading = e.reloadEndAt > 0;

    if (input.reload && !reloading && w.ammo < def.magazine && w.reserve > 0) {
      e.reloadEndAt = this.time + def.reloadTime;
      this.emit({ type: 'reload', id: e.id, dur: def.reloadTime });
      return;
    }

    if (input.melee && this.time >= e.meleeReadyAt) {
      e.meleeReadyAt = this.time + MELEE.cooldown;
      this.doMelee(e);
      return;
    }

    if (input.lethal && e.lethalCount > 0 && this.time >= e.nextThrowAt) {
      e.lethalCount--;
      e.nextThrowAt = this.time + 0.8;
      this.throwGrenade(e, LETHALS[e.loadout.lethal], 'lethal');
      return;
    }
    if (input.tactical && e.tacticalCount > 0 && this.time >= e.nextThrowAt) {
      e.tacticalCount--;
      e.nextThrowAt = this.time + 0.8;
      this.throwGrenade(e, TACTICALS[e.loadout.tactical], 'tactical');
      return;
    }
    if (input.streak && e.pendingStreak) this.useStreak(e);

    if (!live || !input.fire || reloading) return;
    if (this.time < e.nextFireAt) return;
    if (e.sprinting) return;
    if (w.ammo <= 0) {
      if (w.reserve > 0) e.reloadEndAt = this.time + def.reloadTime;
      else if (e.slot === 0 && e.weapons[1].ammo + e.weapons[1].reserve > 0) {
        e.slot = 1; e.swapEndAt = this.time + def.swapTime;
      }
      this.emit({ type: 'dryfire', id: e.id });
      e.nextFireAt = this.time + 0.35;
      return;
    }

    this.fire(e);
  }

  currentSpread(e) {
    const def = e.weaponDef;
    let spread = e.ads ? def.adsSpread : def.spread;
    const horizSpeed = Math.hypot(e.vel.x, e.vel.z);
    if (!e.onGround) spread *= def.airSpread;
    else if (horizSpeed > 1.0) spread *= 1 + (def.moveSpread - 1) * Math.min(1, horizSpeed / PLAYER.sprintSpeed);
    if (e.crouching) spread *= def.crouchSpread;
    if ((e.loadout.perks || []).includes('steady_aim') && !e.ads) spread *= 0.75;
    return spread + e.spreadBloom * (e.ads ? 0.12 : 0.45);
  }

  aimDirection(e, spreadDeg) {
    // recoil is stored in radians and offsets the aim directly
    const yaw = e.yaw + e.recoil.h;
    const pitch = e.pitch + e.recoil.v;
    let dx = Math.sin(yaw) * Math.cos(pitch);
    let dy = Math.sin(pitch);
    let dz = Math.cos(yaw) * Math.cos(pitch);
    if (spreadDeg > 0) {
      const rad = (spreadDeg * Math.PI) / 180;
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * rad;
      // build an orthonormal basis around the aim vector
      const ux = Math.cos(yaw), uz = -Math.sin(yaw);
      const vx = -Math.sin(yaw) * Math.sin(pitch);
      const vy = Math.cos(pitch);
      const vz = -Math.cos(yaw) * Math.sin(pitch);
      const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
      dx += ux * ox + vx * oy;
      dy += vy * oy;
      dz += uz * ox + vz * oy;
      const l = Math.hypot(dx, dy, dz);
      dx /= l; dy /= l; dz /= l;
    }
    return { dx, dy, dz };
  }

  fire(e) {
    const def = e.weaponDef;
    const w = e.weapon;
    // shooting forfeits spawn protection so it cannot be used as a shield
    e.spawnProtectUntil = 0;
    w.ammo--;
    e.nextFireAt = this.time + fireInterval(def);
    e.spreadBloom = Math.min(3.5, e.spreadBloom + (e.ads ? 0.18 : 0.5));
    const kick = e.ads ? 0.6 : 1.0;
    e.recoil.v += def.recoil.v * kick * 0.006;
    e.recoil.h += (this.rng() - 0.5) * def.recoil.h * kick * 0.010;

    const ox = e.pos.x, oy = e.eyeY, oz = e.pos.z;
    const spread = this.currentSpread(e);

    if (def.projectile === 'rocket') {
      const d = this.aimDirection(e, spread * 0.4);
      this.projectiles.push({
        kind: 'rocket', owner: e.id, team: e.team,
        x: ox + d.dx * 0.6, y: oy + d.dy * 0.6, z: oz + d.dz * 0.6,
        vx: d.dx * def.velocity, vy: d.dy * def.velocity, vz: d.dz * def.velocity,
        life: 6, def,
      });
      this.emit({ type: 'shot', id: e.id, weapon: def.id, x: ox, y: oy, z: oz, dx: d.dx, dy: d.dy, dz: d.dz, rocket: true });
      return;
    }

    const traces = [];
    for (let p = 0; p < def.pellets; p++) {
      const d = this.aimDirection(e, spread);
      const hit = this.traceShot(e, ox, oy, oz, d.dx, d.dy, d.dz, def);
      traces.push({ dx: d.dx, dy: d.dy, dz: d.dz, dist: hit ? hit.dist : 200, hitPlayer: hit?.entity?.id ?? null, nx: hit?.nx ?? 0, ny: hit?.ny ?? 0, nz: hit?.nz ?? 0 });
    }
    this.emit({ type: 'shot', id: e.id, weapon: def.id, x: ox, y: oy, z: oz, traces });
  }

  /** One bullet: nearest of world geometry and enemy hitboxes. */
  traceShot(shooter, ox, oy, oz, dx, dy, dz, def) {
    const maxDist = 250;
    const worldHit = this.world.raycast(ox, oy, oz, dx, dy, dz, maxDist);
    let limit = worldHit ? worldHit.dist : maxDist;
    let bestEntity = null;
    let bestT = limit;
    let bestPart = 'chest';

    for (const other of this.entities.values()) {
      if (other === shooter || !other.alive) continue;
      if (other.team === shooter.team && this.mode.friendlyFire !== true) continue;
      const r = rayPlayer(ox, oy, oz, dx, dy, dz, bestT, other.pos.x, other.pos.y, other.pos.z, other.height);
      if (r && r.t < bestT) { bestT = r.t; bestEntity = other; bestPart = r.part; }
    }

    if (bestEntity) {
      let dmg = damageAtRange(def, bestT) * (DAMAGE_MULTIPLIER[bestPart] || 1);
      if (bestPart === 'head' && !def.headshotCapable) dmg = damageAtRange(def, bestT);
      if ((shooter.loadout.perks || []).includes('stopping_power')) dmg *= 1.12;
      this.damage(bestEntity, shooter, dmg, def.id, bestPart);
      return { dist: bestT, entity: bestEntity, part: bestPart };
    }
    if (worldHit) {
      this.emit({ type: 'impact', x: worldHit.x, y: worldHit.y, z: worldHit.z, nx: worldHit.nx, ny: worldHit.ny, nz: worldHit.nz, surface: worldHit.block ? worldHit.block.t : 'ground' });
      return { dist: worldHit.dist, entity: null, nx: worldHit.nx, ny: worldHit.ny, nz: worldHit.nz };
    }
    return null;
  }

  doMelee(e) {
    const range = (e.loadout.perks || []).includes('commando') ? MELEE.range * 1.6 : MELEE.range;
    const d = this.aimDirection(e, 0);
    let target = null, bestT = range;
    for (const other of this.entities.values()) {
      if (other === e || !other.alive || other.team === e.team) continue;
      const r = rayPlayer(e.pos.x, e.eyeY, e.pos.z, d.dx, d.dy, d.dz, bestT, other.pos.x, other.pos.y, other.pos.z, other.height);
      if (r && r.t < bestT) { bestT = r.t; target = other; }
    }
    this.emit({ type: 'melee', id: e.id, hit: !!target });
    if (target) this.damage(target, e, MELEE.damage, 'melee', 'chest');
  }

  throwGrenade(e, def, kind) {
    if (!def) return;
    const d = this.aimDirection(e, 0);
    const up = 0.28;
    this.projectiles.push({
      kind, grenadeId: def.id, owner: e.id, team: e.team,
      x: e.pos.x + d.dx * 0.5, y: e.eyeY + 0.1, z: e.pos.z + d.dz * 0.5,
      vx: d.dx * def.throwSpeed + e.vel.x * 0.5,
      vy: (d.dy + up) * def.throwSpeed,
      vz: d.dz * def.throwSpeed + e.vel.z * 0.5,
      fuse: this.time + def.fuse, def, bounces: 0,
    });
    this.emit({ type: 'throw', id: e.id, kind, grenade: def.id });
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const prevX = p.x, prevY = p.y, prevZ = p.z;

      if (p.kind === 'rocket') {
        p.vy -= 2.5 * dt;                          // barely affected by gravity
      } else {
        p.vy -= PLAYER.gravity * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.life = (p.life ?? 30) - dt;

      const dx = p.x - prevX, dy = p.y - prevY, dz = p.z - prevZ;
      const len = Math.hypot(dx, dy, dz);
      let impact = null;
      if (len > 1e-5) {
        const hit = this.world.raycast(prevX, prevY, prevZ, dx / len, dy / len, dz / len, len);
        if (hit) impact = hit;
        if (p.kind === 'rocket') {
          for (const other of this.entities.values()) {
            if (!other.alive || other.id === p.owner) continue;
            const r = rayPlayer(prevX, prevY, prevZ, dx / len, dy / len, dz / len, len, other.pos.x, other.pos.y, other.pos.z, other.height);
            if (r && (!impact || r.t < impact.dist)) impact = { x: prevX + (dx / len) * r.t, y: prevY + (dy / len) * r.t, z: prevZ + (dz / len) * r.t, dist: r.t };
          }
        }
      }

      if (p.kind === 'rocket') {
        if (impact || p.life <= 0 || p.y < -5) {
          const ex = impact ? impact.x : p.x, ey = impact ? impact.y : p.y, ez = impact ? impact.z : p.z;
          this.explode(ex, ey, ez, p.def.damage, p.def.splashRadius, p.owner, 'rpg7');
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      if (impact) {
        if (p.def.sticky) {
          p.x = impact.x + impact.nx * 0.05; p.y = impact.y + impact.ny * 0.05; p.z = impact.z + impact.nz * 0.05;
          p.vx = p.vy = p.vz = 0; p.stuck = true;
        } else {
          p.x = impact.x + impact.nx * 0.08; p.y = impact.y + impact.ny * 0.08; p.z = impact.z + impact.nz * 0.08;
          const dot = p.vx * impact.nx + p.vy * impact.ny + p.vz * impact.nz;
          const rest = 0.42;
          p.vx = (p.vx - 2 * dot * impact.nx) * rest;
          p.vy = (p.vy - 2 * dot * impact.ny) * rest;
          p.vz = (p.vz - 2 * dot * impact.nz) * rest;
          p.bounces++;
          if (Math.hypot(p.vx, p.vy, p.vz) < 0.6) { p.vx = p.vy = p.vz = 0; p.resting = true; }
          this.emit({ type: 'bounce', x: p.x, y: p.y, z: p.z });
        }
      }

      if (this.time >= p.fuse) {
        if (p.kind === 'lethal') {
          this.explode(p.x, p.y, p.z, p.def.damage, p.def.radius, p.owner, p.def.id);
        } else if (p.grenadeId === 'flash') {
          this.flashbang(p);
        } else {
          this.emit({ type: 'smoke', x: p.x, y: p.y, z: p.z, radius: p.def.radius, duration: p.def.duration });
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  explode(x, y, z, damage, radius, ownerId, source) {
    this.emit({ type: 'explosion', x, y, z, radius });
    const owner = this.entities.get(ownerId) || null;
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      const cx = e.pos.x, cy = e.pos.y + e.height * 0.5, cz = e.pos.z;
      const dist = Math.hypot(cx - x, cy - y, cz - z);
      if (dist > radius) continue;
      if (!this.world.visible(x, y, z, cx, cy, cz)) continue;
      const falloff = 1 - dist / radius;
      const dmg = damage * falloff * falloff;
      if (dmg < 2) continue;
      if (owner && e.team === owner.team && e !== owner) continue;   // no team damage
      this.damage(e, owner, dmg, source, 'chest');
      // knockback
      const l = Math.max(0.3, dist);
      e.vel.x += ((cx - x) / l) * falloff * 7;
      e.vel.y += Math.max(0.2, (cy - y) / l) * falloff * 5;
      e.vel.z += ((cz - z) / l) * falloff * 7;
    }
  }

  flashbang(p) {
    this.emit({ type: 'flash', x: p.x, y: p.y, z: p.z });
    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      const dist = Math.hypot(e.pos.x - p.x, e.eyeY - p.y, e.pos.z - p.z);
      if (dist > p.def.radius) continue;
      if (!this.world.visible(p.x, p.y, p.z, e.pos.x, e.eyeY, e.pos.z)) continue;
      // facing the flash means a longer blind
      const toX = p.x - e.pos.x, toZ = p.z - e.pos.z;
      const l = Math.hypot(toX, toZ) || 1;
      const facing = (Math.sin(e.yaw) * toX + Math.cos(e.yaw) * toZ) / l;
      const factor = Math.max(0.2, (facing + 1) / 2) * (1 - dist / p.def.radius);
      const dur = p.def.blindTime * factor;
      if (dur > 0.25) {
        e.blindUntil = Math.max(e.blindUntil, this.time + dur);
        this.emit({ type: 'blinded', id: e.id, dur });
      }
    }
  }

  // ----------------------------------------------------------------- damage
  damage(target, attacker, amount, source, part) {
    if (!target.alive) return;
    if (this.time < target.spawnProtectUntil && attacker) return;
    if (this.state !== MATCH_STATE.LIVE) return;
    target.health -= amount;
    target.lastDamageTime = this.time;
    if (attacker && attacker !== target) {
      target.damagers.set(attacker.id, (target.damagers.get(attacker.id) || 0) + amount);
      this.emit({ type: 'hit', by: attacker.id, on: target.id, part, dmg: amount, lethal: target.health <= 0 });
    }
    if (target.health <= 0) this.kill(target, attacker, source, part);
  }

  kill(victim, attacker, source, part) {
    victim.alive = false;
    victim.health = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.time + (this.mode.respawnDelay || 0);

    if (attacker && attacker !== victim) {
      attacker.kills++;
      attacker.streak++;
      attacker.bestStreak = Math.max(attacker.bestStreak, attacker.streak);
      attacker.score += SCORE.kill + (part === 'head' ? SCORE.headshot : 0);
      if ((attacker.loadout.perks || []).includes('scavenger')) {
        const def = attacker.weaponDef;
        attacker.weapon.reserve = Math.min(def.reserve, attacker.weapon.reserve + def.magazine);
      }
      this.checkStreak(attacker);
      if (this.mode.objective === OBJECTIVE.TDM) {
        this.scores[attacker.team] += this.mode.killScore;
      } else if (this.mode.objective === OBJECTIVE.DOMINATION) {
        this.scores[attacker.team] += this.mode.killScore;
      }
      // assists
      for (const [id, dmg] of victim.damagers) {
        if (id === attacker.id) continue;
        const helper = this.entities.get(id);
        if (helper && dmg >= 25) { helper.assists++; helper.score += SCORE.assist; }
      }
    } else if (attacker === null && this.mode.objective === OBJECTIVE.TDM) {
      // suicide feeds the enemy team a point
      const other = victim.team === TEAM.ALPHA ? TEAM.BRAVO : TEAM.ALPHA;
      this.scores[other] += 0;
    }

    this.emit({
      type: 'kill',
      by: attacker ? attacker.id : null,
      byName: attacker ? attacker.name : null,
      byTeam: attacker ? attacker.team : TEAM.NONE,
      on: victim.id, onName: victim.name, onTeam: victim.team,
      weapon: source, headshot: part === 'head',
      streak: attacker ? attacker.streak : 0,
    });

    if (this.mode.objective === OBJECTIVE.ROUNDS) this.checkRoundOver();
    this.checkVictory();
  }

  checkStreak(e) {
    for (let i = KILLSTREAKS.length - 1; i >= 0; i--) {
      const ks = KILLSTREAKS[i];
      if (e.streak === ks.at) {
        e.pendingStreak = ks;
        this.emit({ type: 'streak_ready', id: e.id, streak: ks.id, name: ks.name });
        return;
      }
    }
  }

  useStreak(e) {
    const ks = e.pendingStreak;
    if (!ks) return;
    e.pendingStreak = null;
    if (ks.id === 'uav') {
      this.uav[e.team] = this.time + ks.duration;
    } else if (ks.id === 'counter_uav') {
      const enemy = e.team === TEAM.ALPHA ? TEAM.BRAVO : TEAM.ALPHA;
      this.counterUav[enemy] = this.time + ks.duration;
    } else if (ks.id === 'airstrike') {
      const d = this.aimDirection(e, 0);
      const hit = this.world.raycast(e.pos.x, e.eyeY, e.pos.z, d.dx, d.dy, d.dz, 220);
      const tx = hit ? hit.x : e.pos.x + d.dx * 60;
      const tz = hit ? hit.z : e.pos.z + d.dz * 60;
      for (let i = 0; i < 6; i++) {
        const delay = 1.2 + i * 0.28;
        this.projectiles.push({
          kind: 'airstrike', owner: e.id, team: e.team,
          x: tx + (this.rng() - 0.5) * 22, y: 70, z: tz + (this.rng() - 0.5) * 22,
          vx: 0, vy: -55, vz: 0, fuse: this.time + delay + 6,
          def: { damage: 170, radius: 11, id: 'airstrike' }, life: 20, delay: this.time + delay,
        });
      }
      this.emit({ type: 'airstrike_called', id: e.id, x: tx, z: tz });
    }
    this.emit({ type: 'streak_used', id: e.id, streak: ks.id, name: ks.name });
  }

  // ------------------------------------------------------------- objectives
  updateObjectives(dt) {
    if (this.mode.objective !== OBJECTIVE.DOMINATION) return;
    const captureTime = this.mode.captureTime || 8;

    for (const obj of this.objectives) {
      let counts = { 0: 0, 1: 0 };
      for (const e of this.entities.values()) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - obj.x, e.pos.z - obj.z);
        if (d <= obj.radius && Math.abs(e.pos.y) < 12) counts[e.team]++;
      }
      const a = counts[0], b = counts[1];
      obj.contested = a > 0 && b > 0;
      if (obj.contested || (a === 0 && b === 0)) {
        obj.capturingTeam = TEAM.NONE;
        continue;
      }
      const team = a > 0 ? TEAM.ALPHA : TEAM.BRAVO;
      const n = Math.max(a, b);
      const rate = (1 / captureTime) * (1 + Math.min(2, n - 1) * 0.4);
      obj.capturingTeam = team;
      const dir = team === TEAM.ALPHA ? -1 : 1;

      if (obj.owner === team) { obj.progress = dir; continue; }
      obj.progress += dir * rate * dt;
      if (Math.abs(obj.progress) >= 1) {
        obj.progress = dir;
        const prev = obj.owner;
        obj.owner = team;
        this.emit({ type: 'capture', obj: obj.id, team, from: prev });
        for (const e of this.entities.values()) {
          if (e.team !== team || !e.alive) continue;
          const d = Math.hypot(e.pos.x - obj.x, e.pos.z - obj.z);
          if (d <= obj.radius) { e.score += SCORE.capture; e.captures++; }
        }
      }
    }

    // score ticks for held points
    this._tickAccum = (this._tickAccum || 0) + dt;
    while (this._tickAccum >= 1) {
      this._tickAccum -= 1;
      for (const team of [TEAM.ALPHA, TEAM.BRAVO]) {
        const held = this.objectives.filter((o) => o.owner === team).length;
        if (held > 0) this.scores[team] += held * (this.mode.tickScorePerPoint || 1);
      }
      this.checkVictory();
    }
  }

  // ------------------------------------------------------------------ clock
  updateClock(dt) {
    if (this.mode.objective === OBJECTIVE.ROUNDS) {
      this.timeLeft = Math.max(0, (this.roundTimerEnd || this.time + this.mode.roundTime) - this.time);
      if (this.timeLeft <= 0) this.endRound(TEAM.NONE, 'time');
      return;
    }
    if (this.mode.timeLimit > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) this.endMatch(this.leadingTeam(), 'time');
    }
  }

  leadingTeam() {
    if (this.scores[0] === this.scores[1]) return TEAM.NONE;
    return this.scores[0] > this.scores[1] ? TEAM.ALPHA : TEAM.BRAVO;
  }

  checkVictory() {
    if (this.state !== MATCH_STATE.LIVE) return;
    if (this.mode.objective === OBJECTIVE.ROUNDS) {
      for (const t of [TEAM.ALPHA, TEAM.BRAVO]) {
        if (this.roundWins[t] >= this.mode.roundsToWin) this.endMatch(t, 'rounds');
      }
      return;
    }
    for (const t of [TEAM.ALPHA, TEAM.BRAVO]) {
      if (this.scores[t] >= this.mode.scoreLimit) this.endMatch(t, 'score');
    }
  }

  checkRoundOver() {
    if (this.state !== MATCH_STATE.LIVE) return;
    const aliveA = [...this.entities.values()].some((e) => e.team === TEAM.ALPHA && e.alive);
    const aliveB = [...this.entities.values()].some((e) => e.team === TEAM.BRAVO && e.alive);
    if (aliveA && aliveB) return;
    if (!aliveA && !aliveB) this.endRound(TEAM.NONE, 'draw');
    else this.endRound(aliveA ? TEAM.ALPHA : TEAM.BRAVO, 'elimination');
  }

  endRound(winner, reason) {
    if (this.state !== MATCH_STATE.LIVE) return;
    if (winner !== TEAM.NONE) {
      this.roundWins[winner]++;
      this.scores[winner] = this.roundWins[winner];
      for (const e of this.entities.values()) if (e.team === winner) e.score += SCORE.roundWin;
    }
    this.state = MATCH_STATE.ROUND_END;
    this.roundEndAt = this.time + 3.5;
    this.emit({ type: 'round_end', winner, reason, round: this.round, wins: { ...this.roundWins } });
    for (const t of [TEAM.ALPHA, TEAM.BRAVO]) {
      if (this.roundWins[t] >= this.mode.roundsToWin) {
        this.state = MATCH_STATE.LIVE;
        this.endMatch(t, 'rounds');
        return;
      }
    }
  }

  beginRound() {
    this.round++;
    this.state = MATCH_STATE.LIVE;
    this.roundTimerEnd = this.time + this.mode.roundTime;
    this.projectiles.length = 0;
    for (const e of this.entities.values()) this.respawn(e);
    this.emit({ type: 'round_start', round: this.round, wins: { ...this.roundWins } });
  }

  endMatch(winner, reason) {
    if (this.state === MATCH_STATE.ENDED) return;
    this.state = MATCH_STATE.ENDED;
    this.winner = winner;
    this.emit({ type: 'match_end', winner, reason, scores: { ...this.scores } });
  }

  start() {
    if (this.mode.objective === OBJECTIVE.ROUNDS) {
      this.roundTimerEnd = this.warmupEndsAt + this.mode.roundTime;
    }
  }

  // ------------------------------------------------------------------ misc
  emit(ev) {
    ev.t = this.time;
    this.events.push(ev);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  scoreboard() {
    const rows = [...this.entities.values()].map((e) => ({
      id: e.id, name: e.name, team: e.team, bot: e.isBot,
      kills: e.kills, deaths: e.deaths, assists: e.assists,
      score: e.score, streak: e.bestStreak, captures: e.captures,
      ping: e.ping, alive: e.alive,
    }));
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
    return rows;
  }

  /** Is `target` currently revealed to `team` on the minimap? */
  isRevealed(target, team) {
    if (target.team === team) return true;
    if (this.counterUav[team] > this.time) return false;
    if (this.uav[team] <= this.time) return false;
    if ((target.loadout.perks || []).includes('ghost')) return false;
    return true;
  }
}
