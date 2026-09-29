/**
 * player.js — El superviviente: movimiento, sigilo, ataque, equipo vestible.
 *
 * El equipo de ropa cambia el aspecto del sprite (colores por pieza) y aporta
 * efectos: reducción de daño, protección contra mordidas, ruido y espacio.
 */

import { PLAYER_CFG, FISTS, ITEMS, EQUIP_SLOTS, BASE_SLOTS } from '../config.js';
import { Inventory, makeItem } from '../systems/inventory.js';
import { clamp, angDiff } from '../utils.js';

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = PLAYER_CFG.radius;
    this.vx = 0; this.vy = 0;
    this.angle = 0;              // apuntado del ratón
    this.sneak = false;
    this.running = false;
    this.moving = false;
    this.exhausted = false;
    this.swingT = 0;             // animación de golpe
    this.swingDur = 0.25;
    this.cooldown = 0;
    this.stepAcc = 0;
    this.hurtFlash = 0;

    // Equipo vestible (instancias de objetos o null)
    this.equipment = {
      cabeza: null,
      accesorios: null,
      torso: makeItem('playera'),
      pantalones: makeItem('jeans'),
      arma: null,
    };
    this.inventory = new Inventory(BASE_SLOTS);
    this.inventory.add(makeItem('agua'));
    this.inventory.add(makeItem('lata_frijoles'));
  }

  // ---------- Derivados del equipo ----------

  weaponDef() {
    return this.equipment.arma ? this.equipment.arma.def : FISTS;
  }

  /** Reducción de daño total (multiplicativa entre piezas). */
  damageReduction() {
    let mult = 1;
    for (const s of EQUIP_SLOTS) {
      const it = this.equipment[s];
      if (it && it.def.armor) mult *= (1 - it.def.armor);
    }
    return 1 - mult;
  }

  /** Protección contra infección por mordida. */
  infectProtection() {
    let p = 0;
    for (const s of EQUIP_SLOTS) {
      const it = this.equipment[s];
      if (it && it.def.infectProt) p += it.def.infectProt;
    }
    return Math.min(0.85, p);
  }

  /** Multiplicador de ruido de pasos. */
  noiseMultiplier() {
    let m = 1;
    for (const s of EQUIP_SLOTS) {
      const it = this.equipment[s];
      if (it && it.def.noiseMod) m *= it.def.noiseMod;
    }
    return m;
  }

  slotsBonus() {
    let b = 0;
    for (const s of EQUIP_SLOTS) {
      const it = this.equipment[s];
      if (it && it.def.slotsBonus) b += it.def.slotsBonus;
    }
    return b;
  }

  capacity() { return BASE_SLOTS + this.slotsBonus(); }

  /**
   * Equipa un objeto de ropa/arma; el anterior vuelve a la mochila.
   * Devuelve true si se equipó.
   */
  equip(item) {
    if (item.def.cat === 'arma') {
      const old = this.equipment.arma;
      this.equipment.arma = item;
      if (old) this.inventory.add(old);
      return true;
    }
    if (item.def.cat === 'ropa' && item.def.slot) {
      const old = this.equipment[item.def.slot];
      this.equipment[item.def.slot] = item;
      if (old) this.inventory.add(old);
      return true;
    }
    return false;
  }

  /** Desequipa una ranura de vuelta a la mochila (si hay sitio). */
  unequip(slot) {
    const it = this.equipment[slot];
    if (!it) return false;
    if (slot === 'arma') { this.equipment.arma = null; }
    else if (ITEMS[it.id] && this.equipment[slot]) { this.equipment[slot] = null; }
    if (!this.inventory.add(it)) {
      this.equipment[slot] = it; // sin espacio: revertir
      return false;
    }
    return true;
  }

  // ---------- Update ----------

  update(dt, game) {
    const inp = game.input;
    const surv = game.survival;
    const axis = inp.moveAxis();

    // correr / agotamiento
    const wantRun = (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) && !this.sneak;
    if (surv.stamina <= 0.5) this.exhausted = true;
    if (surv.stamina >= PLAYER_CFG.exhaustedFloor) this.exhausted = false;
    const running = wantRun && !this.exhausted;

    const speed = this.sneak ? PLAYER_CFG.sneak : (running ? PLAYER_CFG.run : PLAYER_CFG.walk);
    const k = 1 - Math.pow(0.0001, dt);
    this.vx += (axis.x * speed - this.vx) * k;
    this.vy += (axis.y * speed - this.vy) * k;

    const ox = this.x, oy = this.y;
    game.map.moveCircle(this, this.vx * dt, this.vy * dt);
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.moving = moved > 0.05;
    this.running = running && this.moving;

    // pasos → ruido + sonido
    if (this.moving) {
      this.stepAcc += moved;
      if (this.stepAcc >= PLAYER_CFG.stepDist) {
        this.stepAcc = 0;
        const base = this.sneak ? PLAYER_CFG.noiseSneak : (running ? PLAYER_CFG.noiseRun : PLAYER_CFG.noiseWalk);
        game.noise.emit(this.x, this.y, base * this.noiseMultiplier(), 'paso');
        game.audio.step(this.sneak ? 0.35 : running ? 1 : 0.65);
      }
    }

    // apuntado
    const mw = game.cam.screenToWorld(inp.mouse.x, inp.mouse.y);
    this.angle = Math.atan2(mw.y - this.y, mw.x - this.x);

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
  }

  // ---------- Render ----------

  draw(ctx, cam) {
    const s = cam.worldToScreen(this.x, this.y);
    const a = this.angle;
    const scale = this.sneak ? 0.86 : 1;
    const R = this.r * scale;

    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x + 2, s.y + 3, R * 1.05, R * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // efecto de golpe recibido
    if (this.hurtFlash > 0) {
      ctx.fillStyle = `rgba(200,30,30,${this.hurtFlash * 1.5})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, R + 4, 0, Math.PI * 2); ctx.fill();
    }

    const torso = this.equipment.torso ? this.equipment.torso.def.color : '#3d5a73';
    const pants = this.equipment.pantalones ? this.equipment.pantalones.def.color : '#3a4a6a';
    const headGear = this.equipment.cabeza ? this.equipment.cabeza.def.color : null;
    const acc = this.equipment.accesorios;

    // "piernas": media luna inferior del color del pantalón
    ctx.fillStyle = pants;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, a + Math.PI * 0.35, a + Math.PI * 1.65);
    ctx.closePath();
    ctx.fill();

    // torso
    ctx.fillStyle = torso;
    ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();

    // arma (dibujada detrás de las manos al golpear)
    const wDef = this.weaponDef();
    const swinging = this.swingT > 0;
    const wAng = swinging
      ? a - 1.15 + 2.3 * (1 - this.swingT / this.swingDur)
      : a + 0.55;
    if (wDef !== FISTS || swinging) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(wAng);
      ctx.strokeStyle = wDef.color || '#9aa0a6';
      ctx.lineWidth = wDef === FISTS ? 3 : 5;
      ctx.beginPath();
      ctx.moveTo(R * 0.4, 0);
      ctx.lineTo(R + (wDef.range || 34) * 0.55, 0);
      ctx.stroke();
      ctx.restore();
    }

    // estela del golpe
    if (swinging) {
      const p = 1 - this.swingT / this.swingDur;
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - p)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, (wDef.range || 34) * 0.8, a - 1.15, a - 1.15 + 2.3 * p);
      ctx.stroke();
    }

    // manos
    ctx.fillStyle = '#c9a27a';
    for (const side of [-0.55, 0.55]) {
      const hx = s.x + Math.cos(a + side) * (R + 2);
      const hy = s.y + Math.sin(a + side) * (R + 2);
      ctx.beginPath(); ctx.arc(hx, hy, 3.2, 0, Math.PI * 2); ctx.fill();
    }

    // cabeza
    const hAng = a;
    const hx = s.x + Math.cos(hAng) * 2.5;
    const hy = s.y + Math.sin(hAng) * 2.5;
    ctx.fillStyle = headGear || '#c9a27a';
    ctx.beginPath(); ctx.arc(hx, hy, R * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();

    // accesorios sobre la cabeza
    if (acc) {
      if (acc.id === 'mascara_gas') {
        ctx.fillStyle = '#4a5a3a';
        ctx.beginPath(); ctx.arc(hx, hy, R * 0.5, hAng - 1.2, hAng + 1.2); ctx.fill();
        ctx.fillStyle = '#20261c';
        ctx.beginPath(); ctx.arc(hx + Math.cos(hAng) * 4, hy + Math.sin(hAng) * 4, 2.4, 0, Math.PI * 2); ctx.fill();
      } else if (acc.id === 'pasamontanas') {
        ctx.fillStyle = 'rgba(20,20,24,0.55)';
        ctx.beginPath(); ctx.arc(hx, hy, R * 0.66, 0, Math.PI * 2); ctx.fill();
      } else if (acc.id === 'lentes') {
        ctx.strokeStyle = 'rgba(10,10,12,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(hx, hy, R * 0.62, hAng - 0.8, hAng + 0.8);
        ctx.stroke();
      }
    }

    // indicador de apuntado sutil (nariz)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(s.x + Math.cos(a) * R * 0.95, s.y + Math.sin(a) * R * 0.95, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
