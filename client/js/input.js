// Keyboard + mouse, with two capture modes:
//   * pointer lock  — desktop browsers, raw mouse deltas
//   * fallback      — iPadOS/iOS Safari and other browsers without pointer
//                     lock, where looking is done by dragging and the
//                     on-screen controls provide the action buttons.

import { TouchControls, needsTouchControls } from './touch.js';

export class Input {
  constructor(canvas, settings, hudElement) {
    this.canvas = canvas;
    this.settings = settings;
    this.keys = new Set();
    // Momentary actions are latched on keydown so a quick tap is never lost
    // between two frames, which matters on low frame rates.
    this.pulses = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.locked = false;
    this.yaw = 0;
    this.pitch = 0;
    this.wheel = 0;
    this.onPause = null;
    this.onToggleScoreboard = null;
    this.enabled = false;

    this.pointerLockSupported = typeof canvas.requestPointerLock === 'function';
    this.touchMode = needsTouchControls(canvas);
    this.usePointerLock = this.pointerLockSupported && !this.touchMode;

    this.touch = new TouchControls(hudElement || document.body, {
      onPause: () => this.onPause?.(),
      onScoreboard: (held) => this.onToggleScoreboard?.(held),
    });

    this._onKeyDown = (e) => {
      if (e.code === 'Escape') {
        // without pointer lock nothing else tells us the player wants out
        if (!this.usePointerLock && this.locked) { e.preventDefault(); this.onPause?.(); }
        return;
      }
      if (!this.enabled) return;
      if (!e.repeat && PULSE_KEYS.has(e.code)) this.pulses.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Tab') { e.preventDefault(); this.onToggleScoreboard?.(true); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.onToggleScoreboard?.(false);
    };
    this._onMouseMove = (e) => {
      if (!this.usePointerLock || !this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
      this.applyLook(e.movementX, e.movementY, this.settings.sensitivity * 0.0012);
    };
    this._onMouseDown = (e) => {
      if (!this.usePointerLock || !this.locked) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    };
    this._onWheel = (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); };
    this._onContext = (e) => { if (this.locked) e.preventDefault(); };
    this._onLockChange = () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (wasLocked && !this.locked) this.onPause?.();
      if (!this.locked) { this.mouse.left = false; this.mouse.right = false; this.keys.clear(); this.pulses.clear(); }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  applyLook(dx, dy, scale) {
    this.yaw -= dx * scale;
    this.pitch += (this.settings.invertY ? 1 : -1) * dy * scale;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  requestLock() {
    if (this.usePointerLock) {
      // optional on-screen buttons for mouse players; the drag zones stay off
      if (this.settings.touchUI) { this.touch.setZonesEnabled(false); this.touch.setVisible(true); }
      if (!this.locked) this.canvas.requestPointerLock();
      return;
    }
    // fallback: capture starts immediately and the on-screen pad appears
    this.locked = true;
    this.touch.setVisible(true);
  }

  exitLock() {
    if (this.usePointerLock) {
      if (this.settings.touchUI) this.touch.setVisible(false);
      if (this.locked && document.exitPointerLock) document.exitPointerLock();
      return;
    }
    this.locked = false;
    this.touch.setVisible(false);
  }

  down(code) { return this.keys.has(code); }

  /** Consume accumulated mouse delta (used for weapon sway). */
  takeDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }

  sample(prev) {
    // drag-look from the touch pad / trackpad
    if (this.touch.visible && this.touch.zonesEnabled && this.locked) {
      const look = this.touch.consumeLook();
      if (look.dx || look.dy) {
        const scale = 0.0022 * (this.settings.touchSensitivity ?? 2.2);
        this.applyLook(look.dx, look.dy, scale);
        this.mouse.dx += look.dx;
        this.mouse.dy += look.dy;
      }
    }

    const k = this.keys;
    const t = this.touch.visible ? this.touch.state : null;
    const pulse = (code) => {
      if (!this.pulses.has(code)) return false;
      this.pulses.delete(code);
      return true;
    };
    let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (t) {
      forward = clamp(forward + t.forward, -1, 1);
      right = clamp(right + t.right, -1, 1);
    }

    let slot = prev?.weaponSlot ?? 0;
    if (k.has('Digit1') || pulse('Digit1')) slot = 0;
    if (k.has('Digit2') || pulse('Digit2')) slot = 1;
    if (this.wheel !== 0) { slot = slot === 0 ? 1 : 0; this.wheel = 0; }
    if (pulse('KeyQ')) slot = slot === 0 ? 1 : 0;
    if (t && this.touch.slotDirty) { slot = t.slotToggle; this.touch.slotDirty = false; }

    return {
      forward, right,
      yaw: this.yaw,
      pitch: this.pitch,
      jump: k.has('Space') || pulse('Space') || this.touch.isPulsed('jump'),
      crouch: k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC') || !!t?.crouch,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || !!t?.sprint,
      ads: this.mouse.right || !!t?.ads,
      fire: this.mouse.left || (t ? this.touch.isFiring() : false),
      reload: k.has('KeyR') || pulse('KeyR') || this.touch.isPulsed('reload'),
      melee: k.has('KeyV') || pulse('KeyV') || this.touch.isPulsed('melee'),
      lethal: k.has('KeyG') || pulse('KeyG') || this.touch.isPulsed('lethal'),
      tactical: k.has('KeyF') || pulse('KeyF') || this.touch.isPulsed('tactical'),
      streak: k.has('KeyX') || pulse('KeyX') || this.touch.isPulsed('streak'),
      weaponSlot: slot,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

const PULSE_KEYS = new Set([
  'KeyR', 'KeyV', 'KeyG', 'KeyF', 'KeyX', 'KeyQ', 'Digit1', 'Digit2', 'Space',
]);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
