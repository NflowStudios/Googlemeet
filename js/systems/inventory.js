/**
 * inventory.js — Inventario por espacios (sin peso), botín y contenedores.
 *
 * Los objetos son instancias {id, def, count, rotten}. La comida generada
 * en neveras/alacenas puede estar PODRIDA: alimenta poco, daña e intoxica.
 */

import { ITEMS, LOOT, ROTTEN_CHANCE, CONTAINER_DEFS } from '../config.js';

let uidCounter = 1;

/** Crea una instancia de objeto. */
export function makeItem(id, rotten = false) {
  const def = ITEMS[id];
  if (!def) throw new Error('Item desconocido: ' + id);
  return { uid: uidCounter++, id, def, count: 1, rotten };
}

/** ¿Es apilable? (comida/bebida/medico sí; armas y ropa no) */
function stackable(item) {
  return ['comida', 'bebida', 'medico'].includes(item.def.cat);
}

/** Rellena un contenedor con botín de su tabla. */
export function fillContainer(container, rng) {
  const table = LOOT[container.type] || [];
  const counts = { nevera: [2, 4], alacena: [2, 3], armario: [1, 3], casillero: [2, 4], botiquin_pared: [1, 2] };
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
    if (stackable(item) && rng.chance(0.25)) item.count = 2;
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

/** Etiqueta legible de un objeto (con estado de descomposición). */
export function itemLabel(item) {
  if (item.def.cat !== 'comida' && item.def.cat !== 'bebida') return item.def.name;
  return item.rotten ? item.def.name + ' (podrida)' : item.def.name;
}
