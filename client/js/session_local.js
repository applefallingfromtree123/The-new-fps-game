// Offline session: the browser runs the authoritative simulation itself and
// fills the roster with bots.

import { MatchSim, MATCH_STATE } from '/shared/match.js';
import { TEAM } from '/shared/constants.js';

export class LocalSession {
  constructor(opts) {
    this.online = false;
    this.modeId = opts.modeId;
    this.mapId = opts.mapId;
    this.sim = new MatchSim({
      modeId: opts.modeId,
      mapId: opts.mapId,
      difficulty: opts.difficulty,
      warmup: 4,
    });
    this.sim.start();
    this.player = this.sim.addEntity({
      name: opts.playerName || '플레이어',
      team: TEAM.ALPHA,
      isBot: false,
      loadoutId: opts.loadoutId,
    });
    this.sim.fillWithBots(opts.difficulty);
    this.myId = this.player.id;
    this.myTeam = TEAM.ALPHA;
    this.map = this.sim.map;
    this.world = this.sim.world;
    this.ping = 0;
  }

  update(dt, input) {
    this.sim.setInput(this.myId, input);
    this.sim.step(dt);
  }

  drainEvents() { return this.sim.drainEvents(); }
  get entities() { return this.sim.entities; }
  get objectives() { return this.sim.objectives; }
  get scores() { return this.sim.scores; }
  get roundWins() { return this.sim.roundWins; }
  get timeLeft() { return this.sim.mode.timeLimit ? this.sim.timeLeft : this.sim.timeLeft; }
  get state() { return this.sim.state; }
  get projectiles() { return this.sim.projectiles; }
  get time() { return this.sim.time; }

  /** Local view state for the camera and HUD. */
  view() {
    const p = this.player;
    return {
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      eyeY: p.eyeY, yaw: p.yaw, pitch: p.pitch,
      vel: p.vel, onGround: p.onGround, crouching: p.crouching,
      sprinting: p.sprinting, ads: p.ads, adsAmount: p.adsAmount,
      health: p.health, alive: p.alive,
      weaponId: p.weapon.id, ammo: p.weapon.ammo, reserve: p.weapon.reserve,
      reloading: p.reloadEndAt > 0,
      lethal: p.lethalCount, tactical: p.tacticalCount,
      streak: p.pendingStreak ? p.pendingStreak.name : null,
      recoil: p.recoil, spread: this.sim.currentSpread(p),
      respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - this.sim.time),
      blind: Math.max(0, p.blindUntil - this.sim.time),
      loadout: p.loadout,
      kills: p.kills, deaths: p.deaths, score: p.score,
    };
  }

  scoreboard() { return this.sim.scoreboard(); }
  isRevealed(e) { return this.sim.isRevealed(e, this.myTeam); }
  get uavActive() { return this.sim.uav[this.myTeam] > this.sim.time; }
  get ended() { return this.sim.state === MATCH_STATE.ENDED; }
  get winner() { return this.sim.winner; }
  dispose() {}
}
