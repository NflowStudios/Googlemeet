/**
 * vision.js — Campo de visión en cono, EN TIEMPO REAL.
 *
 * Diseño (a pedido del jugador): la vista existe para OCULTAR lo que está
 * a tus espaldas y que el juego sea más difícil. NO hay memoria espacial
 * ni revelado progresivo: nada se "desbloquea" mientras ves.
 *
 * - Cono de visión con raycast: solo la FRANJA de muros y puertas cerradas
 *   tapa la vista (paredes delgadas: el suelo a ambos lados es transparente).
 *   Árboles y coches NO ocultan nada al jugador (cámara aérea): el cono pasa
 *   por encima de ellos y se distinguen con nitidez.
 * - Radio de percepción inmediata a 360° (periferia mínima junto al cuerpo).
 * - Fuera de ambos: negro absoluto, recalculado desde cero CADA frame.
 * - Los zombis y objetos del suelo solo se dibujan si están EN visión actual.
 * - wallTiles: muros/ventanas/puertas/ÁRBOLES/COCHES con línea de visión
 *   directa AHORA (se redibujan nítidos sobre la niebla en map.drawStructOver).
 *   Así la pared frontal se distingue con claridad, pero el interior de las
 *   casas solo se ve por lo que se cuela por ventanas y puertas abiertas.
 */

import { VISION, TILE, MAP_W, MAP_H, T } from '../config.js';
import { angDiff } from '../utils.js';

export class Vision {
  constructor() {
    this.cone = [];    // polígono del cono (coords de mundo)
    this.near = [];    // polígono del círculo cercano (coords de mundo)
    this.aim = 0;
    // tiles de estructura/props (muro/ventana/puerta/árbol/coche) visibles en este frame
    this.wallTiles = new Set();

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

    // ---- Estructura y props visibles ahora mismo ----
    // Un tile de estructura/props se ve si está dentro del cono (con la holgura
    // de su tamaño angular, para que no quede "a trozos" en el borde) o dentro
    // de la periferia, Y tiene línea de visión directa. Con muros delgados el
    // chequeo apunta a la FRANJA del tile (map.nearestStripPoint): así una
    // pared oculta tras otra no se redibuja. El interior de las casas NO entra
    // aquí: solo lo que se cuela por ventanas / puertas abiertas llega a verse.
    // Sin memoria: se recalcula desde cero cada frame.
    this.wallTiles.clear();
    const R = VISION.range + TILE;
    const t0x = Math.max(0, Math.floor((px - R) / TILE));
    const t1x = Math.min(MAP_W - 1, Math.floor((px + R) / TILE));
    const t0y = Math.max(0, Math.floor((py - R) / TILE));
    const t1y = Math.min(MAP_H - 1, Math.floor((py + R) / TILE));
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const t = map.tileAtIdx(tx, ty);
        if (t !== T.WALL && t !== T.WINDOW && t !== T.DOOR_CLOSED && t !== T.DOOR_OPEN &&
            t !== T.TREE && t !== T.CAR) continue;
        let cx, cy;
        if (t === T.TREE || t === T.CAR) {
          // punto del tile más cercano al jugador: el segmento hasta él no
          // atraviesa el propio tile → lineClear no se auto-bloquea
          const rx = tx * TILE, ry = ty * TILE;
          cx = px < rx ? rx : (px > rx + TILE ? rx + TILE : px);
          cy = py < ry ? ry : (py > ry + TILE ? ry + TILE : py);
        } else {
          // muro delgado: punto más cercano de la(s) franja(s)
          const near = map.nearestStripPoint(tx, ty, px, py);
          if (!near) continue;
          cx = near.x; cy = near.y;
        }
        const dx = cx - px, dy = cy - py;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        if (d > VISION.nearR) {
          const a = Math.atan2(dy, dx);
          const slack = Math.atan2(TILE, Math.max(d, 40)); // tamaño angular del tile
          if (Math.abs(angDiff(this.aim, a)) > VISION.halfAngle + slack) continue;
        }
        if (!map.lineClear(px, py, cx, cy)) continue;
        this.wallTiles.add(ty * MAP_W + tx);
      }
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
   * Sin memoria: lo que no ves AHORA (tu espalda, lo oculto) queda a oscuras
   * (85% de opacidad — se intuye el terreno, no se "recuerda").
   */
  render(ctx, game) {
    const { cam, player } = game;
    const f = this.fctx;
    const w = this.fog.width, h = this.fog.height;

    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.clearRect(0, 0, w, h);
    // Oscuridad al 85% (petición v0.8): lo no visto queda oculto pero se
    // intuye el terreno debajo; sin "recuerdo" alguno, recalculado por frame
    f.fillStyle = `rgba(3, 5, 3, ${VISION.fogAlpha})`;
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
