/**
 * hud.js — HUD principal: barras vitales, medidor de ruido, chips de estado,
 * estadísticas de partida y prompt de interacción.
 */

import { SURV, FLASH } from '../config.js';
import { fmtTime } from '../utils.js';
import { gunRounds } from '../systems/inventory.js';
import { HOTBAR_N } from '../systems/hotbar.js';
import { flashlightItem, countBatteries } from '../systems/flashlight.js';

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('hud');
    this.bars = {};
    this.vals = {};
    for (const name of ['health', 'stamina', 'hunger', 'thirst']) {
      const row = document.querySelector(`.statbar[data-bar="${name}"]`);
      this.bars[name] = row.querySelector('.fill');
      this.vals[name] = row.querySelector('.bv');
    }
    const infRow = document.querySelector('.statbar[data-bar="infection"]');
    this.bars.infection = infRow.querySelector('.fill');
    this.vals.infection = infRow.querySelector('.bv');
    this.infectionRow = infRow;

    this.chips = document.getElementById('status-chips');
    this.promptEl = document.getElementById('prompt');
    this.noiseTicks = document.querySelectorAll('#noise-meter .nm-ticks i');
    this.statTime = document.getElementById('stat-time');
    this.statKills = document.getElementById('stat-kills');
    this.statSearch = document.getElementById('stat-search');
    this.eqWeapon = document.getElementById('eq-weapon');
    this.eqArmor = document.getElementById('eq-armor');
    this.eqSlots = document.getElementById('eq-slots');
    this.eqAmmo = document.getElementById('eq-ammo');
    this.eqFlash = document.getElementById('eq-flash');   // v0.17: linterna
    this.hbEls = Array.from(document.querySelectorAll('#hotbar .hb-slot'));
    this._hbSig = '';
    this.hintEl = document.getElementById('controls-hint');
    this.dmgFlash = 0;
    this._hintTimer = 0;
    // reloj día/noche (esquina superior derecha)
    this.clockEl = document.getElementById('clock');
    this.clockTime = document.getElementById('clock-time');
    this.clockDay = document.getElementById('clock-day');
    this.clockWeather = document.getElementById('clock-weather');  // v0.15
    this._wxSig = '';
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }

  flashDamage(d) { this.dmgFlash = Math.max(this.dmgFlash, d); }

  /**
   * Barra rápida (1·2·3·4·5 — v0.17): solo re-pinta el DOM cuando algo cambia
   * (firma). Ranura resaltada = su arma está actualmente EN LA MANO; las
   * armas de fuego muestran las balas listas (cargador o tubo).
   */
  renderHotbar(g) {
    const p = g.player;
    if (!p || !p.hotbar || !this.hbEls.length) return;
    let sig = '';
    for (let i = 0; i < HOTBAR_N; i++) {
      const it = p.hotbar[i];
      sig += (it ? it.uid + ':' + (it.count || 1) + ':' + (p.equipment.arma === it ? 1 : 0) : '-') + '|';
    }
    if (sig === this._hbSig) return;
    this._hbSig = sig;
    for (let i = 0; i < this.hbEls.length; i++) {
      const el = this.hbEls[i];
      const it = p.hotbar[i];
      const itemEl = el.querySelector('.hb-item');
      el.classList.toggle('filled', !!it);
      el.classList.toggle('active', !!it && p.equipment.arma === it);
      if (!it) {
        el.title = 'Ranura ' + (i + 1) + ' — asígnala desde el inventario (TAB)';
        itemEl.innerHTML = '';
        continue;
      }
      const d = it.def;
      el.title = d.name + (d.desc ? ' — ' + d.desc : '');
      let html = `<span class="hb-letter" style="background:${d.color || '#8a8a8a'}">${d.name.charAt(0)}</span>`;
      if (it.count > 1) html += `<span class="hb-count">×${it.count}</span>`;
      if (d.ranged && d.magType) html += `<span class="hb-ammo">${it.mag ? it.mag.rounds : 0}</span>`;
      else if (d.ranged) html += `<span class="hb-ammo">${it.tube || 0}</span>`;
      itemEl.innerHTML = html;
    }
  }

  update(g) {
    const s = g.survival;
    if (!s) return;

    this.renderHotbar(g);

    this._setBar('health', s.health, 100);
    this._setBar('stamina', s.stamina, s.maxStamina);
    this._setBar('hunger', s.hunger, 100);
    this._setBar('thirst', s.thirst, 100);

    // infección
    if (s.infected) {
      this.infectionRow.classList.remove('hidden');
      this._setBar('infection', s.infection, 100);
    } else {
      this.infectionRow.classList.add('hidden');
    }

    // crítico → parpadeo
    document.querySelector('.statbar[data-bar="health"]').classList.toggle('crit', s.health < 30);
    document.querySelector('.statbar[data-bar="hunger"]').classList.toggle('crit', s.hunger < SURV.critLevel);
    document.querySelector('.statbar[data-bar="thirst"]').classList.toggle('crit', s.thirst < SURV.critLevel);
    document.querySelector('.statbar[data-bar="stamina"]').classList.toggle('crit', s.stamina < 15);

    // top
    this.statTime.textContent = fmtTime(g.time);
    this.statKills.textContent = 'BAJAS ' + g.kills;
    this.statSearch.textContent = 'REGISTRADO ' + g.searchedCount;

    // reloj digital de 12 h (HH:MM AM/PM) + día de supervivencia
    if (this.clockTime && g.daynight) {
      this.clockTime.textContent = g.daynight.clock;
      this.clockDay.textContent = 'DÍA ' + g.daynight.day;
      this.clockEl.classList.toggle('night', g.daynight.darkness > 0.5);
    }

    // v0.15: estado del clima bajo el reloj (LLUVIA/NEBLINA; despejado → oculto)
    if (this.clockWeather && g.weather) {
      const ty = g.weather.type;
      if (ty !== this._wxSig) {
        this._wxSig = ty;
        this.clockWeather.textContent = g.weather.label;
        this.clockWeather.className = ty;
      }
    }

    // ruido
    const lvl = Math.min(4, g.noise ? g.noise.lastLevel : 0);
    this.noiseTicks.forEach((t, i) => t.classList.toggle('on', i < lvl));

    // chips de estado
    let chips = '';
    if (g.player.sneak) chips += '<span class="chip sneak">AGACHADO</span>';
    if (g.player.flashOn) chips += '<span class="chip flash">LINTERNA</span>';
    if (g.player.exhausted) chips += '<span class="chip warn">AGOTADO</span>';
    if (g.player.reloading) chips += '<span class="chip reload">RECARGANDO</span>';
    if (s.intoxicated > 0) chips += '<span class="chip bad">INTOXICADO</span>';
    if (s.infected) chips += '<span class="chip bad">INFECTADO</span>';
    if (s.healEffects.length > 0) chips += '<span class="chip heal">VENDADO</span>';
    if (s.adrenaline > 0) chips += '<span class="chip adren">ADRENALINA ' + Math.ceil(s.adrenaline) + 's</span>';
    if (s.morphine > 0) chips += '<span class="chip morph">MORFINA ' + Math.ceil(s.morphine) + 's</span>';
    this.chips.innerHTML = chips;

    // equipo rápido
    const p = g.player;
    this.eqWeapon.textContent = p.weaponDef().name.toUpperCase();
    this.eqArmor.textContent = 'BLINDAJE ' + Math.round(p.damageReduction() * 100) + '%';
    this.eqSlots.textContent = 'MOCHILA ' + p.inventory.used() + '/' + p.capacity();

    // munición del arma de fuego equipada (o nada si es melee)
    const gun = p.equipment.arma;
    if (gun && gun.def.ranged && this.eqAmmo) {
      let reserve = 0;
      for (const st of p.inventory.slots) {
        if (st && st.id === gun.def.ammo) reserve += st.count;
      }
      let txt;
      if (p.reloading) {
        const pct = Math.round((1 - p.reloading.left / p.reloading.total) * 100);
        txt = 'RECARGANDO ' + pct + '%';
      } else if (gun.def.magType) {
        txt = gun.mag
          ? gun.mag.rounds + '/' + gun.mag.def.cap + ' · reserva ' + reserve
          : 'SIN CARGADOR · reserva ' + reserve;
      } else {
        txt = (gun.tube || 0) + '/' + gun.def.tubeCap + ' · reserva ' + reserve;
      }
      this.eqAmmo.textContent = txt;
      this.eqAmmo.classList.remove('hidden');
      this.eqAmmo.classList.toggle('empty', gunRounds(gun) === 0 && !p.reloading);
    } else if (this.eqAmmo) {
      this.eqAmmo.classList.add('hidden');
    }

    // v0.17: linterna — estado del haz, carga y pilas de repuesto
    const fl = flashlightItem(p);
    if (this.eqFlash) {
      if (fl) {
        const reserve = countBatteries(p);
        const pct = Math.round(fl.charge ?? 0);
        this.eqFlash.textContent = (p.flashOn ? 'LINTERNA ON' : 'LINTERNA OFF') +
          ' · ' + pct + '% · pilas ' + reserve;
        this.eqFlash.classList.remove('hidden');
        this.eqFlash.classList.toggle('empty', p.flashOn && pct <= FLASH.lowAt && reserve === 0);
      } else {
        this.eqFlash.classList.add('hidden');
      }
    }

    // prompt de interacción
    const target = g.interactTarget();
    if (target) {
      this.promptEl.textContent = '[E] ' + target.label;
      this.promptEl.classList.remove('hidden');
    } else {
      this.promptEl.classList.add('hidden');
    }

    // pista de controles inicial
    this._hintTimer += 1 / 60;
    if (this._hintTimer > 18) this.hintEl.classList.add('fade');

    this.dmgFlash = Math.max(0, this.dmgFlash - 1 / 60);
  }

  _setBar(name, v, max) {
    const ratio = Math.max(0, Math.min(1, v / max));
    this.bars[name].style.width = (ratio * 100).toFixed(1) + '%';
    this.vals[name].textContent = Math.ceil(Math.max(0, v));
  }
}
