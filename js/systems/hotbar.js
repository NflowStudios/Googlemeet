/**
 * hotbar.js — Barra rápida de 5 ranuras (teclas 1 · 2 · 3 · 4 · 5). (v0.17)
 *
 *  - Ranura 1: ARMA DE FUEGO principal      → tecla 1 la empuña / guarda.
 *  - Ranura 2: ARMA DE FUEGO SECUNDARIA     → tecla 2 (pistola de respaldo,
 *              revólver, lo que sea: otra arma de fuego).
 *  - Ranura 3: ARMA MELEE                   → tecla 3.
 *  - Ranuras 4 y 5: MISCELÁNEO              → teclas 4 y 5 (comida, bebida,
 *              medicina, ropa — la linterna vive aquí: equípala al vuelo).
 *
 * Las asignaciones se eligen DESDE EL INVENTARIO (botón «A la barra» o el
 * panel de barra rápida del modal). Las ranuras guardan una REFERENCIA al
 * objeto (que sigue viviendo en la mochila o en la mano): si el objeto se
 * suelta o se guarda en un contenedor, la ranura se vacía sola.
 */

/** Número de ranuras de la barra rápida (v0.17: 3 → 5). */
export const HOTBAR_N = 5;

/**
 * Ranura que le corresponde a un objeto según su categoría (v0.17):
 *  - arma de fuego → la principal (0) si está libre; si no, la secundaria (1);
 *    si las dos están ocupadas, reemplaza la principal.
 *  - arma melee → siempre la 2.
 *  - cualquier otra cosa (misceláneo) → la 3 si está libre; si no, la 4;
 *    si las dos están ocupadas, reemplaza la 3.
 * `player` es opcional (solo para elegir la primera ranura LIBRE).
 */
export function hotbarSlotFor(item, player) {
  const cat = item.def.cat;
  if (cat === 'arma') {
    if (!item.def.ranged) return 2;                 // melee → ranura 3
    if (!player) return 0;
    if (!player.hotbar[0]) return 0;                // principal libre
    if (!player.hotbar[1]) return 1;                // secundaria libre
    return 0;                                       // ambas llenas → principal
  }
  if (!player) return 3;
  if (!player.hotbar[3]) return 3;                  // primer misceláneo
  if (!player.hotbar[4]) return 4;                  // segundo misceláneo
  return 3;
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
  const slot = hotbarSlotFor(item, player);
  for (let i = 0; i < HOTBAR_N; i++) {
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
  for (let i = 0; i < HOTBAR_N; i++) {
    const it = player.hotbar[i];
    if (it && !stillOwned(player, it)) {
      player.hotbar[i] = null;
      changed = true;
    }
  }
  return changed;
}

/**
 * Tecla 1-5 pulsada: usar lo que haya en la ranura.
 *  - Arma: se empuña (si estaba en la mochila) o se guarda (si ya la llevas).
 *  - Comida/bebida/medicina: se consume una unidad al instante.
 *  - Ropa (incluida la linterna): se equipa en su ranura.
 *  - Pilas: aviso de que se gestionan solas.
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
    game.toasts.push('Equipado: ' + it.def.name +
      (it.def.flashlight ? ' — encendida (L para apagarla)' : ''));
    if (game.hud) game.hud.renderHotbar(game);
    return;
  }

  if (cat === 'bateria') {
    game.toasts.push('Las pilas alimentan la linterna solas mientras esté encendida', 'info');
    return;
  }

  game.toasts.push(it.def.name + ' no tiene uso rápido');
}
