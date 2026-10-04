/**
 * encyclopedia.js — v0.22: LA ENCICLOPEDIA.
 *
 * Guía del juego accesible desde el MENÚ PRINCIPAL y el MENÚ DE PAUSA
 * (botón ENCICLOPEDIA; ESC o VOLVER cierran y devuelven a donde estabas).
 * Cuatro categorías, como pedía el usuario:
 *  - MECÁNICAS PRINCIPALES: supervivencia, infección, sigilo/ruido, visión,
 *    día/noche, clima, plantas, el mundo y sus rincones, refugio, ranuras.
 *  - COMBATE: los cuatro zombis (con sus stats), melee, las 7 armas de fuego
 *    con sus números reales, munición, fuego (y su alarma) y curación de
 *    emergencia.
 *  - CRAFTEOS: cómo se craftea, la mesa de trabajo, las 6 recetas de
 *    objetos y las 7 construcciones (materiales exactos), modo construcción,
 *    REPARACIÓN de lo dañado y dónde salir cada material.
 *  - OBJETOS: catálogo completo por categoría (comida, bebida, medicina,
 *    munición, cargadores, ropa, herramientas, materiales) con dónde se
 *    encuentra cada uno — calculado de las TABLAS DE BOTÍO reales.
 *
 * El contenido se GENERA de config.js/crafting.js: si el balance cambia,
 * la enciclopedia se actualiza sola. Nada de números a mano.
 */

import {
  ITEMS, RANGED, ZOMBIE_CFG, SURV, PLAYER_CFG, FISTS, WEATHER, FLOORS,
  CRAFTEO, CONTAINER_DEFS, LOOT, ROTTEN_CHANCE, DAYNIGHT, FLASH,
  PROFESSIONS, PROF_BY_ID,
} from '../config.js';
import { RECIPES_OBJ, RECIPES_CON } from '../systems/crafting.js';

// ---------- utilidades de formato ----------

/** 12.5 → '12,5' (coma decimal española). */
const n = (x) => String(x).replace('.', ',');

const pct = (x) => Math.round(x * 100) + '%';

/** Minutos que tarda un stat en bajar de 100 a 0 con la tasa dada (por s). */
const min = (rate) => n((100 / rate / 60).toFixed(1)) + ' min';

// ---------- índice inverso de botín: objeto → contenedores ----------

const MIL_CONT = new Set(['taquilla_mil', 'caja_municion', 'armeria_mil', 'estanteria_mil']);
const HOS_CONT = new Set(['armario_medico', 'carrito_curas']);

const WHERE = {};      // idItem → [nombre de contenedor, ...]
const WHERE_KEY = {};  // idItem → [tipo de contenedor, ...]
for (const [ctype, table] of Object.entries(LOOT)) {
  for (const [id] of table) {
    (WHERE[id] = WHERE[id] || []).push(CONTAINER_DEFS[ctype].name.toLowerCase());
    (WHERE_KEY[id] = WHERE_KEY[id] || []).push(ctype);
  }
}

/** Nombres legibles de los contenedores que sueltan el objeto (únicos). */
function whereNames(id) {
  const names = WHERE[id];
  if (!names || !names.length) return '';
  return [...new Set(names)];
}

/** «Dónde: neveras · alacenas…» para la ficha de un objeto. */
function whereLine(id) {
  const seen = whereNames(id);
  if (!seen.length) {
    // objetos no tabulados: los garantizados del punto de partida
    if (id === 'pistola_vibora') return 'Dónde: garantizada al aparecer (con cargador de 7) · ' + whereNames('bala_9mm').join(' · ');
    if (id === 'tubo' || id === 'bate') return 'Dónde: uno garantizado junto a tu punto de aparición · ' + whereNames(id).join(' · ');
    return '';
  }
  return 'Dónde: ' + seen.join(' · ');
}

/** Etiqueta de exclusividad deducida de las tablas («SOLO BASE MILITAR»…). */
function rarityTag(id) {
  const cts = WHERE_KEY[id] || [];
  if (!cts.length) return null;
  const set = new Set(cts);
  const allIn = (allowed) => [...set].every((c) => allowed.has(c));
  if (allIn(MIL_CONT)) return { cls: 'mil', txt: 'SOLO BASE MILITAR' };
  if (allIn(HOS_CONT)) return { cls: 'hos', txt: 'SOLO HOSPITAL' };
  if (set.has('armeria') && allIn(new Set([...MIL_CONT, 'armeria']))) {
    return { cls: 'mil', txt: 'COMISARÍA O BASE MILITAR' };
  }
  if (allIn(new Set(['estanteria']))) return { cls: 'sto', txt: 'SOLO LA TIENDA' };
  return null;
}

// ---------- constructores de HTML ----------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function chip(txt, cls = '') {
  return '<span class="ec-chip' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</span>';
}

/** Ficha genérica: icona de color + nombre + chips + descripción + dónde. */
function rawCard(name, color, chipsHtml, desc, where, tag) {
  return '<div class="ency-card">' +
    '<div class="ec-head">' +
      '<span class="ec-icon" style="background:' + (color || '#8a8f7a') + '"></span>' +
      '<span class="ec-name">' + esc(name) + '</span>' +
      (tag ? '<span class="ec-tag ' + tag.cls + '">' + tag.txt + '</span>' : '') +
    '</div>' +
    (chipsHtml ? '<div class="ec-chips">' + chipsHtml + '</div>' : '') +
    '<p class="ec-desc">' + esc(desc || '') + '</p>' +
    (where ? '<p class="ec-where">' + esc(where) + '</p>' : '') +
  '</div>';
}

/** Ficha de un objeto del catálogo (ITEMS): chips + dónde + exclusividad. */
function card(id, chipsHtml) {
  const def = ITEMS[id];
  if (!def) return '';
  return rawCard(def.name, def.color, chipsHtml, def.desc, whereLine(id), rarityTag(id));
}

/** Bloque guía (título + párrafos). */
function guide(title, ...paras) {
  return '<section class="ency-sec"><h3>' + esc(title) + '</h3>' +
    paras.map((p) => '<p>' + p + '</p>').join('') + '</section>';
}

/** Bloque guía con tarjetas debajo. */
function guideCards(title, intro, cardsHtml) {
  return '<section class="ency-sec"><h3>' + esc(title) + '</h3>' +
    (intro ? '<p>' + intro + '</p>' : '') +
    '<div class="ency-grid">' + cardsHtml + '</div></section>';
}

const b = (s) => '<b>' + s + '</b>';   // negrita inline

// ================== La clase ==================

export class Encyclopedia {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('encyclopedia');
    this.body = document.getElementById('ency-body');
    this.cur = 'mec';
    this._panes = {};   // pestaña → HTML ya construido (lazy)

    // pestañas
    this.tabBtns = [...document.querySelectorAll('#ency-tabs button')];
    for (const t of this.tabBtns) {
      t.addEventListener('click', () => this.showTab(t.dataset.etab));
    }
    // abrir desde el menú principal y desde la pausa
    const bm = document.getElementById('btn-encyc');
    if (bm) bm.addEventListener('click', () => this.open());
    const bp = document.getElementById('btn-encyc-pause');
    if (bp) bp.addEventListener('click', () => this.open());
    // cerrar
    const bc = document.getElementById('btn-ency-close');
    if (bc) bc.addEventListener('click', () => this.close());
  }

  get isOpen() { return this.el && !this.el.classList.contains('hidden'); }

  open() {
    if (!this.el) return;
    this.el.classList.remove('hidden');
    this.showTab(this.cur);
  }

  close() {
    if (!this.el) return;
    this.el.classList.add('hidden');
  }

  showTab(id) {
    this.cur = id;
    for (const t of this.tabBtns) t.classList.toggle('on', t.dataset.etab === id);
    if (!this._panes[id]) this._panes[id] = this['_tab_' + id]();
    this.body.innerHTML = this._panes[id];
    this.body.scrollTop = 0;
  }

  // ================== 1 · MECÁNICAS PRINCIPALES ==================

  _tab_mec() {
    const S = SURV, W = WEATHER, F = FLOORS, D = DAYNIGHT;
    const rotNevera = pct(ROTTEN_CHANCE.nevera), rotAlacena = pct(ROTTEN_CHANCE.alacena);

    return '' +

    guide('Tus partidas: tres ranuras',
      'El menú principal guarda ' + b('tres partidas independientes') + ' (ranuras 1 a 3): cada una es un mundo con su propio mapa, progreso y muerte. Una ranura vacía ofrece ' + b('NUEVA PARTIDA') + '; una ocupada muestra su resumen (día, hora, bajas, tiempo sobrevivido) con ' + b('CONTINUAR') + ' y ' + b('ELIMINAR') + '. El borrado pide confirmación en dos pasos: el botón se arma en rojo («¿SEGURO?») durante 4 segundos y solo la segunda pulsación elimina la partida, para que un clic despistado no borre horas de supervivencia.',
      'El ' + b('autoguardado') + ' actúa cada 5 minutos de partida y siempre escribe en la ranura con la que estás jugando; también puedes guardar a mano desde la pausa con GUARDAR Y SALIR AL MENÚ. La ' + b('muerte es definitiva') + ' dentro de su ranura: al morir, ese guardado se borra y REINTENTAR arranca una partida nueva en la misma ranura — tus otras dos partidas quedan intactas. La tecla ' + b('ENTER') + ' del menú continúa directamente la partida más reciente.') +

    guide('Supervivencia: hambre, sed y energía',
      'El ' + b('hambre') + ' baja a ' + n(S.hungerRate) + ' por segundo (de 100 a 0 en unos ' + min(S.hungerRate) + ' de partida) y la ' + b('sed') + ' a ' + n(S.thirstRate) + '/s (' + min(S.thirstRate) + '): bebe antes que comes, la sed apura más. Por debajo de ' + S.critLevel + ' puntos entramos en nivel crítico: el hambre drena ' + n(S.hungerHpDrain) + ' de vida por segundo y la sed ' + n(S.thirstHpDrain) + '/s, y además la sed crítica reduce a la mitad la recuperación de energía.',
      'La ' + b('energía') + ' (stamina) mueve el combate y la carrera: correr cuesta ' + n(S.staminaRunDrain) + '/s y se recupera a ' + n(S.staminaRegenWalk) + '/s caminando y ' + n(S.staminaRegenIdle) + '/s quieto. Cada golpe cuerpo a cuerpo también la gasta: sin energía no hay espadachines. Agotado del todo, tendrás que esperar a que la energía vuelva a ' + S.exhaustedFloor + ' para volver a correr.') +

    guide('Mordidas e infección',
      'Cada golpe de zombi tiene un ' + b(S.biteChance * 100 + '%') + ' de ser mordida que rompa la piel, y una mordida infecta el ' + b(pct(S.biteInfectChance)) + ' de las veces. La ' + b('infección') + ' no perdona: progresa a ' + n(S.infectionRate) + ' por segundo (unos ' + min(S.infectionRate) + ' desde el contagio hasta el final) y al llegar a 100 la partida termina — eres uno más de la horda.',
      'Contra ella tienes tres frentes. La ' + b('prevención') + ': el pasamontañas (' + pct(0.25) + ' menos), la máscara de gas (' + pct(0.7) + ') y la militar CM-4 (' + pct(0.85) + ') reducen la probabilidad de contagiarte al ser mordido. La ' + b('curación') + ': los antibióticos normales curan si la infección aún no llega a 30, y los potentes del hospital hasta 35; pasado ese punto solo la ralentizan. Y la ' + b('huida') + ': rompe la línea de visión, gira esquinas y usa puertas — la columna de búsqueda se disipa.') +

    guide('Comida podrida e intoxicación',
      'La comida de los contenedores puede estar ' + b('PODRIDA') + ' y no siempre se nota a la vista: la nevera es la peor (' + rotNevera + ' de sus comidas están malas), las alacenas (' + rotAlacena + ') y los casilleros rondan el 15-20%, mientras que estanterías de tienda y military casi siempre están limpias. Un bocado podrido cuesta ' + S.rottenHp + ' de vida inmediata, ' + S.intoxDur + ' s de intoxicación (recuperas energía al ' + pct(S.intoxRegenMult) + ') y apenas alimenta (' + pct(S.rottenHungerMult) + ' de lo prometido).',
      'El ' + b('suero médico') + ' del hospital, la adrenalina y la morfina son estériles: jamás vienen podridos. Ante la duda, las latas de frijoles y atún de las estanterías de la tienda son la apuesta más segura para llenar la despensa de tu refugio.') +

    guide('Sigilo y ruido',
      'El mundo te escucha. Cada paso emite ruido en un radio que depende de cómo te muevas: ' + b('agachado ' + PLAYER_CFG.noiseSneak + ' px') + ', caminando ' + b(PLAYER_CFG.noiseWalk + ' px') + ' y ' + b('corriendo ' + PLAYER_CFG.noiseRun + ' px') + ' — el medidor RUIDO del HUD (derecha) te lo muestra en tiempo real. Los zombis te ven y te huelen a ' + ZOMBIE_CFG.detectRadius + ' px con línea de visión, ' + ZOMBIE_CFG.detectSneak + ' si vas agachado y ' + ZOMBIE_CFG.detectRun + ' si corres: el movimiento te delata.',
      'Las acciones también gritan: abrir puertas, saquear contenedores y sobre todo ' + b('disparar') + ' (radios de 620 a 900 px: un tiro convoca al barrio entero). La ' + b('lluvia') + ' enmascara todo ruido en un ' + pct(1 - W.rainNoiseMul) + ' — los frentes lluviosos son la mejor ventana para moverte con ruido. Coches y árboles rompen la línea de visión de los zombis aunque tú los veas desde arriba: úsalos como cobertura.') +

    guide('Visión, luz y linterna',
      'Ves en un cono delante de ti; el resto es niebla de guerra con memoria espacial de lo explorado. Los ' + b('techos') + ' ocultan el interior de los edificios hasta que te acercas (se atenuan por las ventanas) y desaparecen al entrar. De ' + b('noche') + ' (20:00–06:00) la niebla se vuelve opresiva y la linterna pasa de útil a vital: enciéndela con ' + b('L') + ' y extiende tu cono según la oscuridad (noche, lluvia, neblina e interiores).',
      'Cada ' + b('pila') + ' da unos ' + Math.round(FLASH.drainSec / 60) + ' minutos de haz encendido y el cambio es automático cuando se agota — lleva repuesto. En el ' + b('HOSPITAL SAN RAFAEL') + ' hay apagón permanente: de día la luz de las ventanas apenas deja ver y de noche sin linterna es ceguera casi total.') +

    guide('El ciclo día/noche',
      'Un día completo dura ' + (D.cycleSec / 60) + ' minutos reales (1 hora de reloj = ' + (D.cycleSec / 24 / 60) + ' min): la partida amanece a las 08:00 del día 1. La ' + b('noche') + ' va de las ' + D.nightStart + ':00 a las ' + D.nightEnd + ':00 y no es solo oscuridad: cada hora nocturna ' + b('repone ' + ZOMBIE_CFG.nightBatch + ' zombis') + ' lejos de tu vista, hasta un máximo de ' + ZOMBIE_CFG.nightCap + ' en el mundo. Los corredores también presionan más de noche (' + pct(ZOMBIE_CFG.nightRunnerChance) + ' de los refuerzos frente al ' + pct(ZOMBIE_CFG.runnerChance) + ' de día).',
      'Dormir en una cama instalada en tu refugio es la forma elegante de saltarte la noche (ver Refugio y sueño más abajo). Si tienes que atravesarla despierto, linterna encendida y ritmo tranquilo: correr de noche es firmar tu sentencia con garra de zombi.') +

    guide('El clima: lluvia y neblina',
      'Cada ' + W.gapDays[0] + '–' + W.gapDays[1] + ' días de juego llega un frente que dura entre ' + W.durHours[0] + ' y ' + W.durHours[1] + ' horas de reloj, con transiciones suaves de una hora. ' + b(W.rainChance * 10 + ' de cada 10 frentes son de LLUVIA') + '; el resto, neblina.',
      b('LLUVIA') + ': el ruido de TODO lo que haces baja un ' + pct(1 - W.rainNoiseMul) + ' (pasos, disparos, puertas) y la visión se estrecha apenas un ' + pct(1 - W.rainVisionMul) + '. Es el clima del saqueador: muévete y dispara bajo la cortina de agua. ' + b('NEBLINA') + ': tu cono de visión cae a la mitad, pero el de ELLOS también (' + ZOMBIE_CFG.detectRadius + '→' + Math.round(ZOMBIE_CFG.detectRadius * W.fogVisionMul) + ' px de detección): es el clima del sigilo, no del tiroteo. El clima se guarda con la partida y solo avanza jugando.') +

    guide('Plantas: sótanos y segundos pisos',
      'El ' + pct(FLOORS.upperChance) + ' de las casas tiene ' + b('2º piso') + ' y otro ' + pct(FLOORS.basementChance) + ' sótano' + ' (nunca ambos). Una escalera interior los conecta: pulsa ' + b('E') + ' sobre ella y la subida toma ' + n(FLOORS.climbTime) + ' s con un fundido entre plantas.',
      'Cada planta es su propio mundo: desde el sótano no se ve la planta baja (ni sus construcciones ni su fuego) y viceversa — el techo de tu refugio también tapa a los zombis de arriba abajo. Las ' + b('construcciones solo se colocan en planta baja') + '. Recuerda qué edificios tienen sótano antes de tapiarte dentro: es la mejor bodega y el peor callejón sin salida.') +

    guide('El mundo y sus rincones',
      'El mapa es una ciudad de ' + b('27.232 m²') + ' con casas, coches, contenedores y ' + ZOMBIE_CFG.count + '+ zombis de salida. Cuatro rincones valen el viaje. La ' + b('COMISARÍA') + ': estructura única con su armería (única fuente civil del rifle Cóndor AR-56) y sus brutos de guarnición. La ' + b('TIENDA') + ': comida a porrillo y ferretería improvisada (tablas, clavos, queroseno…).',
      b('LA BASE MILITAR') + ' — el rincón más lejano: planta baja infestada (' + 18 + ' zombis, 4 brutos de guarnición) y un ' + b('sótano-arsenal') + ' con el mejor botín del juego: el subfusil Cuervo (exclusivo y SIEMPRE garantizado al menos uno), equipo militar completo y munición a saco. ' + b('EL HOSPITAL SAN RAFAEL') + ' — dos pisos en apagón total e infestación doble: guarda los exclusivos médicos (suero, adrenalina, antibióticos potentes y morfina). Ve de día o con linterna bien cargada.') +

    guide('Refugio, cama y sueño',
      'Monta una ' + b('CAMA') + ' dentro de una casa (receta de Construcciones: 4 tablas, 8 clavos, 3 tela y 1 cuerda) y esa casa se convierte en tu ' + b('REFUGIO') + ': nadie vuelve a aparecer dentro de sus muros. Duerme con ' + b('E') + ' junto a ella — solo si no hay zombis a ' + CRAFTEO.sleepSafeR + ' px a la redonda — y pasarás la noche de un tirón hasta el amanecer: despiertas con la energía y algo de vida repuestos (+' + CRAFTEO.sleepHeal + ' de vida).',
      'Un refugio serio se construye tapiando: barricada en la puerta, tablones en las ventanas (dejan de verte por el cristal), una caja de almacenamiento para el equipo de reserva y una cama. Con eso, la noche pasa de ser una amenaza a ser un trámite — y tu ranura de guardado, una herencia.') +

    guide('Consejos de arranque',
      'Junto a tu punto de aparición hay un ' + b('tubo de acero') + ' y una ' + b('pistola Víbora con cargador') + ' con 7 balas, más suministros y materiales de crafteo dispersos. La casa más cercana esconde un bate. Prioridades de cualquier primera hora: arma melee en la mano, agua y comida en la mochila, vendas o materiales para coserlas, y un plan de dónde pasar la primera noche.',
      'La pestaña CRAFTEO del inventario (TAB) es tu taller: de los materiales de arranque ya sales con vendas o una barricada. Y cuando el mapa se te quede pequeño, recuerda que la base militar está en el extremo opuesto a tu aparición: el viaje de ida es la mitad del reto.');
  }

  // ================== 2 · PROFESIONES (v0.24) ==================

  _tab_prof() {
    const P = PROFESSIONS;

    // ficha de cada profesión: chips del bono + "se elige al crear" + desc
    const cards = P.map((pr) => {
      const chips = pr.perks.map((p) => chip(p, pr.id === 'desempleado' ? '' : 'ok')).join('') +
        chip('pasiva · TODA la partida') +
        (pr.id === 'desempleado' ? chip('el reto puro') : '');
      return rawCard(pr.name, pr.color, chips,
        pr.desc + ' Se elige al CREAR la partida y NO se puede cambiar.', null, null);
    }).join('');

    // qué toca exactamente cada bono, con los números reales del juego
    const ladronSneak = Math.round(PLAYER_CFG.noiseSneak * P[2].fx.stepNoiseMul);
    const ladronWalk = Math.round(PLAYER_CFG.noiseWalk * P[2].fx.stepNoiseMul);
    const ladronRun = Math.round(PLAYER_CFG.noiseRun * P[2].fx.stepNoiseMul);
    const pistola = RANGED.pistola.dmg;
    const pistolaPoli = Math.round(pistola * P[0].fx.gunDmgMul * 10) / 10;

    return '' +
      guide('Quién eras antes del apocalipsis',
        'Al ' + b('CREAR una partida') + ' (ranura vacía, reintento tras la muerte o ENTER sin partidas) el juego te pregunta ' + b('QUIÉN ERAS') + ': una de las cinco profesiones. La elección se hace ' + b('UNA sola vez y NO se puede cambiar') + ' — es tu pasado, y te acompaña como una ' + b('bonificación PASIVA') + ' durante TODA la partida: no hay que activar nada, siempre está funcionando. La profesión viaja en el guardado (cada ranura recuerda la suya: se ve en el resumen del menú, en la pausa y en el obituario), y las partidas creadas antes de la v0.24 siguen SIN profesión: sin bonos, la partida clásica.',
        'Ninguna profesión gana la partida por ti: son ' + b('matices de estilo a largo plazo') + '. El policía mata un poco mejor, el médico estira un poco más el botiquín, el ladrón atraviesa barrios sin despertarlos, el carpintero mantiene el refugio a mitad de precio… y el desempleado presume de no necesitar nada de eso. Elige la que mejor encaje con ' + b('cómo quieres jugar ESA partida') + ': agresivo, médico de campaña, fantasma silencioso o ingeniero de refugios.') +
        guideCards('Las cinco profesiones', null, cards) +
      guide('Qué toca exactamente cada bono',
        b('POLICÍA — +5% de daño con armas de fuego') + ': TODAS las armas de fuego (pistola, revólver, escopetas por cada posta, rifles, subfusil), siempre y en cada disparo. La Víbora VP-9 pasa de ' + pistola + ' a ' + n(pistolaPoli) + ' de daño por bala; en un rifle automático o una ráfaga de Cuervo, el 5% se nota en cada zombi que ya no llega a ti. El melee y los cócteles NO se benefician: el bono es de plomo.',
        b('MÉDICO — +5% de curación con objetos curativos') + ': todo lo que cura vida. El botiquín pasa de +50 a ' + n(52.5) + ' y la venda de +25 en 5 s a ' + n(26.3) + ' — y lo mismo sobre los exclusivos del hospital. No afecta a comida, bebida ni al sueño de la cama: solo a la MEDICINA.',
        b('LADRÓN — pasos un 50% más silenciosos') + ': el radio de ruido de TUS pasos se parte en dos — agachado ' + ladronSneak + ' px, caminando ' + ladronWalk + ' px, corriendo ' + ladronRun + ' px. Se apila con la ropa silenciosa y con la lluvia (que enmascara el ruido de todos). Los zombis que cazan por el oído te oyen desde la mitad de distancia: el sigilo del ladrón es caminar como si lloviera siempre. Solo los PASOS: disparos, puertas y martillazos siguen oyéndose enteros.',
        b('CARPINTERO — reparar cuesta la mitad de materiales') + ': el coste de REPARAR cualquier construcción dañada (barricada, tablones, valla, trampa, mesa) se divide entre dos, con mínimo de 1 por material. Una barricada al 50% que a cualquiera le cuesta 2 tablas + 2 clavos, al carpintero le cuesta ' + b('1 y 1') + '; aguantar asedios sale a mitad de precio. Las CONSTRUCCIONES nuevas se pagan enteras: el bono es de mantener, no de montar.',
        b('DESEMPLEADO — nada') + ': sin bonos, sin ventajas, sin arrepentimiento. La partida pura, exactamente como se jugó toda la historia del juego. Para quien quiera contarse la historia sin ayudas — o comparar cuánto le dan las demás profesiones.');
  }

  // ================== 3 · COMBATE ==================

  _tab_comb() {
    const Z = ZOMBIE_CFG;

    // ---- fichas de zombis ----
    const zCard = (name, color, chips, desc) =>
      rawCard(name, color, chips, desc, null, null);
    const zombis =
      zCard('Zombi común', '#7a8a6a',
        chip('vida ' + Z.hp, 'dmg') + chip('persecución ' + Z.chaseSpeed + ' px/s') +
        chip('daño ' + Z.dmgMin + '–' + Z.dmgMax) + chip('te detecta a ' + Z.detectRadius + ' px') +
        chip('golpe cada ' + n(Z.attackCd) + ' s'),
        'La carne de cañón del apocalipsis. Deambula (' + Z.wanderSpeed + ' px/s), investiga ruidos (' + Z.investigateSpeed + ' px/s) y carga a ' + Z.chaseSpeed + ' px/s cuando te ve o te huele. Pierde tu rastro tras ' + n(Z.loseSightTime) + ' s sin verte y busca tu última posición conocida ' + n(Z.searchTime) + ' s. Abatirlo a melee es cuestión de cadencia y energía; a plomo, un par de balas bien puestas.') +
      zCard('CORREDOR', '#a86a5a',
        chip('vida ' + Z.variants.runner.hp, 'dmg') + chip('persecución ' + Z.variants.runner.chaseSpeed + ' px/s', 'dmg') +
        chip('daño ' + Z.variants.runner.dmgMin + '–' + Z.variants.runner.dmgMax) +
        chip('golpe cada ' + n(Z.variants.runner.attackCd) + ' s') + chip('sale volando con los golpes'),
        'Carne fresca: mitad de vida y el doble de rápido — ' + Z.variants.runner.chaseSpeed + ' px/s de persecución contra tus ' + PLAYER_CFG.run + ' px/s de esprint: ' + b('corriendo SIEMPRE le ganas') + ', pero caminando te alcanza. Su chillido agudo lo delata antes de verlo. Entre mordisco y mordisco deja ' + n(Z.variants.runner.attackCd) + ' s de ventana: contragolpea con cualquier melee y retírate. Un ' + pct(Z.runnerChance) + ' de la horda callejera (' + pct(Z.nightRunnerChance) + ' de los refuerzos nocturnos).') +
      zCard('BRUTO', '#5a5a6a',
        chip('vida ' + Z.variants.brute.hp, 'dmg') + chip('persecución ' + Z.variants.brute.chaseSpeed + ' px/s') +
        chip('daño ' + Z.variants.brute.dmgMin + '–' + Z.variants.brute.dmgMax, 'dmg') +
        chip('alcance ' + Z.variants.brute.attackRange) + chip('apenas retrocede'),
        'Masa putrefacta: ' + Z.variants.brute.hp + ' de vida (más que tú y tu barricada juntos), golpes doblados y alcance largo — pero ' + Z.variants.brute.chaseSpeed + ' px/s: ' + b('hasta caminando lo dejas atrás') + '. Casi no retrocede con los golpes, así que no cuentes con aturdirlo. Guarnición fija: 2 en la comisaría, 1 en la tienda, 4 en la base militar y 2 en el hospital; a veces, alguno vaga por las calles.') +
      zCard('GRITADOR', '#a8a460',
        chip('vida ' + Z.variants.screamer.hp, 'dmg') + chip('CHILLIDO de ' + Z.variants.screamer.screamR + ' px', 'dmg') +
        chip('aviso de ' + n(Z.variants.screamer.screamWindup) + ' s parado') +
        chip('repite cada ' + Z.variants.screamer.screamCd + ' s') +
        chip('daño ' + Z.variants.screamer.dmgMin + '–' + Z.variants.screamer.dmgMax) +
        chip('raro: donde hay ' + Z.screamerPopNear + '+ zombis'),
        'La ALARMA ambulante (v0.23). Pajizo, boca abierta, ojos lechosos: no forma parte de la horda — ' + b('EMERGE donde hay MUCHA población zombi') + ' (a ' + Z.screamerPopR + ' px a la redonda, máximo ' + Z.screamerMax + ' vivos). Al verte se PARA e hincha el pecho ' + n(Z.variants.screamer.screamWindup) + ' s: ' + b('ESA es tu ventana — mátalo ahí') + '. Si chilla, todo zombi en ' + Z.variants.screamer.screamR + ' px (varias manzanas; la lluvia lo amortigua) va a INVESTIGAR su posición, que persigue tu rastro. Su grito se ve como una ONDA ROJA en el suelo. Frágil (' + Z.variants.screamer.hp + ' de vida) y su golpe es flojo: el peligro no es él, es lo que trae.');

    // ---- melee ----
    const meleeIds = ['tubo', 'bate', 'hacha', 'bate_con_clavos', 'lanza_chatarra', 'antorcha'];
    const melee = rawCard(FISTS.name, FISTS.color,
      chip('daño ' + FISTS.dmg) + chip('alcance ' + FISTS.range) + chip('energía ' + FISTS.stamina),
      FISTS.desc, null, null) +
      meleeIds.map((id) => {
        const d = ITEMS[id];
        return card(id, chip('daño ' + d.dmg, 'dmg') + chip('alcance ' + d.range) +
          chip('energía ' + d.stamina) + chip('cadencia ' + n(d.cd) + ' s') +
          chip('ruido ' + d.noise, 'noise') + chip('empuje ' + d.kb) +
          (d.ignite ? chip('PRENDE ' + n(d.ignite) + ' s', 'fire') : ''));
      }).join('');

    // ---- armas de fuego ----
    const gunOrder = ['pistola', 'revolver', 'doble', 'escopeta', 'cerrojo', 'rifle', 'subfusil'];
    const guns = gunOrder.map((k) => {
      const d = RANGED[k];
      const it = ITEMS[d.id];
      const capTxt = d.magType ? 'cargador ' + ITEMS[d.magType].cap : 'tubo ' + d.tubeCap;
      return rawCard(it.name, it.color,
        chip('daño ' + d.dmg + (d.pellets > 1 ? ' × ' + d.pellets + ' postas' : ''), 'dmg') +
        chip(capTxt) + chip('cadencia ' + n(d.cd) + ' s') + chip('alcance ' + d.range + ' px') +
        chip('ruido ' + d.noise, 'noise') + (d.auto ? chip('AUTOMÁTICA', 'ok') : '') +
        chip('munición: ' + ITEMS[d.ammo].name),
        it.desc, whereLine(d.id), rarityTag(d.id));
    }).join('');

    // ---- munición y cargadores ----
    const ammo = Object.keys(ITEMS).filter((id) => ITEMS[id].cat === 'municion')
      .map((id) => card(id, chip('apilable × ' + ITEMS[id].stack) + chip(ITEMS[id].lootMin + '–' + ITEMS[id].lootMax + ' por hallazgo'))).join('');
    const mags = Object.keys(ITEMS).filter((id) => ITEMS[id].cat === 'cargador')
      .map((id) => card(id, chip(ITEMS[id].cap + ' balas') + chip('se rellena solo'))).join('');

    return '' +
      guide('Los cuatro rostros de la horda',
        'Toda amenaza comparte base: oyen, olfatean y persiguen tu última posición conocida, y de noche la presión sube (+' + Z.nightBatch + ' zombis por hora, tope ' + Z.nightCap + '). Pero hay ' + b('cuatro variantes') + ' y confundirlas te mata: el común es lento pero tenaz, el corredor es un sprinter de vidrio, el bruto es un tanque que camina… y el GRITADOR no mata: CONVOCA. Identifica la silueta y el gemido antes de comprometerte — el corredor chilla agudo, el bruto retumba grave y el gritador huele a paja mojada y abre la boca ANTES de gritar. Si oyes su chillido, no lo dudes: cambia de calle o prepárate para la avalancha.') +
        guideCards('Bestiario', null, zombis) +
      guide('Combate cuerpo a cuerpo',
        'Silencioso, barato y honesto: cada arma melee tiene daño, alcance, coste de energía, cadencia y EMPUJE (retroceso del zombi al golpearlo). El ritmo ganador es ' + b('golpe → retrocede → golpe') + ': dejas que el zombi entre en tu alcance, pegas y el empuje lo saca antes de que su cooldown de ' + n(Z.attackCd) + ' s le deje responder. Vigila la ENERGÍA: sin aliento no hay swings, y un cansado ante un corredor es comida. El ruido del melee (' + ITEMS.tubo.noise + '–' + ITEMS.hacha.noise + ' px) es casi susurro junto al de un disparo.') +
        guideCards('Armas cuerpo a cuerpo', null, melee) +
      guide('Armas de fuego',
        'Siete armas, siete caracteres — y un precio común: el ' + b('RUIDO') + '. Un disparo se oye a 620–900 px: medio mapa acude. La recarga es un momento vulnerable (la pistola con funda táctica la acelera hasta la mitad), las automáticas mantienen el gatillo, y las escopetas pegan por postas (' + RANGED.escopeta.pellets + ' proyectiles por cartucho: a bocajarro, guillotina; a distancia, ruido). Un arma hallada ' + b('siempre trae algo dentro') + ': 50% llena, 50% a medias. Y si tu profesión es POLICÍA, cada bala pega un 5% más (pestaña PROFESIONES).') +
        guideCards('Las siete armas', null, guns) +
      guide('Munición y cargadores',
        'La munición es apilable y se recolecta por lotes. Al recoger balas del calibre de un cargador que lleves, ' + b('pasan solas al cargador') + ' — el sobrante queda en la mochila. Las escopetas, el revólver y el cerrojo no usan cargadores: cargan su tubo/tambor bala a bala (recarga lenta: piénsalo antes del último cartucho).', ammo + mags) +
      guide('El fuego: molotov y antorcha (y su ALARMA)',
        'El ' + b('cóctel molotov') + ' se LANZA equipándolo y atacando: estalla a los 360 px dejando una zona de fuego de ' + CRAFTEO.fireR + ' px durante ' + CRAFTEO.fireDur + ' s que hace ' + CRAFTEO.fireDpsZ + ' de daño por segundo a los zombis dentro… y ' + CRAFTEO.fireDpsP + '/s a ti si te quedas dentro. La ' + b('antorcha') + ' es su prima pobre: golpe débil, pero PRENDE a los zombis (' + CRAFTEO.burnDur + ' s ardiendo a ' + CRAFTEO.burnDps + ' dps). El fuego no cruza plantas: un molotov estallando en la baja no te quema en el sótano. ' + b('PERO (v0.23) el fuego es una ALARMA') + ': al estallar, el CRISTAL ROTO hace un ruido de ' + CRAFTEO.fireBreakNoise + ' px, y mientras arde las LLAMAS SE VEN desde lejos — cada ' + n(CRAFTEO.fireAlarmEvery) + ' s atraen a los zombis en ' + CRAFTEO.fireAlarmR + ' px a la redonda (verás el anillo naranja). Incendiar una zona la despeja… y luego la LLENA: úsalo lejos de tu refugio o cuando ya te hayas ido.') +
      guide('Curarse en plena batalla',
        'La ' + b('venda') + ' (+25 en 5 s) es el curita de cabecera; el ' + b('botiquín') + ' (+50 al instante) es el as bajo la barricada. Los dos exclusivos tácticos del hospital cambian peleas imposibles: la ' + b('adrenalina') + ' da energía infinita 25 s (corre sin agotarte, atraviesa la horda) y la ' + b('morfina') + ' reduce a la mitad todo el daño recibido durante 45 s. Lleva siempre una vía de escape curada: la barra rápida (ranuras 4-5) existe para eso. La profesión MÉDICO cura un 5% más con todos ellos.') +
      guide('Protección: armadura y máscaras',
        'La ropa no es cosmética: cada pieza resta daño (cabeza hasta ' + pct(ITEMS.casco_combate.armor) + ', torso hasta ' + pct(ITEMS.chaleco_balistico.armor) + ') y los accesorios de cara reducen la probabilidad de infección por mordida (la CM-4 militar llega al ' + pct(ITEMS.mascara_cm4.infectProt) + '). Los chalecos y pantalones de campaña además AMPLÍAN tu mochila (+2 a +5 espacios). Catálogo completo en la pestaña OBJETOS.');
  }

  // ================== 4 · CRAFTEOS ==================

  _tab_cra() {
    const C = CRAFTEO;

    const objRecipes = RECIPES_OBJ.map((r) => {
      const mats = r.mats.map(([id, k]) => chip(ITEMS[id].name + ' × ' + k, 'mat')).join('');
      return rawCard(r.name, r.icon,
        mats + (r.wb ? chip('MESA DE TRABAJO', 'wb') : ''), r.desc, null, null);
    }).join('');

    const conRecipes = RECIPES_CON.map((r) => {
      const mats = r.mats.map(([id, k]) => chip(ITEMS[id].name + ' × ' + k, 'mat')).join('');
      const extra =
        (r.id === 'barricada' ? chip('se imanta a PUERTAS') : '') +
        (r.id === 'tapiar' ? chip('se imanta a VENTANAS') : '') +
        (r.rotatable ? chip('R la rota') : '') +
        (r.wb ? chip('MESA DE TRABAJO', 'wb') : '') +
        (r.indoors ? chip('solo INTERIOR') : '') +
        chip('aguanta ' + C.conHp[r.id] + ' de daño');
      return rawCard(r.name, r.icon, mats + extra, r.desc, null, null);
    }).join('');

    const mats = Object.keys(ITEMS).filter((id) => ITEMS[id].cat === 'material')
      .map((id) => card(id, chip('apilable × ' + ITEMS[id].stack) +
        (ITEMS[id].lootMin ? chip(ITEMS[id].lootMin + '–' + ITEMS[id].lootMax + ' por hallazgo') : '')))
      .join('');

    return '' +
      guide('Cómo se craftea',
        'Abre el inventario con ' + b('TAB') + ' y entra en la pestaña ' + b('CRAFTEO') + ': dos familias de recetas. Los ' + b('OBJETOS') + ' (vendas, molotovs, armas artesanales…) se craftean al instante y van a la mochila — si está llena, el juego te avisa y no gasta nada. Las ' + b('CONSTRUCCIONES') + ' no se guardan en la mochila: al pulsar CONSTRUIR entras en ' + b('modo construcción') + ' (ver más abajo) y los materiales se gastan al COLOCAR, no al activar el modo: puedes cancelar sin perder nada.') +
      guide('La mesa de trabajo',
        'Un banco improvisado (' + b('2 tablas, 6 clavos y 1 cinta') + ') que se construye como cualquier otra cosa y, estando a ' + C.wbRange + ' px o menos, ' + b('desbloquea las recetas de taller') + ': el botiquín, el bate con clavos, la lanza, la trampa de pinchos y la cama. Las recetas marcadas con el chip MESA DE TRABAJO la exigen. Ojo: cuenta solo en la MISMA planta — la mesa de la planta baja no habilita nada desde el sótano o el 2º piso.') +
      guideCards('Recetas de objetos', null, objRecipes) +
      guide('El modo construcción',
        'Al pulsar CONSTRUIR, un ' + b('fantasma transparente') + ' sigue al ratón: ' + b('verde') + ' = sitio válido, ' + b('rojo') + ' = colisión, demasiado lejos (' + C.range + ' px) o terreno inadecuado. ' + b('R') + ' rota la pieza (vallas y trampas), el ' + b('CLIC DERECHO la coloca') + ' gastando ahí los materiales, y el ' + b('CLIC IZQUIERDO o ESC cancela') + ' sin gastar nada. Las barricadas se imantan a puertas y los tablones a ventanas (' + C.snapR + ' px de imán). Todo se construye ' + b('solo en planta baja') + ', y las piezas aguantan daño de zombi antes de ceder — el fuego también las respeta.') +
      guideCards('Construcciones', null, conRecipes) +
      guide('Reparar lo dañado (v0.23)',
        'Barricadas, tablones, vallas, trampas y mesas se estropean a golpes de zombi (y a los tuyos). Acércate a una pieza dañada y ' + b('E') + ' ofrece REPARARLA con su coste REAL en el propio prompt: ' + b('cuanto más dañada, más materiales') + ' — la parte proporcional de lo que falta, redondeada hacia arriba y con mínimo de 1 por material. Una barricada al 50% pide ' + b('2 tablas + 2 clavos') + ' (de sus 3+4); al 90%, casi la receta entera. La reparación devuelve la pieza a su vida MÁXIMA (la trampa además re-arma sus 10 pisadas)… pero martillar hace el mismo ruido que construir (' + 140 + ' px): piénsalo con la horda llamando a la puerta. La caja y la cama no se reparan con E: su función (abrir/dormir) manda. Y si tu profesión es CARPINTERO, todo coste se parte en dos (la barricada al 50% te sale a 1 tabla + 1 clavo).') +
      guide('Materiales: la ferretería del apocalipsis',
        'Los materiales (cat MATERIAL) no tienen uso directo: son los ladrillos de todas las recetas. Salen de casilleros, estanterías de tienda y base, armarios y botiquines de pared — cada ficha dice dónde. Regla de oro del herrero urbano: ' + b('saquea la TIENDA') + ' (estanterías: clavos, tablas, tela, queroseno, cinta…) antes de comprometerte con la base militar; y recuerda que el punto de partida ya esparce tela, alcohol, tablas, clavos y chatarra para tus primeras vendas o barricada.', mats);
  }

  // ================== 5 · OBJETOS ==================

  _tab_obj() {
    const byCat = (cat) => Object.keys(ITEMS).filter((id) => ITEMS[id].cat === cat);

    // comida
    const comida = byCat('comida').map((id) => {
      const d = ITEMS[id];
      return card(id, chip('+' + d.hunger + ' hambre', 'ok') +
        (d.thirst ? chip('+' + d.thirst + ' sed') : '') +
        (d.stamina ? chip('+' + d.stamina + ' energía') : ''));
    }).join('');

    // bebida
    const bebida = byCat('bebida').map((id) => {
      const d = ITEMS[id];
      return card(id, chip('+' + d.thirst + ' sed', 'ok') + (d.hunger ? chip('+' + d.hunger + ' hambre') : ''));
    }).join('');

    // medicina
    const medico = byCat('medico').map((id) => {
      const d = ITEMS[id];
      const chips =
        (d.heal ? chip('+' + d.heal + ' vida', 'ok') : '') +
        (d.healOverTime ? chip('+' + d.healOverTime + ' en ' + d.healDur + ' s', 'ok') : '') +
        (d.thirstFull ? chip('sed al 100%', 'ok') : '') +
        (d.adrenalinSec ? chip('energía ∞ ' + d.adrenalinSec + ' s', 'ok') : '') +
        (d.morphineSec ? chip('−50% daño ' + d.morphineSec + ' s', 'ok') : '') +
        (d.cureBelow ? chip('cura infección < ' + d.cureBelow, 'ok') : '');
      return card(id, chips);
    }).join('');

    // ropa por slot
    const slotNames = { cabeza: 'Cabeza', accesorios: 'Accesorios (3 ranuras)', torso: 'Torso', pantalones: 'Pantalones' };
    const ropa = ['cabeza', 'accesorios', 'torso', 'pantalones'].map((slot) => {
      const cards = byCat('ropa').filter((id) => ITEMS[id].slot === slot).map((id) => {
        const d = ITEMS[id];
        return card(id,
          (d.armor ? chip('−' + pct(d.armor) + ' daño', 'ok') : '') +
          (d.infectProt ? chip('−' + pct(d.infectProt) + ' infección', 'ok') : '') +
          (d.slotsBonus ? chip('+' + d.slotsBonus + ' espacios', 'ok') : '') +
          (d.noiseMod ? chip('−' + pct(1 - d.noiseMod) + ' ruido pasos') : '') +
          (d.pistolDrawMod ? chip('desenfunde −' + pct(1 - d.pistolDrawMod)) : '') +
          (d.pistolReloadMod ? chip('recarga −' + pct(1 - d.pistolReloadMod)) : '') +
          (d.flashlight ? chip('encender con L', 'wb') : ''));
      }).join('');
      return guideCards(slotNames[slot], null, cards);
    }).join('');

    // herramientas + materiales
    const tools = ['linterna', 'bateria'].map((id) => card(id,
      (ITEMS[id].flashlight ? chip('se EQUIPA como accesorio') + chip('se enciende con L') : '') +
      (ITEMS[id].stack ? chip('apilable × ' + ITEMS[id].stack) : ''))).join('');
    const mats = byCat('material').map((id) => card(id,
      chip('apilable × ' + ITEMS[id].stack) +
      (ITEMS[id].lootMin ? chip(ITEMS[id].lootMin + '–' + ITEMS[id].lootMax + ' por hallazgo') : ''))).join('');

    return '' +
      guide('El catálogo',
        'Todo lo que puedes encontrar, ordenado por categorías: comida y bebida (consumibles de supervivencia), medicina (curación y refuerzos tácticos), ropa y equipo (protección y capacidad) y herramientas y materiales. Cada ficha incluye ' + b('DÓNDE se encuentra') + ' — calculado de las tablas de botín reales del juego, no de oídas. Las ' + b('armas, la munición y los cargadores') + ' viven con sus números de combate en la pestaña COMBATE; las recetas con sus materiales exactos, en CRAFTEOS.') +
      guideCards('Comida', 'La despensa: '+ b('ojo a la podredumbre') + ' — nevera ' + pct(ROTTEN_CHANCE.nevera) + ' · alacenas ' + pct(ROTTEN_CHANCE.alacena) + ' · casilleros ' + pct(ROTTEN_CHANCE.casillero) + '. La comida podrida daña e intoxica.', comida) +
      guideCards('Bebida', 'La sed baja más rápido que el hambre: lleva siempre una botella de más.', bebida) +
      guideCards('Medicina', 'Del curita de campaña a los exclusivos del hospital (etiqueta SOLO HOSPITAL).', medico) +
      ropa +
      guideCards('Herramientas', 'La luz es supervivencia: la linterna y sus pilas.', tools) +
      guideCards('Materiales de crafteo', 'Sin uso directo, imprescindibles: alimentan todas las recetas de la pestaña CRAFTEO.', mats);
  }
}
