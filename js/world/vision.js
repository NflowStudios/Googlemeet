/**
 * vision.js — Campo de visión en cono, EN TIEMPO REAL.
 *
 * Diseño (a pedido del jugador): la vista existe para OCULTAR lo que está
 * a tus espaldas y que el juego sea más difícil. NO hay memoria espacial
 * ni revelado progresivo: nada se "desbloquea" mientras ves.
 *
 * - Cono de visión con raycast contra paredes/árboles (las ventanas dejan ver).
 * - Radio de percepción inmediata a 360° (periferia mínima junto al cuerpo).
 * - Fuera de ambos: negro absoluto, recalculado desde cero CADA frame.
 * - Los zombis y objetos del suelo solo se dibujan si están EN visión actual.
 */

import { VISION } from '../config.js';
import { angDiff } from '../utils.js';

export class Vision {
  constructor() {
    this.cone = [];    // polígono del cono (coords de mundo)
    this.near = [];    // polígono del círculo cercano (coords de mundo)
    this.aim = 0;

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

  /**
   * Compone la niebla sobre el frame actual: SOLO visión en tiempo real.
   * Sin memoria: lo que no ves AHORA (tu espalda, lo oculto) queda en negro.
   */
  render(ctx, game) {
    const { cam, player } = game;
    const f = this.fctx;
    const w = this.fog.width, h = this.fog.height;

    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.clearRect(0, 0, w, h);
    // Oscuridad casi total: lo no visto queda oculto, sin "recuerdo" alguno
    f.fillStyle = 'rgba(3, 5, 3, 0.99)';
    f.fillRect(0, 0, w, h);

    f.globalCompositeOperation = 'destination-out';

    // 1) Visión actual: cono frontal con caída radial
    const ps = cam.worldToScreen(player.x, player.y);
    const grad = f.createRadialGradient(ps.x, ps.y, 12, ps.x, ps.y, VISION.range);
    grad.addColorStop(0, 'rgba(0,0,0,0.97)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.88)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    f.fillStyle = grad;
    f.beginPath();
    f.moveTo(ps.x, ps.y);
    for (const p of this.cone) {
      const s = cam.worldToScreen(p[0], p[1]);
      f.lineTo(s.x, s.y);
    }
    f.closePath();
    f.fill();

    // 2) Percepción inmediata a 360° (periferia mínima)
    const g2 = f.createRadialGradient(ps.x, ps.y, 2, ps.x, ps.y, VISION.nearR);
    g2.addColorStop(0, 'rgba(0,0,0,0.95)');
    g2.addColorStop(1, 'rgba(0,0,0,0.3)');
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
