/**
 * net.js — v0.27/v0.28: MULTIJUGADOR co-op P2P (PeerJS).
 *
 * SALAS CON CÓDIGO: el anfitrión crea la sala y comparte un código de 5
 * caracteres (p. ej. «K7K2M»); los demás se unen tecleándolo. La
 * señalización atraviesa el servidor PÚBLICO de PeerJS; a partir de ahí
 * el juego viaja DIRECTO entre navegadores por WebRTC — no hay servidor
 * de juego y nadie ve la partida ajena.
 *
 * v0.28 — SERVIDORES PERSISTENTES: además de salas efímeras hay MUNDOS
 * con código de 6 + CONTRASEÑA de 4 dígitos que cualquiera de sus
 * miembros puede ABRIR (no hace falta el anfitrión original). El mundo
 * viaja por CHUNKS en el canal fiable (ver _send) y cada navegador
 * guarda su copia (servers.js).
 *
 * ARQUITECTURA — «ANFITRIÓN AUTORITATIVO + PREDICCIÓN LOCAL»:
 *  · ANFITRIÓN: simula el mundo (IA de zombis, respawn, gritadores,
 *    clima, hora, ruido) y resuelve el botín de los contenedores.
 *  · CLIENTES: mueven a SU superviviente EN LOCAL (mismo mapa por
 *    semilla → mismas colisiones) → CERO RETARDO en su propio juego.
 *    La posición se reporta al anfitrión, que la re-transmite.
 *  · El resto (otros jugadores, zombis) se dibuja INTERPOLADO hacia la
 *    última instantánea — suave incluso con la red cargada.
 *
 * CANALES POR PAREJA (anfitrión ↔ cliente):
 *  · `ctl` — FIABLE (llegada garantizada): arranque, lobby, botín,
 *    muertes, construcciones, coches, pings, CHAT y snapshots de
 *    servidor. Los mensajes grandes van TROCEADOS ({big}/{bigc}).
 *  · `snap` — NO fiable y sin orden (se pierde antes que reenviar):
 *    instantáneas de posición a 15 Hz. Si se pierde una, manda la
 *    siguiente: el retardo NUNCA se acumula.
 *
 * EL MUNDO SE RECONSTRUYE CON LA SEMILLA: map.js no usa Math.random,
 * así que el paquete de inicio solo lleva semilla, reloj, clima, horda
 * inicial y jugadores — unos KB, no MB.
 */

import { NET, TILE, T, DAYNIGHT } from '../config.js';
import { Player } from '../entities/player.js';
import { zombieFromData } from '../entities/zombie.js';
import { itemToData, itemFromData, serializePlayerData } from './save.js';
import { enterCar, exitCar, carCanStart, isDriver } from './vehicles.js';
import { buildServerSave, storeSnapshot, srvPeerId } from './servers.js';

// bits del estado de jugador en las instantáneas
const ST_SNEAK = 1, ST_RUN = 2, ST_SWING = 4, ST_DEAD = 8, ST_HURT = 16;
const ST_DOWN = 32;   // v0.28: caído — inconsciente, reanimable

// código corto de variante de zombi (1 carácter en el cable)
const VA2C = { normal: 'n', runner: 'r', brute: 'b', screamer: 's' };
const C2VA = { n: 'normal', r: 'runner', b: 'brute', s: 'screamer' };
// estado de zombi comprimido
const ZST = { idle: 0, wander: 1, investigate: 2, search: 3, chase: 4 };
const ZST_R = ['idle', 'wander', 'investigate', 'search', 'chase'];
const ZSCREAM = 8, ZBURN = 16;

/** Letra/charset seguro para leer a golpe de vista (sin I/L/O/0/1). */
export function genCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < NET.codeLen; i++) {
    s += NET.codeChars[Math.floor(rand() * NET.codeChars.length)];
  }
  return s;
}

/** Normaliza lo que teclea el usuario: mayúsculas, sin espacios.
 *  Devuelve null si tras limpiar no cabe (código inválido). */
export function normCode(str) {
  if (typeof str !== 'string') return null;
  const s = str.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === NET.codeLen ? s : null;
}

/** id de PeerJS de la sala: «zc27-CODIGO». */
export function peerIdFor(code) { return NET.peerPrefix + code; }

/** Interpolación exponencial estable por framerate. */
function damp(cur, target, k, dt) {
  return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

/** Códigos de error de sala legibles. */
const ERR = {
  noPeer: 'No se pudo cargar el módulo de red (PeerJS) — revisa tu conexión o bloqueadores y recarga.',
  taken: 'Ese código de sala ya existe en el mundo: inténtalo de nuevo.',
  net: 'Error de red creando la sala — inténtalo de nuevo.',
  notFound: 'No hay ninguna sala con ese código. Compruébalo con el anfitrión.',
  full: 'La sala está COMPLETA (máximo ' + NET.maxPlayers + ' sobrevivientes).',
  timeout: 'La sala no responde — puede que el anfitrión la haya cerrado.',
  closed: 'La conexión se cerró.',
  // v0.28: servidores
  srvTaken: 'Ese mundo ya lo tiene ABIERTO otro miembro — únete con el código mientras esté en marcha.',
  srvClosed: 'Nadie tiene ese mundo abierto ahora mismo. Si eres miembro, puedes ABRIRLO tú desde MIS MUNDOS.',
  wrongPass: 'La CONTRASEÑA no corresponde a ese mundo.',
  srvFull: 'El mundo está COMPLETO (máximo ' + NET.maxPlayers + ' miembros de por vida).',
};

export class NetSession {
  /** `role`: 'host' | 'client'; `mode`: 'room' (sala efímera) | 'server'
 *  (mundo persistente v0.28). El game es el Game local (para puppets). */
  constructor(game, role, mode = 'room') {
    this.game = game;
    this.role = role;
    this.mode = mode;           // 'room' | 'server'
    this.peer = null;
    this.code = null;
    this.myId = role === 'host' ? 'H' : null;
    this.hostId = 'H';         // v0.28: quién es el anfitrión (memberId en servidores)
    this.inGame = false;         // lobby vs partida en marcha
    this.roster = [];            // [{id, name, prof, color}] — orden = color
    this.remotes = new Map();    // id → {p, name, prof, color, alive, hp, rtt, carIdx, swing, lastSeenT}
    this.rtt = role === 'host' ? 0 : null;   // mi latencia (ms)
    this._pingT = 0;
    this._snapT = 0;
    this._stateT = 0;
    this._hourMark = -1;         // v0.27: avisos de hora en el cliente
    this.error = null;
    this._closed = false;
    // — host —
    this._peers = new Map();     // peerKey → {id, name, prof, ctl, snap, dead}
    this._zNid = 0;              // contador de ids de zombi
    this._zSent = new Map();     // nid → {x, y, st} último enviado
    this._giNid = 0;             // contador de objetos del suelo
    this._coNid = 0;             // contador de construcciones
    // — v0.28: servidor persistente —
    this.password = null;        // contraseña del mundo (host la valida)
    this.memberId = null;        // identidad estable local en el mundo
    this.snapshot = null;        // última copia del mundo (arranque y srvsave)
    this._members = new Map();   // host: id → {name, prof, color, online, state}
    this._srvSaveT = 0;          // host: cronómetro de sincronización del mundo
    this._srvStateT = 0;         // cliente: cronómetro de su estado
    this._bigId = 0;             // contador de mensajes troceados
    // — client —
    this.host = null;            // {ctl, snap}
    this._zByNid = new Map();    // nid → zombi local (marioneta)
    this._giByNid = new Map();
    this._coByNid = new Map();
    this._noiseQ = [];           // ruido pendiente de reportar al anfitrión
    this._hitQ = [];             // golpes pendientes (nid, dmg, ang, kb)
    this._spectate = null;       // jugador seguido tras morir
    this._lostZombieSeen = false;
  }

  // ================== LOBBY: crear sala ==================

  /** Anfitrión: crea el peer con id «zc27-CODIGO». Devuelve el código. */
  hostLobby(name) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') return reject(new Error(ERR.noPeer));
      const attempt = () => {
        const code = genCode();
        const peer = new window.Peer(peerIdFor(code), { debug: 0 });
        const to = setTimeout(() => { try { peer.destroy(); } catch (e) {} reject(new Error(ERR.timeout)); }, NET.joinTimeout * 1000);
        peer.on('open', () => {
          clearTimeout(to);
          this.peer = peer;
          this.code = code;
          this.roster = [{ id: 'H', name: name || 'ANFITRIÓN', prof: null, color: NET.colors[0] }];
          this._wireHostPeer(peer);
          resolve(code);
        });
        peer.on('error', (err) => {
          clearTimeout(to);
          try { peer.destroy(); } catch (e) {}
          if (err && err.type === 'unavailable-id') attempt();   // código repetido → otro
          else reject(new Error(ERR.net));
        });
      };
      attempt();
    });
  }

  _wireHostPeer(peer) {
    peer.on('connection', (conn) => this._acceptConn(conn));
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
    peer.on('error', (err) => {
      console.warn('[net] peer host error:', err && err.type);
    });
  }

  /** v0.28: ANFITRIÓN DE UN SERVIDOR — reclama el id del mundo
   *  («zc28s-CODIGO») y prepara el roster con los miembros conocidos
   *  del snapshot. `entry` viene de servers.js (getServer/loadSnapshot). */
  hostServerOpen(entry, snapshot, name) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') return reject(new Error(ERR.noPeer));
      const code = entry.code;
      const peer = new window.Peer(srvPeerId(code), { debug: 0 });
      const to = setTimeout(() => { try { peer.destroy(); } catch (e) {} reject(new Error(ERR.timeout)); }, NET.joinTimeout * 1000);
      peer.on('open', () => {
        clearTimeout(to);
        this.peer = peer;
        this.code = code;
        this.mode = 'server';
        this.password = entry.pass;
        this.memberId = entry.memberId;
        this.myId = entry.memberId;
        this.hostId = entry.memberId;
        this.snapshot = snapshot || null;
        this.roster = [{
          id: entry.memberId,
          name: name || entry.name || 'ANFITRIÓN',
          prof: null,
          color: NET.colors[0],
          host: true,
        }];
        // miembros conocidos del snapshot (colores y profesión estables)
        if (snapshot && snapshot.players) {
          for (const [id, blk] of Object.entries(snapshot.players)) {
            if (id === entry.memberId) {
              this.roster[0].prof = blk.prof || null;
              if (blk.color) this.roster[0].color = blk.color;
              continue;
            }
            this._members.set(id, {
              name: blk.name || 'MIEMBRO',
              prof: blk.prof || null,
              color: blk.color || NET.colors[1 + (this._members.size % 3)],
              online: false,
              state: blk,
            });
          }
        }
        this._wireHostPeer(peer);
        resolve(code);
      });
      peer.on('error', (err) => {
        clearTimeout(to);
        try { peer.destroy(); } catch (e) {}
        if (err && err.type === 'unavailable-id') reject(new Error(ERR.srvTaken));
        else reject(new Error(ERR.net));
      });
    });
  }

  /** El anfitrión recibe una conexión entrante (ctl y luego snap). */
  _acceptConn(conn) {
    if (conn.label === 'snap') {
      const entry = [...this._peers.values()].find((e) => e.peerKey === conn.peer);
      if (entry) { entry.snap = conn; this._wireData(conn, (m) => this._onClientState(entry, m)); }
      else conn.close();
      return;
    }
    // ctl — control de aforo ANTES de registrar
    if (this._peers.size >= NET.maxPlayers - 1) {
      const send = () => { try { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 250); } catch (e) {} };
      if (conn.open) send(); else conn.on('open', send);
      return;
    }
    const entry = { peerKey: conn.peer, id: null, name: '???', prof: null, ctl: conn, snap: null, dead: false };
    this._peers.set(conn.peer, entry);
    this._wireCtl(conn, (m) => this._onClientCtl(entry, m), () => this._dropClient(entry));
  }

  // ================== LOBBY: unirse ==================

  /** Cliente: se conecta a la sala `code` con su nombre. */
  joinLobby(code, name) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') return reject(new Error(ERR.noPeer));
      const peer = new window.Peer({ debug: 0 });
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) {}
        reject(new Error(msg));
      };
      const to = setTimeout(() => fail(ERR.timeout), NET.joinTimeout * 1000);
      peer.on('open', () => {
        const ctl = peer.connect(peerIdFor(code), { label: 'ctl', reliable: true, serialization: 'json' });
        const snap = peer.connect(peerIdFor(code), { label: 'snap', reliable: false, serialization: 'json' });
        ctl.on('open', () => {
          clearTimeout(to);
          if (settled) return;
          settled = true;
          this.peer = peer;
          this.code = code;
          this.host = { ctl, snap };
          this._wireCtl(ctl, (m) => this._onHostMsg(m), () => this._hostLost());
          this._wireData(snap, (m) => this._onHostSnap(m));
          ctl.send({ t: 'hello', name: name || 'SOBREVIVIENTE' });
          resolve(code);
        });
        ctl.on('error', (err) => {
          clearTimeout(to);
          fail(err && err.type === 'peer-unavailable' ? ERR.notFound : ERR.net);
        });
      });
      peer.on('error', (err) => {
        clearTimeout(to);
        fail(err && err.type === 'peer-unavailable' ? ERR.notFound : ERR.net);
      });
    });
  }

  /** Cliente: mi elección de profesión en el lobby. */
  setMyProf(prof) {
    const me = this.roster.find((r) => r.id === this.myId);
    if (me) me.prof = prof;
    if (this.isHost) this._sendLobby();
    else this._sendHost({ t: 'prof', prof });
  }

  /** v0.28: CLIENTE — se une a un SERVIDOR (mundo persistente) con su
   *  código + contraseña + identidad de miembro. El arranque (snapshot)
   *  llega como 'start' cuando el anfitrión lo mande. */
  joinServer(code, pass, memberId, name) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') return reject(new Error(ERR.noPeer));
      const peer = new window.Peer({ debug: 0 });
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        try { peer.destroy(); } catch (e) {}
        reject(new Error(msg));
      };
      const to = setTimeout(() => fail(ERR.srvClosed), NET.joinTimeout * 1000);
      peer.on('open', () => {
        const ctl = peer.connect(srvPeerId(code), { label: 'ctl', reliable: true, serialization: 'json' });
        const snap = peer.connect(srvPeerId(code), { label: 'snap', reliable: false, serialization: 'json' });
        ctl.on('open', () => {
          clearTimeout(to);
          if (settled) return;
          settled = true;
          this.peer = peer;
          this.code = code;
          this.mode = 'server';
          this.memberId = memberId;
          this.host = { ctl, snap };
          this._wireCtl(ctl, (m) => this._onHostMsg(m), () => this._hostLost());
          this._wireData(snap, (m) => this._onHostSnap(m));
          ctl.send({ t: 'hello', name: name || 'SOBREVIVIENTE', srv: 1, pass: String(pass || ''), mid: memberId });
          resolve(code);
        });
        ctl.on('error', (err) => {
          clearTimeout(to);
          fail(err && err.type === 'peer-unavailable' ? ERR.srvClosed : ERR.net);
        });
      });
      peer.on('error', (err) => {
        clearTimeout(to);
        fail(err && err.type === 'peer-unavailable' ? ERR.srvClosed : ERR.net);
      });
    });
  }

  /** Anfitrión: lanza la partida para todos.
   *  v0.28: en SERVIDOR el paquete de inicio es el SNAPSHOT COMPLETO del
   *  mundo (troceado por _send si pesa) — cada cliente lo restaura con
   *  servers.restoreServerGame y sigue desde ahí. */
  hostStart() {
    if (!this.isHost || this.inGame) return;
    this.inGame = true;
    if (this.mode === 'server') {
      for (const e of this._peers.values()) {
        if (!e.id) continue;
        this._send(e.ctl, { t: 'start', srv: 1, data: this.snapshot, roster: this.roster, me: e.id, host: this.myId });
      }
      if (this.onLocalStart) this.onLocalStart({ srv: 1, data: this.snapshot, roster: this.roster, me: this.myId, host: this.myId });
      return;
    }
    const data = this.buildStartData();
    for (const e of this._peers.values()) {
      if (!e.id) continue;
      this._send(e.ctl, { t: 'start', ...data, me: e.id });
    }
    // el anfitrión también arranca (main.js escucha onLocalStart)
    if (this.onLocalStart) this.onLocalStart(data);
  }

  /** Cierra la sesión (voluntario o caída) y avisa a todos.
   *  v0.28: en SERVIDOR el anfitrión difunde una ÚLTIMA fotografía del
   *  mundo (y el cliente sube su estado) antes de colgar — así el
   * progreso de todos viaja a los navegadores que queden. */
  leave(broadcastEnd) {
    if (this._closed) return;
    this._closed = true;
    if (this.mode === 'server' && this.onBeforeServerLeave) {
      try { this.onBeforeServerLeave(); } catch (e) {}
    }
    if (this.isHost && broadcastEnd && this.inGame) {
      this._broadcast({ t: 'end', reason: this.mode === 'server' ? 'srvhost' : 'host' });
    } else if (!this.isHost && this.host && this.host.ctl && this.host.ctl.open) {
      try { this.host.ctl.send({ t: 'act', op: 'leave' }); } catch (e) {}
    }
    setTimeout(() => { try { this.peer && this.peer.destroy(); } catch (e) {} }, 120);
    this._peers.clear();
    this.peer = null;
    this.host = null;
    if (this.onSessionEnd) this.onSessionEnd(broadcastEnd ? 'host' : 'leave');
  }

  // ================== fontanería de conexiones ==================

  get isHost() { return this.role === 'host'; }
  get active() { return !!this.peer && !this._closed; }

  /** Los mensajes de ctl pasan por aquí: los MÁS GRANDES de 6 KB van
   *  TROCEADOS ({big} + {bigc}×n) y se reensamblan al llegar — así el
   *  snapshot de un SERVIDOR (cientos de KB) cruza sin ahogar el canal. */
  _wireCtl(conn, onMsg, onClose) {
    const bigs = new Map();
    conn.on('data', (m) => {
      if (m && m.t === 'big') {
        bigs.set(m.id, { n: m.n | 0, parts: [] });
        return;
      }
      if (m && m.t === 'bigc') {
        const b = bigs.get(m.id);
        if (!b || m.i < 0 || m.i >= b.n) return;
        b.parts[m.i] = String(m.s);
        let got = 0;
        for (let i = 0; i < b.n; i++) if (b.parts[i] !== undefined) got++;
        if (got === b.n) {
          bigs.delete(m.id);
          try { onMsg(JSON.parse(b.parts.join(''))); } catch (e) {}
        }
        return;
      }
      onMsg(m);
    });
    conn.on('close', () => onClose && onClose());
    conn.on('error', () => onClose && onClose());
  }
  _wireData(conn, onMsg) {
    conn.on('data', onMsg);
    conn.on('error', () => {});
  }
  _send(conn, msg) {
    try {
      if (!conn || !conn.open) return;
      const s = JSON.stringify(msg);
      if (s.length <= 6000) { conn.send(msg); return; }
      const id = ++this._bigId;
      const n = Math.ceil(s.length / 6000);
      conn.send({ t: 'big', id, n });
      for (let i = 0; i < n; i++) {
        conn.send({ t: 'bigc', id, i, s: s.slice(i * 6000, (i + 1) * 6000) });
      }
    } catch (e) {}
  }
  _sendHost(msg) { this._send(this.host && this.host.ctl, msg); }
  _broadcast(msg) {
    for (const e of this._peers.values()) if (e.id) this._send(e.ctl, msg);
  }
  _broadcastSnap(msg) {
    for (const e of this._peers.values()) if (e.id && e.snap && e.snap.open) {
      try { e.snap.send(msg); } catch (err) {}
    }
  }

  // ================== LOBBY: mensajes ==================

  _onClientCtl(entry, m) {
    switch (m.t) {
      case 'hello': {
        if (entry.id) return;
        // v0.28: SERVIDOR — primero la contraseña, luego el aforo de MIEMBROS
        if (this.mode === 'server') {
          if (m.srv !== 1 || String(m.pass || '') !== String(this.password || '')) {
            this._send(entry.ctl, { t: 'denied', why: 'pass' });
            setTimeout(() => { try { entry.ctl.close(); } catch (e) {} }, 400);
            return;
          }
          const mid = String(m.mid || '').slice(0, 10);
          const known = this._members.has(mid);
          const totalMembers = 1 + this._members.size;   // el anfitrión cuenta
          if (!known && totalMembers >= NET.maxPlayers) {
            this._send(entry.ctl, { t: 'denied', why: 'full' });
            setTimeout(() => { try { entry.ctl.close(); } catch (e) {} }, 400);
            return;
          }
          entry.id = mid;
        } else {
          if (this._peers.size > NET.maxPlayers - 1) { this._send(entry.ctl, { t: 'full' }); return; }
          entry.id = 'P' + entry.peerKey.slice(-4);
        }
        entry.name = String(m.name || 'SOBREVIVIENTE').slice(0, 12).toUpperCase();
        this._addRosterPlayer(entry.id, entry.name);
        // v0.28: en SERVIDOR se respeta la identidad del miembro (color y
        // profesión de su última visita) y queda registrado en el mundo
        if (this.mode === 'server') {
          const mm = this._members.get(entry.id);
          const r = this.roster.find((x) => x.id === entry.id);
          if (mm) {
            mm.online = true;
            mm.name = entry.name;
            if (r && mm.color) r.color = mm.color;
            if (r && mm.prof) r.prof = mm.prof;
          } else {
            this._members.set(entry.id, {
              name: entry.name, prof: null,
              color: r ? r.color : NET.colors[1 + (this._members.size % 3)],
              online: true, state: null,
            });
          }
        }
        this._send(entry.ctl, { t: 'welcome', you: entry.id, code: this.code, roster: this.roster, host: this.myId });
        this._sendLobby();
        if (this.onLobby) this.onLobby(this.roster);   // el lobby del anfitrión también refresca
        if (this.onPeerJoin) this.onPeerJoin(entry.name);
        // v0.28: SERVIDOR en marcha — el miembro ENTRA con el estado actual:
        // snapshot fresco para él y aviso de alta a los demás
        if (this.mode === 'server' && this.inGame) {
          const snap = buildServerSave(this.game, this);
          if (snap) { this.snapshot = snap; storeSnapshot(this.code, snap); }
          this._send(entry.ctl, { t: 'start', srv: 1, data: this.snapshot, roster: this.roster, me: entry.id, host: this.myId });
          const mm = this._members.get(entry.id);
          const blk = mm && mm.state;
          const px = blk && blk.p ? Math.round(blk.p.x) : Math.round(this.game.map.spawn.x);
          const py = blk && blk.p ? Math.round(blk.p.y) : Math.round(this.game.map.spawn.y);
          for (const e of this._peers.values()) {
            if (!e.id || e.id === entry.id) continue;
            this._send(e.ctl, { t: 'ev', k: 'pjoin', id: entry.id, name: entry.name, prof: mm ? mm.prof : null, color: mm ? mm.color : '#e5484d', x: px, y: py });
          }
        }
        break;
      }
      case 'prof': entry.prof = m.prof || null; this._setRosterProf(entry.id, m.prof); this._sendLobby(); if (this.onLobby) this.onLobby(this.roster); break;
      case 'pstate': {
        // v0.28: SERVIDOR — el estado completo de un miembro (su progreso)
        if (this.mode === 'server' && entry.id && m.st) {
          const mm = this._members.get(entry.id);
          if (mm) { mm.state = m.st; mm.online = true; }
        }
        break;
      }
      case 'act': this._onClientAct(entry, m); break;
      case 'ping': this._send(entry.ctl, { t: 'pong', a: m.a }); break;
      case 'leave': this._dropClient(entry); break;
    }
  }

  _addRosterPlayer(id, name) {
    this.roster.push({
      id, name,
      prof: null,
      color: NET.colors[Math.min(this.roster.length, NET.colors.length - 1)],
    });
  }
  _setRosterProf(id, prof) {
    const r = this.roster.find((x) => x.id === id);
    if (r) r.prof = prof || null;
  }
  _removeRoster(id) {
    const i = this.roster.findIndex((r) => r.id === id);
    if (i >= 0) this.roster.splice(i, 1);
    // los colores NO se reordenan a mitad de partida: cada quien conserva
    // su camiseta aunque otro se vaya del lobby.
  }
  _sendLobby() { this._broadcast({ t: 'lobby', roster: this.roster }); }

  _dropClient(entry) {
    if (!this._peers.has(entry.peerKey)) return;
    this._peers.delete(entry.peerKey);
    if (entry.id) {
      this._removeRoster(entry.id);
      // v0.28: en SERVIDOR el miembre NO se borra del mundo: queda
      // desconectado (su progreso vuelve con él en la próxima sesión)
      if (this.mode === 'server') {
        const mm = this._members.get(entry.id);
        if (mm) mm.online = false;
      }
      const rem = this.remotes.get(entry.id);
      if (rem) {
        if (rem.p.inCar) { try { exitCar(this.game, true, rem.p); } catch (e) {} }
        this.remotes.delete(entry.id);
      }
      this._sendLobby();
      if (this.onLobby) this.onLobby(this.roster);   // el anfitrión ve salir a la gente
      if (this.onPeerLeave) this.onPeerLeave(entry.name);
      if (this.inGame) {
        this._broadcast({ t: 'ev', k: 'pleave', id: entry.id, name: entry.name });
        this._checkAllDead();
      }
    }
  }

  _onHostMsg(m) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.you;
        this.roster = m.roster || [];
        this.hostId = m.host || (this.roster[0] && this.roster[0].id) || 'H';
        if (this.onWelcome) this.onWelcome(this.roster);
        break;
      case 'lobby':
        this.roster = m.roster || [];
        if (this.onLobby) this.onLobby(this.roster);
        break;
      case 'start':
        this.inGame = true;
        if (this.onLocalStart) this.onLocalStart(m);
        break;
      case 'full': this.error = ERR.full; if (this.onFull) this.onFull(); break;
      case 'denied':
        // v0.28: el SERVIDOR rechazó la entrada (contraseña / aforo)
        this.error = m.why === 'full' ? ERR.srvFull : ERR.wrongPass;
        if (this.onDenied) this.onDenied(this.error);
        break;
      case 'ping': this._sendHost({ t: 'pong', a: m.a }); break;
      case 'pong': this.rtt = Math.max(1, Math.round(performance.now() - m.a)); break;
      case 'loot': this._applyLoot(m); break;
      case 'dmg': this._applyRemoteBite(m); break;
      case 'ev': this._onEvent(m); break;
      case 'srvsave': {
        // v0.28: el anfitrión sincroniza el mundo — copia local actualizada
        if (m.data && m.data.v) {
          this.snapshot = m.data;
          storeSnapshot(this.code, m.data);
        }
        break;
      }
      case 'end': this.inGame = false; if (this.onSessionEnd) this.onSessionEnd(m.reason || 'host'); break;
      case 'pickFail': this._rollbackPick(m); break;
    }
  }

  _hostLost() {
    if (this._closed) return;
    this._closed = true;
    if (this.onSessionEnd) this.onSessionEnd('host');
  }

  // ================== ARRANQUE DE PARTIDA ==================

  /** Anfitrión: construye el paquete de inicio (semilla + horda + reloj). */
  buildStartData() {
    const g = this.game;
    const roster = this.roster.map((r) => ({ ...r }));
    const zombies = g.zombies.map((z) => [
      (z.nid = z.nid || ++this._zNid),
      Math.round(z.x), Math.round(z.y),
      VA2C[z.variant] || 'n',
      z.z || 0,
    ]);
    const ground = g.groundItems.map((gi) => [
      (gi.nid = gi.nid || ++this._giNid),
      Math.round(gi.x), Math.round(gi.y), gi.z || 0,
      itemToData(gi.item),
    ]);
    return {
      seed: g.seedUsed,
      dn: +g.daynight.t.toFixed(2),
      wx: g.weather ? g.weather.toData() : null,
      roster, zombies, ground,
    };
  }

  /** Todas las máquinas: crea las marionetas de los demás jugadores. */
  buildPuppets() {
    for (const r of this.roster) {
      if (r.id === this.myId) continue;
      const p = new Player(0, 0);
      p.mpColor = r.color;
      p.mpName = r.name;
      p.prof = r.prof || null;
      p.mpId = r.id;
      this.remotes.set(r.id, {
        p, name: r.name, prof: r.prof, color: r.color,
        alive: true, hp: 100, rtt: null, carIdx: -1, swing: 0,
        tx: 0, ty: 0, tAng: 0,
      });
    }
  }

  /** Cliente: zombi marioneta desde el paquete de inicio. */
  zombieFromNet(a) {
    const z = zombieFromData({ va: C2VA[a[3]] || 'n', x: a[1], y: a[2], hp: 9999, zz: a[4] });
    z.nid = a[0];
    z._tx = a[1]; z._ty = a[2];
    return z;
  }

  // ================== TICK PRINCIPAL (main.update) ==================

  tick(dt) {
    if (!this.peer || this._closed) return;
    this._pingT += dt;
    if (this._pingT >= NET.pingEvery) {
      this._pingT = 0;
      const a = performance.now();
      if (this.isHost) this._broadcast({ t: 'ping', a });
      else this._sendHost({ t: 'ping', a });
    }
    // v0.28: SERVIDOR — sincronía del mundo (host → miembros) y del
    // propio progreso (miembro → host)
    if (this.mode === 'server' && this.inGame) {
      if (this.isHost) {
        this._srvSaveT += dt;
        if (this._srvSaveT >= NET.srvSaveEvery) {
          this._srvSaveT = 0;
          this._srvSaveTick();
        }
      } else {
        this._srvStateT += dt;
        if (this._srvStateT >= NET.srvStateEvery) {
          this._srvStateT = 0;
          this._srvStateTick();
        }
      }
    }
    if (this.isHost) this._hostTick(dt);
    else this._clientTick(dt);
  }

  /** v0.28: host de SERVIDOR — fotografía el mundo y lo difunde a los
   *  miembros (cada uno guarda su copia: el mundo sobrevive al anfitrión). */
  _srvSaveTick() {
    const snap = buildServerSave(this.game, this);
    if (!snap) return;
    this.snapshot = snap;
    storeSnapshot(this.code, snap);
    this._broadcast({ t: 'srvsave', data: snap });
  }

  /** v0.28: miembro de SERVIDOR — sube SU progreso completo al anfitrión
   *  (mochila, equipo, vitals, posición) para que viaje en el snapshot. */
  _srvStateTick() {
    const g = this.game;
    if (!g || !g.player || !g.survival) return;
    const carIdx = g.player.inCar ? g.map.cars.indexOf(g.player.inCar) : null;
    const st = serializePlayerData(g.player, g.survival, {
      dead: !!g.player.mpDead,
      down: !!g.player.mpDown,
      kills: g.kills | 0,
    }, carIdx);
    this._sendHost({ t: 'pstate', st });
  }

  // ---------- anfitrión: instantáneas ----------

  _hostTick(dt) {
    if (!this.inGame) return;
    // las marionetas de los clientes también se suavizan aquí (el anfitrión
    // las dibuja y los zombis las persiguen: la posición PUBLICADA ya
    // llegó por el canal snap)
    this._interpRemotes(dt);
    this._snapT += dt;
    if (this._snapT < 1 / NET.snapHz) return;
    this._snapT = 0;
    const g = this.game;

    // jugadores: el propio + las marionetas (posición reportada ya interpada)
    const pl = [];
    const pushPlayer = (id, p, hp) => {
      let st = 0;
      if (p.sneak) st |= ST_SNEAK;
      if (p.running) st |= ST_RUN;
      if (p.swingT > 0) st |= ST_SWING;
      if (p.mpDead) st |= ST_DEAD;
      if (p.mpDown) st |= ST_DOWN;      // v0.28: caído, reanimable
      if (p.hurtFlash > 0) st |= ST_HURT;
      const carIdx = p.inCar ? g.map.cars.indexOf(p.inCar) : -1;
      const row = [id, Math.round(p.x), Math.round(p.y), Math.round(p.angle * 100), st, Math.round(hp), p.z || 0, carIdx];
      if (p.mpDown) row.push(Math.ceil(p.mpDownT));   // v0.28: cuenta atrás visible
      pl.push(row);
    };
    pushPlayer(this.myId, g.player, g.survival.health);
    for (const [id, r] of this.remotes) pushPlayer(id, r.p, r.hp);

    // zombis: delta contra lo último enviado + altas de los nuevos
    const za = [], zm = [];
    const alive = new Set();
    const anyPlayer = this._targetsForSync();
    for (const z of g.zombies) {
      if (!z.nid) z.nid = ++this._zNid;
      alive.add(z.nid);
      // solo se sincroniza lo cercano a ALGÚN jugador
      let near = false;
      for (const tp of anyPlayer) {
        if (Math.hypot(z.x - tp.x, z.y - tp.y) < NET.zombieSyncR) { near = true; break; }
      }
      if (!near) continue;
      let stz = ZST[z.state] || 0;
      if (z.screamT > 0) stz |= ZSCREAM;
      if (z.burn > 0) stz |= ZBURN;
      const prev = this._zSent.get(z.nid);
      if (!prev) {
        za.push([z.nid, Math.round(z.x), Math.round(z.y), VA2C[z.variant] || 'n', z.z || 0, stz]);
        this._zSent.set(z.nid, { x: z.x, y: z.y, stz });
      } else if (Math.hypot(z.x - prev.x, z.y - prev.y) > 2.5 || stz !== prev.stz) {
        zm.push([z.nid, Math.round(z.x), Math.round(z.y), Math.round(z.face * 100), stz]);
        prev.x = z.x; prev.y = z.y; prev.stz = stz;
      }
    }
    // limpieza de ids muertos (los zkill viajan por ctl, esto es sanitario)
    for (const nid of this._zSent.keys()) if (!alive.has(nid)) this._zSent.delete(nid);

    // coches en marcha (los aparcados no se mueven: nada que enviar)
    const ci = [];
    for (const car of g.map.cars) {
      if (!car.driven) continue;
      ci.push([
        g.map.cars.indexOf(car),
        Math.round(car.x), Math.round(car.y),
        Math.round(car.dir * 100), Math.round(car.speed),
        Math.round(car.fuel * 10), car.lights ? 1 : 0, Math.round(car.engineHp),
        car.running ? 1 : 0,
      ]);
    }

    this._broadcastSnap({
      t: 1,
      dn: +g.daynight.t.toFixed(2),
      day: g.daynight.day,
      wx: g.weather ? g.weather.toData() : null,
      pl, za, zm, ci,
    });
  }

  /** Jugadores vivos para el radio de sincronización de zombis.
   *  v0.28: los CAÍDOS no cuentan — para la horda ya son carne (y así el
   *  compañero puede llegar a reanimarlos), igual que los muertos. */
  _targetsForSync() {
    const out = [];
    if (!this.game.player.mpDead && !this.game.player.mpDown) out.push(this.game.player);
    for (const r of this.remotes.values()) {
      if (r.alive && !r.p.mpDown) out.push(r.p);
    }
    return out;
  }

  // ---------- anfitrión: estado de un cliente ----------

  _onClientState(entry, m) {
    if (!entry.id || !this.inGame || m.t !== 2) return;
    const g = this.game;
    const r = this.remotes.get(entry.id);
    if (!r) return;
    const p = r.p;

    p._tx = m.x; p._ty = m.y; p._tAng = m.a / 100;
    p.sneak = !!(m.st & ST_SNEAK);
    p.running = !!(m.st & ST_RUN);
    if (m.st & ST_SWING) { if (p.swingT <= 0) p.swingT = p.swingDur || 0.25; }
    const wasAlive = r.alive;
    r.alive = !(m.st & ST_DEAD);
    p.mpDead = !r.alive;
    // v0.28: caído (reanimable) — la cuenta atrás la dicta SU máquina
    p.mpDown = !!(m.st & ST_DOWN);
    if (p.mpDown && m.dw !== undefined) p.mpDownT = m.dw;
    r.hp = m.hp;
    if ((m.z !== undefined) && !p.inCar) p.z = m.z;
    // coche: el conductor manda el estado del vehículo (autoridad del piloto)
    if (Array.isArray(m.ci) && m.ci.length === 9) {
      const car = g.map.cars[m.ci[0]];
      if (car && car.driven) {
        car.x = m.ci[1]; car.y = m.ci[2];
        car.dir = m.ci[3] / 100; car.speed = m.ci[4];
        car.fuel = m.ci[5] / 10; car.lights = !!m.ci[6];
        car.engineHp = m.ci[7]; car.running = !!m.ci[8];
        if (p.inCar !== car) p.inCar = car;
      }
    } else if (m.car >= 0) {
      const car = g.map.cars[m.car];
      if (car && p.inCar !== car) p.inCar = car;
    } else if (p.inCar && m.car < 0) {
      p.inCar = null;
    }
    if (wasAlive && !r.alive) this._checkAllDead();
    // ruido del cliente → el sistema del anfitrión (los zombis lo oyen)
    if (Array.isArray(m.nz)) {
      for (const [x, y, rad] of m.nz) g.noise.emit(x, y, rad, 'red');
    }
    // golpes reportados (fiables van por ctl; esto es el colchón visual)
    if (Array.isArray(m.zh)) this._applyHits(entry.id, m.zh);
  }

  /** Anfitrión: aplica los golpes que reporta un cliente. */
  _applyHits(byId, list) {
    const g = this.game;
    for (const [nid, dmg, ang, kb] of list) {
      const z = g.zombies.find((zz) => zz.nid === nid);
      if (!z) continue;
      z.takeDamage(dmg, ang, kb, g);
      if (z.hp <= 0) {
        g.killsBy = byId;   // quién se apunta la baja
        g.killZombie(z);
        g.killsBy = null;
      }
    }
  }

  /** Anfitrión: una mordida cae sobre un jugador REMOTO → se la enviamos.
   *  v0.28: los CAÍDOS no reciben mordidas (ya están en el suelo). */
  routeBite(z, target) {
    const r = [...this.remotes.entries()].find(([, rr]) => rr.p === target);
    if (!r) return;
    const [id] = r;
    if (target.mpDead || target.mpDown) return;
    // ¿va a bordo? el golpe cae sobre la CHAPA — el coche es del piloto
    if (target.inCar) {
      const car = target.inCar;
      const dmg = z.dmgMin + Math.random() * (z.dmgMax - z.dmgMin);
      car.engineHp = Math.max(0, car.engineHp - dmg * 0.4);
      this._broadcast({ t: 'ev', k: 'carHp', i: this.game.map.cars.indexOf(car), hp: car.engineHp });
      return;
    }
    const dmg = z.dmgMin + Math.random() * (z.dmgMax - z.dmgMin);
    const e = [...this._peers.values()].find((x) => x.id === id);
    if (e) this._send(e.ctl, {
      t: 'dmg', d: +dmg.toFixed(1),
      x: Math.round(z.x), y: Math.round(z.y), va: z.variant,
    });
  }

  /** Anfitrión: ¿han caído todos? → fin de partida para la sala. */
  _checkAllDead() {
    if (!this.inGame) return;
    const g = this.game;
    const hostDead = !!g.player.mpDead;
    const anyAlive = !hostDead || [...this.remotes.values()].some((r) => r.alive);
    if (!anyAlive) {
      this._broadcast({ t: 'end', reason: 'all' });
      this.inGame = false;
      if (this.onSessionEnd) this.onSessionEnd('all');
    }
  }

  // ---------- cliente: envío de estado + interpolación ----------

  _clientTick(dt) {
    if (!this.inGame) return;
    const g = this.game;
    const p = g.player;

    // avisos de hora con el reloj sincronizado (el mundo no corre aquí)
    const h = Math.floor(g.daynight.hour);
    if (h !== this._hourMark) {
      this._hourMark = h;
      if (h === DAYNIGHT.nightStart) g.toasts.push('Anochece. La noche los trae de vuelta…', 'warn');
      else if (h === DAYNIGHT.nightEnd) g.toasts.push('Amanece. Por fin algo de luz.', 'info');
    }

    // interpolación de TODO lo remoto (marionetas y zombis)
    this._interp(dt);

    // envío de mi estado a la cadencia fijada
    this._stateT += dt;
    if (this._stateT >= 1 / NET.stateHz) {
      this._stateT = 0;
      let st = 0;
      if (p.sneak) st |= ST_SNEAK;
      if (p.running) st |= ST_RUN;
      if (p.swingT > 0) st |= ST_SWING;
      if (p.mpDead) st |= ST_DEAD;
      if (p.mpDown) st |= ST_DOWN;      // v0.28: caído, reanimable
      if (p.hurtFlash > 0) st |= ST_HURT;
      const msg = {
        t: 2,
        x: Math.round(p.x), y: Math.round(p.y),
        a: Math.round(p.angle * 100), st,
        hp: Math.round(g.survival.health),
        z: p.z || 0,
        car: p.inCar ? g.map.cars.indexOf(p.inCar) : -1,
      };
      if (p.mpDown) msg.dw = Math.ceil(p.mpDownT);   // v0.28: cuenta atrás
      if (p.inCar) {
        const car = p.inCar;
        // v0.28: SOLO el conductor manda el estado del vehículo — el
        // pasajero viaja dentro (posición = coche) sin opinar del motor
        if (isDriver(p)) {
          msg.ci = [
            g.map.cars.indexOf(car),
            Math.round(car.x), Math.round(car.y),
            Math.round(car.dir * 100), Math.round(car.speed),
            Math.round(car.fuel * 10), car.lights ? 1 : 0,
            Math.round(car.engineHp), car.running ? 1 : 0,
          ];
          msg.car = msg.ci[0];
        }
      }
      // ruido y golpes acumulados
      if (this._noiseQ.length) { msg.nz = this._noiseQ; this._noiseQ = []; }
      if (this._hitQ.length) {
        msg.zh = this._hitQ; this._hitQ = [];
        // los golpes son CRÍTICOS: además por el canal fiable (a prueba de pérdida)
        this._sendHost({ t: 'act', op: 'zhit', list: msg.zh });
      }
      this._send(this.host && this.host.snap, msg);
    }
  }

  /** Cliente: suaviza marionetas y zombis hacia la última instantánea. */
  _interp(dt) {
    this._interpRemotes(dt);
    const g = this.game;
    const k = 1 - Math.exp(-NET.lerpK * dt);
    for (const z of g.zombies) {
      if (z._tx !== undefined) {
        z.x = damp(z.x, z._tx, NET.lerpK, dt);
        z.y = damp(z.y, z._ty, NET.lerpK, dt);
      }
      if (z._tFace !== undefined) {
        let d = z._tFace - z.face;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        z.face += d * k;
      }
      // decaimientos visuales que el update() local ya no corre
      if (z.flash > 0) z.flash = Math.max(0, z.flash - dt);
      if (z.screamT > 0 && !(z._stz & ZSCREAM)) z.screamT = Math.max(0, z.screamT - dt);
      if (z.burn > 0 && !(z._stz & ZBURN)) z.burn = Math.max(0, z.burn - dt);
    }
  }

  /** Suaviza las MARIONETAS de jugadores remotos (anfitrión y cliente). */
  _interpRemotes(dt) {
    const k = 1 - Math.exp(-NET.lerpK * dt);
    for (const r of this.remotes.values()) {
      const p = r.p;
      if (p._tx !== undefined) {
        p.x = damp(p.x, p._tx, NET.lerpK, dt);
        p.y = damp(p.y, p._ty, NET.lerpK, dt);
      }
      if (p._tAng !== undefined) {
        let d = p._tAng - p.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.angle += d * k;
      }
      if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);
      if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt);
    }
  }

  /** Cliente: instantánea del anfitrión. */
  _onHostSnap(m) {
    if (m.t !== 1 || !this.inGame) return;
    const g = this.game;
    // reloj y clima del anfitrión = la ley
    const dn = m.dn, my = g.daynight.t;
    if (Math.abs(dn - my) > 2) g.daynight.t = dn;          // re-sincronía dura
    else g.daynight.t = dn;                                  // misma marcha
    if (m.wx && g.weather) g.weather.load(m.wx);

    // jugadores
    for (const row of m.pl || []) {
      const [id, x, y, a, st, hp, zz, carIdx, dw] = row;
      if (id === this.myId) continue;
      let r = this.remotes.get(id);
      if (!r) continue;   // altas tardías: llegan con el paquete de inicio
      const p = r.p;
      p._tx = x; p._ty = y; p._tAng = a / 100;
      p.sneak = !!(st & ST_SNEAK);
      p.running = !!(st & ST_RUN);
      if (st & ST_SWING) { if (p.swingT <= 0) p.swingT = p.swingDur || 0.25; }
      if (st & ST_HURT) p.hurtFlash = 0.4;
      r.hp = hp;
      const wasAlive = r.alive;
      r.alive = !(st & ST_DEAD);
      p.mpDead = !r.alive;
      // v0.28: caído (reanimable) con su cuenta atrás
      p.mpDown = !!(st & ST_DOWN);
      if (p.mpDown && dw !== undefined) p.mpDownT = dw;
      if (!p.inCar) p.z = zz;
      r.carIdx = carIdx;
      if (carIdx >= 0) {
        const car = g.map.cars[carIdx];
        if (car) p.inCar = car;
      } else if (p.inCar && !g.map.cars.includes(p.inCar)) p.inCar = null;
      else if (p.inCar && carIdx < 0) p.inCar = null;
      if (wasAlive && !r.alive && this.onRemoteDead) this.onRemoteDead(r.name);
    }

    // zombis: altas y movimientos
    for (const a of m.za || []) {
      if (this._zByNid.has(a[0])) continue;
      const z = this.zombieFromNet(a);
      z._stz = a[5] || 0;
      if (z._stz & ZSCREAM) z.screamT = 1.1;
      this._zByNid.set(a[0], z);
      g.zombies.push(z);
    }
    for (const mv of m.zm || []) {
      const z = this._zByNid.get(mv[0]);
      if (!z) continue;
      z._tx = mv[1]; z._ty = mv[2]; z._tFace = mv[3] / 100;
      z._stz = mv[4] || 0;
      z.state = ZST_R[z._stz & 7] || 'idle';
      z.screamT = (z._stz & ZSCREAM) ? 1.1 : Math.max(0, z.screamT - 0.07);
      if (z._stz & ZBURN) z.burn = Math.max(z.burn || 0, 1);
    }

    // coches conducidos (posición del piloto)
    for (const c of m.ci || []) {
      const car = g.map.cars[c[0]];
      if (!car) continue;
      car._tx = c[1]; car._ty = c[2];
      car._tDir = c[3] / 100;
      car.speed = c[4];
      car.fuel = c[5] / 10;
      car.lights = !!c[6];
      car.engineHp = c[7];
      car.running = !!c[8];
    }
    // suavizado de coches remotos en marcha (los no-conducidos son fijos)
    for (const car of g.map.cars) {
      if (car.driven && car._tx !== undefined && !g.player.inCar !== car) {
        // nota: el coche PROPIO lo mueve la física local; los demás se interpan
      }
      if (car.driven && car._tx !== undefined && g.player.inCar !== car) {
        car.x = damp(car.x, car._tx, NET.lerpK, 1 / NET.snapHz);
        car.y = damp(car.y, car._ty, NET.lerpK, 1 / NET.snapHz);
        let d = car._tDir - car.dir;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        car.dir += d * (1 - Math.exp(-NET.lerpK / NET.snapHz));
      }
    }
  }

  // ================== ACTOS DEL CLIENTE → ANFITRIÓN ==================

  /** Clave de botín estable para cualquier contenedor del mundo.
   *  v0.28: los CUERPOS de jugadores caídos son saqueables como cualquier
   *  contenedor (clave {b: nid del cuerpo}). */
  lootKeyOf(c) {
    const g = this.game;
    if (!c) return null;
    if (c.type === 'cajuela') {
      const car = c.car || g.map.cars.find((k) => k.trunk === c);
      const i = car ? g.map.cars.indexOf(car) : -1;
      return i >= 0 ? { v: i } : null;
    }
    if (c.mpBodyNid !== undefined) return { b: c.mpBodyNid };
    if (c.nid !== undefined) return { k: c.nid };                       // caja de crafteo
    const i = g.map.containers.indexOf(c);
    return i >= 0 ? { c: i } : null;
  }

  _findLoot(key) {
    const g = this.game;
    if (!key) return null;
    if (key.v !== undefined) {
      const car = g.map.cars[key.v];
      return car ? car.trunk : null;
    }
    if (key.b !== undefined) {
      return (g.mpBodies || []).find((x) => x.nid === key.b) || null;   // v0.28: cuerpo
    }
    if (key.k !== undefined) {
      return g.constructions.find((c) => c.nid === key.k) || null;
    }
    if (key.c !== undefined) return g.map.containers[key.c] || null;
    return null;
  }

  /** Toma de botín: se retira en TODAS las máquinas (cualquier rol). */
  syncTake(c, idx) {
    const key = this.lootKeyOf(c);
    if (!key) return;
    if (this.isHost) this._broadcast({ t: 'ev', k: 'lootDel', key, i: idx });
    else this._sendHost({ t: 'act', op: 'take', key, i: idx });
  }

  /** Depósito en contenedor: aparece en TODAS las máquinas (cualquier rol). */
  syncPut(c, item) {
    const key = this.lootKeyOf(c);
    if (!key) return;
    const data = itemToData(item);
    if (this.isHost) this._broadcast({ t: 'ev', k: 'lootAdd', key, it: data });
    else this._sendHost({ t: 'act', op: 'put', key, it: data });
  }

  /** Cliente: pide abrir/registrar un contenedor (botín autoritativo). */
  requestLoot(c) {
    const key = this.lootKeyOf(c);
    if (!key) return false;
    this._sendHost({ t: 'act', op: 'search', key });
    return true;
  }

  /** Cliente: tomó un objeto del contenedor (el anfitrión lo retira). */
  sendTake(c, idx) { this.syncTake(c, idx); }

  /** Cliente: guardó un objeto en el contenedor. */
  sendPut(c, item) { this.syncPut(c, item); }

  /** Cliente: golpe asestado a un zombi (la muerte la decide el anfitrión). */
  reportHit(z, dmg, ang, kb) {
    if (z && z.nid !== undefined) {
      this._hitQ.push([z.nid, +dmg.toFixed(1), +ang.toFixed(2), +kb.toFixed(1)]);
      if (this._hitQ.length > 24) this._hitQ.splice(0, this._hitQ.length - 24);
    }
  }

  /** Cliente: ruido local que el anfitrión debe oír (atrae a sus zombis). */
  queueNoise(x, y, r) { this._noiseQ.push([Math.round(x), Math.round(y), Math.round(r)]); }

  /** v0.28: CHAT de sala — difunde un mensaje a todos (con eco local).
   *  El nombre y el color los pone cada máquina al recibir el evento. */
  sendChat(txt) {
    const clean = String(txt || '').slice(0, NET.chatMaxLen).trim();
    if (!clean) return;
    this.sendEv('chat', { id: this.myId, txt: clean });
  }

  /** Cualquiera: difunde un evento del mundo (el anfitrión lo reparte). */
  sendEv(k, data) {
    if (this.isHost) this._broadcast({ t: 'ev', k, ...data });
    else this._sendHost({ t: 'act', op: 'ev', k, ...data });
  }

  // ---------- anfitrión: resolución de actos ----------

  _onClientAct(entry, m) {
    const g = this.game;
    switch (m.op) {
      case 'leave': this._dropClient(entry); return;
      case 'zhit': if (Array.isArray(m.list)) this._applyHits(entry.id, m.list); return;
      case 'ev': this._relayEvent(entry.id, m); return;
    }
    if (!this.inGame) return;
    switch (m.op) {
      case 'search': {
        const c = this._findLoot(m.key);
        if (!c) return;
        if (!c.searched) { c.searched = true; g.searchedCount++; }
        const e = [...this._peers.values()].find((x) => x.id === entry.id);
        if (e) this._send(e.ctl, {
          t: 'loot', key: m.key,
          items: c.items.map(itemToData),
          searched: true,
        });
        this._broadcast({ t: 'ev', k: 'searched', key: m.key });
        break;
      }
      case 'take': {
        const c = this._findLoot(m.key);
        if (!c || !Array.isArray(c.items)) return;
        if (m.i >= 0 && m.i < c.items.length) c.items.splice(m.i, 1);
        this._broadcast({ t: 'ev', k: 'lootDel', key: m.key, i: m.i });
        break;
      }
      case 'put': {
        const c = this._findLoot(m.key);
        if (!c || !Array.isArray(c.items)) return;
        const it = itemFromData(m.it);
        if (it) c.items.push(it);
        this._broadcast({ t: 'ev', k: 'lootAdd', key: m.key, it: m.it });
        break;
      }
      case 'pick': {
        const gi = g.groundItems.find((x) => x.nid === m.n);
        if (gi) {
          const i = g.groundItems.indexOf(gi);
          if (i >= 0) g.groundItems.splice(i, 1);
          this._broadcast({ t: 'ev', k: 'giDel', n: m.n });
        } else {
          const e = [...this._peers.values()].find((x) => x.id === entry.id);
          if (e) this._send(e.ctl, { t: 'pickFail', n: m.n });
        }
        break;
      }
      case 'giAdd': {
        const it = itemFromData(m.it);
        if (it) {
          g.groundItems.push({ x: m.x, y: m.y, z: m.z || 0, item: it, nid: m.n, visibleNow: false });
          this._broadcast({ t: 'ev', k: 'giAdd', n: m.n, x: m.x, y: m.y, z: m.z || 0, it: m.it });
        }
        break;
      }
      case 'door': {
        g.map.setTile(m.tx, m.ty, m.open ? T.DOOR_OPEN : T.DOOR_CLOSED);
        this._broadcast({ t: 'ev', k: 'door', tx: m.tx, ty: m.ty, open: !!m.open });
        break;
      }
      case 'cons': {
        // construcción colocada por el cliente: se replica en el anfitrión
        if (this.onRemoteCons) this.onRemoteCons(m.data);
        this._broadcast({ t: 'ev', k: 'cons', data: m.data });
        break;
      }
      case 'consHp': {
        if (this.onRemoteConsHp) this.onRemoteConsHp(m.n, m.hp);
        this._broadcast({ t: 'ev', k: 'consHp', n: m.n, hp: m.hp });
        break;
      }
      case 'consWt': {
        if (this.onRemoteConsWt) this.onRemoteConsWt(m.n, m.wt);
        this._broadcast({ t: 'ev', k: 'consWt', n: m.n, wt: m.wt });
        break;
      }
      case 'consDel': {
        if (this.onRemoteConsDel) this.onRemoteConsDel(m.n);
        this._broadcast({ t: 'ev', k: 'consDel', n: m.n });
        break;
      }
      case 'carIn': {
        // v0.28: `ps`=1 sube como PASAJERO (el conductor manda; el asiento
        // se replica en la máquina de cada uno)
        const car = g.map.cars[m.i];
        const r = this.remotes.get(entry.id);
        if (car && r) {
          enterCar(g, car, true, r.p, !!m.ps);
          car.running = !!m.r && carCanStart(car);
          this._broadcast({ t: 'ev', k: 'carIn', i: m.i, r: car.running ? 1 : 0, who: entry.id, ps: m.ps ? 1 : 0 });
        }
        break;
      }
      case 'carOut': {
        // v0.28: solo se baja QUIEN lo pidió (antes vaciaba el coche)
        const car = g.map.cars[m.i];
        const r = this.remotes.get(entry.id);
        if (car && r && r.p.inCar === car) {
          exitCar(g, true, r.p);
          if (m.x !== undefined) { r.p.x = m.x; r.p.y = m.y; r.p._tx = m.x; r.p._ty = m.y; }
          this._broadcast({ t: 'ev', k: 'carOut', i: m.i, x: m.x, y: m.y, who: entry.id });
        }
        break;
      }
      case 'carMod': {
        const car = g.map.cars[m.i];
        if (car) {
          if (m.f !== undefined) car.fuel = m.f;
          if (m.e !== undefined) car.engineHp = m.e;
          if (m.p) car.parts = { ...car.parts, ...m.p };
          this._broadcast({ t: 'ev', k: 'carMod', i: m.i, f: m.f, e: m.e, p: m.p });
        }
        break;
      }
      case 'molotov': {
        // vuelo visual en el anfitrión (la explosión y su daño son locales del anfitrión)
        if (this.onRemoteMolotov) this.onRemoteMolotov(m);
        this._broadcast({ t: 'ev', k: 'molotov', x: m.x, y: m.y, vx: m.vx, vy: m.vy, z: m.z || 0 });
        break;
      }
    }
  }

  /** Anfitrión: evento de cliente → efecto local + re-difusión AL RESTO
   *  (nunca al originador: él ya lo aplicó al generar).
   *  v0.28: los eventos de sala (caídas, reanimaciones, chat, cuerpos)
   *  también se aplican AQUÍ — el anfitrión los ve igual que un cliente. */
  _relayEvent(fromId, m) {
    const g = this.game;
    switch (m.k) {
      case 'shot': {
        // el disparo de un remoto: efectos aquí + ruido para los zombis
        g.tracers.push({ x1: m.x, y1: m.y, x2: m.x2, y2: m.y2, t: 0, life: 0.09 });
        g.flashes.push({ x: m.x, y: m.y, a: m.a, t: 0, life: 0.07, big: !!m.big });
        g.noise.emit(m.x, m.y, m.r || 300, 'disparo');
        break;
      }
      case 'scream': break;   // el chillido nace SOLO en el anfitrión
      default: {
        // pdown / previve / pdead / chat / pleave…: mismo tratamiento que
        // en un cliente (efectos locales + toasts)
        this._onEvent({ t: 'ev', k: m.k, ...m });
        break;
      }
    }
    // re-difusión a todos MENOS al originador
    for (const e of this._peers.values()) {
      if (!e.id || e.id === fromId) continue;
      this._send(e.ctl, { t: 'ev', k: m.k, ...m });
    }
  }

  // ================== EVENTOS → TODAS LAS MÁQUINAS ==================

  _onEvent(m) {
    const g = this.game;
    const k = m.k;
    switch (k) {
      case 'searched': {
        const c = this._findLoot(m.key);
        if (c && !c.searched) { c.searched = true; if (this.isHost) g.searchedCount++; }
        break;
      }
      case 'lootDel': {
        const c = this._findLoot(m.key);
        if (c && Array.isArray(c.items) && m.i >= 0 && m.i < c.items.length) c.items.splice(m.i, 1);
        break;
      }
      case 'lootAdd': {
        const c = this._findLoot(m.key);
        const it = itemFromData(m.it);
        if (c && it && Array.isArray(c.items)) c.items.push(it);
        break;
      }
      case 'giAdd': {
        if (this._giByNid.has(m.n)) break;
        const it = itemFromData(m.it);
        if (it) {
          const gi = { x: m.x, y: m.y, z: m.z || 0, item: it, nid: m.n, visibleNow: false };
          g.groundItems.push(gi);
          this._giByNid.set(m.n, gi);
        }
        break;
      }
      case 'giDel': {
        const gi = this._giByNid.get(m.n) || g.groundItems.find((x) => x.nid === m.n);
        if (gi) {
          const i = g.groundItems.indexOf(gi);
          if (i >= 0) g.groundItems.splice(i, 1);
          this._giByNid.delete(m.n);
        }
        break;
      }
      case 'door': {
        g.map.setTile(m.tx, m.ty, m.open ? T.DOOR_OPEN : T.DOOR_CLOSED);
        break;
      }
      case 'zkill': {
        // la muerte la dicta el anfitrión: cadáver, sonido y cuenta
        const z = this._zByNid.get(m.n) || g.zombies.find((zz) => zz.nid === m.n);
        if (z) {
          const i = g.zombies.indexOf(z);
          if (i >= 0) g.zombies.splice(i, 1);
          this._zByNid.delete(m.n);
          const scale = m.va === 'b' ? 1.4 : m.va === 'r' ? 0.85 : 1;
          g.map.stampCorpse(m.x, m.y, m.fa || 0, scale);
          g.map.stampBlood(m.x, m.y, true);
          const d = Math.hypot(m.x - g.player.x, m.y - g.player.y);
          if (d < 900) { g.audio.groan(0.7 * (1 - d / 900), 0, 1); g.cam.shake(2); }
          if (m.by === this.myId) { g.kills++; }
        }
        break;
      }
      case 'shot': {
        // disparo de OTRO jugador: efectos locales posicionales
        g.tracers.push({ x1: m.x, y1: m.y, x2: m.x2, y2: m.y2, t: 0, life: 0.09 });
        g.flashes.push({ x: m.x, y: m.y, a: m.a, t: 0, life: 0.07, big: !!m.big });
        const d = Math.hypot(m.x - g.player.x, m.y - g.player.y);
        if (d < 1400) {
          g.audio.shoot && g.audio.shoot(1 - d / 1400, 0, !!m.big);
          g.cam.shake(Math.max(0, 3 - d / 300));
        }
        g.noise.emit(m.x, m.y, m.r || 300, 'disparo');   // anillo visual local
        break;
      }
      case 'scream': {
        const d = Math.hypot(m.x - g.player.x, m.y - g.player.y);
        if (d < 1200) {
          g.audio.scream && g.audio.scream(1 - d / 1200, 0);
          g.toasts.push('¡Un GRITADOR ha chillado cerca!', 'bad');
          g.cam.shake(4);
        }
        break;
      }
      case 'pleave': {
        const r = this.remotes.get(m.id);
        if (r) {
          if (r.p.inCar) { try { exitCar(g, true, r.p); } catch (e) {} }
          this.remotes.delete(m.id);
          g.toasts.push(m.name + ' se ha desconectado', 'warn');
        }
        break;
      }
      // ---- v0.28: CAÍDA (inconsciente, reanimable) ----
      case 'pdown': {
        const r = this.remotes.get(m.id);
        if (r) {
          r.p.mpDown = true;
          r.p.mpDownT = m.dw !== undefined ? m.dw : NET.reviveWindow;
          r.p.mpDead = false;
          r.alive = true;
          if (m.x !== undefined && m.y !== undefined) {
            r.p.x = m.x; r.p.y = m.y; r.p._tx = m.x; r.p._ty = m.y;
          }
          g.toasts.push(m.name + ' HA CAÍDO — ¡REVÍVALO! ([E] junto a él, con ' +
            NET.reviveNeedVendas + ' vendas o ' + NET.reviveNeedBotiquin + ' botiquín) · ' +
            Math.ceil(r.p.mpDownT) + ' s', 'bad');
          if (g.chat) g.chat.pushSys(m.name + ' ha caído — se puede reanimar (' + Math.ceil(r.p.mpDownT) + ' s)');
          g.audio.groan(1, 0, 0.8);
          g.cam.shake(3);
        }
        break;
      }
      // ---- v0.28: REANIMADO — segunda oportunidad ----
      case 'previve': {
        // ¿reaniman a ESTE jugador? SU máquina aplica la reanimación (la
        // vida y la ventana de reanimación son locales) — sin esta rama el
        // caído no se enteraría y acabaría muriendo a pesar de salvado
        if (m.id === this.myId) {
          const byR = this.roster.find((x) => x.id === m.by);
          if (g.mpRevived) g.mpRevived(byR ? byR.name : null);
          break;
        }
        const r = this.remotes.get(m.id);
        if (r) {
          r.p.mpDown = false;
          r.p.mpDownT = 0;
          r.hp = NET.reviveHp;
          const byName = m.by || this.hostId;
          const byR = this.remotes.get(byName);
          g.toasts.push((byR ? byR.name : 'ALGUIEN') + ' ha REANIMADO a ' + r.name, 'save');
          if (g.chat) g.chat.pushSys((byR ? byR.name : 'alguien') + ' reanimó a ' + r.name);
        }
        break;
      }
      // ---- v0.28: alta tardía (miembro que entra al mundo en marcha) ----
      case 'pjoin': {
        if (this.remotes.has(m.id)) break;
        if (!this.roster.some((x) => x.id === m.id)) {
          this.roster.push({ id: m.id, name: m.name, prof: m.prof || null, color: m.color || '#e5484d' });
        }
        const p = new Player(m.x || 0, m.y || 0);
        p.mpColor = m.color; p.mpName = m.name; p.prof = m.prof || null; p.mpId = m.id;
        this.remotes.set(m.id, {
          p, name: m.name, prof: m.prof || null, color: m.color || '#e5484d',
          alive: true, hp: 100, rtt: null, carIdx: -1, swing: 0,
          tx: m.x || 0, ty: m.y || 0, tAng: 0,
        });
        g.toasts.push(m.name + ' se une al mundo', 'info');
        if (g.chat) g.chat.pushSys(m.name + ' se ha unido');
        break;
      }
      // ---- v0.28: CHAT de sala ----
      case 'chat': {
        const mine = m.id === this.myId;
        const r = this.remotes.get(m.id);
        const name = mine ? 'TÚ' : (r ? r.name : 'ALGUIEN');
        const color = mine ? '#8ac0e8' : (r ? r.color : '#a8aba0');
        if (g.chat) g.chat.push(name, color, m.txt);
        break;
      }
      case 'pdead': {
        const r = this.remotes.get(m.id);
        if (r) {
          r.alive = false;
          r.p.mpDead = true;
          r.p.mpDown = false;
          const bx = m.x !== undefined ? m.x : r.p.x;
          const by2 = m.y !== undefined ? m.y : r.p.y;
          g.map.stampCorpse(bx, by2, r.p.angle);
          g.map.stampBlood(bx, by2, true);
          // v0.28: su CUERPO queda registrado — se puede SAQUEAR
          if (m.bd && Array.isArray(m.its)) {
            g.mpBodies = g.mpBodies || [];
            g.mpBodies.push({
              nid: m.bd, mpBodyNid: m.bd,
              name: r.name, color: r.color,
              x: bx, y: by2, z: r.p.z || 0,
              searched: false,
              items: m.its.map(itemFromData).filter(Boolean),
            });
          }
          g.toasts.push(m.name + ' HA CAÍDO — su cuerpo queda en el sitio: se puede registrar', 'bad');
          if (g.chat) g.chat.pushSys(m.name + ' ha muerto');
          g.audio.groan(1, 0, 0.8);
        }
        break;
      }
      case 'carIn': {
        const car = g.map.cars[m.i];
        const r = m.who ? this.remotes.get(m.who) : null;
        if (car && r) {
          // v0.28: asiento — conductor o pasajero (enterCar lo resuelve)
          enterCar(g, car, true, r.p, !!m.ps);
          car.running = !!m.r && carCanStart(car);
        }
        break;
      }
      case 'carOut': {
        // v0.28: se baja SOLO quien lo pidió (el coche sigue con su gente)
        const car = g.map.cars[m.i];
        const r = m.who ? this.remotes.get(m.who) : null;
        if (car && r && r.p.inCar === car) {
          exitCar(g, true, r.p);
          if (m.x !== undefined) { r.p.x = m.x; r.p.y = m.y; r.p._tx = m.x; r.p._ty = m.y; }
        }
        break;
      }
      case 'carMod': {
        const car = g.map.cars[m.i];
        if (car) {
          if (m.f !== undefined) car.fuel = m.f;
          if (m.e !== undefined) car.engineHp = m.e;
          if (m.p) car.parts = { ...car.parts, ...m.p };
        }
        break;
      }
      case 'carHp': {
        const car = g.map.cars[m.i];
        if (car) car.engineHp = m.hp;
        break;
      }
      case 'molotov': {
        if (this.onRemoteMolotov) this.onRemoteMolotov(m);
        break;
      }
      case 'cons': {
        if (this.onRemoteCons && !this.isHost) this.onRemoteCons(m.data);
        break;
      }
      case 'consHp': {
        if (this.onRemoteConsHp && !this.isHost) this.onRemoteConsHp(m.n, m.hp);
        break;
      }
      case 'consWt': {
        if (this.onRemoteConsWt && !this.isHost) this.onRemoteConsWt(m.n, m.wt);
        break;
      }
      case 'consDel': {
        if (this.onRemoteConsDel && !this.isHost) this.onRemoteConsDel(m.n);
        break;
      }
    }
  }

  /** Cliente: llegó el botín autoritativo del anfitrión. */
  _applyLoot(m) {
    const c = this._findLoot(m.key);
    if (!c) return;
    if (!c.searched) { c.searched = true; this.game.searchedCount++; }
    if (Array.isArray(m.items)) {
      c.items = m.items.map(itemFromData).filter(Boolean);
    }
    if (this.onLootOpen) this.onLootOpen(c);
  }

  /** Cliente: el anfitrión confirma la mordida contra TI. */
  _applyRemoteBite(m) {
    const g = this.game;
    const p = g.player;
    if (p.mpDead) return;
    // ¿al volante? la chapa recibe (autoridad del piloto)
    if (p.inCar) {
      p.inCar.engineHp = Math.max(0, p.inCar.engineHp - m.d * 0.4);
      g.audio.hitWood();
      g.cam.shake(2);
      if (p.inCar.engineHp <= 0) g.toasts.push('¡La horda ha MATADO el motor!', 'bad');
      return;
    }
    const reduced = m.d * (1 - p.damageReduction());
    const wasBite = g.survival.zombieHit(reduced, g);
    p.hurtFlash = 0.4;
    const a = Math.atan2(p.y - m.y, p.x - m.x);
    const shove = m.va === 'brute' ? 14 : 7;
    g.map.moveCircle(p, Math.cos(a) * shove, Math.sin(a) * shove);
    if (wasBite) g.cam.shake(7);
    else if (m.va === 'brute') g.cam.shake(5);
  }

  /** Cliente: otro jugador recogió antes el objeto → se repone en el suelo. */
  _rollbackPick(m) {
    const g = this.game;
    // el objeto ya se añadió a la mochila: se descuenta si se puede
    const it = g.player.inventory.slots.find((x) => x && x.mpPick === m.n);
    if (it) {
      it.count--;
      if (it.count <= 0) {
        const i = g.player.inventory.slots.indexOf(it);
        if (i >= 0) g.player.inventory.slots[i] = null;
      }
      delete it.mpPick;
    }
    g.toasts.push('Alguien se te adelantó con ese objeto', 'warn');
  }

  // ================== utilidades de sesión ==================

  /** Lista de jugadores para el HUD (nombre, color, vida, latencia). */
  hudRows() {
    const g = this.game;
    const rows = [];
    for (const r of this.roster) {
      const isMe = r.id === this.myId;
      let hp = 100;
      let down = 0;
      if (isMe) {
        hp = g.survival ? Math.round(g.survival.health) : 100;
        down = g.player && g.player.mpDown ? Math.ceil(g.player.mpDownT) : 0;
      } else {
        const rr = this.remotes.get(r.id);
        if (rr) {
          hp = Math.round(rr.hp);
          down = rr.p.mpDown ? Math.ceil(rr.p.mpDownT) : 0;
        }
      }
      rows.push({
        name: r.name, color: r.color, hp, down,
        me: isMe,
        dead: isMe ? !!g.player.mpDead : !(this.remotes.get(r.id) || {}).alive,
        rtt: isMe ? this.rtt : ((this.remotes.get(r.id) || {}).rtt ?? null),
        host: r.id === (this.hostId || 'H'),
      });
    }
    return rows;
  }

  /** Siguiente nid de objeto suelto (rango por jugador: sin colisiones). */
  nextGiNid() {
    const base = this.isHost ? 0 : (this._playerIndex() + 1) * 1000000;
    return base + (++this._giNid);
  }
  nextCoNid() {
    const base = this.isHost ? 0 : (this._playerIndex() + 1) * 1000000;
    return base + (++this._coNid);
  }
  _playerIndex() {
    return Math.max(0, this.roster.findIndex((r) => r.id === this.myId));
  }

  /** Jugadores vivos como objetivos de la IA (anfitrión). */
  playerTargets() { return this._targetsForSync(); }
}

// ================== Envoltorios de integración ==================

/**
 * Cliente: el ruido local se ENCOLA para el anfitrión además de sonar aquí.
 * Se instala en mpStart sobre game.noise.emit (envuelve, no sustituye).
 */
export function wrapNoiseForNet(game) {
  const n = game.net;
  if (!n || n.isHost) return;
  const orig = game.noise.emit.bind(game.noise);
  game.noise.emit = (x, y, r, kind) => {
    orig(x, y, r, kind);
    if (r >= 30) n.queueNoise(x, y, r);   // los pasos tenues no cruzan la red
  };
}

/** ¿Esta máquina manda en la simulación del mundo? */
export function isAuthority(game) {
  return !game.net || game.net.isHost;
}
