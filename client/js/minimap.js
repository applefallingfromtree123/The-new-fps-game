// Rotating tactical minimap drawn on a 2D canvas, plus the static top-down
// previews used on the map-select screen.

const COL = { alpha: '#4da3ff', bravo: '#ff5f52', neutral: '#c9d2dd' };

/** Pre-render the static geometry once; it only needs redrawing per map. */
function renderStatic(map, size, scale) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(12,17,24,0.82)';
  ctx.fillRect(0, 0, size, size);

  const half = size / 2;
  const toPx = (v) => half + v * scale;

  // walls, brighter for taller geometry so the layout reads at a glance
  for (const b of map.blocks) {
    if (b.t === 'bound') continue;
    const h = b.h;
    const shade = Math.min(0.9, 0.22 + h * 0.07);
    ctx.fillStyle = `rgba(178,196,216,${shade})`;
    ctx.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), Math.max(1, b.w * scale), Math.max(1, b.d * scale));
  }

  // border
  ctx.strokeStyle = 'rgba(140,160,185,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(toPx(-map.hx), toPx(-map.hz), map.hx * 2 * scale, map.hz * 2 * scale);
  return c;
}

export class Minimap {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.range = map.size === 'large' ? 70 : map.size === 'medium' ? 46 : 30;
    this.staticScale = 3;
    this.staticSize = Math.ceil(Math.max(map.hx, map.hz) * 2 * this.staticScale + 40);
    this.static = renderStatic(map, this.staticSize, this.staticScale);
  }

  /**
   * @param {object} view { x, z, yaw, team }
   * @param {Array}  blips [{ x, z, team, alive, self, yaw, enemy }]
   * @param {Array}  objectives
   */
  draw(view, blips, objectives, uavActive) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const R = W / 2;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0a0f16';
    ctx.fillRect(0, 0, W, H);

    const pxPerMeter = R / this.range;

    // Rotate the world so the player always faces up. The extra half turn is
    // what lines the map up with the camera basis (forward +z, right -x).
    ctx.translate(R, R);
    ctx.rotate(view.yaw + Math.PI);
    ctx.scale(pxPerMeter / this.staticScale, pxPerMeter / this.staticScale);
    ctx.translate(-this.staticSize / 2 - view.x * this.staticScale, -this.staticSize / 2 - view.z * this.staticScale);
    ctx.drawImage(this.static, 0, 0);
    ctx.restore();

    // helper: world -> screen with rotation
    const cos = Math.cos(view.yaw), sin = Math.sin(view.yaw);
    const project = (x, z) => {
      const dx = (x - view.x) * pxPerMeter;
      const dz = (z - view.z) * pxPerMeter;
      return { x: R - (dx * cos - dz * sin), y: R - (dx * sin + dz * cos) };
    };

    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();

    // objectives
    for (const o of objectives || []) {
      const p = project(o.x, o.z);
      const col = o.owner === 0 ? COL.alpha : o.owner === 1 ? COL.bravo : COL.neutral;
      ctx.beginPath();
      ctx.arc(p.x, p.y, o.radius * pxPerMeter, 0, Math.PI * 2);
      ctx.fillStyle = col.replace(')', ', 0.16)').replace('#', 'rgba(').length > 0
        ? hexToRgba(col, 0.16) : col;
      ctx.fill();
      ctx.strokeStyle = hexToRgba(col, 0.9);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(o.id, p.x, p.y + 4);
    }

    // blips
    for (const b of blips) {
      if (b.self) continue;
      const p = project(b.x, b.z);
      const col = b.team === view.team ? COL.alpha : COL.bravo;
      if (!b.alive) continue;
      ctx.beginPath();
      if (b.team === view.team) {
        // friendly arrow shows facing
        const a = b.yaw - view.yaw;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-a);
        ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(0, 1.5); ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      }
    }

    // player
    ctx.save();
    ctx.translate(R, R);
    // view cone
    const coneR = 26;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, coneR, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    ctx.restore();

    // frame
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.strokeStyle = uavActive ? 'rgba(120,220,150,0.85)' : 'rgba(150,170,195,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // cardinal marks
    ctx.fillStyle = 'rgba(200,214,230,0.8)';
    ctx.font = '700 10px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    const marks = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]];
    for (const [label, ang] of marks) {
      const a = ang + view.yaw - Math.PI / 2;
      ctx.fillText(label, R + Math.cos(a) * (R - 11), R + Math.sin(a) * (R - 11) + 3.5);
    }
  }
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Static top-down thumbnail for the map browser. */
export function renderMapPreview(canvas, map) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth * 2 || 420;
  const H = canvas.height = 236;
  const theme = map.themeData;
  ctx.fillStyle = '#' + theme.ground.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  const pad = 8;
  const scale = Math.min((W - pad * 2) / (map.hx * 2), (H - pad * 2) / (map.hz * 2));
  const ox = W / 2, oy = H / 2;

  // pick block ink that contrasts with the theme's ground colour
  const g = map.themeData.ground;
  const lum = (((g >> 16) & 255) * 0.299 + ((g >> 8) & 255) * 0.587 + (g & 255) * 0.114) / 255;
  const ink = lum > 0.55 ? '20,28,38' : '226,235,245';
  for (const b of map.blocks) {
    if (b.t === 'bound') continue;
    const shade = Math.min(0.92, 0.3 + b.h * 0.07);
    ctx.fillStyle = `rgba(${ink},${shade})`;
    ctx.fillRect(ox + (b.x - b.w / 2) * scale, oy + (b.z - b.d / 2) * scale,
      Math.max(1, b.w * scale), Math.max(1, b.d * scale));
  }
  for (const o of map.objectives) {
    ctx.beginPath();
    ctx.arc(ox + o.x * scale, oy + o.z * scale, Math.max(6, o.radius * scale), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,194,71,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,194,71,0.95)';
    ctx.font = '700 13px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(o.id, ox + o.x * scale, oy + o.z * scale + 4);
  }
  for (const team of [0, 1]) {
    const col = team === 0 ? COL.alpha : COL.bravo;
    for (const s of map.spawns[team]) {
      ctx.fillStyle = col;
      ctx.fillRect(ox + s.x * scale - 1.5, oy + s.z * scale - 1.5, 3, 3);
    }
  }
}
