/**
 * menus.js — Pantallas de título, pausa y muerte + RANURAS DE PARTIDA.
 *
 * v0.22 — TRES RANURAS: el menú principal ya no tiene un único botón
 * CONTINUAR: muestra tres tarjetas de ranura independientes. Una ranura
 * vacía ofrece NUEVA PARTIDA; una ocupada muestra su resumen (día, hora,
 * bajas, tiempo) con CONTINUAR y ELIMINAR. El borrado pide CONFIRMACIÓN
 * en dos pasos (el botón se arma en rojo «¿SEGURO?» durante 4 s) para
 * evitar el borrado accidental — sin diálogos nativos del navegador.
 *
 * La muerte sigue siendo definitiva, pero solo borra LA RANURA con la que
 * se jugaba; REINTENTAR arranca partida nueva en esa misma ranura y ENTER
 * continúa la partida más reciente.
 *
 * v0.24 — PROFESIONES: toda partida NUEVA pasa primero por la pantalla de
 * selección (QUIÉN ERAS): cinco profesiones con bonificación pasiva que se
 * elige UNA vez y no se puede cambiar. El menú de ranuras muestra la
 * profesión de cada guardado; la pausa y el obituario también.
 */

import { fmtTime } from '../utils.js';
import { listSlots, clearSave, SAVE_SLOTS, getRecords } from '../systems/save.js';
import { PROFESSIONS, PROF_BY_ID, NET } from '../config.js';
import { NetSession, normCode } from '../systems/net.js';
import {
  createServer, joinServerEntry, getServer, listServers, forgetServer,
  loadSnapshot, normServerCode, serverSummary,
} from '../systems/servers.js';

const DEATH_TEXT = {
  zombi: 'Los zombis te destrozaron en la calle.',
  hambre: 'Tu estómago vació lo que quedaba de ti. Moriste de hambre.',
  sed: 'La deshidratación cerró tus ojos para siempre.',
  infeccion: 'La infección completó su trabajo. Te has convertido en uno de ellos.',
  intoxicacion: 'Una comida podrida acabó con tu supervivencia.',
  quemadura: 'Las llamas que encendiste te reclamaron. Moriste calcinado.',   // v0.23
};

const HINT_DEFAULT = 'Tres ranuras independientes · la muerte borra SOLO la ranura con la que jugabas · autoguardado cada 5 min';

/** v0.23: metros recorridos (1 tile = 1 m) con formato español. */
function fmtDist(px) {
  const m = px / 32;
  return m >= 1000
    ? (m / 1000).toFixed(1).replace('.', ',') + ' km'
    : Math.round(m) + ' m';
}

/** v0.28: «hace 5 min / 3 h / 2 días» — antigüedad de la última
 *  sincronización de un mundo de servidor (lista MIS MUNDOS). */
function fmtAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'hace un momento';
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
  return 'hace ' + Math.round(s / 86400) + (s < 172800 ? ' día' : ' días');
}

export class Menus {
  constructor(game) {
    this.game = game;
    this.menuEl = document.getElementById('menu');
    this.deathEl = document.getElementById('deathscreen');
    this.pauseEl = document.getElementById('pausescreen');
    this.saveGoneEl = document.getElementById('death-savegone');
    this.slotsList = document.getElementById('slots-list');
    this.slotsHint = document.querySelector('.slots-hint');

    // confirmación de borrado en 2 pasos (botón armado + auto-desarme)
    this._delArm = null;
    this._delTimer = 0;

    // v0.24: pantalla de SELECCIÓN DE PROFESIÓN (toda partida nueva pasa
    // por aquí: NUEVA PARTIDA, REINTENTAR tras la muerte, ENTER sin ranuras)
    this.profEl = document.getElementById('profscreen');
    this._profSlot = 1;      // ranura en espera de profesión
    this._profSel = null;    // profesión elegida (aún sin arrancar)
    this._bindProfScreen();

    // reintento de la muerte → MISMA ranura (su guardado ya se borró);
    // v0.24: es partida NUEVA → pasa por la selección de profesión
    document.getElementById('btn-retry').addEventListener('click', () => this.showProfSelect(game.saveSlot));
    document.getElementById('btn-resume').addEventListener('click', () => game.togglePause());
    const saveQuit = document.getElementById('btn-savequit');
    if (saveQuit) saveQuit.addEventListener('click', () => {
      // v0.27: en multijugador el botón de la pausa es SALIR DE LA SALA
      if (game.net) game.toMenu();
      else game.saveAndQuit();
    });

    // v0.27: MULTIJUGADOR — paneles de sala (crear / unirse / lobby)
    this.mpEl = document.getElementById('mpscreen');
    this.mpLobbyEl = document.getElementById('mp-lobby');
    this._profMode = 'run';   // 'run' (partida local) | 'mp' (sala co-op)
    this._bindMpScreens();

    // botón del menú principal + aviso de sala cerrada
    const btnMP = document.getElementById('btn-mp');
    if (btnMP) btnMP.addEventListener('click', () => this.showMP());
    const btnOk = document.getElementById('btn-mpnotice-ok');
    if (btnOk) btnOk.addEventListener('click', () => {
      const el = document.getElementById('mp-notice');
      if (el) el.classList.add('hidden');
      this.showMenu();
    });
  }

  // ================== v0.27: MULTIJUGADOR ==================

  _bindMpScreens() {
    const g = this.game;
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('btn-mp-back', () => this.showMenu());
    on('btn-mp-create', () => this._mpCreate());
    on('btn-mp-join', () => this._mpJoin());
    on('btn-mplobby-back', () => this._mpLeave());
    on('btn-mplobby-prof', () => this.showProfSelect(1, 'mp'));
    on('btn-mplobby-start', () => this._mpHostStart());
    // ENTER en el campo de código = UNIRSE
    const codeIn = document.getElementById('mp-code');
    if (codeIn) {
      codeIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._mpJoin();
        // v0.28: ESC cierra aunque el foco esté DENTRO del campo (antes el
        // stopPropagation se lo quedaba y el menú no se cerraba)
        else if (e.key === 'Escape') { e.preventDefault(); this._mpEscape(); }
        e.stopPropagation();
      });
      codeIn.addEventListener('input', () => {
        codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NET.codeLen);
      });
    }
    const nameIn = document.getElementById('mp-name');
    if (nameIn) {
      nameIn.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this._mpEscape(); }
        e.stopPropagation();
      });
      nameIn.addEventListener('input', () => {
        nameIn.value = nameIn.value.toUpperCase().slice(0, 12);
      });
    }
    // ---- v0.28: SERVIDORES persistentes ----
    on('btn-mp-tab-salas', () => this._mpTab('salas'));
    on('btn-mp-tab-srv', () => this._mpTab('srv'));
    on('btn-srv-create', () => this._srvCreate());
    on('btn-srv-join', () => this._srvJoin());
    on('btn-srv-refresh', () => this._srvRenderList());
    const srvCodeIn = document.getElementById('srv-code');
    if (srvCodeIn) {
      srvCodeIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._srvJoin();
        else if (e.key === 'Escape') { e.preventDefault(); this._mpEscape(); }
        e.stopPropagation();
      });
      srvCodeIn.addEventListener('input', () => {
        srvCodeIn.value = srvCodeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NET.srvCodeLen);
      });
    }
    const srvPassIn = document.getElementById('srv-pass');
    if (srvPassIn) {
      srvPassIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._srvJoin();
        else if (e.key === 'Escape') { e.preventDefault(); this._mpEscape(); }
        e.stopPropagation();
      });
      srvPassIn.addEventListener('input', () => {
        srvPassIn.value = srvPassIn.value.replace(/[^0-9]/g, '').slice(0, NET.srvPassLen);
      });
    }
    const srvNameIn = document.getElementById('srv-newname');
    if (srvNameIn) {
      srvNameIn.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this._mpEscape(); }
        e.stopPropagation();
      });
    }
  }

  /** v0.28: ESC en los paneles de multijugador — un único camino para
   *  todo: aviso → lobby (sale de la sala) → panel → menú principal. */
  _mpEscape() {
    const noteEl = document.getElementById('mp-notice');
    if (noteEl && !noteEl.classList.contains('hidden')) {
      noteEl.classList.add('hidden');
      this.showMenu();
      return;
    }
    if (this.profOpen) { this.hideProfSelect(); return; }   // vuelve al lobby
    if (this.mpLobbyEl && !this.mpLobbyEl.classList.contains('hidden')) {
      this._mpLeave();
      return;
    }
    if (this.mpEl && !this.mpEl.classList.contains('hidden')) {
      this.showMenu();
      return;
    }
    this.showMenu();
  }

  /** Panel de entrada del multijugador (nombre, crear sala, unirse). */
  showMP() {
    this.hideAll();
    if (this.mpEl) {
      const nameIn = document.getElementById('mp-name');
      if (nameIn && !nameIn.value) {
        nameIn.value = 'SOBREV-' + (1 + Math.floor(Math.random() * 89));
      }
      const hint = document.getElementById('mp-hint');
      if (hint) {
        hint.textContent = 'SALA: el anfitrión crea y comparte su CÓDIGO — hasta ' +
          NET.maxPlayers + ' sobrevivientes, conexión DIRECTA entre navegadores (P2P). SERVIDOR: un MUNDO con contraseña que NO se apaga cuando su creador se va.';
      }
      this.mpEl.classList.remove('hidden');
      this._mpTab('salas');
      this._srvRenderList();
    }
  }

  /** v0.28: pestaña del panel MP: 'salas' (efímeras) | 'srv' (mundos). */
  _mpTab(which) {
    const tabSalas = document.getElementById('btn-mp-tab-salas');
    const tabSrv = document.getElementById('btn-mp-tab-srv');
    const boxSalas = document.getElementById('mp-tab-salas');
    const boxSrv = document.getElementById('mp-tab-srv');
    const isSrv = which === 'srv';
    if (tabSalas) tabSalas.classList.toggle('sel', !isSrv);
    if (tabSrv) tabSrv.classList.toggle('sel', isSrv);
    if (boxSalas) boxSalas.classList.toggle('hidden', isSrv);
    if (boxSrv) boxSrv.classList.toggle('hidden', !isSrv);
    if (isSrv) this._srvRenderList();
  }

  /** Anfitrión: crea la sala (peer con id «zc27-CÓDIGO»). */
  _mpCreate() {
    const g = this.game;
    if (g.net) return;
    const btn = document.getElementById('btn-mp-create');
    const hint = document.getElementById('mp-hint');
    if (btn) { btn.disabled = true; btn.textContent = 'CREANDO SALA…'; }
    if (hint) hint.textContent = 'Registrando la sala en el servidor de PeerJS…';
    const name = (document.getElementById('mp-name') || {}).value || 'ANFITRIÓN';
    g.net = new NetSession(g, 'host');
    g.net.onLobby = () => this._mpRenderLobby();   // el lobby del anfitrión refresca solo
    g.net.hostLobby(name).then(() => {
      this._mpShowLobby(true);
    }).catch((err) => {
      g.net = null;
      if (btn) { btn.disabled = false; btn.textContent = 'CREAR SALA'; }
      if (hint) hint.textContent = '✗ ' + (err && err.message ? err.message : 'Error de red');
    });
  }

  /** Cliente: se une con el código tecleado. */
  _mpJoin() {
    const g = this.game;
    if (g.net) return;
    const code = normCode((document.getElementById('mp-code') || {}).value || '');
    const hint = document.getElementById('mp-hint');
    if (!code) {
      if (hint) hint.textContent = '✗ El código tiene ' + NET.codeLen + ' letras/números (sin la O ni la I)';
      return;
    }
    const btn = document.getElementById('btn-mp-join');
    if (btn) { btn.disabled = true; btn.textContent = 'CONECTANDO…'; }
    if (hint) hint.textContent = 'Buscando la sala ' + code + '…';
    const name = (document.getElementById('mp-name') || {}).value || 'SOBREVIVIENTE';
    g.net = new NetSession(g, 'client');
    g.net.onLocalStart = (init) => g.mpStartClient(init);   // el 'start' puede llegar ya
    g.net.onWelcome = () => this._mpShowLobby(false);
    g.net.onLobby = () => this._mpRenderLobby();
    g.net.onSessionEnd = () => {
      if (hint) hint.textContent = '✗ El anfitrión cerró la sala antes de empezar';
      if (btn) { btn.disabled = false; btn.textContent = 'UNIRSE'; }
    };
    g.net.joinLobby(code, name).catch((err) => {
      g.net = null;
      if (btn) { btn.disabled = false; btn.textContent = 'UNIRSE CON CÓDIGO'; }
      if (hint) hint.textContent = '✗ ' + (err && err.message ? err.message : 'Error de red');
    });
  }

  /** v0.28: SERVIDOR — CREA un mundo nuevo: código de 6 + contraseña de
   *  4 dígitos (que se muestran GRANDE para compartirlas) y directo al
   *  lobby como anfitrión del mundo. */
  _srvCreate() {
    const g = this.game;
    if (g.net) return;
    const nameIn = document.getElementById('srv-newname');
    const worldName = (nameIn && nameIn.value.trim()) || 'MUNDO ' + Math.floor(Math.random() * 900 + 100);
    const entry = createServer(worldName);
    const hint = document.getElementById('srv-hint');
    if (hint) {
      hint.innerHTML = 'MUNDO CREADO — CÓDIGO: <b>' + entry.code + '</b> · CONTRASEÑA: <b>' +
        entry.pass + '</b> — compártelas con hasta 3 personas. Abriendo el mundo…';
    }
    this._srvOpen(entry);
  }

  /** v0.28: SERVIDOR — ABRE un mundo de MIS MUNDOS (te conviertes en su
   *  anfitrión de sesión: el mundo se restaura desde la última copia
   *  sincronizada de ESTE navegador). */
  _srvOpen(entry) {
    const g = this.game;
    if (g.net) return;
    const hint = document.getElementById('srv-hint');
    const btn = document.getElementById('btn-srv-create');
    const name = (document.getElementById('mp-name') || {}).value || 'ANFITRIÓN';
    const snapshot = loadSnapshot(entry.code);
    g.net = new NetSession(g, 'host', 'server');
    g.net.onLobby = () => this._mpRenderLobby();
    g.net.hostServerOpen(entry, snapshot, name).then(() => {
      this._mpShowLobby(true);
      if (hint) {
        hint.innerHTML = 'MUNDO <b>' + entry.code + '</b> ABIERTO — contraseña: <b>' + entry.pass +
          '</b>' + (snapshot ? ' · restaurado de tu última sincronización' : ' · mundo nuevo');
      }
    }).catch((err) => {
      g.net = null;
      if (btn) { btn.disabled = false; btn.textContent = 'CREAR MUNDO'; }
      if (hint) hint.textContent = '✗ ' + (err && err.message ? err.message : 'Error de red');
    });
  }

  /** v0.28: SERVIDOR — ENTRA a un mundo abierto por otro miembro (con
   *  código + contraseña). Guarda tu identidad de miembro al entrar. */
  _srvJoin() {
    const g = this.game;
    if (g.net) return;
    const code = normServerCode((document.getElementById('srv-code') || {}).value || '');
    const pass = (document.getElementById('srv-pass') || {}).value || '';
    const hint = document.getElementById('srv-hint');
    if (!code || String(pass).length !== NET.srvPassLen) {
      if (hint) hint.textContent = '✗ El mundo pide CÓDIGO de ' + NET.srvCodeLen +
        ' caracteres y CONTRASEÑA de ' + NET.srvPassLen + ' dígitos';
      return;
    }
    const btn = document.getElementById('btn-srv-join');
    if (btn) { btn.disabled = true; btn.textContent = 'CONECTANDO…'; }
    if (hint) hint.textContent = 'Buscando el mundo ' + code + '…';
    const name = (document.getElementById('mp-name') || {}).value || 'SOBREVIVIENTE';
    const entry = joinServerEntry(code, pass);
    g.net = new NetSession(g, 'client', 'server');
    g.net.onLocalStart = (init) => g.mpStartClient(init);
    g.net.onWelcome = () => this._mpShowLobby(false);
    g.net.onLobby = () => this._mpRenderLobby();
    g.net.onDenied = (err) => {
      if (hint) hint.textContent = '✗ ' + err;
      if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR AL MUNDO'; }
      g.net.leave(false);
      g.net = null;
    };
    g.net.onSessionEnd = () => {
      if (hint) hint.textContent = '✗ El mundo se cerró antes de entrar — si tienes una copia, puedes ABRIRLO tú';
      if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR AL MUNDO'; }
    };
    g.net.joinServer(code, pass, entry.memberId, name).catch((err) => {
      g.net = null;
      if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR AL MUNDO'; }
      if (hint) hint.textContent = '✗ ' + (err && err.message ? err.message : 'Error de red');
    });
  }

  /** v0.28: lista de MIS MUNDOS (abrir / entrar / olvidar). */
  _srvRenderList() {
    const listEl = document.getElementById('srv-list');
    if (!listEl) return;
    const entries = listServers();
    if (!entries.length) {
      listEl.innerHTML = '<p class="srv-empty">Aún no tienes mundos — CREA uno o entra con el código y la contraseña de un amigo.</p>';
      return;
    }
    let html = '';
    for (const e of entries) {
      const s = serverSummary(e);
      const when = s.lastSync ? 'sincronizado ' + fmtAgo(s.lastSync) : 'sin sincronizar aún';
      html += '<div class="srv-row" data-code="' + e.code + '">' +
        '<div class="srv-main">' +
          '<span class="srv-name">' + e.name + ' · ' + e.code + '</span>' +
          '<span class="srv-sum">' + (s.hasSnapshot ? 'DÍA ' + s.day + ' · ' + s.members +
            ' miembro' + (s.members === 1 ? '' : 'S') + ' · ' + when : 'mundo aún sin abrir') + '</span>' +
        '</div>' +
        '<div class="srv-actions">' +
          '<button class="slot-btn play" data-open="' + e.code + '">ABRIR</button>' +
          (getServer(e.code) ? '<button class="slot-btn del" data-forget="' + e.code + '">OLVIDAR</button>' : '') +
        '</div>' +
      '</div>';
    }
    listEl.innerHTML = html;
    for (const b of listEl.querySelectorAll('[data-open]')) {
      b.addEventListener('click', () => {
        const entry = getServer(b.dataset.open);
        if (entry) this._srvOpen(entry);
      });
    }
    for (const b of listEl.querySelectorAll('[data-forget]')) {
      b.addEventListener('click', () => this._srvForget(b));
    }
  }

  /** Olvidar un mundo (confirmación en dos pasos como las ranuras). */
  _srvForget(btn) {
    if (!btn.classList.contains('armed')) {
      this._disarmSrvForget();
      btn.classList.add('armed');
      btn.textContent = '¿SEGURO?';
      this._srvForgetT = setTimeout(() => this._disarmSrvForget(), 4000);
      return;
    }
    forgetServer(btn.dataset.forget);
    this._disarmSrvForget();
    this._srvRenderList();
  }
  _disarmSrvForget() {
    if (this._srvForgetT) { clearTimeout(this._srvForgetT); this._srvForgetT = 0; }
    const el = document.querySelector('#srv-list [data-forget].armed');
    if (el) { el.classList.remove('armed'); el.textContent = 'OLVIDAR'; }
  }

  /** Lobby de la sala: código grande + plantel + botones por rol. */
  _mpShowLobby(isHost) {
    if (this.mpEl) this.mpEl.classList.add('hidden');
    if (!this.mpLobbyEl) return;
    this.mpLobbyEl.classList.remove('hidden');
    this.mpLobbyEl.dataset.host = isHost ? '1' : '0';
    const codeEl = document.getElementById('mplobby-code');
    if (codeEl && this.game.net) {
      codeEl.textContent = (this.game.net.mode === 'server' ? 'MUNDO ' : 'SALA ') + this.game.net.code;
    }
    const sub = document.getElementById('mplobby-sub');
    if (sub) {
      const n = this.game.net;
      sub.textContent = n && n.mode === 'server'
        ? (isHost
            ? 'Comparte CÓDIGO + CONTRASEÑA · hasta ' + (NET.maxPlayers - 1) +
              ' miembros más · el mundo SIGUE sin ti: cualquiera puede abrirlo'
            : 'Esperando a que el ANFITRIÓN arranque el mundo…')
        : (isHost
            ? 'Comparte este código — entran hasta ' + (NET.maxPlayers - 1) + ' supervivientes más'
            : 'Esperando a que el ANFITRIÓN arranque la partida…');
    }
    this._mpRenderLobby();
  }

  /** Plantel del lobby (nombre + profesión + color de cada uno). */
  _mpRenderLobby() {
    const g = this.game;
    if (!g.net || !this.mpLobbyEl || this.mpLobbyEl.classList.contains('hidden')) return;
    const listEl = document.getElementById('mplobby-list');
    if (listEl) {
      let html = '';
      for (const r of g.net.roster) {
        const prof = r.prof && PROF_BY_ID[r.prof];
        const isMe = r.id === g.net.myId;
        html += '<div class="mpl-row' + (isMe ? ' me' : '') + '">' +
          '<span class="mpl-dot" style="background:' + r.color + '"></span>' +
          '<span class="mpl-name">' + r.name + (r.id === 'H' ? ' <i>(anfitrión)</i>' : '') +
            (isMe ? ' <i>(tú)</i>' : '') + '</span>' +
          '<span class="mpl-prof">' + (prof ? prof.name : '· sin profesión ·') + '</span>' +
          '</div>';
      }
      listEl.innerHTML = html;
    }
    // botones según rol y estado
    const profBtn = document.getElementById('btn-mplobby-prof');
    const startBtn = document.getElementById('btn-mplobby-start');
    const me = g.net.roster.find((r) => r.id === g.net.myId);
    const hasProf = !!(me && me.prof);
    if (profBtn) {
      profBtn.textContent = hasProf
        ? 'CAMBIAR PROFESIÓN: ' + PROF_BY_ID[me.prof].name.toUpperCase()
        : 'ELIGE TU PROFESIÓN';
    }
    if (startBtn) {
      const isHost = g.net.isHost;
      startBtn.classList.toggle('hidden', !isHost);
      startBtn.disabled = !hasProf;
      startBtn.textContent = hasProf
        ? 'EMPEZAR LA PARTIDA — ' + g.net.roster.length + ' SOBREVIVIENTE' + (g.net.roster.length === 1 ? '' : 'S')
        : 'ELIGE PROFESIÓN PARA EMPEZAR';
    }
  }

  /** El anfitrión suelta el botón de EMPEZAR: arranca la partida co-op
   *  (v0.28: en SERVIDOR, la apertura restaurable del mundo). */
  _mpHostStart() {
    const g = this.game;
    if (!g.net || !g.net.isHost) return;
    const me = g.net.roster.find((r) => r.id === g.net.myId);
    if (!me || !me.prof) return;
    this.hideAll();
    if (g.net.mode === 'server') g.mpServerRun();
    else g.mpHostRun();
  }

  /** Sale del lobby (cierra su sala o se desconecta de la ajena). */
  _mpLeave() {
    const g = this.game;
    if (g.net) { g.net.leave(false); g.net = null; }
    this.showMenu();
  }

  /** Aviso flotante al volver de una sesión co-op. */
  showMpNotice(txt) {
    const el = document.getElementById('mp-notice');
    if (!el) { this.showMenu(); return; }
    const txtEl = document.getElementById('mp-notice-txt');
    if (txtEl) txtEl.textContent = txt;
    el.classList.remove('hidden');
  }

  // ================== v0.24: selección de profesión ==================

  /** ¿La pantalla de elección de profesión está abierta? */
  get profOpen() { return !!this.profEl && !this.profEl.classList.contains('hidden'); }

  _bindProfScreen() {
    const back = document.getElementById('btn-prof-back');
    if (back) back.addEventListener('click', () => this.hideProfSelect());
    const start = document.getElementById('btn-prof-start');
    if (start) start.addEventListener('click', () => this.confirmProf());
  }

  /** Abre la selección de profesión para crear partida nueva en `slot`.
   * v0.27: `mode='mp'` la abre para una SALA co-op (CONFIRMAR vuelve al
   * lobby en vez de arrancar la partida). */
  showProfSelect(slot, mode = 'run') {
    if (!this.profEl) { this.game.startRun(slot || 1, null); return; }   // red de seguridad
    this._profMode = mode;
    this._profSlot = Math.min(3, Math.max(1, slot || 1));
    this._profSel = null;
    const sub = document.getElementById('prof-sub');
    if (sub) sub.textContent = mode === 'mp'
      ? 'SALA CO-OP · quién eras antes del apocalipsis — se elige UNA vez y NO se puede cambiar'
      : 'RANURA ' + this._profSlot +
        ' · quién eras antes del apocalipsis — se elige UNA vez y NO se puede cambiar';
    this._renderProfCards();
    this.profEl.classList.remove('hidden');
  }

  /** Tarjetas de las 5 profesiones (desde config: si el balance cambia,
   *  la pantalla se actualiza sola, como la enciclopedia). */
  _renderProfCards() {
    const list = document.getElementById('prof-list');
    if (!list) return;
    let html = '';
    for (const pr of PROFESSIONS) {
      html += '' +
        '<div class="prof-card" data-prof="' + pr.id + '" style="border-left-color:' + pr.color + '">' +
          '<div class="pc-head">' +
            '<span class="pc-icon" style="background:' + pr.color + '"></span>' +
            '<span class="pc-name">' + pr.name + '</span>' +
          '</div>' +
          '<p class="pc-tag">' + pr.tagline + '</p>' +
          '<p class="pc-desc">' + pr.desc + '</p>' +
          '<div class="pc-perks">' +
            pr.perks.map((p) => '<span class="ec-chip' + (pr.id === 'desempleado' ? '' : ' ok') + '">' + p + '</span>').join('') +
          '</div>' +
        '</div>';
    }
    list.innerHTML = html;
    for (const el of list.querySelectorAll('.prof-card')) {
      el.addEventListener('click', () => this._pickProf(el.dataset.prof));
    }
    const start = document.getElementById('btn-prof-start');
    if (start) {
      start.disabled = true;
      start.textContent = this._profMode === 'mp' ? 'LISTO — VOLVER A LA SALA' : 'COMENZAR LA PARTIDA';
    }
    const hint = document.getElementById('prof-hint');
    if (hint) hint.textContent =
      'Elige quién eras para ver su bonificación — ENTER (o COMENZAR) arranca la partida.';
  }

  /** Marca una tarjeta como elegida y arma el botón de COMENZAR. */
  _pickProf(id) {
    this._profSel = id;
    const list = document.getElementById('prof-list');
    if (list) for (const el of list.querySelectorAll('.prof-card')) {
      el.classList.toggle('sel', el.dataset.prof === id);
    }
    const d = PROF_BY_ID[id];
    const start = document.getElementById('btn-prof-start');
    if (start) {
      start.disabled = false;
      start.textContent = (this._profMode === 'mp' ? 'LISTO — ' : 'COMENZAR COMO ') + d.name.toUpperCase();
    }
    const hint = document.getElementById('prof-hint');
    if (hint) hint.textContent = d.name + ' — ' + d.perks[0] +
      '. La bonificación es pasiva y para TODA la partida: no se puede cambiar.';
  }

  /** ENTER / COMENZAR: arranca la partida nueva con la profesión elegida.
   *  v0.27: en modo SALA co-op la elección se registra y se vuelve al lobby. */
  confirmProf() {
    if (!this.profOpen || !this._profSel) return;
    const prof = this._profSel;
    if (this._profMode === 'mp') {
      this.hideProfSelect();
      if (this.game.net) {
        this.game.net.setMyProf(prof);
        this._mpRenderLobby();
      }
      return;
    }
    const slot = this._profSlot;
    this.hideProfSelect();
    this.game.startRun(slot, prof);
  }

  hideProfSelect() { if (this.profEl) this.profEl.classList.add('hidden'); }

  /** v0.24: toast de arranque con el bono de la profesión elegida. */
  toastProfession(id) {
    const d = PROF_BY_ID[id];
    if (d && this.game.toasts) {
      this.game.toasts.push('Profesión: ' + d.name + ' — ' + d.perks[0], 'save');
    }
  }

  // ================== v0.22: ranuras ==================

  /** Redibuja las 3 tarjetas de ranura según los guardados actuales. */
  renderSlots() {
    if (!this.slotsList) return;
    this._disarmDelete();
    const sums = listSlots();

    let html = '';
    for (let s = 1; s <= SAVE_SLOTS; s++) {
      const sum = sums[s - 1];
      // v0.24: la ranura muestra la PROFESIÓN de esa partida (si la tenía)
      const profTxt = sum && sum.prof && PROF_BY_ID[sum.prof]
        ? PROF_BY_ID[sum.prof].name.toUpperCase() + ' · ' : '';
      const detail = sum
        ? profTxt + sum.clock + ' · ' + sum.kills + ' baja' + (sum.kills === 1 ? '' : 's') +
          ' · ' + fmtTime(sum.time) + ' sobrevividos'
        : '— vacía — aquí puede nacer una nueva partida —';
      html += '' +
        '<div class="slot-row' + (sum ? '' : ' empty') + '" data-slot="' + s + '">' +
          '<span class="slot-num">' + s + '</span>' +
          '<div class="slot-main">' +
            '<span class="slot-name">RANURA ' + s + (sum ? ' · DÍA ' + sum.day : '') + '</span>' +
            '<span class="slot-sum">' + detail + '</span>' +
          '</div>' +
          '<div class="slot-actions">' +
            '<button class="slot-btn play" data-slot="' + s + '">' +
              (sum ? 'CONTINUAR' : 'NUEVA PARTIDA') +
            '</button>' +
            (sum ? '<button class="slot-btn del" data-slot="' + s + '">ELIMINAR</button>' : '') +
          '</div>' +
        '</div>';
    }
    this.slotsList.innerHTML = html;

    // jugar: continuar si hay guardado, partida nueva (con PROFESIÓN) si está vacía
    for (const b of this.slotsList.querySelectorAll('.slot-btn.play')) {
      b.addEventListener('click', () => {
        const s = +b.dataset.slot;
        if (listSlots()[s - 1]) this.game.continueRun(s);
        else this.showProfSelect(s);   // v0.24: nueva partida → elige quién eras
      });
    }
    // eliminar: confirmación en dos pasos
    for (const b of this.slotsList.querySelectorAll('.slot-btn.del')) {
      b.addEventListener('click', () => this._onDelete(b));
    }
  }

  /** Primer clic: arma el botón («¿SEGURO?») 4 s. Segundo clic: borra. */
  _onDelete(btn) {
    if (btn.classList.contains('armed')) {
      const s = +btn.dataset.slot;
      clearSave(s);
      if (this.game.audio && this.game.audio.uiClick) this.game.audio.uiClick();
      if (this.slotsHint) this.slotsHint.textContent = 'Ranura ' + s + ' eliminada.';
      this.renderSlots();
      return;
    }
    this._disarmDelete();
    btn.classList.add('armed');
    btn.textContent = '¿SEGURO?';
    btn.title = 'Pulsa OTRA VEZ para eliminar esta partida';
    if (this.slotsHint) {
      this.slotsHint.textContent = '¿Eliminar la partida de la ranura ' + btn.dataset.slot +
        '? Pulsa el botón otra vez para confirmar.';
    }
    this._delArm = btn;
    this._delTimer = setTimeout(() => this._disarmDelete(), 4000);
  }

  /** Desarma la confirmación pendiente (timeout, re-render o cierre). */
  _disarmDelete() {
    if (this._delTimer) { clearTimeout(this._delTimer); this._delTimer = 0; }
    if (this._delArm) {
      this._delArm.classList.remove('armed');
      this._delArm.textContent = 'ELIMINAR';
      this._delArm.title = '';
      this._delArm = null;
    }
    if (this.slotsHint) this.slotsHint.textContent = HINT_DEFAULT;
  }

  // ================== pantallas ==================

  /** v0.23: línea de RÉCORDS acumulados bajo las ranuras del menú. */
  renderRecords() {
    const el = document.getElementById('slots-records');
    if (!el) return;
    const r = getRecords();
    el.textContent = r.runs === 0
      ? 'RÉCORDS — ninguna partida acabada todavía: tu primer obituario abrirá la cuenta'
      : 'RÉCORDS — ' + r.runs + ' partida' + (r.runs === 1 ? '' : 's') + ' · mejor: día ' +
          r.bestDay + ' · ' + r.bestKills + ' bajas · ' + fmtTime(r.bestTime) +
          ' · ' + r.totalKills + ' bajas acumuladas';
  }

  showMenu() {
    // v0.28 (bug v0.27): al VOLVER al menú se recogen TODOS los paneles de
    //  multijugador — antes quedaban encendidos ENCIMA del menú y parecía
    //  que ESC «no cerraba» el panel (reportado por el usuario)
    if (this.mpEl) this.mpEl.classList.add('hidden');
    if (this.mpLobbyEl) this.mpLobbyEl.classList.add('hidden');
    this.hideProfSelect();
    this.renderSlots();
    this.renderRecords();
    this.menuEl.classList.remove('hidden');
    this.hideDeath();
    this.hidePause();
  }

  hideMenu() { this.menuEl.classList.add('hidden'); }

  showPause() {
    this.pauseEl.classList.remove('hidden');
    // v0.24: la profesión de la partida en curso, siempre a la vista en la pausa
    const el = document.getElementById('pause-prof');
    if (el) {
      const d = this.game.player && this.game.player.prof && PROF_BY_ID[this.game.player.prof];
      el.textContent = d
        ? 'PROFESIÓN: ' + d.name.toUpperCase() + ' — ' + d.perks[0]
        : 'PROFESIÓN: — (partida sin profesión)';
    }
    // v0.27: en multijugador el botón de guardar se convierte en SALIR DE
    // LA SALA (no hay guardado co-op) y la pausa NO congela el mundo
    const sq = document.getElementById('btn-savequit');
    if (sq) {
      if (this.game.net) {
        sq.textContent = 'SALIR DE LA SALA';
        sq.title = 'Abandona la partida co-op (la sala sigue para los demás)';
      } else {
        sq.textContent = 'GUARDAR Y SALIR AL MENÚ';
        sq.title = '';
      }
    }
  }
  hidePause() { this.pauseEl.classList.add('hidden'); }

  showDeath(cause, stats, hadSave = false, records = null) {
    const el = this.deathEl;
    el.classList.remove('hidden');
    document.getElementById('death-cause').textContent = DEATH_TEXT[cause] || 'Nadie lo contará.';
    // v0.24: el obituario firma con la profesión de la partida
    const profEl = document.getElementById('ds-prof');
    if (profEl) {
      const d = stats.prof && PROF_BY_ID[stats.prof];
      profEl.textContent = d ? 'PROFESIÓN: ' + d.name.toUpperCase() + ' — ' + d.perks[0] : '';
      profEl.classList.toggle('hidden', !d);
    }
    // v0.23: OBITUARIO completo — días, tiempo, bajas, disparos,
    // construcciones y odómetro (antes: solo tiempo/bajas/registrados)
    const st = stats.stats || {};
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('ds-day', stats.day || 1);
    set('ds-time', fmtTime(stats.time));
    set('ds-kills', stats.kills);
    set('ds-shots', st.shots | 0);
    set('ds-built', st.built | 0);
    set('ds-dist', fmtDist(st.dist || 0));
    set('ds-search', stats.searched);
    // récords acumulados (los acaba de actualizar main.onDeath)
    const recEl = document.getElementById('ds-records');
    if (recEl) {
      const r = records || getRecords();
      const isNew = (stats.day || 1) >= r.bestDay && stats.kills >= r.bestKills && r.runs > 1;
      recEl.textContent = 'RÉCORDS — ' + r.runs + ' partida' + (r.runs === 1 ? '' : 's') +
        ' · mejor: día ' + r.bestDay + ' · ' + r.bestKills + ' bajas · ' + fmtTime(r.bestTime) +
        (r.totalKills ? ' · ' + r.totalKills + ' bajas acumuladas en total' : '') +
        (isNew ? ' · ¡NUEVO RÉCORD!' : '');
    }
    // v0.13/v0.22: aviso de guardado borrado (solo si esa ranura tenía uno)
    if (this.saveGoneEl) {
      this.saveGoneEl.classList.toggle('hidden', !hadSave);
      this.saveGoneEl.textContent =
        'La partida de esta ranura se ha eliminado: aquí la muerte es definitiva. Tus otras ranuras siguen a salvo.';
    }
  }

  hideDeath() { this.deathEl.classList.add('hidden'); }

  hideAll() {
    this.hideMenu();
    this.hideDeath();
    this.hidePause();
    this.hideProfSelect();   // v0.24: sin selección pendiente al esconderlo todo
    if (this.mpEl) this.mpEl.classList.add('hidden');        // v0.27: salas
    if (this.mpLobbyEl) this.mpLobbyEl.classList.add('hidden');
    this._disarmDelete();
  }
}
