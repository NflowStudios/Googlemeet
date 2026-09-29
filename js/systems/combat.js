/**
 * combat.js — Combate del jugador: cuerpo a cuerpo, armas de fuego y recarga.
 *
 * Armas de fuego (ranged): el clic DISPARA en la dirección del apuntado.
 * Cada postas (pellet) es un rayo instantáneo (hitscan): la franja de muro y
 * las puertas cerradas detienen la bala (el cristal de las ventanas no).
 * Un disparo hace un RUIDO tremendo: media ciudad vendrá a mirar.
 *
 * Recarga (R): pistola/rifle insertan el cargador más lleno compatible;
 * la escopeta carga cartuchos del inventario directo al tubo. La funda de
 * pistola acelera la recarga del arma correspondiente.
 */

import { ZOMBIE_CFG as Z } from '../config.js';
import { angDiff } from '../utils.js';
import { gunRounds } from './inventory.js';

/** Entrada única del ataque: enruta a melee o a disparo según el arma. */
export function playerAttack(game) {
  const it = game.player.equipment.arma;
  if (it && it.def.ranged) return fireRanged(game);
  return meleeAttack(game);
}

// ================== MELEE ==================

/** El jugador golpea con el arma equipada en un arco frente a él. */
function meleeAttack(game) {
  const p = game.player;
  const w = p.weaponDef();

  if (p.cooldown > 0) return false;
  if (game.survival.stamina < w.stamina) {
    game.toasts.push('Sin energía para golpear', 'warn');
    return false;
  }

  game.survival.stamina -= w.stamina;
  p.cooldown = w.cd;
  p.swingT = p.swingDur;
  game.audio.swing();

  // el golpe hace ruido → atrae zombis
  game.noise.emit(p.x, p.y, w.noise, 'ataque');

  let hits = 0;
  for (const z of game.zombies) {
    const dx = z.x - p.x, dy = z.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > w.range + z.r) continue;
    const a = Math.atan2(dy, dx);
    if (Math.abs(angDiff(p.angle, a)) > 1.05) continue;
    // no golpear a través de muros (la franja delgada tapa el golpe;
    // las ventanas dejan golpear a través del cristal)
    if (!game.map.lineClear(p.x, p.y, z.x, z.y)) continue;

    const dmg = w.dmg * (0.9 + Math.random() * 0.2);
    z.takeDamage(dmg, a, w.kb, game);
    hits++;
    if (z.hp <= 0) game.killZombie(z);
  }

  if (hits > 0) {
    game.audio.hitFlesh();
    game.cam.shake(2.5);
  }
  return true;
}

// ================== ARMAS DE FUEGO ==================

/** El jugador dispara el arma de fuego equipada hacia donde apunta. */
export function fireRanged(game) {
  const p = game.player;
  const gun = p.equipment.arma;
  if (!gun || !gun.def.ranged) return false;
  const w = gun.def;

  if (p.cooldown > 0) return false;
  if (p.reloading) return false;

  const rounds = gunRounds(gun);
  if (rounds <= 0) {
    game.audio.dryFire();
    if (!game._dryToastT || performance.now() - game._dryToastT > 1200) {
      game._dryToastT = performance.now();
      const what = w.magType && !gun.mag ? 'No tiene cargador' : 'Sin munición';
      game.toasts.push(what + ' — pulsa R para recargar', 'warn');
    }
    return false;
  }

  // consumir la bala del cargador o del tubo
  if (w.magType) gun.mag.rounds--;
  else gun.tube--;

  p.cooldown = w.cd;
  p.recoil = Math.min(1, (p.recoil || 0) + (w.auto ? 0.28 : 0.55));

  // boca del cañón
  const bx = p.x + Math.cos(p.angle) * (p.r + w.gunLen * 0.8);
  const by = p.y + Math.sin(p.angle) * (p.r + w.gunLen * 0.8);

  // fogonazo + sonido + ruido (un disparo se oye a muchísima distancia)
  game.flashes.push({ x: bx, y: by, a: p.angle, t: 0.09, life: 0.09, big: w.pellets > 1 });
  game.audio.gunshot(w.sfx);
  if (w.gunClass === 'escopeta') game.audio.pump(); // accionar la corredera
  game.noise.emit(p.x, p.y, w.noise, 'disparo');
  game.cam.shake(w.shake);

  // postas: la escopeta dispara varias con abanico; el resto, una sola
  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    let a = p.angle;
    if (pellets > 1) {
      // abanico simétrico más disperso en los extremos
      const k = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * 2; // -1..1
      a += k * w.spread * 0.8 + (Math.random() - 0.5) * w.spread * 0.4;
    } else {
      a += (Math.random() - 0.5) * w.spread * (1 + (p.recoil || 0) * 1.2);
    }
    hitscan(game, bx, by, a, w.range, w.dmg, w.kb);
  }
  return true;
}

/**
 * Rayo instantáneo: se detiene en el primer zombi alcanzado o en el muro.
 * Devuelve el zombie golpeado (o null).
 */
function hitscan(game, x, y, ang, range, dmg, kb) {
  const map = game.map;
  const dx = Math.cos(ang), dy = Math.sin(ang);

  // distancia hasta el primer muro/puerta cerrada (el cristal pasa)
  const dWall = map.castRay(x, y, ang, range);

  // zombi más cercano sobre el rayo (intersección rayo-círculo)
  let best = null, bestT = Math.min(dWall, range);
  for (const z of game.zombies) {
    const ox = z.x - x, oy = z.y - y;
    const t = ox * dx + oy * dy;            // proyección sobre el rayo
    if (t <= 4 || t >= bestT) continue;      // detrás / más lejos que el muro
    const perp = Math.abs(ox * dy - oy * dx); // distancia al rayo
    if (perp > z.r + 1.5) continue;
    best = z; bestT = t;
  }

  const ex = x + dx * bestT, ey = y + dy * bestT;
  game.tracers.push({ x1: x, y1: y, x2: ex, y2: ey, t: 0, life: 0.075 });

  if (best) {
    const d = dmg * (0.9 + Math.random() * 0.2);
    best.takeDamage(d, ang, kb, game);
    if (best.hp <= 0) game.killZombie(best);
    game.audio.hitFlesh();
  } else if (bestT < range - 1) {
    // impacto contra el muro: chispa de polvo
    game.impacts.push({ x: ex, y: ey, t: 0, life: 0.22 });
  }
  return best;
}

// ================== RECARGA ==================

/**
 * Recarga (tecla R) del arma de fuego equipada.
 *  - Pistola/rifle: inserta el cargador compatible más lleno (el que lleva
 *    puesto vuelve a la mochila). Antes se auto-rellenan todos con la
 *    munición suelta del inventario.
 *  - Escopeta: pasa cartuchos de la mochila al tubo (0,5 s por cartucho).
 */
export function reloadRanged(game) {
  const p = game.player;
  const gun = p.equipment.arma;
  if (!gun || !gun.def.ranged) {
    game.toasts.push('Solo se recargan las armas de fuego', 'warn');
    return false;
  }
  if (p.reloading) return false;
  const w = gun.def;

  // la munición suelta rellena los cargadores ANTES de elegir el mejor
  // (game.refillMags emite sus propios toasts)
  game.refillMags();

  if (w.magType) {
    // ---- pistola / rifle: elegir el cargador más lleno ----
    const inv = p.inventory;
    let best = gun.mag || null;
    for (const s of inv.slots) {
      if (s && s.def.cat === 'cargador' && s.id === w.magType) {
        if (!best || s.rounds > best.rounds) best = s;
      }
    }
    if (!best) {
      game.toasts.push('No llevas ningún cargador para ' + w.name, 'warn');
      return false;
    }
    if (best === gun.mag && best.rounds >= best.def.cap) {
      game.toasts.push('Cargador lleno');
      return false;
    }
    if (best.rounds <= 0) {
      game.toasts.push('Sin ' + ITEMS_NAME(w) + ' para rellenar el cargador', 'warn');
      return false;
    }

    let time = w.reload;
    if (w.gunClass === 'pistola') time *= p.pistolReloadMod();
    p.reloading = {
      left: time, total: time, gun,
      kind: 'mag', mag: best,
    };
    game.audio.reloadStart();
  } else {
    // ---- escopeta: cartuchos al tubo ----
    const inv = p.inventory;
    let shells = 0;
    for (const s of inv.slots) if (s && s.id === w.ammo) shells += s.count;
    const tube = gun.tube || 0;
    const need = (w.tubeCap || 0) - tube;

    if (need <= 0) { game.toasts.push('Tubo lleno'); return false; }
    if (shells <= 0) {
      game.toasts.push(tube > 0 ? 'Sin cartuchos para recargar' : 'Sin cartuchos calibre 12', 'warn');
      return false;
    }

    const n = Math.min(need, shells);
    const time = (w.shellTime || 0.5) * n;
    p.reloading = { left: time, total: time, gun, kind: 'tube', shells: n };
    game.audio.reloadStart();
  }
  return true;
}

function ITEMS_NAME(w) {
  return w.ammo === 'bala_9mm' ? 'balas 9mm' : w.ammo === 'bala_556' ? 'balas 5.56' : 'cartuchos';
}

/** Completa la recarga cuando expira el temporizador (main.update). */
export function finishReload(game) {
  const p = game.player;
  const r = p.reloading;
  if (!r) return;
  p.reloading = null;
  const gun = r.gun;

  // si cambió de arma a mitad de recarga, se cancela sin efecto
  if (p.equipment.arma !== gun) return;

  if (r.kind === 'mag') {
    const inv = p.inventory;
    // el cargador puesto (si había) vuelve a la mochila
    if (gun.mag && gun.mag !== r.mag) {
      const i = inv.slots.indexOf(null);
      if (i === -1) { game.toasts.push('Mochila llena: recarga cancelada', 'warn'); return; }
      inv.slots[i] = gun.mag;
    }
    // quitar el nuevo cargador de la mochila
    const idx = inv.slots.indexOf(r.mag);
    if (idx >= 0) inv.slots[idx] = null;
    gun.mag = r.mag;
    game.audio.reloadEnd();
    game.toasts.push(gun.def.name + ' recargada (' + r.mag.rounds + '/' + r.mag.def.cap + ')');
  } else {
    // escopeta: n cartuchos de la mochila al tubo
    let need = r.shells;
    const inv = p.inventory;
    for (let i = 0; i < inv.slots.length && need > 0; i++) {
      const st = inv.slots[i];
      if (st && st.id === gun.def.ammo && st.count > 0) {
        const take = Math.min(need, st.count);
        st.count -= take;
        need -= take;
        if (st.count <= 0) inv.slots[i] = null;
      }
    }
    gun.tube = (gun.tube || 0) + (r.shells - need);
    game.audio.reloadEnd();
    game.toasts.push('Guardián 12 cargada (' + gun.tube + '/' + gun.def.tubeCap + ')');
  }
}

// ================== ZOMBIS ==================

/** Un zombi golpea al jugador (daño con armadura + posible mordida). */
export function zombieHit(game, z) {
  const p = game.player;
  const dmg = Z.dmgMin + Math.random() * (Z.dmgMax - Z.dmgMin);
  const reduced = dmg * (1 - p.damageReduction());
  const wasBite = game.survival.zombieHit(reduced, game);
  p.hurtFlash = 0.4;

  // pequeño empujón al jugador
  const a = Math.atan2(p.y - z.y, p.x - z.x);
  game.map.moveCircle(p, Math.cos(a) * 7, Math.sin(a) * 7);

  if (wasBite) game.cam.shake(7);
  return wasBite;
}
