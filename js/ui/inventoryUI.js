/**
 * inventoryUI.js — Pantalla de inventario: equipo vestible + mochila +
 * panel de contenedor para saquear. Llamar openUI(contenedor|null).
 */

import { EQUIP_SLOTS, EQUIP_LABELS } from '../config.js';
import { itemLabel } from '../systems/inventory.js';
import { hotbarAssign, hotbarClear, hotbarSlotFor } from '../systems/hotbar.js';

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.container = null;
    this.selected = -1;

    this.el = document.getElementById('inv-modal');
    this.gridEl = document.getElementById('inv-grid');
    this.contWrap = document.getElementById('inv-cont-wrap');
    this.contGrid = document.getElementById('cont-grid');
    this.contName = document.getElementById('cont-name');
    this.actionBar = document.getElementById('action-bar');
    this.capEl = document.getElementById('inv-cap');

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

  render() {
    const g = this.game, p = g.player, inv = p.inventory;
    inv.setCapacity(p.capacity());
    this.capEl.textContent = inv.used() + ' / ' + inv.capacity;

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
    g.groundItems.push({
      x: g.player.x + Math.cos(a) * 26,
      y: g.player.y + Math.sin(a) * 26,
      z: g.player.z || 0,          // v0.19: la planta donde se suelta
      item: it, visibleNow: true,
    });
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
    if (c.items.length >= 8) {
      inv.slots[i] = it;
      g.toasts.push('El contenedor está lleno', 'warn');
      return;
    }
    c.items.push(it);
    g.audio.drop();
    g.toasts.push('Guardado');
    this.selected = -1;
    this.render();
  }
}
