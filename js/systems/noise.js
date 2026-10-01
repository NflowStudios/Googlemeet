/**
 * noise.js — Propagación de sonido (sigilo y tensión).
 *
 * Cada acción emite "eventos de ruido" con posición y radio. Los zombis
 * dentro del radio escuchan y van a investigar. Caminar agachado reduce
 * drásticamente el radio; correr lo dispara. Se muestran anillos tenues
 * para que el jugador entienda su propia firma de sonido.
 *
 * v0.15 — CLIMA: `mul` contrae el radio de TODOS los ruidos cuando llueve
 * (−25% a plena intensidad): la lluvia "tapa" el sonido. main.js lo fija
 * cada frame desde weather.noiseMul(); con cielo despejado vale 1. Los
 * anillos visuales y el medidor del HUD usan el radio YA ajustado — lo que
 * ves es lo que oyen.
 */

export class NoiseSystem {
  constructor() {
    this.rings = [];   // efectos visuales {x, y, r, t, life}
    this.frame = [];   // eventos de ruido del frame actual (los consume la IA)
    this.lastLevel = 0; // 0..4 para el medidor del HUD
    this._levelTimer = 0;
    this.mul = 1;      // v0.15: multiplicador climático (lluvia 0.75..1)
  }

  /**
   * @param {number} x posición mundo
   * @param {number} y
   * @param {number} radius radio de audición en px
   * @param {string} kind etiqueta (paso, ataque, puerta…)
   */
  emit(x, y, radius, kind = 'paso') {
    radius *= this.mul;   // v0.15: la lluvia enmascara el sonido (radio menor)
    this.frame.push({ x, y, radius, kind });
    if (radius > 8) {
      this.rings.push({ x, y, r: radius, t: 0, life: 0.55 });
    }
    const lvl = radius > 140 ? 4 : radius > 90 ? 3 : radius > 45 ? 2 : radius > 15 ? 1 : 0;
    if (lvl >= this.lastLevel) {
      this.lastLevel = lvl;
      this._levelTimer = 0.8;
    }
  }

  update(dt) {
    // decaimiento de anillos visuales
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) this.rings.splice(i, 1);
    }
    // medidor del HUD
    this._levelTimer -= dt;
    if (this._levelTimer <= 0) {
      this.lastLevel = Math.max(0, this.lastLevel - 1);
      this._levelTimer = this.lastLevel > 0 ? 0.35 : 0;
    }
  }

  /** Se llama tras la actualización de entidades, antes del siguiente frame. */
  clearFrame() {
    this.frame.length = 0;
  }

  /** Dibuja los anillos tenues del ruido propio del jugador. */
  draw(ctx, cam) {
    ctx.save();
    for (const r of this.rings) {
      const k = r.t / r.life;
      const sx = r.x - cam.x + cam.offX;
      const sy = r.y - cam.y + cam.offY;
      ctx.strokeStyle = `rgba(220, 220, 200, ${0.16 * (1 - k)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r.r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
