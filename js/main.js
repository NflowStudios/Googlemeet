/**
 * main.js — ZONA CERO · Prototipo de supervivencia zombi 2D (top-down).
 *
 * Orquestador: bucle de juego con paso fijo, máquina de estados
 * (menu/playing/paused/dead), interacción con el mundo (puertas, botín,
 * contenedores) y cableado de todos los sistemas modulares.
 */

import { TILE, T, ZOMBIE_CFG } from './config.js';
import { Rng } from './rng.js';
import { Input } from './core/input.js';
import { Camera } from './core/camera.js';
import { AudioFX } from './core/audio.js';
import { GameMap } from './world/map.js';
import { Vision } from './world/vision.js';
import { NoiseSystem } from './systems/noise.js';
import { Survival } from './systems/survival.js';
import { Inventory, makeItem, fillContainer, itemLabel, refillMagazines } from './systems/inventory.js';
import { playerAttack, zombieHit, reloadRanged, finishReload } from './systems/combat.js';
import { hotbarUse, hotbarValidate } from './systems/hotbar.js';
import { Player } from './entities/player.js';
import { Zombie, spawnZombies } from './entities/zombie.js';
import { HUD } from './ui/hud.js';
import { Toasts } from './ui/toasts.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { Menus } from './ui/menus.js';
import { renderGame } from './render.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' };

class Game {
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
    this.invUI = new InventoryUI(this);
    this.noise = new NoiseSystem();
    this.vision = new Vision();

    this.state = STATE.MENU;
    this.uiOpen = false;
    this.zombies = [];
    this.groundItems = [];
    // efectos de disparo (coordenadas de mundo, decaen en update)
    this.tracers = [];   // trazadoras {x1,y1,x2,y2,t,life}
    this.flashes = [];   // fogonazos {x,y,a,t,life,big}
    this.impacts = [];   // impactos en muro {x,y,t,life}
    this.time = 0;
    this.kills = 0;
    this.searchedCount = 0;
    this.deathCause = null;

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

  startRun() {
    this.audio.init();
    const seed = (Math.random() * 2147483647) | 0;
    this.rng = new Rng(seed);
    this.map = new GameMap(this.rng);
    this.player = new Player(this.map.spawn.x, this.map.spawn.y);
    this.survival = new Survival();
    this.noise = new NoiseSystem();
    this.vision = new Vision();
    this._resize();

    // botín en todos los contenedores
    for (const c of this.map.containers) fillContainer(c, this.rng);

    // horda
    this.zombies = spawnZombies(this.map, this.rng, ZOMBIE_CFG.count, this.map.spawn);

    // objetos iniciales garantizados
    this.groundItems = [];
    this._placeStartingLoot();

    // efectos de disparo limpios
    this.tracers.length = 0;
    this.flashes.length = 0;
    this.impacts.length = 0;
    this._dryToastT = 0;

    this.time = 0;
    this.kills = 0;
    this.searchedCount = 0;
    this.deathCause = null;
    this.cam.x = this.player.x - this.cam.w / 2;
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
  }

  // ================== Entrada ==================

  onAction(name) {
    if (this.state === STATE.MENU || this.state === STATE.DEAD) {
      if (name === 'enter') this.startRun();
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
    switch (name) {
      case 'interact': this.interact(); break;
      case 'inventory': this.invUI.openUI(null); break;
      case 'reload': reloadRanged(this); break;
      case 'hot1': hotbarUse(this, 0); break;
      case 'hot2': hotbarUse(this, 1); break;
      case 'hot3': hotbarUse(this, 2); break;
      case 'sneak': {
        this.player.sneak = !this.player.sneak;
        this.toasts.push(this.player.sneak ? 'Modo sigilo: más lento, más silencioso' : 'Sigilo desactivado');
        break;
      }
      case 'attack': playerAttack(this); break;
    }
  }

  togglePause() {
    if (this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.menus.showPause();
    } else if (this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.menus.hidePause();
      this._last = performance.now();
    }
  }

  // ================== Interacción con el mundo ==================

  interactTarget() {
    if (this.state !== STATE.PLAYING || this.uiOpen || !this.player) return null;
    const p = this.player;
    let best = null;

    for (const c of this.map.containers) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < 46 && (!best || d < best.d)) {
        best = { kind: 'container', obj: c, d, label: 'Registrar ' + c.name };
      }
    }
    for (const gi of this.groundItems) {
      const d = Math.hypot(gi.x - p.x, gi.y - p.y);
      if (d < 38 && (!best || d < best.d)) {
        best = { kind: 'item', obj: gi, d, label: 'Recoger ' + itemLabel(gi.item) };
      }
    }
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
    return best;
  }

  interact() {
    const target = this.interactTarget();
    if (!target) return;
    switch (target.kind) {
      case 'container': {
        const c = target.obj;
        if (!c.searched) { c.searched = true; this.searchedCount++; }
        this.noise.emit(this.player.x, this.player.y, 70, 'registro');
        this.audio.container();
        this.invUI.openUI(c);
        break;
      }
      case 'item': {
        const gi = target.obj;
        const fully = this.player.inventory.add(gi.item);
        if (fully) {
          const i = this.groundItems.indexOf(gi);
          if (i >= 0) this.groundItems.splice(i, 1);
          this.audio.pickup();
          this.toasts.push('Recogido: ' + itemLabel(gi.item));
          this.noise.emit(this.player.x, this.player.y, 30, 'recoger');
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
      if (blocked(this.player) || this.zombies.some(blocked)) {
        this.toasts.push('Algo bloquea la puerta', 'warn');
        return;
      }
      this.map.setTile(tx, ty, T.DOOR_CLOSED);
    } else {
      this.map.setTile(tx, ty, T.DOOR_OPEN);
    }
    this.audio.door();
    this.noise.emit(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 85, 'puerta');
  }

  // ================== Eventos de combate / muerte ==================

  combatZombieHit(z) { zombieHit(this, z); }

  killZombie(z) {
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    this.kills++;
    this.map.stampCorpse(z.x, z.y, z.face);
    this.map.stampBlood(z.x, z.y, true);
    this.audio.groan(0.7, 0);
    this.cam.shake(3);
  }

  onDeath(cause) {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.DEAD;
    this.input.enabled = false;
    this.deathCause = cause;
    this.hud.hide();
    this.map.stampCorpse(this.player.x, this.player.y, this.player.angle);
    this.map.stampBlood(this.player.x, this.player.y, true);
    this.menus.showDeath(cause, { time: this.time, kills: this.kills, searched: this.searchedCount });
  }

  // ================== Update ==================

  update(dt) {
    if (this.state !== STATE.PLAYING || this.uiOpen) return;

    this.time += dt;
    this.player.update(dt, this);
    this.player.inventory.setCapacity(this.player.capacity());

    // zombis (hacia atrás: pueden morir durante el frame)
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      this.zombies[i].update(dt, this);
      if (this.state !== STATE.PLAYING) return;
    }

    this.survival.update(dt, this, this.player.moving, this.player.running);
    if (this.state !== STATE.PLAYING) return;

    this.noise.update(dt);

    // recarga en curso → temporizador y aplicación al terminar
    if (this.player.reloading) {
      this.player.reloading.left -= dt;
      if (this.player.reloading.left <= 0) finishReload(this);
    }

    // fuego automático: mantener pulsado el botón con un rifle automático
    const eqGun = this.player.equipment.arma;
    if (this.input.mouse.down && eqGun && eqGun.def.auto) playerAttack(this);

    // Visión puramente en tiempo real: se recalcula cada frame, sin memoria
    this.vision.compute(this);

    // barra rápida: vacía las ranuras cuyo objeto ya no llevas
    hotbarValidate(this.player);

    // visibilidad de entidades (para render y lógica de "solo lo que ves")
    for (const z of this.zombies) z.visibleNow = this.vision.isVisible(z.x, z.y, this);
    for (const gi of this.groundItems) gi.visibleNow = this.vision.isVisible(gi.x, gi.y, this);

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
