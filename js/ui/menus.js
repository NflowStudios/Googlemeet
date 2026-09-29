/**
 * menus.js — Pantallas de título, pausa y muerte.
 */

import { fmtTime } from '../utils.js';

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

    document.getElementById('btn-play').addEventListener('click', () => game.startRun());
    document.getElementById('btn-retry').addEventListener('click', () => game.startRun());
    document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
  }

  showMenu() {
    this.menuEl.classList.remove('hidden');
    this.hideDeath();
    this.hidePause();
  }

  hideMenu() { this.menuEl.classList.add('hidden'); }

  showPause() { this.pauseEl.classList.remove('hidden'); }
  hidePause() { this.pauseEl.classList.add('hidden'); }

  showDeath(cause, stats) {
    const el = this.deathEl;
    el.classList.remove('hidden');
    document.getElementById('death-cause').textContent = DEATH_TEXT[cause] || 'Nadie lo contará.';
    document.getElementById('ds-time').textContent = fmtTime(stats.time);
    document.getElementById('ds-kills').textContent = stats.kills;
    document.getElementById('ds-search').textContent = stats.searched;
  }

  hideDeath() { this.deathEl.classList.add('hidden'); }

  hideAll() {
    this.hideMenu();
    this.hideDeath();
    this.hidePause();
  }
}
