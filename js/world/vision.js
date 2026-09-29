/**
 * vision.js — Campo de visión en cono + niebla de guerra con memoria espacial.
 *
 * - Cono de visión con raycast contra paredes/árboles (las ventanas dejan ver).
 * - Radio de percepción inmediata a 360° alrededor del jugador.
 * - Memoria: las zonas ya vistas quedan tenuemente recordadas (estilo PZ).
 * - Los zombis y objetos del suelo solo se dibujan si están EN visión actual.
 */

import { VISION } from '../config.js';
import { angDiff } from '../utils.js';

export class Vision {
  constructor() {
    this.cone = [];    // polígono del cono (coords de mundo)
    this.near = [];    // polígono del círculo cercano (coords de mundo)
    this.aim = 0;
    this._memTimer = 0;

    // Canvas de memoria a 1/4 de resolución de mundo
    this.mem = document.createElement('canvas');
    this.mem.width = Math.ceil(3200 / 4);
    this.mem.height = Math.ceil(2560 / 4);
    this.mctx = this.mem.getContext('2d');

    // Canvas de niebla del tamaño del viewport (se redimensiona)
    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d');
  }

  resize(w, h) {
    this.fog.width = w;
    this.fog.height = h;
  }

  /** Recalcula polígonos de visión con raycast. Llamar cada frame. */
  compute(game) {
    const { player, map } = game;
    const px = player.x, py = player.y;
    this.aim = player.angle;

    this.cone.length = 0;
    const n = VISION.coneRays;
    for (let i = 0; i <= n; i++) {
      const a = this.aim - VISION.halfAngle + (2 * VISION.halfAngle * i) / n;
      const d = map.castRay(px, py, a, VISION.range);
      this.cone.push([px + Math.cos(a) * d, py + Math.sin(a) * d]);
    }

    this.near.length = 0;
    const m = VISION.nearRays;
    for (let i = 0; i <= m; i++) {
      const a = (Math.PI * 2 * i) / m;
      const d = Math.min(map.castRay(px, py, a, VISION.nearR), VISION.nearR);
      this.near.push([px + Math.cos(a) * d, py + Math.sin(a) * d]);
    }
  }

  /** ¿Está este punto (mundo) visible ahora mismo? */
  isVisible(x, y, game) {
    const { player, map } = game;
    const dx = x - player.x, dy = y - player.y;
    const d = Math.hypot(dx, dy);
    if (d < VISION.nearR) return map.lineClear(player.x, player.y, x, y);
    if (d > VISION.range + 12) return false;
    const a = Math.atan2(dy, dx);
    if (Math.abs(angDiff(this.aim, a)) > VISION.halfAngle + 0.14) return false;
    return map.lineClear(player.x, player.y, x, y);
  }

  /** Estampa la visión actual en la memoria (llamada throttled). */
  stampMemory(game) {
    const { player } = game;
    const c = this.mctx;
    c.setTransform(0.25, 0, 0, 0.25, 0, 0);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    // cono
    c.beginPath();
    c.moveTo(player.x, player.y);
    for (const p of this.cone) c.lineTo(p[0], p[1]);
    c.closePath();
    c.fill();
    // círculo cercano
    c.beginPath();
    c.moveTo(player.x, player.y);
    for (const p of this.near) c.lineTo(p[0], p[1]);
    c.closePath();
    c.fill();
  }

  update(dt, game) {
    this._memTimer -= dt;
    if (this._memTimer <= 0) {
      this._memTimer = 0.15;
      this.stampMemory(game);
    }
  }

  /** Compone la niebla sobre el frame actual. */
  render(ctx, game) {
    const { cam, player } = game;
    const f = this.fctx;
    const w = this.fog.width, h = this.fog.height;

    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.clearRect(0, 0, w, h);
    f.fillStyle = 'rgba(4, 6, 4, 0.985)';
    f.fillRect(0, 0, w, h);

    f.globalCompositeOperation = 'destination-out';

    // 1) Memoria espacial: zonas ya vistas, ligeramente reveladas
    f.globalAlpha = 0.42;
    f.drawImage(
      this.mem,
      (cam.x - cam.offX) / 4, (cam.y - cam.offY) / 4, w / 4, h / 4,
      0, 0, w, h
    );

    // 2) Visión actual: cono con caída radial
    f.globalAlpha = 1;
    const ps = cam.worldToScreen(player.x, player.y);
    const grad = f.createRadialGradient(ps.x, ps.y, 12, ps.x, ps.y, VISION.range);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    f.fillStyle = grad;
    f.beginPath();
    f.moveTo(ps.x, ps.y);
    for (const p of this.cone) {
      const s = cam.worldToScreen(p[0], p[1]);
      f.lineTo(s.x, s.y);
    }
    f.closePath();
    f.fill();

    // 3) Percepción inmediata a 360°
    const g2 = f.createRadialGradient(ps.x, ps.y, 2, ps.x, ps.y, VISION.nearR);
    g2.addColorStop(0, 'rgba(0,0,0,0.9)');
    g2.addColorStop(1, 'rgba(0,0,0,0.15)');
    f.fillStyle = g2;
    f.beginPath();
    f.moveTo(ps.x, ps.y);
    for (const p of this.near) {
      const s = cam.worldToScreen(p[0], p[1]);
      f.lineTo(s.x, s.y);
    }
    f.closePath();
    f.fill();

    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;

    ctx.drawImage(this.fog, 0, 0, w, h);
  }
}
