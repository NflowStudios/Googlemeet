/**
 * camera.js — Cámara con seguimiento suave, anticipación de puntero y shake.
 */

import { clamp, lerp } from '../utils.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;      // esquina superior izquierda en coords de mundo
    this.w = 0; this.h = 0;
    this.shakeMag = 0;
    this._offX = 0; this._offY = 0;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  /** Centra en el jugador con leve anticipación hacia el puntero. */
  follow(player, aimX, aimY, dt) {
    const lookX = clamp((aimX - player.x) * 0.12, -70, 70);
    const lookY = clamp((aimY - player.y) * 0.12, -70, 70);
    const tx = player.x + lookX - this.w / 2;
    const ty = player.y + lookY - this.h / 2;
    const k = 1 - Math.pow(0.0015, dt); // suavizado exponencial independiente de fps
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
  }

  shake(mag) {
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  updateShake(dt) {
    this.shakeMag = Math.max(0, this.shakeMag - dt * 14);
    const m = this.shakeMag;
    this._offX = (Math.random() * 2 - 1) * m;
    this._offY = (Math.random() * 2 - 1) * m;
  }

  get offX() { return this._offX; }
  get offY() { return this._offY; }

  worldToScreen(wx, wy) {
    return { x: Math.round(wx - this.x + this._offX), y: Math.round(wy - this.y + this._offY) };
  }

  screenToWorld(sx, sy) {
    return { x: sx + this.x - this._offX, y: sy + this.y - this._offY };
  }
}
