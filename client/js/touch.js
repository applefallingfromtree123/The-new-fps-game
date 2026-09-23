// On-screen controls for touch devices.
//
// iPadOS / iOS Safari does not implement the Pointer Lock API, so mouse-look
// is impossible there. These controls provide a left thumbstick, a right-side
// look area and action buttons, and they also work with a trackpad or mouse
// by dragging.

const BUTTONS = [
  { id: 'fire', label: '사격', cls: 'fire', hold: true },
  { id: 'ads', label: '조준', cls: 'ads', toggle: true },
  { id: 'jump', label: '점프', cls: 'jump', hold: true },
  { id: 'crouch', label: '앉기', cls: 'crouch', toggle: true },
  { id: 'reload', label: '장전', cls: 'reload', hold: true },
  { id: 'swap', label: '무기', cls: 'swap', hold: true },
  { id: 'lethal', label: '수류탄', cls: 'lethal', hold: true },
  { id: 'tactical', label: '섬광', cls: 'tactical', hold: true },
  { id: 'melee', label: '근접', cls: 'melee', hold: true },
  { id: 'streak', label: '스트릭', cls: 'streak', hold: true },
];

export class TouchControls {
  constructor(hostElement, opts = {}) {
    this.onPause = opts.onPause || (() => {});
    this.onScoreboard = opts.onScoreboard || (() => {});
    this.state = {
      forward: 0, right: 0, sprint: false,
      fire: false, ads: false, jump: false, crouch: false,
      reload: false, melee: false, lethal: false, tactical: false, streak: false,
      slotToggle: 0,
    };
    this.look = { dx: 0, dy: 0 };
    this.stickPointer = null;
    this.lookPointer = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.radius = 64;
    this.visible = false;
    this.zonesEnabled = true;
    this.slotDirty = false;
    this.pulses = {};

    const root = document.createElement('div');
    root.id = 'touchControls';
    root.className = 'touch-controls hidden';
    root.innerHTML = `
      <div class="touch-zone left" data-zone="move"></div>
      <div class="touch-zone right" data-zone="look"></div>
      <div class="stick" hidden><i class="base"></i><i class="knob"></i></div>
      <div class="touch-buttons">
        ${BUTTONS.map((b) => `<button class="tbtn ${b.cls}" data-action="${b.id}">${b.label}</button>`).join('')}
      </div>
      <div class="touch-top">
        <button class="tbtn small" data-action="scoreboard">점수판</button>
        <button class="tbtn small" data-action="pause">메뉴</button>
      </div>`;
    hostElement.appendChild(root);

    this.root = root;
    this.stick = root.querySelector('.stick');
    this.knob = root.querySelector('.knob');

    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e), { passive: false });
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', (e) => this.onUp(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setVisible(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) this.reset();
  }

  /** With pointer lock active the stick/look zones must not swallow clicks. */
  setZonesEnabled(v) {
    this.zonesEnabled = v;
    this.root.classList.toggle('zones-off', !v);
  }

  reset() {
    const s = this.state;
    s.forward = 0; s.right = 0; s.sprint = false;
    s.fire = false; s.jump = false; s.reload = false;
    s.melee = false; s.lethal = false; s.tactical = false; s.streak = false;
    this.stickPointer = null;
    this.lookPointer = null;
    this.stick.hidden = true;
    this.root.querySelectorAll('.tbtn.active').forEach((b) => {
      if (!b.dataset.toggle) b.classList.remove('active');
    });
  }

  onDown(e) {
    const btn = e.target.closest('.tbtn');
    if (btn) {
      e.preventDefault();
      this.pressButton(btn, true);
      try { btn.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      return;
    }
    const zone = e.target.closest('.touch-zone');
    if (!zone) return;
    e.preventDefault();
    if (zone.dataset.zone === 'move' && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.hidden = false;
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (zone.dataset.zone === 'look' && this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookStart = { x: e.clientX, y: e.clientY, at: performance.now() };
    }
    try { this.root.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
  }

  onMove(e) {
    if (e.pointerId === this.stickPointer) {
      e.preventDefault();
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      const max = this.radius;
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.state.right = dx / max;
      this.state.forward = -dy / max;
      this.state.sprint = len / max > 0.82 && -dy > 0;
    } else if (e.pointerId === this.lookPointer) {
      e.preventDefault();
      this.look.dx += e.clientX - this.lookLast.x;
      this.look.dy += e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
    }
  }

  onUp(e) {
    const btn = e.target.closest('.tbtn');
    if (btn) { this.pressButton(btn, false); return; }
    if (e.pointerId === this.stickPointer) {
      this.stickPointer = null;
      this.stick.hidden = true;
      this.state.forward = 0;
      this.state.right = 0;
      this.state.sprint = false;
    } else if (e.pointerId === this.lookPointer) {
      // a quick tap that did not drag counts as a shot
      const st = this.lookStart;
      if (st && performance.now() - st.at < 260
          && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 12) {
        this.tapFireUntil = performance.now() + 120;
      }
      this.lookPointer = null;
    }
  }

  /** Fire button held, or a tap on the look area. */
  isFiring() {
    return this.state.fire || (this.tapFireUntil || 0) > performance.now();
  }

  pressButton(btn, down) {
    const action = btn.dataset.action;
    if (action === 'pause') { if (down) this.onPause(); return; }
    if (action === 'scoreboard') { this.onScoreboard(down); btn.classList.toggle('active', down); return; }
    if (action === 'swap') {
      if (down) {
        this.state.slotToggle ^= 1;
        this.slotDirty = true;
        btn.classList.toggle('active', !!this.state.slotToggle);
      }
      return;
    }

    const def = BUTTONS.find((b) => b.id === action);
    if (!def) return;
    if (def.toggle) {
      if (!down) return;
      this.state[action] = !this.state[action];
      btn.classList.toggle('active', this.state[action]);
      btn.dataset.toggle = '1';
    } else {
      this.state[action] = down;
      // hold the action briefly so a quick tap survives a slow frame
      if (down) this.pulses[action] = performance.now() + 130;
      btn.classList.toggle('active', down);
    }
  }

  /** True while a momentary button is held or was just tapped. */
  isPulsed(action) {
    if (!this.visible) return false;
    if (this.state[action]) return true;
    return (this.pulses[action] || 0) > performance.now();
  }

  /** Accumulated look delta in pixels since the last call. */
  consumeLook() {
    const out = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return out;
  }
}

/** Touch-first device (phone/tablet) or a browser without pointer lock. */
export function needsTouchControls(canvas) {
  const noPointerLock = typeof canvas.requestPointerLock !== 'function';
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const touch = (navigator.maxTouchPoints || 0) > 0;
  return noPointerLock || (coarse && touch);
}
