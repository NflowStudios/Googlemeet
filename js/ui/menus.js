/**
 * menus.js — Pantallas de título, pausa y muerte + RANURAS DE PARTIDA.
 *
 * v0.22 — TRES RANURAS: el menú principal ya no tiene un único botón
 * CONTINUAR: muestra tres tarjetas de ranura independientes. Una ranura
 * vacía ofrece NUEVA PARTIDA; una ocupada muestra su resumen (día, hora,
 * bajas, tiempo) con CONTINUAR y ELIMINAR. El borrado pide CONFIRMACIÓN
 * en dos pasos (el botón se arma en rojo «¿SEGURO?» durante 4 s) para
 * evitar el borrado accidental — sin diálogos nativos del navegador.
 *
 * La muerte sigue siendo definitiva, pero solo borra LA RANURA con la que
 * se jugaba; REINTENTAR arranca partida nueva en esa misma ranura y ENTER
 * continúa la partida más reciente.
 */

import { fmtTime } from '../utils.js';
import { listSlots, clearSave, SAVE_SLOTS, getRecords } from '../systems/save.js';

const DEATH_TEXT = {
  zombi: 'Los zombis te destrozaron en la calle.',
  hambre: 'Tu estómago vació lo que quedaba de ti. Moriste de hambre.',
  sed: 'La deshidratación cerró tus ojos para siempre.',
  infeccion: 'La infección completó su trabajo. Te has convertido en uno de ellos.',
  intoxicacion: 'Una comida podrida acabó con tu supervivencia.',
  quemadura: 'Las llamas que encendiste te reclamaron. Moriste calcinado.',   // v0.23
};

const HINT_DEFAULT = 'Tres ranuras independientes · la muerte borra SOLO la ranura con la que jugabas · autoguardado cada 5 min';

/** v0.23: metros recorridos (1 tile = 1 m) con formato español. */
function fmtDist(px) {
  const m = px / 32;
  return m >= 1000
    ? (m / 1000).toFixed(1).replace('.', ',') + ' km'
    : Math.round(m) + ' m';
}

export class Menus {
  constructor(game) {
    this.game = game;
    this.menuEl = document.getElementById('menu');
    this.deathEl = document.getElementById('deathscreen');
    this.pauseEl = document.getElementById('pausescreen');
    this.saveGoneEl = document.getElementById('death-savegone');
    this.slotsList = document.getElementById('slots-list');
    this.slotsHint = document.querySelector('.slots-hint');

    // confirmación de borrado en 2 pasos (botón armado + auto-desarme)
    this._delArm = null;
    this._delTimer = 0;

    // reintento de la muerte → MISMA ranura (su guardado ya se borró)
    document.getElementById('btn-retry').addEventListener('click', () => game.startRun(game.saveSlot));
    document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
    const saveQuit = document.getElementById('btn-savequit');
    if (saveQuit) saveQuit.addEventListener('click', () => game.saveAndQuit());
  }

  // ================== v0.22: ranuras ==================

  /** Redibuja las 3 tarjetas de ranura según los guardados actuales. */
  renderSlots() {
    if (!this.slotsList) return;
    this._disarmDelete();
    const sums = listSlots();

    let html = '';
    for (let s = 1; s <= SAVE_SLOTS; s++) {
      const sum = sums[s - 1];
      const detail = sum
        ? sum.clock + ' · ' + sum.kills + ' baja' + (sum.kills === 1 ? '' : 's') +
          ' · ' + fmtTime(sum.time) + ' sobrevividos'
        : '— vacía — aquí puede nacer una nueva partida —';
      html += '' +
        '<div class="slot-row' + (sum ? '' : ' empty') + '" data-slot="' + s + '">' +
          '<span class="slot-num">' + s + '</span>' +
          '<div class="slot-main">' +
            '<span class="slot-name">RANURA ' + s + (sum ? ' · DÍA ' + sum.day : '') + '</span>' +
            '<span class="slot-sum">' + detail + '</span>' +
          '</div>' +
          '<div class="slot-actions">' +
            '<button class="slot-btn play" data-slot="' + s + '">' +
              (sum ? 'CONTINUAR' : 'NUEVA PARTIDA') +
            '</button>' +
            (sum ? '<button class="slot-btn del" data-slot="' + s + '">ELIMINAR</button>' : '') +
          '</div>' +
        '</div>';
    }
    this.slotsList.innerHTML = html;

    // jugar: continuar si hay guardado, partida nueva si está vacía
    for (const b of this.slotsList.querySelectorAll('.slot-btn.play')) {
      b.addEventListener('click', () => {
        const s = +b.dataset.slot;
        if (listSlots()[s - 1]) this.game.continueRun(s);
        else this.game.startRun(s);
      });
    }
    // eliminar: confirmación en dos pasos
    for (const b of this.slotsList.querySelectorAll('.slot-btn.del')) {
      b.addEventListener('click', () => this._onDelete(b));
    }
  }

  /** Primer clic: arma el botón («¿SEGURO?») 4 s. Segundo clic: borra. */
  _onDelete(btn) {
    if (btn.classList.contains('armed')) {
      const s = +btn.dataset.slot;
      clearSave(s);
      if (this.game.audio && this.game.audio.uiClick) this.game.audio.uiClick();
      if (this.slotsHint) this.slotsHint.textContent = 'Ranura ' + s + ' eliminada.';
      this.renderSlots();
      return;
    }
    this._disarmDelete();
    btn.classList.add('armed');
    btn.textContent = '¿SEGURO?';
    btn.title = 'Pulsa OTRA VEZ para eliminar esta partida';
    if (this.slotsHint) {
      this.slotsHint.textContent = '¿Eliminar la partida de la ranura ' + btn.dataset.slot +
        '? Pulsa el botón otra vez para confirmar.';
    }
    this._delArm = btn;
    this._delTimer = setTimeout(() => this._disarmDelete(), 4000);
  }

  /** Desarma la confirmación pendiente (timeout, re-render o cierre). */
  _disarmDelete() {
    if (this._delTimer) { clearTimeout(this._delTimer); this._delTimer = 0; }
    if (this._delArm) {
      this._delArm.classList.remove('armed');
      this._delArm.textContent = 'ELIMINAR';
      this._delArm.title = '';
      this._delArm = null;
    }
    if (this.slotsHint) this.slotsHint.textContent = HINT_DEFAULT;
  }

  // ================== pantallas ==================

  /** v0.23: línea de RÉCORDS acumulados bajo las ranuras del menú. */
  renderRecords() {
    const el = document.getElementById('slots-records');
    if (!el) return;
    const r = getRecords();
    el.textContent = r.runs === 0
      ? 'RÉCORDS — ninguna partida acabada todavía: tu primer obituario abrirá la cuenta'
      : 'RÉCORDS — ' + r.runs + ' partida' + (r.runs === 1 ? '' : 's') + ' · mejor: día ' +
          r.bestDay + ' · ' + r.bestKills + ' bajas · ' + fmtTime(r.bestTime) +
          ' · ' + r.totalKills + ' bajas acumuladas';
  }

  showMenu() {
    this.renderSlots();
    this.renderRecords();
    this.menuEl.classList.remove('hidden');
    this.hideDeath();
    this.hidePause();
  }

  hideMenu() { this.menuEl.classList.add('hidden'); }

  showPause() { this.pauseEl.classList.remove('hidden'); }
  hidePause() { this.pauseEl.classList.add('hidden'); }

  showDeath(cause, stats, hadSave = false, records = null) {
    const el = this.deathEl;
    el.classList.remove('hidden');
    document.getElementById('death-cause').textContent = DEATH_TEXT[cause] || 'Nadie lo contará.';
    // v0.23: OBITUARIO completo — días, tiempo, bajas, disparos,
    // construcciones y odómetro (antes: solo tiempo/bajas/registrados)
    const st = stats.stats || {};
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('ds-day', stats.day || 1);
    set('ds-time', fmtTime(stats.time));
    set('ds-kills', stats.kills);
    set('ds-shots', st.shots | 0);
    set('ds-built', st.built | 0);
    set('ds-dist', fmtDist(st.dist || 0));
    set('ds-search', stats.searched);
    // récords acumulados (los acaba de actualizar main.onDeath)
    const recEl = document.getElementById('ds-records');
    if (recEl) {
      const r = records || getRecords();
      const isNew = (stats.day || 1) >= r.bestDay && stats.kills >= r.bestKills && r.runs > 1;
      recEl.textContent = 'RÉCORDS — ' + r.runs + ' partida' + (r.runs === 1 ? '' : 's') +
        ' · mejor: día ' + r.bestDay + ' · ' + r.bestKills + ' bajas · ' + fmtTime(r.bestTime) +
        (r.totalKills ? ' · ' + r.totalKills + ' bajas acumuladas en total' : '') +
        (isNew ? ' · ¡NUEVO RÉCORD!' : '');
    }
    // v0.13/v0.22: aviso de guardado borrado (solo si esa ranura tenía uno)
    if (this.saveGoneEl) {
      this.saveGoneEl.classList.toggle('hidden', !hadSave);
      this.saveGoneEl.textContent =
        'La partida de esta ranura se ha eliminado: aquí la muerte es definitiva. Tus otras ranuras siguen a salvo.';
    }
  }

  hideDeath() { this.deathEl.classList.add('hidden'); }

  hideAll() {
    this.hideMenu();
    this.hideDeath();
    this.hidePause();
    this._disarmDelete();
  }
}
