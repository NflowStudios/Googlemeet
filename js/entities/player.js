/**
 * player.js — El superviviente: movimiento, sigilo, ataque, equipo vestible.
 *
 * El equipo de ropa cambia el aspecto del sprite (colores por pieza) y aporta
 * efectos: reducción de daño, protección contra mordidas, ruido y espacio.
 */

import { PLAYER_CFG, FISTS, ITEMS, EQUIP_SLOTS, BASE_SLOTS, FLOORS, PROF_BY_ID } from '../config.js';
import { Inventory, makeItem } from '../systems/inventory.js';
import { clamp, angDiff } from '../utils.js';

export class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.r = PLAYER_CFG.radius;
    this.prof = null;            // v0.24: profesión elegida al crear la partida (id o null)
    this.inCar = null;           // v0.26: coche que estás CONDUCIENDO (objeto de map.cars)
    // v0.27: MULTIJUGADOR — identidad del jugador en la sala (propio o
    // marioneta): color de camiseta asignado por el anfitrión, nombre
    // sobre la cabeza y bandera de caído (espectador)
    this.mpColor = null;
    this.mpName = null;
    this.mpId = null;
    this.mpDead = false;
    // v0.28: REVIVIR — estado «caído» (inconsciente, aún reanimable):
    // mpDown mientras corre la ventana de NET.reviveWindow segundos;
    // mpDownT es la cuenta atrás que queda. Al agotarse pasa a mpDead
    // y su cadáver se vuelve saqueable.
    this.mpDown = false;
    this.mpDownT = 0;
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

    // Equipo vestible (instancias de objetos o null) — TRES ranuras de
    // accesorio (v0.18): cualquier accesorio (incluidas fundas y la
    // linterna) puede ir en cualquiera de las tres
    this.equipment = {
      cabeza: null,
      accesorios: null,
      accesorios2: null,
      accesorios3: null,
      torso: makeItem('playera'),
      pantalones: makeItem('jeans'),
      arma: null,
    };
    this.reloading = null;   // {left,total,gun,kind,...} mientras se recarga
    this.recoil = 0;         // retroceso acumulado (aumenta la dispersión)
    // Planta actual: 0 = calle/planta baja, 1 = 2º piso, -1 = sótano.
    // climb = {from, to, t, dur, k} mientras sube/baja escaleras (fundido
    // de la capa de planta en render).
    this.z = 0;
    this.climb = null;
    this._climbStepAcc = 0;
    // Barra rápida (teclas 1·2·3·4·5 — v0.17): [arma de fuego principal,
    // arma de fuego secundaria, arma melee, misceláneo, misceláneo]. Guarda
    // REFERENCIAS a objetos de la mochila (o empuñados); se asigna desde el
    // inventario y se vacía sola si el objeto deja de estar contigo.
    this.hotbar = [null, null, null, null, null];
    // v0.17: linterna encendida (solo tiene efecto con una equipada en un
    // accesorio; el consumo de pilas vive en systems/flashlight.js)
    this.flashOn = false;
    this.inventory = new Inventory(BASE_SLOTS);
    this.inventory.add(makeItem('agua'));
    this.inventory.add(makeItem('lata_frijoles'));
  }

  // ---------- Derivados del equipo ----------

  /**
   * v0.24: multiplicador PASIVO de la PROFESIÓN para un campo de fx
   * ('gunDmgMul', 'healMul', 'stepNoiseMul', 'repairMul'). Sin profesión
   * (o profesión sin ese efecto, como el desempleado) → 1: la partida
   * clásica, byte a byte igual que siempre.
   * v0.25: `def` permite otro neutro — growFast del GRANJERO es ADITIVO
   * (días que se restan), así que su neutro es 0, no 1.
   */
  profMul(field, def = 1) {
    const d = PROF_BY_ID[this.prof];
    return d && d.fx && d.fx[field] !== undefined ? d.fx[field] : def;
  }


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

  /** Multiplicador de ruido de pasos (equipo + profesión del LADRÓN). */
  noiseMultiplier() {
    let m = this.profMul('stepNoiseMul');   // v0.24: el ladrón pisa a la mitad
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

  /** Modificador de tiempo de desenfunde de pistola según la funda equipada. */
  pistolDrawMod() {
    for (const s of ['accesorios', 'accesorios2', 'accesorios3']) {
      const f = this.equipment[s];
      if (f && f.def.pistolDrawMod) return f.def.pistolDrawMod;
    }
    return 1;
  }

  /** Modificador de tiempo de recarga de pistola según la funda equipada. */
  pistolReloadMod() {
    for (const s of ['accesorios', 'accesorios2', 'accesorios3']) {
      const f = this.equipment[s];
      if (f && f.def.pistolReloadMod) return f.def.pistolReloadMod;
    }
    return 1;
  }

  /** ¿Lleva una funda puesta? */
  hasHolster() {
    return !!(this.equipment.accesorios && this.equipment.accesorios.def.pistolDrawMod) ||
           !!(this.equipment.accesorios2 && this.equipment.accesorios2.def.pistolDrawMod) ||
           !!(this.equipment.accesorios3 && this.equipment.accesorios3.def.pistolDrawMod);
  }

  capacity() { return BASE_SLOTS + this.slotsBonus(); }

  /**
   * Equipa un objeto de ropa/arma; el anterior vuelve a la mochila.
   * Los accesorios (lentes, pasamontañas, máscaras, fundas, linterna…)
   * pueden ocupar cualquiera de las TRES ranuras de accesorio (v0.18: se
   * usa la primera libre).
   * Al desenfundar un arma de fuego hay un pequeño tiempo de "sacar"
   // (la funda de pistola lo acorta).
   */
  equip(item) {
    if (item.def.cat === 'arma') {
      const old = this.equipment.arma;
      this.equipment.arma = item;
      if (old) this.inventory.add(old);
      if (old !== item) {
        this.reloading = null; // cambiar de arma cancela la recarga
        this.recoil = 0;
        if (item.def.ranged && item.def.draw) {
          let draw = item.def.draw;
          // v0.16: la funda acelera el desenfunde de pistolas Y revólveres
          if (item.def.gunClass === 'pistola' || item.def.gunClass === 'revolver') {
            draw *= this.pistolDrawMod();
          }
          this.cooldown = Math.max(this.cooldown, draw);
        }
      }
      return true;
    }
    if (item.def.cat === 'ropa' && item.def.slot) {
      let slot = item.def.slot;
      if (slot === 'accesorios' || slot === 'accesorios2' || slot === 'accesorios3') {
        // cualquiera de las tres ranuras vale: primera libre
        if (!this.equipment.accesorios) slot = 'accesorios';
        else if (!this.equipment.accesorios2) slot = 'accesorios2';
        else if (!this.equipment.accesorios3) slot = 'accesorios3';
        else slot = 'accesorios';
      }
      const old = this.equipment[slot];
      this.equipment[slot] = item;
      if (old) this.inventory.add(old);
      // v0.17: equipar la linterna la ENCIENDE (se apaga con L)
      if (item.def.flashlight) this.flashOn = true;
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

    // apuntado (siempre, incluso escalando)
    const mw = game.cam.screenToWorld(inp.mouse.x, inp.mouse.y);
    if (!this.inCar) this.angle = Math.atan2(mw.y - this.y, mw.x - this.x);
    // v0.26: CONDUCIENDO — la física vive en systems/vehicles.js (updateVehicle):
    // aquí solo decaen cooldowns y el jugador va "dentro" del coche
    if (this.inCar) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.swingT = Math.max(0, this.swingT - dt);
      this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      this.recoil = Math.max(0, (this.recoil || 0) - dt * 1.4);
      return;
    }

    // ---- escalando escaleras: movimiento bloqueado, avance del fundido ----
    if (this.climb) {
      this.climb.t += dt;
      const raw = Math.min(1, this.climb.t / this.climb.dur);
      this.climb.k = raw * raw * (3 - 2 * raw);   // suavizado
      this.vx = 0; this.vy = 0;
      this.moving = false;
      this.running = false;
      this._climbStepAcc += dt;
      if (this._climbStepAcc >= FLOORS.stepEvery) {
        this._climbStepAcc = 0;
        game.audio.step(0.5);                      // pasos de escalera
        game.noise.emit(this.x, this.y, 40, 'escalera');
      }
      if (this.climb.t >= this.climb.dur) {
        this.z = this.climb.to;
        this.climb = null;
        game.toasts.push(this.z === 1 ? '2º piso' : this.z === -1 ? 'Sótano' : 'Planta baja');
        game.noise.emit(this.x, this.y, 60, 'escalera');
      }
    } else {
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
      game.map.moveCircle(this, this.vx * dt, this.vy * dt, this.z);
      const moved = Math.hypot(this.x - ox, this.y - oy);
      this.moving = moved > 0.05;
      this.running = running && this.moving;
      // v0.23: odómetro para el obituario (px de mundo recorridos)
      if (game.stats) game.stats.dist += moved;

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
    }

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.recoil = Math.max(0, (this.recoil || 0) - dt * 1.4);
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

    const torso = this.mpColor || (this.equipment.torso ? this.equipment.torso.def.color : '#3d5a73');
    const pants = this.equipment.pantalones ? this.equipment.pantalones.def.color : '#3a4a6a';
    const headGear = this.equipment.cabeza ? this.equipment.cabeza.def.color : null;
    const acc1 = this.equipment.accesorios;
    const acc2 = this.equipment.accesorios2;
    const acc3 = this.equipment.accesorios3;

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

    // funda en la cadera (lado izquierdo) — con la pistola guardada dentro
    // si llevas una en la mochila
    if (this.hasHolster()) {
      const hAng = a + Math.PI / 2;
      const hx = s.x + Math.cos(hAng) * (R + 1);
      const hy = s.y + Math.sin(hAng) * (R + 1);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(a);
      const f = this.equipment.accesorios?.def.pistolDrawMod ? this.equipment.accesorios
        : this.equipment.accesorios2?.def.pistolDrawMod ? this.equipment.accesorios2
        : this.equipment.accesorios3;
      ctx.fillStyle = f.def.color;
      ctx.fillRect(-4, -2.5, 8, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-4, -2.5, 8, 6);
      // arma corta enfundada (empuñadura asomando): pistola o revólver
      const pistola = this.inventory.slots.find(
        (it) => it && (it.def.gunClass === 'pistola' || it.def.gunClass === 'revolver'));
      if (pistola) {
        ctx.fillStyle = '#20242a';
        ctx.fillRect(-1.5, -1.5, 5, 3);
      }
      ctx.restore();
    }

    // arma en las manos
    const wDef = this.weaponDef();
    const swinging = this.swingT > 0;
    const wAng = swinging
      ? a - 1.15 + 2.3 * (1 - this.swingT / this.swingDur)
      : a + 0.55;
    if (wDef !== FISTS || swinging) {
      if (wDef.ranged) {
        this._drawGun(ctx, s, a, wDef, R);
      } else {
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

    // accesorios sobre la cabeza (las tres ranuras)
    for (const acc of [acc1, acc2, acc3]) {
      if (!acc) continue;
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

  /** Silueta de arma de fuego en las manos, apuntada hacia el ratón. */
  _drawGun(ctx, s, a, wDef, R) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    const L = wDef.gunLen || 17;
    const body = wDef.color || '#3a3f46';

    // retroceso: el arma "patina" hacia atrás al disparar
    const kick = (this.recoil || 0) * 3;
    ctx.translate(-kick, 0);

    if (wDef.gunClass === 'pistola') {
      // corredera + cañón corto + empuñadura
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.55, -2.2, L, 4.4);
      ctx.fillRect(R * 0.55 + L - 2, -1.4, 3.5, 2.8);       // boca del cañón
      ctx.fillStyle = '#22262c';
      ctx.fillRect(R * 0.3, 0.5, 4, 5.5);                    // empuñadura
    } else if (wDef.gunClass === 'revolver') {
      // v0.16 — revólver: tambor gordo + cañón largo + empuñadura de madera
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.55, -1.8, L, 3.6);                  // cañón
      ctx.fillStyle = '#22262c';
      ctx.beginPath(); ctx.arc(R * 0.62, 0, 3.6, 0, Math.PI * 2); ctx.fill();  // tambor
      ctx.fillStyle = '#6a4a2c';
      ctx.fillRect(R * 0.3, 0.5, 4, 5.5);                    // empuñadura
    } else if (wDef.gunClass === 'dobles') {
      // v0.16 — doble cañón: dos tubos paralelos + culata
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.5, -2.6, L + 5, 2.6);               // cañón superior
      ctx.fillRect(R * 0.5, 0, L + 5, 2.6);                  // cañón inferior
      ctx.fillStyle = '#5a4632';
      ctx.fillRect(R * 0.1, -2, 5, 4);                       // culata
    } else if (wDef.gunClass === 'cerrojo') {
      // v0.16 — rifle de cerrojo: cañón MUY largo + mira telescópica + culata
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.45, -1.6, L + 8, 3.2);              // cañón largo
      ctx.fillStyle = '#1e2226';
      ctx.fillRect(R * 0.7, -3.4, 8, 2.2);                   // mira telescópica
      ctx.fillStyle = '#5a4632';
      ctx.fillRect(R * 0.1, -1.8, 6, 3.6);                   // culata
    } else if (wDef.gunClass === 'subfusil') {
      // v0.16 — subfusil: cuerpo rectangular + cargador recto + cañón corto
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.45, -2.6, L + 2, 5.2);              // cuerpo boxy
      ctx.fillRect(R * 0.45 + L + 2, -1.2, 3.5, 2.4);        // cañón
      ctx.fillStyle = '#20262a';
      ctx.fillRect(R * 0.55 + 3, 1.5, 3.6, 7);               // cargador recto
      ctx.fillStyle = '#171b16';
      ctx.fillRect(R * 0.2, -1.6, 4.5, 3.2);                 // culata plegada
    } else if (wDef.gunClass === 'escopeta') {
      // tubo largo + bomba de corredera + culata
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.5, -1.8, L + 6, 3.6);               // cañón
      ctx.fillStyle = '#2a2e24';
      ctx.fillRect(R * 0.5 + 5, -2.6, 7, 5.2);               // corredera
      ctx.fillStyle = '#5a4632';
      ctx.fillRect(R * 0.1, -2, 5, 4);                        // culata
    } else {
      // rifle: cuerpo + cargador curvo + cañón
      ctx.fillStyle = body;
      ctx.fillRect(R * 0.45, -2.4, L + 4, 4.8);              // cuerpo
      ctx.fillRect(R * 0.45 + L + 4, -1.2, 4, 2.4);           // cañón
      ctx.fillStyle = '#20262a';
      ctx.fillRect(R * 0.55 + 4, 1.5, 4.5, 6);                // cargador
      ctx.fillStyle = '#171b16';
      ctx.fillRect(R * 0.2, -1.6, 5.5, 3.2);                  // culata
    }
    // brillo de la parte superior
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(R * 0.55, -2.2, L, 1.2);
    ctx.restore();
  }
}
