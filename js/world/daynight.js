/**
 * daynight.js — Ciclo día/noche (v0.11).
 *
 * Un ciclo COMPLETO (día + noche) dura 12 minutos reales y equivale a 24 h
 * de juego: 1 hora del reloj = 30 s reales. La partida empieza a las 08:00
 * del día 1 y el HUD muestra un reloj digital de 12 horas (HH:MM AM/PM) en
 * la esquina superior derecha.
 *
 * La hora solo avanza JUGANDO: pausa, menú e inventario abierto la congelan.
 * La noche (20:00–06:00) oscurece el mundo en dos frentes: la niebla de
 * guerra se vuelve más opaca (vision.js) y un velo azul cubre la pantalla
 * (render.js), con transiciones suaves al anochecer (20→21) y al amanecer
 * (05→06) más un golpe cálido de color en esos tramos.
 *
 * Además, cada hora de la noche el mundo repone zombis SIEMPRE fuera de la
 * línea de visión del jugador (ver Game._nightRespawn en main.js).
 */

import { DAYNIGHT } from '../config.js';

export class DayNight {
  constructor() {
    this.t = 0;              // segundos de juego desde el inicio de la partida
  }

  /** Nueva partida: amanece a las DAYNIGHT.startHour. */
  reset() {
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
  }

  /** Hora del día en coma flotante [0, 24). */
  get hour() {
    return (DAYNIGHT.startHour + (this.t * 24) / DAYNIGHT.cycleSec) % 24;
  }

  /** Número de día transcurrido (1 = primer día). */
  get day() {
    return 1 + Math.floor((DAYNIGHT.startHour + (this.t * 24) / DAYNIGHT.cycleSec) / 24);
  }

  /** ¿Está dentro de la ventana nocturna (20:00–06:00)? */
  get isNight() {
    const h = this.hour;
    return h >= DAYNIGHT.nightStart || h < DAYNIGHT.nightEnd;
  }

  /** 0 = día pleno · 1 = noche cerrada. Transiciones de 1 h al alba/ocaso. */
  get darkness() {
    const h = this.hour;
    const ns = DAYNIGHT.nightStart, ne = DAYNIGHT.nightEnd;
    if (h >= ns + 1 || h < ne - 1) return 1;   // noche cerrada (21:00–05:00)
    if (h >= ne && h < ns) return 0;           // día (06:00–20:00)
    if (h >= ns) return h - ns;                // anochecer 20:00 → 21:00
    return ne - h;                             // amanecer 05:00 → 06:00 (1→0)
  }

  /** Calidez de amanecer/atardecer (0..1, pico a mitad de la transición). */
  get duskGlow() {
    const h = this.hour;
    const ns = DAYNIGHT.nightStart, ne = DAYNIGHT.nightEnd;
    if (h >= ns && h < ns + 1) return Math.sin(Math.PI * (h - ns));
    if (h >= ne - 1 && h < ne) return Math.sin(Math.PI * (h - (ne - 1)));
    return 0;
  }

  /** Opacidad de la niebla de guerra según la hora (día clara, noche opresa). */
  get fogAlpha() {
    return DAYNIGHT.fogDay + (DAYNIGHT.fogNight - DAYNIGHT.fogDay) * this.darkness;
  }

  /** Texto del reloj digital de 12 h: «08:24 AM» · «12:03 PM» · «11:59 PM». */
  get clock() {
    const h24 = Math.floor(this.hour);
    const m = Math.floor((this.hour - h24) * 60);
    const h12 = ((h24 + 11) % 12) + 1;
    const ap = h24 < 12 ? 'AM' : 'PM';
    return String(h12).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' ' + ap;
  }
}
