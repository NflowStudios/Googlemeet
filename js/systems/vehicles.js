/**
 * vehicles.js — v0.26: LOS COCHES.
 *
 * Cuatro modelos con marca y carácter (Aurora Cierzo 400 · Yaguareté
 * Sierra 4x4 · Bóer Meridiano · Carabela Mula 3000). Cada coche del mapa es
 * un vehículo de verdad: se INSPECCIONA ([Q]: menú con piezas, gasolina y
 * odómetro), se ENTRA ([E]) y se CONDUCE (W/S acelera y frena, A/D gira,
 * L los faros, [E] de nuevo para bajarse).
 *
 *  - PIEZAS: batería (no se gasta: solo ESTAR), bujías, radiador y hasta 4
 *    neumáticos. Sin batería o sin bujías el motor no arranca; sin radiador
 *    se sobrecalienta y el motor se rompe; cada neumático devuelto sube la
 *    velocidad (y sin ellos rechina y va a remolque).
 *  - CHOQUES: un frontal contra un obstáculo (muro, árbol, otro coche…) o
 *    contra una HORDA para el motor: el daño escala con la velocidad y el
 *    auto se DETIENE en seco; si el motor queda tocado, ECHA HUMO… y si
 *    muere, no vuelve a arrancar (el MECÁNICO lo remienda con chatarra).
 *  - ATROPELLOS: a partir de 70 px/s el coche arrolla a los zombis (daño
 *    proporcional a la velocidad), pero cada cuerpo frena un poco el coche
 *    y muerde al motor: una horda entera puede dejarlo clavado.
 *  - RUIDO: cada motor SUENA distinto (radio y voz propios, ver audio.js);
 *    la furgoneta se oye desde lejos — conducir es RÁPIDO pero CANTA.
 *  - COMBUSTIBLE: litros que se beben con la velocidad; se REPOSTA con
 *    BIDONES (8 L) desde la inspección. Las GASOLINERAS (norte, sur y
 *    este) son la fuente.
 *  - CAJUELA: cada coche guarda objetos (6-16 huecos según el modelo) — se
 *    abre desde la inspección; un almacén con ruedas.
 *
 * El coche aparcado son 2 tiles T.CAR sólidos (como siempre); al ENTRAR se
 * des-estampan (el coche pasa a cuerpo dinámico con colisión por círculos
 * delantero/central/trasero) y al BAJARSE se vuelve a estampar, alineado al
 eje más cercano (horizontal o vertical), sobre los tiles que pisaba.
 */

import { VEHICULOS, TILE, T, MAP_W, MAP_H } from '../config.js';
import { countItem } from './inventory.js';

/** Nombre bonito del coche («Aurora Cierzo 400 · Sedán»). */
export function carLabel(car) {
  return car.brand + ' ' + car.name + ' · ' + car.type;
}

/** ¿El motor puede arrancar? (batería + bujías + gasolina + motor vivo). */
export function carCanStart(car) {
  return !!(car.parts.bat && car.parts.buj && car.fuel > 0 && car.engineHp > 0);
}

/** ¿El motor está echando humo? */
export function carSmoking(car) {
  return car.engineHp > 0 && car.engineHp <= VEHICULOS.smokeAt;
}

/** Km del odómetro (los de antes + los que TÚ le has hecho). */
export function carOdometerKm(car) {
  return car.odoBase + car.odoPx / (TILE * 1000);
}

/** Velocidad de pantalla en km/h (1 tile = 1 m). */
export function carSpeedKmh(car) {
  return Math.abs(car.speed || 0) / TILE * 3.6;
}

/** Qué le falta a un coche para arrancar (lista de nombres). */
export function carMissing(car) {
  const miss = [];
  if (!car.parts.bat) miss.push('batería');
  if (!car.parts.buj) miss.push('bujías');
  if (car.fuel <= 0) miss.push('gasolina');
  if (car.engineHp <= 0) miss.push('motor (muerto)');
  return miss;
}

// ================== Estampado de tiles del coche aparcado ==================

/** Des-estampa los 2 tiles de un coche (al ENTRAR: pasa a cuerpo dinámico). */
function unstampCar(map, car) {
  for (const [key, c] of map.carByTile) {
    if (c === car) map.carByTile.delete(key);
  }
  for (const [tx, ty, t] of car.parkTiles || []) {
    if (map.tileAtIdx(tx, ty) === T.CAR) map.setTile(tx, ty, t === undefined ? T.ROAD : t);
  }
  car.parkTiles = null;
}

/**
 * Aparca el coche: alinea el centro al eje más cercano (horizontal o
 * vertical), elige los 2 tiles bajo el eje y los estampa como T.CAR
 * (guardando el suelo que había debajo para restaurarlo al volver a
 * entrar). Si los tiles no son aparcables (raro: el coche quedó incrustado
 * en algo), busca el par de tiles libres más cercano.
 */
function stampCar(map, car) {
  const horiz = Math.abs(Math.cos(car.dir)) >= Math.abs(Math.sin(car.dir));
  // orientación y centro alineados a la retícula
  let tx, ty;
  if (horiz) {
    car.horiz = true;
    car.dir = Math.cos(car.dir) >= 0 ? 0 : Math.PI;
    ty = Math.max(1, Math.min(MAP_H - 2, Math.floor(car.y / TILE)));
    car.y = ty * TILE + TILE / 2;
    tx = Math.floor(car.x / TILE);
    car.x = tx * TILE + TILE;   // centrado en la frontera tx / tx+1
  } else {
    car.horiz = false;
    car.dir = Math.sin(car.dir) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    tx = Math.max(1, Math.min(MAP_W - 2, Math.floor(car.x / TILE)));
    car.x = tx * TILE + TILE / 2;
    ty = Math.floor(car.y / TILE);
    car.y = ty * TILE + TILE;
  }
  // candidatos: el par bajo el eje; si no son aparcables, espiral cercana
  const parkable = (t) => t === T.ROAD || t === T.SIDEWALK || t === T.GRASS || t === T.FLOOR;
  let tiles = horiz
    ? [[tx, ty], [tx + 1, ty]]
    : [[tx, ty], [tx, ty + 1]];
  if (tiles.some(([ax, ay]) => !parkable(map.tileAtIdx(ax, ay)))) {
    tiles = null;
    outer:
    for (let r = 1; r <= 4 && !tiles; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ax = tx + dx, ay = ty + dy;
          const pair = horiz ? [[ax, ay], [ax + 1, ay]] : [[ax, ay], [ax, ay + 1]];
          if (pair.every(([px2, py2]) => parkable(map.tileAtIdx(px2, py2)))) {
            tiles = pair;
            car.x = horiz ? ax * TILE + TILE : ax * TILE + TILE / 2;
            car.y = horiz ? ay * TILE + TILE / 2 : ay * TILE + TILE;
            break outer;
          }
        }
      }
    }
  }
  if (!tiles) return false;   // no debería pasar: el coche quedó en tierra de nadie
  car.parkTiles = tiles.map(([ax, ay]) => [ax, ay, map.tileAtIdx(ax, ay)]);
  for (const [ax, ay] of tiles) {
    map.setTile(ax, ay, T.CAR);
    map.carByTile.set(map.idx(ax, ay), car);
  }
  if (car.trunk) { car.trunk.x = car.x; car.trunk.y = car.y; }
  return true;
}

// ================== Entrar / salir ==================

/** Entra al coche y arranca (si puede). true si ok. */
export function enterCar(game, car, silent = false) {
  const p = game.player;
  if (!p || p.inCar || (p.z || 0) !== 0 || p.climb) return false;
  unstampCar(game.map, car);
  car.driven = true;
  car.speed = 0;
  car.running = false;
  p.inCar = car;
  p.sneak = false;
  if (!silent) {
    const miss = carMissing(car);
    if (miss.length) {
      game.toasts.push('El motor no arranca: falta ' + miss.join(' · '), 'warn');
    } else {
      car.running = true;
      game.audio.engineStart();
      game.noise.emit(car.x, car.y, VEHICULOS.models[car.model].noise * VEHICULOS.startNoiseMul, 'motor');
      game.toasts.push('Al volante del ' + car.brand + ' ' + car.name +
        (carSmoking(car) ? ' — el motor ECHA HUMO' : ''), 'info');
    }
    game.toasts.push('W/S acelera y frena · A/D gira · L faros · [E] bajarse', 'info');
  } else if (carCanStart(car)) {
    car.running = true;   // restaurado de guardado: seguía en marcha
  }
  return true;
}

/** Se baja del coche (lo aparca donde esté y suena la puerta). */
export function exitCar(game, silent = false) {
  const p = game.player;
  const car = p && p.inCar;
  if (!car) return false;
  car.speed = 0;
  car.running = false;
  game.audio.setEngine(null);
  stampCar(game.map, car);
  car.driven = false;
  // el jugador aparece al lado (lado izquierdo primero, luego derecho)
  const perp = car.dir + Math.PI / 2;
  const off = (car.horiz === false ? car.w : car.h) / 2 + p.r + 6;
  let px2 = car.x + Math.cos(perp) * off, py2 = car.y + Math.sin(perp) * off;
  if (game.map.circleHitsSolid(px2, py2, p.r)) {
    px2 = car.x - Math.cos(perp) * off;
    py2 = car.y - Math.sin(perp) * off;
  }
  if (game.map.circleHitsSolid(px2, py2, p.r)) {
    px2 = car.x - Math.cos(car.dir) * (car.w / 2 + p.r + 8);
    py2 = car.y - Math.sin(car.dir) * (car.w / 2 + p.r + 8);
  }
  p.x = px2; p.y = py2;
  p.inCar = null;
  if (!silent) {
    game.audio.door();
    game.noise.emit(car.x, car.y, 70, 'puerta');
    game.toasts.push('Bajado del coche — queda aparcado donde lo dejaste');
  }
  return true;
}

// ================== Piezas / repostaje / reparación ==================

/** Instala una pieza del inventario (id) en el coche. true si ok. */
export function installPart(game, car, id) {
  const inv = game.player.inventory;
  if (countItem(inv, id) <= 0) return false;
  let done = false;
  if (id === 'bateria_coche' && !car.parts.bat) { car.parts.bat = true; done = true; }
  else if (id === 'bujias' && !car.parts.buj) { car.parts.buj = true; done = true; }
  else if (id === 'radiador' && !car.parts.rad) { car.parts.rad = true; done = true; }
  else if (id === 'neumatico' && car.parts.tires < 4) { car.parts.tires++; done = true; }
  if (!done) return false;
  // consume 1 del inventario
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (s && s.id === id) {
      s.count--;
      if (s.count <= 0) inv.slots[i] = null;
      break;
    }
  }
  game.audio.hammer();
  game.noise.emit(car.x, car.y, 120, 'herramienta');
  game.toasts.push('Instalado: ' + (id === 'bateria_coche' ? 'batería' : id === 'bujias' ? 'juego de bujías' : id === 'neumatico' ? 'neumático' : 'radiador'), 'save');
  return true;
}

/** Reposta con los bidones de la mochila (8 L por bidón). Litros vertidos. */
export function refuelCar(game, car) {
  const inv = game.player.inventory;
  const md = VEHICULOS.models[car.model];
  let added = 0;
  while (car.fuel < md.fuelCap - 0.01 && countItem(inv, 'bidon_gasolina') > 0) {
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (s && s.id === 'bidon_gasolina') {
        s.count--;
        if (s.count <= 0) inv.slots[i] = null;
        break;
      }
    }
    const take = Math.min(VEHICULOS.fuelPerBidon, md.fuelCap - car.fuel);
    car.fuel += take;
    added += take;
  }
  if (added > 0) {
    game.audio.fuelSlosh();
    game.toasts.push('Repostado: +' + Math.round(added) + ' L (' + Math.round(car.fuel) + '/' + md.fuelCap + ')', 'save');
  } else {
    game.toasts.push(countItem(inv, 'bidon_gasolina') > 0 ? 'El depósito ya está lleno' : 'No llevas bidones de gasolina', 'warn');
  }
  return added;
}

/** v0.26: el MECÁNICO remienda el motor con 4 de chatarra (+60 de vida). */
export function repairEngine(game, car) {
  const p = game.player;
  if (!p || p.prof !== 'mecanico') {
    game.toasts.push('Solo un MECÁNICO sabe remendar un motor', 'warn');
    return false;
  }
  if (car.engineHp >= 100) {
    game.toasts.push('El motor está como nuevo', 'warn');
    return false;
  }
  if (countItem(p.inventory, 'chatarra') < 4) {
    game.toasts.push('Hacen falta 4 de chatarra', 'warn');
    return false;
  }
  const inv = p.inventory;
  let need = 4;
  for (let i = 0; i < inv.slots.length && need > 0; i++) {
    const s = inv.slots[i];
    if (s && s.id === 'chatarra') {
      const take = Math.min(need, s.count);
      s.count -= take; need -= take;
      if (s.count <= 0) inv.slots[i] = null;
    }
  }
  car.engineHp = Math.min(100, car.engineHp + 60);
  car.heat = 0;
  game.audio.hammer();
  game.noise.emit(car.x, car.y, 130, 'herramienta');
  game.toasts.push('Motor remendado: ' + Math.round(car.engineHp) + '/100' +
    (carSmoking(car) ? ' (todavía echa humo)' : ''), 'save');
  return true;
}

// ================== Física de conducción ==================

/**
 * Un frame de coche en marcha. Se llama desde main.update ANTES de
 * player.update (el jugador va "dentro": su posición sigue al coche y su
 * ángulo es la dirección de marcha — así el cono de visión mira por dónde
 * vas).
 */
export function updateVehicle(game, dt) {
  const p = game.player;
  const car = p.inCar;
  if (!car) return;
  const md = VEHICULOS.models[car.model];
  const map = game.map;
  car.speed = car.speed || 0;

  // ---- estado del motor ----
  const wasRunning = car.running;
  const canRun = carCanStart(car);
  if (car.running && !canRun) {
    car.running = false;
    if (car.fuel <= 0) game.toasts.push('Sin gasolina: el motor se apaga…', 'warn');
    else if (car.engineHp <= 0) game.toasts.push('El motor ha MUERTO', 'bad');
  }
  // intento de arranque con W (si está parado y puede)
  const axis = game.input.moveAxis();
  if (!car.running && canRun && axis.y < -0.3 && Math.abs(car.speed) < 12) {
    car.running = true;
    game.audio.engineStart();
    game.noise.emit(car.x, car.y, md.noise * VEHICULOS.startNoiseMul, 'motor');
    game.toasts.push('Motor en marcha', 'info');
  }

  // ---- aceleración / freno / reversa ----
  const throttle = -axis.y;   // W = +1 adelante · S = -1 frena/luego atrás
  if (car.running) {
    car.speed += throttle * md.accel * dt;
  }
  // resistencia a la rodadura: pequeña con el pie puesto (el tope de cada
  // modelo manda) y TRIPLE al soltar (freno de motor + rozamiento: el coche
  // solo no se frena en seco, pero tampoco corre solo). Sin neumáticos
  // completos, las llantas rechinan y frenan el doble.
  const roll = (car.parts.tires >= 3 ? 0.32 : 0.7) * (Math.abs(throttle) > 0.1 ? 1 : 3);
  car.speed -= car.speed * roll * dt;
  if (Math.abs(car.speed) < 2 && throttle === 0) car.speed = 0;

  // terreno bajo el coche (asfalto pleno; hierba según modelo)
  const t = map.tileAt(car.x, car.y);
  const terr = t === T.ROAD ? 1 : t === T.SIDEWALK ? 0.92 : t === T.FLOOR ? 0.8 : md.offroad;
  const vmax = md.top * VEHICULOS.tireMul[Math.max(0, Math.min(4, car.parts.tires))] * terr;
  car.speed = Math.max(-vmax * 0.4, Math.min(vmax, car.speed));

  // ---- giro (gira mejor con velocidad; en reversa invierte) ----
  if (Math.abs(car.speed) > 6) {
    const sgn = car.speed >= 0 ? 1 : -1;
    const grip = Math.min(1, Math.abs(car.speed) / 130);
    car.dir += axis.x * md.turn * dt * sgn * grip;
  }

  // ---- movimiento + colisión (3 círculos: morro, centro, cola) ----
  const cos = Math.cos(car.dir), sin = Math.sin(car.dir);
  const nx = car.x + cos * car.speed * dt;
  const ny = car.y + sin * car.speed * dt;
  const r = car.h / 2 - 2;
  // puntos de sondeo a lo largo del eje del coche (morro/centro/cola)
  const probe = (off) => map.circleHitsSolid(nx + cos * off, ny + sin * off, r);
  const blocked = probe(md.w * 0.34) || probe(0) || probe(-md.w * 0.34);

  if (blocked) {
    const impact = Math.abs(car.speed);
    if (impact >= VEHICULOS.crashMin) {
      // CHOQUE FRONTAL: el motor recibe el impacto directo
      const dmg = (impact - 100) * 0.09 * md.crashMul;
      const wasSmoking = carSmoking(car);
      car.engineHp = Math.max(0, car.engineHp - dmg);
      game.cam.shake(4 + impact / 45);
      game.audio.crash();
      game.noise.emit(car.x, car.y, 300, 'choque');
      if (impact > 250) {
        const whip = (impact - 250) * 0.06;
        game.survival.health = Math.max(0, game.survival.health - whip);
        p.hurtFlash = 0.4;
        game.hud.flashDamage(whip);
      }
      if (car.engineHp <= 0) game.toasts.push('¡CHOQUE! El motor ha MUERTO', 'bad');
      else if (!wasSmoking && carSmoking(car)) game.toasts.push('¡CHOQUE! El motor empieza a ECHAR HUMO', 'warn');
      else game.toasts.push('¡Choque frontal! (' + Math.round(carSpeedKmh(car)) + ' km/h)', 'warn');
    } else if (impact > 30) {
      game.audio.hitWood();
      game.noise.emit(car.x, car.y, 110, 'golpe');
    }
    car.speed = 0;   // el auto se detiene
  } else {
    car.x = nx; car.y = ny;
    car.odoPx += Math.abs(car.speed) * dt;
    if (game.stats) game.stats.dist += Math.abs(car.speed) * dt;   // el odómetro del obituario también rueda
  }

  // ---- combustible ----
  if (car.running) {
    car.fuel = Math.max(0, car.fuel - md.fuelRate * (0.25 + 0.75 * Math.abs(car.speed) / md.top) * dt);
    if (car.fuel <= 0) {
      car.running = false;
      game.toasts.push('Se acabó la gasolina…', 'warn');
    }
  }

  // ---- temperatura (sin radiador se sobrecalienta y rompe el motor) ----
  const sf = 0.3 + 0.7 * Math.min(1, Math.abs(car.speed) / md.top);
  car.heat += ((car.parts.rad ? 1.6 : 5.5) * sf - (car.parts.rad ? 2.6 : 0.8)) * dt;
  car.heat = Math.max(0, Math.min(100, car.heat));
  if (car.heat >= 100 && car.engineHp > 0) {
    const wasSmoking = carSmoking(car);
    car.engineHp = Math.max(0, car.engineHp - 4.5 * dt);
    if (!car._heatWarn) { car._heatWarn = true; game.toasts.push('¡MOTOR SOBRECALENTADO! Para y déjalo enfriar (o monta un radiador)', 'bad'); }
    if (!wasSmoking && carSmoking(car)) game.toasts.push('El motor empieza a ECHAR HUMO', 'warn');
    if (car.engineHp <= 0) { game.toasts.push('El motor ha MUERTO de calor', 'bad'); car.running = false; }
  } else if (car.heat < 70) {
    car._heatWarn = false;
  }
  if (car.engineHp <= 0) car.running = false;

  // ---- atropellos ----
  if (Math.abs(car.speed) >= VEHICULOS.roadkillMin) {
    for (let i = game.zombies.length - 1; i >= 0; i--) {
      const z = game.zombies[i];
      if ((z.z || 0) !== 0) continue;
      const dx = z.x - car.x, dy = z.y - car.y;
      const along = dx * cos + dy * sin;
      const perp = -dx * sin + dy * cos;
      if (Math.abs(perp) > car.h / 2 + z.r - 2) continue;
      if (along < -car.w / 2 || along > car.w / 2 + Math.abs(car.speed) * dt + 14) continue;
      if (z._carHitT && game.time - z._carHitT < 0.4) continue;
      z._carHitT = game.time;
      // golpe de parachoques: daño proporcional a la velocidad
      const dmg = Math.max(35, Math.abs(car.speed) * 0.5);
      z.hp -= dmg;
      z.hurtFlash = 0.3;
      game.audio.hitFlesh();
      game.audio.groan(0.8, 0, z.groanPitch);
      game.map.stampBlood(z.x, z.y, false);
      // el cuerpo frena el coche… y el motor lo nota
      car.speed *= 0.88;
      car.engineHp = Math.max(0, car.engineHp - Math.min(6, Math.abs(car.speed) * 0.012));
      if (z.hp <= 0) game.killZombie(z);
    }
  }

  // ---- ruido del motor (cada motor suena distinto: radio propio) ----
  car._noiseT = (car._noiseT || 0) + dt;
  if (car.running && car._noiseT >= 0.45) {
    car._noiseT = 0;
    game.noise.emit(car.x, car.y, md.noise * (0.75 + 0.25 * Math.abs(car.speed) / md.top), 'motor');
  }
  // humo del motor
  if (carSmoking(car) || car.heat >= 95) {
    car._smokeT = (car._smokeT || 0) + dt;
    const heavy = car.engineHp <= 12;
    if (car._smokeT >= (heavy ? 0.12 : 0.28)) {
      car._smokeT = 0;
      const fx = car.x + cos * (car.w * 0.42) + (Math.random() - 0.5) * 8;
      const fy = car.y + sin * (car.w * 0.42) + (Math.random() - 0.5) * 8;
      game.smokes.push({ x: fx, y: fy, t: 0, life: heavy ? 1.6 : 1.1, r: 4 + Math.random() * 4 });
    }
  }

  // ---- audio continuo del motor ----
  game.audio.setEngine(car.running ? car.model : null,
    Math.min(1, 0.25 + 0.75 * Math.abs(car.speed) / md.top));

  // ---- el jugador va DENTRO: posición/ángulo siguen al coche ----
  p.x = car.x; p.y = car.y;
  p.angle = car.dir;
  p.moving = Math.abs(car.speed) > 12;
  p.running = false;
  p.vx = cos * car.speed; p.vy = sin * car.speed;
}

// ================== Faros ==================

/** ¿Los faros alumbran ahora? (encendidos + mala luz). */
export function headlightsActive(game) {
  const p = game.player;
  const car = p && p.inCar;
  if (!car || !car.lights) return false;
  const dn = game.daynight, wx = game.weather;
  if (dn && dn.darkness > 0.25) return true;
  if (wx && wx.type !== 'clear' && wx.intensity > 0.3) return true;
  return false;
}

/** Multiplicador de alcance de visión por los faros (1 si no alumbran). */
export function headlightRangeMul(game) {
  return headlightsActive(game) ? 1.24 : 1;
}

// ================== Bajarse a la fuerza (muerte / menú) ==================

/** Saca al jugador del coche sin ruido (menú, muerte, guardado a medias). */
export function forceExit(game) {
  const p = game.player;
  if (!p || !p.inCar) return;
  exitCar(game, true);
}

// ================== Dibujo ==================

/**
 * El coche EN MARCHA (rotación libre) + humo del motor + faros. Se dibuja
 * por ENCIMA de la niebla (como los coches aparcados redibujados) para que
 * el vehículo propio siempre se vea nítido, con la cabeza del conductor
 * asomando y las dos cuñas de luz de los faros cuando están encendidos.
 */
export function drawVehicles(ctx, cam, game) {
  const p = game.player;
  const car = p && p.inCar;
  // humo del motor (parcidas y en marcha: las partículas viven en game.smokes)
  if (game.smokes && game.smokes.length) {
    for (let i = game.smokes.length - 1; i >= 0; i--) {
      const s = game.smokes[i];
      const k = s.t / s.life;
      const sx = s.x - cam.x + cam.offX, sy = s.y - cam.y + cam.offY;
      ctx.fillStyle = `rgba(70,72,74,${(0.4 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy - k * 14, s.r + k * 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!car) return;
  const sx = car.x - cam.x + cam.offX;
  const sy = car.y - cam.y + cam.offY;

  // faros: dos cuñas cálidas delante del coche (solo de noche/feo tiempo)
  if (headlightsActive(game)) {
    const L = 240;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const ox = Math.cos(car.dir) * (car.w * 0.42) + Math.cos(car.dir + Math.PI / 2) * side * (car.h * 0.3);
      const oy = Math.sin(car.dir) * (car.w * 0.42) + Math.sin(car.dir + Math.PI / 2) * side * (car.h * 0.3);
      const g = ctx.createRadialGradient(sx + ox, sy + oy, 4, sx + ox, sy + oy, L);
      g.addColorStop(0, 'rgba(255, 240, 190, 0.34)');
      g.addColorStop(1, 'rgba(255, 230, 170, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx + ox, sy + oy);
      ctx.arc(sx + ox, sy + oy, L, car.dir - 0.5, car.dir + 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // carrocería con rotación libre (arte compartido del mapa)
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(car.dir);
  game.map._drawCarArt(ctx, -car.w / 2, -car.h / 2, car);
  ctx.restore();

  // conductor asomando (cabeza + manos al volante)
  ctx.fillStyle = '#c9a27a';
  ctx.beginPath();
  ctx.arc(sx + Math.cos(car.dir) * 4, sy + Math.sin(car.dir) * 4, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // velocímetro sutil junto al coche cuando corre
  if (Math.abs(car.speed) > 30) {
    ctx.fillStyle = 'rgba(216,213,204,0.65)';
    ctx.font = 'bold 11px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(carSpeedKmh(car)) + ' km/h', sx, sy - car.h / 2 - 10);
  }
}

/** Actualiza las partículas de humo (llamar desde main.update). */
export function updateVehicleFX(game, dt) {
  if (!game.smokes) return;
  for (let i = game.smokes.length - 1; i >= 0; i--) {
    const s = game.smokes[i];
    s.t += dt;
    if (s.t >= s.life) game.smokes.splice(i, 1);
  }
}

// ================== Serialización (save.js v5) ==================

/** Estado persistente de los coches (compacto). */
export function vehiclesToData(game, reg) {
  return game.map.cars.map((car, i) => ({
    i,
    x: +car.x.toFixed(1), y: +car.y.toFixed(1),
    f: +car.fuel.toFixed(1), hp: +car.engineHp.toFixed(1),
    o: Math.round(car.odoPx), h: Math.round(car.heat),
    p: [car.parts.bat ? 1 : 0, car.parts.buj ? 1 : 0, car.parts.rad ? 1 : 0, car.parts.tires],
    hz: car.horiz === false ? 0 : 1,
    d: +car.dir.toFixed(3),
    dr: car.driven ? 1 : 0,
    it: car.trunk ? car.trunk.items.map(reg) : undefined,
    s: car.trunk && car.trunk.searched ? 1 : 0,
  }));
}

/** Aplica el bloque `veh` del guardado sobre el mapa regenerado. */
export function applyVehicles(game, data, get) {
  if (!Array.isArray(data)) return;
  for (const v of data) {
    const car = game.map.cars[v.i];
    if (!car) continue;
    // soltar los tiles de la posición GENERADA y mover al sitio guardado
    unstampCar(game.map, car);
    car.x = v.x; car.y = v.y;
    car.fuel = v.f || 0;
    car.engineHp = v.hp !== undefined ? v.hp : 100;
    car.odoPx = v.o || 0;
    car.heat = v.h || 0;
    if (v.p) {
      car.parts.bat = !!v.p[0];
      car.parts.buj = !!v.p[1];
      car.parts.rad = !!v.p[2];
      car.parts.tires = v.p[3] | 0;
    }
    car.horiz = v.hz === 0 ? false : true;
    car.dir = v.d || 0;
    if (car.trunk) {
      if (v.it) car.trunk.items = v.it.map(get).filter(Boolean);
      car.trunk.searched = !!v.s;
      car.trunk.x = car.x; car.trunk.y = car.y;
    }
    if (v.dr) {
      // se guardó CONDUCIENDO: queda en marcha como cuerpo dinámico
      car.driven = true;
      car.speed = 0;
    } else {
      stampCar(game.map, car);
    }
  }
}

// ================== Menú de INSPECCIÓN ([Q]) ==================

/**
 * Abre la ficha del coche: estado general del vehículo — piezas puestas y
 * faltantes, nivel de gasolina, motor, odómetro y acciones (entrar,
 * repostar, instalar piezas, abrir la cajuela, reparar el motor si eres
 * MECÁNICO). El DOM vive en index.html (#carscreen) y se rellena aquí.
 */
export function openInspect(game, car) {
  const el = document.getElementById('carscreen');
  if (!el) return;
  game.carsUI = car;
  game.uiOpen = true;
  game.input.enabled = false;
  renderInspect(game, car);
  el.classList.remove('hidden');
}

export function closeInspect(game) {
  const el = document.getElementById('carscreen');
  if (el) el.classList.add('hidden');
  if (!game.carsUI) return;
  game.carsUI = null;
  game.uiOpen = false;
  game.input.enabled = true;
}

function renderInspect(game, car) {
  const md = VEHICULOS.models[car.model];
  const inv = game.player.inventory;
  const el = document.getElementById('carscreen');
  const box = el.querySelector('.car-panel');
  const miss = carMissing(car);
  const engineTxt = car.engineHp <= 0 ? 'MUERTO' : carSmoking(car) ? 'ECHA HUMO' : 'SANO';
  const engineCls = car.engineHp <= 0 ? 'bad' : carSmoking(car) ? 'warn' : 'ok';
  const fuelPct = Math.round(car.fuel / md.fuelCap * 100);

  const partRow = (label, icon, ok, extra, itemId, have) => {
    const installable = itemId && !ok && have > 0;
    return `<div class="car-part ${ok ? 'ok' : 'miss'}">
      <span class="cp-ico">${icon}</span>
      <span class="cp-name">${label}</span>
      <span class="cp-state">${ok ? 'MONTADA' : 'FALTA'}${extra || ''}</span>
      ${installable ? `<button data-act="install" data-part="${itemId}">INSTALAR (${have})</button>` : ''}
    </div>`;
  };
  const bidones = countItem(inv, 'bidon_gasolina');
  const chatarra = countItem(inv, 'chatarra');

  box.innerHTML = `
    <header>
      <div class="car-head-txt">
        <h2>${car.brand.toUpperCase()} ${car.name.toUpperCase()}</h2>
        <span>${car.type} — estado general del vehículo</span>
      </div>
      <button id="btn-car-close">VOLVER (ESC)</button>
    </header>
    <div class="car-body">
      <section class="car-col">
        <h3>MOTOR</h3>
        <div class="car-kv"><span>Estado</span><b class="${engineCls}">${engineTxt} · ${Math.round(car.engineHp)}/100</b></div>
        <div class="car-kv"><span>Temperatura</span><b>${car.heat >= 80 ? 'AL ROJO' : car.heat >= 50 ? 'TEMPLADO' : 'FRÍO'} · ${Math.round(car.heat)}%</b></div>
        <div class="car-kv"><span>Arranca</span><b class="${miss.length ? 'warn' : 'ok'}">${miss.length ? 'NO — falta ' + miss.join(' · ') : 'SÍ'}</b></div>
        <h3 style="margin-top:14px">GASOLINA</h3>
        <div class="car-fuel"><div class="fill" style="width:${fuelPct}%"></div></div>
        <div class="car-kv"><span>Depósito</span><b>${Math.round(car.fuel)} / ${md.fuelCap} L</b></div>
        <button class="car-act" data-act="refuel">REPOSTAR — bidones: ${bidones} (+${VEHICULOS.fuelPerBidon} L c/u)</button>
        <div class="car-kv"><span>Odómetro</span><b>${Math.round(carOdometerKm(car)).toLocaleString('es')} km</b></div>
        <div class="car-kv"><span>Faros</span><b>${car.lights ? 'ENCENDIDOS' : 'APAGADOS'} (L dentro)</b></div>
      </section>
      <section class="car-col">
        <h3>PIEZAS</h3>
        ${partRow('Batería de coche', ' BAT', car.parts.bat, '', 'bateria_coche', countItem(inv, 'bateria_coche'))}
        ${partRow('Juego de bujías', ' BUJ', car.parts.buj, '', 'bujias', countItem(inv, 'bujias'))}
        ${partRow('Neumáticos', ' NEU', car.parts.tires >= 4, ' — ' + car.parts.tires + '/4', 'neumatico', countItem(inv, 'neumatico'))}
        ${partRow('Radiador', ' RAD', car.parts.rad, '', 'radiador', countItem(inv, 'radiador'))}
        <h3 style="margin-top:14px">CAJUELA (${md.storage} huecos)</h3>
        <button class="car-act" data-act="trunk">ABRIR LA CAJUELA</button>
        <h3 style="margin-top:14px">REPARACIÓN</h3>
        <button class="car-act" data-act="repair" ${game.player.prof === 'mecanico' ? '' : 'disabled title="Solo la profesión MECÁNICO"'}>
          MECÁNICO: REMENDAR MOTOR (4 chatarra — llevas ${chatarra})
        </button>
        <p class="car-note">El MECÁNICO craftea las piezas con chatarra en la pestaña CRAFTEO; las gasolineras (norte, sur y este) venden… bueno, REGALAN lo que quede.</p>
      </section>
    </div>
    <div class="car-actions">
      <button id="btn-car-drive" ${miss.length ? 'disabled title="Faltan piezas o gasolina"' : ''}>${miss.length ? 'NO ARRANCA' : 'ENTRAR Y CONDUCIR'}</button>
    </div>
  `;

  // botones
  box.querySelector('#btn-car-close').addEventListener('click', () => closeInspect(game));
  box.querySelector('#btn-car-drive').addEventListener('click', () => {
    closeInspect(game);
    enterCar(game, car);
  });
  for (const b of box.querySelectorAll('button[data-act]')) {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'install') installPart(game, car, b.dataset.part);
      else if (act === 'refuel') refuelCar(game, car);
      else if (act === 'repair') repairEngine(game, car);
      else if (act === 'trunk') {
        closeInspect(game);
        car.trunk.x = car.x; car.trunk.y = car.y;
        if (!car.trunk.searched) { car.trunk.searched = true; game.searchedCount++; }
        game.invUI.openUI(car.trunk);
        return;
      }
      renderInspect(game, car);   // refresca la ficha tras la acción
    });
  }
}
