/**
 * crafting.js — v0.20: EL CRAFTEO.
 *
 * Dos familias de recetas (pestaña «Crafteo» del inventario):
 *  - OBJETOS: consumibles y armas artesanales. Craftearlos los mete en la
 *    mochila tras validar y gastar los materiales.
 *  - CONSTRUCCIONES: barricadas, tablones, vallas, trampas, caja, cama y mesa
 *    de trabajo. NO se guardan en la mochila: CONSTRUIR activa el MODO
 *    CONSTRUCCIÓN — un fantasma transparente sigue al ratón sobre superficies
 *    válidas (verde) o inválidas (rojo/lejos), R lo rota, el CLIC DERECHO lo
 *    coloca (gastando ahí los materiales) y el izquierdo (o ESC) cancela.
 *
 * Las recetas marcadas `wb` exigen una MESA DE TRABAJO a ≤ CRAFTEO.wbRange.
 *
 * Las construcciones viven SOLO en planta baja (z=0): dentro de sus muros la
 * colisión/visión se despacha por rejilla de planta y no queremos fantasmas
 * flotando entre pisos.
 *
 * También vive aquí la pirotecnia: el CÓCTEL MOLOTOV (vuelo → estallido →
 * zona de FUEGO de 10 s que quema a zombis y jugador) y la QUEMADURA que la
 * ANTORCHA clava a los zombis.
 */

import { TILE, T, ITEMS, CRAFTEO as C, CROPS, AGRICULTURA as AG } from '../config.js';
import { makeItem, countItem, itemLabel } from './inventory.js';

// ================== RECETAS ==================

/**
 * mats: [[idItem, unidades], ...] — se validan y gastan contra la mochila.
 * wb:   true → requiere mesa de trabajo cerca (avances "de taller").
 */
export const RECIPES_OBJ = [
  {
    id: 'venda', out: 'venda', name: 'Venda', icon: '#e0dcc8',
    mats: [['tela', 2], ['alcohol_etilico', 1]],
    desc: 'Venda esterilizada casera. Cura 25 de vida en 5 s.',
  },
  {
    id: 'botiquin', out: 'botiquin', name: 'Botiquín', icon: '#d94a4a', wb: true,
    mats: [['tela', 3], ['alcohol_etilico', 2], ['cinta_adhesiva', 1]],
    desc: 'Botiquín de campaña cosido a cinta. +50 vida al instante.',
  },
  {
    id: 'molotov', out: 'molotov', name: 'Cóctel molotov', icon: '#b8c832',
    mats: [['botella_vacia', 1], ['queroseno', 1], ['tela', 1]],
    desc: 'Botella incendiaria. Al estallar: zona de FUEGO 10 s (22 dps a zombis, 9 a ti). Se LANZA equipada y atacando.',
  },
  {
    id: 'antorcha', out: 'antorcha', name: 'Antorcha', icon: '#d98a3a',
    mats: [['tablas', 1], ['tela', 1], ['queroseno', 1]],
    desc: 'Arma de fuego… la hoguera. Golpe débil (16) pero PRENDE: 3,5 s de quemadura (12 dps).',
  },
  {
    id: 'bate_con_clavos', out: 'bate_con_clavos', name: 'Bate con clavos', icon: '#8a6a4a', wb: true,
    mats: [['bate', 1], ['clavos', 6], ['cinta_adhesiva', 1]],
    desc: 'El clásico elevado a leyenda: daño 46 (el bate daba 34) y empuje brutal.',
  },
  {
    id: 'lanza_chatarra', out: 'lanza_chatarra', name: 'Lanza de chatarra', icon: '#7a8a92', wb: true,
    mats: [['tubo', 1], ['chatarra', 3], ['cinta_adhesiva', 2]],
    desc: 'Tubo con punta afilada: daño 26 pero alcance 66 — pincha ANTES de que te alcancen.',
  },
  // ---- v0.25: LA COCINA DE LA FOGATA (recetas `fire`: exigen una fogata
  // a ≤ AGRICULTURA.cookRange px, como las `wb` exigen la mesa de trabajo).
  // Cada verdura cruda del huerto se asa ×1: el fuego CASI DUPLICA su
  // alimento — la razón de ser del huerto. ----
  {
    id: 'tomate_asado', out: 'tomate_asado', name: 'Tomate asado', icon: '#b0402a', fire: true,
    mats: [['tomate', 1]],
    desc: 'Tomate del huerto pasado por la fogata: +12 → +20 de hambre (y +4 de sed).',
  },
  {
    id: 'zanahoria_asada', out: 'zanahoria_asada', name: 'Zanahoria asada', icon: '#b86a1a', fire: true,
    mats: [['zanahoria', 1]],
    desc: 'Zanahoria al rescoldo: +16 → +26 de hambre. Casi el doble que cruda.',
  },
  {
    id: 'calabaza_asada', out: 'calabaza_asada', name: 'Calabaza asada', icon: '#b8861a', fire: true,
    mats: [['calabaza', 1]],
    desc: 'Calabaza asada en la fogata: +22 → +36 de hambre. Comida seria de temporada.',
  },
  {
    id: 'maiz_asado', out: 'maiz_asado', name: 'Maíz asado', icon: '#c8b03a', fire: true,
    mats: [['maiz', 1]],
    desc: 'Mazorca a la brasa: +26 → +44 de hambre y +6 de energía. El mejor plato cultivado.',
  },
];

export const RECIPES_CON = [
  {
    id: 'barricada', name: 'Barricada (puerta)', icon: '#a87848',
    mats: [['tablas', 3], ['clavos', 4]],
    snap: 'door',
    desc: 'Tablones cruzados sobre una PUERTA: nadie pasa (ni tú) y nadie ve. Aguanta 140 de daño antes de ceder.',
  },
  {
    id: 'tapiar', name: 'Tablones de ventana', icon: '#98a8b0',
    mats: [['tablas', 2], ['clavos', 2]],
    snap: 'window',
    desc: 'Tapa la ventana: los zombis dejan de verte (y las balas dejan de pasar) a través del cristal. 100 de vida.',
  },
  {
    id: 'valla', name: 'Valla', icon: '#c8a878',
    mats: [['tablas', 2], ['clavos', 3]],
    free: true, rotatable: true,
    desc: 'Segmento de valla de madera (R la rota): cierres perímetros y canales a la horda. No tapa la vista. 90 de vida.',
  },
  {
    id: 'trampa', name: 'Trampa de pinchos', icon: '#9aa0a6', wb: true,
    mats: [['tablas', 1], ['clavos', 6], ['cinta_adhesiva', 1]],
    free: true,
    desc: 'Base con clavos de chatarra: 30 de daño por pisada a los zombis (tú la pisoteas impune). Aguanta 10 pisadas.',
  },
  {
    id: 'caja', name: 'Caja de almacenamiento', icon: '#b08a50',
    mats: [['tablas', 3], ['clavos', 6], ['cinta_adhesiva', 2]],
    free: true,
    desc: 'Cofre de 8 huecos (E para abrir): guarda lo que no lleves SIN perderlo. Se conserva al guardar la partida.',
  },
  {
    id: 'cama', name: 'Cama', icon: '#d8c8b0', wb: true,
    mats: [['tablas', 4], ['clavos', 8], ['tela', 3], ['cuerda', 1]],
    free: true, indoors: true,
    desc: 'Solo DENTRO de una casa. La casa se vuelve REFUGIO (nadie vuelve a aparecer dentro) y puedes DORMIR (E): pasas la noche y despiertas con energía y algo de vida.',
  },
  {
    id: 'mesa', name: 'Mesa de trabajo', icon: '#c8b890',
    mats: [['tablas', 2], ['clavos', 6], ['cinta_adhesiva', 1]],
    free: true,
    desc: 'Banco improvisado: estando a ≤ 140 px desbloquea las recetas marcadas «requiere mesa de trabajo».',
  },
  // ---- v0.25: LA FOGATA — la cocina del refugio. Brasas contenidas (no
  // dispara la alarma del fuego del molotov: esto es fuego DOMÉSTICO) que
  // asan las verduras del huerto a ≤ 90 px. De noche además brilla. ----
  {
    id: 'fogata', name: 'Fogata', icon: '#d98a3a',
    mats: [['tablas', 2], ['tela', 1]],
    free: true,
    desc: 'Círculo de piedras con leña y yesca. Con ella a ≤ 90 px puedes ASAR las verduras del huerto en la pestaña CRAFTEO (casi el doble de alimento). [E] junto a ella abre la cocina directamente. Sus brasas NO disparan la alarma del molotov.',
  },
];

// ================== VALIDACIÓN Y GASTO ==================

/** ¿Hay una mesa de trabajo a menos de wbRange px del jugador? */
export function nearWorkbench(game) {
  const p = game.player;
  // v0.21: la mesa vive en la planta baja — desde el sótano o el 2º piso no
  // cuenta (antes habilitaba recetas a través del techo)
  if ((p.z || 0) !== 0 || p.climb) return false;
  for (const c of game.constructions) {
    if (c.type !== 'mesa') continue;
    if (Math.hypot(c.x - p.x, c.y - p.y) <= C.wbRange) return true;
  }
  return false;
}

/** v0.25: ¿Hay una FOGATA a menos de AGRICULTURA.cookRange px? (misma
 *  planta, misma regla que la mesa de trabajo: las brasas de la baja no
 *  asan nada desde el sótano). */
export function nearFogata(game) {
  const p = game.player;
  if ((p.z || 0) !== 0 || p.climb) return false;
  for (const c of game.constructions) {
    if (c.type !== 'fogata') continue;
    if (Math.hypot(c.x - p.x, c.y - p.y) <= AG.cookRange) return true;
  }
  return false;
}

/** ¿Faltan materiales? Devuelve lista de [id, falta] de lo que falte. */
export function missingMaterials(game, recipe) {
  const miss = [];
  for (const [id, n] of recipe.mats) {
    const have = countItem(game.player.inventory, id);
    if (have < n) miss.push([id, n - have]);
  }
  return miss;
}

/** ¿Se puede craftear? (materiales + mesa de trabajo si aplica). */
export function canCraft(game, recipe) {
  if (missingMaterials(game, recipe).length) return false;
  if (recipe.wb && !nearWorkbench(game)) return false;
  if (recipe.fire && !nearFogata(game)) return false;   // v0.25: cocina de fogata
  return true;
}

/** Gasta los materiales de la mochila (cuenta ya validada). */
function consumeMaterials(game, recipe) {
  const inv = game.player.inventory;
  for (const [id, n] of recipe.mats) {
    let need = n;
    for (let i = 0; i < inv.slots.length && need > 0; i++) {
      const s = inv.slots[i];
      if (s && s.id === id && s.count > 0) {
        const take = Math.min(need, s.count);
        s.count -= take;
        need -= take;
        if (s.count <= 0) inv.slots[i] = null;
      }
    }
  }
}

/** Craftea un OBJETO: valida, gasta y añade a la mochila. true si ok. */
export function craftObject(game, recipe) {
  if (!canCraft(game, recipe)) return false;
  if (game.player.inventory.isFull()) {
    game.toasts.push('Mochila llena — no cabe lo crafteado', 'warn');
    return false;
  }
  consumeMaterials(game, recipe);
  game.player.inventory.add(makeItem(recipe.out));
  if (recipe.fire) game.audio.sizzle();   // v0.25: asado a la fogata
  else game.audio.craft();
  if (game.stats) game.stats.crafted++;   // v0.23: obituario
  game.toasts.push('Crafteado: ' + recipe.name, 'save');
  return true;
}

// ================== MODO CONSTRUCCIÓN ==================

/** Entra en modo construcción con la receta de construcción dada. */
export function startBuild(game, recipeId) {
  const recipe = RECIPES_CON.find((r) => r.id === recipeId);
  if (!recipe) return false;
  if ((game.player.z || 0) !== 0 || game.player.climb) {
    game.toasts.push('Solo se construye en la PLANTA BAJA', 'warn');
    return false;
  }
  if (!canCraft(game, recipe)) {
    game.toasts.push('Te faltan materiales (o mesa de trabajo)', 'warn');
    return false;
  }
  game.build = { recipe, rot: 0, tx: 0, ty: 0, x: 0, y: 0, valid: false, reason: 'Colócate cerca' };
  updateBuild(game);
  game.toasts.push('CONSTRUCCIÓN: ' + recipe.name + ' — R rota · CLIC DER. coloca · CLIC IZQ. cancela', 'info');
  return true;
}

/** Sale del modo construcción (clic izquierdo / ESC / inventario). */
export function cancelBuild(game, silent = false) {
  if (!game.build) return;
  game.build = null;
  if (!silent) game.toasts.push('Construcción cancelada');
}

// ================== v0.25: SIEMBRA ==================

/** Días que tarda un cultivo en madurar (con el bono del GRANJERO si
 *  aplica: growFast días MENOS, mínimo 1). El neutro de growFast es 0
 *  (es aditivo, no multiplicativo: sin granjero no se resta nada). */
export function cropGrowthDays(c, player) {
  const d = CROPS[c.crop] || { days: 3 };
  const fast = player && player.profMul ? player.profMul('growFast', 0) : 0;
  return Math.max(1, d.days - fast);
}

/** Etapa de un cultivo según el DÍA de juego actual:
 *  0 semilla · 1 brote · 2 planta · 3 MADURA ([E] cosecha) · 4 marchita.
 *  El reloj decide: no hay que actualizar nada a mano — plantar el día N
 *  y avanzar el reloj hace crecer la planta sola. */
export function cropStage(game, c) {
  const d = CROPS[c.crop];
  if (!d) return 0;
  const elapsed = game.daynight.day - c.plantedDay;
  const days = cropGrowthDays(c, game.player);
  if (elapsed >= days + AG.witherDays) return 4;   // se pasó de madura
  if (elapsed >= days) return 3;                   // lista para cosechar
  const k = elapsed / days;
  return k < 0.34 ? 0 : k < 0.67 ? 1 : 2;
}

/** Etiqueta del prompt del cultivo (cosecha / progreso / marchita). */
export function cropPromptLabel(game, c) {
  const d = CROPS[c.crop];
  if (!d) return 'Cultivo';
  const stage = cropStage(game, c);
  const days = cropGrowthDays(c, game.player);
  const elapsed = game.daynight.day - c.plantedDay;
  if (stage === 4) return 'Recoger semillas de ' + d.name + ' (marchita)';
  if (stage === 3) return 'Cosechar ' + d.name;
  const faltan = Math.max(1, Math.ceil(days - elapsed));
  return d.name + ' — creciendo (madura en ' + faltan + ' día' + (faltan > 1 ? 's' : '') + ')';
}

/** COSECHAR (E sobre un cultivo maduro): piezas de verdura a la mochila
 *  (a la tierra si no cabe). El GRANJERO duplica la cosecha. Una planta
 *  MARCHITA devuelve 1 semilla (perdiste la verdura, no la siembra).
 *  Devuelve true si hizo algo. */
export function harvestCrop(game, c) {
  const d = CROPS[c.crop];
  if (!d) return false;
  const stage = cropStage(game, c);
  const p = game.player;

  if (stage === 4) {
    // se pasó de madura: la planta devuelve una semilla y libera el tile
    const seed = makeItem(d.seed);
    if (!p.inventory.add(seed)) {
      game.toasts.push('Mochila llena — la semilla cae al suelo', 'warn');
      game.groundItems.push({ x: c.x, y: c.y, z: 0, item: seed, visibleNow: true });
    }
    game.toasts.push(d.name + ' marchita — recuperas 1 semilla', 'warn');
    removeConstruction(game, c);
    return true;
  }

  if (stage !== 3) {
    const faltan = Math.max(1, Math.ceil(cropGrowthDays(c, p) - (game.daynight.day - c.plantedDay)));
    game.toasts.push(d.name + ' aún no está madura — faltan ' + faltan + ' día' + (faltan > 1 ? 's' : ''), 'info');
    return false;
  }

  // piezas: base por dados de la cosecha × el bono del GRANJERO
  const mul = p.profMul ? p.profMul('cropYieldMul') : 1;
  const n = Math.max(1, Math.round((d.yield[0] + Math.floor(Math.random() * (d.yield[1] - d.yield[0] + 1))) * mul));
  const it = makeItem(c.crop);
  it.count = n;
  if (!p.inventory.add(it)) {
    game.toasts.push('Mochila llena — la cosecha cae al suelo', 'warn');
    game.groundItems.push({ x: c.x + (Math.random() - 0.5) * 12, y: c.y + (Math.random() - 0.5) * 12, z: 0, item: it, visibleNow: true });
  }
  game.audio.harvest();
  game.noise.emit(c.x, c.y, 35, 'cosecha');
  game.toasts.push('Cosechado: ' + d.name + ' ×' + n +
    (mul > 1 ? ' (GRANJERO ×' + mul + ')' : ''), 'save');
  removeConstruction(game, c);
  return true;
}

/** Entra en modo SIEMBRA con la semilla elegida del inventario (botón
 *  PLANTAR). El fantasma solo es válido sobre CÉSPED o ACERA (tierra al
 *  aire libre), como cualquier construcción libre. */
export function startPlant(game, seedId) {
  const cropKey = Object.keys(CROPS).find((k) => CROPS[k].seed === seedId);
  const d = cropKey && CROPS[cropKey];
  if (!d) return false;
  if ((game.player.z || 0) !== 0 || game.player.climb) {
    game.toasts.push('Solo se planta en la PLANTA BAJA', 'warn');
    return false;
  }
  if (countItem(game.player.inventory, seedId) < 1) {
    game.toasts.push('No te quedan semillas de ' + d.name.toLowerCase(), 'warn');
    return false;
  }
  // pseudo-receta compatible con el modo construcción: gasta 1 semilla
  const recipe = {
    id: 'cultivo', plant: true, crop: cropKey,
    name: 'Sembrar ' + d.name, icon: d.color,
    mats: [[seedId, 1]],
    desc: 'Semilla de ' + d.name.toLowerCase() + ' sobre tierra.',
  };
  game.build = { recipe, rot: 0, tx: 0, ty: 0, x: 0, y: 0, valid: false, reason: 'Colócate cerca' };
  updateBuild(game);
  game.toasts.push('SIEMBRA: ' + d.name + ' — madura en ' +
    cropGrowthDays({ crop: cropKey }, game.player) + ' día(s) · CLIC DER. planta · CLIC IZQ. cancela', 'info');
  return true;
}

/** Rota el fantasma (tecla R mientras se construye). */
export function rotateBuild(game) {
  if (!game.build) return;
  game.build.rot = (game.build.rot + 1) % 4;
  game.audio.uiClick();
  updateBuild(game);
}

/**
 * Recalcula el fantasma cada frame: posición (imán a puerta/ventana si la
 * receta lo pide, tile bajo el ratón si es libre) + validez (distancia al
 * jugador, tile libre, sin construcción ni contenedor, nadie pisando si es
 * sólida, interior si es la cama).
 */
export function updateBuild(game) {
  const b = game.build;
  if (!b) return;
  const p = game.player;
  const mw = game.cam.screenToWorld(game.input.mouse.x, game.input.mouse.y);
  const map = game.map;
  let tx = Math.floor(mw.x / TILE), ty = Math.floor(mw.y / TILE);
  let reason = '';

  if (b.recipe.snap) {
    // imán: puerta (barricada) o ventana (tablones) más cercana al ratón
    const want = b.recipe.snap === 'door' ? [T.DOOR_CLOSED, T.DOOR_OPEN] : [T.WINDOW];
    let best = null, bd = Infinity;
    const mtx = Math.floor(mw.x / TILE), mty = Math.floor(mw.y / TILE);
    for (let y = mty - 3; y <= mty + 3; y++) {
      for (let x = mtx - 3; x <= mtx + 3; x++) {
        if (!want.includes(map.tileAtIdx(x, y))) continue;
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
        const d = Math.hypot(cx - mw.x, cy - mw.y);
        if (d < bd && d <= C.snapR) { bd = d; best = { x, y }; }
      }
    }
    if (best) { tx = best.x; ty = best.y; }
    else reason = b.recipe.snap === 'door' ? 'Apunta a una puerta' : 'Apunta a una ventana';
  }

  b.tx = tx; b.ty = ty;
  b.x = tx * TILE + TILE / 2;
  b.y = ty * TILE + TILE / 2;

  // ---- validez ----
  const def = CON_DEFS[b.recipe.id];
  if (!reason) {
    const distP = Math.hypot(b.x - p.x, b.y - p.y);
    if (distP > C.range) reason = 'Demasiado lejos';

    const tile = map.tileAtIdx(tx, ty);
    if (!reason && b.recipe.snap) {
      // sobre puerta/ventana: solo choca si YA hay construcción ahí
      if (map.constrByTile.has(map.idx(tx, ty))) reason = 'Ya hay construcción ahí';
    } else if (!reason) {
      // libre: tile caminable (no muro/árbol/coche/puerta/ventana)
      if (tile === T.WALL || tile === T.TREE || tile === T.CAR ||
          tile === T.DOOR_CLOSED || tile === T.DOOR_OPEN || tile === T.WINDOW) {
        reason = 'Espacio no válido';
      } else if (map.constrByTile.has(map.idx(tx, ty))) {
        reason = 'Ya hay construcción ahí';
      } else if (map.containerAtTile(tx, ty)) {
        reason = 'Hay un contenedor ahí';
      } else if (b.recipe.indoors && !map.buildingAtTile(tx, ty)) {
        reason = 'La cama va DENTRO de una casa';
      } else if (b.recipe.plant && tile !== T.GRASS && tile !== T.SIDEWALK) {
        // v0.25: las semillas solo prenden en TIERRA al aire libre
        // (césped o acera): no en suelo interior, calles ni escaleras
        reason = 'Solo en tierra (césped o acera)';
      }
    }

    // sólidas (barricada/valla): nadie pisando el tile al colocar
    if (!reason && def.solid) {
      const inTile = (e) => Math.floor(e.x / TILE) === tx && Math.floor(e.y / TILE) === ty;
      if (inTile(p)) reason = 'Estás pisando el hueco';
      else if (game.zombies.some(inTile)) reason = 'Un zombi pisa el hueco';
    }
  }

  b.valid = !reason;
  b.reason = reason;
}

/**
 * CLIC DERECHO: coloca la construcción si el fantasma es válido. Gasta los
 * materiales AQUÍ (validación final contra trampas de estado) y crea el
 * objeto físico en el mundo.
 */
export function placeBuild(game) {
  const b = game.build;
  if (!b) return;
  updateBuild(game);
  if (!b.valid) {
    game.toasts.push(b.reason || 'Aquí no', 'warn');
    return;
  }
  const recipe = b.recipe;
  if (missingMaterials(game, recipe).length) {
    game.toasts.push('Ya no te quedan esos materiales', 'warn');
    cancelBuild(game, true);
    return;
  }
  consumeMaterials(game, recipe);
  // v0.25: sembrar — la semilla nace como construcción CULTIVO con su día
  // de siembra (la planta crecerá sola con los días del reloj de juego)
  const c = addConstruction(game, recipe.id, b.tx, b.ty, b.rot,
    recipe.plant ? recipe.crop : null, recipe.plant ? game.daynight.day : null);
  if (recipe.plant) game.audio.plant();
  else game.audio.hammer();
  if (game.stats) game.stats.built++;   // v0.23: obituario
  // clavar tablas hace un ruido que la cuadra entera oye (sembrar, apenas)
  game.noise.emit(c.x, c.y, recipe.plant ? 40 : 140, recipe.plant ? 'sembrar' : 'construir');
  game.toasts.push(recipe.plant
    ? 'Sembrado: ' + CON_NAMES.cultivo + ' de ' + CROPS[recipe.crop].name +
      ' — madura en ' + cropGrowthDays(c, game.player) + ' día(s)'
    : 'Construido: ' + recipe.name, 'save');
  if (recipe.id === 'cama') {
    game.toasts.push('La casa es un REFUGIO: nadie volverá a aparecer dentro. [E] para dormir', 'info');
  }
  cancelBuild(game, true);
}

// ================== CONSTRUCCIONES EN EL MUNDO ==================

/**
 * Definición de cada construcción: solidez (bloquea movimiento a TODOS),
 * opacidad (bloquea visión y balas), atacable por zombis atascados y qué
 * suelta al destrozarse.
 */
export const CON_DEFS = {
  barricada: { solid: true, opaque: true, zAtk: true, drop: [['tablas', 2]] },
  tapiar:    { solid: true, opaque: true, zAtk: true, drop: [['tablas', 1]] },
  valla:     { solid: true, opaque: false, zAtk: true, drop: [['tablas', 1]] },
  trampa:    { solid: false, opaque: false, zAtk: false, drop: [] },
  caja:      { solid: false, opaque: false, zAtk: false, drop: [['tablas', 1]] },
  cama:      { solid: false, opaque: false, zAtk: false, drop: [['tablas', 1], ['tela', 1]] },
  mesa:      { solid: false, opaque: false, zAtk: false, drop: [['tablas', 1]] },
  // v0.25: la fogata (frágil, no sólida) y los cultivos (pisan libre,
  // se destrozan a golpe limpio: protege tu huerto)
  fogata:    { solid: false, opaque: false, zAtk: false, drop: [['tablas', 1]] },
  cultivo:   { solid: false, opaque: false, zAtk: false, drop: [] },
};

/** Nombres legibles (toasts/interacción). */
export const CON_NAMES = {
  barricada: 'Barricada', tapiar: 'Tablones', valla: 'Valla',
  trampa: 'Trampa de pinchos', caja: 'Caja de almacenamiento',
  cama: 'Cama', mesa: 'Mesa de trabajo',
  fogata: 'Fogata', cultivo: 'Cultivo',
};

/** Crea una construcción en (tx, ty) y la registra en el mapa.
 *  v0.25: `crop`/`plantedDay` sólo para los CULTIVOS (qué se sembró y
 *  qué día del reloj: el crecimiento se lee del día actual). */
export function addConstruction(game, type, tx, ty, rot = 0, crop = null, plantedDay = null) {
  const map = game.map;
  const c = {
    type, tx, ty, rot: rot % 2,
    x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2,
    z: 0,
    hp: C.conHp[type] || 80,
    maxHp: C.conHp[type] || 80,
  };
  if (type === 'trampa') { c.uses = C.trapUses; c.tick = 0; }
  if (type === 'caja') { c.items = []; c.searched = false; c.name = 'Caja de almacenamiento'; }
  if (type === 'cultivo') {
    c.crop = crop;                     // id del CROPS ('tomate'…)
    c.plantedDay = plantedDay !== null ? plantedDay : game.daynight.day;
  }
  game.constructions.push(c);
  map.registerConstruction(c);
  if (type === 'cama') map.recalcBedBuildings(game.constructions);
  return c;
}

/** Quita la construcción del mundo (y del índice del mapa). */
export function removeConstruction(game, c) {
  const i = game.constructions.indexOf(c);
  if (i >= 0) game.constructions.splice(i, 1);
  game.map.unregisterConstruction(c);
  if (c.type === 'cama') game.map.recalcBedBuildings(game.constructions);
}

/**
 * Daña una construcción (golpes de zombi o del jugador). Al llegar a 0:
 * estruendo, suelta (parte de) sus materiales al suelo y —si era una caja—
 * también su contenido.
 */
export function damageConstruction(game, c, dmg, byPlayer) {
  c.hp -= dmg;
  game.audio.hitWood();
  if (byPlayer) game.cam.shake(2);
  if (c.hp <= 0) {
    // soltar materiales parciales + contenido de la caja
    const drops = [...(CON_DEFS[c.type].drop || [])];
    if (c.type === 'caja' && c.items) {
      for (const it of c.items) {
        game.groundItems.push({ x: c.x + (Math.random() - 0.5) * 14, y: c.y + (Math.random() - 0.5) * 14, z: 0, item: it, visibleNow: true });
      }
    }
    for (const [id, n] of drops) {
      const it = makeItem(id);
      it.count = n;
      game.groundItems.push({ x: c.x + (Math.random() - 0.5) * 14, y: c.y + (Math.random() - 0.5) * 14, z: 0, item: it, visibleNow: true });
    }
    game.audio.crash();
    game.noise.emit(c.x, c.y, 160, 'destrozo');
    if (byPlayer) game.toasts.push('Has destrozado: ' + CON_NAMES[c.type]);
    removeConstruction(game, c);
  }
}

// ================== v0.23: REPARACIÓN ==================

/** Construcciones con prompt de REPARAR cuando están dañadas. La caja y la
 *  cama conservan su acción propia (abrir/dormir) pase lo que pase; las
 *  demás no tienen interacción — la reparación ES su interacción cuando
 *  están tocadas. La trampa al repararse además re-arma sus pinchos. */
export const REPAIRABLE = ['barricada', 'tapiar', 'valla', 'trampa', 'mesa'];

/** ¿Dañada y reparable? (E sobre ella ofrece REPARAR). */
export function needsRepair(c) {
  return REPAIRABLE.includes(c.type) && c.hp < c.maxHp - 0.5;
}

/**
 * Coste de reparación — MÁS DAÑADA = MÁS MATERIALES: la parte proporcional
 * de la vida que falta, redondeada hacia arriba POR MATERIAL, con mínimo 1.
 * Un tablón a medias (50%) de la barricada (3 tablas + 4 clavos) pide
 * 2 tablas + 2 clavos; al 90%, casi la receta entera (3 + 4).
 * v0.24: `player` opcional — si es CARPINTERO, su oficio abarata la
 * reparación (la MITAD de materiales). Sin player (o sin profesión) se
 * devuelve el coste base, byte a byte igual que en la v0.23.
 * Devuelve [[idItem, n], …] o null si está intacta / no reparable.
 */
export function repairCost(c, player) {
  if (!needsRepair(c)) return null;
  const recipe = RECIPES_CON.find((r) => r.id === c.type);
  if (!recipe) return null;
  const missing = 1 - Math.max(0, c.hp) / c.maxHp;   // 0..1
  const disc = player && player.profMul ? player.profMul('repairMul') : 1;
  return recipe.mats.map(([id, n]) => [id, Math.max(1, Math.ceil(n * missing * disc))]);
}

/** Etiqueta compacta del coste para el prompt: «2 tablas + 2 clavos». */
export function repairCostLabel(cost) {
  return cost.map(([id, n]) => n + ' ' + (ITEMS[id]?.name || id).toLowerCase()).join(' + ');
}

/**
 * REPARAR (E): valida materiales, los gasta y devuelve la construcción a la
 * vida MÁXIMA. Golpear tablas hace el mismo ruido que construirlas (140 px)
 * — reparar bajo asedio tiene su precio. true si la reparó.
 */
export function repairConstruction(game, c) {
  const cost = repairCost(c, game.player);   // v0.24: con el bono del CARPINTERO
  if (!cost) return false;
  const miss = [];
  for (const [id, n] of cost) {
    if (countItem(game.player.inventory, id) < n) miss.push([id, n]);
  }
  if (miss.length) {
    game.toasts.push('Te faltan materiales: ' + miss.map(([id, n]) =>
      n + ' ' + (ITEMS[id]?.name || id).toLowerCase()).join(' + '), 'warn');
    return false;
  }
  const inv = game.player.inventory;
  for (const [id, n] of cost) {
    let need = n;
    for (let i = 0; i < inv.slots.length && need > 0; i++) {
      const s = inv.slots[i];
      if (s && s.id === id && s.count > 0) {
        const take = Math.min(need, s.count);
        s.count -= take;
        need -= take;
        if (s.count <= 0) inv.slots[i] = null;
      }
    }
  }
  c.hp = c.maxHp;
  if (c.type === 'trampa') c.uses = C.trapUses;   // afilar los pinchos los re-arma
  game.audio.hammer();
  game.noise.emit(c.x, c.y, 140, 'reparar');
  game.cam.shake(1.5);
  game.toasts.push(CON_NAMES[c.type] + ' reparada — vida al máximo', 'save');
  return true;
}

/** ¿La cama está libre de compañía para dormir? */
function areaSafeToSleep(game) {
  const p = game.player;
  for (const z of game.zombies) {
    if ((z.z || 0) !== (p.z || 0)) continue;
    if (Math.hypot(z.x - p.x, z.y - p.y) < C.sleepSafeR) return false;
  }
  return true;
}

/**
 * DORMIR (E sobre la cama): solo sin compañía en 260 px. La pantalla se
 * funde a negro (game.sleepT), el mundo se congela un momento y amanece
 * descansado: el reloj salta a las 07:00 siguiente (o +4 h si es de día),
 * energía al máximo, +10 vida y un pelín más de hambre/sed.
 */
export function sleepInBed(game) {
  const p = game.player;
  if (p.climb) return;
  if (!areaSafeToSleep(game)) {
    game.toasts.push('Hay zombis DEMASIADO cerca para dormir', 'warn');
    game.audio.groan(0.6, 0, 0.8);
    return;
  }
  const dn = game.daynight;
  const h = dn.hour;
  // de noche (20:00–06:00) se duerme HASTA las 07:00; de día, siesta de 4 h
  let target;
  if (h >= DAYNIGHT_NIGHT_FROM || h < 7) {
    const delta = h >= DAYNIGHT_NIGHT_FROM ? (24 - h + 7) : (7 - h);
    target = dn.t + delta * DAYNIGHT_HOUR_SEC;
  } else {
    target = dn.t + 4 * DAYNIGHT_HOUR_SEC;
  }
  game.sleepT = 1.4;                    // fundido a negro (render/update)
  game._sleepTarget = target;
  game.audio.heal();
  game.toasts.push('Duermes profundamente…', 'info');
}

/** Constantes de reloj (para no importar DAYNIGHT entero aquí). */
const DAYNIGHT_HOUR_SEC = 30;   // 1 h de juego = 30 s reales
const DAYNIGHT_NIGHT_FROM = 20;

/** Aplica el despertar cuando expira el fundido (llamado desde main.update). */
export function finishSleep(game) {
  const dn = game.daynight;
  const target = game._sleepTarget;
  game._sleepTarget = null;
  const wasNight = dn.hour >= DAYNIGHT_NIGHT_FROM || dn.hour < 7;
  if (target) {
    dn.t = target;
    game._hourMark = Math.floor(dn.hour);      // sin ráfaga de respawns
    game._onHourChange(Math.floor(dn.hour));   // un único evento de hora
  }
  game.survival.stamina = game.survival.maxStamina;
  game.player.exhausted = false;
  game.survival.health = Math.min(100, game.survival.health + C.sleepHeal);
  game.survival.hunger = Math.max(0, game.survival.hunger - 6);
  game.survival.thirst = Math.max(0, game.survival.thirst - 8);
  game.toasts.push(wasNight
    ? 'Amaneces descansado: energía al máximo, +' + C.sleepHeal + ' vida'
    : 'Siesta reparadora: energía al máximo', 'save');
}

// ================== FUEGO (molotov + quemaduras) ==================

/** Lanza el molotov equipado hacia el apuntado (combat.js lo llama). */
export function throwMolotov(game) {
  const p = game.player;
  const it = p.equipment.arma;
  if (!it || !it.def.throwable) return false;
  if (p.cooldown > 0) return false;
  p.cooldown = 0.55;
  game.audio.swing();
  if (game.stats) game.stats.molotovs++;   // v0.23: obituario
  game.molotovs.push({
    x: p.x + Math.cos(p.angle) * (p.r + 6),
    y: p.y + Math.sin(p.angle) * (p.r + 6),
    vx: Math.cos(p.angle) * C.throwSpd,
    vy: Math.sin(p.angle) * C.throwSpd,
    t: 0, z: p.z || 0,
  });
  // consumir unidad (la pila viaja entera en la mano)
  it.count--;
  game.toasts.push('¡Molotov lanzado!', 'info');
  if (it.count <= 0) {
    p.equipment.arma = null;
    game.toasts.push('Se acabaron los cócteles');
  }
  return true;
}

/** Estallido: zona de fuego + ignición directa de quien esté encima.
 *  v0.23: LA ALARMA — el CRISTAL ROTO al estallar hace un ruido fuerte y
 *  seco (fireBreakNoise px), y a partir de aquí el propio fuego pulsa
 *  atracción cada fireAlarmEvery s mientras arda (ver updateFire). */
function igniteFire(game, x, y, z) {
  game.fires.push({ x, y, z: z || 0, r: C.fireR, t: C.fireDur, alarmT: 0 });
  game.audio.ignite();
  game.audio.glassBreak();
  game.cam.shake(5);
  // el cristal estalla: ruido seco que ya atrae a los cercanos
  game.noise.emit(x, y, C.fireBreakNoise, 'cristal', 'fire');
  if (!game._fireAlertSeen) {
    game._fireAlertSeen = true;
    game.toasts.push('ALERTA: el CRISTAL ROTO hace ruido y las LLAMAS se ven de lejos — atraerán zombis', 'warn');
  }
  // chorro inicial: prende a los que ya están encima
  for (const zb of game.zombies) {
    if ((zb.z || 0) !== (z || 0)) continue;
    if (Math.hypot(zb.x - x, zb.y - y) <= C.fireR) zb.burn = Math.max(zb.burn || 0, C.burnDur + 1);
  }
}

/** Avanza vuelo del molotov, zonas de fuego y quemaduras (main.update). */
export function updateFire(game, dt) {
  // ---- botellas en vuelo ----
  for (let i = game.molotovs.length - 1; i >= 0; i--) {
    const m = game.molotovs[i];
    m.t += dt;
    const nx = m.x + m.vx * dt, ny = m.y + m.vy * dt;
    let boom = false;
    // muro/estructura/puerta cerrada delante (el cristal de ventana pasa)
    if (game.map.circleHitsSolidZ(nx, ny, 3, m.z)) boom = true;
    else {
      // impacto directo en zombi de la misma planta
      for (const zb of game.zombies) {
        if ((zb.z || 0) !== m.z) continue;
        if (Math.hypot(zb.x - nx, zb.y - ny) < zb.r + 3) {
          zb.burn = Math.max(zb.burn || 0, C.burnDur + 1.5);   // impacto directo: más
          boom = true;
          break;
        }
      }
    }
    if (boom || m.t >= C.throwMax) {
      igniteFire(game, nx, ny, m.z);
      game.molotovs.splice(i, 1);
    } else {
      m.x = nx; m.y = ny;
    }
  }

  // ---- zonas de fuego ----
  for (let i = game.fires.length - 1; i >= 0; i--) {
    const f = game.fires[i];
    f.t -= dt;
    if (f.t <= 0) { game.fires.splice(i, 1); continue; }
    // daño constante a los zombis de la misma planta que estén dentro
    for (const zb of game.zombies) {
      if ((zb.z || 0) !== f.z) continue;
      if (Math.hypot(zb.x - f.x, zb.y - f.y) <= f.r) {
        zb.burn = Math.max(zb.burn || 0, 0.8);   // mantiene ardiendo dentro
        zb.hp -= C.fireDpsZ * dt;
        zb.flash = Math.max(zb.flash, 0.1);
        if (zb.hp <= 0) game.killZombie(zb);
      }
    }
    // …y al jugador si se queda dentro (silencioso: sin shake por frame)
    const p = game.player;
    if ((p.z || 0) === f.z && !p.climb &&
        Math.hypot(p.x - f.x, p.y - f.y) <= f.r) {
      game.survival.damage(C.fireDpsP * dt, 'quemadura', game, true);
      p.hurtFlash = Math.max(p.hurtFlash, 0.12);
    }
    // v0.23 — EL FUEGO ES UNA ALARMA: las llamas SE VEN desde lejos. Cada
    // fireAlarmEvery s emiten un pulso de atracción de fireAlarmR px (anillo
    // naranja en el suelo): todo zombi que no esté ya persiguiendo al
    // jugador se acerca a mirar. Prender fuego despeja la zona… y luego la
    // LLENA. La lluvia amortigua el ruido, pero el resplandor no cambia.
    f.alarmT -= dt;
    if (f.alarmT <= 0) {
      f.alarmT = C.fireAlarmEvery;
      game.noise.emit(f.x, f.y, C.fireAlarmR, 'fuego', 'fire');
    }
  }
}

// ================== TICK DE CONSTRUCCIONES ==================

/** Trampas + zombis golpeando lo que les bloquea (main.update). */
export function updateConstructions(game, dt) {
  // ---- trampas de pinchos ----
  for (let i = game.constructions.length - 1; i >= 0; i--) {
    const c = game.constructions[i];
    if (c.type !== 'trampa') continue;
    c.tick -= dt;
    if (c.tick > 0) continue;
    c.tick = C.trapEvery;
    for (const zb of game.zombies) {
      if ((zb.z || 0) !== 0) continue;
      if (Math.abs(zb.x - c.x) < 17 && Math.abs(zb.y - c.y) < 17) {
        zb.hp -= C.trapDmg;
        zb.flash = 0.14;
        game.map.stampBlood(zb.x, zb.y);
        c.uses--;
        game.audio.hitFlesh();
        if (zb.hp <= 0) game.killZombie(zb);
        if (c.uses <= 0) {
          game.toasts.push('Una trampa de pinchos quedó inservible', 'warn');
          removeConstruction(game, c);
          break;
        }
      }
    }
  }
}

// ================== RENDER ==================

/** Arte de una construcción en (sx, sy) de pantalla. Compartido fantasma/mundo. */
export function drawConstruction(ctx, c, sx, sy) {
  const dmg = c.hp !== undefined && c.hp < c.maxHp * 0.55;
  const wood = dmg ? '#7a5a38' : '#a87848';
  const wood2 = dmg ? '#8a6a42' : '#b88a58';
  const dark = '#4a3420';

  switch (c.type) {
    case 'barricada': {
      // tablones cruzados clavados sobre la puerta
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(sx - 15, sy - 14, 30, 28);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(0.22);
      ctx.fillStyle = wood; ctx.fillRect(-17, -13, 34, 7);
      ctx.fillStyle = wood2; ctx.fillRect(-16, -4, 33, 6);
      ctx.fillStyle = wood; ctx.fillRect(-15, 5, 32, 7);
      ctx.restore();
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-0.30);
      ctx.fillStyle = wood2; ctx.fillRect(-14, -12, 28, 6);
      ctx.restore();
      // cabezas de clavo
      ctx.fillStyle = '#d8d8e0';
      for (const [nx, ny] of [[-13, -10], [11, -8], [-12, 2], [12, 8], [-10, 9], [9, -1]]) {
        ctx.fillRect(sx + nx, sy + ny, 2, 2);
      }
      break;
    }
    case 'tapiar': {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(sx - 15, sy - 12, 30, 26);
      ctx.fillStyle = wood; ctx.fillRect(sx - 15, sy - 10, 30, 8);
      ctx.fillStyle = wood2; ctx.fillRect(sx - 14, sy - 1, 28, 7);
      ctx.fillStyle = wood; ctx.fillRect(sx - 15, sy + 6, 30, 7);
      // travesaño diagonal
      ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx - 13, sy - 9); ctx.lineTo(sx + 13, sy + 11); ctx.stroke();
      ctx.fillStyle = '#d8d8e0';
      ctx.fillRect(sx - 12, sy - 8, 2, 2); ctx.fillRect(sx + 10, sy - 7, 2, 2);
      ctx.fillRect(sx - 11, sy + 7, 2, 2); ctx.fillRect(sx + 9, sy + 8, 2, 2);
      break;
    }
    case 'valla': {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(sx - 15, sy - 10, 30, 22);
      const vert = !!c.rot;
      ctx.save();
      ctx.translate(sx, sy);
      if (vert) ctx.rotate(Math.PI / 2);
      // postes
      ctx.fillStyle = dark;
      ctx.fillRect(-14, -11, 5, 24);
      ctx.fillRect(9, -11, 5, 24);
      // travesaños
      ctx.fillStyle = wood; ctx.fillRect(-12, -8, 24, 5);
      ctx.fillStyle = wood2; ctx.fillRect(-12, 2, 24, 5);
      ctx.restore();
      break;
    }
    case 'trampa': {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(sx - 13, sy - 10, 26, 20);
      ctx.fillStyle = wood; ctx.fillRect(sx - 13, sy - 8, 26, 15);
      // pinchos
      ctx.fillStyle = '#c8c8d0';
      for (const [px, py] of [[-9, -2], [-4, -3], [1, -2], [6, -3], [10, -2], [-7, 5], [-1, 4], [5, 5]]) {
        ctx.beginPath();
        ctx.moveTo(sx + px - 2, sy + py + 4);
        ctx.lineTo(sx + px, sy + py - 5);
        ctx.lineTo(sx + px + 2, sy + py + 4);
        ctx.closePath();
        ctx.fill();
      }
      // marcas de uso
      if (c.uses !== undefined && c.uses < 4) {
        ctx.strokeStyle = 'rgba(120,20,20,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx - 10, sy - 6); ctx.lineTo(sx + 8, sy + 5); ctx.stroke();
      }
      break;
    }
    case 'caja': {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(sx - 12, sy - 9, 26, 22);
      ctx.fillStyle = wood; ctx.fillRect(sx - 13, sy - 12, 26, 23);
      ctx.fillStyle = wood2; ctx.fillRect(sx - 13, sy - 12, 26, 5);
      ctx.strokeStyle = dark; ctx.lineWidth = 2;
      ctx.strokeRect(sx - 13, sy - 12, 26, 23);
      ctx.beginPath(); ctx.moveTo(sx - 13, sy - 12); ctx.lineTo(sx + 13, sy + 11); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 13, sy - 12); ctx.lineTo(sx - 13, sy + 11); ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 11px Rajdhani, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('A', sx, sy);
      break;
    }
    case 'cama': {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(sx - 15, sy - 12, 32, 26);
      // somier
      ctx.fillStyle = dark; ctx.fillRect(sx - 15, sy - 12, 30, 24);
      // colchón
      ctx.fillStyle = dmg ? '#b0a494' : '#d8c8b0';
      ctx.fillRect(sx - 13, sy - 10, 26, 20);
      // almohada
      ctx.fillStyle = '#e8e0d0';
      ctx.fillRect(sx - 12, sy - 9, 9, 7);
      // manta
      ctx.fillStyle = '#8a5a4a';
      ctx.fillRect(sx - 13, sy + 1, 26, 9);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx - 6, sy + 1); ctx.lineTo(sx - 6, sy + 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 3, sy + 1); ctx.lineTo(sx + 3, sy + 10); ctx.stroke();
      break;
    }
    case 'mesa': {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(sx - 15, sy - 10, 32, 22);
      // tablero
      ctx.fillStyle = wood; ctx.fillRect(sx - 15, sy - 10, 30, 16);
      ctx.fillStyle = wood2; ctx.fillRect(sx - 15, sy - 10, 30, 4);
      // herramientas encima: martillo + sierra estilizados
      ctx.strokeStyle = '#8a8a92'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - 8, sy - 4); ctx.lineTo(sx - 2, sy - 4); ctx.stroke();
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(sx - 8, sy - 6, 4, 3);
      ctx.fillStyle = '#d8d8e0';
      ctx.fillRect(sx + 3, sy - 5, 2, 2); ctx.fillRect(sx + 6, sy - 5, 2, 2);
      // patas
      ctx.fillStyle = dark;
      ctx.fillRect(sx - 13, sy + 6, 4, 6); ctx.fillRect(sx + 9, sy + 6, 4, 6);
      break;
    }
    // ---- v0.25: FOGATA — círculo de piedras, leña cruzada y BRASAS con
    // su halo cálido (fuego doméstico: brilla de noche pero NO dispara
    // la alarma de atracción del molotov). ----
    case 'fogata': {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(sx - 14, sy - 11, 30, 24);
      // tierra removida del centro
      ctx.fillStyle = '#3a2e22';
      ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
      // piedras del círculo
      ctx.fillStyle = '#8a8a92';
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + 0.39;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * 12, sy + Math.sin(a) * 10, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // leña cruzada
      ctx.strokeStyle = dmg ? '#5a4028' : '#7a5a34';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx - 8, sy - 5); ctx.lineTo(sx + 8, sy + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 8, sy - 5); ctx.lineTo(sx - 8, sy + 5); ctx.stroke();
      // brasas + llamitas contenidas
      const fl = 2.2 + Math.sin((c._t || 0) * 7) * 0.8;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 20);
      g.addColorStop(0, 'rgba(255, 150, 50, 0.30)');
      g.addColorStop(1, 'rgba(255, 90, 20, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, 20, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255, 170, 60, 0.85)';
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy + 2); ctx.lineTo(sx, sy - fl - 2); ctx.lineTo(sx + 3, sy + 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255, 110, 20, 0.8)';
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy + 4); ctx.lineTo(sx - 2, sy - fl * 0.6); ctx.lineTo(sx + 1, sy + 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c8442a';
      ctx.beginPath(); ctx.arc(sx - 3, sy + 5, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 4, sy + 4, 1.4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    // ---- v0.25: CULTIVO — tierra arada que crece CON LOS DÍAS: semilla
    // (montículo) → brote (dos hojitas) → planta (mata frondosa) → MADURA
    // (con el fruto del color de su verdura) → MARCHITA (parda, caída). ----
    case 'cultivo': {
      const d = CROPS[c.crop] || CROPS.tomate;
      const stage = c._stage !== undefined ? c._stage : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(sx - 13, sy - 9, 28, 20);
      // surco de tierra arada
      ctx.fillStyle = '#4a3626';
      ctx.fillRect(sx - 12, sy - 7, 26, 16);
      ctx.fillStyle = '#5a4430';
      ctx.fillRect(sx - 12, sy - 7, 26, 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx - 8, sy + 2); ctx.lineTo(sx + 8, sy + 2); ctx.stroke();
      if (stage === 0) {
        // semilla enterrada: montículo con puntito
        ctx.fillStyle = '#6a5238';
        ctx.beginPath(); ctx.arc(sx, sy + 1, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = d.color;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      } else if (stage === 4) {
        // marchita: tallos pardos caídos
        ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy + 3); ctx.lineTo(sx - 6, sy - 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx, sy + 3); ctx.lineTo(sx + 6, sy - 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx, sy + 3); ctx.lineTo(sx, sy - 7); ctx.stroke();
      } else {
        // brote → planta: tallo + hojas que crecen con la etapa
        const hgt = stage === 1 ? 6 : 11;
        ctx.strokeStyle = d.leaf; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx, sy + 4 - hgt); ctx.stroke();
        ctx.fillStyle = d.leaf;
        ctx.beginPath(); ctx.ellipse(sx - 4, sy + 5 - hgt * 0.6, 4, 2, -0.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(sx + 4, sy + 5 - hgt * 0.6, 4, 2, 0.6, 0, Math.PI * 2); ctx.fill();
        if (stage === 3) {
          // MADURA: el fruto del color de su verdura, bien visible
          ctx.fillStyle = d.color;
          ctx.beginPath(); ctx.arc(sx, sy - hgt - 1, 4.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(sx, sy - hgt - 1, 4.5, 0, Math.PI * 2); ctx.stroke();
          // destello de «lista»
          ctx.fillStyle = 'rgba(255,255,220,0.8)';
          ctx.fillRect(sx - 2, sy - hgt - 3, 1.5, 1.5);
        }
      }
      break;
    }
  }

  // barra de vida si está dañada (como los zombis)
  if (c.hp !== undefined && c.hp < c.maxHp && c.hp > 0) {
    const w = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(sx - w / 2, sy - 18, w, 3);
    ctx.fillStyle = '#c8a03a';
    ctx.fillRect(sx - w / 2, sy - 18, w * Math.max(0, c.hp / c.maxHp), 3);
  }
}

/**
 * Dibuja todas las construcciones visibles (render.js, capa de entidades).
 * v0.21: las construcciones viven SOLO en la planta baja. Antes se pintaban
 * siempre y, al subir al 2º piso o bajar al sótano, quedaban POR ENCIMA del
 * canvas opaco de esa planta — «se veían a través del techo» (bug reportado:
 * las barricadas/vallas de la baja flotaban sobre el sótano y el hospital).
 * Ahora solo se dibujan desde la planta baja, y al empezar a subir/bajar la
 * escalera se funden con la baja (simétrico al fundido de la planta destino).
 */
export function drawConstructions(ctx, cam, game) {
  const p = game.player;
  const pz = p ? (p.climb ? p.climb.to : (p.z || 0)) : 0;
  if (pz !== 0) return;                       // en planta extra: nada de la baja
  let fade = 1;
  if (p && p.climb) fade = 1 - p.climb.k;     // escalera: la baja se desvanece
  if (fade <= 0.02) return;
  const prevA = ctx.globalAlpha;
  if (fade < 1) ctx.globalAlpha = fade;       // sustituye al entA del bloque de entidades
  for (const c of game.constructions) {
    if (c.z !== 0) continue;
    // v0.25: los cultivos leen su etapa y el parpadeo de la fogata del
    // reloj de juego (cacheado en la propia construcción cada frame)
    c._t = game.time;
    if (c.type === 'cultivo') c._stage = cropStage(game, c);
    const sx = Math.round(c.x - cam.x + cam.offX);
    const sy = Math.round(c.y - cam.y + cam.offY);
    if (sx < -40 || sy < -40 || sx > cam.w + 40 || sy > cam.h + 40) continue;
    drawConstruction(ctx, c, sx, sy);
  }
  if (fade < 1) ctx.globalAlpha = prevA;
}

/**
 * Fuego: llamas animadas + halo de luz aditivo (encima de todo).
 * v0.21: el fuego es de SU planta — un incendio de la baja no brilla a
 * través del techo del sótano ni al revés (mismo arreglo que las
 * construcciones).
 */
export function drawFires(ctx, cam, game) {
  const t = game.time;
  const p = game.player;
  const pz = p ? (p.climb ? p.climb.to : (p.z || 0)) : 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of game.fires) {
    if ((f.z || 0) !== pz) continue;
    const sx = f.x - cam.x + cam.offX, sy = f.y - cam.y + cam.offY;
    const k = Math.min(1, f.t / 1.5);                 // se apaga al final
    // halo de luz
    const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, f.r + 26);
    g.addColorStop(0, `rgba(255, 180, 70, ${0.34 * k})`);
    g.addColorStop(0.6, `rgba(255, 120, 30, ${0.16 * k})`);
    g.addColorStop(1, 'rgba(255, 90, 20, 0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, f.r + 26, 0, Math.PI * 2); ctx.fill();
    // llamas: triángulos que bailan
    for (let i = 0; i < 7; i++) {
      const a = i * 0.897 + t * 2.2;
      const rr = f.r * (0.35 + 0.5 * ((i * 37) % 10) / 10);
      const fx = sx + Math.cos(a) * rr * 0.8;
      const fy = sy + Math.sin(a) * rr * 0.8;
      const fh = (9 + ((i * 53) % 7)) * (0.8 + 0.4 * Math.sin(t * 9 + i)) * k;
      ctx.fillStyle = i % 3 === 0 ? `rgba(255, 200, 60, ${0.55 * k})` : `rgba(255, 110, 20, ${0.45 * k})`;
      ctx.beginPath();
      ctx.moveTo(fx - 4, fy + 3);
      ctx.lineTo(fx, fy - fh);
      ctx.lineTo(fx + 4, fy + 3);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Molotovs volando: botella girando con estela ígnea.
 * v0.21: también son de su planta (no atraviesan techos al dibujarse).
 */
export function drawMolotovs(ctx, cam, game) {
  const p = game.player;
  const pz = p ? (p.climb ? p.climb.to : (p.z || 0)) : 0;
  for (const m of game.molotovs) {
    if ((m.z || 0) !== pz) continue;
    const sx = m.x - cam.x + cam.offX, sy = m.y - cam.y + cam.offY;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(m.t * 14);
    // estela
    ctx.strokeStyle = 'rgba(255, 170, 60, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-m.vx * 0.045, -m.vy * 0.045);
    ctx.stroke();
    // botella
    ctx.fillStyle = '#b8c832';
    ctx.fillRect(-3, -5, 6, 10);
    ctx.fillStyle = '#e8e0c0';
    ctx.fillRect(-1.5, -7, 3, 3);
    // llamita de la mecha
    ctx.fillStyle = 'rgba(255, 190, 70, 0.9)';
    ctx.beginPath(); ctx.arc(0, -8, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/**
 * Fantasma del modo construcción: sprite translúcido teñido de verde (válido)
 * o rojo (inválido), círculo de alcance alrededor del jugador, resalte del
 * tile objetivo y línea de ayuda con los controles.
 */
export function drawBuildGhost(ctx, cam, game) {
  const b = game.build;
  if (!b) return;
  const p = game.player;
  const ps = cam.worldToScreen(p.x, p.y);
  const gs = cam.worldToScreen(b.x, b.y);
  const ok = b.valid;
  const tint = ok ? 'rgba(122, 184, 90,' : 'rgba(216, 74, 62,';

  // círculo de alcance
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(216,213,204,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ps.x, ps.y, C.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // resalte del tile
  const ts = cam.worldToScreen(b.tx * TILE, b.ty * TILE);
  ctx.fillStyle = tint + ' 0.16)';
  ctx.fillRect(ts.x, ts.y, TILE, TILE);
  ctx.strokeStyle = tint + ' 0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(ts.x, ts.y, TILE, TILE);

  // fantasma del mueble
  ctx.save();
  ctx.globalAlpha = 0.62;
  drawConstruction(ctx, { type: b.recipe.id, rot: b.rot, hp: 1, maxHp: 1,
    crop: b.recipe.crop || null, _stage: 3, _t: 0 }, gs.x, gs.y);
  ctx.restore();
  // tinte de validez sobre el fantasma
  ctx.fillStyle = tint + ' 0.20)';
  ctx.fillRect(ts.x, ts.y, TILE, TILE);

  // motivo + controles
  ctx.font = 'bold 12px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tint + ' 1)';
  ctx.fillText(b.reason || b.recipe.name.toUpperCase(), gs.x, gs.y - 26);
  ctx.fillStyle = 'rgba(216,213,204,0.85)';
  ctx.fillText('CLIC DER. colocar · R' + (b.recipe.rotatable ? ' rotar' : ' (sin efecto)') + ' · CLIC IZQ. cancelar', gs.x, gs.y + 30);
}

/** Llamas sobre un zombi ardiendo (zombie.draw las llama). */
export function drawBurnFlames(ctx, sx, sy, r, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + t * 3;
    const fx = sx + Math.cos(a) * r * 0.55;
    const fy = sy + Math.sin(a) * r * 0.55 - 3;
    const fh = 7 + 4 * Math.sin(t * 10 + i * 2);
    ctx.fillStyle = i % 2 ? 'rgba(255, 190, 60, 0.75)' : 'rgba(255, 110, 20, 0.65)';
    ctx.beginPath();
    ctx.moveTo(fx - 3, fy + 2);
    ctx.lineTo(fx, fy - fh);
    ctx.lineTo(fx + 3, fy + 2);
    ctx.closePath();
    ctx.fill();
  }
  // halo
  const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, r + 8);
  g.addColorStop(0, 'rgba(255, 150, 50, 0.25)');
  g.addColorStop(1, 'rgba(255, 100, 30, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, r + 8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
