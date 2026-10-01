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
    this._rainSrc = null;    // v0.15: bucle de lluvia (ruido filtrado)
    this._rainGain = null;
    this._rainLevel = 0;     // último nivel pedido (para truenos)
    this._thunderT = 20;     // v0.15: cuenta atrás del próximo trueno lejano
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

  /** Gemido de zombi. v0.14: `pitch` adapta el tono a la variante
   *  (corredor = chillido agudo, bruto = retumbar grave). */
  groan(vol, pan, pitch = 1) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    const dur = (0.7 + Math.random() * 0.7) * (pitch < 1 ? 1.25 : 1);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const base = (58 + Math.random() * 42) * pitch;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    // vibrato espeluznante
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 4 + Math.random() * 3;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = base * 0.13;
    lfo.connect(lfoG); lfoG.connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = pitch > 1 ? 460 : pitch < 1 ? 240 : 340;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.55 * (pitch < 1 ? 1.15 : 1), t + 0.18);
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

  /** Disparo según el arma: pistola / escopeta / rifle / revólver /
   *  cerrojo / subfusil (v0.16). */
  gunshot(kind) {
    if (kind === 'revolver') {
      // v0.16 — magnum: trueno Graves, cola larga y metálica
      this._noise(0.14, 'lowpass', 520, 0.9);
      this._tone('square', 300, 42, 0.16, 0.75);
      this._noise(0.3, 'lowpass', 160, 0.55);
      this._noise(0.05, 'highpass', 1500, 0.5);
    } else if (kind === 'cerrojo') {
      // v0.16 — cerrojo .308: latigazo seco y profundo con eco
      this._noise(0.08, 'highpass', 1000, 0.85);
      this._tone('sine', 95, 30, 0.3, 0.9);
      this._noise(0.34, 'lowpass', 130, 0.6);
    } else if (kind === 'subfusil') {
      // v0.16 — subfusil: chasquido corto y contenido (ráfagas)
      this._noise(0.05, 'highpass', 1100, 0.55);
      this._tone('square', 480, 90, 0.05, 0.38);
      this._noise(0.1, 'lowpass', 260, 0.3);
    } else if (kind === 'escopeta') {
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

  /** v0.16: accionar el cerrojo del rifle de caza tras disparar. */
  boltCycle() {
    this._tone('square', 340, 250, 0.05, 0.2);
    setTimeout(() => this._noise(0.06, 'bandpass', 540, 0.25, 0, 3), 130);
    setTimeout(() => this._tone('square', 260, 190, 0.05, 0.22), 210);
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

  // ---------- Clima (v0.15) ----------

  /**
   * Ambiente de lluvia: bucle de ruido filtrado cuyo volumen sigue la
   * intensidad del frente (0 = silencio). Llamar cada frame jugando.
   * Con nivel alto, de vez en cuando ruge un trueno LEJANO (grave y suave:
   * acompaña, no asusta).
   */
  setRain(level, dt = 0) {
    if (!this.ctx || !this.master) return;
    this._ensureRain();
    this._rainLevel = level;
    if (this._rainGain) {
      const t = this.ctx.currentTime;
      this._rainGain.gain.cancelScheduledValues(t);
      this._rainGain.gain.setTargetAtTime(0.16 * level, t, 0.6);   // sube/baja suave
    }
    // truenos lejanos: solo con lluvia establecida (cada 22-60 s)
    if (level > 0.45 && dt > 0) {
      this._thunderT -= dt;
      if (this._thunderT <= 0) {
        this._thunderT = 22 + Math.random() * 38;
        this._thunder(0.3 + Math.random() * 0.2 * level);
      }
    } else if (level <= 0.05) {
      this._thunderT = Math.max(this._thunderT, 8);   // nada de truenos residuales
    }
  }

  /** Retumbo grave y lejano: dos capas de ruido con cola larga. */
  _thunder(vol) {
    this._noise(1.6, 'lowpass', 110, vol * 0.5);
    this._tone('sine', 54, 27, 1.3, vol * 0.4);
    setTimeout(() => this._noise(0.9, 'lowpass', 90, vol * 0.3), 260);
  }

  /** Crea (una sola vez) el bucle de lluvia: ruido blanco → pasa-banda. */
  _ensureRain() {
    if (this._rainSrc || !this.ctx) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1500;
      f.Q.value = 0.45;
      // el agua cae con vaivén: modulación lenta del filtro
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoG = this.ctx.createGain();
      lfoG.gain.value = 320;
      lfo.connect(lfoG); lfoG.connect(f.frequency);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(); lfo.start();
      this._rainSrc = src;
      this._rainGain = g;
    } catch (e) {
      this._rainSrc = null;
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
