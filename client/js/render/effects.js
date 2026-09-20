// Pooled visual effects: tracers, impact sparks, blood, explosions, smoke and
// grenade props. Everything is allocated up front and recycled.

import * as THREE from 'three';

const MAX_PARTICLES = 2400;
const MAX_TRACERS = 96;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // ---- particles -------------------------------------------------------
    const pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    pGeo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const pMat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      sizeAttenuation: true, depthWrite: false,
    });
    this.points = new THREE.Points(pGeo, pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, g: 1, r: 1, g2: 1, b: 1, drag: 1 });
      this.pPos[i * 3 + 1] = -9999;
    }
    this.pCursor = 0;

    // ---- tracers ---------------------------------------------------------
    const tGeo = new THREE.BufferGeometry();
    this.tPos = new Float32Array(MAX_TRACERS * 6);
    this.tCol = new Float32Array(MAX_TRACERS * 6);
    tGeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3));
    this.tracerMesh = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.tracerMesh.frustumCulled = false;
    scene.add(this.tracerMesh);
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) this.tracers.push({ alive: false, life: 0, max: 0.09, color: new THREE.Color() });
    this.tCursor = 0;

    // ---- explosions ------------------------------------------------------
    this.explosions = [];
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.visible = false;
      scene.add(mesh);
      const light = new THREE.PointLight(0xff9a40, 0, 34);
      scene.add(light);
      this.explosions.push({ mesh, light, t: 0, dur: 0, radius: 1 });
    }

    // ---- smoke clouds ----------------------------------------------------
    this.smokes = [];

    // ---- grenade props ---------------------------------------------------
    this.props = new Map();
    this.propGeo = new THREE.SphereGeometry(0.1, 8, 6);
    this.propMats = {
      lethal: new THREE.MeshLambertMaterial({ color: 0x3f4a35 }),
      tactical: new THREE.MeshLambertMaterial({ color: 0x9aa2ad }),
      rocket: new THREE.MeshLambertMaterial({ color: 0x6b5a3a }),
    };
  }

  // ------------------------------------------------------------- particles
  spawnParticle(x, y, z, vx, vy, vz, life, color, size = 0.09, gravity = 1, drag = 1) {
    const p = this.particles[this.pCursor];
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.g = gravity; p.drag = drag;
    const c = _tmpColor.setHex(color);
    p.r = c.r; p.g2 = c.g; p.b = c.b;
    p.size = size;
  }

  impact(x, y, z, nx, ny, nz, surface = 'wall') {
    const isMetal = surface === 'container' || surface === 'pillar';
    const color = isMetal ? 0xffd27a : surface === 'ground' ? 0xa08c6a : 0xc9c2b4;
    for (let i = 0; i < 7; i++) {
      const sx = nx + (Math.random() - 0.5) * 1.3;
      const sy = ny + Math.random() * 1.1;
      const sz = nz + (Math.random() - 0.5) * 1.3;
      const s = 2.2 + Math.random() * 3.4;
      this.spawnParticle(x, y, z, sx * s, sy * s, sz * s, 0.35 + Math.random() * 0.3, color, 0.05, 1.4);
    }
    // dust puff
    for (let i = 0; i < 3; i++) {
      this.spawnParticle(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05,
        (Math.random() - 0.5) * 0.7, Math.random() * 0.6, (Math.random() - 0.5) * 0.7,
        0.5 + Math.random() * 0.4, 0xb0a894, 0.16, 0.06, 0.9);
    }
  }

  blood(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 9; i++) {
      this.spawnParticle(x, y, z,
        dx * 2 + (Math.random() - 0.5) * 3.2,
        dy * 2 + Math.random() * 2.4,
        dz * 2 + (Math.random() - 0.5) * 3.2,
        0.4 + Math.random() * 0.3, 0x9b1717, 0.07, 1.6);
    }
  }

  tracer(x1, y1, z1, x2, y2, z2, color = 0x9fd8ff) {
    const i = this.tCursor;
    this.tCursor = (this.tCursor + 1) % MAX_TRACERS;
    const t = this.tracers[i];
    t.alive = true; t.life = t.max;
    t.color.setHex(color);
    const o = i * 6;
    this.tPos[o] = x1; this.tPos[o + 1] = y1; this.tPos[o + 2] = z1;
    this.tPos[o + 3] = x2; this.tPos[o + 4] = y2; this.tPos[o + 5] = z2;
  }

  explosion(x, y, z, radius) {
    let slot = this.explosions.find((e) => e.dur === 0) || this.explosions[0];
    slot.mesh.position.set(x, y, z);
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(radius * 0.2);
    slot.mesh.material.opacity = 1;
    slot.light.position.set(x, y + 1, z);
    slot.light.intensity = 14;
    slot.light.distance = radius * 4;
    slot.t = 0; slot.dur = 0.55; slot.radius = radius;

    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5;
      const s = 6 + Math.random() * 16;
      this.spawnParticle(x, y + 0.3, z,
        Math.cos(a) * Math.cos(el) * s, Math.sin(el) * s + 3, Math.sin(a) * Math.cos(el) * s,
        0.5 + Math.random() * 0.7, Math.random() < 0.5 ? 0xffb347 : 0x6b6b6b, 0.22, 1.1, 0.96);
    }
  }

  smoke(x, y, z, radius, duration) {
    const group = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (0.35 + Math.random() * 0.3), 8, 6),
        new THREE.MeshLambertMaterial({ color: 0xd9dde2, transparent: true, opacity: 0 }),
      );
      m.position.set((Math.random() - 0.5) * radius, Math.random() * radius * 0.7, (Math.random() - 0.5) * radius);
      group.add(m);
    }
    group.position.set(x, y, z);
    this.scene.add(group);
    this.smokes.push({ group, t: 0, dur: duration || 12 });
  }

  muzzleSmoke(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 2; i++) {
      this.spawnParticle(x, y, z, dx * 1.5 + (Math.random() - 0.5), dy * 1.5 + Math.random() * 0.5, dz * 1.5 + (Math.random() - 0.5),
        0.3, 0xb9bec4, 0.1, 0.2, 0.9);
    }
  }

  setProp(key, kind, x, y, z) {
    let p = this.props.get(key);
    if (!p) {
      p = new THREE.Mesh(this.propGeo, this.propMats[kind] || this.propMats.lethal);
      p.castShadow = true;
      this.scene.add(p);
      this.props.set(key, p);
    }
    p.position.set(x, y, z);
    p.visible = true;
    p.userData.seen = true;
  }

  sweepProps() {
    for (const [key, p] of this.props) {
      if (!p.userData.seen) { p.visible = false; }
      p.userData.seen = false;
    }
  }

  // ------------------------------------------------------------------ tick
  update(dt) {
    // particles
    const pos = this.pPos, col = this.pCol;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        pos[i * 3 + 1] = -9999;
        continue;
      }
      p.vy -= 9.8 * p.g * dt;
      p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const f = Math.max(0, p.life / p.max);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r * f; col[i * 3 + 1] = p.g2 * f; col[i * 3 + 2] = p.b * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // tracers
    const tc = this.tCol;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      const o = i * 6;
      if (!t.alive) { tc[o] = tc[o + 1] = tc[o + 2] = tc[o + 3] = tc[o + 4] = tc[o + 5] = 0; continue; }
      t.life -= dt;
      if (t.life <= 0) { t.alive = false; continue; }
      const f = t.life / t.max;
      tc[o] = t.color.r * f * 0.35; tc[o + 1] = t.color.g * f * 0.35; tc[o + 2] = t.color.b * f * 0.35;
      tc[o + 3] = t.color.r * f; tc[o + 4] = t.color.g * f; tc[o + 5] = t.color.b * f;
    }
    this.tracerMesh.geometry.attributes.position.needsUpdate = true;
    this.tracerMesh.geometry.attributes.color.needsUpdate = true;

    // explosions
    for (const e of this.explosions) {
      if (e.dur === 0) continue;
      e.t += dt;
      const f = e.t / e.dur;
      if (f >= 1) { e.dur = 0; e.mesh.visible = false; e.light.intensity = 0; continue; }
      e.mesh.scale.setScalar(e.radius * (0.2 + f * 0.95));
      e.mesh.material.opacity = (1 - f) * 0.85;
      e.light.intensity = 14 * (1 - f) * (1 - f);
    }

    // smoke
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const fadeIn = Math.min(1, s.t / 1.2);
      const fadeOut = Math.max(0, Math.min(1, (s.dur - s.t) / 2));
      const op = 0.72 * fadeIn * fadeOut;
      for (const m of s.group.children) {
        m.material.opacity = op;
        m.position.y += dt * 0.12;
        m.rotation.y += dt * 0.15;
      }
      if (s.t > s.dur) {
        this.scene.remove(s.group);
        s.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.smokes.splice(i, 1);
      }
    }
  }

  dispose() {
    this.scene.remove(this.points);
    this.scene.remove(this.tracerMesh);
    for (const e of this.explosions) { this.scene.remove(e.mesh); this.scene.remove(e.light); }
    for (const s of this.smokes) this.scene.remove(s.group);
    for (const p of this.props.values()) this.scene.remove(p);
    this.props.clear();
    this.smokes.length = 0;
  }
}

const _tmpColor = new THREE.Color();
