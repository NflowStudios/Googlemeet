/**
 * weather.js — Clima dinámico (v0.15): lluvia y neblina.
 *
 * Un frente climático llega cada 2-5 DÍAS de juego y dura entre medio día
 * y un día completo (12-24 h de juego, aleatorio — ver WEATHER en config.js).
 * Llega y se marcha con una rampa suave (~1 h de juego) para que el cambio
 * no sea un portazo: la intensidad pasa por smoothstep en la entrada y en
 * la salida, y de ella cuelgan todos los efectos.
 *
 *  - LLUVIA  · enmascara el sonido: el radio de TODOS los ruidos (pasos,
 *    disparos, puertas…) se contrae un 25% a plena intensidad → moverse y
 *    disparar bajo la lluvia atrae a menos zombis. La visibilidad baja
 *    solo un poco (−12%). Bono táctico de sigilo con un coste visual menor.
 *  - NEBLINA · reduce la visibilidad a la MITAD (cono de 440 → 220 px) y
 *    también el alcance con el que los zombis ven/huelen al jugador
 *    (112 → 56 px a plena intensidad): todos van a tientas. Ves menos, pero
 *    también te ven menos.
 *
 * El reloj del clima solo avanza JUGANDO (pausa/menú/inventario lo congelan,
 * igual que el ciclo día/noche) y su estado entero viaja en el guardado
 * (bloque `wx` de save.js). Usa Math.random — NO consume el Rng con semilla
 * de la partida, para no perturbar la determinista generación del mapa/horda.
 */

import { WEATHER, DAYNIGHT } from '../config.js';

const _smooth = (k) => k * k * (3 - 2 * k);   // smoothstep 0..1

export class Weather {
  constructor() {
    this.t = 0;                 // segundos de juego transcurridos (escala de daynight.t)
    this.active = null;         // { type:'rain'|'fog', dur, elapsed } en horas de juego
    this.nextGap = this._rollGap();   // horas de juego hasta el próximo frente
  }

  /** Nueva partida: cielo despejado y primer frente a 2-5 días. */
  reset() {
    this.t = 0;
    this.active = null;
    this.nextGap = this._rollGap();
  }

  /** Horas de juego hasta el próximo frente: 2-5 días (48-120 h). */
  _rollGap() {
    const [a, b] = WEATHER.gapDays;
    return (a + Math.random() * (b - a)) * 24;
  }

  /** Duración de un frente: medio día a un día de juego (12-24 h). */
  _rollDur() {
    const [a, b] = WEATHER.durHours;
    return a + Math.random() * (b - a);
  }

  /**
   * Avanza el clima. `dt` en segundos REALES de partida (misma escala que
   * DayNight.update: 1 h de juego = 30 s reales). Solo se llama jugando.
   */
  update(dt) {
    this.t += dt;
    const h = (dt * 24) / DAYNIGHT.cycleSec;    // horas de juego avanzadas ahora

    if (this.active) {
      this.active.elapsed += h;
      if (this.active.elapsed >= this.active.dur) {
        // el frente se disipa: programa el siguiente a 2-5 días
        this.active = null;
        this.nextGap = this._rollGap();
      }
      return;
    }

    this.nextGap -= h;
    if (this.nextGap <= 0) {
      this.active = {
        type: Math.random() < WEATHER.rainChance ? 'rain' : 'fog',
        dur: this._rollDur(),
        elapsed: 0,
      };
    }
  }

  /** 'clear' | 'rain' | 'fog'. */
  get type() {
    return this.active ? this.active.type : 'clear';
  }

  /**
   * Intensidad del frente activo (0..1) con rampas suaves de ~1 h de juego
   * en la entrada y en la salida. Con cielo despejado, 0.
   */
  get intensity() {
    if (!this.active) return 0;
    const r = WEATHER.rampHours;
    const inK = Math.min(1, this.active.elapsed / r);
    const outK = Math.min(1, (this.active.dur - this.active.elapsed) / r);
    return Math.min(_smooth(inK), _smooth(outK));
  }

  /** Multiplicador del ALCANCE DEL CONO de visión del jugador. */
  visionMul() {
    if (!this.active) return 1;
    const i = this.intensity;
    if (this.active.type === 'fog') return 1 - (1 - WEATHER.fogVisionMul) * i;
    return 1 - (1 - WEATHER.rainVisionMul) * i;
  }

  /** Multiplicador del RADIO de los ruidos (la lluvia los enmascara). */
  noiseMul() {
    if (!this.active || this.active.type !== 'rain') return 1;
    return 1 - (1 - WEATHER.rainNoiseMul) * this.intensity;
  }

  /** Multiplicador del alcance visual (ver/holer) de los ZOMBIS: solo neblina. */
  zombieSightMul() {
    if (!this.active || this.active.type !== 'fog') return 1;
    return 1 - (1 - WEATHER.fogVisionMul) * this.intensity;
  }

  /** Etiqueta para el HUD ('LLUVIA' · 'NEBLINA' · ''). */
  get label() {
    if (!this.active) return '';
    return this.active.type === 'rain' ? 'LLUVIA' : 'NEBLINA';
  }

  // ================== Serialización (guardado v0.15) ==================

  /** Estado completo y compacto (lo que viaja en save.js como bloque `wx`). */
  toData() {
    return {
      t: +this.t.toFixed(1),
      ty: this.active ? this.active.type : null,
      el: this.active ? +this.active.elapsed.toFixed(2) : null,
      du: this.active ? +this.active.dur.toFixed(2) : null,
      nx: +this.nextGap.toFixed(2),
    };
  }

  /** Restaura un bloque `wx` (guardados v0.13/v0.14 sin bloque → reset). */
  load(d) {
    if (!d || typeof d !== 'object') { this.reset(); return; }
    this.t = typeof d.t === 'number' ? d.t : 0;
    if (d.ty === 'rain' || d.ty === 'fog') {
      this.active = {
        type: d.ty,
        dur: Math.max(WEATHER.durHours[0], +d.du || WEATHER.durHours[1]),
        elapsed: Math.max(0, +d.el || 0),
      };
      // frente ya agotado (raro, guardado justo en el último tick): se archiva
      if (this.active.elapsed >= this.active.dur) this.active = null;
    } else {
      this.active = null;
    }
    this.nextGap = (typeof d.nx === 'number' && d.nx > 0)
      ? d.nx
      : this._rollGap();
  }
}
