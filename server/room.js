// One online match. Runs the shared simulation authoritatively and streams
// snapshots to every connected client.

import { MatchSim, MATCH_STATE } from '../shared/match.js';
import { TICK_MS, SNAPSHOT_RATE, TEAM } from '../shared/constants.js';
import { getMode, randomMapFor } from '../shared/modes.js';

let _roomSeq = 1;

export class Room {
  constructor(modeId, opts = {}) {
    this.id = `r${_roomSeq++}`;
    this.modeId = modeId;
    this.mode = getMode(modeId);
    this.mapId = opts.mapId || randomMapFor(modeId);
    this.sim = new MatchSim({
      modeId,
      mapId: this.mapId,
      seed: (Math.random() * 1e9) | 0,
      difficulty: opts.difficulty || 'hardened',
      warmup: 5,
    });
    this.sim.start();
    this.clients = new Map();          // entityId -> client
    this.createdAt = Date.now();
    this.lastTick = Date.now();
    this.snapAccum = 0;
    this.closed = false;
    this.endsAt = 0;
    this.log = opts.log || (() => {});
    this.onEmpty = opts.onEmpty || (() => {});

    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  get playerCount() { return this.clients.size; }

  teamForNewPlayer() {
    let a = 0, b = 0;
    for (const c of this.clients.values()) (c.team === TEAM.ALPHA ? a++ : b++);
    return a <= b ? TEAM.ALPHA : TEAM.BRAVO;
  }

  /** Add a human. Takes over a bot slot when the team is already full. */
  addClient(client, loadoutId) {
    const team = this.teamForNewPlayer();
    // free a bot slot on that team if the roster is full
    if (this.sim.teamCount(team) >= this.mode.teamSize) {
      const bot = [...this.sim.entities.values()].find((e) => e.isBot && e.team === team);
      if (bot) this.sim.removeEntity(bot.id);
    }
    const ent = this.sim.addEntity({
      name: client.name,
      team,
      isBot: false,
      loadoutId: loadoutId || 'assault',
    });
    client.entityId = ent.id;
    client.team = team;
    client.room = this;
    this.clients.set(ent.id, client);
    this.log(`[${this.id}] ${client.name} joined (team ${team}, ${this.clients.size} humans)`);

    client.send({
      t: 'match_start',
      room: this.id,
      mode: this.modeId,
      map: this.mapId,
      you: ent.id,
      team,
      warmup: Math.max(0, this.sim.warmupEndsAt - this.sim.time),
      roster: this.roster(),
    });
    this.broadcast({ t: 'roster', roster: this.roster() }, client.entityId);
    return ent;
  }

  removeClient(client) {
    if (!this.clients.has(client.entityId)) return;
    this.clients.delete(client.entityId);
    const ent = this.sim.entities.get(client.entityId);
    if (ent) {
      if (this.mode.botFill && this.sim.state !== MATCH_STATE.ENDED) {
        // hand the slot to a bot so team sizes stay honest
        ent.isBot = true;
        ent.name = `${ent.name} (AI)`;
        ent.connected = false;
        this.sim.entities.delete(ent.id);
        const bot = this.sim.addBot(ent.team);
        bot.kills = ent.kills; bot.deaths = ent.deaths; bot.score = ent.score;
      } else {
        this.sim.removeEntity(ent.id);
      }
    }
    client.room = null;
    client.entityId = null;
    this.broadcast({ t: 'roster', roster: this.roster() });
    this.log(`[${this.id}] ${client.name} left (${this.clients.size} humans)`);
    if (this.clients.size === 0) this.close();
  }

  fillBots() {
    if (this.mode.botFill) this.sim.fillWithBots();
  }

  roster() {
    return [...this.sim.entities.values()].map((e) => ({
      id: e.id, name: e.name, team: e.team, bot: e.isBot, loadout: e.loadoutId,
    }));
  }

  handleInput(client, msg) {
    const ent = this.sim.entities.get(client.entityId);
    if (!ent) return;
    const i = msg.i || {};
    this.sim.setInput(ent.id, {
      forward: clamp(i.f ?? 0, -1, 1),
      right: clamp(i.r ?? 0, -1, 1),
      yaw: Number.isFinite(i.y) ? i.y : ent.yaw,
      pitch: Number.isFinite(i.p) ? clamp(i.p, -1.45, 1.45) : ent.pitch,
      jump: !!i.jp, crouch: !!i.c, sprint: !!i.sp, ads: !!i.a,
      fire: !!i.fi, reload: !!i.rl, melee: !!i.me,
      weaponSlot: i.w === 1 ? 1 : 0,
      lethal: !!i.l, tactical: !!i.tc, streak: !!i.ks,
      seq: i.s | 0,
    });
    client.lastSeq = i.s | 0;
  }

  tick() {
    if (this.closed) return;
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt > 0.25) dt = 0.25;

    this.sim.step(dt);

    const events = this.sim.drainEvents();
    if (events.length) {
      // shots/impacts are high-volume; the rest is gameplay-critical
      this.broadcast({ t: 'ev', e: events });
    }

    this.boardAccum = (this.boardAccum || 0) + dt;
    if (this.boardAccum >= 2) {
      this.boardAccum = 0;
      this.broadcast({ t: 'board', rows: this.sim.scoreboard() });
    }

    this.snapAccum += dt;
    if (this.snapAccum >= 1 / SNAPSHOT_RATE) {
      this.snapAccum = 0;
      this.sendSnapshots();
    }

    if (this.sim.state === MATCH_STATE.ENDED && !this.endsAt) {
      this.endsAt = now + 15000;
      this.broadcast({
        t: 'match_end',
        winner: this.sim.winner,
        scores: this.sim.scores,
        scoreboard: this.sim.scoreboard(),
      });
    }
    if (this.endsAt && now > this.endsAt) this.close();
    if (this.clients.size === 0 && now - this.createdAt > 30000) this.close();
  }

  sendSnapshots() {
    const sim = this.sim;
    const ents = [];
    for (const e of sim.entities.values()) {
      ents.push([
        e.id,
        round2(e.pos.x), round2(e.pos.y), round2(e.pos.z),
        round3(e.yaw), round3(e.pitch),
        (e.alive ? 1 : 0) | (e.crouching ? 2 : 0) | (e.sprinting ? 4 : 0) | (e.ads ? 8 : 0) | (e.reloadEndAt > 0 ? 16 : 0),
        Math.round(e.health),
        e.slot,
        e.team,
      ]);
    }
    const objs = sim.objectives.map((o) => [o.id, o.owner, round2(o.progress), o.contested ? 1 : 0]);
    const prj = sim.projectiles.map((p) => [p.kind, round2(p.x), round2(p.y), round2(p.z)]);
    const base = {
      t: 'snap',
      tm: round2(sim.time),
      st: sim.state,
      sc: [sim.scores[0], sim.scores[1]],
      tl: Math.round(sim.timeLeft),
      rw: [sim.roundWins[0], sim.roundWins[1]],
      rd: sim.round,
      uav: [round2(sim.uav[0]), round2(sim.uav[1])],
      ents,
      objs,
      prj,
    };
    for (const [entId, client] of this.clients) {
      const me = sim.entities.get(entId);
      const payload = me ? {
        ...base,
        seq: client.lastSeq | 0,
        me: {
          hp: Math.round(me.health),
          am: me.weapon.ammo, rs: me.weapon.reserve, sl: me.slot,
          rel: me.reloadEndAt > 0 ? round2(me.reloadEndAt - sim.time) : 0,
          leth: me.lethalCount, tac: me.tacticalCount,
          streak: me.streak, ks: me.pendingStreak ? me.pendingStreak.id : null,
          score: me.score, k: me.kills, d: me.deaths, a: me.assists,
          dead: !me.alive, rsp: me.alive ? 0 : round2(Math.max(0, me.respawnAt - sim.time)),
          blind: me.blindUntil > sim.time ? round2(me.blindUntil - sim.time) : 0,
          x: round3(me.pos.x), y: round3(me.pos.y), z: round3(me.pos.z),
          vx: round2(me.vel.x), vy: round2(me.vel.y), vz: round2(me.vel.z),
          rcv: round3(me.recoil.v), rch: round3(me.recoil.h),
        },
      } : base;
      client.send(payload);
    }
  }

  broadcast(msg, exceptId = null) {
    for (const [id, c] of this.clients) {
      if (id === exceptId) continue;
      c.send(msg);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.interval);
    for (const c of this.clients.values()) {
      c.room = null;
      c.entityId = null;
    }
    this.clients.clear();
    this.log(`[${this.id}] closed`);
    this.onEmpty(this);
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
