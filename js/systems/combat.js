/**
 * combat.js — Ataque cuerpo a cuerpo del jugador y resolución de impactos.
 */

import { ZOMBIE_CFG as Z } from '../config.js';
import { angDiff } from '../utils.js';

/** El jugador golpea con el arma equipada en un arco frente a él. */
export function playerAttack(game) {
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
