/**
 * main.js — ZONA CERO · Prototipo de supervivencia zombi 2D (top-down).
 *
 * Orquestador: bucle de juego con paso fijo, máquina de estados
 * (menu/playing/paused/dead), interacción con el mundo (puertas, botín,
 * contenedores) y cableado de todos los sistemas modulares.
 */

import { TILE, T, ZOMBIE_CFG, FLOORS, DAYNIGHT, VEHICULOS, NET } from './config.js';
import { Rng } from './rng.js';
import { Input } from './core/input.js';
import { Camera } from './core/camera.js';
import { AudioFX } from './core/audio.js';
import { GameMap } from './world/map.js';
import { Vision } from './world/vision.js';
import { DayNight } from './world/daynight.js';
import { Weather } from './world/weather.js';
import { NoiseSystem } from './systems/noise.js';
import { Survival } from './systems/survival.js';
import { Inventory, makeItem, fillContainer, itemLabel, refillMagazines, setupLootItem } from './systems/inventory.js';
import { playerAttack, zombieHit, reloadRanged, finishReload } from './systems/combat.js';
import { hotbarUse, hotbarValidate } from './systems/hotbar.js';
import { toggleFlashlight, updateFlashlight } from './systems/flashlight.js';
import {
  startBuild, updateBuild, rotateBuild, cancelBuild, placeBuild,
  updateFire, updateConstructions, sleepInBed, finishSleep, CON_NAMES,
  needsRepair, repairCost, repairCostLabel, repairConstruction,
  cropPromptLabel, harvestCrop, barrilPromptLabel, barrilUse,
} from './systems/crafting.js';
import { addConstruction, removeConstruction } from './systems/crafting.js';
import {
  enterCar, exitCar, updateVehicle, updateVehicleFX, drawVehicles,
  openInspect, closeInspect, forceExit, carLabel,
} from './systems/vehicles.js';
import { saveGame, loadSaveData, hasSave, clearSave, restoreGame, latestSlot, updateRecords, AUTOSAVE_SEC, itemToData, itemFromData } from './systems/save.js';
import { NetSession, wrapNoiseForNet, isAuthority } from './systems/net.js';
import { Player } from './entities/player.js';
import { Zombie, spawnZombies } from './entities/zombie.js';
import { HUD } from './ui/hud.js';
import { Toasts } from './ui/toasts.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { Menus } from './ui/menus.js';
import { Encyclopedia } from './ui/encyclopedia.js';
import { renderGame } from './render.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' };

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    // sistemas base (siempre vivos)
    this.input = new Input();
    this.cam = new Camera();
    this.audio = new AudioFX();
    this.toasts = new Toasts();
    this.hud = new HUD(this);
    this.menus = new Menus(this);
    this.ency = new Encyclopedia(this);   // v0.22: guía (menú principal y pausa)
    this.invUI = new InventoryUI(this);
    this.noise = new NoiseSystem();
    this.vision = new Vision();
    this.daynight = new DayNight();   // ciclo día/noche (solo avanza jugando)
    this.weather = new Weather();     // v0.15: lluvia y neblina (idem: solo jugando)
    // v0.27: MULTIJUGADOR — sesión activa (null = partida clásica en local)
    this.net = null;
    this._spectate = null;       // jugador seguido tras caer (espectador)
    this._mpPaused = false;      // pausa co-op: overlay SIN congelar el mundo
    this._mpConsT = 0;           // sincronización periódica de construcciones

    this.state = STATE.MENU;
    this.uiOpen = false;
    this.zombies = [];
    this.groundItems = [];
    this.smokes = [];        // v0.26: humo de motores moribundos {x, y, t, life, r}
    this.carsUI = null;      // v0.26: ficha de inspección de coche abierta
    // v0.20: sistema de crafteo/construcción
    this.constructions = [];  // barricadas, vallas, trampas, cajas, camas, mesas
    this.build = null;        // modo construcción activo (fantasma)
    this.fires = [];          // zonas de fuego del molotov {x,y,z,r,t}
    this.molotovs = [];       // botellas en vuelo {x,y,vx,vy,t,z}
    this.sleepT = 0;          // fundido a negro mientras se duerme
    this._sleepTarget = null; // hora objetivo del sueño
    // efectos de disparo (coordenadas de mundo, decaen en update)
    this.tracers = [];   // trazadoras {x1,y1,x2,y2,t,life}
    this.flashes = [];   // fogonazos {x,y,a,t,life,big}
    this.impacts = [];   // impactos en muro {x,y,t,life}
    this.time = 0;
    this.kills = 0;
    this.searchedCount = 0;
    this.deathCause = null;
    // v0.23: OBITUARIO — contadores vivos de la partida
    this.stats = { shots: 0, molotovs: 0, crafted: 0, built: 0, dist: 0 };
    this.seedUsed = 0;        // v0.13: semilla de la partida (para el guardado)
    this.saveSlot = 1;        // v0.22: ranura de guardado de la partida en curso (1-3)
    this._autosaveT = 0;      // v0.13: cronómetro del autoguardado (5 min)
    this._seenVariants = {};  // v0.14: bestiario (toasts únicos por variante)
    this._weatherMark = 'clear';  // v0.15: para avisar de transiciones climáticas
    this._screamerCheckT = 0;     // v0.23: cronómetro del chequeo de población
    this._screamedOnce = false;   // v0.23: aviso único del primer chillido
    this._fireAlertSeen = false;  // v0.23: aviso único de la alarma del fuego

    this.input.attach(canvas, (a) => this.onAction(a));
    this._resize();
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING) this.togglePause();
    });

    this.menus.showMenu();
    this.hud.hide();

    // bucle con paso fijo
    this._last = performance.now();
    this._acc = 0;
    const STEP = 1 / 60;
    const frame = (now) => {
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this._acc += dt;
      let n = 0;
      while (this._acc >= STEP && n < 5) {
        this.update(STEP);
        this._acc -= STEP;
        n++;
      }
      if (n === 5) this._acc = 0;
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ================== v0.21: garantía del Subfusil Cuervo ==================

  /**
   * EL CUERVO ASEGURADO. El subfusil exclusivo de la base militar es la
   * recompensa señalada del riesgo de bajar al sótano-arsenal, y las tablas
   * de botín podían dejarte una partida entera SIN ninguno (bug reportado:
   * «no apareció en ningún contenedor»). Si en TODA la partida no hay ni un
   * solo Cuervo — contenedores, mochila, equipo, barra rápida, suelo o cajas
   * de almacenamiento — se coloca UNO garantizado en una armería militar,
   * prefiriendo el sótano-arsenal y una armería sin registrar.
   * El cargador se rellena con Math.random: NO consume nada del Rng con
   * semilla de la partida (la disposición del mundo queda intacta). Se
   * llama al generar el mundo y también al CARGAR (save.js), de modo que
   * los guardados viejos sin Cuervo reciben el suyo.
   * Devuelve true si inyectó uno.
   */
  _guaranteeCuervo() {
    const has = (it) => !!it && it.id === 'subfusil_cuervo';
    const anywhere =
      this.map.containers.some((c) => c.items.some(has)) ||
      this.player.inventory.slots.some(has) ||
      Object.values(this.player.equipment).some(has) ||
      (this.player.hotbar || []).some(has) ||
      this.groundItems.some((gi) => has(gi.item)) ||
      this.constructions.some((c) => c.type === 'caja' && c.items && c.items.some(has));
    if (anywhere) return false;

    // armerías militares (solo existen en la base): prefiere el sótano y sin registrar
    const arms = this.map.containers.filter((c) => c.type === 'armeria_mil');
    if (!arms.length) return false;
    const target =
      arms.find((c) => c.z === -1 && !c.searched) ||
      arms.find((c) => !c.searched) ||
      arms.find((c) => c.z === -1) ||
      arms[0];

    const it = makeItem('subfusil_cuervo');
    setupLootItem(it, {
      chance: (p) => Math.random() < p,
      int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    });
    target.items.push(it);
    return true;
  }

  // ================== v0.25: garantía del MAZO de la ferretería ==================

  /**
   * EL MAZO ASEGURADO (gemela de la garantía del Cuervo): el mazo pesado
   * es EXCLUSIVO de las estanterías de HOME & TOOLS y las tablas de botín
   * podían dejar un mundo sin ninguno. Si en TODA la partida no hay ni
   * uno — contenedores, mochila, equipo, barra rápida, suelo o cajas de
   * almacenamiento — se coloca UNO garantizado en una estantería de
   * ferretería sin registrar. Usa Math.random (no consume el Rng con
   * semilla). Se llama al generar el mundo y también al CARGAR.
   * Devuelve true si inyectó uno.
   */
  _guaranteeMazo() {
    const has = (it) => !!it && it.id === 'mazo';
    const anywhere =
      this.map.containers.some((c) => c.items.some(has)) ||
      this.player.inventory.slots.some(has) ||
      Object.values(this.player.equipment).some(has) ||
      (this.player.hotbar || []).some(has) ||
      this.groundItems.some((gi) => has(gi.item)) ||
      this.constructions.some((c) => c.type === 'caja' && c.items && c.items.some(has));
    if (anywhere) return false;

    const shelves = this.map.containers.filter((c) => c.type === 'estanteria_ferreteria');
    if (!shelves.length) return false;
    const target = shelves.find((c) => !c.searched) || shelves[0];

    const it = makeItem('mazo');
    target.items.push(it);
    return true;
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.resize(w, h);
    this.vision.resize(w, h);
  }

  // ================== Nueva partida ==================

  /**
   * v0.22: `slot` (1-3) fija la RANURA de esta partida. Si la ranura trae
   * un guardado se limpia: una partida nueva SIEMPRE parte de cero (el
   * menú solo ofrece «nueva» en ranuras vacías; esto protege llamadas
   * directas como el REINTENTAR tras la muerte, que ya borró la suya).
   * v0.24: `prof` (opcional) es el id de la PROFESIÓN elegida en la
   * pantalla de selección — se fija UNA vez al crear la partida y ya no
   * se puede cambiar. Sin prof (llamadas directas, guardados viejos)
   * la partida va SIN bonos, como toda la historia del juego.
   */
  startRun(slot, prof) {
    if (slot >= 1 && slot <= 3) {
      this.saveSlot = slot;
      clearSave(slot);   // punto de partida limpio (reemplaza al guardado)
    }
    this.audio.init();
    const seed = (Math.random() * 2147483647) | 0;
    this.seedUsed = seed;               // v0.13: para regenerar el mapa al cargar
    this.rng = new Rng(seed);
    this.map = new GameMap(this.rng);
    this.player = new Player(this.map.spawn.x, this.map.spawn.y);
    this.player.prof = prof || null;    // v0.24: la profesión viaja con el jugador
    this.survival = new Survival();
    this.noise = new NoiseSystem();
    this.vision = new Vision();
    this.daynight.reset();            // amanece a las 08:00 del día 1
    this._hourMark = Math.floor(this.daynight.hour);
    this.weather.reset();             // v0.15: cielo despejado, primer frente a 2-5 días
    this._weatherMark = this.weather.type;
    this._resize();

    // botín en todos los contenedores
    for (const c of this.map.containers) fillContainer(c, this.rng);

    // horda
    this.zombies = spawnZombies(this.map, this.rng, ZOMBIE_CFG.count, this.map.spawn);

    // objetos iniciales garantizados
    this.groundItems = [];
    this._placeStartingLoot();

    // v0.20: mundo limpio de crafteo (construcciones, fuego, fantasma)
    this.constructions = [];
    this.build = null;
    this.fires = [];
    this.molotovs = [];
    this.sleepT = 0;
    this._sleepTarget = null;
    this.smokes = [];       // v0.26: sin humo de motores
    this.carsUI = null;

    // v0.21: garantía del Subfusil Cuervo (arma exclusiva de la base militar)
    // — DESPUÉS de limpiar el mundo, para no ver restos de la partida anterior
    this._guaranteeCuervo();
    // v0.25: garantía del MAZO pesado (exclusivo de Home & Tools)
    this._guaranteeMazo();

    // efectos de disparo limpios
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.impacts.length = 0;
    this._dryToastT = 0;

    this.time = 0;
    this.kills = 0;
    this.searchedCount = 0;
    this.deathCause = null;
    this.stats = { shots: 0, molotovs: 0, crafted: 0, built: 0, dist: 0 };   // v0.23
    this._autosaveT = 0;
    this._seenVariants = {};   // v0.14: aviso único por variante en esta partida
    this._militarySeen = false;  // v0.16: aviso único al entrar en la base militar
    this._hospitalSeen = false;  // v0.18: aviso único al entrar en el hospital
    this._screamerCheckT = 0;    // v0.23: el chequeo de población arranca fresco
    this._screamedOnce = false;
    this._fireAlertSeen = false;
    this.cam.y = this.player.y - this.cam.h / 2;

    this.menus.hideAll();
    this.hud.show();
    this.hud._hintTimer = 0;
    document.getElementById('controls-hint').classList.remove('fade');
    this.invUI.closeUI();
    this.input.enabled = true;
    this.toasts.clear();
    this.state = STATE.PLAYING;
    this.toasts.push('Sobrevive. Hazte con un arma y busca suministros.', 'info');
    // v0.24: aviso de la profesión elegida (su bono pasivo, para que el
    // jugador sepa qué le acompaña desde el minuto uno)
    if (this.player.prof) this.menus.toastProfession(this.player.prof);
  }

  // ================== v0.27: MULTIJUGADOR ==================

  /**
   * Puntos de nacimiento de la partida co-op: offsets FIJOS alrededor del
   * spawn del mapa (misma calle abierta) con espiral DETERMINISTA si el
   * punto cae en sólido — todas las máquinas calculan lo mismo sin hablar.
   */
  _mpSpawnPoints(n) {
    const out = [];
    const base = this.map.spawn;
    const offs = [[0, 0], [72, 0], [0, 72], [-72, 0]];
    for (let i = 0; i < n; i++) {
      const [ox, oy] = offs[i % 4];
      let x = base.x + ox + (i >= 4 ? 72 : 0), y = base.y + oy;
      if (this.map.circleHitsSolid(x, y, 10)) {
        // espiral determinista (pasos fijos, sin azar)
        let found = false;
        for (let r = 24; r <= 220 && !found; r += 24) {
          for (let a = 0; a < 12 && !found; a++) {
            const th = (a / 12) * Math.PI * 2 + r * 0.05;
            const cx = base.x + Math.cos(th) * r, cy = base.y + Math.sin(th) * r;
            if (!this.map.circleHitsSolid(cx, cy, 10)) { x = cx; y = cy; found = true; }
          }
        }
      }
      out.push({ x, y });
    }
    return out;
  }

  /**
   * ANFITRIÓN: arranca la partida co-op. Construye el mundo local (como
   * startRun, SIN ranura de guardado — el MP no se guarda) y luego envía
   * el paquete de inicio a los clientes, que lo reconstruyen con la misma
   * semilla. La sala debe estar ya en el lobby con profesión elegida.
   */
  mpHostRun() {
    const prof = this.net.roster.find((r) => r.id === 'H');
    this.audio.init();
    const seed = (Math.random() * 2147483647) | 0;
    this.seedUsed = seed;
    this.rng = new Rng(seed);
    this.map = new GameMap(this.rng);
    const spawns = this._mpSpawnPoints(this.net.roster.length);
    this.player = new Player(spawns[0].x, spawns[0].y);
    this.player.prof = prof ? prof.prof : null;
    this.player.mpColor = NET.colors[0];
    this.survival = new Survival();
    this.noise = new NoiseSystem();
    this.vision = new Vision();
    this.daynight.reset();
    this._hourMark = Math.floor(this.daynight.hour);
    this.weather.reset();
    this._weatherMark = this.weather.type;
    this._resize();
    for (const c of this.map.containers) fillContainer(c, this.rng);
    this.zombies = spawnZombies(this.map, this.rng, ZOMBIE_CFG.count, this.map.spawn);
    this.groundItems = [];
    this._placeStartingLoot();
    // botín de arranque extra alrededor de los OTROS jugadores
    for (let i = 1; i < spawns.length; i++) {
      const mats = ['agua', 'lata_frijoles', 'tubo', 'venda'];
      for (const id of mats) {
        const pos = this.map.randomOutdoor(spawns[i], 140);
        if (pos) this.groundItems.push({ x: pos.x, y: pos.y, item: makeItem(id), visibleNow: true });
      }
    }
    this.constructions = [];
    this.build = null;
    this.fires = [];
    this.molotovs = [];
    this.sleepT = 0;
    this._sleepTarget = null;
    this.smokes = [];
    this.carsUI = null;
    this._guaranteeCuervo();
    this._guaranteeMazo();
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.impacts.length = 0;
    this._dryToastT = 0;
    this.time = 0;
    this.kills = 0;
    this.killsBy = null;
    this.searchedCount = 0;
    this.deathCause = null;
    this.stats = { shots: 0, molotovs: 0, crafted: 0, built: 0, dist: 0 };
    this._autosaveT = 0;
    this._seenVariants = {};
    this._militarySeen = false;
    this._hospitalSeen = false;
    this._screamerCheckT = 0;
    this._screamedOnce = false;
    this._fireAlertSeen = false;
    this.cam.y = this.player.y - this.cam.h / 2;
    // marionetas de los demás + callbacks de la sesión
    this.net.buildPuppets();
    let i = 1;
    for (const r of this.net.remotes.values()) {
      const s = spawns[i++] || this.map.spawn;
      r.p.x = s.x; r.p.y = s.y; r.p._tx = s.x; r.p._ty = s.y;
    }
    this._wireNet();
    // ¡todos a la calle!
    this.net.hostStart();
    this.menus.hideAll();
    this.hud.show();
    this.hud._hintTimer = 0;
    document.getElementById('controls-hint').classList.remove('fade');
    this.invUI.closeUI();
    this.input.enabled = true;
    this.input.tabHold = true;   // TAB = lista de jugadores (I = inventario)
    this.toasts.clear();
    this.state = STATE.PLAYING;
    this.toasts.push('SALA ' + this.net.code + ' — cooperad: el ruido de uno atrae para todos', 'info');
    if (this.player.prof) this.menus.toastProfession(this.player.prof);
  }

  /**
   * CLIENTE: reconstruye el mundo del anfitrión con el paquete de inicio
   * (semilla + reloj + clima + horda + objetos). El mapa y su botín salen
   * DETERMINISTAS de la semilla; los contenedores se abren pidiendo al
   * anfitrión (botín autoritativo, sin duplicar entre jugadores).
   */
  mpStartClient(init) {
    this.audio.init();
    this.seedUsed = init.seed;
    this.rng = new Rng(init.seed);
    this.map = new GameMap(this.rng);
    for (const c of this.map.containers) fillContainer(c, this.rng);
    const spawns = this._mpSpawnPoints(init.roster.length);
    const myIdx = Math.max(0, init.roster.findIndex((r) => r.id === this.net.myId));
    const mine = init.roster[myIdx];
    const sp = spawns[myIdx] || this.map.spawn;
    this.player = new Player(sp.x, sp.y);
    this.player.prof = mine ? mine.prof : null;
    this.player.mpColor = mine ? mine.color : null;
    this.survival = new Survival();
    this.noise = new NoiseSystem();
    this.vision = new Vision();
    this.daynight = new DayNight();
    this.daynight.t = init.dn || 0;
    this._hourMark = Math.floor(this.daynight.hour);
    this.weather = new Weather();
    if (init.wx) this.weather.load(init.wx);
    this._weatherMark = this.weather.type;
    this._resize();
    this.zombies = (init.zombies || []).map((a) => this.net.zombieFromNet(a));
    for (const z of this.zombies) this.net._zByNid.set(z.nid, z);
    this.groundItems = [];
    for (const g of init.ground || []) {
      const it = itemFromData(g[4]);
      if (!it) continue;
      const gi = { x: g[1], y: g[2], z: g[3] || 0, item: it, nid: g[0], visibleNow: false };
      this.groundItems.push(gi);
      this.net._giByNid.set(g[0], gi);
    }
    this.constructions = [];
    this.build = null;
    this.fires = [];
    this.molotovs = [];
    this.sleepT = 0;
    this._sleepTarget = null;
    this.smokes = [];
    this.carsUI = null;
    this._guaranteeCuervo();
    this._guaranteeMazo();
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.impacts.length = 0;
    this._dryToastT = 0;
    this.time = 0;
    this.kills = 0;
    this.killsBy = null;
    this.searchedCount = 0;
    this.deathCause = null;
    this.stats = { shots: 0, molotovs: 0, crafted: 0, built: 0, dist: 0 };
    this._autosaveT = 0;
    this._seenVariants = {};
    this._militarySeen = false;
    this._hospitalSeen = false;
    this._screamerCheckT = 0;
    this._screamedOnce = false;
    this._fireAlertSeen = false;
    this.cam.x = this.player.x - this.cam.w / 2;
    this.cam.y = this.player.y - this.cam.h / 2;
    this.net.buildPuppets();
    let i = 0;
    for (const r of this.net.remotes.values()) {
      const s = spawns[i++] || this.map.spawn;
      r.p.x = s.x; r.p.y = s.y; r.p._tx = s.x; r.p._ty = s.y;
    }
    this._wireNet();
    wrapNoiseForNet(this);   // el ruido local también suena para el anfitrión
    this.menus.hideAll();
    this.hud.show();
    this.hud._hintTimer = 0;
    document.getElementById('controls-hint').classList.remove('fade');
    this.invUI.closeUI();
    this.input.enabled = true;
    this.input.tabHold = true;
    this.toasts.clear();
    this.state = STATE.PLAYING;
    this.toasts.push('Conectado a la sala ' + this.net.code + ' — tu personaje responde EN LOCAL: cero retardo', 'info');
    if (this.player.prof) this.menus.toastProfession(this.player.prof);
  }

  /** Callbacks de la sesión → efectos sobre ESTA máquina. */
  _wireNet() {
    const n = this.net;
    n.onLocalStart = (init) => { if (!n.isHost) this.mpStartClient(init); };
    n.onPeerJoin = (name) => { if (!n.inGame) this.toasts.push(name + ' se une a la sala', 'info'); };
    n.onPeerLeave = (name) => { this.toasts.push(name + ' se ha ido de la sala', 'warn'); };
    n.onSessionEnd = (reason) => this._mpSessionEnd(reason);
    n.onLootOpen = (c) => { this.invUI.openUI(c); };
    n.onRemoteDead = (name) => { this.cam.shake(3); };
    // construcción remota (misma función para anfitrión y cliente)
    n.onRemoteCons = (data) => this._applyRemoteCons(data);
    n.onRemoteConsHp = (nid, hp) => {
      const c = this.constructions.find((x) => x.nid === nid);
      if (c) c.hp = hp;
    };
    n.onRemoteConsWt = (nid, wt) => {
      const c = this.constructions.find((x) => x.nid === nid);
      if (c && c.type === 'barril') c.water = wt;
    };
    n.onRemoteConsDel = (nid) => {
      const c = this.constructions.find((x) => x.nid === nid);
      if (c) removeConstruction(this, c);
    };
    n.onRemoteMolotov = (m) => {
      this.molotovs.push({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, t: 0, z: m.z || 0 });
    };
    n.onFull = () => {};

    // ---- hooks de los sistemas (definidos aquí: ni crafting ni combat
    // necesitan importar la red — cero dependencias circulares) ----
    // objeto soltado al suelo → se difunde con su nid
    this.mpDrop = (x, y, z, item) => {
      const gi = { x, y, z: z || 0, item, visibleNow: false };
      if (this.net) {
        gi.nid = this.net.nextGiNid();
        this.net._giByNid.set(gi.nid, gi);
        if (this.net.isHost) {
          this.net._broadcast({ t: 'ev', k: 'giAdd', n: gi.nid, x: Math.round(x), y: Math.round(y), z: z || 0, it: itemToData(item) });
        } else {
          this.net._sendHost({ t: 'act', op: 'giAdd', n: gi.nid, x: Math.round(x), y: Math.round(y), z: z || 0, it: itemToData(item) });
        }
      }
      this.groundItems.push(gi);
      return gi;
    };
    // construcción colocada → nid + difusión completa
    this.mpConsPlaced = (c) => {
      if (!this.net) return;
      c.nid = this.net.nextCoNid();
      const data = this._consToNet(c);
      if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'cons', data });
      else this.net._sendHost({ t: 'act', op: 'cons', data });
    };
    // construcción dañada/reparada → vida
    this.mpConsMutated = (c) => {
      if (!this.net || c.nid === undefined) return;
      if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'consHp', n: c.nid, hp: Math.round(c.hp) });
      else this.net._sendHost({ t: 'act', op: 'consHp', n: c.nid, hp: Math.round(c.hp) });
    };
    // construcción destruida/cosechada → baja
    this.mpConsRemoved = (c) => {
      if (!this.net || c.nid === undefined) return;
      if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'consDel', n: c.nid });
      else this.net._sendHost({ t: 'act', op: 'consDel', n: c.nid });
    };
    // molotov en vuelo → difusión visual
    this.mpMolotov = (m) => {
      if (!this.net) return;
      const p = { x: Math.round(m.x), y: Math.round(m.y), vx: Math.round(m.vx), vy: Math.round(m.vy), z: m.z || 0 };
      if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'molotov', ...p });
      else this.net._sendHost({ t: 'act', op: 'molotov', ...p });
    };
    // barril de lluvia → nivel de agua
    this.mpBarril = (c) => {
      if (!this.net || c.nid === undefined) return;
      const wt = Math.round(c.water || 0);
      if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'consWt', n: c.nid, wt });
      else this.net._sendHost({ t: 'act', op: 'consWt', n: c.nid, wt });
    };
  }

  /** Aplica una construcción difundida por la red (formato save.js). */
  _applyRemoteCons(d) {
    if (!d || !d.t) return;
    // ¿ya está? (reenvío doble imposible por ctl fiable, pero por si acaso)
    if (d.n && this.constructions.some((c) => c.nid === d.n)) return;
    const c = addConstruction(this, d.t, d.tx, d.ty, d.rt || 0, d.cp || null,
      d.pd !== undefined ? d.pd : null);
    if (d.hp !== undefined) c.hp = d.hp;
    if (d.us !== undefined && c.uses !== undefined) c.uses = d.us;
    if (d.n) c.nid = d.n;
    if (d.t === 'barril' && d.wt !== undefined) c.water = d.wt;
    if (d.t === 'caja' && Array.isArray(d.it)) {
      c.items = d.it.map(itemFromData).filter(Boolean);
      if (d.s) c.searched = true;
    }
    return c;
  }

  /** Serializa una construcción local para difundirla. */
  _consToNet(c) {
    const d = {
      t: c.type, tx: c.tx, ty: c.ty, rt: c.rot || 0,
      hp: Math.round(c.hp), n: c.nid,
      us: c.uses !== undefined ? c.uses : undefined,
      cp: c.crop || undefined,
      pd: c.plantedDay !== undefined ? c.plantedDay : undefined,
      wt: c.type === 'barril' ? Math.round(c.water || 0) : undefined,
    };
    if (c.type === 'caja') {
      d.it = (c.items || []).map(itemToData);
      d.s = c.searched ? 1 : 0;
    }
    return d;
  }

  /** Muerte EN MULTIJUGADOR: se espectea — la partida sigue para los demás. */
  mpDeath(cause) {
    const p = this.player;
    if (p.mpDead) return;
    p.mpDead = true;
    this.deathCause = cause;
    this.build = null;
    this.sleepT = 0;
    forceExit(this);
    if (this.carsUI) closeInspect(this);
    this.audio.setEngine(null);
    this.map.stampCorpse(p.x, p.y, p.angle);
    this.map.stampBlood(p.x, p.y, true);
    this.net.sendEv('pdead', { id: this.net.myId });
    this.toasts.push('HAS CAÍDO — espectando: [E] cambia de compañero', 'bad');
    this._spectate = this._pickSpectate();
    if (this.net.isHost) this.net._checkAllDead();
  }

  /** Siguiente compañero vivo al que especting (o null: quedarse donde caíste). */
  _pickSpectate() {
    const alive = [...this.net.remotes.values()].filter((r) => r.alive);
    if (!alive.length) return null;
    const cur = this._spectate;
    if (cur) {
      const i = alive.findIndex((r) => r === cur);
      return alive[(i + 1) % alive.length];
    }
    return alive[0];
  }

  /** Fin de sesión (host cerró / todos cayeron / salida propia). */
  _mpSessionEnd(reason) {
    const wasPlaying = this.state === STATE.PLAYING;
    this.net = null;
    this.input.tabHold = false;
    this.hud.showMpList(false);
    if (!wasPlaying) { this.toMenu(); return; }
    if (reason === 'all') {
      // todos han caído: obituario de la partida co-op
      this.state = STATE.DEAD;
      this.input.enabled = false;
      this.hud.hide();
      this.menus.showDeath(this.deathCause || 'zombi', {
        time: this.time, kills: this.kills, searched: this.searchedCount,
        day: this.daynight.day, stats: this.stats, prof: this.player.prof || null,
      }, false, null);
      const note = document.getElementById('ds-savegone');
      if (note) { note.classList.remove('hidden'); note.textContent = NET.mpSaveNote; }
      return;
    }
    this.toMenu();
    this.menus.showMpNotice(
      reason === 'host' ? 'El ANFITRIÓN cerró la sala — la partida co-op termina aquí.'
        : 'Has salido de la sala.');
  }

  // ================== Continuar partida guardada (v0.13) ==================

  /**
   * v0.22: carga la RANURA indicada (1-3). Si no hay guardado (o está roto),
   * arranca partida nueva EN ESA MISMA RANURA para no dejar al jugador
   * colgado en el menú. v0.24: al ser partida NUEVA, pasa por la selección
   * de PROFESIÓN (quien era antes de que el mundo cayera).
   */
  continueRun(slot) {
    if (slot >= 1 && slot <= 3) this.saveSlot = slot;
    const data = loadSaveData(this.saveSlot);
    if (!data) {
      this.menus.showProfSelect(this.saveSlot);
      return;
    }
    this.audio.init();
    const info = restoreGame(this, data);
    if (!info) {
      // guardado corrupto: fuera del estado a medias → partida nueva
      // (v0.24: con elección de profesión, como toda partida nueva)
      this.menus.showProfSelect(this.saveSlot);
      return;
    }

    // efectos transitorios limpios + cámara sobre el jugador
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.impacts.length = 0;
    this.fires.length = 0;        // v0.20: sin fuego al restaurar
    this.molotovs.length = 0;
    this.smokes = [];             // v0.26: humo efímero, no viaja
    if (this.carsUI) closeInspect(this);   // v0.26: sin ficha de coche colgada
    this.audio.setEngine(null);   // v0.26: motor apagado al restaurar
    this.build = null;
    this.sleepT = 0;
    this._sleepTarget = null;
    this._dryToastT = 0;
    this._autosaveT = 0;
    this._seenVariants = {};   // v0.14: el bestiario se reavisa tras cargar
    this._militarySeen = false;  // v0.16: el aviso de la base se reactiva tras cargar
    this._hospitalSeen = false;  // v0.18: el aviso del hospital se reactiva tras cargar
    this._screamerCheckT = 0;    // v0.23: chequeo de población reprogramado tras cargar
    this._screamedOnce = false;
    this._fireAlertSeen = false;
    this._weatherMark = this.weather.type;   // v0.15: sin toast de clima al restaurar
    this.noise = new NoiseSystem();
    this.vision = new Vision();
    this._resize();
    this.cam.x = this.player.x - this.cam.w / 2;
    this.cam.y = this.player.y - this.cam.h / 2;

    this.menus.hideAll();
    this.hud.show();
    this.hud._hintTimer = 0;
    document.getElementById('controls-hint').classList.add('fade');
    this.invUI.closeUI();
    this.input.enabled = true;
    this.toasts.clear();
    this.state = STATE.PLAYING;
    this.toasts.push('Partida restaurada — ' + info.clock + ', DÍA ' + info.day +
      '. El autoguardado te cubre cada 5 minutos.', 'info');
  }

  /**
   * v0.23 — EMERGENCIA DEL GRITADOR: cada screamerCheckEvery s se mide la
   * población zombi en un radio de screamerPopR px alrededor del jugador.
   * Si hay MUCHA gente junta (≥ screamerPopNear) y aún quedan huecos de
   * gritadores vivos, puede EMERGER uno fuera de tu vista — exactamente
   * donde ya hay aglomeración. Así el gritador señala las zonas CALIENTES:
   * asedios a la barricada, noches de respawn, matanzas que atrajeron a la
   * media ciudad. RARO por diseño (tope screamerMax, probabilidad por
   * chequeo). El azar usa Math.random: no consume el Rng del mundo.
   */
  _maybeSpawnScreamer() {
    const Z = ZOMBIE_CFG;
    const p = this.player;
    let near = 0, screamers = 0;
    for (const z of this.zombies) {
      if (z.variant === 'screamer') screamers++;   // el tope es GLOBAL (vivos)
      if (Math.hypot(z.x - p.x, z.y - p.y) < Z.screamerPopR) near++;
    }
    if (near < Z.screamerPopNear || screamers >= Z.screamerMax) return;
    if (Math.random() > Z.screamerChance) return;
    // nace FUERA de tu vista (mismo criterio que el respawn nocturno),
    // dentro de la zona poblada, en suelo exterior libre
    const spots = this.map.nightSpawnSpots(p, 1);
    if (!spots.length) return;
    this.zombies.push(new Zombie(spots[0].x, spots[0].y, this.rng, 'screamer'));
  }

  /** Pausa → guardar y volver al menú principal (v0.13; v0.22: a SU ranura). */
  saveAndQuit() {
    // v0.27: el multijugador NO se guarda — se sale de la sala sin más
    if (this.net) {
      this.toasts.push(NET.mpSaveNote, 'warn');
      return;
    }
    if (this.state !== STATE.PAUSED && this.state !== STATE.PLAYING) return;
    const ok = saveGame(this, this.saveSlot);
    if (!ok) {
      // sin guardar no se abandona la partida: avisa y se queda en pausa
      this.toasts.push('No se pudo guardar la partida (¿almacenamiento lleno?)', 'bad');
      if (this.state === STATE.PLAYING) this.togglePause();
      return;
    }
    this.toMenu();
  }

  /** Vuelve al menú principal (tras guardar). */
  toMenu() {
    // v0.27: salir al menú en plena sesión = abandonar la sala
    if (this.net) { this.net.leave(false); this.net = null; this.input.tabHold = false; }
    this.state = STATE.MENU;
    this._mpPaused = false;
    this.input.enabled = false;
    this.uiOpen = false;
    this.build = null;            // v0.20: sin fantasma en el menú
    this.sleepT = 0;
    forceExit(this);              // v0.26: nadie se queda durmiendo al volante
    if (this.carsUI) closeInspect(this);
    this.audio.setEngine(null);   // v0.26: motor y lluvia callados en el menú
    this.smokes = [];
    this.invUI.closeUI();
    this.ency.close();            // v0.22: sin enciclopedia abierta al volver
    this.hud.hide();
    this.audio.setRain(0);   // v0.15: el mundo no se dibuja en el menú → sin lluvia
    this.menus.hideAll();
    this.menus.showMenu();      // refresca el botón CONTINUAR PARTIDA
  }

  /** Auto-relleno de cargadores con la munición que llevas (toasts incluidos). */
  refillMags() {
    if (!this.player) return [];
    const filled = refillMagazines(this.player);
    for (const [mag, got] of filled) {
      this.toasts.push(mag.def.name + ' rellenado (+' + got + ')');
    }
    return filled;
  }

  _placeStartingLoot() {
    const s = this.map.spawn;
    // tubo de acero cerca del punto de aparición
    let px = s.x + 3 * TILE, py = s.y;
    if (this.map.circleHitsSolid(px, py, 8)) { px = s.x - 3 * TILE; py = s.y; }
    if (this.map.circleHitsSolid(px, py, 8)) { px = s.x; py = s.y + 3 * TILE; }
    this.groundItems.push({ x: px, y: py, item: makeItem('tubo'), visibleNow: true });

    // bate de béisbol en la casa más cercana
    const indoor = this.map.nearestIndoorFree(s.x, s.y);
    if (indoor) this.groundItems.push({ x: indoor.x, y: indoor.y, item: makeItem('bate'), visibleNow: true });

    // pistola de arranque cerca del spawn (con cargador puesto) para estrenar
    // el sistema de armas de fuego desde el primer minuto
    const gun = makeItem('pistola_vibora');
    gun.mag = makeItem('cargador_9mm');
    gun.mag.rounds = 7;
    const gp = this.map.randomOutdoor(s, 110) || { x: s.x + 5 * TILE, y: s.y };
    this.groundItems.push({ x: gp.x, y: gp.y, item: gun, visibleNow: true });
    const ammo = makeItem('bala_9mm');
    ammo.count = 14;
    const ap = this.map.randomOutdoor(s, 130) || { x: s.x - 4 * TILE, y: s.y };
    this.groundItems.push({ x: ap.x, y: ap.y, item: ammo, visibleNow: true });

    // suministros dispersos
    const scatter = ['agua', 'papas', 'manzana', 'venda', 'refresco', 'chocolate', 'lata_atun', 'venda'];
    for (const id of scatter) {
      const pos = this.map.randomOutdoor(s, 150);
      if (pos) this.groundItems.push({ x: pos.x, y: pos.y, item: makeItem(id), visibleNow: true });
    }

    // v0.20: materiales de arranque cerca del spawn — para estrenar el CRAFTEO
    // (vendas caseras o la primera barricada) sin dar la vuelta al mapa
    const mats = [
      ['tela', 4], ['alcohol_etilico', 2], ['tablas', 5], ['clavos', 10],
      ['botella_vacia', 2], ['queroseno', 1], ['cinta_adhesiva', 2], ['chatarra', 3],
    ];
    for (const [id, n] of mats) {
      const pos = this.map.randomOutdoor(s, 170);
      if (!pos) continue;
      const it = makeItem(id);
      it.count = n;
      this.groundItems.push({ x: pos.x, y: pos.y, item: it, visibleNow: true });
    }
  }

  // ================== Entrada ==================

  onAction(name) {
    // v0.27: lista de jugadores de la sala (TAB mantenido en multijugador)
    if (name === 'tablist') { this.hud.showMpList(true); return; }
    if (name === 'tablistUp') { this.hud.showMpList(false); return; }
    // v0.27: caído en multijugador — E cambia de compañero, resto apagado
    if (this.net && this.player && this.player.mpDead) {
      if (name === 'interact') { this._spectate = this._pickSpectate(); }
      else if (name === 'pause') { this.togglePause(); }
      return;
    }
    // v0.26: FICHA DE INSPECCIÓN de coche abierta — ESC/VOLVER cierra y
    // devuelve al juego (antes de nada, para que P no despausee debajo)
    if (this.carsUI) {
      if (name === 'escape' || name === 'pause' || name === 'inventory') closeInspect(this);
      return;
    }
    // v0.22: ENCICLOPEDIA abierta (desde el menú o la pausa) — ESC/VOLVER
    // cierra y devuelve a la pantalla desde la que se abrió. Se maneja lo
    // primero de todo para que P/ESC no despauseen por debajo.
    if (this.ency && this.ency.isOpen) {
      if (name === 'escape' || name === 'pause' || name === 'inventory') this.ency.close();
      return;
    }
    // v0.24: SELECCIÓN DE PROFESIÓN abierta (nueva partida a la espera) —
    // ESC/VOLVER cancelan y devuelven al menú; ENTER confirma la elección.
    // Igual que la enciclopedia: se maneja ANTES para que P/ESC no
    // despauseen o reintenten por debajo.
    if (this.menus && this.menus.profOpen) {
      if (name === 'escape' || name === 'pause') this.menus.hideProfSelect();
      else if (name === 'enter') this.menus.confirmProf();
      return;
    }
    if (this.state === STATE.MENU || this.state === STATE.DEAD) {
      // v0.27: paneles de MULTIJUGADOR abiertos sobre el menú — ESC vuelve
      if (name === 'escape') {
        const mpEl = document.getElementById('mpscreen');
        const lobEl = document.getElementById('mp-lobby');
        const noteEl = document.getElementById('mp-notice');
        if (noteEl && !noteEl.classList.contains('hidden')) {
          noteEl.classList.add('hidden');
          this.menus.showMenu();
          return;
        }
        if (lobEl && !lobEl.classList.contains('hidden')) { this.menus._mpLeave(); return; }
        if (mpEl && !mpEl.classList.contains('hidden')) { this.menus.showMenu(); return; }
      }
      // v0.22: Enter — en el menú continúa la partida MÁS RECIENTE (o arranca
      // en la ranura 1 si no hay ninguna); en la pantalla de muerte reintenta
      // en la MISMA ranura (su guardado ya se borró al morir)
      // v0.24: ambos arranques de partida NUEVA pasan por la PROFESIÓN
      if (name === 'enter') {
        if (this.state === STATE.DEAD) this.menus.showProfSelect(this.saveSlot);
        else {
          const s = latestSlot();
          if (s) this.continueRun(s);
          else this.menus.showProfSelect(1);
        }
      }
      return;
    }
    if (name === 'mute') {
      const m = this.audio.toggleMute();
      this.toasts.push(m ? 'Audio silenciado' : 'Audio activado');
      return;
    }
    if (name === 'pause') { this.togglePause(); return; }
    if (this.invUI.isOpen) {
      if (name === 'inventory' || name === 'escape') this.invUI.closeUI();
      return;
    }
    if (this.state !== STATE.PLAYING) return;
    // ---- v0.26: AL VOLANTE — solo E (bajar), L (faros) y P/M funcionan ----
    if (this.player.inCar) {
      switch (name) {
        case 'interact': {
          const car = this.player.inCar;
          exitCar(this);
          // v0.27: bajarse del coche se difunde a la sala
          if (this.net && car) {
            const i = this.map.cars.indexOf(car);
            this.net.sendEv('carOut', { i, x: Math.round(this.player.x), y: Math.round(this.player.y), who: this.net.myId });
          }
          break;
        }
        case 'flash': {
          const car = this.player.inCar;
          car.lights = !car.lights;
          this.audio.flashClick();
          this.toasts.push(car.lights ? 'Faros encendidos' : 'Faros apagados');
          break;
        }
      }
      return;
    }
    // ---- v0.20: modo construcción ----
    if (this.build) {
      if (name === 'reload') { rotateBuild(this); return; }        // R rota
      if (name === 'attack') { cancelBuild(this); return; }        // clic izq.
      if (name === 'escape') { cancelBuild(this); return; }
      if (name === 'place') { placeBuild(this); return; }           // clic der.
    }
    switch (name) {
      case 'interact': this.interact(); break;
      case 'inspect': {
        // v0.26: [Q] — inspeccionar el coche más cercano (ficha completa)
        const car = this.nearestCar();
        if (car) openInspect(this, car);
        break;
      }
      case 'inventory': this.invUI.openUI(null); break;
      case 'reload': reloadRanged(this); break;
      case 'place': break;   // clic derecho fuera de construcción: nada
      case 'hot1': hotbarUse(this, 0); break;
      case 'hot2': hotbarUse(this, 1); break;
      case 'hot3': hotbarUse(this, 2); break;
      case 'hot4': hotbarUse(this, 3); break;
      case 'hot5': hotbarUse(this, 4); break;
      case 'flash': toggleFlashlight(this); break;   // v0.17: linterna
      case 'sneak': {
        this.player.sneak = !this.player.sneak;
        this.toasts.push(this.player.sneak ? 'Modo sigilo: más lento, más silencioso' : 'Sigilo desactivado');
        break;
      }
      case 'attack': playerAttack(this); break;
    }
  }

  togglePause() {
    // v0.27: en MULTIJUGADOR la ciudad no se congela para los demás — la
    // pausa es un overlay local (el mundo y los zombis SIGUEN corriendo)
    if (this.net) {
      if (this.state !== STATE.PLAYING) return;
      if (this._mpPaused) {
        this._mpPaused = false;
        this.menus.hidePause();
        this.input.enabled = !this.invUI.isOpen;
      } else {
        this._mpPaused = true;
        this.menus.showPause();
        this.input.enabled = false;
      }
      return;
    }
    if (this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.menus.showPause();
    } else if (this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.menus.hidePause();
      this._last = performance.now();
    }
  }

  // ================== Eventos del ciclo día/noche y del clima ==================

  /**
   * v0.15: transición de clima → toasts (compara con la marca del frame
   * anterior, igual que _onHourChange con la hora). El primer frame tras
   * empezar/continuar no avisa: la marca se fija en startRun/continueRun.
   */
  _onWeatherChange(prev, now) {
    if (prev === now) return;
    if (now === 'rain') {
      this.toasts.push('Llueve: el ruido queda enmascarado — te oyen menos, ves algo menos', 'info');
    } else if (now === 'fog') {
      this.toasts.push('Neblina densa: visibilidad reducida a la mitad… también para ellos', 'warn');
    } else if (prev === 'rain') {
      this.toasts.push('La lluvia amaina', 'info');
    } else if (prev === 'fog') {
      this.toasts.push('La neblina se disipa', 'info');
    }
  }

  /** Cambio de hora del reloj interno: avisos y respawn nocturno. */
  _onHourChange(h) {
    if (h === DAYNIGHT.nightStart) {
      this.toasts.push('Anochece. La noche los trae de vuelta…', 'warn');
      return;
    }
    if (h === DAYNIGHT.nightEnd) {
      this.toasts.push('Amanece. Por fin algo de luz.', 'info');
      return;
    }
    if (this.daynight.isNight) this._nightRespawn();
  }

  /**
   * Respawn nocturno (v0.11): cada hora de la noche el mapa repone un grupo
   * de zombis en tiles exteriores caminables SIEMPRE fuera de la línea de
   * visión del jugador (a 500+ px, fuera del cono y sin línea de vista
   * directa — ver map.nightSpawnSpots). El total nunca supera
   * ZOMBIE_CFG.nightCap, así que limpiar el barrio deja margen.
   * v0.14: el lote nocturno mezcla normales con CORREDORES (25% — de noche
   * presionan más). Los brutos NO reaparecen: son guarnición de las
   * estructuras, no presión de calle.
   */
  _nightRespawn() {
    const cap = ZOMBIE_CFG.nightCap;
    if (this.zombies.length >= cap) return;
    const n = Math.min(ZOMBIE_CFG.nightBatch, cap - this.zombies.length);
    const spots = this.map.nightSpawnSpots(this.player, n);
    for (const s of spots) {
      const variant = this.rng.chance(ZOMBIE_CFG.nightRunnerChance) ? 'runner' : 'normal';
      this.zombies.push(new Zombie(s.x, s.y, this.rng, variant));
    }
  }

  // ================== Interacción con el mundo ==================

  /** v0.26: coche aparcado más cercano a menos de VEHICULOS.enterR px. */
  nearestCar() {
    if (!this.map || !this.player) return null;
    const p = this.player;
    if (p.inCar || (p.z || 0) !== 0 || p.climb) return null;
    let best = null, bd = VEHICULOS.enterR;
    for (const car of this.map.cars) {
      if (car.driven) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }

  interactTarget() {
    if (this.state !== STATE.PLAYING || this.uiOpen || !this.player) return null;
    const p = this.player;
    // en mitad de la escalera no hay interacción con el mundo
    if (p.climb) return null;
    // v0.26: AL VOLANTE solo hay una interacción: BAJARSE
    if (p.inCar) return { kind: 'exitcar', obj: p.inCar, d: 0, label: '[E] Salir del coche (' + carLabel(p.inCar) + ')' };
    const pz = p.z || 0;
    let best = null;

    // escaleras al 2º piso / sótano: solo de pie sobre ellas, en TU planta
    const st = this.map.stairsNear(p);
    if (st) best = { kind: 'stairs', obj: st, d: 0, label: st.label };

    for (const c of this.map.containers) {
      if (c.z !== pz) continue;   // nada de registrar a través del techo
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < 46 && (!best || d < best.d)) {
        best = { kind: 'container', obj: c, d, label: 'Registrar ' + c.name };
      }
    }
    // v0.20: construcciones interactivas (caja de almacenamiento, cama)
    for (const c of this.constructions) {
      if (c.z !== 0 || pz !== 0) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < 46 && (!best || d < best.d)) {
        if (c.type === 'caja') {
          best = { kind: 'constr', obj: c, d, label: 'Abrir ' + (c.name || CON_NAMES.caja) };
        } else if (c.type === 'cama') {
          best = { kind: 'constr', obj: c, d, label: 'Dormir en la cama' };
        } else if (c.type === 'mesa') {
          best = { kind: 'constr', obj: c, d, label: 'Mesa de trabajo (recetas avanzadas)' };
        } else if (c.type === 'fogata') {
          // v0.25: la fogata abre la COCINA (pestaña CRAFTEO) al pulsarla
          best = { kind: 'fire', obj: c, d, label: 'Cocinar en la fogata (asar verduras)' };
        } else if (c.type === 'barril') {
          // v0.26: el barril de lluvia — BEBER o LLENAR botella
          best = { kind: 'barril', obj: c, d, label: barrilPromptLabel(this, c) };
        } else if (c.type === 'cultivo') {
          // v0.25: el cultivo cuenta su progreso y se COSECHA maduro
          best = { kind: 'crop', obj: c, d, label: cropPromptLabel(this, c) };
        } else if (needsRepair(c)) {
          // v0.23: barricada/tabiños/valla/trampa dañadas → REPARAR con su
          // coste real en el propio prompt (más dañada, más materiales)
          // v0.24: el prompt refleja el coste YA descontado del CARPINTERO
          best = { kind: 'repair', obj: c, d, label: 'Reparar ' + CON_NAMES[c.type] + ' (' + repairCostLabel(repairCost(c, this.player)) + ')' };
        }
      }
    }
    for (const gi of this.groundItems) {
      // v0.19: los objetos del suelo son de TU planta (los que sueltes en el
      // sótano o el 2º piso se recogen allí, no a través del techo)
      if ((gi.z || 0) !== pz) continue;
      const d = Math.hypot(gi.x - p.x, gi.y - p.y);
      if (d < 38 && (!best || d < best.d)) {
        best = { kind: 'item', obj: gi, d, label: 'Recoger ' + itemLabel(gi.item) };
      }
    }
    // v0.26: COCHES — [E] entra, [Q] inspecciona (la ficha completa)
    if (pz === 0) {
      for (const car of this.map.cars) {
        if (car.driven) continue;
        const d = Math.hypot(car.x - p.x, car.y - p.y);
        if (d < VEHICULOS.enterR && (!best || d < best.d)) {
          best = { kind: 'car', obj: car, d, label: 'Entrar al ' + car.brand + ' ' + car.name + ' · [Q] Inspeccionar' };
        }
      }
    }
    if (pz === 0) {              // las puertas solo existen en planta baja
      const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
      for (let ty = pty - 1; ty <= pty + 1; ty++) {
        for (let tx = ptx - 1; tx <= ptx + 1; tx++) {
          const t = this.map.tileAtIdx(tx, ty);
          if (t === T.DOOR_CLOSED || t === T.DOOR_OPEN) {
            const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
            const d = Math.hypot(cx - p.x, cy - p.y);
            if (d < 42 && (!best || d < best.d)) {
              best = { kind: 'door', obj: { tx, ty, open: t === T.DOOR_OPEN }, d, label: (t === T.DOOR_OPEN ? 'Cerrar' : 'Abrir') + ' puerta' };
            }
          }
        }
      }
    }
    return best;
  }

  interact() {
    const target = this.interactTarget();
    if (!target) return;
    switch (target.kind) {
      case 'stairs': {
        // empezar a subir/bajar: el movimiento se bloquea y la capa de la
        // planta destino va apareciendo con un fundido (climb.k en render)
        const st = target.obj;
        this.player.climb = {
          from: this.player.z || 0, to: st.to,
          t: 0, dur: FLOORS.climbTime, k: 0,
        };
        this.audio.door();   // crujido de madera al pisar la escalera
        this.noise.emit(this.player.x, this.player.y, 55, 'escalera');
        break;
      }
      case 'container': {
        const c = target.obj;
        // v0.27: en el CLIENTE el botín lo resuelve el ANFITRIÓN: se pide
        // por el canal fiable y el paquete abre el inventario al volver
        if (this.net && !this.net.isHost) {
          if (!this.net.requestLoot(c)) this.invUI.openUI(c);
          this.audio.container();
          break;
        }
        if (!c.searched) { c.searched = true; this.searchedCount++; }
        if (this.net) this.net.sendEv('searched', { key: this.net.lootKeyOf(c) });
        this.noise.emit(this.player.x, this.player.y, 70, 'registro');
        this.audio.container();
        this.invUI.openUI(c);
        break;
      }
      case 'constr': {
        // v0.20: caja de almacenamiento (abre como contenedor) o cama (dormir)
        const c = target.obj;
        if (c.type === 'caja') {
          // v0.27: la caja también pasa por el anfitrión en el cliente
          if (this.net && !this.net.isHost) {
            if (!this.net.requestLoot(c)) this.invUI.openUI(c);
            this.audio.container();
            break;
          }
          if (!c.searched) { c.searched = true; this.searchedCount++; }
          if (this.net) this.net.sendEv('searched', { key: this.net.lootKeyOf(c) });
          this.audio.container();
          this.invUI.openUI(c);
        } else if (c.type === 'cama') {
          sleepInBed(this);
        }
        break;
      }
      case 'repair': {
        // v0.23: REPARAR la construcción dañada (gasta materiales según daño)
        repairConstruction(this, target.obj);
        break;
      }
      case 'crop': {
        // v0.25: COSECHAR el cultivo (maduro → verduras; creciendo → aviso;
        // marchita → recupera 1 semilla)
        harvestCrop(this, target.obj);
        break;
      }
      case 'fire': {
        // v0.25: la FOGATA abre la pestaña CRAFTEO (recetas de asado)
        this.audio.container();
        this.invUI.openCraft();
        break;
      }
      case 'barril': {
        // v0.26: BEBER del barril o LLENAR una botella vacía
        barrilUse(this, target.obj);
        break;
      }
      case 'car': {
        // v0.26: ENTRAR al coche (y arrancar si puede)
        // v0.27: el que entra manda sobre el coche — se avisa a la sala
        enterCar(this, target.obj);
        if (this.net) {
          const i = this.map.cars.indexOf(target.obj);
          this.net.sendEv('carIn', { i, r: target.obj.running ? 1 : 0, who: this.net.myId });
        }
        break;
      }
      case 'exitcar': {
        // v0.26: BAJARSE del coche (queda aparcado donde esté)
        const car = this.player.inCar;
        exitCar(this);
        if (this.net && car) {
          const i = this.map.cars.indexOf(car);
          this.net.sendEv('carOut', { i, x: Math.round(this.player.x), y: Math.round(this.player.y), who: this.net.myId });
        }
        break;
      }
      case 'item': {
        const gi = target.obj;
        // v0.27: en multijugador el objeto se ANOTA (nid) y se reclama al
        // anfitrión: si otro lo cogió antes, el anfitrión te lo devuelve
        if (this.net) gi.item.mpPick = gi.nid;
        const fully = this.player.inventory.add(gi.item);
        if (fully) {
          const i = this.groundItems.indexOf(gi);
          if (i >= 0) this.groundItems.splice(i, 1);
          this.audio.pickup();
          this.toasts.push('Recogido: ' + itemLabel(gi.item));
          this.noise.emit(this.player.x, this.player.y, 30, 'recoger');
          if (this.net) {
            if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'giDel', n: gi.nid });
            else this.net._sendHost({ t: 'act', op: 'pick', n: gi.nid });
            this.net._giByNid.delete(gi.nid);
          }
          // la munición recogida rellena sola los cargadores compatibles
          if (gi.item.def.cat === 'municion') this.refillMags();
        } else if (gi.item.count <= 0) {
          const i = this.groundItems.indexOf(gi);
          if (i >= 0) this.groundItems.splice(i, 1);
        } else {
          this.toasts.push('Mochila llena', 'warn');
        }
        break;
      }
      case 'door':
        this._toggleDoor(target.obj.tx, target.obj.ty, target.obj.open);
        break;
    }
  }

  _toggleDoor(tx, ty, isOpen) {
    if (isOpen) {
      // no cerrar si hay alguien en el umbral
      const rx = tx * TILE, ry = ty * TILE;
      const blocked = (e) => e.x > rx && e.x < rx + TILE && e.y > ry && e.y < ry + TILE;
      // v0.27: en co-op también bloquean los COMPAÑEROS y sus zombis
      const blockers = [this.player, ...this.zombies];
      if (this.net) {
        for (const r of this.net.remotes.values()) blockers.push(r.p);
      }
      if (blockers.some(blocked)) {
        this.toasts.push('Algo bloquea la puerta', 'warn');
        return;
      }
      this.map.setTile(tx, ty, T.DOOR_CLOSED);
    } else {
      this.map.setTile(tx, ty, T.DOOR_OPEN);
    }
    this.audio.door();
    this.noise.emit(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 85, 'puerta');
    // v0.27: la puerta se comparte — se difunde a la sala
    if (this.net) {
      if (this.net.isHost) this.net._broadcast({ t: 'ev', k: 'door', tx, ty, open: !isOpen });
      else this.net._sendHost({ t: 'act', op: 'door', tx, ty, open: !isOpen });
    }
  }

  // ================== Eventos de combate / muerte ==================

  combatZombieHit(z, target) {
    // v0.27: en co-op, la mordida sobre un REMOTO la sufre su dueño
    // (con SU equipo: reducción de daño e infección son locales)
    if (target && target !== this.player) {
      if (target.mpDead) return;
      if (this.net && this.net.isHost) { this.net.routeBite(z, target); return; }
    }
    zombieHit(this, z);
  }

  killZombie(z) {
    // v0.27: la muerte de un zombi la dicta SOLO la autoridad (anfitrión);
    // los clientes aplican el cadáver al llegar el evento fiable 'zkill'
    if (this.net && !this.net.isHost) return;
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    const byMe = !this.net || !this.killsBy || this.killsBy === 'H';
    if (byMe) this.kills++;
    if (this.net) {
      if (!z.nid) z.nid = ++this.net._zNid;
      const va = { normal: 'n', runner: 'r', brute: 'b', screamer: 's' }[z.variant] || 'n';
      this.net._broadcast({
        t: 'ev', k: 'zkill', n: z.nid,
        x: Math.round(z.x), y: Math.round(z.y), va, fa: +z.face.toFixed(2),
        by: this.killsBy || 'H',
      });
    }
    // v0.14: el cadáver del bruto es más grande; el del corredor, menudo;
    // v0.23: el gritador deja un cuerpo corriente (su valor estaba en la boca)
    const scale = z.variant === 'brute' ? 1.4 : z.variant === 'runner' ? 0.85 : 1;
    this.map.stampCorpse(z.x, z.y, z.face, scale);
    this.map.stampBlood(z.x, z.y, true);
    this.audio.groan(0.7, 0, z.groanPitch);
    this.cam.shake(3);
  }

  onDeath(cause) {
    if (this.state !== STATE.PLAYING) return;
    // v0.27: en multijugador la muerte es ESPECTAR: la partida sigue
    if (this.net) { this.mpDeath(cause); return; }
    this.state = STATE.DEAD;
    this.input.enabled = false;
    this.deathCause = cause;
    this.build = null;            // v0.20: sin fantasma tras morir
    this.sleepT = 0;
    forceExit(this);              // v0.26: si moriste al volante, el coche queda aparcado
    if (this.carsUI) closeInspect(this);
    this.audio.setEngine(null);
    this.hud.hide();
    this.map.stampCorpse(this.player.x, this.player.y, this.player.angle);
    this.map.stampBlood(this.player.x, this.player.y, true);
    // v0.23: OBITUARIO — los récords acumulados (localStorage, independiente
    // de las ranuras) se actualizan con esta partida: una vida más a la cuenta
    const rec = updateRecords({
      time: this.time, day: this.daynight.day, kills: this.kills,
    });
    // v0.13: la muerte es DEFINITIVA — el guardado de ESTA ranura se borra
    // (v0.22: las otras dos partidas siguen donde las dejaste)
    const hadSave = hasSave(this.saveSlot);
    clearSave(this.saveSlot);
    this.menus.showDeath(cause, {
      time: this.time,
      kills: this.kills,
      searched: this.searchedCount,
      day: this.daynight.day,
      stats: this.stats,
      prof: this.player.prof || null,   // v0.24: quién eras en esta partida
    }, hadSave, rec);
  }

  // ================== v0.27: sincronía de construcciones ==================

  /** Anfitrión: difunde cada 1 s la vida baja y el agua de los barriles
   *  (daño de zombis, reparaciones y lluvia acumulada). */
  _mpConsSync(dt) {
    this._mpConsT += dt;
    if (this._mpConsT < 1) return;
    this._mpConsT = 0;
    for (const c of this.constructions) {
      if (!c._netHp) c._netHp = Math.round(c.hp);
      if (!c._netWt && c.type === 'barril') c._netWt = Math.round(c.water || 0);
      const hp = Math.round(c.hp), wt = Math.round(c.water || 0);
      if (hp < c._netHp - 0.5 || hp > c._netHp + 0.5) {
        c._netHp = hp;
        this.net._broadcast({ t: 'ev', k: 'consHp', n: c.nid, hp });
      }
      if (c.type === 'barril' && (wt < c._netWt - 0.5 || wt > c._netWt + 0.5)) {
        c._netWt = wt;
        this.net._broadcast({ t: 'ev', k: 'consWt', n: c.nid, wt });
      }
    }
  }

  // ================== Update ==================

  update(dt) {
    if (this.state !== STATE.PLAYING) return;

    // v0.27: MULTIJUGADOR — el tick de red siempre corre (interpolación,
    // instantáneas, reloj) y el mundo SIGUE con la UI abierta o la pausa:
    // no se congela una ciudad compartida. En solitario, todo como siempre.
    const mp = !!this.net;
    const world = !mp || this.net.isHost;   // ¿esta máquina simula el mundo?
    const alive = !this.player.mpDead;
    if (mp) this.net.tick(dt);
    if (this.uiOpen && !mp) return;

    // v0.20: DORMIR — fundido a negro: el mundo espera al despertar
    if (this.sleepT > 0) {
      this.sleepT -= dt;
      if (this.sleepT <= 0) { this.sleepT = 0; finishSleep(this); }
      return;
    }

    this.time += dt;

    // ciclo día/noche (12 min = 24 h de juego) + eventos al cambiar de hora
    // v0.27: en el cliente la hora la marca el ANFITRIÓN (viene en cada
    // instantánea) — aquí no se avanza
    if (world) {
      this.daynight.update(dt);
      const dnH = Math.floor(this.daynight.hour);
      if (dnH !== this._hourMark) {
        this._hourMark = dnH;
        this._onHourChange(dnH);
      }
    }

    // v0.15: clima (lluvia/neblina) — avanza con el mundo, avisa de
    // transiciones y deja listos los multiplicadores del frame:
    //  · noise.mul → la lluvia enmascara TODOS los ruidos de este frame
    //    (pasos, disparos, puertas…): lo leen los zombis al escuchar.
    //  · audio.setRain → ambiente de lluvia con su intensidad (y truenos).
    // v0.27: el clima lo dicta el anfitrión (viaja en la instantánea);
    // el cliente solo actualiza el AMBIENTE local con lo recibido
    if (world) {
      this.weather.update(dt);
      const wt = this.weather.type;
      if (wt !== this._weatherMark) {
        const prev = this._weatherMark;
        this._weatherMark = wt;
        this._onWeatherChange(prev, wt);
      }
    }
    this.noise.mul = this.weather.noiseMul();
    this.audio.setRain(this.weather.type === 'rain' ? this.weather.intensity : 0, dt);

    // v0.17: linterna — descarga de pilas + cambio automático (solo jugando,
    // igual que el día/noche y el clima; los multiplicadores de visión los
    // lee vision.js vía flashRangeMul)
    updateFlashlight(this, dt);

    // v0.20: crafteo — fantasma del modo construcción, fuego del molotov y
    // trampas de pinchos (las construcciones viven solo en planta baja)
    if (this.build) updateBuild(this);
    updateFire(this, dt);
    updateConstructions(this, dt);

    // v0.26: EL COCHE EN MARCHA — física de conducción, combustible,
    // choques, atropellos y ruido de motor (el jugador va dentro)
    // v0.27: cada piloto conduce EN LOCAL (autoridad del conductor)
    if (alive && this.player.inCar) updateVehicle(this, dt);
    updateVehicleFX(this, dt);

    // v0.23: chequeo periódico de población para la EMERGENCIA del GRITADOR
    // v0.27: solo la autoridad vigila la población (los gritadores nacen
    // en el anfitrión y se difunden como altas de zombi)
    if (world) {
      this._screamerCheckT += dt;
      if (this._screamerCheckT >= ZOMBIE_CFG.screamerCheckEvery) {
        this._screamerCheckT = 0;
        this._maybeSpawnScreamer();
      }
    }

    // v0.27: sincronización periódica de construcciones (anfitrión):
    // vida de barricadas golpeadas y agua de los barriles con la lluvia
    if (mp && this.net.isHost) this._mpConsSync(dt);

    if (alive) this.player.update(dt, this);
    this.player.inventory.setCapacity(this.player.capacity());

    // zombis (hacia atrás: pueden morir durante el frame)
    // v0.27: los clientes NO corren la IA — son marionetas interpoladas
    // por net.tick() a partir de las instantáneas del anfitrión
    if (world) {
      for (let i = this.zombies.length - 1; i >= 0; i--) {
        this.zombies[i].update(dt, this);
        if (this.state !== STATE.PLAYING) return;
      }
    }

    if (alive) {
      this.survival.update(dt, this, this.player.moving, this.player.running);
      if (this.state !== STATE.PLAYING) return;
    } else if (mp && this._spectate) {
      // espectador: la cámara/vision siguen al compañero elegido
      this.player.x = this._spectate.p.x;
      this.player.y = this._spectate.p.y;
      this.player.z = this._spectate.p.z || 0;
    }

    // v0.13: autoguardado cada 5 minutos DE PARTIDA (solo avanza jugando:
    // el menú, la pausa y el inventario abierto no consumen el cronómetro)
    // v0.27: sin autoguardado en multijugador (la sala no se guarda)
    if (!mp) {
      this._autosaveT += dt;
      if (this._autosaveT >= AUTOSAVE_SEC) {
        this._autosaveT = 0;
        if (saveGame(this, this.saveSlot)) this.toasts.push('Partida guardada (ranura ' + this.saveSlot + ')', 'save');
        else this.toasts.push('Autoguardado fallido: revisa el almacenamiento', 'bad');
      }
    }

    this.noise.update(dt);

    // recarga en curso → temporizador y aplicación al terminar
    if (this.player.reloading) {
      this.player.reloading.left -= dt;
      if (this.player.reloading.left <= 0) finishReload(this);
    }

    // fuego automático: mantener pulsado el botón con un rifle automático
    // (v0.20: nunca en modo construcción — el clic izquierdo CANCELA)
    const eqGun = this.player.equipment.arma;
    if (alive && this.input.mouse.down && eqGun && eqGun.def.auto && !this.build) playerAttack(this);

    // Visión puramente en tiempo real: se recalcula cada frame, sin memoria
    this.vision.compute(this);

    // barra rápida: vacía las ranuras cuyo objeto ya no llevas
    hotbarValidate(this.player);

    // v0.16: aviso único al pisar por primera vez la BASE MILITAR
    if (!this._militarySeen && this.player.z === 0) {
      const b = this.map.buildingAtPx(this.player.x, this.player.y);
      if (b && b.kind === 'military') {
        this._militarySeen = true;
        this.toasts.push('BASE MILITAR: el sótano guarda el mejor botín del juego… y a sus dueños', 'warn');
        this.audio.groan(1, 0, 0.55);
      }
    }

    // v0.18: aviso único al pisar por primera vez el HOSPITAL (cualquier piso)
    if (!this._hospitalSeen) {
      const bh = this.map.buildingAtPx(this.player.x, this.player.y);
      if (bh && bh.kind === 'hospital') {
        this._hospitalSeen = true;
        this.toasts.push('HOSPITAL SAN RAFAEL: apagón total — de noche no verás nada sin una linterna. Ambos pisos están infestados…', 'warn');
        this.audio.groan(1, 0, 0.55);
      }
    }

    // visibilidad de entidades (para render y lógica de "solo lo que ves")
    // v0.16: la visibilidad es de TU planta (el sótano tiene su propio mundo)
    const _pz = this.player.climb ? this.player.climb.to : (this.player.z || 0);
    for (const z of this.zombies) {
      z.visibleNow = ((z.z || 0) === _pz) && this.vision.isVisible(z.x, z.y, this);
    }
    for (const gi of this.groundItems) {
      // v0.19: la visibilidad de los objetos del suelo es de TU planta
      gi.visibleNow = ((gi.z || 0) === _pz) && this.vision.isVisible(gi.x, gi.y, this);
    }

    const mw = this.cam.screenToWorld(this.input.mouse.x, this.input.mouse.y);
    this.cam.follow(this.player, mw.x, mw.y, dt);
    this.cam.updateShake(dt);

    this.hud.update(this);
    this.audio.heartbeat(dt, this.survival.health < 25 && this.survival.health > 0);

    this.noise.clearFrame();

    // decaimiento de efectos de disparo
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      if (tr.t >= tr.life) this.tracers.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.t += dt;
      if (fl.t >= fl.life) this.flashes.splice(i, 1);
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.t += dt;
      if (im.t >= im.life) this.impacts.splice(i, 1);
    }
  }

  // ================== Render ==================

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#060806';
    ctx.fillRect(0, 0, this.cam.w, this.cam.h);

    if (this.state === STATE.MENU) {
      // fondo del menú: niebla animada sutil
      const t = performance.now() / 1000;
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const g = ctx.createRadialGradient(
          this.cam.w * (0.3 + 0.2 * i) + Math.sin(t * (0.13 + i * 0.05)) * 90,
          this.cam.h * (0.4 + 0.15 * i) + Math.cos(t * (0.11 + i * 0.07)) * 70,
          30, this.cam.w * 0.5, this.cam.h * 0.5, Math.max(this.cam.w, this.cam.h) * 0.6);
        g.addColorStop(0, 'rgba(28,34,26,0.5)');
        g.addColorStop(1, 'rgba(6,8,6,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.cam.w, this.cam.h);
      }
      ctx.restore();
      return;
    }

    if (this.map && this.player) renderGame(ctx, this);
  }
}

// ---------- arranque ----------
const canvas = document.getElementById('game');
window.game = new Game(canvas);
