/**
 * hotbar.js — Barra rápida de 3 ranuras (teclas 1 · 2 · 3).
 *
 *  - Ranura 1: ARMA A DISTANCIA (arma de fuego)  → tecla 1 la empuña / guarda.
 *  - Ranura 2: ARMA MELEE                        → tecla 2 la empuña / guarda.
 *  - Ranura 3: OBJETO cualquiera                 → tecla 3 lo usa/consume.
 *
 * Las asignaciones se eligen DESDE EL INVENTARIO (botón «A la barra» o el
 * panel de barra rápida del modal). Las ranuras guardan una REFERENCIA al
 * objeto (que sigue viviendo en la mochila o en la mano): si el objeto se
 * suelta o se guarda en un contenedor, la ranura se vacía sola.
 */

/** Ranura de hotbar que le corresponde a un objeto según su categoría. */
export function hotbarSlotFor(item) {
  const cat = item.def.cat;
  if (cat === 'arma') return item.def.ranged ? 0 : 1; // 0 = a distancia, 1 = melee
  return 2;                                            // 2 = objeto cualquiera
}

/** ¿El objeto de una ranura sigue con el jugador (mochila o empuñada)? */
function stillOwned(player, it) {
  if (player.equipment.arma === it) return true;
  return player.inventory.slots.indexOf(it) >= 0;
}

/**
 * Asigna un objeto a su ranura (reemplaza lo que hubiera). Si el mismo
 * objeto ya estaba en otra ranura, se quita de ahí. Devuelve la ranura.
 */
export function hotbarAssign(player, item) {
  const slot = hotbarSlotFor(item);
  for (let i = 0; i < 3; i++) {
    if (player.hotbar[i] === item) player.hotbar[i] = null;
  }
  player.hotbar[slot] = item;
  return slot;
}

/** Quita lo que haya en una ranura (botón del panel del inventario). */
export function hotbarClear(player, i) {
  const it = player.hotbar[i];
  player.hotbar[i] = null;
  return it;
}

/**
 * Limpieza por frame: vacía las ranuras cuyo objeto ya no está con el
 * jugador (soltado, guardado en contenedor, consumido del todo…).
 * Devuelve true si algo cambió (para repintar el HUD).
 */
export function hotbarValidate(player) {
  let changed = false;
  for (let i = 0; i < 3; i++) {
    const it = player.hotbar[i];
    if (it && !stillOwned(player, it)) {
      player.hotbar[i] = null;
      changed = true;
    }
  }
  return changed;
}

/**
 * Tecla 1/2/3 pulsada: usar lo que haya en la ranura.
 *  - Arma: se empuña (si estaba en la mochila) o se guarda (si ya la llevas).
 *  - Comida/bebida/medicina: se consume una unidad al instante.
 *  - Ropa: se equipa en su ranura.
 *  - Otros: aviso de que no tienen uso rápido.
 */
export function hotbarUse(game, i) {
  const p = game.player;
  const it = p.hotbar[i];
  if (!it) {
    game.toasts.push('Ranura ' + (i + 1) + ' vacía — asígnala desde el inventario', 'warn');
    return;
  }
  if (!stillOwned(p, it)) {
    p.hotbar[i] = null;
    game.toasts.push('El objeto de la ranura ' + (i + 1) + ' ya no lo llevas', 'warn');
    if (game.hud) game.hud.renderHotbar(game);
    return;
  }

  const cat = it.def.cat;

  if (cat === 'comida' || cat === 'bebida' || cat === 'medico') {
    // ---- consumir una unidad sin abrir el inventario ----
    const msg = game.survival.consume(it, game);
    if (cat === 'comida') game.audio.eat();
    else if (cat === 'bebida') game.audio.drink();
    game.toasts.push(msg, it.rotten ? 'bad' : 'info');
    const idx = p.inventory.slots.indexOf(it);
    if (it.count <= 1) {
      if (idx >= 0) p.inventory.slots[idx] = null;
      p.hotbar[i] = null; // se acabó la pila
    } else {
      it.count--;
    }
    if (game.hud) game.hud.renderHotbar(game);
    return;
  }

  if (cat === 'arma') {
    if (p.equipment.arma === it) {
      // ya empuñada → guardar en la mochila (toggle)
      if (p.unequip('arma')) game.toasts.push('Guardada: ' + it.def.name);
      else game.toasts.push('Mochila llena', 'warn');
    } else {
      const idx = p.inventory.slots.indexOf(it);
      if (idx < 0) return;
      p.inventory.slots[idx] = null;
      p.equip(it); // aplica el tiempo de desenfunde (la funda lo acorta)
      game.audio.pickup();
      game.toasts.push('En mano: ' + it.def.name);
    }
    if (game.hud) game.hud.renderHotbar(game);
    return;
  }

  if (cat === 'ropa') {
    const idx = p.inventory.slots.indexOf(it);
    if (idx < 0) return;
    p.inventory.slots[idx] = null;
    p.equip(it);
    game.audio.pickup();
    game.toasts.push('Equipado: ' + it.def.name);
    if (game.hud) game.hud.renderHotbar(game);
    return;
  }

  game.toasts.push(it.def.name + ' no tiene uso rápido');
}
