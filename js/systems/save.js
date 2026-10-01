/**
 * save.js — Guardado y carga de partidas (v0.13) en localStorage.
 *
 * QUÉ SE GUARDA:
 *  - Semilla del mapa + estado de puertas abiertas + decals (sangre y
 *    cadáveres se REPRODUCEN tras regenerar el mapa con la misma semilla).
 *  - Jugador completo: posición, planta, sigilo, mochila, equipo vestible,
 *    barra rápida (con IDENTIDAD de referencias: una misma instancia puede
 *    estar en la mochila, equipada y en la barra a la vez) y balas dentro
 *    de cargadores/tubos.
 *  - Zombis vivos (posición, vida, estado de IA), contenedores (registrado
 *    + contenido), objetos del suelo, contadores vitales, hora del ciclo
 *    día/noche, estado del CLIMA (v0.15: lluvia/neblina y su cuenta atrás)
 *    y estadísticas de la partida.
 *
 * QUÉ NO: efectos efímeros (trazadoras, fogonazos, recarga en curso,
 * retroceso). El guardado es instantáneo y a prueba de corrupción leve
 * (versión + forma validadas antes de restaurar).
 *
 * La muerte es DEFINITIVA: main.js borra el guardado al morir.
 */

import { ITEMS, BASE_SLOTS, DAYNIGHT, T } from '../config.js';
import { Rng } from '../rng.js';
import { GameMap } from '../world/map.js';
import { DayNight } from '../world/daynight.js';
import { Weather } from '../world/weather.js';
import { makeItem, Inventory } from './inventory.js';
import { Survival } from './survival.js';
import { Player } from '../entities/player.js';
import { zombieToData, zombieFromData } from '../entities/zombie.js';
import { flashlightItem } from './flashlight.js';
import { HOTBAR_N } from './hotbar.js';

// v0.16: bump a 2 — el mapa se regeneró al DOBLE con la base militar y las
// posiciones guardadas de la v1 ya no son válidas (los guardados viejos se
// rechazan limpiamente y el menú arranca partida nueva).
export const SAVE_VERSION = 2;
export const AUTOSAVE_SEC = 300;        // autoguardado cada 5 min DE PARTIDA
const KEY = 'zonacero.save.v' + SAVE_VERSION;

// ================== Serialización de objetos ==================

/**
 * Registro de instancias → datos planos con ids para conservar la
 * IDENTIDAD de las referencias (mochila ↔ equipo ↔ barra rápida ↔ cargador
 * insertado en un arma). Cada instancia se guarda UNA sola vez.
 */
function makeRegistry() {
  const items = [];            // [{ id, iid, c, r, ro, tb, mg }]
  const ids = new Map();       // instancia → id
  const reg = (it) => {
    if (!it) return null;
    if (ids.has(it)) return ids.get(it);
    // OJO: el cargador anidado se registra ANTES que el arma — el id se
    // calcula después para no colisionar con él (bug de ids duplicados).
    const o = { iid: it.id, c: it.count, r: it.rotten ? 1 : 0 };
    if (it.rounds !== undefined) o.ro = it.rounds;          // cargador
    if (it.tube !== undefined) o.tb = it.tube;              // escopeta
    if (it.charge !== undefined) o.ch = Math.round(it.charge); // v0.17: carga de la linterna
    if (it.mag) o.mg = reg(it.mag);                         // cargador insertado
    o.id = items.length + 1;
    ids.set(it, o.id);
    items.push(o);
    return o.id;
  };
  return { items, reg };
}

/** Crea las instancias a partir del registro y reconecta los cargadores. */
function buildItems(data) {
  const byId = new Map();
  for (const o of data.items) {
    if (!o || !ITEMS[o.iid]) continue;
    const it = makeItem(o.iid, !!o.r);
    it.count = o.c || 1;
    if (o.ro !== undefined) it.rounds = o.ro;
    if (o.tb !== undefined) it.tube = o.tb;
    if (o.ch !== undefined) it.charge = o.ch;   // v0.17: carga de la linterna
    byId.set(o.id, it);
  }
  for (const o of data.items) {
    if (o.mg && byId.has(o.id) && byId.has(o.mg)) byId.get(o.id).mag = byId.get(o.mg);
  }
  return byId;
}

// ================== Guardar ==================

/** Serializa la partida en curso. Devuelve el objeto de datos (o null). */
export function buildSaveData(game) {
  if (!game || !game.map || !game.player || !game.survival) return null;
  const { items, reg } = makeRegistry();

  const p = game.player;
  const player = {
    x: +p.x.toFixed(1), y: +p.y.toFixed(1),
    a: +p.angle.toFixed(3),
    sk: p.sneak ? 1 : 0,
    fl: p.flashOn ? 1 : 0,   // v0.17: linterna encendida
    z: p.z || 0,
    // si se guardó a mitad de escalera: se da por terminada la subida/bajada
    zc: p.climb ? p.climb.to : null,
    slots: p.inventory.slots.map((s) => reg(s)),
    eq: {
      cabeza: reg(p.equipment.cabeza),
      accesorios: reg(p.equipment.accesorios),
      accesorios2: reg(p.equipment.accesorios2),
      torso: reg(p.equipment.torso),
      pantalones: reg(p.equipment.pantalones),
      arma: reg(p.equipment.arma),
    },
    hb: p.hotbar.map((h) => reg(h)),
  };

  const s = game.survival;
  const surv = {
    hp: +s.health.toFixed(1), st: +s.stamina.toFixed(1),
    hu: +s.hunger.toFixed(1), th: +s.thirst.toFixed(1),
    inf: s.infected ? 1 : 0, in: +s.infection.toFixed(1),
    irm: +s.infectionRateMult.toFixed(2),
    tox: +s.intoxicated.toFixed(1),
    heal: s.healEffects.map((e) => ({
      am: e.amount, du: e.dur, re: +e.remaining.toFixed(1),
    })),
  };

  // puertas actualmente abiertas (las cerradas son el estado por defecto)
  const doors = [];
  for (const d of game.map.doors) {
    if (game.map.tileAtIdx(d.tx, d.ty) === T.DOOR_OPEN) doors.push([d.tx, d.ty]);
  }

  const containers = game.map.containers.map((c, i) => ({
    i,
    s: c.searched ? 1 : 0,
    items: c.items.map((it) => reg(it)),
  }));

  const ground = game.groundItems.map((gi) => ({
    x: +gi.x.toFixed(1), y: +gi.y.toFixed(1), id: reg(gi.item),
  }));

  return {
    v: SAVE_VERSION,
    seed: game.seedUsed,
    savedAt: Date.now(),
    // resumen para el botón «Continuar partida» del menú
    day: game.daynight.day,
    clock: game.daynight.clock,
    time: +game.time.toFixed(1),
    kills: game.kills,
    searched: game.searchedCount,
    dn: { t: +game.daynight.t.toFixed(2) },
    wx: game.weather ? game.weather.toData() : null,   // v0.15: clima
    player, surv,
    zombies: game.zombies.map(zombieToData),
    containers, ground, doors,
    decals: game.map.decalOps.slice(-500),
    items,
  };
}

/** Guarda en localStorage. true si todo fue bien. */
export function saveGame(game) {
  const data = buildSaveData(game);
  if (!data) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('saveGame:', e && e.name);
    return false;
  }
}

// ================== Cargar ==================

/** Datos del guardado (parseados y validados) o null si no hay/no valen. */
export function loadSaveData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== SAVE_VERSION) return null;
    if (!data.player || !data.items || !data.zombies ||
        !Array.isArray(data.containers) || typeof data.seed !== 'number') return null;
    return data;
  } catch (e) {
    return null;
  }
}

/** ¿Hay guardado utilizable? */
export function hasSave() { return loadSaveData() !== null; }

/** Resumen para la etiqueta del botón CONTINUAR («Día 2 · 04:12 PM · 13 bajas»). */
export function saveSummary() {
  const d = loadSaveData();
  if (!d) return null;
  return { day: d.day, clock: d.clock, kills: d.kills, time: d.time };
}

/** Borra el guardado (muerte definitiva o nueva partida limpia). */
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* sin localStorage */ }
}

// ================== Restaurar ==================

/**
 * Reconstruye el mundo guardado DENTRO del juego (sin tocar la UI: eso lo
 * hace Game.continueRun). Devuelve { day, clock } o null si algo falló.
 *
 * Estrategia: el mapa se REGENERA con la misma semilla (geometría, casas,
 * contenedores, techos… idénticos) y encima se aplican las diferencias:
 * puertas abiertas, decals, contenido real de contenedores, zombis y
 * jugador.
 */
export function restoreGame(game, data) {
  try {
    // ---- mapa: regeneración determinista + diferencias ----
    game.seedUsed = data.seed;
    const map = new GameMap(new Rng(data.seed));
    for (const [tx, ty] of data.doors || []) map.setTile(tx, ty, T.DOOR_OPEN);
    game.map = map;
    // rng de juego nuevo (independiente del de generación, ya consumido)
    game.rng = new Rng((data.seed ^ (data.savedAt & 0x7fffffff)) >>> 0);

    // ---- objetos: instancias + referencias ----
    const byId = buildItems(data);

    // ---- jugador ----
    const pd = data.player;
    const p = new Player(pd.x, pd.y);
    p.angle = pd.a || 0;
    p.sneak = !!pd.sk;
    p.z = pd.z || 0;
    p.climb = null;               // la escalera se da por terminada
    if (pd.zc !== null && pd.zc !== undefined) p.z = pd.zc;
    p.reloading = null;           // la recarga en curso se cancela
    p.recoil = 0;
    p.swingT = 0; p.cooldown = 0; p.hurtFlash = 0;
    const get = (id) => (id ? byId.get(id) : null) || null;
    p.inventory = new Inventory(BASE_SLOTS);
    p.inventory.slots = (pd.slots || []).map(get);
    p.inventory.capacity = Math.max(BASE_SLOTS, p.inventory.slots.length);
    p.equipment = {
      cabeza: get(pd.eq.cabeza),
      accesorios: get(pd.eq.accesorios),
      accesorios2: get(pd.eq.accesorios2),
      torso: get(pd.eq.torso),
      pantalones: get(pd.eq.pantalones),
      arma: get(pd.eq.arma),
    };
    // ---- barra rápida (v0.17: 5 ranuras) ----
    // Los guardados de la v0.16 traen 3 ranuras con el ORDEN ANTIGUO
    // [fuego, melee, objeto]: se remapean a la nueva disposición
    // [fuego, fuego-secundaria, melee, objeto, objeto].
    let hbData = pd.hb || [];
    if (hbData.length === 3) {
      hbData = [hbData[0], null, hbData[1], hbData[2], null];
    }
    p.hotbar = hbData.slice(0, HOTBAR_N).map(get);
    while (p.hotbar.length < HOTBAR_N) p.hotbar.push(null);
    // v0.17: el estado de la linterna viaja con el jugador (si sigue equipada)
    p.flashOn = !!pd.fl && !!flashlightItem(p);
    game.player = p;

    // ---- contadores vitales ----
    const sd = data.surv || {};
    const surv = new Survival();
    surv.health = sd.hp ?? 100;
    surv.stamina = sd.st ?? 100;
    surv.hunger = sd.hu ?? 100;
    surv.thirst = sd.th ?? 100;
    surv.infected = !!sd.inf;
    surv.infection = sd.in || 0;
    surv.infectionRateMult = sd.irm || 1;
    surv.intoxicated = sd.tox || 0;
    surv.healEffects = (sd.heal || []).map((e) => ({
      amount: e.am, dur: e.du, remaining: e.re,
    }));
    surv.deathCause = null;
    game.survival = surv;

    // ---- ciclo día/noche ----
    game.daynight = new DayNight();
    game.daynight.t = data.dn.t || 0;
    game._hourMark = Math.floor(game.daynight.hour);

    // ---- clima (v0.15): frente activo y cuenta atrás del siguiente ----
    // guardados v0.13/v0.14 sin bloque wx → cielo despejado con agenda nueva
    game.weather = new Weather();
    game.weather.load(data.wx);

    // ---- zombis ----
    game.zombies = data.zombies.map(zombieFromData);

    // ---- contenedores: registrado + contenido real ----
    for (const cs of data.containers) {
      const c = map.containers[cs.i];
      if (!c) continue;
      c.searched = !!cs.s;
      c.items = (cs.items || []).map(get).filter(Boolean);
    }

    // ---- objetos del suelo ----
    game.groundItems = (data.ground || [])
      .map((g) => ({ x: g.x, y: g.y, item: get(g.id) }))
      .filter((g) => g.item);

    // ---- decals: reproducir sangre y cadáveres ----
    for (const op of data.decals || []) {
      if (op.t === 'corpse') map.stampCorpse(op.x, op.y, op.a || 0, op.s || 1);   // v0.14: escala (variante)
      else map.stampBlood(op.x, op.y, !!op.b);
    }

    // ---- estadísticas ----
    game.time = data.time || 0;
    game.kills = data.kills || 0;
    game.searchedCount = data.searched || 0;
    game.deathCause = null;

    return { day: game.daynight.day, clock: game.daynight.clock };
  } catch (e) {
    console.warn('restoreGame:', e);
    return null;
  }
}
