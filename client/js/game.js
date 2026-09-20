// Renderer + game loop. Session-agnostic: it drives a LocalSession (offline,
// vs bots) or a NetSession (online matchmaking) through the same interface.

import * as THREE from 'three';
import { WorldView } from './render/world.js';
import { Soldier } from './render/soldier.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { Minimap } from './minimap.js';
import { audio } from './audio.js';
import { TEAM_INFO, PLAYER } from '/shared/constants.js';
import { WEAPONS, getWeapon } from '/shared/weapons.js';
import { getMode, OBJECTIVE } from '/shared/modes.js';
import { MATCH_STATE } from '/shared/match.js';

export class Game {
  constructor({ canvas, hud, input, settings }) {
    this.canvas = canvas;
    this.hud = hud;
    this.input = input;
    this.settings = settings;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : 1.5));
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.06, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // The first person weapon lives in its own scene rendered on top with a
    // narrower FOV, which is how shooters avoid the weapon clipping geometry.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 12);
    this.vmScene.add(this.vmCamera);
    this.vmScene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const vmKey = new THREE.DirectionalLight(0xfff0dd, 1.25);
    vmKey.position.set(0.6, 1.2, 0.8);
    this.vmScene.add(vmKey);
    this.viewModel = new ViewModel(this.vmCamera);
    this.viewModel.group.scale.setScalar(0.56);

    // world-space muzzle flash light so our own shots light the environment
    this.muzzleLight = new THREE.PointLight(0xffb45a, 0, 10);
    this.scene.add(this.muzzleLight);
    this.soldiers = new Map();
    this.session = null;
    this.running = false;
    this.paused = false;
    this.lastTime = 0;
    this.shake = 0;
    this.shakeVec = new THREE.Vector3();
    this.viewRecoil = { v: 0, h: 0 };
    this.footstepAccum = 0;
    this.scoreboardHeld = false;
    this.onMatchEnd = null;
    this.lastKiller = null;
    this.tmpV = new THREE.Vector3();

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.vmCamera) {
      this.vmCamera.aspect = w / h;
      this.vmCamera.updateProjectionMatrix();
    }
  }

  /** Attach a session and build its world. */
  begin(session) {
    this.teardownWorld();
    this.session = session;
    this.mode = getMode(session.modeId);
    this.map = session.map;

    this.world = new WorldView(this.scene, this.map, this.settings.quality);
    this.effects = new Effects(this.scene);
    this.minimap = new Minimap(document.getElementById('minimap'), this.map);

    this.usesObjectives = this.mode.objective === OBJECTIVE.DOMINATION;
    this.world.setObjectivesVisible(this.usesObjectives);
    this.hud.reset();
    this.hud.setMode(this.mode, this.map);
    this.hud.setObjectives(this.usesObjectives ? session.objectives : []);
    this.scoreboardHeld = false;
    this.lastKiller = null;
    this.matchEnded = false;

    const view = session.view();
    this.camera.position.set(view.x, view.eyeY, view.z);
    this.viewModel.setWeapon(getWeapon(view.weaponId).cls);

    this.running = true;
    this.paused = false;
    this.lastTime = performance.now();
    this.loop();
  }

  teardownWorld() {
    for (const s of this.soldiers.values()) {
      this.scene.remove(s.root);
      s.dispose();
    }
    this.soldiers.clear();
    if (this.effects) { this.effects.dispose(); this.effects = null; }
    if (this.world) { this.world.dispose(); this.world = null; }
  }

  stop() {
    this.running = false;
    if (this.session) { this.session.dispose(); this.session = null; }
    this.teardownWorld();
  }

  setPaused(p) {
    this.paused = p;
    if (!p) this.lastTime = performance.now();
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.12) dt = 0.12;
    if (this.paused) { this.draw(); return; }

    const input = this.buildInput();
    this.session.update(dt, input);
    this.processEvents();
    this.updateCamera(dt, input);
    this.updateSoldiers(dt);
    if (this.usesObjectives) {
      this.world.updateObjectives(this.session.objectives, [TEAM_INFO[0].color, TEAM_INFO[1].color]);
    }
    this.updateProps();
    this.effects.update(dt);
    this.updateHud(dt);
    this.hud.tick(dt);
    this.draw();

    if (this.session.ended && !this.matchEnded) {
      this.matchEnded = true;
      this.onMatchEnd?.(this.session);
    }
  }

  draw() {
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
    this.renderer.autoClear = true;
    // decay the world muzzle light
    if (this.muzzleLight.intensity > 0.01) this.muzzleLight.intensity *= 0.55;
    else this.muzzleLight.intensity = 0;
  }

  buildInput() {
    const sampled = this.input.sample(this._lastInput);
    if (!this.settings.holdAds && sampled.ads) {
      // toggle-ADS: flip on the rising edge
      if (!this._adsEdge) { this._adsToggle = !this._adsToggle; this._adsEdge = true; }
      sampled.ads = this._adsToggle;
    } else if (!this.settings.holdAds) {
      this._adsEdge = false;
      sampled.ads = this._adsToggle || false;
    }
    this._lastInput = sampled;
    return sampled;
  }

  // ----------------------------------------------------------------- camera
  updateCamera(dt, input) {
    const view = this.session.view();
    this.view = view;

    // visual recoil trails the simulated recoil so the camera punches and settles
    this.viewRecoil.v += (view.recoil.v - this.viewRecoil.v) * Math.min(1, dt * 26);
    this.viewRecoil.h += (view.recoil.h - this.viewRecoil.h) * Math.min(1, dt * 26);

    const eyeY = view.eyeY;
    this.camera.position.set(view.x, eyeY, view.z);

    // walk bob on the camera
    const speed = Math.hypot(view.vel.x, view.vel.z);
    this.bobPhase = (this.bobPhase || 0) + dt * (4 + speed * 1.5);
    const bobAmount = Math.min(1, speed / 7) * (view.onGround ? 1 : 0.2) * (1 - view.adsAmount * 0.75) * this.settings.shake;
    this.camera.position.y += Math.sin(this.bobPhase * 2) * 0.022 * bobAmount;
    this.camera.position.x += Math.cos(this.bobPhase) * 0.014 * bobAmount;

    // screen shake
    if (this.shake > 0.001) {
      this.shake *= Math.max(0, 1 - dt * 4.5);
      const s = this.shake * this.settings.shake;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    this.camera.rotation.y = view.yaw + Math.PI - this.viewRecoil.h * 0.8;
    this.camera.rotation.x = view.pitch + this.viewRecoil.v * 0.85;
    this.camera.rotation.z = this.shake * 0.06 * this.settings.shake;

    // field of view: ADS zoom + a touch of sprint widening
    const def = getWeapon(view.weaponId);
    const adsFov = this.settings.fov / def.adsZoom;
    const sprintFov = this.settings.fov * (view.sprinting ? 1.045 : 1);
    const wanted = view.adsAmount > 0.01 ? lerp(sprintFov, adsFov, view.adsAmount) : sprintFov;
    this.camera.fov += (wanted - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
    const vmWanted = 58 - view.adsAmount * 8;
    this.vmCamera.fov += (vmWanted - this.vmCamera.fov) * Math.min(1, dt * 12);
    this.vmCamera.updateProjectionMatrix();

    const delta = this.input.takeDelta();
    this.viewModel.update(dt, {
      speed, ads: view.adsAmount, sprinting: view.sprinting,
      mouseDX: delta.dx, mouseDY: delta.dy,
      onGround: view.onGround,
      hidden: !view.alive || (def.scope && view.adsAmount > 0.72),
    });

    this.world.updateSun(this.camera.position);
    audio.setListener(view.x, eyeY, view.z, view.yaw);

    // footsteps
    if (view.alive && view.onGround && speed > 1.2) {
      this.footstepAccum += dt * speed;
      if (this.footstepAccum > 3.4) {
        this.footstepAccum = 0;
        audio.footstep(speed, view.crouching);
      }
    }
  }

  // --------------------------------------------------------------- entities
  updateSoldiers(dt) {
    const session = this.session;
    const seen = new Set();
    for (const e of session.entities.values()) {
      seen.add(e.id);
      let s = this.soldiers.get(e.id);
      if (!s) {
        const info = TEAM_INFO[e.team] || TEAM_INFO[0];
        s = new Soldier({
          teamColor: info.color,
          variant: e.id,
          name: e.team === session.myTeam ? e.name : null,
          tagColor: info.css,
        });
        this.scene.add(s.root);
        this.soldiers.set(e.id, s);
      }
      if (e.id === session.myId) { s.root.visible = false; continue; }
      s.root.visible = true;
      const speed = e.speed !== undefined ? e.speed : Math.hypot(e.vel?.x || 0, e.vel?.z || 0);
      s.update({
        x: e.pos.x, y: e.pos.y, z: e.pos.z,
        yaw: e.yaw, pitch: e.pitch,
        speed, crouch: e.crouching, alive: e.alive, ads: e.ads,
      }, dt);
      // friendly nametags only, and only when reasonably close / in view
      if (s.nametag) {
        const dist = this.camera.position.distanceTo(this.tmpV.set(e.pos.x, e.pos.y + 1.8, e.pos.z));
        s.setNameVisible(e.alive && e.team === session.myTeam && dist < 55);
      }
    }
    for (const [id, s] of this.soldiers) {
      if (seen.has(id)) continue;
      this.scene.remove(s.root);
      s.dispose();
      this.soldiers.delete(id);
    }
  }

  updateProps() {
    const projectiles = this.session.projectiles || [];
    projectiles.forEach((p, i) => {
      const kind = p.kind === 'rocket' || p.kind === 'airstrike' ? 'rocket' : p.kind;
      this.effects.setProp(`p${i}`, kind, p.x, p.y, p.z);
      if (p.kind === 'rocket' || p.kind === 'airstrike') {
        this.effects.spawnParticle(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6,
          0.5, 0xc9c9c9, 0.16, 0.05, 0.92);
      }
    });
    this.effects.sweepProps();
  }

  // ----------------------------------------------------------------- events
  processEvents() {
    const session = this.session;
    const myId = session.myId;
    for (const ev of session.drainEvents()) {
      switch (ev.type) {
        case 'shot': this.onShot(ev, myId); break;
        case 'impact':
          this.effects.impact(ev.x, ev.y, ev.z, ev.nx, ev.ny, ev.nz, ev.surface);
          audio.impact(ev.x, ev.z);
          break;
        case 'hit': this.onHit(ev, myId); break;
        case 'kill': this.onKill(ev, myId); break;
        case 'explosion': {
          this.effects.explosion(ev.x, ev.y, ev.z, ev.radius);
          audio.explosion(ev.x, ev.z);
          const d = Math.hypot(ev.x - this.camera.position.x, ev.z - this.camera.position.z);
          this.shake = Math.max(this.shake, Math.max(0, 1 - d / (ev.radius * 3)) * 0.8);
          break;
        }
        case 'flash':
          audio.flashbang();
          break;
        case 'blinded':
          if (ev.id === myId) this.blindUntil = performance.now() + ev.dur * 1000;
          break;
        case 'reload':
          if (ev.id === myId) {
            this.viewModel.onReload(ev.dur);
            audio.reload('out');
            setTimeout(() => audio.reload('in'), ev.dur * 450);
            setTimeout(() => audio.reload('click'), ev.dur * 850);
          }
          break;
        case 'swap':
          if (ev.id === myId) {
            const wid = session.view().weaponId;
            this.viewModel.setWeapon(getWeapon(wid).cls);
            audio.reload('click');
          }
          break;
        case 'melee':
          if (ev.id === myId) { this.viewModel.onFire(0.4); audio.reload('out'); }
          break;
        case 'smoke':
          this.effects.smoke(ev.x, ev.y, ev.z, ev.radius, ev.duration);
          break;
        case 'capture': {
          const mine = ev.team === session.myTeam;
          this.hud.banner(`거점 ${ev.obj} ${mine ? '점령' : '피탈'}`, mine ? '아군이 확보했습니다' : '적군에게 빼앗겼습니다',
            2.2, mine ? TEAM_INFO[0].css : TEAM_INFO[1].css);
          audio.announce(mine ? 'capture' : 'roundloss');
          if (mine) this.hud.scorePopup('+200 점령');
          break;
        }
        case 'streak_ready':
          if (ev.id === myId) { this.hud.setStreak(ev.name); audio.announce('streak'); }
          break;
        case 'streak_used':
          if (ev.id === myId) this.hud.setStreak(null);
          if (ev.streak === 'uav') {
            const mine = session.entities.get(ev.id)?.team === session.myTeam;
            this.hud.banner(mine ? 'UAV 가동' : '적 UAV 감지', '', 1.8, mine ? '#7fe3a1' : '#ff9a8d');
          }
          break;
        case 'airstrike_called':
          this.hud.banner('공습 요청', '목표 지점 확인', 1.6, '#ffc247');
          break;
        case 'match_start':
          this.hud.banner('교전 개시', this.mode.name, 2.2, '#ffc247');
          audio.announce('roundwin');
          break;
        case 'round_start':
          this.hud.banner(`${ev.round} 라운드`, `${ev.wins[0]} — ${ev.wins[1]}`, 2.0, '#ffffff');
          break;
        case 'round_end': {
          const mine = ev.winner === session.myTeam;
          this.hud.banner(ev.winner === -1 ? '무승부' : mine ? '라운드 승리' : '라운드 패배',
            `${ev.wins[0]} — ${ev.wins[1]}`, 3.0, mine ? '#57d98a' : '#ff5f52');
          audio.announce(mine ? 'roundwin' : 'roundloss');
          break;
        }
        case 'match_end': {
          const mine = ev.winner === session.myTeam;
          this.hud.banner(ev.winner === -1 ? '무승부' : mine ? '승리' : '패배', '', 4, mine ? '#57d98a' : '#ff5f52');
          audio.announce(mine ? 'victory' : 'defeat');
          break;
        }
        case 'spawn':
          if (ev.id === myId) {
            this.hud.setDeath(false);
            this.blindUntil = 0;
            this.viewRecoil.v = this.viewRecoil.h = 0;
          }
          break;
        default: break;
      }
    }
  }

  onShot(ev, myId) {
    const session = this.session;
    const shooter = session.entities.get(ev.id);
    const def = WEAPONS[ev.weapon];
    const own = ev.id === myId;

    if (own) {
      this.viewModel.onFire(def.cls === 'sniper' || def.cls === 'shotgun' ? 1.6 : 1);
      this.shake = Math.max(this.shake, def.recoil.v * 0.05 * (this.view?.adsAmount > 0.5 ? 0.5 : 1));
    }
    audio.gunshot(def.cls, ev.x, ev.z, own);

    // muzzle position: the weapon barrel for our own shots, chest height otherwise
    let mx = ev.x, my = ev.y, mz = ev.z;
    if (own) {
      // muzzle is in view-model space (camera at the origin): lift it to world space
      this.viewModel.muzzle.getWorldPosition(this.tmpV);
      this.camera.updateMatrixWorld();
      this.tmpV.applyMatrix4(this.camera.matrixWorld);
      mx = this.tmpV.x; my = this.tmpV.y; mz = this.tmpV.z;
      this.muzzleLight.position.set(mx, my, mz);
      this.muzzleLight.intensity = 2.6;
    } else if (shooter) {
      mx = ev.x + Math.sin(ev.dx !== undefined ? 0 : shooter.yaw) * 0.35;
      mz = ev.z + Math.cos(ev.dx !== undefined ? 0 : shooter.yaw) * 0.35;
      my = ev.y - 0.12;
    }

    if (ev.traces) {
      for (const t of ev.traces) {
        const dist = Math.min(t.dist, 220);
        this.effects.tracer(mx, my, mz, ev.x + t.dx * dist, ev.y + t.dy * dist, ev.z + t.dz * dist, def.tracer);
      }
      this.effects.muzzleSmoke(mx, my, mz, ev.traces[0]?.dx || 0, ev.traces[0]?.dy || 0, ev.traces[0]?.dz || 0);
    }
  }

  onHit(ev, myId) {
    const session = this.session;
    if (ev.by === myId) {
      this.hud.hitmarker(ev.lethal);
      audio.hitmarker(ev.lethal);
      const target = session.entities.get(ev.on);
      if (target) {
        this.effects.blood(target.pos.x, target.pos.y + 1.2, target.pos.z, 0, 0.4, 0);
      }
    }
    if (ev.on === myId) {
      audio.hurt();
      const attacker = session.entities.get(ev.by);
      if (attacker) {
        const view = this.view || session.view();
        const angle = Math.atan2(attacker.pos.x - view.x, attacker.pos.z - view.z) - view.yaw;
        this.hud.damageFrom(-angle);
        this.lastKiller = attacker.name;
      }
      this.shake = Math.max(this.shake, Math.min(0.4, ev.dmg * 0.006));
    }
  }

  onKill(ev, myId) {
    const session = this.session;
    this.hud.killfeed(ev, session.myTeam);
    if (ev.by === myId && ev.on !== myId) {
      this.hud.scorePopup(`+${100 + (ev.headshot ? 25 : 0)} ${ev.headshot ? '헤드샷' : '처치'}`);
      if (ev.streak >= 3) this.hud.banner(`${ev.streak} 연속 처치`, '', 1.4, '#ffc247');
    }
    if (ev.on === myId) {
      this.lastKiller = ev.byName;
      this.lastKillerWeapon = ev.weapon;
      this.hud.setDeath(true, ev.byName, ev.weapon, this.mode.respawnDelay || 0);
    }
  }

  // -------------------------------------------------------------------- hud
  updateHud(dt) {
    const session = this.session;
    const view = this.view || session.view();
    const hud = this.hud;

    hud.setHealth(view.health);
    hud.setWeapon(view.weaponId, view.ammo, view.reserve, view.reloading);
    hud.setEquipment(view.loadout.lethal === 'semtex' ? '점착탄' : '수류탄', view.lethal,
      view.loadout.tactical === 'smoke' ? '연막탄' : '섬광탄', view.tactical);
    hud.setStreak(view.streak);
    hud.setScores(session.scores[0], session.scores[1]);

    const isRounds = this.mode.objective === OBJECTIVE.ROUNDS;
    hud.setClock(isRounds ? session.timeLeft : session.timeLeft);
    hud.setObjectives(this.usesObjectives ? session.objectives : []);
    hud.updateCompass(view.yaw);

    // crosshair widens with the simulated spread
    const def = getWeapon(view.weaponId);
    const scoped = def.scope && view.adsAmount > 0.72;
    hud.setScope(scoped);
    const px = 10 + view.spread * 26;
    hud.setCrosshair(px, scoped || !view.alive, false);

    // flash blindness
    if (this.blindUntil) {
      const left = (this.blindUntil - performance.now()) / 1000;
      if (left <= 0) { this.blindUntil = 0; hud.setFlash(0); }
      else hud.setFlash(Math.min(1, left / 1.6));
    }

    if (!view.alive) hud.setDeath(true, this.lastKiller, this.lastKillerWeapon, view.respawnIn);
    else hud.setDeath(false);

    // minimap
    if (this.settings.minimap) {
      document.getElementById('minimapWrap').style.display = 'block';
      const blips = [];
      for (const e of session.entities.values()) {
        if (!e.alive) continue;
        const friendly = e.team === session.myTeam;
        if (!friendly && !session.isRevealed(e)) continue;
        blips.push({ x: e.pos.x, z: e.pos.z, team: e.team, alive: e.alive, yaw: e.yaw, self: e.id === session.myId });
      }
      this.minimap.draw({ x: view.x, z: view.z, yaw: view.yaw, team: session.myTeam },
        blips, this.usesObjectives ? session.objectives : [], session.uavActive);
    } else {
      document.getElementById('minimapWrap').style.display = 'none';
    }

    hud.setScoreboard(this.scoreboardHeld, session.scoreboard(), session.myId, session.myTeam);
  }

  setScoreboardHeld(v) { this.scoreboardHeld = v; }

  dispose() {
    window.removeEventListener('resize', this._resize);
    this.stop();
    this.renderer.dispose();
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
