// First person weapon model: built per weapon class, with idle sway, walk bob,
// ADS blending and recoil kick.

import * as THREE from 'three';
import { WEAPON_CLASS } from '/shared/weapons.js';

function part(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z);
  return mesh;
}

const BODY = 0x30343a;
const DARK = 0x191c20;
const METAL = 0x4a5058;

function buildGun(cls) {
  const g = new THREE.Group();
  switch (cls) {
    case WEAPON_CLASS.SNIPER:
      g.add(part(0.09, 0.11, 0.95, BODY, 0, 0, -0.1));
      g.add(part(0.05, 0.05, 0.78, DARK, 0, 0.01, -0.85));
      g.add(part(0.11, 0.12, 0.3, 0x3b2f24, 0, -0.02, 0.42));
      g.add(part(0.07, 0.16, 0.1, DARK, 0, -0.13, 0.12));
      g.add(part(0.08, 0.08, 0.34, 0x1f2226, 0, 0.12, -0.18));   // scope tube
      g.add(part(0.12, 0.12, 0.05, 0x0d0f12, 0, 0.12, -0.36));
      break;
    case WEAPON_CLASS.SHOTGUN:
      g.add(part(0.1, 0.12, 0.8, 0x3a2f28, 0, 0, -0.05));
      g.add(part(0.06, 0.06, 0.66, DARK, 0, 0.03, -0.5));
      g.add(part(0.07, 0.07, 0.5, METAL, 0, -0.05, -0.42));
      g.add(part(0.11, 0.13, 0.26, 0x3a2f28, 0, -0.01, 0.38));
      break;
    case WEAPON_CLASS.PISTOL:
      g.add(part(0.06, 0.1, 0.34, BODY, 0, 0, -0.06));
      g.add(part(0.05, 0.16, 0.08, DARK, 0, -0.12, 0.06));
      g.add(part(0.03, 0.03, 0.12, METAL, 0, 0.03, -0.26));
      break;
    case WEAPON_CLASS.LAUNCHER:
      g.add(part(0.13, 0.13, 1.1, 0x3c4a34, 0, 0, -0.2));
      g.add(part(0.2, 0.2, 0.3, 0x5b3a24, 0, 0, -0.85));
      g.add(part(0.07, 0.17, 0.1, DARK, 0, -0.14, 0.14));
      break;
    case WEAPON_CLASS.LMG:
      g.add(part(0.12, 0.14, 0.92, BODY, 0, 0, -0.1));
      g.add(part(0.06, 0.06, 0.66, DARK, 0, 0.02, -0.78));
      g.add(part(0.16, 0.2, 0.3, 0x2a2e33, 0, -0.14, 0.02));     // box mag
      g.add(part(0.08, 0.1, 0.26, BODY, 0, -0.02, 0.42));
      g.add(part(0.05, 0.12, 0.05, METAL, 0, 0.12, -0.5));
      break;
    case WEAPON_CLASS.SMG:
      g.add(part(0.08, 0.11, 0.5, BODY, 0, 0, -0.04));
      g.add(part(0.05, 0.05, 0.3, DARK, 0, 0.01, -0.38));
      g.add(part(0.06, 0.22, 0.09, 0x23272c, 0, -0.16, 0.0));
      g.add(part(0.07, 0.09, 0.22, DARK, 0, 0, 0.3));
      g.add(part(0.05, 0.06, 0.04, METAL, 0, 0.09, -0.2));
      break;
    default:                                                      // assault rifle
      g.add(part(0.09, 0.12, 0.68, BODY, 0, 0, -0.08));
      g.add(part(0.05, 0.05, 0.46, DARK, 0, 0.01, -0.58));
      g.add(part(0.07, 0.24, 0.11, 0x23272c, 0, -0.17, 0.02));
      g.add(part(0.08, 0.1, 0.28, BODY, 0, -0.01, 0.34));
      g.add(part(0.06, 0.06, 0.16, 0x1f2328, 0, 0.1, -0.12));
      g.add(part(0.05, 0.05, 0.04, METAL, 0, 0.11, -0.42));
  }
  g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return g;
}

export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.gun = null;
    this.cls = null;

    // hands
    const hand = (x) => part(0.1, 0.1, 0.16, 0xb98a63, x, -0.08, 0.06);
    this.hands = new THREE.Group();
    this.hands.add(hand(-0.06), hand(0.07));
    this.group.add(this.hands);

    this.muzzle = new THREE.Object3D();
    this.group.add(this.muzzle);

    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.flash.renderOrder = 998;
    this.group.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffb45a, 0, 9);
    this.group.add(this.flashLight);

    this.basePos = new THREE.Vector3(0.23, -0.2, -0.78);
    this.adsPos = new THREE.Vector3(0, -0.108, -0.62);
    this.pos = this.basePos.clone();
    this.rot = new THREE.Euler();
    this.bobPhase = 0;
    this.kick = 0;
    this.kickRot = 0;
    this.reloadAnim = 0;
    this.sway = { x: 0, y: 0 };
    this.sprintAmount = 0;

    camera.add(this.group);
  }

  setWeapon(cls) {
    if (this.cls === cls) return;
    this.cls = cls;
    if (this.gun) { this.group.remove(this.gun); disposeTree(this.gun); }
    this.gun = buildGun(cls);
    this.group.add(this.gun);
    const barrelZ = cls === WEAPON_CLASS.SNIPER ? -1.2 : cls === WEAPON_CLASS.PISTOL ? -0.32 : -0.8;
    this.muzzle.position.set(0, 0.02, barrelZ);
    this.flash.position.set(0, 0.03, barrelZ - 0.05);
    this.flashLight.position.set(0, 0.05, barrelZ);
  }

  onFire(strength = 1) {
    this.kick = Math.min(0.14, this.kick + 0.055 * strength);
    this.kickRot = Math.min(0.5, this.kickRot + 0.2 * strength);
    this.flash.material.opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.7);
    this.flashLight.intensity = 3.4 * strength;
  }

  onReload(duration) { this.reloadAnim = duration; }

  update(dt, state) {
    const { speed = 0, ads = 0, sprinting = false, mouseDX = 0, mouseDY = 0, onGround = true, hidden = false } = state;
    this.group.visible = !hidden;
    if (hidden) return;

    // walk bob
    this.bobPhase += dt * (4 + speed * 1.6);
    const bobAmt = Math.min(1, speed / 7) * (1 - ads) * (onGround ? 1 : 0.25);
    const bobX = Math.cos(this.bobPhase) * 0.016 * bobAmt;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.018 * bobAmt;

    // mouse sway, smoothed
    this.sway.x += (-mouseDX * 0.0012 - this.sway.x) * Math.min(1, dt * 9);
    this.sway.y += (-mouseDY * 0.0012 - this.sway.y) * Math.min(1, dt * 9);
    this.sway.x = Math.max(-0.07, Math.min(0.07, this.sway.x));
    this.sway.y = Math.max(-0.07, Math.min(0.07, this.sway.y));

    this.sprintAmount += ((sprinting ? 1 : 0) - this.sprintAmount) * Math.min(1, dt * 8);

    const target = new THREE.Vector3().lerpVectors(this.basePos, this.adsPos, ads);
    target.x += bobX + this.sway.x;
    target.y += bobY + this.sway.y;
    target.z += this.kick;

    // sprint: tuck the weapon down and to the side
    target.x += this.sprintAmount * 0.12 * (1 - ads);
    target.y -= this.sprintAmount * 0.07 * (1 - ads);

    // reload: dip the weapon
    if (this.reloadAnim > 0) {
      this.reloadAnim = Math.max(0, this.reloadAnim - dt);
      target.y -= 0.14;
      target.z += 0.05;
    }

    this.pos.lerp(target, Math.min(1, dt * 16));
    this.group.position.copy(this.pos);

    this.group.rotation.x = -this.kickRot * 0.5 + this.sway.y * 1.4 - this.sprintAmount * 0.25 * (1 - ads);
    this.group.rotation.y = this.sway.x * 2.0 + this.sprintAmount * 0.45 * (1 - ads);
    this.group.rotation.z = this.sprintAmount * 0.18 * (1 - ads);

    this.kick *= Math.max(0, 1 - dt * 12);
    this.kickRot *= Math.max(0, 1 - dt * 14);
    this.flash.material.opacity *= Math.max(0, 1 - dt * 26);
    this.flashLight.intensity *= Math.max(0, 1 - dt * 22);
    this.hands.visible = ads < 0.7;
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
