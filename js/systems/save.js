/**
 * save.js — Guardado y carga de partidas en localStorage.
 *
 * v0.22 — TRES RANURAS: en vez de un único guardado hay 3 partidas
 * independientes (zonacero.save.v4.s1/.s2/.s3). El guardado único de la
 * v0.21 (zonacero.save.v4) se MIGRA automáticamente a la ranura 1 la
 * primera vez que se abre el juego, para no perder la partida en curso.
 * Todas las funciones aceptan la ranura (1-3); sin argumento usan la
 * ranura 1 por compatibilidad.
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
 * La muerte es DEFINITIVA: main.js borra EL GUARDADO DE ESA RANURA al morir.
 */

import { ITEMS, BASE_SLOTS, DAYNIGHT, T, PROF_BY_ID } from '../config.js';
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
import { addConstruction } from './crafting.js';

// v0.20: bump a 4 — el mundo ganó CONSTRUCCIONES del jugador (barricadas,
// vallas, trampas, cajas con su contenido, camas que hacen refugio y mesas
// de trabajo). Los guardados de la v3 se rechazan limpiamente (el menú
// arranca partida nueva), como en cada salto de versión.
// v0.22: el FORMATO no cambia (mismos campos); solo pasa de una clave
// única a una por ranura → SAVE_VERSION se mantiene en 4 y los guardados
// v0.21 migran solos a la ranura 1 (ver migrateLegacySave).
// v0.24: campo aditivo player.pf (profesión, v0.24). El FORMATO no cambia
// y los guardados v0.23 sin pf cargan con profesión NULL (sin bonos, la
// partida se creó antes de que existieran) → SIN bump de versión.
export const SAVE_VERSION = 4;
export const AUTOSAVE_SEC = 300;        // autoguardado cada 5 min DE PARTIDA
export const SAVE_SLOTS = 3;            // v0.22: 3 partidas independientes
const KEY = 'zonacero.save.v' + SAVE_VERSION;
const slotKey = (slot) => KEY + '.s' + (slot || 1);

// ================== v0.23: RÉCORDS ACUMULADOS ==================
// Obituario persistente entre partidas (independiente de las ranuras):
// cuántas partidas han acabado en muerte y los mejores registros.
const RKEY = 'zonacero.records.v1';

/** Los récords acumulados (0 partidas si nunca has muerto… aún). */
export function getRecords() {
  try {
    const r = JSON.parse(localStorage.getItem(RKEY));
    if (r && typeof r === 'object') {
      return {
        runs: r.runs | 0, bestTime: +r.bestTime || 0, bestDay: r.bestDay | 0,
        bestKills: r.bestKills | 0, totalKills: r.totalKills | 0,
      };
    }
  } catch (e) { /* sin localStorage */ }
  return { runs: 0, bestTime: 0, bestDay: 0, bestKills: 0, totalKills: 0 };
}

/** Registra una partida TERMINADA (muerte) y devuelve los récords nuevos. */
export function updateRecords(st) {
  const r = getRecords();
  r.runs++;
  r.bestTime = Math.max(r.bestTime, Math.floor(st.time || 0));
  r.bestDay = Math.max(r.bestDay, st.day | 0);
  r.bestKills = Math.max(r.bestKills, st.kills | 0);
  r.totalKills += st.kills | 0;
  try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) { /* nada */ }
  return r;
}

/** Limpia los récords (tests). */
export function clearRecords() {
  try { localStorage.removeItem(RKEY); } catch (e) { /* nada */ }
}

/**
 * v0.22: MIGRACIÓN — el guardado único de la v0.21 (clave sin sufijo) pasa
 * a la ranura 1 si esta está libre. Se ejecuta una sola vez (al importar el
 * módulo) y no toca nada más: las ranuras 2 y 3 nacen vacías.
 */
function migrateLegacySave() {
  try {
    const legacy = localStorage.getItem(KEY);
    if (legacy !== null && localStorage.getItem(slotKey(1)) === null) {
      localStorage.setItem(slotKey(1), legacy);
    }
    if (legacy !== null) localStorage.removeItem(KEY);
  } catch (e) { /* sin localStorage: nada que migrar */ }
}
migrateLegacySave();

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
    pf: p.prof || null,      // v0.24: profesión de la partida (id o null)
    z: p.z || 0,
    // si se guardó a mitad de escalera: se da por terminada la subida/bajada
    zc: p.climb ? p.climb.to : null,
    slots: p.inventory.slots.map((s) => reg(s)),
    eq: {
      cabeza: reg(p.equipment.cabeza),
      accesorios: reg(p.equipment.accesorios),
      accesorios2: reg(p.equipment.accesorios2),
      accesorios3: reg(p.equipment.accesorios3),   // v0.18: 3ª ranura
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
    adr: +s.adrenaline.toFixed(1),   // v0.18: adrenalina restante (s)
    mor: +s.morphine.toFixed(1),     // v0.18: morfina restante (s)
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
    x: +gi.x.toFixed(1), y: +gi.y.toFixed(1), z: gi.z || 0, id: reg(gi.item),
  }));

  // v0.20: CONSTRUCCIONES del jugador (con el contenido de las cajas vía
  // registro de objetos) — el fuego y el fantasma de construcción son
  // efímeros y NO viajan
  const cons = game.constructions.map((c) => {
    const o = {
      t: c.type, tx: c.tx, ty: c.ty, rt: c.rot || 0,
      hp: Math.round(c.hp), us: c.uses,
      it: (c.type === 'caja' && c.items) ? c.items.map((x) => reg(x)) : undefined,
    };
    return o;
  });

  // v0.23: estadísticas del obituario (disparos, molotovs, crafteos,
  // construcciones y odómetro)
  const st = game.stats || {};
  const stats = {
    sh: st.shots | 0, mo: st.molotovs | 0, cr: st.crafted | 0,
    bu: st.built | 0, di: Math.round(st.dist || 0),
  };

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
    stats,
    dn: { t: +game.daynight.t.toFixed(2) },
    wx: game.weather ? game.weather.toData() : null,   // v0.15: clima
    player, surv,
    zombies: game.zombies.map(zombieToData),
    containers, ground, cons, doors,
    decals: game.map.decalOps.slice(-500),
    items,
  };
}

/** Guarda en localStorage (ranura 1-3; por defecto, la 1). true si todo fue bien. */
export function saveGame(game, slot) {
  const data = buildSaveData(game);
  if (!data) return false;
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('saveGame:', e && e.name);
    return false;
  }
}

// ================== Cargar ==================

/** Datos del guardado (parseados y validados) o null si no hay/no valen.
 *  `slot`: 1-3 (por defecto, la 1). */
export function loadSaveData(slot) {
  try {
    const raw = localStorage.getItem(slotKey(slot));
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

/** ¿Hay guardado utilizable? (ranura 1-3) */
export function hasSave(slot) { return loadSaveData(slot) !== null; }

/** Resumen para la etiqueta de la ranura («Día 2 · 04:12 PM · 13 bajas»). */
export function saveSummary(slot) {
  const d = loadSaveData(slot);
  if (!d) return null;
  return {
    day: d.day, clock: d.clock, kills: d.kills, time: d.time,
    savedAt: d.savedAt || 0,
    prof: (d.player && d.player.pf && PROF_BY_ID[d.player.pf]) ? d.player.pf : null,   // v0.24
  };
}

/** v0.22: resúmenes de TODAS las ranuras para el menú → [null|{...}] × 3. */
export function listSlots() {
  const out = [];
  for (let s = 1; s <= SAVE_SLOTS; s++) out.push(saveSummary(s));
  return out;
}

/** La ranura con el guardado MÁS RECIENTE (para Enter/integraciones) o null. */
export function latestSlot() {
  let best = null, bestAt = -1;
  for (let s = 1; s <= SAVE_SLOTS; s++) {
    const d = loadSaveData(s);
    if (d && (d.savedAt || 0) > bestAt) { bestAt = d.savedAt || 0; best = s; }
  }
  return best;
}

/** Borra el guardado de una ranura (muerte definitiva o borrado a propósito). */
export function clearSave(slot) {
  try { localStorage.removeItem(slotKey(slot)); } catch (e) { /* sin localStorage */ }
}

/** v0.22: borra TODAS las ranuras (depuración/tests). */
export function clearAllSaves() {
  for (let s = 1; s <= SAVE_SLOTS; s++) clearSave(s);
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
    // v0.24: profesión — los guardados v0.23 (sin pf) cargan con NULL
    // (sin bonos): la partida nació antes de que existieran las profesiones
    p.prof = (pd.pf && PROF_BY_ID[pd.pf]) ? pd.pf : null;
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
      accesorios3: get(pd.eq.accesorios3),   // v0.18: 3ª ranura
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
    surv.adrenaline = sd.adr || 0;      // v0.18: buff de adrenalina
    surv.morphine = sd.mor || 0;        // v0.18: buff de morfina
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

    // ---- objetos del suelo (v0.19: con su planta) ----
    game.groundItems = (data.ground || [])
      .map((g) => ({ x: g.x, y: g.y, z: g.z || 0, item: get(g.id) }))
      .filter((g) => g.item);

    // ---- v0.20: CONSTRUCCIONES (materiales del registro para las cajas) ----
    game.constructions = [];
    for (const cs of data.cons || []) {
      const c = addConstruction(game, cs.t, cs.tx, cs.ty, cs.rt || 0);
      if (cs.hp !== undefined) c.hp = cs.hp;
      if (cs.us !== undefined && c.uses !== undefined) c.uses = cs.us;
      if (cs.t === 'caja' && cs.it) {
        c.items = cs.it.map(get).filter(Boolean);
      }
    }

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
    // v0.23: odómetro y contadores del obituario (guardados v0.22 sin bloque
    // → arrancan a cero, como toda estadística nueva)
    const std = data.stats || {};
    if (game.stats) {
      game.stats.shots = std.sh | 0;
      game.stats.molotovs = std.mo | 0;
      game.stats.crafted = std.cr | 0;
      game.stats.built = std.bu | 0;
      game.stats.dist = std.di | 0;
    }

    // v0.21: garantía del Subfusil Cuervo también al CARGAR — un mundo
    // guardado sin ninguno (mala suerte de las tablas en v0.20) recibe el
    // suyo en una armería de la base militar
    if (typeof game._guaranteeCuervo === 'function') game._guaranteeCuervo();

    return { day: game.daynight.day, clock: game.daynight.clock };
  } catch (e) {
    console.warn('restoreGame:', e);
    return null;
  }
}
