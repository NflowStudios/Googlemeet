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
 *
 * v0.24 — PROFESIONES: toda partida NUEVA pasa primero por la pantalla de
 * selección (QUIÉN ERAS): cinco profesiones con bonificación pasiva que se
 * elige UNA vez y no se puede cambiar. El menú de ranuras muestra la
 * profesión de cada guardado; la pausa y el obituario también.
 */

import { fmtTime } from '../utils.js';
import { listSlots, clearSave, SAVE_SLOTS, getRecords } from '../systems/save.js';
import { PROFESSIONS, PROF_BY_ID } from '../config.js';

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

    // v0.24: pantalla de SELECCIÓN DE PROFESIÓN (toda partida nueva pasa
    // por aquí: NUEVA PARTIDA, REINTENTAR tras la muerte, ENTER sin ranuras)
    this.profEl = document.getElementById('profscreen');
    this._profSlot = 1;      // ranura en espera de profesión
    this._profSel = null;    // profesión elegida (aún sin arrancar)
    this._bindProfScreen();

    // reintento de la muerte → MISMA ranura (su guardado ya se borró);
    // v0.24: es partida NUEVA → pasa por la selección de profesión
    document.getElementById('btn-retry').addEventListener('click', () => this.showProfSelect(game.saveSlot));
    document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
    const saveQuit = document.getElementById('btn-savequit');
    if (saveQuit) saveQuit.addEventListener('click', () => game.saveAndQuit());
  }

  // ================== v0.24: selección de profesión ==================

  /** ¿La pantalla de elección de profesión está abierta? */
  get profOpen() { return !!this.profEl && !this.profEl.classList.contains('hidden'); }

  _bindProfScreen() {
    const back = document.getElementById('btn-prof-back');
    if (back) back.addEventListener('click', () => this.hideProfSelect());
    const start = document.getElementById('btn-prof-start');
    if (start) start.addEventListener('click', () => this.confirmProf());
  }

  /** Abre la selección de profesión para crear partida nueva en `slot`. */
  showProfSelect(slot) {
    if (!this.profEl) { this.game.startRun(slot || 1, null); return; }   // red de seguridad
    this._profSlot = Math.min(3, Math.max(1, slot || 1));
    this._profSel = null;
    const sub = document.getElementById('prof-sub');
    if (sub) sub.textContent = 'RANURA ' + this._profSlot +
      ' · quién eras antes del apocalipsis — se elige UNA vez y NO se puede cambiar';
    this._renderProfCards();
    this.profEl.classList.remove('hidden');
  }

  /** Tarjetas de las 5 profesiones (desde config: si el balance cambia,
   *  la pantalla se actualiza sola, como la enciclopedia). */
  _renderProfCards() {
    const list = document.getElementById('prof-list');
    if (!list) return;
    let html = '';
    for (const pr of PROFESSIONS) {
      html += '' +
        '<div class="prof-card" data-prof="' + pr.id + '" style="border-left-color:' + pr.color + '">' +
          '<div class="pc-head">' +
            '<span class="pc-icon" style="background:' + pr.color + '"></span>' +
            '<span class="pc-name">' + pr.name + '</span>' +
          '</div>' +
          '<p class="pc-tag">' + pr.tagline + '</p>' +
          '<p class="pc-desc">' + pr.desc + '</p>' +
          '<div class="pc-perks">' +
            pr.perks.map((p) => '<span class="ec-chip' + (pr.id === 'desempleado' ? '' : ' ok') + '">' + p + '</span>').join('') +
          '</div>' +
        '</div>';
    }
    list.innerHTML = html;
    for (const el of list.querySelectorAll('.prof-card')) {
      el.addEventListener('click', () => this._pickProf(el.dataset.prof));
    }
    const start = document.getElementById('btn-prof-start');
    if (start) { start.disabled = true; start.textContent = 'COMENZAR LA PARTIDA'; }
    const hint = document.getElementById('prof-hint');
    if (hint) hint.textContent =
      'Elige quién eras para ver su bonificación — ENTER (o COMENZAR) arranca la partida.';
  }

  /** Marca una tarjeta como elegida y arma el botón de COMENZAR. */
  _pickProf(id) {
    this._profSel = id;
    const list = document.getElementById('prof-list');
    if (list) for (const el of list.querySelectorAll('.prof-card')) {
      el.classList.toggle('sel', el.dataset.prof === id);
    }
    const d = PROF_BY_ID[id];
    const start = document.getElementById('btn-prof-start');
    if (start) { start.disabled = false; start.textContent = 'COMENZAR COMO ' + d.name.toUpperCase(); }
    const hint = document.getElementById('prof-hint');
    if (hint) hint.textContent = d.name + ' — ' + d.perks[0] +
      '. La bonificación es pasiva y para TODA la partida: no se puede cambiar.';
  }

  /** ENTER / COMENZAR: arranca la partida nueva con la profesión elegida. */
  confirmProf() {
    if (!this.profOpen || !this._profSel) return;
    const slot = this._profSlot, prof = this._profSel;
    this.hideProfSelect();
    this.game.startRun(slot, prof);
  }

  hideProfSelect() { if (this.profEl) this.profEl.classList.add('hidden'); }

  /** v0.24: toast de arranque con el bono de la profesión elegida. */
  toastProfession(id) {
    const d = PROF_BY_ID[id];
    if (d && this.game.toasts) {
      this.game.toasts.push('Profesión: ' + d.name + ' — ' + d.perks[0], 'save');
    }
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
      // v0.24: la ranura muestra la PROFESIÓN de esa partida (si la tenía)
      const profTxt = sum && sum.prof && PROF_BY_ID[sum.prof]
        ? PROF_BY_ID[sum.prof].name.toUpperCase() + ' · ' : '';
      const detail = sum
        ? profTxt + sum.clock + ' · ' + sum.kills + ' baja' + (sum.kills === 1 ? '' : 's') +
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

    // jugar: continuar si hay guardado, partida nueva (con PROFESIÓN) si está vacía
    for (const b of this.slotsList.querySelectorAll('.slot-btn.play')) {
      b.addEventListener('click', () => {
        const s = +b.dataset.slot;
        if (listSlots()[s - 1]) this.game.continueRun(s);
        else this.showProfSelect(s);   // v0.24: nueva partida → elige quién eras
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

  showPause() {
    this.pauseEl.classList.remove('hidden');
    // v0.24: la profesión de la partida en curso, siempre a la vista en la pausa
    const el = document.getElementById('pause-prof');
    if (el) {
      const d = this.game.player && this.game.player.prof && PROF_BY_ID[this.game.player.prof];
      el.textContent = d
        ? 'PROFESIÓN: ' + d.name.toUpperCase() + ' — ' + d.perks[0]
        : 'PROFESIÓN: — (partida sin profesión)';
    }
  }
  hidePause() { this.pauseEl.classList.add('hidden'); }

  showDeath(cause, stats, hadSave = false, records = null) {
    const el = this.deathEl;
    el.classList.remove('hidden');
    document.getElementById('death-cause').textContent = DEATH_TEXT[cause] || 'Nadie lo contará.';
    // v0.24: el obituario firma con la profesión de la partida
    const profEl = document.getElementById('ds-prof');
    if (profEl) {
      const d = stats.prof && PROF_BY_ID[stats.prof];
      profEl.textContent = d ? 'PROFESIÓN: ' + d.name.toUpperCase() + ' — ' + d.perks[0] : '';
      profEl.classList.toggle('hidden', !d);
    }
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
    this.hideProfSelect();   // v0.24: sin selección pendiente al esconderlo todo
    this._disarmDelete();
  }
}
