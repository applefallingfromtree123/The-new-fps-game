// Procedural soldier: helmet, plate carrier, rig, limbs and a rifle, built from
// boxes so no external assets are needed. Animated with a simple walk cycle.

import * as THREE from 'three';
import { makeTextSprite } from './world.js';

const UNIFORM = [0x4b5340, 0x5c5442, 0x3f4636, 0x6b6450];
const GEAR = 0x2c2f33;
const SKIN = 0xb98a63;

// Each articulated group is merged into a single geometry with vertex colours,
// which keeps a 24 player match at a sane draw-call count.
const VERTEX_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

function mergeBoxes(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let vertexOffset = 0;
  const c = new THREE.Color();
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    g.translate(p.x, p.y, p.z);
    const pos = g.attributes.position.array;
    const nor = g.attributes.normal.array;
    const idx = g.index.array;
    c.setHex(p.color);
    for (let i = 0; i < pos.length; i++) { positions.push(pos[i]); normals.push(nor[i]); }
    for (let i = 0; i < pos.length / 3; i++) { colors.push(c.r, c.g, c.b); }
    for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
    vertexOffset += pos.length / 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/** Builds one merged mesh from a part list and attaches it to `group`. */
function limb(group, parts) {
  const mesh = new THREE.Mesh(mergeBoxes(parts), VERTEX_MAT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

const box = (w, h, d, color, x = 0, y = 0, z = 0) => ({ w, h, d, color, x, y, z });

export class Soldier {
  constructor(opts = {}) {
    const teamColor = opts.teamColor ?? 0x4da3ff;
    const uniform = UNIFORM[(opts.variant ?? 0) % UNIFORM.length];

    this.root = new THREE.Group();
    this.opts = opts;

    // ---- legs (pivot at the hip) ----
    this.legL = new THREE.Group(); this.legL.position.set(-0.16, 0.86, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.16, 0.86, 0);
    for (const g of [this.legL, this.legR]) {
      limb(g, [
        box(0.22, 0.48, 0.24, uniform, 0, -0.24, 0),
        box(0.24, 0.16, 0.26, GEAR, 0, -0.46, 0),      // knee pad
      ]);
      const shin = new THREE.Group();
      shin.position.set(0, -0.46, 0);
      limb(shin, [
        box(0.19, 0.42, 0.21, uniform, 0, -0.2, 0),
        box(0.2, 0.12, 0.3, GEAR, 0, -0.44, 0.04),     // boot
      ]);
      g.add(shin);
      g.userData.shin = shin;
    }
    this.root.add(this.legL, this.legR);

    // ---- torso ----
    this.torso = new THREE.Group();
    this.torso.position.y = 0.86;
    limb(this.torso, [
      box(0.46, 0.56, 0.26, uniform, 0, 0.28, 0),
      box(0.5, 0.42, 0.32, GEAR, 0, 0.3, 0),           // plate carrier
      box(0.16, 0.1, 0.34, teamColor, 0, 0.48, 0),     // team stripe
      box(0.36, 0.3, 0.18, GEAR, 0, 0.3, -0.22),       // backpack
      box(0.1, 0.12, 0.1, teamColor, -0.2, 0.42, 0.16),
      box(0.1, 0.12, 0.1, teamColor, 0.2, 0.42, 0.16),
    ]);
    this.root.add(this.torso);

    // ---- head ----
    this.head = new THREE.Group();
    this.head.position.set(0, 0.62, 0);
    limb(this.head, [
      box(0.22, 0.24, 0.22, SKIN, 0, 0.1, 0),
      box(0.27, 0.14, 0.28, GEAR, 0, 0.22, -0.01),     // helmet
      box(0.24, 0.08, 0.06, 0x1b1d20, 0, 0.12, 0.12),  // goggles
      box(0.2, 0.1, 0.12, GEAR, 0, 0.0, 0.08),         // face mask
    ]);
    this.torso.add(this.head);

    // ---- arms (rifle merged into the right arm) ----
    this.armL = new THREE.Group(); this.armL.position.set(-0.3, 0.5, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.3, 0.5, 0);
    limb(this.armL, [
      box(0.16, 0.36, 0.17, uniform, 0, -0.18, 0),
      box(0.14, 0.34, 0.15, uniform, 0, -0.52, 0),
      box(0.13, 0.12, 0.14, GEAR, 0, -0.72, 0),
    ]);
    this.weapon = new THREE.Group();
    this.weapon.position.set(0.16, -0.62, 0.12);
    limb(this.weapon, [
      box(0.07, 0.1, 0.62, 0x25282c, 0, 0, 0.14),
      box(0.05, 0.05, 0.4, 0x15181b, 0, 0.02, 0.5),
      box(0.06, 0.18, 0.1, 0x1d2023, 0, -0.12, 0.02),
      box(0.06, 0.09, 0.26, 0x2f3338, 0, 0.0, -0.22),
    ]);
    limb(this.armR, [
      box(0.16, 0.36, 0.17, uniform, 0, -0.18, 0),
      box(0.14, 0.34, 0.15, uniform, 0, -0.52, 0),
      box(0.13, 0.12, 0.14, GEAR, 0, -0.72, 0),
    ]);
    this.armR.add(this.weapon);
    this.torso.add(this.armL, this.armR);

    this.nametag = null;
    if (opts.name) {
      this.nametag = makeTextSprite(opts.name, opts.tagColor || '#ffffff', 40);
      this.nametag.position.set(0, 2.15, 0);
      this.nametag.scale.set(0.95, 0.48, 1);
      this.nametag.visible = false;
      this.root.add(this.nametag);
    }

    this.phase = Math.random() * 10;
    this.deathTime = 0;
  }

  setNameVisible(v) { if (this.nametag) this.nametag.visible = v; }

  /**
   * @param {object} s  { x, y, z, yaw, pitch, speed, crouch, alive, firing }
   */
  update(s, dt) {
    const r = this.root;
    r.position.set(s.x, s.y, s.z);

    if (!s.alive) {
      // brief collapse animation, then lie flat
      this.deathTime = Math.min(1, this.deathTime + dt * 2.4);
      r.rotation.y = s.yaw;
      r.rotation.x = -this.deathTime * Math.PI * 0.5;
      r.position.y = s.y + Math.sin(this.deathTime * Math.PI * 0.5) * 0.15;
      this.setNameVisible(false);
      return;
    }
    this.deathTime = 0;
    r.rotation.set(0, s.yaw, 0);

    const speed = s.speed || 0;
    const crouch = s.crouch ? 1 : 0;
    this.phase += dt * (2.2 + speed * 1.5);

    // stance
    const hipY = crouch ? -0.42 : 0;
    r.children.forEach(() => {});
    this.torso.position.y = 0.86 + hipY * 0.55;
    this.legL.position.y = 0.86 + hipY * 0.55;
    this.legR.position.y = 0.86 + hipY * 0.55;
    this.torso.rotation.x = (crouch ? 0.22 : 0) + Math.max(-0.45, Math.min(0.45, -s.pitch * 0.35));
    this.head.rotation.x = Math.max(-0.8, Math.min(0.8, -s.pitch * 0.65));

    // walk cycle
    const stride = Math.min(1, speed / 6.5);
    const sw = Math.sin(this.phase) * stride;
    const sw2 = Math.cos(this.phase) * stride;
    this.legL.rotation.x = sw * 0.75 - crouch * 0.5;
    this.legR.rotation.x = -sw * 0.75 - crouch * 0.5;
    this.legL.userData.shin.rotation.x = Math.max(0, -sw) * 0.6;
    this.legR.userData.shin.rotation.x = Math.max(0, sw) * 0.6;

    // arms hold the rifle across the chest, with a little bob
    const aim = s.ads ? 1 : 0;
    this.armR.rotation.set(-1.25 - aim * 0.28 + sw2 * 0.05 * (1 - aim) - s.pitch * 0.5, -0.28, 0.16);
    this.armL.rotation.set(-1.32 - aim * 0.28 - sw2 * 0.05 * (1 - aim) - s.pitch * 0.5, 0.5, -0.5);
    this.armL.position.set(-0.3 + 0.12, 0.5, 0.06);

    if (s.recoil) {
      this.armR.rotation.x -= s.recoil * 0.6;
      this.weapon.position.z = 0.12 - s.recoil * 0.1;
    } else {
      this.weapon.position.z = 0.12;
    }
    // The rifle is parented to the arm, so it inherits the shoulder rotation.
    // Counter-rotate it to keep the barrel pointing where the soldier aims.
    this.weapon.rotation.x = -s.pitch - (this.torso.rotation.x + this.armR.rotation.x);
    if (this.nametag) this.nametag.position.y = crouch ? 1.55 : 2.05;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      // VERTEX_MAT is shared between every soldier, so only sprites are disposed
      if (o.isSprite && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
