/**
 * servers.js — v0.28: SERVIDORES, mundos persistentes del multijugador.
 *
 * Un SERVIDOR es un mundo cooperativo que NO depende de que su creador
 * esté conectado: cualquiera de sus MIEMBROS puede ABRIRLO desde el menú
 * y la partida continúa donde la dejaron. No hay servidor de juego —
 * GitHub Pages no puede alojar uno — así que la persistencia es
 * DISTRIBUIDA entre los navegadores de los miembros:
 *
 *  · Crear un mundo genera CÓDIGO (6 caracteres) + CONTRASEÑA (4 dígitos):
 *    compártelos con hasta 3 personas (4 sobrevivientes en total).
 *  · Cada MiEMBRO guarda en SU localStorage una copia del SNAPSHOT del
 *    mundo (semilla + estado: puertas, contenedores, zombis, coches,
 *    construcciones, cadáveres y el progreso de TODOS los jugadores).
 *  · El anfitrión de cada sesión re-difunde el snapshot cada
 *    NET.srvSaveEvery segundos y al despedirse; los clientes lo almacenan
 *    al recibirlo (y suben su propio estado cada NET.srvStateEvery s).
 *  · Quien ABRA el mundo después restaura desde SU última copia local —
 *    por eso conviene salir del juego con calma: el último sincronizado manda.
 *
 * IDENTIDAD DE MIEMBRO: cada navegador tiene por mundo un `memberId`
 * estable (se crea al entrar la primera vez) — con él el mundo recuerda
 * tu nombre, profesión, color, mochila y posición. Si tu personaje murió,
 * la próxima vez que entres al mundo empiezas una VIDA NUEVA en el punto
 * de aparición (tu equipo quedó en tu cadáver, saqueable por los demás).
 */

import { NET, T, BASE_SLOTS } from '../config.js';
import { Rng } from '../rng.js';
import { GameMap } from '../world/map.js';
import { DayNight } from '../world/daynight.js';
import { Weather } from '../world/weather.js';
import { Player } from '../entities/player.js';
import { Survival } from './survival.js';
import { zombieFromData } from '../entities/zombie.js';
import { addConstruction } from './crafting.js';
import { applyVehicles, enterCar } from './vehicles.js';
import {
  buildSaveData, restorePlayerData, buildItems,
} from './save.js';

// v0.29: bump a 2 — la geografía del mundo cambió con LA AVENIDA (v0.29):
// un snapshot v1 describiría puertas/contenedores/zombis sobre manzanas que
// ya no están donde estaban. Los mundos v1 se rechazan limpiamente (el
// registro local los olvida al no poder cargar su snapshot) y los nuevos
// mundos nacen con la avenida, las plazas y la escoba.
export const SRV_VERSION = 2;
const LIST_KEY = 'zonacero.servers.v2';
const snapKey = (code) => 'zonacero.srvsnap.' + code;

// ================== códigos / contraseñas / ids ==================

/** Código de mundo: 6 caracteres del alfabeto sin confusos. */
export function genServerCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < NET.srvCodeLen; i++) {
    s += NET.codeChars[Math.floor(rand() * NET.codeChars.length)];
  }
  return s;
}

/** Normaliza un código de servidor tecleado (null si no cabe). */
export function normServerCode(str) {
  if (typeof str !== 'string') return null;
  const s = str.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === NET.srvCodeLen ? s : null;
}

/** Contraseña del mundo: 4 DÍGITOS (fácil de leer en voz alta). */
export function genServerPass(rand = Math.random) {
  let s = '';
  for (let i = 0; i < NET.srvPassLen; i++) s += Math.floor(rand() * 10);
  return s;
}

/** Identidad estable de miembro (mismo alfabeto que los códigos). */
export function genMemberId(rand = Math.random) {
  let s = 'M';
  for (let i = 0; i < 6; i++) {
    s += NET.codeChars[Math.floor(rand() * NET.codeChars.length)];
  }
  return s;
}

/** id de PeerJS del mundo: «zc28s-CODIGO». */
export function srvPeerId(code) { return NET.srvPeerPrefix + code; }

// ================== registro de mis mundos (localStorage) ==================

/** Todos los mundos de este navegador: [{code,name,pass,memberId,lastSync,createdAt}]. */
export function listServers() {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY));
    if (Array.isArray(raw)) return raw.filter((e) => e && e.code);
  } catch (e) { /* sin localStorage */ }
  return [];
}

function saveList(list) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch (e) {}
}

/** El mundo `code` guardado en este navegador (o null). */
export function getServer(code) {
  return listServers().find((s) => s.code === code) || null;
}

/** Crea un mundo NUEVO (código + contraseña + identidad de miembro). */
export function createServer(worldName, rand = Math.random) {
  let code;
  const list = listServers();
  do { code = genServerCode(rand); } while (list.some((s) => s.code === code));
  const entry = {
    code,
    name: String(worldName || 'MUNDO').toUpperCase().slice(0, 18),
    pass: genServerPass(rand),
    memberId: genMemberId(rand),
    createdAt: Date.now(),
    lastSync: 0,
  };
  list.push(entry);
  saveList(list);
  return entry;
}

/** Registra (o recupera) la identidad local para un mundo al que te UNES. */
export function joinServerEntry(code, pass, worldName) {
  let entry = getServer(code);
  if (entry) {
    // miembro que vuelve: se respeta su memberId
    if (pass) entry.pass = pass;
    if (worldName) entry.name = String(worldName).toUpperCase().slice(0, 18);
    saveList(listServers());
    return entry;
  }
  entry = {
    code,
    name: String(worldName || 'MUNDO').toUpperCase().slice(0, 18),
    pass: pass || '',
    memberId: genMemberId(),
    createdAt: Date.now(),
    lastSync: 0,
  };
  const list = listServers();
  list.push(entry);
  saveList(list);
  return entry;
}

/** Olvida un mundo de este navegador (el resto de miembros lo conserva). */
export function forgetServer(code) {
  saveList(listServers().filter((s) => s.code !== code));
  try { localStorage.removeItem(snapKey(code)); } catch (e) {}
}

// ================== snapshots del mundo ==================

/** Guarda (o sustituye) la copia local del snapshot de un mundo. */
export function storeSnapshot(code, data) {
  if (!code || !data) return false;
  try {
    localStorage.setItem(snapKey(code), JSON.stringify(data));
    const list = listServers();
    const e = list.find((s) => s.code === code);
    if (e) { e.lastSync = data.savedAt || Date.now(); saveList(list); }
    return true;
  } catch (e) {
    console.warn('storeSnapshot:', e && e.name);
    return false;
  }
}

/** La copia local del snapshot de un mundo (o null). */
export function loadSnapshot(code) {
  try {
    const raw = localStorage.getItem(snapKey(code));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== SRV_VERSION || typeof data.seed !== 'number' || !data.players) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// ================== construir el snapshot de la sesión ==================

/**
 * Anfitrión: fotografía COMPLETA del mundo para los miembros — el estado
 * de la partida (semilla + diferencias sobre el mapa regenerado: puertas,
 * contenedores, zombis, suelo, coches, construcciones, decals, cadáveres)
 * y el progreso de TODOS los jugadores (el propio en vivo; el de los
 * demás, su último estado reportado).
 */
export function buildServerSave(game, net) {
  if (!game || !game.map || !game.player) return null;
  // v0.28: cada zombi lleva SU nid de red en el snapshot — al mundo recién
  // creado (sin sincronía todavía) se le asignan aquí por primera vez, con
  // el MISMO contador que usará el anfitrión en vivo: quien restaure el
  // snapshot comparte ids y las altas (za) coinciden sin duplicar
  if (net) for (const z of game.zombies) z.nid = z.nid || ++net._zNid;
  // mundo + jugador local (con el registro de objetos de save.js)
  const world = buildSaveData(game);
  if (!world) return null;

  const players = {};
  // — el anfitrión, EN VIVO (con el MISMO registro de objetos del mundo:
  // una sola instancia de cada cosa entre mochila, contenedores y suelo) —
  const me = net.roster.find((r) => r.id === net.myId);
  players[net.memberId] = {
    name: me ? me.name : 'ANFITRIÓN',
    prof: game.player.prof || null,
    color: me ? me.color : NET.colors[0],
    dead: !!game.player.mpDead,
    kills: game.kills | 0,
    p: world.player,
    surv: world.surv,
    items: world.items,
  };

  // — los demás miembros: su último estado reportado (o sus metadatos) —
  for (const [id, mm] of net._members) {
    if (id === net.memberId) continue;
    players[id] = mm.state || {
      name: mm.name, prof: mm.prof || null, color: mm.color,
      dead: false, kills: 0, fresh: true,
    };
  }
  // miembros del snapshot anterior que no aparecieron en esta sesión:
  // su progreso se conserva tal cual estaba
  if (net.snapshot && net.snapshot.players) {
    for (const id of Object.keys(net.snapshot.players)) {
      if (!players[id]) players[id] = net.snapshot.players[id];
    }
  }

  return {
    v: SRV_VERSION,
    code: net.code,
    savedAt: Date.now(),
    day: world.day, clock: world.clock,
    dn: world.dn, wx: world.wx,
    seed: world.seed,
    doors: world.doors,
    containers: world.containers,
    ground: world.ground,
    zombies: world.zombies,
    cons: world.cons,
    veh: world.veh,
    bodies: world.bodies || [],
    decals: world.decals,
    players,
    time: world.time,
    searched: world.searched,
  };
}

// ================== restaurar el mundo ==================

/**
 * Reconstruye un mundo de servidor DENTRO de `game` para el jugador
 * `myId` (su memberId). Devuelve el mapa de jugadores restaurados
 * (id → {x, y, z, dead}) para colocar las marionetas, o null si falló.
 *
 * Los nids de zombis se conservan del snapshot (los renumera desde una
 * base ALTA y determinista: mismos datos → mismos nids en todas las
 * máquinas) para que nunca colisionen con los que el nuevo anfitrión
 * asigne desde cero. Los objetos del suelo y las construcciones,
 * igual.
 */
export function restoreServerGame(game, data, myId) {
  try {
    if (!data || typeof data.seed !== 'number') return null;
    game.seedUsed = data.seed;
    const map = new GameMap(new Rng(data.seed));
    for (const [tx, ty] of data.doors || []) map.setTile(tx, ty, T.DOOR_OPEN);
    game.map = map;
    game.rng = new Rng((data.seed ^ ((data.savedAt || 1) & 0x7fffffff)) >>> 0);
    game.mpBodies = [];

    // ---- registro compartido de objetos del mundo ----
    const byId = buildItems({ items: data.items || [] });
    const get = (id) => (id ? byId.get(id) : null) || null;

    // ---- el jugador local: su bloque de miembro (o vida nueva) ----
    const ids = Object.keys(data.players || {});
    let myBlock = data.players ? data.players[myId] : null;
    if (myBlock && myBlock.dead) myBlock = null;   // murió: vida nueva
    let p = null, surv = null;
    if (myBlock) {
      const r = restorePlayerData(game, myBlock);
      if (r) { p = r.p; surv = r.surv; }
    }
    if (!p) {
      const spawns = game._mpSpawnPoints(Math.max(1, ids.length));
      const idx = ids.indexOf(myId);
      const s = idx >= 0 ? (spawns[idx] || map.spawn) : map.spawn;
      p = new Player(s.x, s.y);
    }
    game.player = p;
    game.survival = surv || new Survival();

    // ---- zombis: conservan el nid del snapshot (los renumerados desde
    // 900000 son para snapshots VIEJOS sin nid) — así el mundo restaurado
    // comparte espacio de ids con el anfitrión y las altas (za) de la
    // sincronía coinciden sin DUPLICAR zombis en el cliente
    let zMaxNid = 0;
    game.zombies = (data.zombies || []).map((d, i) => {
      const z = zombieFromData(d);
      z.nid = d.n !== undefined ? d.n : 900000 + i;
      if (z.nid > zMaxNid) zMaxNid = z.nid;
      return z;
    });
    if (game.net) {
      game.net._zByNid.clear();
      for (const z of game.zombies) game.net._zByNid.set(z.nid, z);
      // los nids NUEVOS que asigne este anfitrión arrancan MÁS ALLÁ de los
      // restaurados: sin colisiones jamás
      if (zMaxNid > game.net._zNid) game.net._zNid = zMaxNid;
    }

    // ---- contenedores: registrado + contenido real ----
    for (const cs of data.containers || []) {
      const c = map.containers[cs.i];
      if (!c) continue;
      c.searched = !!cs.s;
      c.items = (cs.items || []).map(get).filter(Boolean);
    }

    // ---- objetos del suelo (nid renumerado desde 950000) ----
    game.groundItems = [];
    for (const g of data.ground || []) {
      const it = get(g.id);
      if (!it) continue;
      const gi = { x: g.x, y: g.y, z: g.z || 0, item: it, nid: 950000 + game.groundItems.length, visibleNow: false };
      game.groundItems.push(gi);
    }
    if (game.net) {
      for (const gi of game.groundItems) game.net._giByNid.set(gi.nid, gi);
    }

    // ---- construcciones (nid renumerado desde 980000) ----
    game.constructions = [];
    for (const cs of data.cons || []) {
      const c = addConstruction(game, cs.t, cs.tx, cs.ty, cs.rt || 0,
        cs.cp || null, cs.pd !== undefined ? cs.pd : null);
      if (cs.hp !== undefined) c.hp = cs.hp;
      if (cs.us !== undefined && c.uses !== undefined) c.uses = cs.us;
      if (cs.wt !== undefined && c.type === 'barril') c.water = cs.wt;
      if (cs.t === 'caja' && cs.it) c.items = cs.it.map(get).filter(Boolean);
      c.nid = 980000 + game.constructions.length;
    }

    // ---- coches ----
    applyVehicles(game, data.veh, get);

    // ---- cadáveres saqueables ----
    game.mpBodies = (data.bodies || []).map((b) => ({
      nid: b.n, name: b.nm || 'CAÍDO', color: b.cl || null,
      x: b.x, y: b.y, z: b.z || 0,
      searched: !!b.s,
      items: (b.it || []).map(get).filter(Boolean),
    }));

    // ---- reloj y clima ----
    game.daynight = new DayNight();
    game.daynight.t = (data.dn && data.dn.t) || 0;
    game._hourMark = Math.floor(game.daynight.hour);
    game.weather = new Weather();
    game.weather.load(data.wx);

    // ---- decals: reproducir sangre y cadáveres ----
    for (const op of data.decals || []) {
      if (op.t === 'corpse') map.stampCorpse(op.x, op.y, op.a || 0, op.s || 1);
      else map.stampBlood(op.x, op.y, !!op.b);
    }

    // ---- contadores de la sesión (los del jugador van en su bloque) ----
    game.time = data.time || 0;
    game.kills = (myBlock && myBlock.kills) || 0;
    game.searchedCount = data.searched || 0;
    game.deathCause = null;

    // ¿quedó dentro de un coche? vuelve a su asiento (silencioso)
    if (myBlock && myBlock.p && myBlock.p.pc !== null && myBlock.p.pc !== undefined) {
      const car = map.cars[myBlock.p.pc];
      if (car) enterCar(game, car, true, p);
    }

    // posiciones de todos (para marionetas)
    const positions = {};
    for (const id of ids) {
      const blk = data.players[id];
      positions[id] = blk && blk.p
        ? { x: blk.p.x, y: blk.p.y, z: blk.p.z || 0, dead: !!blk.dead }
        : { x: map.spawn.x, y: map.spawn.y, z: 0, dead: !!(blk && blk.dead) };
    }
    return positions;
  } catch (e) {
    console.warn('restoreServerGame:', e);
    return null;
  }
}

// ================== resumen para el menú ==================

/** Resumen legible de un mundo para la lista del menú. */
export function serverSummary(entry) {
  const snap = loadSnapshot(entry.code);
  return {
    code: entry.code,
    name: entry.name,
    pass: entry.pass,
    lastSync: entry.lastSync || 0,
    hasSnapshot: !!snap,
    day: snap ? snap.day : 0,
    clock: snap ? snap.clock : '',
    members: snap ? Object.keys(snap.players || {}).length : 1,
  };
}
