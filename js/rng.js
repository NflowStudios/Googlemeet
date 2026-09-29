/**
 * rng.js — Generador pseudoaleatorio con semilla (mulberry32).
 * Permite mapas reproducibles y depuración determinista.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
  }

  /** Float [0, 1). */
  float() { return this.next(); }

  /** Float [a, b). */
  range(a, b) { return a + this.next() * (b - a); }

  /** Entero [a, b] inclusive. */
  int(a, b) { return Math.floor(this.range(a, b + 1)); }

  /** Probabilidad p → true. */
  chance(p) { return this.next() < p; }

  /** Elemento aleatorio de un array. */
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** Índice aleatorio [0, n). */
  index(n) { return Math.floor(this.next() * n); }
}
