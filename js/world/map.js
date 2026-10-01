/**
 * map.js — Mapa urbano procedural + colisiones + raycast de visión + decals.
 *
 * Genera: retícula de calles con aceras, manzanas con casas (paredes DELGADAS,
 * ventanas translúcidas a la visión, puertas abribles, muros interiores),
 * contenedores de botín, árboles, coches abandonados y puntos de aparición.
 *
 * Muros delgados (WALL_T): muros/ventanas/puertas son una FRANJA centrada en
 * el tile que corre a lo largo de la línea de muro; el resto del tile es suelo
 * real (exterior/interior) transitable y transparente. La colisión, la visión
 * y el arte comparten esta geometría (ver _runsFor / _inRuns / _drawStructStrips).
 */

import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T, SOLID, OPAQUE, AI_OPAQUE, VISION, WALL_T, ROOF, FLOORS, SPECIALS } from '../config.js';
import { Rng } from '../rng.js';
import { hash2, angDiff } from '../utils.js';

// v0.16: mapa ampliado al DOBLE → 7 columnas × 6 filas de manzanas útiles
// (184×148 tiles · 27.232 m² · 5.888×4.736 px). Calles de 4 tiles con
// márgenes de hierba/acera de 1 a cada lado (huecos de 6 entre manzanas).
const V_ROADS = [[16, 19], [46, 49], [76, 79], [106, 109], [136, 139], [166, 169]]; // bandas verticales [ini, fin] inclusive
const H_ROADS = [[14, 17], [42, 45], [70, 73], [98, 101], [126, 129]];  // bandas horizontales
const X_BLOCKS = [[1, 14], [21, 44], [51, 74], [81, 104], [111, 134], [141, 164], [171, 182]];
const Y_BLOCKS = [[1, 12], [19, 40], [47, 68], [75, 96], [103, 124], [131, 146]];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.index(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class GameMap {
  /** @param {Rng} rng */
  constructor(rng) {
    this.rng = rng;
    this.tiles = new Uint8Array(MAP_W * MAP_H); // GRASS por defecto (0)
    this.trees = [];        // {x, y, r} (centro px, radio de copa)
    this.cars = [];         // {x, y, w, h, color}
    this.treeByTile = new Map(); // idx de tile → objeto árbol (redraw nítido)
    this.carByTile = new Map();  // idx de tile (2 por coche) → objeto coche
    this.containers = [];   // {type, name, x, y, color, letter, searched, z}
    this.buildings = [];    // {x0, y0, x1, y1, cx, cy, upper, basement, stairs}
    this.doors = [];        // {tx, ty}
    // índice rápido tile → edificio (para el despacho por planta z)
    this._bIdx = new Int16Array(MAP_W * MAP_H).fill(-1);
    // Pintura vial PRECALCULADA en coordenadas de mundo (rects {x, y, w, h, c}):
    // línea central discontinua, líneas de borde y pasos de cebra. Al estar
    // anclada al mundo (no a la pantalla), las marcas NUNCA se deslizan sobre
    // el asfalto al mover la cámara.
    this.roadPaint = [];    // rects de pintura vial
    this.manholes = [];     // tapas de alcantarilla {x, y}
    this.outdoorTiles = []; // índices de tiles exteriores caminables
    this.indoorTiles = [];  // índices de tiles de interior
    this.spawn = { x: 0, y: 0 };
    // v0.13: registro de decals (sangre/cadáveres) para REPRODUCIRLOS al
    // cargar una partida guardada (el canvas de decals no es serializable).
    this.decalOps = [];     // {t:'corpse'|'blood', x, y, a?, b?}

    // Canvas de decals (sangre/cadáveres) a media resolución de mundo
    this.decalCanvas = document.createElement('canvas');
    this.decalCanvas.width = WORLD_W / 2;
    this.decalCanvas.height = WORLD_H / 2;
    this.dctx = this.decalCanvas.getContext('2d');

    this._generate();
  }

  // ================== Acceso a tiles ==================

  idx(tx, ty) { return ty * MAP_W + tx; }

  tileAtIdx(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T.WALL;
    return this.tiles[this.idx(tx, ty)];
  }

  tileAt(px, py) {
    return this.tileAtIdx(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  setTile(tx, ty, val) {
    if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H) this.tiles[this.idx(tx, ty)] = val;
  }

  isSolidPx(x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return true;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const t = this.tiles[this.idx(tx, ty)];
    if (t === T.TREE || t === T.CAR) return true;      // tile lleno
    if (SOLID.has(t)) return this._inRuns(tx, ty, x, y); // franja delgada
    return false;
  }

  /** forAI=true → usa AI_OPAQUE: árboles/coches tapan la vista de los zombis
   *  (cobertura de sigilo) pero NO la del jugador, que los ve desde arriba.
   *  Muros y puertas cerradas tapan SOLO en su franja delgada: las bandas de
   *  suelo a ambos lados del muro son transparentes. */
  isOpaquePx(x, y, forAI = false) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return true;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const t = this.tiles[this.idx(tx, ty)];
    if (OPAQUE.has(t)) return this._inRuns(tx, ty, x, y); // franja delgada
    if (forAI && AI_OPAQUE.has(t) && !OPAQUE.has(t)) return true; // árbol/coche
    return false;
  }

  // ================== Geometría de muros delgados ==================

  /** ¿El tile (tx, ty) es parte de una línea de muro (muro/ventana/puerta)? */
  _isStructTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    const t = this.tiles[this.idx(tx, ty)];
    return t === T.WALL || t === T.WINDOW || t === T.DOOR_CLOSED || t === T.DOOR_OPEN;
  }

  /** Franjas del tile: {h, v} normalizado. h = el muro corre de izquierda a
   *  derecha (vecino struct a los lados); v = de arriba a abajo. Un tile
   * aislado sin vecinos → cruz (ambas). Esquinas/T usan las dos. */
  _runsFor(tx, ty) {
    const h = this._isStructTile(tx - 1, ty) || this._isStructTile(tx + 1, ty);
    const v = this._isStructTile(tx, ty - 1) || this._isStructTile(tx, ty + 1);
    return { h: h || !v, v: v || !h };
  }

  /** ¿El punto (px, py) cae dentro de una franja de muro del tile (tx, ty)? */
  _inRuns(tx, ty, px, py) {
    const r = this._runsFor(tx, ty);
    const off = (TILE - WALL_T) / 2;
    const ox = tx * TILE, oy = ty * TILE;
    if (r.h && px >= ox && px <= ox + TILE && py >= oy + off && py <= oy + off + WALL_T) return true;
    if (r.v && px >= ox + off && px <= ox + off + WALL_T && py >= oy && py <= oy + TILE) return true;
    return false;
  }

  /** Punto más cercano del jugador a la(s) franja(s) de un tile de estructura
   *  (para el chequeo de línea de visión de vision.js). Null si no hay franja. */
  nearestStripPoint(tx, ty, px, py) {
    const r = this._runsFor(tx, ty);
    const off = (TILE - WALL_T) / 2;
    const ox = tx * TILE, oy = ty * TILE;
    let best = null, bd = Infinity;
    const cand = (rx, ry, rw, rh) => {
      const cx = Math.max(rx, Math.min(px, rx + rw));
      const cy = Math.max(ry, Math.min(py, ry + rh));
      const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    };
    if (r.h) cand(ox, oy + off, TILE, WALL_T);
    if (r.v) cand(ox + off, oy, WALL_T, TILE);
    return best;
  }

  // ================== Colisión círculo vs tiles ==================

  _circleRectHit(x, y, r, rx, ry, rw, rh) {
    // punto más cercano del rect al centro del círculo
    const cx = Math.max(rx, Math.min(x, rx + rw));
    const cy = Math.max(ry, Math.min(y, ry + rh));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy < r * r;
  }

  circleHitsSolid(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    const off = (TILE - WALL_T) / 2;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const oob = tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H;
        if (oob) { // fuera del mapa: tile macizo
          if (this._circleRectHit(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
          continue;
        }
        const t = this.tiles[this.idx(tx, ty)];
        if (t === T.TREE || t === T.CAR) { // tile lleno
          if (this._circleRectHit(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
          continue;
        }
        if (t !== T.WALL && t !== T.WINDOW && t !== T.DOOR_CLOSED) continue;
        // muro delgado: colisiona solo la franja
        const runs = this._runsFor(tx, ty);
        const ox = tx * TILE, oy = ty * TILE;
        if (runs.h && this._circleRectHit(x, y, r, ox, oy + off, TILE, WALL_T)) return true;
        if (runs.v && this._circleRectHit(x, y, r, ox + off, oy, WALL_T, TILE)) return true;
      }
    }
    return false;
  }

  /** Mueve un círculo con colisión por ejes separados (paso de 1px). z=0 por defecto. */
  moveCircle(obj, dx, dy, z = 0) {
    if (dx !== 0) {
      const sign = Math.sign(dx);
      let remain = Math.abs(dx);
      while (remain > 0) {
        const step = Math.min(1, remain);
        const nx = obj.x + sign * step;
        if (this.circleHitsSolidZ(nx, obj.y, obj.r, z)) break;
        obj.x = nx;
        remain -= step;
      }
    }
    if (dy !== 0) {
      const sign = Math.sign(dy);
      let remain = Math.abs(dy);
      while (remain > 0) {
        const step = Math.min(1, remain);
        const ny = obj.y + sign * step;
        if (this.circleHitsSolidZ(obj.x, ny, obj.r, z)) break;
        obj.y = ny;
        remain -= step;
      }
    }
  }

  // ================== Raycast de visión ==================

  /** Lanza un rayo y devuelve la distancia recorrida antes de chocar algo opaco. */
  castRay(x, y, ang, maxDist) {
    const step = 4;
    const c = Math.cos(ang), s = Math.sin(ang);
    let d = 0;
    while (d < maxDist) {
      d += step;
      if (this.isOpaquePx(x + c * d, y + s * d)) return d;
    }
    return maxDist;
  }

  /** ¿Línea recta despejada entre dos puntos? (forAI → árboles/coches tapan) */
  lineClear(x1, y1, x2, y2, forAI = false) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d < 1) return true;
    const step = 6;
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.isOpaquePx(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, forAI)) return false;
    }
    return true;
  }

  // ================== Plantas (z): 2º piso y sótanos ==================
  // El jugador tiene una "planta" z: 0 = calle/planta baja, 1 = 2º piso,
  // -1 = sótano. Dentro de un edificio con planta extra, TODA consulta de
  // tiles (colisión, visión, arte) se despacha a la rejilla de ESA planta;
  // fuera del edificio manda la rejilla principal. Los zombis viven en z=0.

  /** Edificio que contiene un tile (o null si no hay edificio ahí). */
  buildingAtTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return null;
    const id = this._bIdx[this.idx(tx, ty)];
    return id >= 0 ? this.buildings[id] : null;
  }

  /** Edificio que contiene un punto en px (o null). */
  buildingAtPx(x, y) {
    return this.buildingAtTile(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /** Tile por COORDS DE REJILLA con despacho de planta. z=0 → rejilla principal. */
  tileAtZ(tx, ty, z) {
    if (!z) return this.tileAtIdx(tx, ty);
    const b = this.buildingAtTile(tx, ty);
    if (!b) return this.tileAtIdx(tx, ty);
    const fl = z > 0 ? b.upper : b.basement;
    if (!fl) return this.tileAtIdx(tx, ty);
    const lx = tx - b.x0, ly = ty - b.y0;
    if (lx < 0 || ly < 0 || lx >= fl.w || ly >= fl.h) return T.WALL;
    return fl.tiles[ly * fl.w + lx];
  }

  _isStructTileZ(tx, ty, z) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
    const t = this.tileAtZ(tx, ty, z);
    return t === T.WALL || t === T.WINDOW || t === T.DOOR_CLOSED || t === T.DOOR_OPEN;
  }

  _runsForZ(tx, ty, z) {
    const h = this._isStructTileZ(tx - 1, ty, z) || this._isStructTileZ(tx + 1, ty, z);
    const v = this._isStructTileZ(tx, ty - 1, z) || this._isStructTileZ(tx, ty + 1, z);
    return { h: h || !v, v: v || !h };
  }

  _inRunsZ(tx, ty, px, py, z) {
    const r = this._runsForZ(tx, ty, z);
    const off = (TILE - WALL_T) / 2;
    const ox = tx * TILE, oy = ty * TILE;
    if (r.h && px >= ox && px <= ox + TILE && py >= oy + off && py <= oy + off + WALL_T) return true;
    if (r.v && px >= ox + off && px <= ox + off + WALL_T && py >= oy && py <= oy + TILE) return true;
    return false;
  }

  nearestStripPointZ(tx, ty, px, py, z) {
    const r = this._runsForZ(tx, ty, z);
    const off = (TILE - WALL_T) / 2;
    const ox = tx * TILE, oy = ty * TILE;
    let best = null, bd = Infinity;
    const cand = (rx, ry, rw, rh) => {
      const cx = Math.max(rx, Math.min(px, rx + rw));
      const cy = Math.max(ry, Math.min(py, ry + rh));
      const d = (cx - px) * (cx - px) + (cy - py) * (cy - py);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    };
    if (r.h) cand(ox, oy + off, TILE, WALL_T);
    if (r.v) cand(ox + off, oy, WALL_T, TILE);
    return best;
  }

  /** ¿El punto (px, py) está sobre un muro de la planta z? */
  isOpaquePxZ(x, y, z) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return true;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    const t = this.tileAtZ(tx, ty, z);
    if (OPAQUE.has(t)) return this._inRunsZ(tx, ty, x, y, z);
    return false;
  }

  /** Rayo en la planta z (mismo muestreo que castRay). */
  castRayZ(x, y, ang, maxDist, z) {
    const step = 4;
    const c = Math.cos(ang), s = Math.sin(ang);
    let d = 0;
    while (d < maxDist) {
      d += step;
      if (this.isOpaquePxZ(x + c * d, y + s * d, z)) return d;
    }
    return maxDist;
  }

  /** Línea despejada en la planta z (despacho por punto de muestreo). */
  lineClearZ(x1, y1, x2, y2, z) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d < 1) return true;
    const step = 6;
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.isOpaquePxZ(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, z)) return false;
    }
    return true;
  }

  circleHitsSolidZ(x, y, r, z) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    const off = (TILE - WALL_T) / 2;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const oob = tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H;
        if (oob) {
          if (this._circleRectHit(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
          continue;
        }
        const t = this.tileAtZ(tx, ty, z);
        if (t === T.TREE || t === T.CAR) {
          if (this._circleRectHit(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
          continue;
        }
        if (t !== T.WALL && t !== T.WINDOW && t !== T.DOOR_CLOSED) continue;
        const runs = this._runsForZ(tx, ty, z);
        const ox = tx * TILE, oy = ty * TILE;
        if (runs.h && this._circleRectHit(x, y, r, ox, oy + off, TILE, WALL_T)) return true;
        if (runs.v && this._circleRectHit(x, y, r, ox + off, oy, WALL_T, TILE)) return true;
      }
    }
    return false;
  }

  /** ¿Hay una escalera bajo los pies del jugador en su planta actual? */
  stairsNear(p) {
    const b = this.buildingAtPx(p.x, p.y);
    if (!b || !b.stairs) return null;
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (this.tileAtZ(tx, ty, p.z) !== T.STAIRS) return null;
    let to = 0, label = '';
    if (p.z === 0) {
      if (b.upper) { to = 1; label = 'Subir al 2º piso'; }
      else if (b.basement) { to = -1; label = 'Bajar al sótano'; }
      else return null;
    } else {
      to = 0;
      label = p.z === 1 ? 'Bajar a la planta baja' : 'Subir a la planta baja';
    }
    return { b, to, label, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }

  // ================== Decals persistentes ==================

  /** v0.13: apunta la operación para poder REPETIRLA al cargar partida. */
  _trackDecal(op) {
    this.decalOps.push(op);
    if (this.decalOps.length > 500) this.decalOps.shift();   // tope de memoria
  }

  stampBlood(x, y, big = false) {
    this._trackDecal({ t: 'blood', x, y, b: big ? 1 : 0 });
    const c = this.dctx;
    c.fillStyle = 'rgba(96, 14, 14, 0.72)';
    const n = big ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const rx = (x + (this.rng.range(-7, 7))) / 2;
      const ry = (y + (this.rng.range(-7, 7))) / 2;
      const r = (big ? this.rng.range(4, 9) : this.rng.range(2, 5));
      c.beginPath();
      c.ellipse(rx, ry, r, r * this.rng.range(0.6, 1), this.rng.range(0, 3.14), 0, Math.PI * 2);
      c.fill();
    }
  }

  stampCorpse(x, y, ang, scale = 1) {
    this._trackDecal({ t: 'corpse', x, y, a: +ang.toFixed(3), s: scale });
    const c = this.dctx;
    const px = x / 2, py = y / 2;
    // v0.14: scale distingue cadáveres por variante (bruto 1.4 · corredor 0.85)
    // charco
    c.fillStyle = 'rgba(88, 12, 12, 0.8)';
    c.beginPath();
    c.ellipse(px, py, 13 * scale, 9 * scale, ang, 0, Math.PI * 2);
    c.fill();
    // cuerpo caído
    c.save();
    c.translate(px, py);
    c.rotate(ang);
    c.fillStyle = '#5c6650';
    c.beginPath(); c.ellipse(0, 0, 9 * scale, 5.5 * scale, 0, 0, Math.PI * 2); c.fill();   // torso
    c.fillStyle = '#6e7a5a';
    c.beginPath(); c.ellipse(8 * scale, 0, 4.5 * scale, 4 * scale, 0, 0, Math.PI * 2); c.fill();   // cabeza
    c.strokeStyle = '#4e5844'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-4 * scale, -3 * scale); c.lineTo(-11 * scale, -6 * scale); c.stroke();        // brazo
    c.restore();
  }

  // ================== Generación ==================

  _generate() {
    const rng = this.rng;
    const tiles = this.tiles;

    // --- Calles ---
    for (const [a, b] of V_ROADS) {
      for (let x = a; x <= b; x++)
        for (let y = 0; y < MAP_H; y++) tiles[this.idx(x, y)] = T.ROAD;
    }
    for (const [a, b] of H_ROADS) {
      for (let y = a; y <= b; y++)
        for (let x = 0; x < MAP_W; x++) tiles[this.idx(x, y)] = T.ROAD;
    }

    // --- Aceras: hierba adyacente a calle ---
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (tiles[this.idx(x, y)] !== T.GRASS) continue;
        if (this.tileAtIdx(x - 1, y) === T.ROAD || this.tileAtIdx(x + 1, y) === T.ROAD ||
            this.tileAtIdx(x, y - 1) === T.ROAD || this.tileAtIdx(x, y + 1) === T.ROAD) {
          tiles[this.idx(x, y)] = T.SIDEWALK;
        }
      }
    }

    // --- Estructuras especiales ÚNICAS: comisaría, tienda y base militar ---
    // Se eligen manzanas distintas lo bastante grandes (nunca la central,
    // donde aparece el jugador) y se dedican por completo al edificio.
    // v0.16: la BASE MILITAR se queda con una de las manzanas 24×22 MÁS
    // LEJANAS del centro (top-3 por distancia, elección aleatoria entre
    // ellas): cruzar media ciudad para alcanzarla es parte del riesgo.
    const allBlocks = [];
    for (const [bx0, bx1] of X_BLOCKS)
      for (const [by0, by1] of Y_BLOCKS)
        allBlocks.push({ bx0, bx1, by0, by1, bw: bx1 - bx0 + 1, bh: by1 - by0 + 1 });
    const cTx = Math.floor(MAP_W / 2), cTy = Math.floor(MAP_H / 2);
    const isCenter = (b) => cTx >= b.bx0 && cTx <= b.bx1 && cTy >= b.by0 && cTy <= b.by1;
    const bigEnough = (b, w, h) => b.bw >= w + 2 && b.bh >= h + 2;
    const distC = (b) => Math.hypot((b.bx0 + b.bx1) / 2 - cTx, (b.by0 + b.by1) / 2 - cTy);
    const farBig = allBlocks
      .filter((b) => !isCenter(b) && bigEnough(b, SPECIALS.military.w, SPECIALS.military.h))
      .sort((a, b) => distC(b) - distC(a));
    const farPool = farBig.slice(0, Math.min(3, farBig.length));
    const militaryBlock = farPool.length ? farPool[rng.index(farPool.length)] : null;
    const pool = shuffle(allBlocks.filter((b) => !isCenter(b) && b !== militaryBlock), rng);
    const policeBlock = pool.find((b) => bigEnough(b, SPECIALS.police.w, SPECIALS.police.h)) || null;
    const storeBlock = pool.find((b) => b !== policeBlock && bigEnough(b, SPECIALS.store.w, SPECIALS.store.h)) || null;

    // --- Edificios por manzana ---
    for (const [bx0, bx1] of X_BLOCKS) {
      for (const [by0, by1] of Y_BLOCKS) {
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
        const placed = [];

        // manzana dedicada a una estructura especial → edificiio único + salir
        const isPolice = policeBlock && policeBlock.bx0 === bx0 && policeBlock.by0 === by0;
        const isStore = storeBlock && storeBlock.bx0 === bx0 && storeBlock.by0 === by0;
        const isMilitary = militaryBlock && militaryBlock.bx0 === bx0 && militaryBlock.by0 === by0;
        if (isPolice || isStore || isMilitary) {
          const sp = isPolice ? SPECIALS.police : isStore ? SPECIALS.store : SPECIALS.military;
          const w = Math.min(sp.w, bw - 2), h = Math.min(sp.h, bh - 2);
          const x0 = bx0 + 1 + rng.int(0, Math.max(0, bw - 2 - w));
          const y0 = by0 + 1 + rng.int(0, Math.max(0, bh - 2 - h));
          placed.push({ x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 });
          if (isPolice) this._placePoliceStation(x0, y0, x0 + w - 1, y0 + h - 1);
          else if (isStore) this._placeStore(x0, y0, x0 + w - 1, y0 + h - 1);
          else this._placeMilitaryBase(x0, y0, x0 + w - 1, y0 + h - 1);
          continue;
        }

        if (bw < 8 || bh < 7) continue;
        const attempts = Math.max(1, Math.floor((bw * bh) / 100));
        for (let i = 0; i < attempts; i++) {
          const w = Math.min(rng.int(8, 12), bw - 2);
          const h = Math.min(rng.int(7, 10), bh - 2);
          if (w < 7 || h < 6) continue;
          const x0 = rng.int(bx0 + 1, bx1 - 1 - w + 1);
          const y0 = rng.int(by0 + 1, by1 - 1 - h + 1);
          // solapamiento con padding 1
          let clash = false;
          for (const p of placed) {
            if (x0 - 1 <= p.x1 && x0 + w >= p.x0 - 1 + 1 && y0 - 1 <= p.y1 && y0 + h >= p.y0 - 1 + 1) {
              if (x0 < p.x1 + 2 && x0 + w > p.x0 - 1 && y0 < p.y1 + 2 && y0 + h > p.y0 - 1) { clash = true; break; }
            }
          }
          if (clash) continue;
          placed.push({ x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 });
          this._placeBuilding(x0, y0, x0 + w - 1, y0 + h - 1);
        }
      }
    }

    // --- Spawn del jugador (v0.13): calle ABIERTA cerca del centro ---
    // Antes se usaba el tile central tal cual (solo se esquivaba un coche) y
    // como la manzana central SÍ puede tener casas normales, a veces
    // aparecías DENTRO de una casa (o tras un muro) rodeado de zombis.
    // Ahora: espiral desde el centro buscando un tile de CALLE cuyo
    // vecindario 3×3 esté libre de muros/ventanas/puertas/interior — el
    // centro de una calle abierta, nunca dentro de un edificio.
    let sx = Math.floor(MAP_W / 2), sy = Math.floor(MAP_H / 2);
    const structNear = (tx, ty) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const t = this.tileAtIdx(tx + dx, ty + dy);
        if (t === T.WALL || t === T.WINDOW || t === T.DOOR_CLOSED ||
            t === T.DOOR_OPEN || t === T.FLOOR) return true;
      }
      return false;
    };
    outer: for (let r = 0; r < 60; r++) {
      const ring = [];        // tiles elegibles del primer anillo con candidatos
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // solo el anillo r
        const tx = sx + dx, ty = sy + dy;
        if (this.tileAtIdx(tx, ty) === T.ROAD && !structNear(tx, ty)) ring.push({ tx, ty });
      }
      if (ring.length) {
        // cualquiera del anillo es igual de seguro: variedad entre partidas
        const pick = ring[rng.index(ring.length)];
        sx = pick.tx; sy = pick.ty;
        break outer;
      }
    }
    this.spawn = { x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2 };
    this.spawnTile = { tx: sx, ty: sy };   // para el guardián de árboles

    // --- Árboles ---
    const treeTries = 430;   // v0.16: mapa al doble → misma densidad arbolada
    // v0.13: sin árboles pegados al punto de aparición (chebyshev ≤ 2)
    const sTx = this.spawnTile.tx, sTy = this.spawnTile.ty;
    for (let i = 0; i < treeTries; i++) {
      const tx = rng.int(1, MAP_W - 2), ty = rng.int(1, MAP_H - 2);
      if (Math.max(Math.abs(tx - sTx), Math.abs(ty - sTy)) <= 2) continue;
      if (this.tileAtIdx(tx, ty) !== T.GRASS) continue;
      // lejos de puertas (no bloquear entradas)
      let nearDoor = false;
      for (const d of this.doors) {
        if (Math.abs(d.tx - tx) <= 1 && Math.abs(d.ty - ty) <= 1) { nearDoor = true; break; }
      }
      if (nearDoor) continue;
      const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
      let close = false;
      for (const t of this.trees) {
        if (Math.hypot(t.x - px, t.y - py) < TILE * 2) { close = true; break; }
      }
      if (close) continue;
      this.setTile(tx, ty, T.TREE);
      const tr = { x: px, y: py, r: rng.range(15, 23) };
      this.trees.push(tr);
      this.treeByTile.set(this.idx(tx, ty), tr);
    }

    // --- Coches abandonados en la calle ---
    const carColors = ['#7a3030', '#3a4a5a', '#6a6a3a', '#54423a', '#42548a'];
    let carTries = 0;
    while (this.cars.length < 20 && carTries < 900) {   // v0.16: 10 → 20 coches
      carTries++;
      const tx = rng.int(2, MAP_W - 4), ty = rng.int(2, MAP_H - 3);
      if (this.tileAtIdx(tx, ty) !== T.ROAD || this.tileAtIdx(tx + 1, ty) !== T.ROAD) continue;
      if (this.tileAtIdx(tx - 1, ty) === T.CAR || this.tileAtIdx(tx + 2, ty) === T.CAR) continue;
      const cx = tx * TILE + TILE, cy = ty * TILE + TILE / 2;
      if (Math.hypot(cx - this.spawn.x, cy - this.spawn.y) < 220) continue;
      this.setTile(tx, ty, T.CAR);
      this.setTile(tx + 1, ty, T.CAR);
      const car = { x: cx, y: cy, w: 58, h: 26, color: rng.pick(carColors) };
      this.cars.push(car);
      this.carByTile.set(this.idx(tx, ty), car);
      this.carByTile.set(this.idx(tx + 1, ty), car);
    }

    // --- Listas de tiles caminables (spawns) ---
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = tiles[this.idx(x, y)];
        if (t === T.ROAD || t === T.SIDEWALK || t === T.GRASS) this.outdoorTiles.push(this.idx(x, y));
        else if (t === T.FLOOR) this.indoorTiles.push(this.idx(x, y));
      }
    }

    // --- Pintura vial (tras coches/árboles para respetar sus tiles) ---
    this._buildRoadPaint();

    // --- Índice tile → edificio (despacho por planta z) ---
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      for (let y = b.y0; y <= b.y1; y++)
        for (let x = b.x0; x <= b.x1; x++) this._bIdx[this.idx(x, y)] = i;
    }
  }

  /**
   * Precalcula TODA la pintura vial como rects en coordenadas de mundo.
   * Se dibujan como fillRect directos (sin setLineDash): la fase de los
   * guiones queda anclada al asfalto y no "nada" con la cámara.
   * - Línea central discontinua amarilla en el CENTRO real de la calzada.
   * - Líneas de borde blancas junto a la acera.
   * - Pasos de cebra en los 4 accesos de cada cruce.
   * - Tapas de alcantarilla repartidas por el asfalto.
   */
  _buildRoadPaint() {
    const P = this.roadPaint;
    const YEL = 'rgba(206,172,64,0.55)';   // línea central discontinua
    const WHT = 'rgba(214,214,204,0.22)';  // líneas de borde
    const ZEB = 'rgba(214,214,204,0.30)';  // pasos de cebra
    const GAP = 52;                         // margen sin pintura alrededor de cruces

    // Zonas de cruce (con margen) que la pintura longitudinal debe saltar.
    const hCross = H_ROADS.map(([c, d]) => [c * TILE - GAP, (d + 1) * TILE + GAP]);
    const vCross = V_ROADS.map(([a, b]) => [a * TILE - GAP, (b + 1) * TILE + GAP]);

    // Sub-segmentos libres de [from, to] tras recortar los rangos a evitar.
    const freeSegs = (from, to, skips) => {
      const out = [];
      let s = from;
      const cuts = [];
      for (const [s0, s1] of skips) if (s1 > s && s0 < to) cuts.push([Math.max(s, s0), Math.min(to, s1)]);
      cuts.sort((p, q) => p[0] - q[0]);
      for (const [a, b] of cuts) { if (a > s) out.push([s, a]); s = Math.max(s, b); }
      if (s < to) out.push([s, to]);
      return out;
    };

    // --- Calles verticales: centro discontinuo + líneas de borde ---
    for (const [a, b] of V_ROADS) {
      const cx = (a + b + 1) / 2 * TILE;            // centro REAL de la calzada
      const exL = a * TILE + 7, exR = (b + 1) * TILE - 10;
      for (const [y0, y1] of freeSegs(0, WORLD_H, hCross)) {
        for (let y = y0; y + 12 <= y1; y += 28) P.push({ x: cx - 2, y, w: 4, h: 12, c: YEL });
        P.push({ x: exL, y: y0, w: 3, h: y1 - y0, c: WHT });
        P.push({ x: exR, y: y0, w: 3, h: y1 - y0, c: WHT });
      }
    }
    // --- Calles horizontales ---
    for (const [c, d] of H_ROADS) {
      const cy = (c + d + 1) / 2 * TILE;
      const eyT = c * TILE + 7, eyB = (d + 1) * TILE - 10;
      for (const [x0, x1] of freeSegs(0, WORLD_W, vCross)) {
        for (let x = x0; x + 12 <= x1; x += 28) P.push({ x, y: cy - 2, w: 12, h: 4, c: YEL });
        P.push({ x: x0, y: eyT, w: x1 - x0, h: 3, c: WHT });
        P.push({ x: x0, y: eyB, w: x1 - x0, h: 3, c: WHT });
      }
    }

    // --- Pasos de cebra en los 4 accesos de cada cruce ---
    for (const [a, b] of V_ROADS) {
      for (const [c, d] of H_ROADS) {
        // cebra para cruzar la calle VERTICAL (barras verticales, al N y al S)
        const x0 = a * TILE + 9, x1 = (b + 1) * TILE - 9;
        const yN = c * TILE - 46, yS = (d + 1) * TILE + 18;
        for (let x = x0; x + 7 <= x1; x += 14) {
          P.push({ x, y: yN, w: 7, h: 28, c: ZEB });
          P.push({ x, y: yS, w: 7, h: 28, c: ZEB });
        }
        // cebra para cruzar la calle HORIZONTAL (barras horizontales, al O y al E)
        const yy0 = c * TILE + 9, yy1 = (d + 1) * TILE - 9;
        const xW = a * TILE - 46, xE = (b + 1) * TILE + 18;
        for (let y = yy0; y + 7 <= yy1; y += 14) {
          P.push({ x: xW, y, w: 28, h: 7, c: ZEB });
          P.push({ x: xE, y, w: 28, h: 7, c: ZEB });
        }
      }
    }

    // --- Tapas de alcantarilla (nunca bajo coches ni sobre cebra/cruces) ---
    const nearCross = (x, y) => {
      for (const [a, b] of V_ROADS) {
        if (x <= a * TILE - 58 || x >= (b + 1) * TILE + 58) continue;
        for (const [c, d] of H_ROADS) {
          if (y > c * TILE - 58 && y < (d + 1) * TILE + 58) return true;
        }
      }
      return false;
    };
    let tries = 0;
    while (this.manholes.length < 64 && tries < 1200) {   // v0.16: 34 → 64 tapas
      tries++;
      let x, y;
      if (this.rng.chance(0.5)) {
        const [a, b] = V_ROADS[this.rng.index(V_ROADS.length)];
        x = this.rng.range(a * TILE + 16, (b + 1) * TILE - 16);
        y = this.rng.range(48, WORLD_H - 48);
      } else {
        const [c, d] = H_ROADS[this.rng.index(H_ROADS.length)];
        y = this.rng.range(c * TILE + 16, (d + 1) * TILE - 16);
        x = this.rng.range(48, WORLD_W - 48);
      }
      if (nearCross(x, y)) continue;
      if (this.tileAt(x, y) !== T.ROAD) continue; // coches (T.CAR) excluidos
      if (Math.hypot(x - this.spawn.x, y - this.spawn.y) < 90) continue;
      this.manholes.push({ x, y });
    }
  }

  _placeBuilding(x0, y0, x1, y1) {
    const rng = this.rng;
    // muros perimetrales e interior
    for (let x = x0; x <= x1; x++) {
      this.setTile(x, y0, T.WALL); this.setTile(x, y1, T.WALL);
    }
    for (let y = y0; y <= y1; y++) {
      this.setTile(x0, y, T.WALL); this.setTile(x1, y, T.WALL);
    }
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++) this.setTile(x, y, T.FLOOR);

    // ventanas: cada 3er muro, sin esquinas
    for (let x = x0 + 2; x <= x1 - 2; x += 3) {
      this.setTile(x, y0, T.WINDOW);
      if (rng.chance(0.7)) this.setTile(x, y1, T.WINDOW);
    }
    for (let y = y0 + 2; y <= y1 - 2; y += 3) {
      this.setTile(x0, y, T.WINDOW);
      if (rng.chance(0.7)) this.setTile(x1, y, T.WINDOW);
    }

    // puerta en un lado con exterior caminable
    const sides = shuffle(['N', 'S', 'W', 'E'], rng);
    for (const side of sides) {
      let tx = 0, ty = 0, ox = 0, oy = 0;
      if (side === 'N') { tx = rng.int(x0 + 2, x1 - 2); ty = y0; ox = 0; oy = -1; }
      else if (side === 'S') { tx = rng.int(x0 + 2, x1 - 2); ty = y1; ox = 0; oy = 1; }
      else if (side === 'W') { tx = x0; ty = rng.int(y0 + 2, y1 - 2); ox = -1; oy = 0; }
      else { tx = x1; ty = rng.int(y0 + 2, y1 - 2); ox = 1; oy = 0; }
      const out = this.tileAtIdx(tx + ox, ty + oy);
      if (out === T.GRASS || out === T.SIDEWALK || out === T.ROAD) {
        this.setTile(tx, ty, T.DOOR_CLOSED);
        this.doors.push({ tx, ty });
        break;
      }
    }

    // muro divisorio interior con hueco
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w >= 11 && h >= 7 && rng.chance(0.55)) {
      const wx = rng.int(x0 + 4, x1 - 4);
      const gy = rng.int(y0 + 2, y1 - 4);
      for (let y = y0 + 1; y < y1; y++) {
        if (y !== gy && y !== gy + 1) this.setTile(wx, y, T.WALL);
      }
    }

    // ---- plantas extra: 2º piso o sótano (nunca ambos) ----
    // La escalera se coloca en un tile interior con 4 vecinos FLOOR para
    // estar lejos de muros; la misma posición de mundo es el hueco de
    // llegada en la rejilla de la planta extra.
    let upper = null, basement = null, stairs = null;
    const stairCands = [];
    for (let y = y0 + 2; y <= y1 - 2; y++) {
      for (let x = x0 + 2; x <= x1 - 2; x++) {
        if (this.tileAtIdx(x, y) !== T.FLOOR) continue;
        if (this.tileAtIdx(x - 1, y) !== T.FLOOR || this.tileAtIdx(x + 1, y) !== T.FLOOR ||
            this.tileAtIdx(x, y - 1) !== T.FLOOR || this.tileAtIdx(x, y + 1) !== T.FLOOR) continue;
        stairCands.push({ x, y });
      }
    }
    if (stairCands.length) {
      const s = stairCands[rng.index(stairCands.length)];
      if (rng.chance(FLOORS.upperChance)) {
        upper = this._buildExtraFloor(x0, y0, x1, y1, 'upper', s);
      } else if (rng.chance(FLOORS.basementChance)) {
        basement = this._buildExtraFloor(x0, y0, x1, y1, 'basement', s);
      }
      if (upper || basement) {
        this.setTile(s.x, s.y, T.STAIRS);
        stairs = { tx: s.x, ty: s.y };
      }
    }

    // contenedores: tiles de interior pegados a muro/ventana (planta baja)
    const cands = [];
    for (let y = y0 + 1; y < y1; y++) {
      for (let x = x0 + 1; x < x1; x++) {
        if (this.tileAtIdx(x, y) !== T.FLOOR) continue;
        const n = [this.tileAtIdx(x - 1, y), this.tileAtIdx(x + 1, y), this.tileAtIdx(x, y - 1), this.tileAtIdx(x, y + 1)];
        if (n.includes(T.WALL) || n.includes(T.WINDOW)) cands.push({ x, y });
      }
    }
    shuffle(cands, rng);
    const wanted = ['nevera', 'alacena'];
    if (rng.chance(0.65)) wanted.push('armario');
    if (rng.chance(0.4)) wanted.push('alacena');
    if (rng.chance(0.35)) wanted.push('casillero');
    if (rng.chance(0.12)) wanted.push('botiquin_pared');
    for (let i = 0; i < Math.min(wanted.length, cands.length); i++) {
      this._addContainer(wanted[i], cands[i].x, cands[i].y);
    }

    this.buildings.push({
      x0, y0, x1, y1,
      cx: (x0 + x1) / 2 * TILE + TILE / 2,
      cy: (y0 + y1) / 2 * TILE + TILE / 2,
      upper, basement, stairs,
      roof: this._buildRoofCanvas(x0, y0, x1, y1, !!upper),
      roofW: (x1 - x0 + 1) * TILE,
      roofH: (y1 - y0 + 1) * TILE,
    });
  }

  /**
   * COMISARÍA (estructura única). Edificio institucional grande: ventanas
   * densas cada 2 tiles, doble puerta principal al sur + puerta de servicio
   * al norte, sala de armería vallada en el tercio derecho (armerías W con
   * el mejor botín de armas del mapa), casilleros en el vestíbulo y botiquines.
   * Tejado PLANO azul con placa-estrella y bandas de peligro (inconfundible).
   * Peligro: densidad zombi extra dentro y alrededor (ver zombie.js).
   */
  _placePoliceStation(x0, y0, x1, y1) {
    const rng = this.rng;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;

    // perímetro + interior
    for (let x = x0; x <= x1; x++) { this.setTile(x, y0, T.WALL); this.setTile(x, y1, T.WALL); }
    for (let y = y0; y <= y1; y++) { this.setTile(x0, y, T.WALL); this.setTile(x1, y, T.WALL); }
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++) this.setTile(x, y, T.FLOOR);

    // ventanas densas (cada 2, sin esquinas): fachada institucional
    for (let x = x0 + 2; x <= x1 - 2; x += 2) {
      this.setTile(x, y0, T.WINDOW);
      if (x <= x1 - 2) this.setTile(x, y1, T.WINDOW);
    }
    for (let y = y0 + 2; y <= y1 - 2; y += 2) {
      this.setTile(x0, y, T.WINDOW);
      this.setTile(x1, y, T.WINDOW);
    }

    // doble puerta principal (frente sur) + puerta de servicio (norte)
    const dx = x0 + Math.floor(w / 2) - 1;
    for (const d of [dx, dx + 1]) {
      this.setTile(d, y1, T.DOOR_CLOSED);
      this.doors.push({ tx: d, ty: y1 });
    }
    const sx = x0 + 2 + rng.int(0, Math.max(0, w - 6));
    this.setTile(sx, y0, T.DOOR_CLOSED);
    this.doors.push({ tx: sx, ty: y0 });

    // ---- sala de armería vallada (tercio derecho) ----
    const awx = x1 - 4;                 // muro vertical de la sala
    const agy = y0 + 2;                 // hueco de acceso (2 tiles)
    for (let y = y0 + 1; y < y1; y++) {
      if (y !== agy && y !== agy + 1) this.setTile(awx, y, T.WALL);
    }
    // armerías al fondo de la sala + casillero de apoyo
    this._addContainer('armeria', x1 - 2, y1 - 2, 0);
    this._addContainer('armeria', x1 - 2, y1 - 4, 0);
    this._addContainer('armeria', x1 - 2, y1 - 6, 0);
    this._addContainer('casillero', x1 - 3, y1 - 2, 0);

    // ---- vestíbulo: casilleros contra la fachada norte + botiquines ----
    this._addContainer('casillero', x0 + 3, y0 + 1, 0);
    this._addContainer('casillero', x0 + 6, y0 + 1, 0);
    this._addContainer('casillero', x0 + 9, y0 + 1, 0);
    this._addContainer('botiquin_pared', x0 + 1, y0 + 4, 0);
    this._addContainer('botiquin_pared', x0 + 1, y0 + 8, 0);
    // mesa de recepción: dos casilleros a mitad del vestíbulo
    this._addContainer('casillero', x0 + Math.floor(w / 2) - 1, y0 + Math.floor(h / 2), 0);
    this._addContainer('casillero', x0 + Math.floor(w / 2), y0 + Math.floor(h / 2), 0);

    this.buildings.push({
      x0, y0, x1, y1,
      cx: (x0 + x1) / 2 * TILE + TILE / 2,
      cy: (y0 + y1) / 2 * TILE + TILE / 2,
      kind: 'police',
      upper: null, basement: null, stairs: null,
      roof: this._buildPoliceRoofCanvas(x0, y0, x1, y1),
      roofW: w * TILE, roofH: h * TILE,
    });
  }

  /**
   * TIENDA (estructura única). Local comercial: escaparate sur con ventanas
   * cada 2 tiles, doble puerta, neveras en la pared norte y PASILLOS de
   * estanterías (E) repletas de comida. Tejado PLANO de grava con franjas
   * rojas de marquesina + diana comercial + lucernarios (inconfundible).
   * Peligro: presión zombi media (ver zombie.js).
   */
  _placeStore(x0, y0, x1, y1) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;

    // perímetro + interior
    for (let x = x0; x <= x1; x++) { this.setTile(x, y0, T.WALL); this.setTile(x, y1, T.WALL); }
    for (let y = y0; y <= y1; y++) { this.setTile(x0, y, T.WALL); this.setTile(x1, y, T.WALL); }
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++) this.setTile(x, y, T.FLOOR);

    // escaparate sur (cada 2) + ventanas laterales más espaciadas (cada 3)
    for (let x = x0 + 2; x <= x1 - 2; x += 2) this.setTile(x, y1, T.WINDOW);
    for (let y = y0 + 2; y <= y1 - 2; y += 3) {
      this.setTile(x0, y, T.WINDOW);
      this.setTile(x1, y, T.WINDOW);
    }

    // doble puerta centrada en el escaparate
    const dx = x0 + Math.floor(w / 2) - 1;
    for (const d of [dx, dx + 1]) {
      this.setTile(d, y1, T.DOOR_CLOSED);
      this.doors.push({ tx: d, ty: y1 });
    }

    // neveras en la pared del fondo (norte)
    this._addContainer('nevera', x0 + 2, y0 + 1, 0);
    this._addContainer('nevera', x0 + 4, y0 + 1, 0);

    // pasillos de estanterías: 2 filas con hueco de paso cada 3 tiles
    for (const ry of [y0 + 3, y0 + 6]) {
      if (ry >= y1 - 1) continue;
      for (let x = x0 + 2, k = 0; x <= x1 - 2; x++, k++) {
        if (k % 3 === 2) continue;                 // hueco para cruzar el pasillo
        this._addContainer('estanteria', x, ry, 0);
      }
    }

    this.buildings.push({
      x0, y0, x1, y1,
      cx: (x0 + x1) / 2 * TILE + TILE / 2,
      cy: (y0 + y1) / 2 * TILE + TILE / 2,
      kind: 'store',
      upper: null, basement: null, stairs: null,
      roof: this._buildStoreRoofCanvas(x0, y0, x1, y1),
      roofW: w * TILE, roofH: h * TILE,
    });
  }

  /**
   * BASE MILITAR (estructura única, v0.16). Instalación fortificada: muros
   * macizos con ranuras de ventilación escasas, doble puerta peatonal al sur
   * + puerta de servicio al norte, sala de armas vallada en el tercio derecho
   * (armerías militares G y cajas de munición X), taquillas M en el
   * vestíbulo y dormitorios tras un divisorio — y una ESCALERA al
   * SÓTANO-ARSENAL donde vive el mejor botín del juego (ver
   * _buildMilitaryBasement). La planta baja está INFESTADA (zombie.js:
   * 18 dentro, 4 de ellos brutos de guarnición, + 4 guardianes abajo).
   * Tejado: plataforma oliva con helipuerto, radar y red de camuflaje.
   */
  _placeMilitaryBase(x0, y0, x1, y1) {
    const rng = this.rng;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;

    // perímetro + interior
    for (let x = x0; x <= x1; x++) { this.setTile(x, y0, T.WALL); this.setTile(x, y1, T.WALL); }
    for (let y = y0; y <= y1; y++) { this.setTile(x0, y, T.WALL); this.setTile(x1, y, T.WALL); }
    for (let y = y0 + 1; y < y1; y++)
      for (let x = x0 + 1; x < x1; x++) this.setTile(x, y, T.FLOOR);

    // ranuras de ventilación escasas (cada 4, sin esquinas): instalación cerrada
    for (let x = x0 + 3; x <= x1 - 3; x += 4) {
      this.setTile(x, y0, T.WINDOW);
      this.setTile(x, y1, T.WINDOW);
    }
    for (let y = y0 + 3; y <= y1 - 3; y += 4) {
      this.setTile(x0, y, T.WINDOW);
      this.setTile(x1, y, T.WINDOW);
    }

    // doble puerta peatonal al sur (centro) + puerta de servicio al norte
    const dx = x0 + Math.floor(w / 2) - 1;
    for (const d of [dx, dx + 1]) {
      this.setTile(d, y1, T.DOOR_CLOSED);
      this.doors.push({ tx: d, ty: y1 });
    }
    const sx = x0 + 3 + rng.int(0, Math.max(0, w - 8));
    this.setTile(sx, y0, T.DOOR_CLOSED);
    this.doors.push({ tx: sx, ty: y0 });

    // ---- sala de armas vallada (tercio derecho, como la comisaría) ----
    const awx = x1 - 4;                 // muro vertical de la sala
    const agy = y0 + 2;                 // hueco de acceso (2 tiles)
    for (let y = y0 + 1; y < y1; y++) {
      if (y !== agy && y !== agy + 1) this.setTile(awx, y, T.WALL);
    }
    this._addContainer('armeria_mil', x1 - 2, y1 - 2, 0);
    this._addContainer('armeria_mil', x1 - 2, y1 - 4, 0);
    this._addContainer('caja_municion', x1 - 3, y1 - 2, 0);

    // ---- muro divisorio del cuartel (dormitorios al sur) con hueco ----
    const dgy = y0 + Math.floor(h / 2);
    const dwx = x0 + Math.floor(w * 0.42);
    for (let x = x0 + 2; x < awx - 1; x++) {
      if (x !== dwx && x !== dwx + 1) this.setTile(x, dgy, T.WALL);
    }

    // ---- escalera al SÓTANO: posición semifija en el cuartel sur, con 4
    // vecinos FLOOR y lejos de puertas (verificada; si no, búsqueda) ----
    let stairs = null;
    const fixedX = x0 + Math.max(3, Math.floor(w * 0.32));
    const fixedY = y0 + Math.min(h - 3, Math.floor(h * 0.65));
    const okFixed = this.tileAtIdx(fixedX, fixedY) === T.FLOOR &&
      this.tileAtIdx(fixedX - 1, fixedY) === T.FLOOR && this.tileAtIdx(fixedX + 1, fixedY) === T.FLOOR &&
      this.tileAtIdx(fixedX, fixedY - 1) === T.FLOOR && this.tileAtIdx(fixedX, fixedY + 1) === T.FLOOR;
    if (okFixed) {
      this.setTile(fixedX, fixedY, T.STAIRS);
      stairs = { tx: fixedX, ty: fixedY };
    } else {
      const cands = [];
      for (let y = y0 + 3; y <= y1 - 3; y++) {
        for (let x = x0 + 3; x < awx - 1; x++) {
          if (this.tileAtIdx(x, y) !== T.FLOOR) continue;
          if (this.tileAtIdx(x - 1, y) !== T.FLOOR || this.tileAtIdx(x + 1, y) !== T.FLOOR ||
              this.tileAtIdx(x, y - 1) !== T.FLOOR || this.tileAtIdx(x, y + 1) !== T.FLOOR) continue;
          cands.push({ x, y });
        }
      }
      if (cands.length) {
        const s = cands[rng.index(cands.length)];
        this.setTile(s.x, s.y, T.STAIRS);
        stairs = { tx: s.x, ty: s.y };
      }
    }

    // ---- vestíbulo: taquillas militares contra la fachada norte ----
    this._addContainer('taquilla_mil', x0 + 3, y0 + 1, 0);
    this._addContainer('taquilla_mil', x0 + 6, y0 + 1, 0);
    this._addContainer('taquilla_mil', x0 + 9, y0 + 1, 0);
    this._addContainer('taquilla_mil', x0 + 12, y0 + 1, 0);
    // ---- dormitorios: taquillas + suministros ----
    this._addContainer('taquilla_mil', x0 + 2, y1 - 2, 0);
    this._addContainer('estanteria_mil', x0 + 4, y1 - 2, 0);
    this._addContainer('estanteria_mil', x0 + 6, y1 - 2, 0);
    // ---- botiquín de pared junto a la puerta de servicio ----
    this._addContainer('botiquin_pared', x0 + 1, y0 + 3, 0);

    // ---- SÓTANO-ARSENAL (la misma posición de mundo para la escalera) ----
    const basement = stairs ? this._buildMilitaryBasement(x0, y0, x1, y1, stairs) : null;

    this.buildings.push({
      x0, y0, x1, y1,
      cx: (x0 + x1) / 2 * TILE + TILE / 2,
      cy: (y0 + y1) / 2 * TILE + TILE / 2,
      kind: 'military',
      upper: null, basement, stairs,
      roof: this._buildMilitaryRoofCanvas(x0, y0, x1, y1),
      roofW: w * TILE, roofH: h * TILE,
    });
  }

  /**
   * SÓTANO-ARSENAL de la base militar (v0.16): un hangar subterráneo de
   * hormigón con filas de armerías militares, cajas de munición y taquillas,
   * más una CÁMARA ACORAZADA al este tras un hueco estrecho. Aquí vive el
   * mejor botín del juego (incluido el Subfusil Cuervo en exclusiva).
   * La escalera ocupa la misma posición de mundo que en planta baja.
   * 4 zombis guardianes esperan abajo (ver zombie.js).
   */
  _buildMilitaryBasement(x0, y0, x1, y1, stairs) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const tiles = new Uint8Array(w * h);
    const set = (lx, ly, v) => { tiles[ly * w + lx] = v; };

    // perímetro macizo (sin ventanas: está bajo tierra)
    for (let x = 0; x < w; x++) { set(x, 0, T.WALL); set(x, h - 1, T.WALL); }
    for (let y = 0; y < h; y++) { set(0, y, T.WALL); set(w - 1, y, T.WALL); }
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) set(x, y, T.FLOOR);

    // hueco de la escalera (misma posición de mundo que en planta baja)
    const stx = stairs.tx - x0, sty = stairs.ty - y0;
    set(stx, sty, T.STAIRS);

    // ---- muro de la CÁMARA ACORAZADA (este) con hueco de acceso ----
    const vx = Math.floor(w * 0.68);
    const vgy = Math.floor(h * 0.45);
    for (let y = 1; y < h - 1; y++) {
      if (y !== vgy && y !== vgy + 1 && vx > 0) set(vx, y, T.WALL);
    }
    // ---- pilares de hormigón del hangar (nunca sobre la escalera) ----
    for (const [px, py] of [[Math.floor(w * 0.35), Math.floor(h * 0.3)],
                            [Math.floor(w * 0.35), Math.floor(h * 0.7)]]) {
      if (px !== stx || py !== sty) set(px, py, T.WALL);
    }

    // ---- contenedores: filas del ARSENAL (oeste/centro) ----
    const z = -1;
    const put = (type, lx, ly) => {
      if (lx < 1 || ly < 1 || lx >= w - 1 || ly >= h - 1) return;      // fuera de rango: ignora
      if (tiles[ly * w + lx] !== T.FLOOR) return;                       // no pisa muro/escalera
      this._addContainer(type, x0 + lx, y0 + ly, z);
    };
    // fila 1: munición a porrillo
    put('caja_municion', 3, 4); put('caja_municion', 6, 4);
    put('caja_municion', 9, 4); put('caja_municion', 12, 4);
    // fila 2: la panoplia (armerías militares)
    put('armeria_mil', 3, 7); put('armeria_mil', 6, 7);
    put('armeria_mil', 9, 7); put('armeria_mil', 12, 7);
    // fila 3: taquillas del pelotón
    put('taquilla_mil', 3, 11); put('taquilla_mil', 6, 11);
    put('taquilla_mil', 12, 11);
    // fila 4: suministros (la escalera queda libre)
    put('estanteria_mil', 3, 15); put('estanteria_mil', 6, 15);
    // ---- CÁMARA ACORAZADA (este): lo más exclusivo ----
    put('armeria_mil', vx + 2, 3); put('armeria_mil', vx + 2, 6);
    put('caja_municion', vx + 2, 9); put('caja_municion', vx + 2, 12);
    put('taquilla_mil', vx + 4, 5); put('taquilla_mil', vx + 4, 10);
    put('estanteria_mil', vx + 4, 15);

    const containers = this.containers.filter((c) => c.z === z &&
      c.x >= x0 * TILE && c.x <= (x1 + 1) * TILE && c.y >= y0 * TILE && c.y <= (y1 + 1) * TILE);
    const fl = {
      kind: 'basement', z, tiles, w, h, x0, y0, containers,
      stairs: { tx: stairs.tx, ty: stairs.ty },
    };
    fl.canvas = this._buildFloorCanvas(fl);
    return fl;
  }

  /**
   * Tejado PLANO de la BASE MILITAR: losa de hormigón verde oliva, HELIPUERTO
   * con círculo y H desgastado, radar con mástil, retícula de camuflaje,
   * ESTRELLA blanca de 5 puntas, parapeto de sacos de arena en el frente y
   * bandas de peligro amarillo/negro en la puerta sur. 100% determinista
   * (sin rng) → firma de píxel estable para tests.
   */
  _buildMilitaryRoofCanvas(x0, y0, x1, y1) {
    const w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
    const rc = document.createElement('canvas');
    rc.width = w; rc.height = h;
    const c = rc.getContext('2d');

    // base: losa de hormigón verde oliva
    c.fillStyle = '#3f4636';
    c.fillRect(0, 0, w, h);
    // juntas de losa (rejilla 48px)
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < w; x += 48) c.fillRect(x, 0, 2, h);
    for (let y = 0; y < h; y += 48) c.fillRect(0, y, w, 2);
    // desgaste determinista
    c.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < w * h / 2400; i++) c.fillRect((i * 149) % w, (i * 97) % h, 3, 2);

    // retícula de CAMUFLAJE: manchas oliva alternas (patrón fijo)
    const camo = ['rgba(46,54,38,0.55)', 'rgba(72,82,58,0.45)', 'rgba(30,36,26,0.4)'];
    for (let i = 0; i < 26; i++) {
      const cx = (i * 197 + 61) % w, cy = (i * 131 + 37) % h;
      c.fillStyle = camo[i % 3];
      c.beginPath();
      c.ellipse(cx, cy, 26 + (i % 5) * 9, 16 + (i % 3) * 7, (i * 1.3) % 3, 0, Math.PI * 2);
      c.fill();
    }

    // parapeto perimetral
    c.fillStyle = '#4a5340';
    c.fillRect(0, 0, w, 5); c.fillRect(0, h - 5, w, 5);
    c.fillRect(0, 0, 5, h); c.fillRect(w - 5, 0, 5, h);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, h - 8, w, 3); c.fillRect(w - 8, 0, 3, h);

    // ---- HELIPUERTO (centro): círculo desgastado + H ----
    const hx = w * 0.4, hy = h * 0.46;
    const HR = Math.min(w, h) * 0.26;
    c.strokeStyle = 'rgba(214,208,180,0.55)';
    c.lineWidth = 5;
    c.beginPath(); c.arc(hx, hy, HR, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(hx, hy, HR - 7, 0, Math.PI * 2); c.stroke();
    // la H
    c.strokeStyle = 'rgba(224,218,190,0.75)';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(hx - HR * 0.42, hy - HR * 0.45); c.lineTo(hx - HR * 0.42, hy + HR * 0.45);
    c.moveTo(hx + HR * 0.42, hy - HR * 0.45); c.lineTo(hx + HR * 0.42, hy + HR * 0.45);
    c.moveTo(hx - HR * 0.42, hy); c.lineTo(hx + HR * 0.42, hy);
    c.stroke();

    // ---- RADAR (esquina NE): pedestal + parábola orientada + mástil ----
    const rx = w * 0.82, ry = h * 0.18;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(rx - 14, ry - 6, 30, 26);
    c.fillStyle = '#5a6450';
    c.fillRect(rx - 16, ry - 8, 30, 26);          // pedestal
    c.fillStyle = '#6a745e';
    c.beginPath(); c.ellipse(rx + 2, ry - 14, 16, 9, -0.5, 0, Math.PI * 2); c.fill();  // parábola
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(rx + 2, ry - 14, 16, 9, -0.5, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#39412e';
    c.fillRect(rx - 2, ry - 22, 4, 12);           // mástil de la parábola

    // ---- ESTRELLA blanca de 5 puntas (oeste) ----
    const px = w * 0.16, py = h * 0.3;
    const R = Math.min(w, h) * 0.09;
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath(); c.arc(px + 3, py + 3, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(220,216,196,0.8)';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? R * 0.95 : R * 0.4;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const vx2 = px + Math.cos(a) * r, vy2 = py + Math.sin(a) * r;
      if (i === 0) c.moveTo(vx2, vy2); else c.lineTo(vx2, vy2);
    }
    c.closePath(); c.fill();

    // ---- sacos de arena en el frente sur ----
    const bagY = h - 14;
    for (let x = 8; x < w - 10; x += 13) {
      c.fillStyle = '#7a6f50';
      c.beginPath(); c.ellipse(x, bagY, 7, 4.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath(); c.ellipse(x, bagY + 2, 6, 2.5, 0, 0, Math.PI * 2); c.fill();
    }

    // ---- bandas de peligro amarillo/negro en la puerta sur ----
    const bandH = Math.min(34, Math.floor(h * 0.13));
    for (let x = -bandH; x < w + bandH; x += 22) {
      c.fillStyle = '#8a7a20';
      c.beginPath();
      c.moveTo(x, h); c.lineTo(x + 11, h); c.lineTo(x + 11 + bandH, h - bandH);
      c.lineTo(x + bandH, h - bandH); c.closePath(); c.fill();
      c.fillStyle = '#1a1a16';
      c.beginPath();
      c.moveTo(x + 11, h); c.lineTo(x + 22, h); c.lineTo(x + 22 + bandH, h - bandH);
      c.lineTo(x + 11 + bandH, h - bandH); c.closePath(); c.fill();
    }

    // ---- antena con luz roja (esquina NO) ----
    const ax = w * 0.08, ay = h * 0.12;
    c.strokeStyle = '#7a8496';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax, ay + 30); c.stroke();
    c.beginPath(); c.moveTo(ax - 8, ay + 30); c.lineTo(ax + 8, ay + 30); c.stroke();
    c.fillStyle = '#c0392b';
    c.beginPath(); c.arc(ax, ay, 4, 0, Math.PI * 2); c.fill();

    // contorno
    c.strokeStyle = 'rgba(8,10,8,0.85)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, w - 2, h - 2);
    return rc;
  }

  /**
   * Genera la rejilla de una planta extra (2º piso o sótano) con su propio
   * reparto interior, sus contenedores y su canvas pre-renderizado.
   * - 2º piso: mismo perímetro que la planta baja (ventanas incluidas, la
   *   puerta se vuelve muro) + divisorio propio + armario/casillero/botiquín.
   * - Sótano: perímetro macizo sin ventanas, hormigón, trastero con mejor
   *   botín (casilleros/alacenas).
   * La escalera (stairs) ocupa la misma posición de mundo en ambas plantas.
   */
  _buildExtraFloor(x0, y0, x1, y1, kind, stairs) {
    const rng = this.rng;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const tiles = new Uint8Array(w * h);
    const set = (lx, ly, v) => { tiles[ly * w + lx] = v; };

    // perímetro: 2º piso copia muros/ventanas de la planta baja (puerta→muro);
    // sótano todo muro macizo (sin ventanas: está bajo tierra)
    for (let x = 0; x < w; x++) {
      const gt = this.tileAtIdx(x0 + x, y0), gb = this.tileAtIdx(x0 + x, y1);
      set(x, 0, kind === 'upper' && gt === T.WINDOW ? T.WINDOW : T.WALL);
      set(x, h - 1, kind === 'upper' && gb === T.WINDOW ? T.WINDOW : T.WALL);
    }
    for (let y = 0; y < h; y++) {
      const gl = this.tileAtIdx(x0, y0 + y), gr = this.tileAtIdx(x1, y0 + y);
      set(0, y, kind === 'upper' && gl === T.WINDOW ? T.WINDOW : T.WALL);
      set(w - 1, y, kind === 'upper' && gr === T.WINDOW ? T.WINDOW : T.WALL);
    }
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) set(x, y, T.FLOOR);

    // hueco de la escalera (misma posición de mundo que en planta baja)
    set(stairs.x - x0, stairs.y - y0, T.STAIRS);

    // divisorio interior propio (solo 2º piso, distinto del de abajo)
    if (kind === 'upper' && w >= 10 && rng.chance(0.6)) {
      const wx = rng.int(3, w - 4);
      const gy = rng.int(2, h - 4);
      for (let y = 1; y < h - 1; y++) {
        if (y !== gy && y !== gy + 1 && tiles[y * w + wx] === T.FLOOR) set(wx, y, T.WALL);
      }
    }

    // contenedores de la planta: tiles FLOOR pegados a muro/ventana local
    const cands = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (tiles[y * w + x] !== T.FLOOR) continue;
        const n = [tiles[y * w + x - 1], tiles[y * w + x + 1], tiles[(y - 1) * w + x], tiles[(y + 1) * w + x]];
        if (n.includes(T.WALL) || n.includes(T.WINDOW)) cands.push({ x, y });
      }
    }
    shuffle(cands, rng);
    const z = kind === 'upper' ? 1 : -1;
    const wanted = kind === 'upper'
      ? ['armario', ...(rng.chance(0.45) ? ['casillero'] : []), ...(rng.chance(0.3) ? ['botiquin_pared'] : [])]
      : ['casillero', 'alacena', ...(rng.chance(0.5) ? ['casillero'] : []), ...(rng.chance(0.3) ? ['armario'] : [])];
    const containers = [];
    for (let i = 0; i < Math.min(wanted.length, cands.length); i++) {
      containers.push(this._addContainer(wanted[i], x0 + cands[i].x, y0 + cands[i].y, z));
    }

    const fl = {
      kind, z, tiles, w, h, x0, y0, containers,
      stairs: { tx: stairs.x, ty: stairs.y },
    };
    fl.canvas = this._buildFloorCanvas(fl);
    return fl;
  }

  /** Franjas de muro de una rejilla LOCAL de planta extra. */
  _runsLocal(fl, lx, ly) {
    const struct = (x, y) => {
      if (x < 0 || y < 0 || x >= fl.w || y >= fl.h) return false;
      const t = fl.tiles[y * fl.w + x];
      return t === T.WALL || t === T.WINDOW || t === T.DOOR_CLOSED || t === T.DOOR_OPEN;
    };
    const hR = struct(lx - 1, ly) || struct(lx + 1, ly);
    const vR = struct(lx, ly - 1) || struct(lx, ly + 1);
    return { h: hR || !vR, v: vR || !hR };
  }

  /**
   * Pre-renderiza el ARTE de una planta extra a su canvas (una vez por
   * partida): madera clara para el 2º piso (con alfombra), hormigón agrietado
   * y manchas de humedad para el sótano. Muros/ventanas con la MISMA franja
   * delgada del resto del juego. Este canvas es la "capa de planta" que
   * drawFloorLayer compone con alpha progresivo al subir/bajar escaleras.
   */
  _buildFloorCanvas(fl) {
    const rng = this.rng;
    const wpx = fl.w * TILE, hpx = fl.h * TILE;
    const fc = document.createElement('canvas');
    fc.width = wpx; fc.height = hpx;
    const c = fc.getContext('2d');
    const upper = fl.kind === 'upper';
    const off = (TILE - WALL_T) / 2;

    // suelo tile a tile (madera clara arriba / hormigón abajo)
    for (let ly = 0; ly < fl.h; ly++) {
      for (let lx = 0; lx < fl.w; lx++) {
        const t = fl.tiles[ly * fl.w + lx];
        const hs = hash2(fl.x0 + lx, fl.y0 + ly);
        const sx = lx * TILE, sy = ly * TILE;
        if (t === T.FLOOR || t === T.STAIRS || t === T.WALL || t === T.WINDOW) {
          if (upper) {
            c.fillStyle = hs < 0.5 ? '#7d6b50' : '#79674c';
            c.fillRect(sx, sy, TILE, TILE);
            c.fillStyle = 'rgba(0,0,0,0.12)';
            c.fillRect(sx, sy + TILE - 3, TILE, 2);
            if (hs > 0.62) c.fillRect(sx + Math.floor(hs * 24), sy, 2, TILE);
          } else {
            c.fillStyle = hs < 0.5 ? '#4b4b49' : '#474745';
            c.fillRect(sx, sy, TILE, TILE);
            c.fillStyle = 'rgba(0,0,0,0.18)';
            c.fillRect(sx, sy + TILE - 2, TILE, 1);
            if (hs > 0.66) {                       // grieta del hormigón
              c.strokeStyle = '#33332f';
              c.lineWidth = 1;
              c.beginPath();
              c.moveTo(sx + 5, sy + 6 + hs * 6);
              c.lineTo(sx + 15, sy + 14 + hs * 5);
              c.lineTo(sx + 26, sy + 11 + hs * 8);
              c.stroke();
            }
            if (hs > 0.4 && hs < 0.52) {           // mancha de humedad
              c.fillStyle = 'rgba(30,42,34,0.20)';
              c.fillRect(sx + 3, sy + 4, 18, 12);
            }
          }
        }
        if (t === T.STAIRS) this._drawStairsArt(c, sx, sy);
        if (t === T.WALL || t === T.WINDOW) {
          const runs = this._runsLocal(fl, lx, ly);
          if (runs.h) this._drawStripArt(c, t, sx, sy + off, TILE, WALL_T, true, fl.x0 + lx, fl.y0 + ly);
          if (runs.v) this._drawStripArt(c, t, sx + off, sy, WALL_T, TILE, false, fl.x0 + lx, fl.y0 + ly);
        }
      }
    }

    if (upper) {
      // alfombra bajo el centro (toque de dormitorio)
      if (fl.w >= 7 && fl.h >= 5) {
        const rx = rng.int(1, Math.max(1, fl.w - 5)), ry = rng.int(1, Math.max(1, fl.h - 4));
        const rw = rng.int(3, Math.min(4, fl.w - rx - 1)), rh = rng.int(2, Math.min(3, fl.h - ry - 1));
        let free = true;
        for (let y = ry; y < ry + rh && free; y++)
          for (let x = rx; x < rx + rw; x++)
            if (fl.tiles[y * fl.w + x] !== T.FLOOR) { free = false; break; }
        if (free) {
          c.fillStyle = 'rgba(122,72,60,0.5)';
          c.fillRect(rx * TILE + 4, ry * TILE + 4, rw * TILE - 8, rh * TILE - 8);
          c.strokeStyle = 'rgba(60,34,28,0.55)';
          c.lineWidth = 2;
          c.strokeRect(rx * TILE + 5, ry * TILE + 5, rw * TILE - 10, rh * TILE - 10);
        }
      }
    } else {
      // sótano: ambiente más cerrado — viñeta oscura en los bordes
      const g = c.createRadialGradient(wpx / 2, hpx / 2, Math.min(wpx, hpx) * 0.25, wpx / 2, hpx / 2, Math.max(wpx, hpx) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.30)');
      c.fillStyle = g;
      c.fillRect(0, 0, wpx, hpx);
    }

    // contorno del rect de la planta
    c.strokeStyle = 'rgba(8,10,8,0.65)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, wpx - 2, hpx - 2);
    return fc;
  }

  /** Arte de la escalera: pozo oscuro + peldaños de madera con luz. */
  _drawStairsArt(ctx, sx, sy) {
    ctx.fillStyle = '#241d15';                       // pozo
    ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#8a7455';                       // peldaños
    for (let i = 0; i < 5; i++) ctx.fillRect(sx + 4, sy + 5 + i * 5.4, TILE - 8, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';        // luz del primer peldaño
    ctx.fillRect(sx + 4, sy + 5, TILE - 8, 1);
    ctx.fillStyle = '#3a3025';                       // zócalos laterales
    ctx.fillRect(sx + 2, sy + 2, 3, TILE - 4);
    ctx.fillRect(sx + TILE - 5, sy + 2, 3, TILE - 4);
    ctx.strokeStyle = 'rgba(8,10,8,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 2.5, sy + 2.5, TILE - 5, TILE - 5);
  }

  /**
   * Pre-renderiza el TECHO de un edificio a un canvas propio (una sola vez
   * por partida): tejas/shingles por filas con juntas escalonadas, parches
   * de desgaste, bisel de luz/sombra en los bordes, cumbrera y chimenea.
   * Se compone encima de todo con alpha según la distancia del jugador
   * (ver drawRoofs).
   */
  _buildRoofCanvas(x0, y0, x1, y1, hasUpper = false) {
    const rng = this.rng;
    const w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
    const rc = document.createElement('canvas');
    rc.width = w; rc.height = h;
    const c = rc.getContext('2d');

    // paleta por edificio (base / sombra / luz)
    const palettes = [
      ['#46413a', '#39352f', '#524c43'],   // madera oscura
      ['#3f4448', '#33373b', '#4b5055'],   // pizarra
      ['#4a3a33', '#3b2e29', '#57453c'],   // teja de barro
      ['#3a4238', '#2e352d', '#465043'],   // verde musgo
      ['#43413c', '#35332f', '#4f4d47'],   // grava gris
    ];
    const pal = palettes[rng.index(palettes.length)];

    // base
    c.fillStyle = pal[0];
    c.fillRect(0, 0, w, h);

    // filas de tejas con juntas verticales escalonadas (patrón fijo por fila)
    c.fillStyle = pal[1];
    for (let y = 0; y < h; y += 8) {
      c.fillRect(0, y, w, 1);
      const row = y / 8;
      const stag = (row % 3) * 11;
      for (let x = stag; x < w; x += 22) c.fillRect(x, y + 1, 1, 7);
    }

    // parches de desgaste (manchas de musgo/humedad)
    c.fillStyle = 'rgba(0,0,0,0.12)';
    const patches = Math.max(3, Math.floor((w * h) / 1100));
    for (let i = 0; i < patches; i++) {
      c.fillRect(rng.int(0, Math.max(1, w - 22)), rng.int(0, Math.max(1, h - 14)),
        rng.int(8, 22), rng.int(6, 12));
    }
    c.fillStyle = 'rgba(122,184,72,0.05)';  // musgo sutil
    for (let i = 0; i < patches; i++) {
      c.fillRect(rng.int(0, Math.max(1, w - 16)), rng.int(0, Math.max(1, h - 10)),
        rng.int(6, 16), rng.int(4, 9));
    }

    // bisel: luz arriba/izquierda, sombra abajo/derecha (sensación de altura)
    c.fillStyle = pal[2];
    c.fillRect(0, 0, w, 3);
    c.fillRect(0, 0, 3, h);
    c.fillStyle = 'rgba(0,0,0,0.32)';
    c.fillRect(0, h - 3, w, 3);
    c.fillRect(w - 3, 0, 3, h);

    // cumbrera a lo largo del eje mayor
    c.fillStyle = 'rgba(255,255,255,0.10)';
    if (w >= h) c.fillRect(0, Math.floor(h / 2) - 1, w, 2);
    else c.fillRect(Math.floor(w / 2) - 1, 0, 2, h);

    // chimenea (posición determinista por edificio)
    if (w > 96 && h > 96) {
      const chx = rng.int(Math.floor(w * 0.25), Math.floor(w * 0.75));
      const chy = rng.int(Math.floor(h * 0.25), Math.floor(h * 0.75));
      c.fillStyle = 'rgba(0,0,0,0.30)';
      c.fillRect(chx - 4, chy - 2, 12, 12);   // sombra proyectada
      c.fillStyle = '#2b2b28';
      c.fillRect(chx - 5, chy - 5, 10, 10);
      c.fillStyle = '#3a3a36';
      c.fillRect(chx - 6, chy - 6, 12, 3);   // remate
    }

    // buhardillas: las casas con 2º piso asoman ventanas de ático en el
    // tejado — pista visual desde la calle de que hay piso de arriba
    if (hasUpper) {
      const n = w >= h ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const dx = Math.floor(w * (n === 1 ? 0.5 : 0.3 + 0.4 * i));
        const dy = Math.floor(h / 2);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(dx - 9, dy - 7, 20, 15);   // sombra
        c.fillStyle = '#33302a';
        c.fillRect(dx - 10, dy - 8, 20, 15);  // marco
        c.fillStyle = '#5d6d72';
        c.fillRect(dx - 8, dy - 6, 16, 11);   // cristal
        c.fillStyle = 'rgba(160,190,200,0.35)';
        c.fillRect(dx - 6, dy - 4, 5, 4);     // reflejo
        c.fillStyle = '#33302a';
        c.fillRect(dx - 1, dy - 6, 2, 11);    // parteluz
      }
    }

    // contorno
    c.strokeStyle = 'rgba(8,10,8,0.8)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, w - 2, h - 2);
    return rc;
  }

  /**
   * Tejado PLANO de la COMISARÍA: losas azuladas con juntas, pretil perimetral,
   * bandas de peligro azul/blanco en el frente, placa circular con ESTRELLA de
   * plata (el distintivo), climatizadoras y mástil de antena. 100%
   * determinista (sin rng) → firma de píxel estable para tests.
   */
  _buildPoliceRoofCanvas(x0, y0, x1, y1) {
    const w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
    const rc = document.createElement('canvas');
    rc.width = w; rc.height = h;
    const c = rc.getContext('2d');

    // base: losa de hormigón azulado
    c.fillStyle = '#46536b';
    c.fillRect(0, 0, w, h);
    // juntas de losa (rejilla 48px con desplazamiento)
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < w; x += 48) c.fillRect(x, 0, 2, h);
    for (let y = 0; y < h; y += 48) c.fillRect(0, y, w, 2);
    // desgaste sutil
    c.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < w * h / 2600; i++) {
      c.fillRect((i * 137) % w, (i * 89) % h, 3, 2);
    }

    // pretil perimetral (borde elevado)
    c.fillStyle = '#525f79';
    c.fillRect(0, 0, w, 5); c.fillRect(0, h - 5, w, 5);
    c.fillRect(0, 0, 5, h); c.fillRect(w - 5, 0, 5, h);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, h - 8, w, 3); c.fillRect(w - 8, 0, 3, h);

    // bandas de peligro azul/blanco en el frente (sur): chevrones diagonales
    const bandH = Math.min(42, Math.floor(h * 0.16));
    for (let x = -bandH; x < w + bandH; x += 24) {
      c.fillStyle = '#2e5a8a';
      c.beginPath();
      c.moveTo(x, h); c.lineTo(x + 12, h); c.lineTo(x + 12 + bandH, h - bandH);
      c.lineTo(x + bandH, h - bandH); c.closePath(); c.fill();
      c.fillStyle = '#c8ccd2';
      c.beginPath();
      c.moveTo(x + 12, h); c.lineTo(x + 24, h); c.lineTo(x + 24 + bandH, h - bandH);
      c.lineTo(x + 12 + bandH, h - bandH); c.closePath(); c.fill();
    }

    // placa central: disco oscuro + estrella de plata de 5 puntas
    const px = w / 2, py = h / 2 - bandH / 2;
    const R = Math.min(w, h) * 0.21;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.arc(px + 4, py + 4, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#26303e';
    c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#c8ccd2';
    c.lineWidth = 3;
    c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#2e5a8a';
    c.lineWidth = 2;
    c.beginPath(); c.arc(px, py, R - 6, 0, Math.PI * 2); c.stroke();
    // estrella de 5 puntas
    c.fillStyle = '#c9ccd4';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? R * 0.62 : R * 0.27;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const vx = px + Math.cos(a) * r, vy = py + Math.sin(a) * r;
      if (i === 0) c.moveTo(vx, vy); else c.lineTo(vx, vy);
    }
    c.closePath(); c.fill();

    // climatizadoras (2 cajas con rejilla)
    for (const [ax, ay] of [[w * 0.16, h * 0.2], [w * 0.84, h * 0.3]]) {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.fillRect(ax - 13, ay - 9, 30, 26);
      c.fillStyle = '#6a7488';
      c.fillRect(ax - 15, ay - 11, 30, 26);
      c.fillStyle = '#525c70';
      c.fillRect(ax - 12, ay - 8, 24, 20);
      c.fillStyle = 'rgba(0,0,0,0.4)';
      for (let i = 0; i < 4; i++) c.fillRect(ax - 12, ay - 6 + i * 5, 24, 2);
    }

    // mástil de antena con luz roja
    const mx = w * 0.9, my = h * 0.14;
    c.strokeStyle = '#7a8496';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(mx, my); c.lineTo(mx, my + 26); c.stroke();
    c.beginPath(); c.moveTo(mx - 7, my + 26); c.lineTo(mx + 7, my + 26); c.stroke();
    c.fillStyle = '#c0392b';
    c.beginPath(); c.arc(mx, my, 4, 0, Math.PI * 2); c.fill();

    // contorno
    c.strokeStyle = 'rgba(8,10,8,0.85)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, w - 2, h - 2);
    return rc;
  }

  /**
   * Tejado PLANO de la TIENDA: grava oscura, franjas de MARQUESINA rojo/blanco
   * en el frente, DIANA comercial (anillos concéntricos) como rótulo, una fila
   * de LUCERNARIOS de cristal y dos extractores. 100% determinista (sin rng).
   */
  _buildStoreRoofCanvas(x0, y0, x1, y1) {
    const w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
    const rc = document.createElement('canvas');
    rc.width = w; rc.height = h;
    const c = rc.getContext('2d');

    // base: grava bituminosa
    c.fillStyle = '#3a3a40';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.04)';
    for (let i = 0; i < w * h / 2200; i++) {
      c.fillRect((i * 131) % w, (i * 73) % h, 2, 2);
    }
    // parches de humedad
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.fillRect(w * 0.55, h * 0.12, w * 0.2, h * 0.1);
    c.fillRect(w * 0.1, h * 0.62, w * 0.14, h * 0.09);

    // remate perimetral
    c.fillStyle = '#4a4a52';
    c.fillRect(0, 0, w, 4); c.fillRect(0, h - 4, w, 4);
    c.fillRect(0, 0, 4, h); c.fillRect(w - 4, 0, 4, h);

    // marquesina: franjas verticales rojo/blanco en el frente (sur)
    const bandH = Math.min(38, Math.floor(h * 0.15));
    for (let x = 0; x < w; x += 20) {
      c.fillStyle = '#a83a32';
      c.fillRect(x, h - bandH, 10, bandH);
      c.fillStyle = '#d8d0c0';
      c.fillRect(x + 10, h - bandH, 10, bandH);
    }
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(0, h - bandH - 3, w, 3);   // sombra del canalón

    // diana comercial (rótulo): anillos concéntricos
    const px = w / 2, py = h / 2 - bandH / 2;
    const R = Math.min(w, h) * 0.19;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.arc(px + 4, py + 4, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#a83a32';
    c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d8d0c0';
    c.beginPath(); c.arc(px, py, R * 0.66, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#a83a32';
    c.beginPath(); c.arc(px, py, R * 0.33, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.4)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(px, py, R, 0, Math.PI * 2); c.stroke();

    // fila de lucernarios (3 cristales con marco y reflejo)
    const skyY = h * 0.18, skyW = w * 0.16, skyH = h * 0.2;
    for (let i = 0; i < 3; i++) {
      const sxx = w * 0.12 + i * (skyW + w * 0.06);
      c.fillStyle = '#2b2f36';
      c.fillRect(sxx - 3, skyY - 3, skyW + 6, skyH + 6);
      c.fillStyle = '#5d6d72';
      c.fillRect(sxx, skyY, skyW, skyH);
      c.fillStyle = 'rgba(160,190,200,0.30)';
      c.fillRect(sxx + 3, skyY + 3, skyW * 0.35, skyH * 0.3);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(sxx, skyY + skyH * 0.55, skyW, 2);
    }

    // extractores (2 cilindros bajos)
    for (const [ex, ey] of [[w * 0.85, h * 0.72], [w * 0.3, h * 0.82]]) {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.arc(ex + 3, ey + 3, 11, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#5a5a64';
      c.beginPath(); c.arc(ex, ey, 11, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#44444e';
      c.beginPath(); c.arc(ex, ey, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.beginPath(); c.arc(ex - 3, ey - 3, 4, 0, Math.PI * 2); c.fill();
    }

    // contorno
    c.strokeStyle = 'rgba(8,10,8,0.85)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, w - 2, h - 2);
    return rc;
  }

  _addContainer(type, tx, ty, z = 0) {
    const defs = {
      nevera: { name: 'Nevera', color: '#aeb6ba', letter: 'N' },
      alacena: { name: 'Alacena', color: '#8a6a42', letter: 'A' },
      armario: { name: 'Armario', color: '#6a4a2c', letter: 'R' },
      casillero: { name: 'Casillero', color: '#4a6a6a', letter: 'C' },
      botiquin_pared: { name: 'Botiquín', color: '#d94a4a', letter: '+' },
      armeria: { name: 'Armería', color: '#3a4a6a', letter: 'W' },
      estanteria: { name: 'Estantería', color: '#a84a3a', letter: 'E' },
      // v0.16: base militar
      taquilla_mil: { name: 'Taquilla militar', color: '#3f4a3f', letter: 'M' },
      caja_municion: { name: 'Caja de munición', color: '#5a5240', letter: 'X' },
      armeria_mil: { name: 'Armería militar', color: '#2f3a2f', letter: 'G' },
      estanteria_mil: { name: 'Estantería de suministros', color: '#6a6a4a', letter: 'S' },
    };
    const d = defs[type];
    const c = {
      type, name: d.name, color: d.color, letter: d.letter,
      x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
      items: [], searched: false, z,
    };
    this.containers.push(c);
    return c;
  }

  /** Arte de un contenedor (compartido por planta baja y plantas extra). */
  _drawContainer(ctx, c, sx, sy) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(sx - 11, sy - 8, 24, 22);
    ctx.fillStyle = c.searched ? '#3a3a36' : c.color;
    ctx.fillRect(sx - 12, sy - 11, 24, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(sx - 12, sy - 11, 24, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(sx - 12, sy + 7, 24, 4);
    if (c.searched) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.moveTo(sx - 12, sy - 11); ctx.lineTo(sx + 12, sy + 11); ctx.stroke();
    }
    ctx.fillStyle = c.searched ? '#777' : '#111';
    ctx.font = 'bold 11px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.letter, sx, sy + 1);
  }

  /** Tile de interior libre más cercano a un punto (px). */
  nearestIndoorFree(px, py) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      const d = Math.hypot(b.cx - px, b.cy - py);
      if (d < bd) {
        const tx = Math.floor(b.cx / TILE), ty = Math.floor(b.cy / TILE);
        if (this.tileAtIdx(tx, ty) === T.FLOOR) { bd = d; best = { x: b.cx, y: b.cy }; }
      }
    }
    return best;
  }

  /** Tile exterior caminable aleatorio (px), con distancia mínima a un punto. */
  randomOutdoor(minDistFrom, minDist) {
    for (let i = 0; i < 200; i++) {
      // v0.11 FIX: decodificar el ÍNDICE DE TILE guardado en la lista, no la
      // posición aleatoria dentro de ella (antes se leía idx como tile →
      // spawns amontonados arriba-izquierda y dentro de edificios).
      const ti = this.outdoorTiles[this.rng.index(this.outdoorTiles.length)];
      const tx = ti % MAP_W, ty = Math.floor(ti / MAP_W);
      const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
      if (Math.hypot(x - minDistFrom.x, y - minDistFrom.y) >= minDist) return { x, y };
    }
    return null;
  }

  /** Tile de interior aleatorio (px). */
  randomIndoor() {
    if (!this.indoorTiles.length) return null;
    const ti = this.indoorTiles[this.rng.index(this.indoorTiles.length)];
    const tx = ti % MAP_W, ty = Math.floor(ti / MAP_W);
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  }

  /** Tile FLOOR aleatorio DENTRO de un edificio concreto (px). */
  randomIndoorIn(b) {
    for (let i = 0; i < 60; i++) {
      const tx = this.rng.int(b.x0 + 1, b.x1 - 1);
      const ty = this.rng.int(b.y0 + 1, b.y1 - 1);
      if (this.tileAtIdx(tx, ty) === T.FLOOR) {
        return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
      }
    }
    return null;
  }

  /** Tile exterior caminable aleatorio en un anillo [rMin,rMax] alrededor de un punto (px). */
  randomOutdoorNear(px, py, rMin, rMax) {
    for (let i = 0; i < 80; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(rMin, rMax);
      const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      const t = this.tiles[this.idx(tx, ty)];
      if (t === T.ROAD || t === T.SIDEWALK || t === T.GRASS) {
        return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
      }
    }
    return null;
  }

  /**
   * Puntos de RESPAWN NOCTURNO (v0.11): tiles exteriores caminables que están
   * SIEMPRE fuera de la línea de visión del jugador:
   *  - a 500+ px (más allá del alcance del cono, 440 px, y de la periferia),
   *  - fuera del cono frontal (por si el alcance de visión crece algún día) y
   *  - sin línea de vista directa (muro/portero de por medio).
   * Así los muertos "llegan caminando" a la noche en vez de aparecer a la vista.
   */
  nightSpawnSpots(player, n) {
    const out = [];
    const SAFE = VISION.range + 60;          // margen de seguridad al alcance
    for (let i = 0; i < n * 25 && out.length < n; i++) {
      const pos = this.randomOutdoor(player, 500);
      if (!pos) break;
      const dx = pos.x - player.x, dy = pos.y - player.y;
      const d = Math.hypot(dx, dy);
      if (d < 500) continue;                 // nunca a la vista
      if (this.circleHitsSolid(pos.x, pos.y, 12)) continue;   // árbol/coche/atasco: no
      const a = Math.atan2(dy, dx);
      if (d < SAFE + 60 && Math.abs(angDiff(player.angle, a)) < VISION.halfAngle + 0.1) continue;
      if (d < SAFE + 60 && this.lineClear(player.x, player.y, pos.x, pos.y)) continue;
      out.push(pos);
    }
    return out;
  }

  // ================== Render ==================

  drawGround(ctx, cam) {
    const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const x1 = Math.min(MAP_W - 1, Math.ceil((cam.x + cam.w) / TILE) + 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const y1 = Math.min(MAP_H - 1, Math.ceil((cam.y + cam.h) / TILE) + 1);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = this.tiles[this.idx(tx, ty)];
        const sx = Math.round(tx * TILE - cam.x + cam.offX);
        const sy = Math.round(ty * TILE - cam.y + cam.offY);
        const h = hash2(tx, ty);
        switch (t) {
          case T.GRASS: {
            ctx.fillStyle = h < 0.5 ? '#37432e' : '#3a4630';
            ctx.fillRect(sx, sy, TILE, TILE);
            if (h > 0.72) {
              ctx.fillStyle = '#42513a';
              ctx.fillRect(sx + 8 + h * 10, sy + 10 + h * 8, 3, 2);
              ctx.fillRect(sx + 4 + h * 14, sy + 20 - h * 6, 2, 2);
            }
            break;
          }
          case T.ROAD: {
            // asfalto: base con variación por tile + grano + remiendos + grietas
            ctx.fillStyle = h < 0.5 ? '#26262a' : '#29292d';
            ctx.fillRect(sx, sy, TILE, TILE);
            // grano (puntos claros deterministas por tile)
            ctx.fillStyle = 'rgba(255,255,255,0.035)';
            ctx.fillRect(sx + Math.floor(h * 26), sy + Math.floor((h * 61) % 27), 2, 2);
            ctx.fillRect(sx + Math.floor((h * 97) % 28), sy + Math.floor(h * 23), 2, 1);
            // remiendo oscuro (asfalto reaparado)
            if (h > 0.62 && h < 0.74) {
              ctx.fillStyle = 'rgba(0,0,0,0.16)';
              ctx.fillRect(sx + 4, sy + 6, 20, 14);
            }
            // grieta en zigzag
            if (h > 0.9) {
              ctx.strokeStyle = '#1d1d21';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(sx + 5, sy + 7 + h * 6);
              ctx.lineTo(sx + 15, sy + 13 + h * 5);
              ctx.lineTo(sx + 26, sy + 10 + h * 8);
              ctx.stroke();
            }
            break;
          }
          case T.SIDEWALK: {
            // losas de hormigón: juntas cada 16px + luz biselada + bordillo
            ctx.fillStyle = h < 0.5 ? '#525249' : '#4f4f46';
            ctx.fillRect(sx, sy, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,0.17)';   // juntas de las losas
            ctx.fillRect(sx, sy, TILE, 1);
            ctx.fillRect(sx, sy + 16, TILE, 1);
            ctx.fillRect(sx, sy, 1, TILE);
            ctx.fillRect(sx + 16, sy, 1, TILE);
            ctx.fillStyle = 'rgba(255,255,255,0.05)'; // luz superior de la losa
            ctx.fillRect(sx + 1, sy + 1, TILE - 2, 1);
            if (h > 0.78) {                       // mancha de desgaste
              ctx.fillStyle = 'rgba(0,0,0,0.10)';
              ctx.fillRect(sx + 5 + h * 10, sy + 6, 10, 8);
            }
            // bordillo en el lado que mira a la calzada
            ctx.fillStyle = '#3a3a35';
            if (this.tileAtIdx(tx, ty - 1) === T.ROAD) ctx.fillRect(sx, sy, TILE, 3);
            if (this.tileAtIdx(tx, ty + 1) === T.ROAD) ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
            if (this.tileAtIdx(tx - 1, ty) === T.ROAD) ctx.fillRect(sx, sy, 3, TILE);
            if (this.tileAtIdx(tx + 1, ty) === T.ROAD) ctx.fillRect(sx + TILE - 3, sy, 3, TILE);
            break;
          }
          case T.FLOOR: {
            // tinte de suelo por tipo de edificio: comisaría = linóleo
            // azul-gris, tienda = baldosa ajedrez comercial, casa = madera
            const bi = this._bIdx[this.idx(tx, ty)];
            const bk = bi >= 0 ? this.buildings[bi].kind : null;
            if (bk === 'police') {
              ctx.fillStyle = h < 0.5 ? '#59626e' : '#555e68';
              ctx.fillRect(sx, sy, TILE, TILE);
              ctx.fillStyle = 'rgba(0,0,0,0.18)';
              if (tx % 3 === 0) ctx.fillRect(sx, sy, 2, TILE);
              if (ty % 3 === 0) ctx.fillRect(sx, sy, TILE, 2);
            } else if (bk === 'store') {
              ctx.fillStyle = (tx + ty) % 2 ? '#7c766a' : '#8a857a';
              ctx.fillRect(sx, sy, TILE, TILE);
              ctx.fillStyle = 'rgba(0,0,0,0.12)';
              ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
              ctx.fillRect(sx + TILE - 2, sy, 2, TILE);
            } else if (bk === 'military') {
              // v0.16: base militar — hormigón verde oliva con juntas técnicas
              ctx.fillStyle = h < 0.5 ? '#4c5344' : '#485040';
              ctx.fillRect(sx, sy, TILE, TILE);
              ctx.fillStyle = 'rgba(0,0,0,0.18)';
              if (tx % 4 === 0) ctx.fillRect(sx, sy, 1, TILE);
              if (ty % 4 === 0) ctx.fillRect(sx, sy, TILE, 1);
              ctx.fillStyle = 'rgba(0,0,0,0.14)';
              ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
            } else {
              ctx.fillStyle = h < 0.5 ? '#6e5c44' : '#6a5840';
              ctx.fillRect(sx, sy, TILE, TILE);
              ctx.fillStyle = 'rgba(0,0,0,0.14)';
              ctx.fillRect(sx, sy + TILE - 3, TILE, 2);
              if (h > 0.6) ctx.fillRect(sx + Math.floor(h * 24), sy, 2, TILE);
            }
            break;
          }
          case T.WALL:
          case T.WINDOW:
          case T.DOOR_CLOSED:
          case T.DOOR_OPEN:
            this._drawStructTile(ctx, t, sx, sy, tx, ty);
            break;
          case T.TREE: {
            ctx.fillStyle = '#37432e';
            ctx.fillRect(sx, sy, TILE, TILE);
            ctx.fillStyle = '#4a3b28';
            ctx.beginPath();
            ctx.arc(sx + TILE / 2, sy + TILE / 2, 5, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          case T.CAR: {
            ctx.fillStyle = '#26262a';
            ctx.fillRect(sx, sy, TILE, TILE);
            break;
          }
          case T.STAIRS:
            this._drawStairsArt(ctx, sx, sy);
            break;
        }
      }
    }

    // pintura vial PRECALCULADA y anclada al mundo: la fase de los guiones
    // pertenece al asfalto, no a la pantalla → no se desliza con la cámara
    for (const m of this.roadPaint) {
      const sx = Math.round(m.x - cam.x + cam.offX);
      const sy = Math.round(m.y - cam.y + cam.offY);
      if (sx > cam.w || sy > cam.h || sx + m.w < 0 || sy + m.h < 0) continue;
      ctx.fillStyle = m.c;
      ctx.fillRect(sx, sy, m.w, m.h);
    }

    // tapas de alcantarilla
    for (const m of this.manholes) {
      const sx = Math.round(m.x - cam.x + cam.offX);
      const sy = Math.round(m.y - cam.y + cam.offY);
      if (sx < -12 || sy < -12 || sx > cam.w + 12 || sy > cam.h + 12) continue;
      ctx.fillStyle = '#1b1b1f';
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(sx - 4, sy - 1, 8, 2);
    }

    // coches (arte compartido: base bajo la niebla; versión nítida encima)
    for (const car of this.cars) {
      const sx = Math.round(car.x - cam.x + cam.offX - car.w / 2);
      const sy = Math.round(car.y - cam.y + cam.offY - car.h / 2);
      if (sx > cam.w + 40 || sy > cam.h + 40 || sx + car.w < -40 || sy + car.h < -40) continue;
      this._drawCarArt(ctx, sx, sy, car);
    }

    // decals de sangre/cadáveres: el canvas vive a MEDIA resolución (u = x/2),
    // así que se dibuja a 2x ANCLADO AL MUNDO (u → pantalla = 2u - cam.x + offX).
    // FIX v0.8: antes se pintaba a escala 1:1 con el offset partido a la mitad,
    // con lo que la sangre quedaba pegada a una posición fija de pantalla que
    // "seguía" al jugador. Ahora queda donde cayó, como debe ser.
    // Solo se arrastra la región visible (recorte fuente → destino 2x).
    {
      const dvx = cam.x - cam.offX, dvy = cam.y - cam.offY; // esquina visible en mundo
      const sx0 = Math.max(0, Math.floor(dvx / 2) - 4);
      const sy0 = Math.max(0, Math.floor(dvy / 2) - 4);
      const sw = Math.min(this.decalCanvas.width - sx0, Math.ceil((cam.w + 16) / 2));
      const sh = Math.min(this.decalCanvas.height - sy0, Math.ceil((cam.h + 16) / 2));
      if (sw > 0 && sh > 0) {
        ctx.drawImage(this.decalCanvas,
          sx0, sy0, sw, sh,
          sx0 * 2 - cam.x + cam.offX, sy0 * 2 - cam.y + cam.offY, sw * 2, sh * 2);
      }
    }

    // contenedores (solo los de la PLANTA BAJA: los de pisos/sótanos los
    // dibuja drawFloorLayer con su propia capa)
    for (const c of this.containers) {
      if (c.z) continue;
      const sx = Math.round(c.x - cam.x + cam.offX);
      const sy = Math.round(c.y - cam.y + cam.offY);
      if (sx < -30 || sy < -30 || sx > cam.w + 30 || sy > cam.h + 30) continue;
      this._drawContainer(ctx, c, sx, sy);
    }
  }

  /** Color base de suelo para rellenar las bandas alrededor de un muro. */
  _groundBase(t, h) {
    switch (t) {
      case T.ROAD: return '#26262a';
      case T.SIDEWALK: return h < 0.5 ? '#4a4a44' : '#474741';
      case T.FLOOR: return h < 0.5 ? '#6e5c44' : '#6a5840';
      default: return h < 0.5 ? '#37432e' : '#3a4630'; // hierba
    }
  }

  /**
   * Suelo bajo un tile de estructura: exterior alrededor + banda(s) de suelo
   * interior hacia los vecinos FLOOR. El muro es una franja delgada y el
   * resto del tile es suelo real (transitable y transparente a la vista).
   */
  _drawStructGround(ctx, sx, sy, tx, ty, runs) {
    const hsh = hash2(tx, ty);
    const below = this.tileAtIdx(tx, ty + 1), above = this.tileAtIdx(tx, ty - 1);
    const right = this.tileAtIdx(tx + 1, ty), left = this.tileAtIdx(tx - 1, ty);

    // color exterior: el primer vecino cardinal que es suelo exterior
    let ext = hsh < 0.5 ? '#37432e' : '#3a4630';
    if (below === T.GRASS || below === T.SIDEWALK || below === T.ROAD) ext = this._groundBase(below, hsh);
    else if (above === T.GRASS || above === T.SIDEWALK || above === T.ROAD) ext = this._groundBase(above, hsh);
    else if (left === T.GRASS || left === T.SIDEWALK || left === T.ROAD) ext = this._groundBase(left, hsh);
    else if (right === T.GRASS || right === T.SIDEWALK || right === T.ROAD) ext = this._groundBase(right, hsh);
    ctx.fillStyle = ext;
    ctx.fillRect(sx, sy, TILE, TILE);

    // bandas de interior (suelo) hacia los lados con FLOOR
    const off = (TILE - WALL_T) / 2;
    const band = TILE - off - WALL_T;
    const flr = hsh < 0.5 ? '#6e5c44' : '#6a5840';
    ctx.fillStyle = flr;
    if (runs.h && !runs.v) {
      if (below === T.FLOOR) ctx.fillRect(sx, sy + off + WALL_T, TILE, band);
      if (above === T.FLOOR) ctx.fillRect(sx, sy, TILE, off);
    } else if (runs.v && !runs.h) {
      if (right === T.FLOOR) ctx.fillRect(sx + off + WALL_T, sy, band, TILE);
      if (left === T.FLOOR) ctx.fillRect(sx, sy, off, TILE);
    } else if (runs.h && runs.v) {
      // esquina / unión en T: cuadrantes hacia los FLOOR diagonales
      if (this.tileAtIdx(tx + 1, ty + 1) === T.FLOOR) ctx.fillRect(sx + off + WALL_T, sy + off + WALL_T, band, band);
      if (this.tileAtIdx(tx - 1, ty + 1) === T.FLOOR) ctx.fillRect(sx, sy + off + WALL_T, band, band);
      if (this.tileAtIdx(tx + 1, ty - 1) === T.FLOOR) ctx.fillRect(sx + off + WALL_T, sy, band, band);
      if (this.tileAtIdx(tx - 1, ty - 1) === T.FLOOR) ctx.fillRect(sx, sy, band, band);
    }
  }

  /**
   * Arte de la franja de muro/ventana/puerta dentro de su rect (x, y, w, h).
   * horiz=true → el muro corre de izquierda a derecha (franja horizontal).
   */
  _drawStripArt(ctx, t, x, y, w, h, horiz, tx, ty) {
    switch (t) {
      case T.WALL: {
        ctx.fillStyle = '#4e4639';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#5d5344';                     // luz superior/izquierda
        if (horiz) ctx.fillRect(x, y, w, 3); else ctx.fillRect(x, y, 3, h);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';            // sombra inferior/derecha
        if (horiz) ctx.fillRect(x, y + h - 3, w, 3); else ctx.fillRect(x + w - 3, y, 3, h);
        break;
      }
      case T.WINDOW: {
        ctx.fillStyle = '#4e4639';                     // marco
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#8fa3ad';                     // cristal
        if (horiz) ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
        else ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
        ctx.strokeStyle = '#33302a';
        ctx.lineWidth = 1;
        if (horiz) ctx.strokeRect(x + 1.5, y + 2.5, w - 3, h - 5);
        else ctx.strokeRect(x + 2.5, y + 1.5, w - 5, h - 3);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';      // reflejo
        if (horiz) ctx.fillRect(x + 3, y + 3, 6, 3); else ctx.fillRect(x + 3, y + 3, 3, 6);
        ctx.fillStyle = '#33302a';                     // travesaño central
        if (horiz) ctx.fillRect(x + w / 2 - 0.5, y + 2, 1, h - 4);
        else ctx.fillRect(x + 2, y + h / 2 - 0.5, w - 4, 1);
        break;
      }
      case T.DOOR_CLOSED: {
        ctx.fillStyle = '#6a5840';                     // umbral
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#6b4b2c';                     // hoja
        if (horiz) ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
        else ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
        ctx.fillStyle = '#d9c06a';                     // pomo
        if (horiz) ctx.fillRect(x + w - 7, y + h / 2 - 1.5, 3, 3);
        else ctx.fillRect(x + w / 2 - 1.5, y + h - 7, 3, 3);
        break;
      }
      case T.DOOR_OPEN: {
        ctx.fillStyle = '#75634a';                     // umbral practicable
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';            // jambas marcadas
        if (horiz) { ctx.fillRect(x, y, 2, h); ctx.fillRect(x + w - 2, y, 2, h); }
        else { ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + h - 2, w, 2); }
        // hoja abierta tumbada contra el lado interior del muro
        const below = this.tileAtIdx(tx, ty + 1) === T.FLOOR;
        const above = this.tileAtIdx(tx, ty - 1) === T.FLOOR;
        const right = this.tileAtIdx(tx + 1, ty) === T.FLOOR;
        const left = this.tileAtIdx(tx - 1, ty) === T.FLOOR;
        ctx.fillStyle = '#5a3f24';
        if (horiz) {
          if (below) ctx.fillRect(x, y + h, w, 4);
          else if (above) ctx.fillRect(x, y - 4, w, 4);
        } else {
          if (right) ctx.fillRect(x + w, y, 4, h);
          else if (left) ctx.fillRect(x - 4, y, 4, h);
        }
        break;
      }
    }
  }

  /** Dibuja las franjas (h y/o v) de un tile de estructura en pantalla. */
  _drawStructStrips(ctx, t, sx, sy, tx, ty, runs) {
    const off = (TILE - WALL_T) / 2;
    if (runs.h) this._drawStripArt(ctx, t, sx, sy + off, TILE, WALL_T, true, tx, ty);
    if (runs.v) this._drawStripArt(ctx, t, sx + off, sy, WALL_T, TILE, false, tx, ty);
  }

  /**
   * Tile de estructura completo (para drawGround, bajo la niebla): suelo
   * alrededor de la franja + arte del muro/ventana/puerta delgado.
   */
  _drawStructTile(ctx, t, sx, sy, tx, ty) {
    const runs = this._runsFor(tx, ty);
    this._drawStructGround(ctx, sx, sy, tx, ty, runs);
    this._drawStructStrips(ctx, t, sx, sy, tx, ty, runs);
  }

  /**
   * Arte de coche abandonado — compartido por la base bajo la niebla
   * (drawGround) y el redibujado NÍTIDO sobre la niebla (drawStructOver).
   * Contorno definido, techo con brillo, parabrisas con reflejo y faros.
   */
  _drawCarArt(ctx, sx, sy, car) {
    const w = car.w, h = car.h;
    // sombra proyectada
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(sx + 3, sy + 4, w, h);
    // carrocería
    ctx.fillStyle = car.color;
    ctx.fillRect(sx, sy, w, h);
    // techo/capó con brillo direccional
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(sx + 2, sy + 2, w * 0.56, h - 4);
    // parabrisas + reflejo
    ctx.fillStyle = '#1e2630';
    ctx.fillRect(sx + w * 0.62, sy + 4, w * 0.2, h - 8);
    ctx.fillStyle = 'rgba(140,180,200,0.30)';
    ctx.fillRect(sx + w * 0.62, sy + 5, w * 0.2, 3);
    // ventanas laterales
    ctx.fillStyle = '#15181c';
    ctx.fillRect(sx + 6, sy + 3, w * 0.28, 4);
    ctx.fillRect(sx + 6, sy + h - 7, w * 0.28, 4);
    // ruedas
    ctx.fillStyle = '#111';
    ctx.fillRect(sx + 8, sy - 3, 12, 5);
    ctx.fillRect(sx + w - 20, sy - 3, 12, 5);
    ctx.fillRect(sx + 8, sy + h - 2, 12, 5);
    ctx.fillRect(sx + w - 20, sy + h - 2, 12, 5);
    // faros delanteros (morro a la derecha) y luces traseras
    ctx.fillStyle = '#d9cfa0';
    ctx.fillRect(sx + w - 3, sy + 5, 3, 4);
    ctx.fillRect(sx + w - 3, sy + h - 9, 3, 4);
    ctx.fillStyle = '#7a2020';
    ctx.fillRect(sx, sy + 5, 3, 4);
    ctx.fillRect(sx, sy + h - 9, 3, 4);
    // contorno nítido
    ctx.strokeStyle = 'rgba(10,12,14,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
  }

  /**
   * Arte de árbol — compartido por drawOverhead (bajo la niebla) y el
   * redibujado NÍTIDO sobre la niebla (drawStructOver). Copa por capas con
   * toque de luz y contorno definido; tronco asomando al pie.
   */
  _drawTreeArt(ctx, sx, sy, r) {
    // sombra proyectada
    ctx.fillStyle = 'rgba(24, 34, 20, 0.4)';
    ctx.beginPath(); ctx.arc(sx + 3, sy + 4, r, 0, Math.PI * 2); ctx.fill();
    // tronco asomando al pie (leve sensación de altura)
    ctx.fillStyle = '#4a3b28';
    ctx.beginPath(); ctx.arc(sx + r * 0.45, sy + r * 0.5, 4.5, 0, Math.PI * 2); ctx.fill();
    // copa por capas
    ctx.fillStyle = '#2c4023';
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#35502a';
    ctx.beginPath(); ctx.arc(sx - r * 0.2, sy - r * 0.25, r * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#416034';
    ctx.beginPath(); ctx.arc(sx - r * 0.3, sy - r * 0.35, r * 0.4, 0, Math.PI * 2); ctx.fill();
    // toque de luz
    ctx.fillStyle = 'rgba(120, 165, 95, 0.4)';
    ctx.beginPath(); ctx.arc(sx - r * 0.38, sy - r * 0.42, r * 0.16, 0, Math.PI * 2); ctx.fill();
    // contorno nítido
    ctx.strokeStyle = 'rgba(16, 26, 12, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  }

  /**
   * PLANTAS: capa del 2º piso o del sótano, dibujada SOBRE la escena de
   * planta baja del edificio en el que está el jugador (encima de zombis y
   * contenedores de abajo, debajo del jugador y de la niebla).
   *  - En planta baja sin subir: alpha 0 → la otra planta NO se ve.
   *  - Subiendo/bajando escaleras: alpha progresivo (fundido 0→1 o 1→0):
   *    la planta destino va apareciendo cada vez más nítidamente.
   *  - En la planta extra: alpha 1 → opaca, tapa lo que hay debajo.
   */
  drawFloorLayer(ctx, cam, game) {
    const p = game.player;
    if (!p) return;
    const b = this.buildingAtPx(p.x, p.y);
    if (!b) return;

    let fl = null, alpha = 0;
    if (p.climb) {
      // fundido durante la escalera: la capa es la planta DESTINO si subes,
      // o la planta ORIGEN si bajas (se desvanece revelando la baja)
      const to = p.climb.to;
      fl = to === 1 ? b.upper : to === -1 ? b.basement
        : (p.climb.from === 1 ? b.upper : b.basement);
      alpha = to !== 0 ? p.climb.k : 1 - p.climb.k;
    } else if (p.z === 1 && b.upper) { fl = b.upper; alpha = 1; }
    else if (p.z === -1 && b.basement) { fl = b.basement; alpha = 1; }

    if (!fl || alpha <= 0.02) return;
    const sx = Math.round(b.x0 * TILE - cam.x + cam.offX);
    const sy = Math.round(b.y0 * TILE - cam.y + cam.offY);
    if (sx > cam.w + 8 || sy > cam.h + 8 || sx + fl.w * TILE < -8 || sy + fl.h * TILE < -8) return;

    ctx.globalAlpha = alpha;
    ctx.drawImage(fl.canvas, sx, sy);
    // contenedores de esa planta (visibles en la misma medida que la capa)
    for (const c of fl.containers) {
      const csx = Math.round(c.x - cam.x + cam.offX);
      const csy = Math.round(c.y - cam.y + cam.offY);
      if (csx < -30 || csy < -30 || csx > cam.w + 30 || csy > cam.h + 30) continue;
      this._drawContainer(ctx, c, csx, csy);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Redibuja la estructura Y los props VISIBLES por encima de la niebla.
   * La cara frontal de muros/ventanas/puertas ya no queda oscurecida por su
   * propia sombra: las paredes se distinguen con claridad en todo el cono.
   * Muros DELGADOS: aquí solo se redibuja la FRANJA (el suelo de las bandas
   * ya quedó iluminado por el cono bajo la niebla) y la atenuación por
   * distancia se aplica solo a la franja, no al suelo de alrededor.
   * Árboles y coches no tapan la visión del jugador y también se redibujan
   * NÍTIDOS (atenuación menor que los muros) cuando hay línea de visión.
   * El interior de los edificios sigue oculto — solo entra en wallTiles lo
   * que tiene línea de visión directa (ventanas y puertas abiertas).
   * Las copas van al final: son lo más alto de la escena.
   */
  drawStructOver(ctx, cam, game) {
    const vision = game.vision, p = game.player;
    if (!vision || !vision.wallTiles || !vision.wallTiles.size) return;
    // planta del jugador: los muros nítidos son los de TU planta (arriba se
    // ven los del 2º piso, no los de la baja que quedan debajo)
    const vz = p.climb ? p.climb.to : (p.z || 0);

    const canopyTiles = [];
    const drawnCars = new Set();
    const off = (TILE - WALL_T) / 2;

    // pasada 1: muros/ventanas/puertas + coches (a nivel de suelo)
    for (const idx of vision.wallTiles) {
      const tx = idx % MAP_W, ty = Math.floor(idx / MAP_W);
      const t = this.tileAtZ(tx, ty, vz);
      if (t === T.TREE) { canopyTiles.push(idx); continue; }

      if (t === T.CAR) {
        const car = this.carByTile.get(idx);
        if (!car || drawnCars.has(car)) continue; // 2 tiles → 1 solo coche
        drawnCars.add(car);
        const csx = Math.round(car.x - cam.x + cam.offX - car.w / 2);
        const csy = Math.round(car.y - cam.y + cam.offY - car.h / 2);
        if (csx > cam.w + 40 || csy > cam.h + 40 || csx + car.w < -40 || csy + car.h < -40) continue;
        this._drawCarArt(ctx, csx, csy, car);
        const kc = Math.max(0, Math.min(1,
          (Math.hypot(car.x - p.x, car.y - p.y) - VISION.nearR) / (VISION.range - VISION.nearR)));
        const dimC = kc * VISION.propDim;
        if (dimC > 0.01) {
          ctx.fillStyle = `rgba(3,5,3,${dimC.toFixed(3)})`;
          ctx.fillRect(csx, csy, car.w, car.h);
        }
        continue;
      }

      const sx = Math.round(tx * TILE - cam.x + cam.offX);
      const sy = Math.round(ty * TILE - cam.y + cam.offY);
      if (sx > cam.w + TILE || sy > cam.h + TILE || sx + TILE < -TILE || sy + TILE < -TILE) continue;
      // solo la franja delgada: el suelo alrededor queda como lo dejó el cono
      const runs = this._runsForZ(tx, ty, vz);
      this._drawStructStrips(ctx, t, sx, sy, tx, ty, runs);
      // atenuación con la distancia (solo sobre la franja): 0 junto al jugador
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      const k = Math.max(0, Math.min(1,
        (Math.hypot(cx - p.x, cy - p.y) - VISION.nearR) / (VISION.range - VISION.nearR)));
      const dim = k * VISION.wallDim;
      if (dim > 0.01) {
        ctx.fillStyle = `rgba(3,5,3,${dim.toFixed(3)})`;
        if (runs.h) ctx.fillRect(sx, sy + off, TILE, WALL_T);
        if (runs.v) ctx.fillRect(sx + off, sy, WALL_T, TILE);
      }
    }

    // pasada 2: copas de árboles — por encima de muros y entidades
    for (const idx of canopyTiles) {
      const tr = this.treeByTile.get(idx);
      if (!tr) continue;
      const tsx = tr.x - cam.x + cam.offX;
      const tsy = tr.y - cam.y + cam.offY;
      if (tsx < -40 || tsy < -40 || tsx > cam.w + 40 || tsy > cam.h + 40) continue;
      this._drawTreeArt(ctx, tsx, tsy, tr.r);
      // atenuación suave: círculo que cubre toda la copa
      const kt = Math.max(0, Math.min(1,
        (Math.hypot(tr.x - p.x, tr.y - p.y) - VISION.nearR) / (VISION.range - VISION.nearR)));
      const dimT = kt * VISION.propDim;
      if (dimT > 0.01) {
        ctx.fillStyle = `rgba(3,5,3,${dimT.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(tsx, tsy, tr.r + 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /**
   * TECHOS: se dibujan POR ENCIMA de la niebla y de la estructura redibujada,
   * de modo que el techo ES la superficie visible del edificio y tapa muros e
   * interior desde fuera. Solo se dibuja el techo de edificios DENTRO del cono
   * de visión actual (tu espalda los mantiene a oscuras, como al resto del
   * mundo — misma filosofía que muros y copas). Reglas pedidas:
   *  - Desde fuera y lejos → opaco (bloquea la visión del interior).
   *  - Al acercarse → se atenúa poco a poco y deja ver por las ventanas
   *    (alpha mínima ~0.14 pegado al muro).
   *  - Al ENTRAR en el edificio → no se dibuja; al SALIR → regresa.
   */
  drawRoofs(ctx, cam, game) {
    const p = game.player;
    if (!p) return;
    const px = p.x, py = p.y;
    for (const b of this.buildings) {
      if (!b.roof) continue;
      const rx = b.x0 * TILE, ry = b.y0 * TILE;
      const rw = b.roofW, rh = b.roofH;
      const sx = rx - cam.x + cam.offX;
      const sy = ry - cam.y + cam.offY;
      if (sx > cam.w + 8 || sy > cam.h + 8 || sx + rw < -8 || sy + rh < -8) continue;
      // dentro del edificio → techo eliminado (regresa al salir)
      if (px > rx && px < rx + rw && py > ry && py < ry + rh) continue;
      // distancia del jugador al rect del edificio
      const nx = Math.max(rx, Math.min(px, rx + rw));
      const ny = Math.max(ry, Math.min(py, ry + rh));
      const d = Math.hypot(px - nx, py - ny);
      // ¿el edificio cae en la visión actual? (punto más cercano dentro del
      // cono, con la holgura angular del tamaño del edificio, o periferia)
      const diag = Math.hypot(rw, rh);
      if (d >= VISION.nearR) {
        if (d >= VISION.range + diag) continue;
        const ang = Math.atan2(ny - py, nx - px);
        const slack = Math.atan2(diag, Math.max(d, 30));
        if (Math.abs(angDiff(p.angle, ang)) > VISION.halfAngle + slack) continue;
      }
      // rampa de atenuación por distancia
      const t = Math.max(0, Math.min(1, (d - ROOF.near) / (ROOF.far - ROOF.near)));
      const alpha = ROOF.minAlpha + (1 - ROOF.minAlpha) * t;
      if (alpha < 0.04) continue;
      ctx.globalAlpha = alpha;
      ctx.drawImage(b.roof, Math.round(sx), Math.round(sy));
      ctx.globalAlpha = 1;
    }
  }

  drawOverhead(ctx, cam) {
    // copas de árboles (por encima de entidades: se camina "bajo" ellas)
    for (const t of this.trees) {
      const sx = t.x - cam.x + cam.offX;
      const sy = t.y - cam.y + cam.offY;
      if (sx < -40 || sy < -40 || sx > cam.w + 40 || sy > cam.h + 40) continue;
      this._drawTreeArt(ctx, sx, sy, t.r);
    }
  }
}
