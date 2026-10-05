/**
 * inventoryUI.js — Pantalla de inventario: equipo vestible + mochila +
 * panel de contenedor para saquear + PESTAÑA DE CRAFTEO (v0.20: recetas de
 * objetos y construcciones con validación de materiales y mesa de trabajo).
 * Llamar openUI(contenedor|null).
 */

import { EQUIP_SLOTS, EQUIP_LABELS, ITEMS, PROF_BY_ID } from '../config.js';
import { itemLabel, countItem } from '../systems/inventory.js';
import { hotbarAssign, hotbarClear, hotbarSlotFor } from '../systems/hotbar.js';
import {
  RECIPES_OBJ, RECIPES_CON, canCraft, missingMaterials, nearWorkbench, nearFogata,
  craftObject, startBuild, startPlant, cancelBuild,
} from '../systems/crafting.js';

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.container = null;
    this.selected = -1;
    this.tab = 'inv';        // v0.20: 'inv' | 'craft'
    this.craftTab = 'obj';   // v0.20: 'obj' | 'con'

    this.el = document.getElementById('inv-modal');
    this.gridEl = document.getElementById('inv-grid');
    this.contWrap = document.getElementById('inv-cont-wrap');
    this.contGrid = document.getElementById('cont-grid');
    this.contName = document.getElementById('cont-name');
    this.actionBar = document.getElementById('action-bar');
    this.capEl = document.getElementById('inv-cap');
    this.craftEl = document.getElementById('inv-craft');
    this.craftListEl = document.getElementById('craft-list');
    this.equipAside = document.getElementById('inv-equip');
    this.gridWrap = document.getElementById('inv-grid-wrap');

    // v0.20: pestañas superiores INVENTARIO | CRAFTEO
    document.querySelectorAll('#inv-tabs button').forEach((el) => {
      el.addEventListener('click', () => {
        if (this.tab === el.dataset.tab) return;
        this.tab = el.dataset.tab;
        if (this.tab === 'craft') this.selected = -1;
        this.game.audio.uiClick();
        this.render();
      });
    });
    // v0.20: sub-pestañas OBJETOS | CONSTRUCCIONES
    document.querySelectorAll('#craft-subtabs button').forEach((el) => {
      el.addEventListener('click', () => {
        if (this.craftTab === el.dataset.ctab) return;
        this.craftTab = el.dataset.ctab;
        this.game.audio.uiClick();
        this.render();
      });
    });

    // clic en una ranura de equipo → desequipar a la mochila
    document.querySelectorAll('#inv-equip .eq-slot').forEach(el => {
      el.addEventListener('click', () => {
        const slot = el.dataset.eq;
        const g = this.game;
        if (g.player.equipment[slot]) {
          if (g.player.unequip(slot)) {
            g.toasts.push('Guardado en la mochila');
            g.audio.pickup();
            this.render();
          } else {
            g.toasts.push('Mochila llena', 'warn');
          }
        }
      });
    });

    // clic en una ranura de la BARRA RÁPIDA → quitar la asignación
    document.querySelectorAll('#inv-hb-row .ihb-slot').forEach(el => {
      el.addEventListener('click', () => {
        const g = this.game;
        const i = +el.dataset.ihb;
        const it = g.player.hotbar[i];
        if (!it) return;
        hotbarClear(g.player, i);
        g.toasts.push('Quitada de la barra: ' + it.def.name);
        this.render();
      });
    });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  openUI(container) {
    this.container = container || null;
    this.selected = -1;
    const g = this.game;
    // v0.20: abrir el inventario cancela el modo construcción (sin fantasma
    // bajo el modal) y saquear un contenedor exige la pestaña del inventario
    if (g.build) cancelBuild(g, true);
    if (this.container) this.tab = 'inv';
    g.uiOpen = true;
    g.input.enabled = false;
    this.el.classList.remove('hidden');
    if (this.container) this.contWrap.classList.remove('hidden');
    else this.contWrap.classList.add('hidden');
    this.render();
  }

  closeUI() {
    const g = this.game;
    g.uiOpen = false;
    g.input.enabled = true;
    this.el.classList.add('hidden');
    this.container = null;
    this.selected = -1;
  }

  /** v0.25: abre el inventario DIRECTO en la pestaña CRAFTEO (sub-pestaña
   *  OBJETOS) — lo llama la FOGATA al pulsarla: su cocina a un clic. */
  openCraft() {
    this.openUI(null);
    this.tab = 'craft';
    this.craftTab = 'obj';
    this.render();
  }

  render() {
    const g = this.game, p = g.player, inv = p.inventory;
    inv.setCapacity(p.capacity());
    this.capEl.textContent = inv.used() + ' / ' + inv.capacity;

    // v0.20: estado de las pestañas + visibilidad de los paneles
    document.querySelectorAll('#inv-tabs button').forEach((el) => {
      el.classList.toggle('on', el.dataset.tab === this.tab);
    });
    const crafting = this.tab === 'craft';
    this.craftEl.classList.toggle('hidden', !crafting);
    this.equipAside.classList.toggle('hidden', crafting);
    this.gridWrap.classList.toggle('hidden', crafting);
    this.contWrap.classList.toggle('hidden', crafting || !this.container);
    if (crafting) {
      this._renderCraft();
      return;
    }

    // ranuras de equipo
    for (const slot of [...EQUIP_SLOTS, 'arma']) {
      const itemEl = document.querySelector(`.eq-slot[data-eq="${slot}"] .eq-item`);
      const it = p.equipment[slot];
      itemEl.textContent = it ? itemLabel(it) : '— vacío —';
      itemEl.parentElement.classList.toggle('filled', !!it);
    }

    // resumen de efectos del equipo
    document.getElementById('st-armor').textContent = Math.round(p.damageReduction() * 100) + '%';
    document.getElementById('st-infect').textContent = Math.round(p.infectProtection() * 100) + '%';
    document.getElementById('st-noise').textContent = Math.round(p.noiseMultiplier() * 100) + '%';
    // v0.24: la profesión de la partida (con su bono como tooltip)
    const profEl = document.getElementById('st-prof');
    if (profEl) {
      const d = p.prof && PROF_BY_ID[p.prof];
      profEl.textContent = d ? d.name : '—';
      profEl.title = d ? d.perks.join(' · ') : 'Sin profesión (partida clásica)';
    }

    // mochila
    this.gridEl.innerHTML = '';
    inv.slots.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'slot' + (it ? ' filled cat-' + it.def.cat + (it.rotten ? ' rotten' : '') : '')
        + (i === this.selected ? ' sel' : '');
      if (it) {
        let html = `<span class="slot-name">${itemLabel(it)}</span>`;
        if (it.count > 1) html += `<span class="slot-count">x${it.count}</span>`;
        d.innerHTML = html;
        d.title = it.def.desc || '';
      }
      d.addEventListener('click', () => {
        this.selected = (this.selected === i ? -1 : i);
        this.render();
      });
      this.gridEl.appendChild(d);
    });

    // barra rápida: estado de las 3 ranuras
    document.querySelectorAll('#inv-hb-row .ihb-slot').forEach(el => {
      const i = +el.dataset.ihb;
      const it = p.hotbar[i];
      const itemEl = el.querySelector('.ihb-item');
      el.classList.toggle('filled', !!it);
      if (it) {
        let n = itemLabel(it);
        if (p.equipment.arma === it) n += ' · EN MANO';
        itemEl.textContent = n;
        itemEl.classList.remove('empty');
        el.title = it.def.desc || '';
      } else {
        itemEl.textContent = '— vacía —';
        itemEl.classList.add('empty');
        el.title = '';
      }
    });

    // contenedor abierto
    if (this.container) {
      this.contName.textContent = this.container.name.toUpperCase();
      this.contGrid.innerHTML = '';
      if (!this.container.items.length) {
        const e = document.createElement('p');
        e.className = 'empty';
        e.textContent = 'Vacío';
        this.contGrid.appendChild(e);
      }
      this.container.items.forEach((it, ci) => {
        const d = document.createElement('div');
        d.className = 'slot filled cat-' + it.def.cat + (it.rotten ? ' rotten' : '');
        let html = `<span class="slot-name">${itemLabel(it)}</span>`;
        if (it.count > 1) html += `<span class="slot-count">x${it.count}</span>`;
        d.innerHTML = html;
        d.title = it.def.desc || '';
        d.addEventListener('click', () => this.take(ci));
        this.contGrid.appendChild(d);
      });
    }

    this._renderActions();
  }

  // ================== v0.20: panel de crafteo ==================

  /** Lista de recetas con materiales, validez y botón CRAFTEAR/CONSTRUIR. */
  _renderCraft() {
    const g = this.game;
    const list = this.craftListEl;
    list.innerHTML = '';
    document.querySelectorAll('#craft-subtabs button').forEach((el) => {
      el.classList.toggle('on', el.dataset.ctab === this.craftTab);
    });
    const recipes = this.craftTab === 'obj' ? RECIPES_OBJ : RECIPES_CON;
    const wb = nearWorkbench(g);
    const fire = nearFogata(g);   // v0.25: la cocina de la fogata

    for (const r of recipes) {
      const card = document.createElement('div');
      card.className = 'craft-recipe';

      // materiales: chips con lo que llevas de cada uno
      const miss = missingMaterials(g, r);
      const matsHtml = r.mats.map(([id, n]) => {
        const have = countItem(g.player.inventory, id);
        const ok = have >= n;
        return `<span class="cr-mat ${ok ? 'ok' : 'lack'}">${n}× ${ITEMS[id].name} <i>${have}/${n}</i></span>`;
      }).join('');

      const needWb = !!r.wb;
      const needFire = !!r.fire;   // v0.25: receta de asado
      const needMech = !!r.mech;  // v0.26: pieza de coche del MECÁNICO
      const ok = canCraft(g, r);
      let why = '';
      if (miss.length) why = 'Faltan materiales';
      else if (needMech && g.player.prof !== 'mecanico') why = 'Requiere la profesión MECÁNICO';
      else if (needWb && !wb) why = 'Requiere mesa de trabajo cerca';
      else if (needFire && !fire) why = 'Requiere fogata cerca';

      card.innerHTML = `
        <div class="cr-head">
          <span class="cr-icon" style="background:${r.icon}"></span>
          <span class="cr-name">${r.name}</span>
          ${needWb ? `<span class="cr-wb ${wb ? 'ok' : 'lack'}">MESA DE TRABAJO</span>` : ''}
          ${needFire ? `<span class="cr-wb ${fire ? 'ok' : 'lack'}">FOGATA</span>` : ''}
          ${needMech ? `<span class="cr-wb ${g.player.prof === 'mecanico' ? 'ok' : 'lack'}">MECÁNICO</span>` : ''}
        </div>
        <p class="cr-desc">${r.desc}</p>
        <div class="cr-mats">${matsHtml}</div>`;

      const btn = document.createElement('button');
      btn.className = 'cr-btn';
      btn.textContent = this.craftTab === 'obj' ? 'CRAFTEAR' : 'CONSTRUIR';
      if (!ok) {
        btn.disabled = true;
        btn.title = why;
        card.classList.add('locked');
      } else {
        btn.title = this.craftTab === 'obj'
          ? 'Craftear 1 unidad (va a la mochila)'
          : 'Entra en modo construcción: R rota · clic derecho coloca · clic izquierdo cancela';
        btn.addEventListener('click', () => {
          if (this.craftTab === 'obj') {
            if (craftObject(g, r)) this.render();
          } else {
            this.closeUI();
            startBuild(g, r.id);
          }
        });
      }
      card.appendChild(btn);
      list.appendChild(card);
    }

    // resumen de contexto (mesa/fogata cerca · planta)
    const info = document.getElementById('craft-wbinfo');
    if (info) {
      info.textContent = (wb ? 'Mesa de trabajo: CERCA' : 'Mesa de trabajo: lejos (o sin construir)') +
        ' · ' + (fire ? 'Fogata: CERCA (cocina de verduras)' : 'Fogata: lejos (o sin construir)') +
        ' · Construcciones solo en PLANTA BAJA';
      info.className = (wb || fire) ? 'ok' : '';
    }
  }

  _renderActions() {
    const bar = this.actionBar;
    const g = this.game, inv = g.player.inventory;
    const it = this.selected >= 0 ? inv.slots[this.selected] : null;
    bar.innerHTML = '';
    if (!it) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };
    if (it.def.cat === 'comida' || it.def.cat === 'bebida') mk('Consumir', () => this.consume(this.selected));
    if (it.def.cat === 'medico') mk('Usar', () => this.consume(this.selected));
    if (it.def.cat === 'arma' || it.def.cat === 'ropa') mk('Equipar', () => this.equipItem(this.selected));
    // v0.25: PLANTAR una semilla (modo siembra: fantasma sobre césped/acera)
    if (it.def.cat === 'semilla') {
      mk('Plantar', () => {
        const id = it.id;
        this.closeUI();
        startPlant(g, id);
      });
      const n = document.createElement('span');
      n.className = 'action-note';
      n.textContent = 'Sobre césped o acera · crece con los días · [E] cosechar madura';
      bar.appendChild(n);
    }
    {
      // v0.17: la ranura se elige según categoría y disponibilidad
      const slot = hotbarSlotFor(it, g.player);
      mk('A la barra (' + (slot + 1) + ')', () => this.toHotbar(this.selected));
    }
    if (it.def.cat === 'municion') {
      const n = document.createElement('span');
      n.className = 'action-note';
      n.textContent = 'Rellena sola tus cargadores compatibles';
      bar.appendChild(n);
    }
    if (it.def.cat === 'bateria') {
      const n = document.createElement('span');
      n.className = 'action-note';
      n.textContent = 'Alimentan la linterna automáticamente';
      bar.appendChild(n);
    }
    if (this.container) mk('Guardar', () => this.store(this.selected));
    mk('Soltar', () => this.drop(this.selected));
  }

  // ---------- acciones ----------

  consume(i) {
    const g = this.game, inv = g.player.inventory;
    const it = inv.slots[i];
    if (!it) return;
    const msg = g.survival.consume(it, g);
    if (it.def.cat === 'comida') g.audio.eat();
    else if (it.def.cat === 'bebida') g.audio.drink();
    g.toasts.push(msg, it.rotten ? 'bad' : 'info');
    if (it.count <= 1) inv.slots[i] = null;
    else it.count--;
    this.selected = -1;
    this.render();
  }

  equipItem(i) {
    const g = this.game, inv = g.player.inventory;
    const it = inv.removeAt(i);
    if (!it) return;
    g.player.equip(it);
    g.audio.pickup();
    g.toasts.push('Equipado: ' + itemLabel(it) +
      (it.def.flashlight && g.player.flashOn ? ' — encendida (L para apagarla)' : ''));
    this.selected = -1;
    this.render();
  }

  /** Asigna el objeto seleccionado a su ranura de la barra rápida. */
  toHotbar(i) {
    const g = this.game, inv = g.player.inventory;
    const it = inv.slots[i];
    if (!it) return;
    const slot = hotbarAssign(g.player, it);
    g.audio.pickup();
    g.toasts.push('Barra rápida ' + (slot + 1) + ': ' + it.def.name);
    if (g.hud) g.hud.renderHotbar(g);
    this.render();
  }

  drop(i) {
    const g = this.game, inv = g.player.inventory;
    const it = inv.removeAt(i);
    if (!it) return;
    const a = g.player.angle;
    const dx = g.player.x + Math.cos(a) * 26;
    const dy = g.player.y + Math.sin(a) * 26;
    // v0.27: en multijugador lo soltado se difunde (con su nid)
    if (g.mpDrop) {
      g.mpDrop(dx, dy, g.player.z || 0, it);
    } else {
      g.groundItems.push({
        x: dx, y: dy,
        z: g.player.z || 0,          // v0.19: la planta donde se suelta
        item: it, visibleNow: true,
      });
    }
    g.noise.emit(g.player.x, g.player.y, 30, 'soltar');
    g.audio.drop();
    this.selected = -1;
    this.render();
  }

  take(ci) {
    const g = this.game, c = this.container;
    const it = c.items[ci];
    const before = it.count;
    const fully = g.player.inventory.add(it);
    if (fully) {
      c.items.splice(ci, 1);
      // v0.27: el botín retirado se retira en TODAS las máquinas
      if (g.net) g.net.syncTake(c, ci);
      g.audio.pickup();
      g.toasts.push('Tomado: ' + itemLabel(it));
      // la munición tomada rellena sola los cargadores compatibles
      if (it.def.cat === 'municion') g.refillMags();
    } else if (it.count < before) {
      g.audio.pickup();
      g.toasts.push('Tomado parcialmente — mochila llena', 'warn');
      if (it.def.cat === 'municion') g.refillMags();
    } else {
      g.toasts.push('Mochila llena', 'warn');
    }
    this.render();
  }

  store(i) {
    const g = this.game, inv = g.player.inventory, c = this.container;
    const it = inv.removeAt(i);
    if (!it) return;
    // v0.26: la CAJUELA del coche (y cualquier contenedor con tope propio)
    // llena según sus huecos reales (modelo.storage); el resto, 8
    const cap = c.slots || 8;
    if (c.items.length >= cap) {
      inv.slots[i] = it;
      g.toasts.push('El contenedor está lleno', 'warn');
      return;
    }
    c.items.push(it);
    // v0.27: lo guardado aparece en TODAS las máquinas
    if (g.net) g.net.syncPut(c, it);
    g.audio.drop();
    g.toasts.push('Guardado');
    this.selected = -1;
    this.render();
  }
}
