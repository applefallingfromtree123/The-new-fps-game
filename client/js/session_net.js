// Online session: the server owns the simulation. We interpolate other players
// from snapshots and predict our own movement locally so aiming stays crisp.

import { buildMap } from '/shared/maps.js';
import { CollisionWorld, moveCharacter, applyMovementInput, wishVector } from '/shared/physics.js';
import { PLAYER, TEAM } from '/shared/constants.js';
import { getWeapon, LOADOUTS } from '/shared/weapons.js';
import { getMode } from '/shared/modes.js';
import { MATCH_STATE } from '/shared/match.js';

const INTERP_DELAY = 0.11;       // seconds of buffered snapshots
const SEND_RATE = 30;

export class NetSession {
  constructor(net, start, loadoutId) {
    this.online = true;
    this.net = net;
    this.modeId = start.mode;
    this.mapId = start.map;
    this.mode = getMode(start.mode);
    this.map = buildMap(start.map);
    this.world = new CollisionWorld(this.map);
    this.myId = start.you;
    this.myTeam = start.team;
    this.loadout = LOADOUTS.find((l) => l.id === loadoutId) || LOADOUTS[0];

    this.entities = new Map();          // id -> render entity
    this.objectives = this.map.objectives.map((o) => ({ ...o, owner: TEAM.NONE, progress: 0, contested: false }));
    this.scores = { 0: 0, 1: 0 };
    this.roundWins = { 0: 0, 1: 0 };
    this.timeLeft = 0;
    this.state = MATCH_STATE.WARMUP;
    this.time = 0;
    this.round = 1;
    this.uav = { 0: 0, 1: 0 };
    this.projectiles = [];

    this.snapshots = [];
    this.clock = 0;                      // local render clock in server time
    this.events = [];
    this.me = null;                      // authoritative own-player block
    this.seq = 0;
    this.sendAccum = 0;
    this.lastInput = null;

    // local prediction state
    this.pred = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, onGround: false, height: PLAYER.height };
    this.predReady = false;
    this.correction = { x: 0, y: 0, z: 0 };

    this.roster = new Map();
    if (start.roster) this.applyRoster(start.roster);

    this.board = null;
    this._off = [
      net.on('snap', (m) => this.onSnapshot(m)),
      net.on('ev', (m) => { for (const e of m.e) this.events.push(e); }),
      net.on('roster', (m) => this.applyRoster(m.roster)),
      net.on('board', (m) => { this.board = m.rows; }),
      net.on('match_end', (m) => { this.finalBoard = m.scoreboard; this.winner = m.winner; }),
    ];
  }

  applyRoster(list) {
    for (const r of list) {
      this.roster.set(r.id, r);
      const ent = this.entities.get(r.id);
      if (ent) { ent.name = r.name; ent.team = r.team; ent.isBot = r.bot; ent.loadoutId = r.loadout; }
    }
  }

  onSnapshot(msg) {
    const snap = {
      t: msg.tm,
      recv: performance.now() / 1000,
      ents: msg.ents,
      objs: msg.objs,
    };
    this.snapshots.push(snap);
    while (this.snapshots.length > 30) this.snapshots.shift();

    this.scores = { 0: msg.sc[0], 1: msg.sc[1] };
    this.roundWins = { 0: msg.rw[0], 1: msg.rw[1] };
    this.timeLeft = msg.tl;
    this.state = msg.st;
    this.round = msg.rd;
    this.uav = { 0: msg.uav[0], 1: msg.uav[1] };
    this.time = msg.tm;

    if (msg.prj) {
      this.projectiles = msg.prj.map(([kind, x, y, z]) => ({ kind, x, y, z }));
    }

    for (const [id, owner, progress, contested] of msg.objs) {
      const o = this.objectives.find((x) => x.id === id);
      if (o) { o.owner = owner; o.progress = progress; o.contested = !!contested; }
    }

    if (msg.me) {
      this.me = msg.me;
      const sp = { x: msg.me.x, y: msg.me.y, z: msg.me.z };
      if (!this.predReady || msg.me.dead) {
        this.pred.pos.x = sp.x; this.pred.pos.y = sp.y; this.pred.pos.z = sp.z;
        this.pred.vel.x = msg.me.vx; this.pred.vel.y = msg.me.vy; this.pred.vel.z = msg.me.vz;
        this.predReady = true;
      } else {
        const err = Math.hypot(sp.x - this.pred.pos.x, sp.y - this.pred.pos.y, sp.z - this.pred.pos.z);
        if (err > 2.2) {
          // hard desync (teleport, respawn, knockback): accept the server
          this.pred.pos.x = sp.x; this.pred.pos.y = sp.y; this.pred.pos.z = sp.z;
          this.pred.vel.x = msg.me.vx; this.pred.vel.y = msg.me.vy; this.pred.vel.z = msg.me.vz;
        } else {
          // gentle pull toward the authoritative position
          const k = 0.18;
          this.pred.pos.x += (sp.x - this.pred.pos.x) * k;
          this.pred.pos.y += (sp.y - this.pred.pos.y) * k;
          this.pred.pos.z += (sp.z - this.pred.pos.z) * k;
          this.pred.vel.y = msg.me.vy;
        }
      }
      this.pred.height = 1.8;
    }
    if (this.clock === 0) this.clock = msg.tm - INTERP_DELAY;
  }

  update(dt, input) {
    this.lastInput = input;
    this.clock += dt;

    // ---- local prediction of our own movement ----
    if (this.me && !this.me.dead && this.state !== MATCH_STATE.ENDED) {
      const crouch = !!input.crouch;
      this.pred.height = crouch ? PLAYER.crouchHeight : PLAYER.height;
      let speed = crouch ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
      const sprinting = input.sprint && input.forward > 0.2 && !input.ads && !crouch && this.pred.onGround;
      if (sprinting) speed = PLAYER.sprintSpeed;
      if (input.ads) speed *= PLAYER.adsSpeedScale;
      if ((this.loadout.perks || []).includes('lightweight')) speed *= 1.08;
      const def = getWeapon(this.weaponId());
      if (def.cls === 'lmg' || def.cls === 'sniper') speed *= 0.93;
      if (this.state !== MATCH_STATE.LIVE) speed = 0;

      const wish = wishVector(input.yaw, input.forward, input.right);
      applyMovementInput(this.pred, wish.x, wish.z, speed, dt);
      if (input.jump && this.pred.onGround) { this.pred.vel.y = PLAYER.jumpVelocity; this.pred.onGround = false; }
      moveCharacter(this.world, this.pred, dt);
      this.predSprinting = sprinting;
      this.predCrouch = crouch;
    }

    // ---- interpolate everyone else ----
    this.interpolate();

    // ---- send input to the server ----
    this.sendAccum += dt;
    if (this.sendAccum >= 1 / SEND_RATE) {
      this.sendAccum = 0;
      this.seq++;
      this.net.send({
        t: 'input',
        i: {
          f: round2(input.forward), r: round2(input.right),
          y: round3(input.yaw), p: round3(input.pitch),
          jp: input.jump, c: input.crouch, sp: input.sprint, a: input.ads,
          fi: input.fire, rl: input.reload, me: input.melee,
          w: input.weaponSlot, l: input.lethal, tc: input.tactical, ks: input.streak,
          s: this.seq,
        },
      });
    }
  }

  interpolate() {
    const target = this.clock - INTERP_DELAY;
    let a = null, b = null;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].t <= target) { a = this.snapshots[i]; b = this.snapshots[i + 1] || null; break; }
    }
    if (!a) a = this.snapshots[0];
    if (!a) return;
    const alpha = b && b.t > a.t ? Math.max(0, Math.min(1, (target - a.t) / (b.t - a.t))) : 0;

    const seen = new Set();
    for (const row of a.ents) {
      const [id, x, y, z, yaw, pitch, flags, hp, slot, team] = row;
      seen.add(id);
      let e = this.entities.get(id);
      if (!e) {
        const info = this.roster.get(id) || {};
        e = {
          id, name: info.name || `P${id}`, team, isBot: !!info.bot,
          loadoutId: info.loadout || 'assault',
          pos: { x, y, z }, yaw, pitch, alive: true, crouching: false,
          sprinting: false, ads: false, health: hp, height: PLAYER.height,
          speed: 0, prev: { x, y, z }, slot,
        };
        this.entities.set(id, e);
      }
      let nx = x, ny = y, nz = z, nyaw = yaw, npitch = pitch;
      if (b && alpha > 0) {
        const rb = b.ents.find((r) => r[0] === id);
        if (rb) {
          nx = x + (rb[1] - x) * alpha;
          ny = y + (rb[2] - y) * alpha;
          nz = z + (rb[3] - z) * alpha;
          nyaw = yaw + shortAngle(yaw, rb[4]) * alpha;
          npitch = pitch + (rb[5] - pitch) * alpha;
        }
      }
      const dx = nx - e.pos.x, dz = nz - e.pos.z;
      e.speed = Math.hypot(dx, dz) * 60;
      e.pos.x = nx; e.pos.y = ny; e.pos.z = nz;
      e.yaw = nyaw; e.pitch = npitch;
      e.alive = (flags & 1) !== 0;
      e.crouching = (flags & 2) !== 0;
      e.sprinting = (flags & 4) !== 0;
      e.ads = (flags & 8) !== 0;
      e.reloading = (flags & 16) !== 0;
      e.health = hp;
      e.team = team;
      e.slot = slot;
      e.height = e.crouching ? PLAYER.crouchHeight : PLAYER.height;
      const info = this.roster.get(id);
      if (info) { e.name = info.name; e.isBot = info.bot; e.loadoutId = info.loadout; }
    }
    for (const id of [...this.entities.keys()]) if (!seen.has(id)) this.entities.delete(id);

    // our own entity uses the predicted position
    const mine = this.entities.get(this.myId);
    if (mine && this.predReady) {
      mine.pos.x = this.pred.pos.x;
      mine.pos.y = this.pred.pos.y;
      mine.pos.z = this.pred.pos.z;
      if (this.lastInput) { mine.yaw = this.lastInput.yaw; mine.pitch = this.lastInput.pitch; }
    }
  }

  weaponId() {
    const slot = this.me ? this.me.sl : 0;
    return slot === 1 ? this.loadout.secondary : this.loadout.primary;
  }

  view() {
    const me = this.me || {};
    const input = this.lastInput || { yaw: 0, pitch: 0 };
    const crouch = this.predCrouch;
    const def = getWeapon(this.weaponId());
    const hSpeed = Math.hypot(this.pred.vel.x, this.pred.vel.z);
    let spread = me.ads ? def.adsSpread : def.spread;
    if (!this.pred.onGround) spread *= def.airSpread;
    else if (hSpeed > 1) spread *= 1 + (def.moveSpread - 1) * Math.min(1, hSpeed / PLAYER.sprintSpeed);
    if (crouch) spread *= def.crouchSpread;

    return {
      x: this.pred.pos.x, y: this.pred.pos.y, z: this.pred.pos.z,
      eyeY: this.pred.pos.y + (crouch ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight),
      yaw: input.yaw, pitch: input.pitch,
      vel: this.pred.vel, onGround: this.pred.onGround, crouching: !!crouch,
      sprinting: !!this.predSprinting, ads: !!(this.lastInput && this.lastInput.ads),
      adsAmount: this.lastInput && this.lastInput.ads ? 1 : 0,
      health: me.hp ?? 100, alive: !me.dead,
      weaponId: this.weaponId(), ammo: me.am ?? 0, reserve: me.rs ?? 0,
      reloading: (me.rel ?? 0) > 0,
      lethal: me.leth ?? 0, tactical: me.tac ?? 0,
      streak: me.ks ? me.ks : null,
      recoil: { v: me.rcv || 0, h: me.rch || 0 },
      spread,
      respawnIn: me.rsp ?? 0,
      blind: me.blind ?? 0,
      loadout: this.loadout,
      kills: me.k ?? 0, deaths: me.d ?? 0, score: me.score ?? 0,
    };
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  scoreboard() {
    if (this.finalBoard) return this.finalBoard;
    if (this.board) return this.board;
    return [...this.entities.values()].map((e) => ({
      id: e.id, name: e.name, team: e.team, bot: e.isBot,
      kills: 0, deaths: 0, assists: 0, score: 0, alive: e.alive,
    }));
  }

  isRevealed(e) {
    if (e.team === this.myTeam) return true;
    return this.uav[this.myTeam] > this.time;
  }

  get uavActive() { return this.uav[this.myTeam] > this.time; }
  get ended() { return this.state === MATCH_STATE.ENDED; }

  dispose() {
    for (const off of this._off) off();
    this.net.send({ t: 'leave' });
  }
}

function shortAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
