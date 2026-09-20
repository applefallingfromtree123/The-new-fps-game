// Keyboard + mouse with pointer lock. Produces the input struct the shared
// simulation consumes.

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.locked = false;
    this.yaw = 0;
    this.pitch = 0;
    this.wheel = 0;
    this.onPause = null;
    this.onToggleScoreboard = null;
    this.enabled = false;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Escape') return;                 // handled by pointerlockchange
      this.keys.add(e.code);
      if (e.code === 'Tab') { e.preventDefault(); this.onToggleScoreboard?.(true); }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.onToggleScoreboard?.(false);
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      const sens = this.settings.sensitivity * 0.0012;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
      this.yaw -= e.movementX * sens;
      this.pitch += (this.settings.invertY ? 1 : -1) * e.movementY * sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
      while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
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
      if (!this.locked) { this.mouse.left = false; this.mouse.right = false; this.keys.clear(); }
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

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }
  exitLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }

  /** Consume accumulated mouse delta (used for weapon sway). */
  takeDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return d;
  }

  sample(prev) {
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    let slot = prev?.weaponSlot ?? 0;
    if (k.has('Digit1')) slot = 0;
    if (k.has('Digit2')) slot = 1;
    if (this.wheel !== 0) { slot = slot === 0 ? 1 : 0; this.wheel = 0; }
    if (k.has('KeyQ') && !this._qDown) { slot = slot === 0 ? 1 : 0; this._qDown = true; }
    if (!k.has('KeyQ')) this._qDown = false;

    return {
      forward, right,
      yaw: this.yaw,
      pitch: this.pitch,
      jump: k.has('Space'),
      crouch: k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC'),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      ads: this.mouse.right,
      fire: this.mouse.left,
      reload: k.has('KeyR'),
      melee: k.has('KeyV'),
      lethal: k.has('KeyG'),
      tactical: k.has('KeyF'),
      streak: k.has('KeyX'),
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
