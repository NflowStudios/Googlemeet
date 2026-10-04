/**
 * survival.js — Contadores vitales y estados del jugador.
 *
 * Vida, stamina, hambre y sed + infección + intoxicación por comida podrida.
 * El hambre/sed críticas drenan vida y entorpecen la stamina. La infección
 * por mordida progresa sin pausa hasta la muerte (los antibióticos ayudan).
 */

import { SURV } from '../config.js';
import { clamp } from '../utils.js';

export class Survival {
  constructor() {
    this.health = 100;
    this.stamina = 100;
    this.hunger = 100;
    this.thirst = 100;
    this.infected = false;
    this.infection = 0;        // 0..100
    this.infectionRateMult = 1; // antibióticos
    this.intoxicated = 0;       // segundos restantes
    this.healEffects = [];      // {amount, remaining, dur, rate}
    this.deathCause = null;
    // v0.18 — objetos exclusivos del hospital:
    this.adrenaline = 0;        // segundos de ENERGÍA INFINITA restantes
    this.morphine = 0;          // segundos de daño −50% restantes
  }

  /** Stamina máxima efectiva (la fiebre la debilita). */
  get maxStamina() {
    return 100 - this.infection * 0.55;
  }

  get staminaRatio() {
    return this.stamina / this.maxStamina;
  }

  /** Regeneración de stamina por segundo según estado. */
  staminaRegen(moving) {
    let regen = moving ? SURV.staminaRegenWalk : SURV.staminaRegenIdle;
    if (this.thirst < SURV.critLevel) regen *= SURV.thirstRegenMult;
    if (this.intoxicated > 0) regen *= SURV.intoxRegenMult;
    return regen;
  }

  /** Drenaje pasivo + efectos. Llama a game.onDeath(cause) si muere. */
  update(dt, game, moving, running) {
    // ---- hambre y sed ----
    let hungerRate = SURV.hungerRate;
    let thirstRate = SURV.thirstRate;
    if (running) { hungerRate *= 1.25; thirstRate *= 1.3; }
    this.hunger = clamp(this.hunger - hungerRate * dt, 0, 100);
    this.thirst = clamp(this.thirst - thirstRate * dt, 0, 100);

    // ---- stamina ----
    // v0.18: la ADRENALINA del hospital da energía infinita mientras dura —
    // ni se agota corriendo ni se puede quedar "agotado" (y arranca llena)
    if (this.adrenaline > 0) {
      this.adrenaline = Math.max(0, this.adrenaline - dt);
      this.stamina = this.maxStamina;
    } else if (running && moving) {
      this.stamina = clamp(this.stamina - SURV.staminaRunDrain * dt, 0, this.maxStamina);
    } else {
      this.stamina = clamp(this.stamina + this.staminaRegen(moving) * dt, 0, this.maxStamina);
    }

    // v0.18: la MORFINA del hospital reduce a la mitad el daño RECIBIDO
    // mientras dura (los drenajes pasivos de hambre/sed no se mitigan)
    if (this.morphine > 0) this.morphine = Math.max(0, this.morphine - dt);

    // ---- niveles críticos ----
    if (this.hunger < SURV.critLevel) this.damage(SURV.hungerHpDrain * dt, 'hambre', game, true);
    if (this.thirst < SURV.critLevel) this.damage(SURV.thirstHpDrain * dt, 'sed', game, true);

    // ---- infección ----
    if (this.infected) {
      this.infection = clamp(this.infection + SURV.infectionRate * this.infectionRateMult * dt, 0, 100);
      if (this.infection >= 100) {
        this.damage(999, 'infeccion', game);
        return;
      }
    }

    // ---- intoxicación ----
    if (this.intoxicated > 0) this.intoxicated = Math.max(0, this.intoxicated - dt);

    // ---- curación progresiva (vendas) ----
    for (let i = this.healEffects.length - 1; i >= 0; i--) {
      const e = this.healEffects[i];
      const tick = (e.amount / e.dur) * dt;
      this.health = clamp(this.health + tick, 0, 100);
      e.remaining -= dt;
      if (e.remaining <= 0) this.healEffects.splice(i, 1);
    }
  }

  /** Aplica daño. silent = sin shake/sfx (drenajes pasivos).
   *  v0.18: la morfina mitiga el daño "sentido" (golpes, disparos, comida
   *  podrida) pero no los drenajes pasivos de hambre/sed. */
  damage(amount, cause, game, silent = false) {
    if (this.deathCause) return;
    if (this.morphine > 0 && !silent) amount *= 0.5;
    this.health = clamp(this.health - amount, 0, 100);
    if (!silent && game) {
      game.cam.shake(Math.min(7, amount * 0.6));
      game.audio.hurt();
      game.hud.flashDamage(0.25);
    }
    if (this.health <= 0) {
      this.deathCause = cause;
      if (game) game.onDeath(cause);
    }
  }

  /** Golpe de zombi (ya con armadura aplicada). Posible mordida → infección. */
  zombieHit(dmg, game) {
    this.damage(dmg, 'zombi', game);
    if (this.deathCause) return false;
    if (Math.random() < SURV.biteChance) {
      game.audio.bite();
      const prot = game.player.infectProtection();
      if (Math.random() < SURV.biteInfectChance * (1 - prot)) {
        this.infected = true;
        game.toasts.push('¡MORDIDA! La infección empieza a extenderse…', 'bad');
      } else {
        game.toasts.push('¡Mordida! La ropa te ha protegido del contagio', 'warn');
      }
      return true; // fue mordida
    }
    return false;
  }

  /** Come (o bebe) un objeto. Devuelve mensaje para el toast. */
  consume(item, game) {
    const def = item.def;
    const msgs = [];
    const rotten = !!item.rotten;

    if (def.cat === 'comida' || def.cat === 'bebida') {
      const mult = rotten ? SURV.rottenHungerMult : 1;
      if (def.hunger) {
        this.hunger = clamp(this.hunger + def.hunger * mult, 0, 100);
        msgs.push('+' + Math.round(def.hunger * mult) + ' hambre');
      }
      if (def.thirst) {
        this.thirst = clamp(this.thirst + def.thirst * mult, 0, 100);
        msgs.push('+' + Math.round(def.thirst * mult) + ' sed');
      }
      if (def.stamina && !rotten) {
        this.stamina = clamp(this.stamina + def.stamina, 0, this.maxStamina);
        msgs.push('+' + def.stamina + ' stamina');
      }
      if (rotten) {
        this.damage(SURV.rottenHp, 'intoxicacion', game);
        this.intoxicated = SURV.intoxDur;
        msgs.unshift('COMIDA PODRIDA');
        msgs.push('-' + SURV.rottenHp + ' vida, intoxicación');
      }
      return msgs.join(' · ');
    }

    if (def.cat === 'medico') {
      // v0.24: MÉDICO — bono pasivo de curación sobre OBJETOS CURATIVOS
      // (venda, botiquín…): la parte que cura rinde un 5% más en sus manos.
      const hm = (game && game.player && game.player.profMul)
        ? game.player.profMul('healMul') : 1;
      const n1 = (x) => String(Math.round(x * 10) / 10).replace('.', ',');   // coma española
      if (def.heal) {
        const h = def.heal * hm;
        this.health = clamp(this.health + h, 0, 100);
        game.audio.heal();
        msgs.push('+' + n1(h) + ' vida');
      }
      if (def.healOverTime) {
        const amt = def.healOverTime * hm;
        this.healEffects.push({ amount: amt, dur: def.healDur, remaining: def.healDur });
        game.audio.heal();
        msgs.push('+' + n1(amt) + ' vida en ' + def.healDur + 's');
      }
      // v0.18 — SUERO MÉDICO: restaura TODA la sed
      if (def.thirstFull) {
        this.thirst = 100;
        game.audio.drink();
        msgs.push('SED RESTAURADA AL 100%');
      }
      // v0.18 — INYECCIÓN DE ADRENALINA: energía infinita por N segundos
      if (def.adrenalinSec) {
        this.adrenaline = def.adrenalinSec;
        this.stamina = this.maxStamina;
        if (game.player) game.player.exhausted = false;   // despeja el agotamiento
        msgs.push('ENERGÍA INFINITA ' + def.adrenalinSec + ' s');
      }
      // v0.18 — ANTIBIÓTICOS POTENTES: curan la infección por debajo de
      // cureBelow (35) y la frenan aún más fuerte si ya está avanzada
      if (def.cureBelow !== undefined) {
        if (this.infected && this.infection < def.cureBelow) {
          this.infected = false;
          this.infection = 0;
          this.infectionRateMult = 1;
          msgs.push('INFECCIÓN CURADA');
        } else if (this.infected) {
          this.infectionRateMult = 0.35;
          msgs.push('infección frenada (demasiado avanzada para curarla)');
        } else {
          msgs.push('sin infección que tratar');
        }
      }
      // v0.18 — MORFINA: la mitad de daño recibido durante N segundos
      if (def.morphineSec) {
        this.morphine = def.morphineSec;
        msgs.push('DAÑO −50% DURANTE ' + def.morphineSec + ' s');
      }
      if (def.infectProt !== undefined || item.id === 'antibioticos') {
        // antibióticos
        if (this.infected && this.infection < 30) {
          this.infected = false;
          this.infection = 0;
          msgs.push('INFECCIÓN CURADA');
        } else if (this.infected) {
          this.infectionRateMult = 0.45;
          msgs.push('infección ralentizada');
        } else {
          msgs.push('sin infección que tratar');
        }
      }
      return msgs.join(' · ');
    }

    return 'Eso no se puede consumir';
  }
}
