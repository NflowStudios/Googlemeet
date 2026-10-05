/**
 * flashlight.js — Linterna y pilas (v0.17) + APAGÓN del hospital (v0.18).
 *
 * La LINTERNA se equipa en una ranura de ACCESORIO (o se asigna a las
 * ranuras 4/5 de la barra rápida) y se enciende/apaga con la tecla L.
 * Encendida, extiende el cono de visión según lo MALA que sea la luz
 * ambiental: de noche, con neblina o lluvia, y en INTERIORES (cualquier
 * edificio, 2º piso o sótano). El bono aplicado es el MAYOR de los que
 * corresponda (no se apilan) y escala con la intensidad del frente o la
 * oscuridad de la hora, así que el cono crece y se encoge sin saltos.
 *
 * Las PILAS son su "munición": mientras el haz está encendido la carga
 * interna baja (una pila = FLASH.drainSec segundos de haz); cuando queda
 * por debajo de FLASH.lowAt se cambia SOLA por una pila del inventario
 * (con toast y sonido) y si no te quedan, la linterna se apaga al agotarse.
 * Solo avanza JUGANDO (main.update), como el día/noche y el clima.
 *
 * v0.18 — HOSPITAL EN APAGÓN: dentro del hospital no hay luz eléctrica;
 * hospitalVisionMul() aplica el multiplicador de blackout según la hora
 * (de noche casi ciego sin haz) y el haz lo despeja. Los bonos del hospital
 * SUSTITUYEN a los de calle (no se apilan).
 */

import { FLASH, HOSPITAL } from '../config.js';
import { headlightRangeMul } from './vehicles.js';

/** La linterna equipada (en cualquiera de las tres ranuras de accesorio). */
export function flashlightItem(player) {
  if (!player || !player.equipment) return null;
  for (const s of ['accesorios', 'accesorios2', 'accesorios3']) {
    const a = player.equipment[s];
    if (a && a.def.flashlight) return a;
  }
  return null;
}

/** ¿Cuántas pilas lleva el jugador en la mochila? */
export function countBatteries(player) {
  if (!player || !player.inventory) return 0;
  let n = 0;
  for (const st of player.inventory.slots) {
    if (st && st.def.cat === 'bateria') n += st.count;
  }
  return n;
}

/** ¿Está dentro de una estructura? (edificio, 2º piso, sótano o escalera). */
export function isIndoor(game) {
  const p = game.player;
  if (!p) return false;
  if (p.z) return true;                          // 2º piso o sótano
  if (p.climb) return true;                      // en mitad de la escalera
  return !!game.map.buildingAtPx(p.x, p.y);
}

/** ¿Está dentro del HOSPITAL? (cualquiera de sus dos pisos o su escalera). */
export function isInHospital(game) {
  const p = game.player;
  if (!p || !game.map) return false;
  const b = game.map.buildingAtPx(p.x, p.y);
  return !!(b && b.kind === 'hospital');
}

/** ¿El haz está encendido de verdad? (equipada + ON + con carga). */
export function flashActive(game) {
  const p = game.player;
  if (!p || !p.flashOn) return false;
  const fl = flashlightItem(p);
  return !!(fl && (fl.charge ?? 0) > 0);
}

/**
 * v0.18 — Multiplicador de visión DENTRO DEL HOSPITAL (el APAGÓN):
 *  - de día: la luz de las ventanas (dayMul 0,88);
 *  - de noche SIN haz: blackout (nightMul 0,42);
 *  - con el haz: despeja el apagón (flashDay..flashNight según la hora) y
 *    SUSTITUYE a los bonos de calle de flashRangeMul (no se apilan).
 * Fuera del hospital devuelve 1 (no toca nada).
 */
export function hospitalVisionMul(game) {
  if (!isInHospital(game)) return 1;
  const dark = game.daynight ? game.daynight.darkness : 0;
  if (flashActive(game)) {
    return HOSPITAL.flashDay + (HOSPITAL.flashNight - HOSPITAL.flashDay) * dark;
  }
  return HOSPITAL.dayMul + (HOSPITAL.nightMul - HOSPITAL.dayMul) * dark;
}

/**
 * Multiplicador de ALCANCE del cono con el haz encendido: el MAYOR de los
 * bonos que apliquen (no se apilan) y escalado con la intensidad del frente
 * climático o la oscuridad de la hora para que no haya saltos bruscos.
 */
export function flashRangeMul(game) {
  // v0.26: los FAROS del coche alumbran como un haz ancho y constante
  // (no usan pilas: es luz de coche); no se apilan con la linterna.
  const carMul = headlightRangeMul(game);
  if (!flashActive(game)) return carMul;
  let best = Math.max(FLASH.rangeDay, carMul);
  const dn = game.daynight, wx = game.weather;
  if (dn) {
    // la noche llega por fases: el bono crece con la oscuridad (pleno a 0.6)
    const k = Math.min(1, dn.darkness / 0.6);
    best = Math.max(best, 1 + (FLASH.rangeNight - 1) * k);
  }
  if (wx && wx.type === 'fog') {
    best = Math.max(best, 1 + (FLASH.rangeFog - 1) * wx.intensity);
  }
  if (wx && wx.type === 'rain') {
    best = Math.max(best, 1 + (FLASH.rangeRain - 1) * wx.intensity);
  }
  if (isIndoor(game)) best = Math.max(best, FLASH.rangeIndoor);
  return best;
}

// ================== Encender / apagar (tecla L) ==================

export function toggleFlashlight(game) {
  const p = game.player;
  if (!p) return;
  const fl = flashlightItem(p);
  if (!fl) {
    game.toasts.push('No llevas ninguna linterna', 'warn');
    return;
  }
  if (!p.flashOn) {
    if ((fl.charge ?? 0) <= 0 && countBatteries(p) === 0) {
      game.toasts.push('La linterna está sin carga y no llevas pilas', 'warn');
      return;
    }
    p.flashOn = true;
    fl._lowWarned = false;
    game.audio.flashClick();
    game.toasts.push('Linterna encendida', 'info');
  } else {
    p.flashOn = false;
    game.audio.flashClick();
    game.toasts.push('Linterna apagada', 'info');
  }
}

// ================== Consumo de pilas (solo jugando) ==================

/** Cambia la pila gastada por una nueva del inventario. true si lo logró. */
function _swapBattery(game, p, fl) {
  const inv = p.inventory;
  for (let i = 0; i < inv.slots.length; i++) {
    const st = inv.slots[i];
    if (st && st.def.cat === 'bateria' && st.count > 0) {
      st.count--;
      const left = st.count;
      if (st.count <= 0) inv.slots[i] = null;
      fl.charge = FLASH.cap;
      fl._lowWarned = false;
      game.audio.pickup();
      game.toasts.push('Pila nueva en la linterna' +
        (left > 0 ? ' (te quedan ' + left + ')' : ' (era la última)'), 'save');
      return true;
    }
  }
  return false;
}

/**
 * Avanza la linterna (dt en segundos de partida). Descarga mientras el haz
 * está encendido, cambia la pila al quedar baja y lo apaga si se agota sin
 * repuesto. Se llama desde main.update → se congela en pausa/menú/inventario.
 */
export function updateFlashlight(game, dt) {
  const p = game.player;
  if (!p) return;
  const fl = flashlightItem(p);
  if (!fl) { p.flashOn = false; return; }        // desequipada → nada que hacer
  if (!p.flashOn) return;

  fl.charge = Math.max(0, (fl.charge ?? 0) - (FLASH.cap / FLASH.drainSec) * dt);

  // carga baja: cambia la pila sola (si hay); si no, avisa UNA vez
  if (fl.charge > 0 && fl.charge < FLASH.lowAt) {
    if (countBatteries(p) > 0) { _swapBattery(game, p, fl); return; }
    if (!fl._lowWarned) {
      fl._lowWarned = true;
      game.toasts.push('Linterna con poca carga — no llevas pilas de repuesto', 'warn');
    }
  }

  // agotada del todo: pila de emergencia o se apaga
  if (fl.charge <= 0 && !_swapBattery(game, p, fl)) {
    p.flashOn = false;
    game.toasts.push('La linterna se ha agotado — no te quedan pilas', 'bad');
  }
}
