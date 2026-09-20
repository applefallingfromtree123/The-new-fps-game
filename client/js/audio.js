// All sound is synthesised with the Web Audio API, so the game ships with no
// audio assets. Gunfire = filtered noise burst + body thump, tuned per class.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.noiseBuffer = null;
    this.listenerPos = { x: 0, y: 0, z: 0 };
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 8;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Distance attenuation + slight stereo pan relative to the listener. */
  _spatialGain(x, z, maxDist = 90) {
    if (x === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listenerPos.x;
    const dz = z - this.listenerPos.z;
    const dist = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 - dist / maxDist) ** 1.6;
    const yaw = this.listenerPos.yaw || 0;
    const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    const pan = Math.max(-1, Math.min(1, right / Math.max(6, dist)));
    return { gain, pan, dist };
  }

  _chain(gainValue, pan) {
    const g = this.ctx.createGain();
    g.gain.value = gainValue;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan || 0;
      g.connect(p); p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  noise(dur, filterType, freq, q, gainValue, pan, decay = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const out = this._chain(gainValue, pan);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur * decay);
    src.connect(filt); filt.connect(env); env.connect(out);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
    return { filt, env };
  }

  tone(freq, dur, type, gainValue, pan, sweepTo) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), ctx.currentTime + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gainValue, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    const out = this._chain(1, pan);
    osc.connect(env); env.connect(out);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  // ------------------------------------------------------------- game SFX
  gunshot(cls, x, z, own) {
    if (!this.ctx) return;
    const { gain, pan, dist } = own ? { gain: 1, pan: 0, dist: 0 } : this._spatialGain(x, z, 130);
    if (gain <= 0.01) return;
    const profile = {
      sniper: { f: 900, d: 0.5, body: 70, g: 1.0 },
      lmg: { f: 1500, d: 0.26, body: 95, g: 0.85 },
      assault: { f: 1900, d: 0.19, body: 120, g: 0.75 },
      smg: { f: 2600, d: 0.13, body: 160, g: 0.6 },
      shotgun: { f: 800, d: 0.36, body: 60, g: 1.0 },
      pistol: { f: 2300, d: 0.15, body: 150, g: 0.55 },
      launcher: { f: 500, d: 0.6, body: 50, g: 1.0 },
    }[cls] || { f: 1900, d: 0.2, body: 120, g: 0.75 };

    const v = gain * profile.g * (own ? 0.85 : 1);
    this.noise(profile.d, 'bandpass', profile.f * (own ? 1 : 0.7), 1.2, v * 0.9, pan);
    this.tone(profile.body, profile.d * 0.8, 'triangle', v * 0.5, pan, profile.body * 0.4);
    if (!own && dist > 25) {
      // distant crack: a longer, darker tail
      setTimeout(() => {
        if (!this.ctx) return;
        this.noise(0.5, 'lowpass', 700, 0.7, v * 0.5, pan, 1.4);
      }, Math.min(400, dist * 2.6));
    }
  }

  impact(x, z) {
    if (!this.ctx) return;
    const { gain, pan } = this._spatialGain(x, z, 45);
    if (gain <= 0.02) return;
    this.noise(0.1, 'highpass', 2400, 1, gain * 0.5, pan);
  }

  hitmarker(kill) {
    if (!this.ctx) return;
    this.tone(kill ? 880 : 1500, 0.09, 'square', 0.22, 0);
    if (kill) setTimeout(() => this.tone(660, 0.12, 'square', 0.18, 0), 70);
  }

  hurt() {
    if (!this.ctx) return;
    this.noise(0.18, 'lowpass', 420, 0.8, 0.5, 0);
    this.tone(120, 0.24, 'sine', 0.3, 0, 70);
  }

  explosion(x, z) {
    if (!this.ctx) return;
    const { gain, pan } = this._spatialGain(x, z, 140);
    if (gain <= 0.01) return;
    this.noise(1.1, 'lowpass', 340, 0.6, gain * 1.2, pan, 1.5);
    this.tone(60, 0.9, 'sine', gain * 0.8, pan, 26);
  }

  reload(stage) {
    if (!this.ctx) return;
    if (stage === 'out') this.noise(0.07, 'bandpass', 2600, 3, 0.25, 0);
    else if (stage === 'in') this.noise(0.09, 'bandpass', 1500, 3, 0.3, 0);
    else this.noise(0.06, 'bandpass', 3200, 4, 0.22, 0);
  }

  footstep(speed, crouch) {
    if (!this.ctx) return;
    this.noise(0.09, 'bandpass', 380 + Math.random() * 260, 1.4, crouch ? 0.05 : 0.14 * Math.min(1, speed / 6), 0);
  }

  flashbang() {
    if (!this.ctx) return;
    this.noise(2.4, 'bandpass', 4200, 12, 0.35, 0, 2.2);
    this.tone(3400, 2.6, 'sine', 0.12, 0, 2600);
  }

  uiClick() { if (this.ctx) this.tone(620, 0.05, 'square', 0.08, 0); }
  uiConfirm() { if (this.ctx) { this.tone(520, 0.08, 'square', 0.1, 0); setTimeout(() => this.tone(780, 0.1, 'square', 0.1, 0), 70); } }

  announce(kind) {
    if (!this.ctx) return;
    const seq = {
      victory: [523, 659, 784, 1046],
      defeat: [392, 330, 262],
      roundwin: [659, 880],
      roundloss: [392, 294],
      capture: [523, 784],
      streak: [700, 900, 1200],
    }[kind] || [600];
    seq.forEach((f, i) => setTimeout(() => this.tone(f, 0.28, 'triangle', 0.16, 0), i * 150));
  }

  setListener(x, y, z, yaw) {
    this.listenerPos.x = x; this.listenerPos.y = y; this.listenerPos.z = z;
    this.listenerPos.yaw = yaw;
  }
}

export const audio = new AudioEngine();
