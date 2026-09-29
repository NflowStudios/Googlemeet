/**
 * audio.js — Efectos de sonido 100% procedurales con WebAudio (sin assets).
 * Se inicializa en el primer gesto del usuario (política de autoplay).
 */

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noiseBuf = null;
    this._hbTimer = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Buffer de ruido blanco reutilizable (1s)
      const len = this.ctx.sampleRate;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._ambience();
    } catch (e) {
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  _ok() { return this.ctx && !this.muted; }

  _noise(dur, filterType, freq, vol, pan = 0, q = 1) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    src.connect(f); f.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(type, f0, f1, dur, vol, pan = 0) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    o.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- SFX del juego ----------

  step(vol, pan = 0) { this._noise(0.07, 'lowpass', 260 + Math.random() * 160, vol * 0.35, pan); }

  swing() { this._noise(0.14, 'bandpass', 500, 0.22, 0, 2); }

  hitFlesh() {
    this._tone('sine', 95, 55, 0.13, 0.5);
    this._noise(0.09, 'lowpass', 400, 0.3);
  }

  bite() {
    this._noise(0.06, 'bandpass', 900, 0.4, 0, 3);
    this._tone('sawtooth', 220, 90, 0.18, 0.28);
  }

  hurt() {
    this._tone('sawtooth', 180, 70, 0.2, 0.32);
    this._noise(0.12, 'lowpass', 300, 0.3);
  }

  groan(vol, pan) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const dur = 0.7 + Math.random() * 0.7;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 58 + Math.random() * 42;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    // vibrato espeluznante
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 4 + Math.random() * 3;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = base * 0.13;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 340;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.55, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    o.connect(f); f.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.1);
    lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  eat() {
    let d = 0;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this._noise(0.08, 'bandpass', 700 + Math.random() * 500, 0.3, 0, 2), d);
      d += 110;
    }
  }

  drink() { this._noise(0.4, 'lowpass', 500, 0.22); }

  pickup() { this._tone('square', 620, 880, 0.07, 0.14); }

  drop() { this._tone('sine', 160, 90, 0.09, 0.25); }

  door() { this._tone('sawtooth', 150, 85, 0.25, 0.2); this._noise(0.1, 'lowpass', 250, 0.15); }

  // ---------- Armas de fuego (procedurales) ----------

  /** Disparo según el arma: pistola / escopeta / rifle. */
  gunshot(kind) {
    if (kind === 'escopeta') {
      // trueno grave con cola
      this._noise(0.16, 'lowpass', 420, 0.95);
      this._tone('sine', 120, 36, 0.26, 0.85);
      this._noise(0.34, 'lowpass', 150, 0.6);
      this._noise(0.05, 'highpass', 1800, 0.4);
    } else if (kind === 'rifle') {
      // latigazo agudo y seco
      this._noise(0.06, 'highpass', 1400, 0.8);
      this._tone('square', 520, 70, 0.07, 0.5);
      this._noise(0.2, 'lowpass', 240, 0.5);
    } else {
      // pistola: chasquido contenido
      this._noise(0.09, 'highpass', 900, 0.75);
      this._tone('square', 420, 60, 0.08, 0.55);
      this._noise(0.22, 'lowpass', 180, 0.45);
    }
  }

  /** Accionar la corredera de la escopeta tras disparar. */
  pump() {
    this._tone('square', 260, 180, 0.05, 0.18);
    setTimeout(() => this._tone('square', 200, 140, 0.05, 0.2), 110);
    setTimeout(() => this._noise(0.06, 'bandpass', 700, 0.22, 0, 3), 115);
  }

  /** Gatillo en vacío: clic metálico. */
  dryFire() { this._tone('square', 950, 720, 0.035, 0.22); }

  /** Inicio de recarga: clic del cargador saliendo. */
  reloadStart() {
    this._noise(0.06, 'bandpass', 620, 0.3, 0, 3);
    this._tone('square', 300, 220, 0.05, 0.16);
  }

  /** Fin de recarga: cargador entra y corredera acciona. */
  reloadEnd() {
    this._tone('square', 240, 180, 0.06, 0.24);
    setTimeout(() => this._noise(0.07, 'bandpass', 800, 0.35, 0, 3), 90);
    setTimeout(() => this._tone('square', 330, 240, 0.05, 0.2), 130);
  }

  heal() { this._tone('sine', 480, 720, 0.25, 0.16); }

  uiClick() { this._tone('square', 440, 520, 0.05, 0.1); }

  container() { this._noise(0.12, 'lowpass', 350, 0.25); this._tone('sine', 120, 80, 0.1, 0.2); }

  /** Latido cuando la vida es crítica. Llamar cada frame. */
  heartbeat(dt, active) {
    if (!this._ok() || !active) return;
    this._hbTimer -= dt;
    if (this._hbTimer <= 0) {
      this._hbTimer = 0.85;
      this._tone('sine', 52, 40, 0.11, 0.55);
      setTimeout(() => this._tone('sine', 48, 38, 0.1, 0.4), 190);
    }
  }

  _ambience() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 170;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    // oleaje lento del viento
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); lfo.start(t);
  }
}
