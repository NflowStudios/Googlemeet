/**
 * toasts.js — Notificaciones emergentes breves en la parte inferior.
 */

export class Toasts {
  constructor() {
    this.el = document.getElementById('toasts');
  }

  push(text, kind = 'info') {
    if (!this.el) return;
    while (this.el.children.length >= 5) this.el.firstChild.remove();
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.appendChild(d);
    requestAnimationFrame(() => d.classList.add('in'));
    setTimeout(() => d.classList.add('out'), 2400);
    setTimeout(() => d.remove(), 3000);
  }

  clear() {
    if (this.el) this.el.innerHTML = '';
  }
}
