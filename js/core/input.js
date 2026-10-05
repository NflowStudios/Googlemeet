/**
 * input.js — Gestión de teclado y ratón.
 * Las teclas de acción (E, Tab, C, P, F, M, Esc) se despachan por evento;
 * el movimiento se consulta por polling (estado de teclas).
 */

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    this.onAction = null; // callback(name) despachado desde keydown
    this.enabled = true;  // false cuando hay UI abierta (inventario, menús)
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(name: string) => void} onAction callback para teclas de acción
   */
  attach(canvas, onAction) {
    this.onAction = onAction;

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === ' ' ) e.preventDefault();
      if (e.repeat) return;
      // normalización: algunos entornos/teclados envían code vacío
      const code = e.code || (e.key && e.key.length === 1 ? 'Key' + e.key.toUpperCase() : e.key);
      this.keys.add(code);
      const map = {
        'KeyE': 'interact', 'Tab': 'inventory', 'KeyI': 'inventory',
        'KeyC': 'sneak', 'KeyP': 'pause', 'KeyM': 'mute',
        'KeyF': 'attack', 'KeyR': 'reload', 'Escape': 'escape', 'Enter': 'enter',
        'KeyL': 'flash',   // v0.17: encender / apagar la linterna (faros en el coche)
        'KeyQ': 'inspect', // v0.26: inspeccionar el coche más cercano
        'Digit1': 'hot1', 'Digit2': 'hot2', 'Digit3': 'hot3', 'Digit4': 'hot4', 'Digit5': 'hot5',
        'Numpad1': 'hot1', 'Numpad2': 'hot2', 'Numpad3': 'hot3', 'Numpad4': 'hot4', 'Numpad5': 'hot5',
      };
      const action = map[e.code] || map[code];
      if (action && this.onAction) this.onAction(action);
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code || (e.key && e.key.length === 1 ? 'Key' + e.key.toUpperCase() : e.key);
      this.keys.delete(code);
    });
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        if (this.onAction && this.enabled) this.onAction('attack');
      } else if (e.button === 2) {
        // v0.20: clic derecho — confirma la colocación en modo construcción
        if (this.onAction && this.enabled) this.onAction('place');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Vector de movimiento normalizado según teclas (-1..1). */
  moveAxis() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv; y *= inv;
    }
    return { x, y };
  }

  isDown(code) { return this.keys.has(code); }
}
