/**
 * menus.js — Pantallas de título, pausa y muerte.
 *
 * v0.13: el menú principal ofrece NUEVA PARTIDA y CONTINUAR PARTIDA (solo
 * si hay guardado, con su resumen: día, hora y bajas); el menú de pausa
 * añade GUARDAR Y SALIR AL MENÚ. La muerte borra el guardado (perma-muerte)
 * y la pantalla lo avisa.
 */

import { fmtTime } from '../utils.js';
import { saveSummary } from '../systems/save.js';

const DEATH_TEXT = {
  zombi: 'Los zombis te destrozaron en la calle.',
  hambre: 'Tu estómago vació lo que quedaba de ti. Moriste de hambre.',
  sed: 'La deshidratación cerró tus ojos para siempre.',
  infeccion: 'La infección completó su trabajo. Te has convertido en uno de ellos.',
  intoxicacion: 'Una comida podrida acabó con tu supervivencia.',
};

export class Menus {
  constructor(game) {
    this.game = game;
    this.menuEl = document.getElementById('menu');
    this.deathEl = document.getElementById('deathscreen');
    this.pauseEl = document.getElementById('pausescreen');
    this.contBtn = document.getElementById('btn-continue');
    this.contInfo = document.getElementById('continue-info');
    this.saveGoneEl = document.getElementById('death-savegone');

    document.getElementById('btn-play').addEventListener('click', () => game.startRun());
    document.getElementById('btn-retry').addEventListener('click', () => game.startRun());
    document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
    // v0.13: continuar partida guardada / guardar y salir al menú
    if (this.contBtn) this.contBtn.addEventListener('click', () => game.continueRun());
    const saveQuit = document.getElementById('btn-savequit');
    if (saveQuit) saveQuit.addEventListener('click', () => game.saveAndQuit());
  }

  /** Muestra/oculta CONTINUAR PARTIDA según haya guardado + su resumen. */
  refreshContinue() {
    if (!this.contBtn) return;
    const sum = saveSummary();
    if (sum) {
      this.contBtn.classList.remove('hidden');
      this.contBtn.disabled = false;
      if (this.contInfo) {
        this.contInfo.classList.remove('hidden');
        this.contInfo.textContent =
          'Día ' + sum.day + ' · ' + sum.clock + ' · ' + sum.kills +
          ' baja' + (sum.kills === 1 ? '' : 's') + ' · ' + fmtTime(sum.time) + ' sobrevividos';
      }
    } else {
      this.contBtn.classList.add('hidden');
      this.contBtn.disabled = true;
      if (this.contInfo) this.contInfo.classList.add('hidden');
    }
  }

  showMenu() {
    this.refreshContinue();
    this.menuEl.classList.remove('hidden');
    this.hideDeath();
    this.hidePause();
  }

  hideMenu() { this.menuEl.classList.add('hidden'); }

  showPause() { this.pauseEl.classList.remove('hidden'); }
  hidePause() { this.pauseEl.classList.add('hidden'); }

  showDeath(cause, stats, hadSave = false) {
    const el = this.deathEl;
    el.classList.remove('hidden');
    document.getElementById('death-cause').textContent = DEATH_TEXT[cause] || 'Nadie lo contará.';
    document.getElementById('ds-time').textContent = fmtTime(stats.time);
    document.getElementById('ds-kills').textContent = stats.kills;
    document.getElementById('ds-search').textContent = stats.searched;
    // v0.13: aviso de guardado borrado (solo si había uno que borrar)
    if (this.saveGoneEl) {
      this.saveGoneEl.classList.toggle('hidden', !hadSave);
      this.saveGoneEl.textContent =
        'La partida guardada se ha eliminado: aquí la muerte es definitiva.';
    }
  }

  hideDeath() { this.deathEl.classList.add('hidden'); }

  hideAll() {
    this.hideMenu();
    this.hideDeath();
    this.hidePause();
  }
}
