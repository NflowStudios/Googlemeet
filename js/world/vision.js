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

import { VISION, TILE, MAP_W, MAP_H, T, FLASH } from '../config.js';
import { angDiff } from '../utils.js';
import { flashActive, flashRangeMul } from '../systems/flashlight.js';

/** Alcance efectivo del cono en este frame: base × clima (v0.15) × linterna
 *  (v0.17: el haz lo estira de noche, con neblina/lluvia y en interiores). */
function effRange(game) {
  let r = game.weather ? VISION.range * game.weather.visionMul() : VISION.range;
  return r * flashRangeMul(game);
}

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
    // planta de visión: si está subiendo/bajando, la del destino (al llegar
    // coincide; los muros perimetrales son iguales en todas las plantas)
    const vz = player.climb ? player.climb.to : (player.z || 0);

    this.cone.length = 0;
    const n = VISION.coneRays;
    const range = effRange(game);   // v0.15: clima · v0.17: linterna
    this.rangeNow = range;          // v0.17: para el haz visual (render.js)
    for (let i = 0; i <= n; i++) {
      const a = this.aim - VISION.halfAngle + (2 * VISION.halfAngle * i) / n;
      const d = map.castRayZ(px, py, a, range, vz);
      this.cone.push([px + Math.cos(a) * d, py + Math.sin(a) * d]);
    }

    this.near.length = 0;
    const m = VISION.nearRays;
    for (let i = 0; i <= m; i++) {
      const a = (Math.PI * 2 * i) / m;
      const d = Math.min(map.castRayZ(px, py, a, VISION.nearR, vz), VISION.nearR);
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
    const R = range + TILE;   // v0.15: el muestreo de estructura sigue al cono efectivo
    const t0x = Math.max(0, Math.floor((px - R) / TILE));
    const t1x = Math.min(MAP_W - 1, Math.floor((px + R) / TILE));
    const t0y = Math.max(0, Math.floor((py - R) / TILE));
    const t1y = Math.min(MAP_H - 1, Math.floor((py + R) / TILE));
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const t = map.tileAtZ(tx, ty, vz);
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
          const near = map.nearestStripPointZ(tx, ty, px, py, vz);
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
        if (!map.lineClearZ(px, py, cx, cy, vz)) continue;
        this.wallTiles.add(ty * MAP_W + tx);
      }
    }
  }

  /** ¿Está este punto (mundo) visible ahora mismo? */
  isVisible(x, y, game) {
    const { player, map } = game;
    const vz = player.climb ? player.climb.to : (player.z || 0);
    const dx = x - player.x, dy = y - player.y;
    const d = Math.hypot(dx, dy);
    if (d < VISION.nearR) return map.lineClearZ(player.x, player.y, x, y, vz);
    if (d > effRange(game) + 12) return false;   // v0.15: alcance efectivo
    const a = Math.atan2(dy, dx);
    if (Math.abs(angDiff(this.aim, a)) > VISION.halfAngle + 0.14) return false;
    return map.lineClearZ(player.x, player.y, x, y, vz);
  }

  /**
   * Compone la niebla sobre el frame actual: SOLO visión en tiempo real.
   * Sin memoria: lo que no ves AHORA (tu espalda, lo oculto) queda a oscuras
   * (se intuye el terreno, no se "recuerda"), recalculado por frame.
   *
   * La opacidad depende del ciclo día/noche (v0.11): de día la niebla es algo
   * más clara (0.78) y de noche se vuelve opresiva (0.93), interpolada por
   * DayNight.fogAlpha según oscurezca/amanezca.
   */
  render(ctx, game) {
    const { cam, player } = game;
    const f = this.fctx;
    const w = this.fog.width, h = this.fog.height;
    // v0.15: el gradiente del cono termina en el alcance EFECTIVO (clima)
    // v0.17: con el haz encendido el alcance crece aún más (flashRangeMul)
    const range = effRange(game);
    // v0.17: el haz "empuja" la niebla — el cono recalca más y de noche la
    // oscuridad global no estrangula tanto (tope suave FLASH.fogAlphaCap)
    const beam = flashActive(game);

    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.clearRect(0, 0, w, h);
    // Oscuridad con la hora del día: día 78% · noche 93% (petición v0.8/v0.11)
    let fa = game.daynight ? game.daynight.fogAlpha : VISION.fogAlpha;
    if (beam) fa = Math.min(fa, FLASH.fogAlphaCap);
    f.fillStyle = `rgba(3, 5, 3, ${fa.toFixed(3)})`;
    f.fillRect(0, 0, w, h);

    f.globalCompositeOperation = 'destination-out';

    // 1) Visión actual: cono frontal con caída radial
    const ps = cam.worldToScreen(player.x, player.y);
    const grad = f.createRadialGradient(ps.x, ps.y, 12, ps.x, ps.y, Math.max(24, range));
    if (beam) {
      // v0.17: con la linterna el cono abre paso con más contundencia
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.8, 'rgba(0,0,0,0.95)');
      grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    } else {
      grad.addColorStop(0, 'rgba(0,0,0,0.97)');
      grad.addColorStop(0.72, 'rgba(0,0,0,0.88)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    }
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
