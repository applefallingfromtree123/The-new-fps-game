// Turns a generated map into three.js geometry.
// Blocks are grouped by colour into InstancedMeshes, so even the 700-block
// large maps render in a handful of draw calls.

import * as THREE from 'three';

function noiseTexture(base, contrast = 18, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(base);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * contrast;
    img.data[i * 4] = Math.max(0, Math.min(255, col.r * 255 + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, col.g * 255 + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, col.b * 255 + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class WorldView {
  constructor(scene, map, quality = 'medium') {
    this.scene = scene;
    this.map = map;
    this.quality = quality;
    this.group = new THREE.Group();
    this.objectiveMarkers = new Map();
    scene.add(this.group);
    this.build();
  }

  build() {
    const theme = this.map.themeData;
    const scene = this.scene;

    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);

    // --- lights -----------------------------------------------------------
    const hemi = new THREE.HemisphereLight(theme.sky, theme.ground, theme.ambientIntensity);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(theme.ambient, theme.ambientIntensity * 0.5);
    scene.add(amb);

    const sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity);
    sun.position.set(60, 110, 40);
    if (this.quality !== 'low') {
      sun.castShadow = true;
      const s = this.quality === 'high' ? 2048 : 1024;
      sun.shadow.mapSize.set(s, s);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 260;
      const span = 60;
      sun.shadow.camera.left = -span; sun.shadow.camera.right = span;
      sun.shadow.camera.top = span; sun.shadow.camera.bottom = -span;
      sun.shadow.bias = -0.0012;
      sun.shadow.normalBias = 0.03;
    }
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // interiors get ceiling lamps so covered maps stay readable
    if (this.map.theme === 'indoor' || this.map.theme === 'night') {
      const step = this.map.size === 'small' ? 16 : 26;
      for (let x = -this.map.hx + step / 2; x < this.map.hx; x += step) {
        for (let z = -this.map.hz + step / 2; z < this.map.hz; z += step) {
          const lamp = new THREE.PointLight(0xffe2b0, 0.85, step * 1.9, 1.6);
          lamp.position.set(x, 3.6, z);
          this.group.add(lamp);
        }
      }
    }

    // --- ground -----------------------------------------------------------
    const groundTex = noiseTexture(theme.ground, 22, 128);
    groundTex.repeat.set(this.map.hx / 2, this.map.hz / 2);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.map.hx * 2 + 40, this.map.hz * 2 + 40),
      new THREE.MeshLambertMaterial({ map: groundTex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = this.quality !== 'low';
    this.group.add(ground);

    // a darker skirt so the map edge does not float in the fog
    const skirt = new THREE.Mesh(
      new THREE.PlaneGeometry(this.map.hx * 6, this.map.hz * 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.fog).multiplyScalar(0.85) }),
    );
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.12;
    this.group.add(skirt);

    // --- blocks -----------------------------------------------------------
    const byColor = new Map();
    for (const b of this.map.blocks) {
      if (!byColor.has(b.c)) byColor.set(b.c, []);
      byColor.get(b.c).push(b);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();
    this.instanced = [];

    for (const [color, list] of byColor) {
      const tex = noiseTexture(color, 14, 64);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      mesh.castShadow = this.quality !== 'low';
      mesh.receiveShadow = this.quality !== 'low';
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      list.forEach((b, i) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // subtle per-instance shade variation
        const v = 0.88 + Math.random() * 0.24;
        tmpColor.setHex(0xffffff).multiplyScalar(v);
        mesh.setColorAt(i, tmpColor);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
      this.instanced.push(mesh);
    }

    // --- objective rings --------------------------------------------------
    for (const obj of this.map.objectives) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(obj.radius - 0.35, obj.radius, 48),
        new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      g.add(ring);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 22, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
      );
      beam.position.set(0, 11, 0);
      g.add(beam);

      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.9, 0.08),
        new THREE.MeshBasicMaterial({ color: 0xcccccc }),
      );
      flag.position.set(0.75, 3.2, 0);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6),
        new THREE.MeshLambertMaterial({ color: 0x8b8f94 }),
      );
      pole.position.y = 1.8;
      g.add(pole); g.add(flag);

      const label = makeTextSprite(obj.id, '#ffffff');
      label.position.set(0, 4.4, 0);
      label.scale.set(2.4, 1.2, 1);
      g.add(label);

      g.position.set(obj.x, 0, obj.z);
      this.group.add(g);
      this.objectiveMarkers.set(obj.id, { group: g, ring, beam, flag, label });
    }
  }

  setObjectivesVisible(visible) {
    for (const m of this.objectiveMarkers.values()) m.group.visible = visible;
  }

  /** Recolour capture points to match ownership. */
  updateObjectives(objectives, teamColors) {
    for (const o of objectives) {
      const m = this.objectiveMarkers.get(o.id);
      if (!m) continue;
      const col = o.owner === 0 ? teamColors[0] : o.owner === 1 ? teamColors[1] : 0xdddddd;
      m.ring.material.color.setHex(col);
      m.beam.material.color.setHex(col);
      m.flag.material.color.setHex(col);
      const contest = o.contested;
      m.ring.material.opacity = contest ? 0.35 + Math.abs(Math.sin(performance.now() / 180)) * 0.45 : 0.5;
      m.flag.position.y = 3.2 + Math.abs(o.progress) * 0.0;
    }
  }

  /** Keep the shadow frustum centred on the player. */
  updateSun(pos) {
    if (!this.sun.castShadow) return;
    this.sun.position.set(pos.x + 60, 110, pos.z + 40);
    this.sun.target.position.set(pos.x, 0, pos.z);
    this.sun.target.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      }
    });
  }
}

export function makeTextSprite(text, color = '#ffffff', size = 64) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = `700 ${size}px Rajdhani, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;
  return sprite;
}
