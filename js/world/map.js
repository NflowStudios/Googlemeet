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

import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, T, SOLID, OPAQUE, AI_OPAQUE, VISION, WALL_T } from '../config.js';
import { Rng } from '../rng.js';
import { hash2 } from '../utils.js';

const V_ROADS = [[16, 19], [46, 49], [74, 77]]; // bandas verticales [ini, fin] inclusive
const H_ROADS = [[14, 17], [42, 45], [64, 67]]; // bandas horizontales
const X_BLOCKS = [[1, 14], [21, 44], [51, 72], [79, 98]];
const Y_BLOCKS = [[1, 12], [19, 40], [47, 62], [69, 78]];

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
    this.containers = [];   // {type, name, x, y, color, letter, searched}
    this.buildings = [];    // {x0, y0, x1, y1, cx, cy}
    this.doors = [];        // {tx, ty}
    this.vMarks = [];       // marcas de carril verticales {x, y0, y1}
    this.hMarks = [];
    this.outdoorTiles = []; // índices de tiles exteriores caminables
    this.indoorTiles = [];  // índices de tiles de interior
    this.spawn = { x: 0, y: 0 };

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

  /** Mueve un círculo con colisión por ejes separados (paso de 1px). */
  moveCircle(obj, dx, dy) {
    if (dx !== 0) {
      const sign = Math.sign(dx);
      let remain = Math.abs(dx);
      while (remain > 0) {
        const step = Math.min(1, remain);
        const nx = obj.x + sign * step;
        if (this.circleHitsSolid(nx, obj.y, obj.r)) break;
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
        if (this.circleHitsSolid(obj.x, ny, obj.r)) break;
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

  // ================== Decals persistentes ==================

  stampBlood(x, y, big = false) {
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

  stampCorpse(x, y, ang) {
    const c = this.dctx;
    const px = x / 2, py = y / 2;
    // charco
    c.fillStyle = 'rgba(88, 12, 12, 0.8)';
    c.beginPath();
    c.ellipse(px, py, 13, 9, ang, 0, Math.PI * 2);
    c.fill();
    // cuerpo caído
    c.save();
    c.translate(px, py);
    c.rotate(ang);
    c.fillStyle = '#5c6650';
    c.beginPath(); c.ellipse(0, 0, 9, 5.5, 0, 0, Math.PI * 2); c.fill();   // torso
    c.fillStyle = '#6e7a5a';
    c.beginPath(); c.ellipse(8, 0, 4.5, 4, 0, 0, Math.PI * 2); c.fill();   // cabeza
    c.strokeStyle = '#4e5844'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-4, -3); c.lineTo(-11, -6); c.stroke();        // brazo
    c.restore();
  }

  // ================== Generación ==================

  _generate() {
    const rng = this.rng;
    const tiles = this.tiles;

    // --- Calles y marcas de carril ---
    for (const [a, b] of V_ROADS) {
      for (let x = a; x <= b; x++)
        for (let y = 0; y < MAP_H; y++) tiles[this.idx(x, y)] = T.ROAD;
      this.vMarks.push({ x: b * TILE, y0: 0, y1: MAP_H * TILE });
    }
    for (const [a, b] of H_ROADS) {
      for (let y = a; y <= b; y++)
        for (let x = 0; x < MAP_W; x++) tiles[this.idx(x, y)] = T.ROAD;
      this.hMarks.push({ y: b * TILE, x0: 0, x1: MAP_W * TILE });
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

    // --- Edificios por manzana ---
    for (const [bx0, bx1] of X_BLOCKS) {
      for (const [by0, by1] of Y_BLOCKS) {
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
        if (bw < 8 || bh < 7) continue;
        const attempts = Math.max(1, Math.floor((bw * bh) / 170));
        const placed = [];
        for (let i = 0; i < attempts; i++) {
          const w = Math.min(rng.int(9, 14), bw - 2);
          const h = Math.min(rng.int(8, 12), bh - 2);
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

    // --- Spawn del jugador: cruce central ---
    let sx = 48, sy = 44;
    if (this.tileAtIdx(sx, sy) === T.CAR) {
      outer: for (let r = 1; r < 6; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (this.tileAtIdx(sx + dx, sy + dy) === T.ROAD) { sx += dx; sy += dy; break outer; }
        }
      }
    }
    this.spawn = { x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2 };

    // --- Árboles ---
    const treeTries = 150;
    for (let i = 0; i < treeTries; i++) {
      const tx = rng.int(1, MAP_W - 2), ty = rng.int(1, MAP_H - 2);
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
    while (this.cars.length < 7 && carTries < 300) {
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

    // contenedores: tiles de interior pegados a muro/ventana
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
    });
  }

  _addContainer(type, tx, ty) {
    const defs = {
      nevera: { name: 'Nevera', color: '#aeb6ba', letter: 'N' },
      alacena: { name: 'Alacena', color: '#8a6a42', letter: 'A' },
      armario: { name: 'Armario', color: '#6a4a2c', letter: 'R' },
      casillero: { name: 'Casillero', color: '#4a6a6a', letter: 'C' },
      botiquin_pared: { name: 'Botiquín', color: '#d94a4a', letter: '+' },
    };
    const d = defs[type];
    this.containers.push({
      type, name: d.name, color: d.color, letter: d.letter,
      x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
      items: [], searched: false,
    });
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
      const idx = this.rng.index(this.outdoorTiles.length);
      const tx = idx % MAP_W, ty = Math.floor(idx / MAP_W);
      const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
      if (Math.hypot(x - minDistFrom.x, y - minDistFrom.y) >= minDist) return { x, y };
    }
    return null;
  }

  /** Tile de interior aleatorio (px). */
  randomIndoor() {
    if (!this.indoorTiles.length) return null;
    const idx = this.rng.index(this.indoorTiles.length);
    const tx = idx % MAP_W, ty = Math.floor(idx / MAP_W);
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
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
            ctx.fillStyle = '#26262a';
            ctx.fillRect(sx, sy, TILE, TILE);
            if (h > 0.85) {
              ctx.strokeStyle = '#1e1e22';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(sx + 4, sy + 6 + h * 10);
              ctx.lineTo(sx + 20, sy + 14 + h * 8);
              ctx.stroke();
            }
            break;
          }
          case T.SIDEWALK: {
            ctx.fillStyle = h < 0.5 ? '#4a4a44' : '#474741';
            ctx.fillRect(sx, sy, TILE, TILE);
            ctx.strokeStyle = '#3b3b36';
            ctx.lineWidth = 1;
            ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
            break;
          }
          case T.FLOOR: {
            ctx.fillStyle = h < 0.5 ? '#6e5c44' : '#6a5840';
            ctx.fillRect(sx, sy, TILE, TILE);
            ctx.fillStyle = 'rgba(0,0,0,0.14)';
            ctx.fillRect(sx, sy + TILE - 3, TILE, 2);
            if (h > 0.6) ctx.fillRect(sx + Math.floor(h * 24), sy, 2, TILE);
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
        }
      }
    }

    // marcas de carril
    ctx.save();
    ctx.setLineDash([12, 16]);
    ctx.strokeStyle = 'rgba(200, 170, 60, 0.35)';
    ctx.lineWidth = 3;
    for (const m of this.vMarks) {
      const x = Math.round(m.x - cam.x + cam.offX);
      const y0 = Math.round(m.y0 - cam.y + cam.offY);
      const y1 = Math.round(m.y1 - cam.y + cam.offY);
      if (x < -20 || x > cam.w + 20) continue;
      ctx.beginPath(); ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, Math.min(cam.h, y1)); ctx.stroke();
    }
    for (const m of this.hMarks) {
      const y = Math.round(m.y - cam.y + cam.offY);
      const x0 = Math.round(m.x0 - cam.x + cam.offX);
      const x1 = Math.round(m.x1 - cam.x + cam.offX);
      if (y < -20 || y > cam.h + 20) continue;
      ctx.beginPath(); ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(cam.w, x1), y); ctx.stroke();
    }
    ctx.restore();

    // coches (arte compartido: base bajo la niebla; versión nítida encima)
    for (const car of this.cars) {
      const sx = Math.round(car.x - cam.x + cam.offX - car.w / 2);
      const sy = Math.round(car.y - cam.y + cam.offY - car.h / 2);
      if (sx > cam.w + 40 || sy > cam.h + 40 || sx + car.w < -40 || sy + car.h < -40) continue;
      this._drawCarArt(ctx, sx, sy, car);
    }

    // decals de sangre/cadáveres
    const dx = Math.round(-cam.x + cam.offX) / 2;
    const dy = Math.round(-cam.y + cam.offY) / 2;
    ctx.drawImage(this.decalCanvas, dx, dy, WORLD_W / 2, WORLD_H / 2);

    // contenedores
    for (const c of this.containers) {
      const sx = Math.round(c.x - cam.x + cam.offX);
      const sy = Math.round(c.y - cam.y + cam.offY);
      if (sx < -30 || sy < -30 || sx > cam.w + 30 || sy > cam.h + 30) continue;
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

    const canopyTiles = [];
    const drawnCars = new Set();
    const off = (TILE - WALL_T) / 2;

    // pasada 1: muros/ventanas/puertas + coches (a nivel de suelo)
    for (const idx of vision.wallTiles) {
      const tx = idx % MAP_W, ty = Math.floor(idx / MAP_W);
      const t = this.tiles[idx];
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
      const runs = this._runsFor(tx, ty);
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
