/**
 * inventory.js — Inventario por espacios (sin peso), botín y contenedores.
 *
 * Los objetos son instancias {id, def, count, rotten}. La comida generada
 * en neveras/alacenas puede estar PODRIDA: alimenta poco, daña e intoxica.
 *
 * Armas de fuego: item.mag = cargador insertado (cat 'cargador', guarda
 * item.rounds) o item.tube para la escopeta. La munición (cat 'municion')
 * es apilable y RELLENA SOLO los cargadores compatibles que lleves
 * (refillMagazines): el sobrante queda como pila suelta en la mochila.
 */

import { ITEMS, LOOT, ROTTEN_CHANCE, CONTAINER_DEFS, GUN_FOUND_FULL_CHANCE } from '../config.js';

let uidCounter = 1;

/** Crea una instancia de objeto. */
export function makeItem(id, rotten = false) {
  const def = ITEMS[id];
  if (!def) throw new Error('Item desconocido: ' + id);
  return { uid: uidCounter++, id, def, count: 1, rotten };
}

/** ¿Es apilable? (comida/bebida/medico/munición/pilas/materiales/semillas/
 *  piezas de coche y combustible sí; armas, ropa y cargadores no) */
function stackable(item) {
  return ['comida', 'bebida', 'medico', 'municion', 'bateria', 'material', 'semilla', 'pieza', 'combustible'].includes(item.def.cat);
}

/** Cantidad de balas dentro de un arma (cargador insertado o tubo). */
export function gunRounds(gun) {
  if (!gun || !gun.def.ranged) return 0;
  if (gun.def.magType) return gun.mag ? gun.mag.rounds : 0;
  return gun.tube || 0;
}

/** Capacidad de un arma (la del cargador insertado, o el tubo). */
export function gunCapacity(gun) {
  if (!gun || !gun.def.ranged) return 0;
  if (gun.def.magType) return gun.mag ? gun.mag.def.cap : 0;
  return gun.def.tubeCap || 0;
}

/** Rellena un cargador nuevo con balas (lleno o parcial — nunca vacío). */
function _fillMag(mag, rng) {
  const cap = mag.def.cap;
  mag.rounds = rng.chance(GUN_FOUND_FULL_CHANCE)
    ? cap
    : rng.int(Math.ceil(cap * 0.3), Math.max(1, Math.floor(cap * 0.95)));
  return mag;
}

/**
 * Prepara un objeto recién generado según su categoría.
 * v0.21: exportada — la garantía del Subfusil Cuervo (main.js) la usa para
 * que el arma asegurada nazca igual que una hallada (cargador con balas).
 */
export function setupLootItem(item, rng) {
  const def = item.def;
  if (def.cat === 'municion' || def.cat === 'bateria' || def.cat === 'material' ||
      def.cat === 'semilla' || def.cat === 'pieza' || def.cat === 'combustible') {
    // pila de munición, pilas, MATERIAL DE CRAFTEO, SEMILLAS, PIEZAS DE
    // COCHE o COMBUSTIBLE con cantidad variable
    item.count = rng.int(def.lootMin || 5, def.lootMax || 15);
  } else if (def.cat === 'cargador') {
    _fillMag(item, rng);
  } else if (def.flashlight) {
    // v0.17: una linterna hallada trae la primera pila a medias (30-90%)
    item.charge = rng.int(30, 90);
  } else if (def.cat === 'arma' && def.ranged) {
    // un arma hallada SIEMPRE trae algo dentro:
    // cargador insertado con balas (pistola/rifle) o tubo cargado (escopeta)
    if (def.magType) {
      item.mag = _fillMag(makeItem(def.magType), rng);
    } else {
      item.tube = rng.int(Math.max(2, Math.floor(def.tubeCap * 0.3)), def.tubeCap);
    }
  }
  return item;
}

/** Rellena un contenedor con botín de su tabla. */
export function fillContainer(container, rng) {
  const table = LOOT[container.type] || [];
  // v0.16: contenedores militares de la base (mismo rango que la armería)
  // v0.18: contenedores del hospital (armarios de medicina generosos)
  // v0.25: estanterías de FERRETERÍA generosas (materiales a porrillo) y
  // expositores de jardinería (las semillas del huerto)
  const counts = { nevera: [2, 4], alacena: [2, 3], armario: [1, 3], casillero: [2, 4], botiquin_pared: [1, 2], armeria: [2, 4], estanteria: [2, 3], taquilla_mil: [2, 4], caja_municion: [2, 4], armeria_mil: [2, 4], estanteria_mil: [2, 3], armario_medico: [2, 4], carrito_curas: [2, 3], estanteria_ferreteria: [2, 4], expositor_jardin: [2, 3], surtidor: [2, 4], estanteria_taller: [2, 4] };
  const [lo, hi] = counts[container.type] || [1, 2];
  const n = rng.int(lo, hi);
  const totalW = table.reduce((s, e) => s + e[1], 0);
  const rottenP = ROTTEN_CHANCE[container.type] || 0;
  for (let i = 0; i < n; i++) {
    let r = rng.float() * totalW;
    let picked = table[0][0];
    for (const [id, w] of table) {
      r -= w;
      if (r <= 0) { picked = id; break; }
    }
    const def = ITEMS[picked];
    const isFood = def.cat === 'comida' || def.cat === 'bebida';
    const item = makeItem(picked, isFood && rng.chance(rottenP));
    setupLootItem(item, rng);
    // doble apilado solo para consumibles (la munición, las pilas, los
    // materiales, las semillas, las piezas y el combustible ya traen su cantidad)
    if (stackable(item) && item.def.cat !== 'municion' && item.def.cat !== 'bateria' && item.def.cat !== 'material' && item.def.cat !== 'semilla' && item.def.cat !== 'pieza' && item.def.cat !== 'combustible' && rng.chance(0.25)) item.count = 2;
    container.items.push(item);
  }
}

export class Inventory {
  constructor(capacity) {
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
  }

  setCapacity(cap) {
    this.capacity = cap;
    while (this.slots.length < cap) this.slots.push(null);
    if (this.slots.length > cap) this.slots.length = cap;
  }

  used() {
    return this.slots.reduce((s, it) => s + (it ? 1 : 0), 0);
  }

  /** Añade objeto (apila si procede). Devuelve true si cupo. */
  add(item) {
    if (stackable(item)) {
      for (const s of this.slots) {
        if (s && s.id === item.id && !!s.rotten === !!item.rotten && s.count < (s.def.stack || 1)) {
          const space = (s.def.stack || 1) - s.count;
          const take = Math.min(space, item.count);
          s.count += take;
          item.count -= take;
          if (item.count <= 0) return true;
        }
      }
    }
    const i = this.slots.indexOf(null);
    if (i === -1) return false;
    this.slots[i] = item;
    return true;
  }

  removeAt(i) {
    const it = this.slots[i];
    this.slots[i] = null;
    return it;
  }

  /** Reduce la cantidad de un slot (o lo vacía). */
  consumeAt(i, n = 1) {
    const it = this.slots[i];
    if (!it) return;
    it.count -= n;
    if (it.count <= 0) this.slots[i] = null;
  }

  isFull() { return this.slots.indexOf(null) === -1; }
}

/** Cantidad total de un id de objeto en la mochila (v0.20: recetas). */
export function countItem(inv, id) {
  let n = 0;
  for (const s of inv.slots) if (s && s.id === id) n += s.count;
  return n;
}

/** Etiqueta legible de un objeto (con estado de descomposición y munición). */
export function itemLabel(item) {
  const d = item.def;
  let n = d.name;
  if (d.cat === 'cargador') n += ` (${item.rounds}/${d.cap})`;
  else if (d.cat === 'arma' && d.ranged) {
    if (d.magType) n += item.mag ? ` [${item.mag.rounds}/${item.mag.def.cap}]` : ' [sin cargador]';
    else n += ` [${item.tube || 0}/${d.tubeCap}]`;
  }
  // v0.17: la carga de la linterna se lee en la etiqueta
  if (item.charge !== undefined && d.flashlight) n += ` [${Math.round(item.charge)}%]`;
  if (d.cat === 'comida' || d.cat === 'bebida') {
    return item.rotten ? n + ' (podrida)' : n;
  }
  return n;
}

/**
 * Auto-relleno de cargadores: la munición suelta de la mochila pasa
 * SOLA a los cargadores compatibles (los de la mochila, los insertados
 * en armas de la mochila y el del arma equipada). El sobrante queda
 * como pila en el inventario. Devuelve [ [cargador, balas], ... ].
 */
export function refillMagazines(player) {
  const inv = player.inventory;
  const holders = []; // cargadores a rellenar
  for (const s of inv.slots) {
    if (!s) continue;
    if (s.def.cat === 'cargador') holders.push(s);
    else if (s.def.cat === 'arma' && s.def.ranged && s.mag) holders.push(s.mag);
  }
  const eq = player.equipment.arma;
  if (eq && eq.def.ranged && eq.mag) holders.push(eq.mag);

  const filled = [];
  for (const mag of holders) {
    if (mag.rounds >= mag.def.cap) continue;
    const need = mag.def.cap - mag.rounds;
    let got = 0;
    for (let i = 0; i < inv.slots.length && got < need; i++) {
      const st = inv.slots[i];
      if (st && st.id === mag.def.ammo && st.count > 0) {
        const take = Math.min(need - got, st.count);
        st.count -= take;
        got += take;
        if (st.count <= 0) inv.slots[i] = null;
      }
    }
    if (got > 0) {
      mag.rounds += got;
      filled.push([mag, got]);
    }
  }
  return filled;
}
