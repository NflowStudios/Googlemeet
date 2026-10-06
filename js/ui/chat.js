/**
 * chat.js — v0.28: CHAT DE SALA.
 *
 * [T] despliega el teclado del chat en plena partida (el mundo NO se
 * detiene: en multijugador la ciudad sigue viva). ENTER envía, ESC lo
 * cierra sin enviar. Mientras se escribe, el juego no recibe ni teclas
 * de movimiento ni de acción (el foco se queda en el campo de texto y
 * las teclas no burbujean al listener del juego).
 *
 * El registro de mensajes vive abajo a la izquierda: las últimas líneas
 * visibles se desvanecen solas (10 s) y vuelven a aparecer al abrir el
 * chat o al llegar algo nuevo. Los eventos del sistema (uniones,
 * caídas, reanimaciones, muertes) también dejan su línea.
 */

import { NET } from '../config.js';

export class ChatUI {
  constructor(game) {
    this.game = game;
    this.logEl = document.getElementById('mp-chat');
    this.inputEl = document.getElementById('mp-chat-input');
    this.formEl = document.getElementById('mp-chat-form');
    this.lines = [];          // {name, color, txt, sys, at}
    this._open = false;
    this._rendered = 0;
    if (this.inputEl) {
      // el foco en el campo se queda con las teclas: no llegan al juego
      this.inputEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this._submit(); }
        else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      });
      this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());
    }
    if (this.formEl) {
      this.formEl.addEventListener('submit', (e) => { e.preventDefault(); this._submit(); });
    }
  }

  get isOpen() { return this._open; }

  /** Abre el chat para escribir (solo con sesión multijugador activa). */
  open() {
    if (!this.game.net || this._open) return;
    this._open = true;
    if (this.formEl) this.formEl.classList.remove('hidden');
    if (this.inputEl) {
      this.inputEl.value = '';
      this.inputEl.maxLength = NET.chatMaxLen;
      setTimeout(() => this.inputEl.focus(), 0);
    }
    // el juego deja de recibir entrada mientras se escribe
    this.game.input.enabled = false;
    this.game.input.keys.clear();
    this.showLog(true);
  }

  /** Cierra el campo de texto (ENTER ya habrá enviado; ESC no envía nada). */
  close() {
    if (!this._open) return;
    this._open = false;
    if (this.formEl) this.formEl.classList.add('hidden');
    if (this.inputEl) this.inputEl.blur();
    if (this.game.input) {
      this.game.input.enabled = !this.game.invUI.isOpen && !this.game.carsUI;
      this.game.input.keys.clear();
    }
  }

  _submit() {
    const txt = (this.inputEl ? this.inputEl.value : '').trim();
    if (txt && this.game.net) {
      this.game.net.sendChat(txt);
      // eco local: TU línea aparece YA en tu registro (el evento no vuelve
      // al originador — el anfitrión lo re-difunde solo al resto)
      const me = this.game.net.roster.find((r) => r.id === this.game.net.myId);
      this.push('TÚ', me ? me.color : '#8ac0e8', txt);
    }
    if (this.inputEl) this.inputEl.value = '';
    this.close();
  }

  /** Un mensaje de un jugador (con su color de camiseta). */
  push(name, color, txt) {
    this._line({ name, color, txt: String(txt || '').slice(0, NET.chatMaxLen), sys: false, at: performance.now() });
  }

  /** Una línea del sistema (uniones, caídas, reanimaciones…). */
  pushSys(txt) {
    this._line({ name: '', color: '#a8aba0', txt: String(txt || ''), sys: true, at: performance.now() });
  }

  _line(l) {
    this.lines.push(l);
    if (this.lines.length > NET.chatHistory) this.lines.splice(0, this.lines.length - NET.chatHistory);
    this.showLog(this._open);
  }

  /** Vuelca las últimas líneas al DOM. `pin`=chat abierto (sin desvanecer). */
  showLog(pin) {
    if (!this.logEl) return;
    const now = performance.now();
    const N = 9;                       // líneas visibles
    const visible = [];
    for (let i = this.lines.length - 1; i >= 0 && visible.length < N; i--) {
      const l = this.lines[i];
      const age = (now - l.at) / 1000;
      if (!pin && age > 10) continue;  // sin el chat abierto: 10 s de vida
      visible.unshift(l);
    }
    let html = '';
    for (const l of visible) {
      const txt = String(l.txt).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (l.sys) {
        html += '<div class="chat-line sys">' + txt + '</div>';
      } else {
        html += '<div class="chat-line"><span class="chat-name" style="color:' + (l.color || '#d8dbd0') +
          '">' + String(l.name).replace(/&/g, '&amp;').replace(/</g, '&lt;') + ':</span> ' + txt + '</div>';
      }
    }
    this.logEl.innerHTML = html;
    this.logEl.classList.toggle('pinned', !!pin);
    this.logEl.classList.remove('hidden');
    clearTimeout(this._hideT);
    if (!pin) {
      this._hideT = setTimeout(() => { if (!this._open) this.logEl.classList.add('hidden'); }, 10000);
    }
  }

  /** Limpia el registro (fin de sesión). */
  clear() {
    this.lines = [];
    if (this.logEl) this.logEl.innerHTML = '';
    if (this.logEl) this.logEl.classList.add('hidden');
    this.close();
  }

  /** Tick de UI (llamado desde hud.update): repinta al desvanecer. */
  update() {
    if (!this._open && this.lines.length) this.showLog(false);
  }
}
