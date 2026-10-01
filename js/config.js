/**
 * config.js — Constantes de balance, base de datos de objetos y tablas de botín.
 * Todo el tuning del prototipo vive aquí para iterar rápido.
 */

// ---------- Mundo ----------
export const TILE = 32;
// Grosor de muros, ventanas y puertas (px). Las paredes son DELGADAS: ocupan
// una franja centrada en el tile (WALL_T de alto/ancho) que corre a lo largo
// de la línea de muro; el resto del tile es suelo transitable (exterior/interior).
export const WALL_T = 10;
// v0.16: mapa AMPLIADO AL DOBLE de superficie (13.520 → 27.232 m²):
// 184×148 tiles (5.888×4.736 px). La retícula pasa de 5×4 a 7×6 manzanas
// para hacer hueco a la BASE MILITAR y a la nueva economía de armas.
export const MAP_W = 184;   // tiles (v0.16: antes 130)
export const MAP_H = 148;   // tiles (v0.16: antes 104)
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

// Tipos de tile
export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, FLOOR: 3, WALL: 4,
  DOOR_CLOSED: 5, TREE: 6, WINDOW: 7, DOOR_OPEN: 8, CAR: 9,
  STAIRS: 10,
};

// Tiles sólidos (bloquean movimiento). Muros/ventanas/puertas cerradas son
// sólidos SOLO en su franja delgada (ver map._inRuns); árboles y coches ocupan
// el tile completo.
export const SOLID = new Set([T.WALL, T.DOOR_CLOSED, T.TREE, T.WINDOW, T.CAR]);
// Tiles opacos para la VISIÓN DEL JUGADOR: solo la franja de muros y puertas
// cerradas tapan. Árboles y coches NO tapan la vista (cámara aérea) y las
// bandas de suelo junto al muro son transparentes.
export const OPAQUE = new Set([T.WALL, T.DOOR_CLOSED]);
// Tiles que tapan la vista de los ZOMBIS: árboles y coches siguen dando
// COBERTURA — el jugador puede verlos desde arriba, pero esconderse detrás.
export const AI_OPAQUE = new Set([T.WALL, T.DOOR_CLOSED, T.TREE, T.CAR]);

// ---------- Visión (cono + niebla de guerra) ----------
export const VISION = {
  range: 440,          // alcance del cono (px)
  halfAngle: 0.95,     // semiángulo en radianes (~109° de cono total)
  nearR: 80,           // radio de percepción inmediata a 360°
  coneRays: 130,       // rayos del cono
  nearRays: 28,        // rayos del círculo cercano
  wallDim: 0.5,        // atenuación máxima de la estructura al borde del cono
  propDim: 0.3,        // atenuación máxima de árboles/coches (más nítidos que los muros)
  fogAlpha: 0.85,      // opacidad de la niebla fuera del campo de visión (85%)
};

// ---------- Techos de los edificios ----------
// Bloquean la visión del interior desde fuera. Al acercarse se atenuan
// (dejan ver el interior por las ventanas); al ENTRAR desaparecen y al
// salir vuelven a dibujarse. Distancias en px desde el rect del edificio.
export const ROOF = {
  near: 56,            // a esta distancia (o menos) el techo queda en su alpha mínimo
  far: 250,            // a partir de aquí es totalmente opaco
  minAlpha: 0.14,      // alpha residual pegado al edificio (fantasma sutil)
};

// ---------- Estructuras especiales (ÚNICAS por mapa) ----------
// Comisaría y tienda: una sola de cada tipo en todo el mapa, mucho más
// grandes que una casa y con tejado plano institucional inconfundible.
//  inside/around: zombis extra DENTRO / ALREDEDOR (la comisaría es el punto
//  más peligroso del mapa; la tienda tiene presión media).
// v0.16 — BASE MILITAR: la estructura más grande del juego. Planta baja
//  INFESTADA (18 dentro, 4 de ellos brutos de guarnición) y un SÓTANO-
//  ARSENAL repleto del mejor botín, con sus propios guardianes abajo.
//  Ahí vive en exclusiva el Subfusil Cuervo y todo el equipo militar.
export const SPECIALS = {
  police: { w: 17, h: 13, inside: 6, around: 4 },   // armería + casilleros
  store:  { w: 14, h: 10, inside: 3, around: 2 },   // pasillos de estanterías
  military: { w: 22, h: 20, inside: 18, around: 5, basement: 4 },  // arsenal subterráneo
};

// ---------- Ciclo día/noche (v0.11) ----------
// Un ciclo COMPLETO (día + noche) dura 12 min reales = 24 h de juego:
// 1 hora del reloj = 30 s. La partida amanece a las 08:00 del día 1.
// De noche (20:00–06:00) el mundo se oscurece (niebla más opaca + velo
// azul) y cada hora repone zombis FUERA de la línea de visión del jugador.
export const DAYNIGHT = {
  cycleSec: 720,       // 12 minutos por ciclo completo
  startHour: 8,        // amanecer del día 1
  nightStart: 20,      // 20:00 — empieza a oscurecer (respawns desde las 21:00)
  nightEnd: 6,         // 06:00 — amanece
  fogDay: 0.78,        // niebla de día (algo más clara que la clásica 0.85)
  fogNight: 0.93,      // niebla de noche (opresiva)
  tintNight: 0.42,     // velo azul oscuro en plena noche
  tintDusk: 0.16,      // golpe cálido al amanecer/atardecer
};

// ---------- Clima (v0.15): lluvia y neblina ----------
// El clima es un evento GLOBAL con vida propia: cada 2-5 días de juego
// llega un frente que dura entre medio día y un día completos (12-24 h de
// juego, aleatorio). Llega y se va con una rampa suave (~1 h de juego)
// para que la transición no sea un cambio brusco.
//  - LLUVIA: enmascara el sonido (el radio de los ruidos baja un 25% —
//    tus pasos y disparos atraen menos) pero reduce un poco la visión (12%).
//  - NEBLINA: reduce la visibilidad a la MITAD (cono de 440→220 px) y
//    también cierra el alcance visual de los zombis (ven/huelen a 112→56 px).
// El clima solo avanza JUGANDO (como el ciclo día/noche) y se guarda con
// la partida (save.js: bloque wx).
export const WEATHER = {
  gapDays: [2, 5],        // días de juego entre frentes (aleatorio en el rango)
  durHours: [12, 24],     // duración: medio día a un día de juego
  rampHours: 1,           // entrada/salida suaves (~1 h de juego)
  rainChance: 0.55,       // probabilidad de que el frente sea lluvia (resto: neblina)
  rainVisionMul: 0.88,    // lluvia: visibilidad −12% («un poco»)
  fogVisionMul: 0.5,      // neblina: visibilidad −50% («en gran medida»)
  rainNoiseMul: 0.75,     // lluvia: los ruidos se enmascaran (radio efectivo −25%)
};

// ---------- Plantas: 2º piso y sótanos ----------
// Algunas casas tienen una planta extra (nunca las dos): una escalera interior
// conecta la planta baja con el 2º piso o el sótano. Mecánica visual gemela a
// la de los techos: en planta baja NO se ve la otra planta; mientras subes/bajas
// las escaleras la planta destino va apareciendo con un fundido (alpha 0→1);
// al llegar, la capa de TU planta es opaca y tapa lo que hay debajo.
export const FLOORS = {
  upperChance: 0.35,       // probabilidad de que una casa tenga 2º piso
  basementChance: 0.34,    // si no tiene 2º piso: probabilidad de sótano
  climbTime: 1.15,         // segundos que toma subir/bajar las escaleras
  stepEvery: 0.34,         // cadencia de pasos de escalera (sfx)
};

// ---------- Jugador ----------
export const PLAYER_CFG = {
  radius: 11,
  walk: 112,           // px/s
  run: 195,
  sneak: 56,
  exhaustedFloor: 25,      // para volver a correr tras agotarse
  stepDist: 26,            // px recorridos por "paso" (ruido + sfx)
  noiseSneak: 26,
  noiseWalk: 72,
  noiseRun: 170,
};

// Puños (arma por defecto cuando no hay nada equipado)
export const FISTS = {
  name: 'Puños', cat: 'arma', dmg: 12, range: 34, stamina: 10,
  cd: 0.45, noise: 90, kb: 14, color: '#c9a27a', desc: 'Tus propios puños. Mejor que nada… apenas.',
};

// ---------- Supervivencia ----------
export const SURV = {
  hungerRate: 0.16,        // por segundo
  thirstRate: 0.22,
  critLevel: 12,           // por debajo → penalizaciones
  hungerHpDrain: 0.35,     // vida por segundo en nivel crítico
  thirstHpDrain: 0.5,
  thirstRegenMult: 0.5,    // regeneración de stamina con sed crítica
  staminaRunDrain: 9,      // por segundo corriendo
  staminaRegenWalk: 6,     // por segundo caminando
  staminaRegenIdle: 11,    // por segundo quieto
  infectionRate: 0.36,     // progreso de infección por segundo (~4.6 min)
  rottenHp: 12,            // daño inmediato por comida podrida
  intoxDur: 25,            // segundos de intoxicación
  intoxRegenMult: 0.45,
  rottenHungerMult: 0.35,  // la comida podrida alimenta mucho menos
  biteChance: 0.12,        // probabilidad de mordida por golpe recibido
  biteInfectChance: 0.65,  // probabilidad de infección si te muerden
};

// ---------- Zombis ----------
// v0.14 — VARIANTES: además del zombi común existen CORREDORES (mitad de
// vida, rápidos pero con margen real para escaparles y contragolpear desde
// v0.15) y BRUTOS (escasos: comisaría/tienda + algún errante ocasional;
// lentos, durísimos y brutales).
// Los valores de la cabecera son el zombi NORMAL; las variantes los
// sobreescriben en ZOMBIE_CFG.variants.
export const ZOMBIE_CFG = {
  count: 150,            // v0.16: mapa al doble → densidad intacta (antes 74)
  hp: 100,
  radius: 10,
  wanderSpeed: 30,
  investigateSpeed: 55,
  chaseSpeed: 78,
  detectRadius: 112,      // te "ven/huelen" a esta distancia con línea de visión
  detectSneak: 58,        // si vas agachado
  detectRun: 160,         // si vas corriendo (te delata el movimiento)
  attackRange: 26,
  attackCd: 0.9,
  dmgMin: 8,
  dmgMax: 14,
  loseSightTime: 2.6,     // segundos sin verte antes de investigar tu última posición
  searchTime: 3.0,
  groanMin: 4,
  groanMax: 11,
  nightBatch: 10,      // v0.16: zombis repuestos por cada hora de noche (antes 5)
  nightCap: 220,       // v0.16: tope de zombis simultáneos (antes 110)
  // --- v0.14: variantes ---
  runnerChance: 0.15,        // proporción de corredores en la horda callejera
  nightRunnerChance: 0.25,   // de noche los corredores presionan más
  bruteSpecials: { police: 2, store: 1, military: 4 },  // brutos de guarnición por estructura
  bruteRoamChance: 0.55,     // probabilidad de que el mapa tenga brutos errantes
  variants: {
    // CORREDOR: carne fresca. Mitad de vida y rápido, pero ya NO te pega
    // pegado sin remedio (v0.15): 148 px/s de persecución (techo 155 con
    // su variación) — caminando te alcanza, pero esprintando le ganas por
    // 40+ px/s y abres hueco en segundos. Además su golpe deja respiro
    // (cadencia 1.05 s) para que el contragolpe sea una opción real.
    runner: {
      hp: 50,
      radius: 9,
      wanderSpeed: 46,
      investigateSpeed: 102,
      chaseSpeed: 148,             // ~0.76 × esprint del jugador: escapable de verdad
      speedMulRange: [0.95, 1.05], // techo 155.4 < 195: esprintando SIEMPRE le ganas
      attackCd: 1.05,              // v0.15: ventana de contragolpe entre mordiscos
      attackRange: 25,
      dmgMin: 8,
      dmgMax: 14,
      loseSightTime: 2.8,          // v0.15: si rompes la línea de visión, cesa antes
      kbMult: 1.35,                // ligeros: salen volando con cada golpe
      groanPitch: 1.55,            // chillido agudo
    },
    // BRUTO: masa.putrefacta. Solo en comisaría/tienda y, a veces, vagando;
    // lento (incluso caminando lo dejas atrás) pero aguantas un cargador
    // entero y sus golpes duelen el doble.
    brute: {
      hp: 220,
      radius: 13,
      wanderSpeed: 15,
      investigateSpeed: 38,
      chaseSpeed: 56,
      speedMulRange: [0.9, 1.1],
      attackCd: 1.3,               // brazo pesado: golpea más lento
      attackRange: 31,
      dmgMin: 16,
      dmgMax: 26,
      loseSightTime: 3.6,
      kbMult: 0.22,                // masa bruta: apenas retrocede
      groanPitch: 0.55,            // retumbar grave
    },
  },
};

// ---------- Armas a distancia ----------
// Modelo/nombre inventados. ranged:true → disparan (clic) en vez de golpe melee.
//  ammo: id de la munición que consumen (cat 'municion', apilable)
//  magType: id del cargador extraíble (cat 'cargador', guarda sus balas dentro)
//  tubeCap: la escopeta no usa cargadores — tubo interno de cartuchos
//  draw: segundos de "desenfundado" al equiparla (la funda de pistola lo reduce)
//  noise: radio de atracción de zombis — un disparo se oye en TODO el barrio
export const RANGED = {
  pistola: {
    id: 'pistola_vibora', name: 'Víbora VP-9', gunClass: 'pistola',
    dmg: 34, cd: 0.30, range: 560, spread: 0.045, pellets: 1,
    reload: 1.5, draw: 0.55, noise: 620, kb: 9, shake: 3, gunLen: 17,
    magType: 'cargador_9mm', ammo: 'bala_9mm', sfx: 'pistola',
    desc: 'Pistola semiautomática 9×19mm. Fiable, precisa y discreta… para ser un arma de fuego. Cargador de 15.',
  },
  escopeta: {
    id: 'escopeta_guardian', name: 'Guardián 12', gunClass: 'escopeta',
    dmg: 15, cd: 0.92, range: 310, spread: 0.22, pellets: 6,
    shellTime: 0.5, draw: 0.7, noise: 800, kb: 34, shake: 6, gunLen: 23,
    tubeCap: 6, ammo: 'cartucho_12', sfx: 'escopeta',
    desc: 'Escopeta de corredera calibre 12. Seis postas por cartucho: a corta distancia es una guillotina. Sin cargador: cartuchos al tubo (6).',
  },
  rifle: {
    id: 'rifle_condor', name: 'Cóndor AR-56', gunClass: 'rifle',
    dmg: 31, cd: 0.11, range: 760, spread: 0.055, pellets: 1,
    reload: 2.1, draw: 0.75, noise: 760, kb: 11, shake: 3.5, gunLen: 24,
    magType: 'cargador_556', ammo: 'bala_556', sfx: 'rifle', auto: true,
    desc: 'Rifle de asalto 5.56×45mm automático. Devastador a media distancia… y ensordecedor. Cargador de 30.',
  },
  // ---- v0.16: cuatro armas nuevas ----
  revolver: {
    id: 'revolver_aspid', name: 'Áspid .357', gunClass: 'revolver',
    dmg: 52, cd: 0.5, range: 540, spread: 0.04, pellets: 1,
    shellTime: 1.1, draw: 0.5, noise: 680, kb: 15, shake: 4.5, gunLen: 16,
    tubeCap: 5, ammo: 'bala_357', sfx: 'revolver',
    desc: 'Revólver de acero .357 Magnum. Tambor de 5: se recarga cámara a cámara (lenta), pero cada golpe es una martillada. Cadencia media, daño alto. Tan común como la VP-9.',
  },
  doble: {
    id: 'escopeta_yarara', name: 'Yarará Doble', gunClass: 'dobles',
    dmg: 13, cd: 0.3, range: 300, spread: 0.24, pellets: 6,
    shellTime: 0.85, draw: 0.6, noise: 820, kb: 30, shake: 6, gunLen: 21,
    tubeCap: 2, ammo: 'cartucho_12', sfx: 'escopeta',
    desc: 'Escopeta de dos cañones superpuestos calibre 12. Solo 2 cartuchos y recarga media (rompe-culata), pero dispara los dos casi seguidos: a bocajarro es un muro de postas. Más común que la corredera.',
  },
  cerrojo: {
    id: 'rifle_nandu', name: 'Ñandú .308', gunClass: 'cerrojo',
    dmg: 85, cd: 1.15, range: 820, spread: 0.02, pellets: 1,
    shellTime: 1.2, draw: 0.8, noise: 900, kb: 24, shake: 7, gunLen: 27,
    tubeCap: 5, ammo: 'bala_308', sfx: 'cerrojo',
    desc: 'Rifle de caza de cerrojo .308 Winchester. Daño brutal (un zombi normal cae de un toque) y alcance récord, pero cadencia lenta y recarga de bala en bala en el almacén interno de 5. Mismo nivel de rareza que la Yarará Doble.',
  },
  subfusil: {
    id: 'subfusil_cuervo', name: 'Cuervo SMG-9', gunClass: 'subfusil',
    dmg: 18, cd: 0.075, range: 520, spread: 0.075, pellets: 1,
    reload: 2.4, draw: 0.65, noise: 700, kb: 7, shake: 2.5, gunLen: 21,
    magType: 'cargador_cuervo', ammo: 'bala_9mm', sfx: 'subfusil', auto: true,
    desc: 'Subfusil automático 9×19mm con cargadores de 35. Cadencia altísima y daño por bala discreto: muerde en ráfagas. EXCLUSIVO de la Base Militar.',
  },
};

// ---------- Base de datos de objetos ----------
// cat: comida | bebida | medico | arma | ropa | municion | cargador
export const ITEMS = {
  // Comida
  lata_frijoles: { name: 'Lata de frijoles', cat: 'comida', hunger: 40, color: '#b5622d', stack: 5, desc: 'Comida enlatada calórica. +40 hambre.' },
  lata_atun: { name: 'Lata de atún', cat: 'comida', hunger: 32, color: '#8a98a8', stack: 5, desc: 'Proteína en lata. +32 hambre.' },
  papas: { name: 'Bolsa de papas', cat: 'comida', hunger: 18, stamina: 8, color: '#d9b23a', stack: 3, desc: 'Crujiente y salada. +18 hambre, +8 stamina.' },
  manzana: { name: 'Manzana', cat: 'comida', hunger: 15, thirst: 5, color: '#b83a3a', stack: 5, desc: 'Fruta fresca. +15 hambre, +5 sed.' },
  chocolate: { name: 'Barra de chocolate', cat: 'comida', hunger: 12, stamina: 14, color: '#6a4630', stack: 3, desc: 'Azúcar rápida. +12 hambre, +14 stamina.' },
  // Bebida
  agua: { name: 'Botella de agua', cat: 'bebida', thirst: 45, color: '#4aa8d9', stack: 5, desc: 'Hidratación pura. +45 sed.' },
  refresco: { name: 'Lata de refresco', cat: 'bebida', thirst: 25, hunger: 8, color: '#c0392b', stack: 5, desc: 'Azúcar y gas. +25 sed, +8 hambre.' },
  // Médico
  venda: { name: 'Venda', cat: 'medico', healOverTime: 25, healDur: 5, color: '#e0dcc8', stack: 5, desc: 'Cura 25 de vida en 5 segundos.' },
  botiquin: { name: 'Botiquín', cat: 'medico', heal: 50, color: '#d94a4a', stack: 2, desc: 'Curación completa de emergencia. +50 vida al instante.' },
  antibioticos: { name: 'Antibióticos', cat: 'medico', color: '#e8f0d8', stack: 2, desc: 'Cura la infección si está incipiente (<30). Si no, ralentiza un 55%.' },
  // Armas (daño, alcance, coste de stamina, cooldown, radio de ruido, empuje)
  tubo: { name: 'Tubo de acero', cat: 'arma', dmg: 28, range: 44, stamina: 14, cd: 0.55, noise: 130, kb: 26, color: '#9aa0a6', desc: 'Contundente y confiable. Daño 28.' },
  bate: { name: 'Bate de béisbol', cat: 'arma', dmg: 34, range: 50, stamina: 16, cd: 0.6, noise: 135, kb: 34, color: '#b98a5a', desc: 'Madera dura, buen alcance. Daño 34.' },
  hacha: { name: 'Hacha de bombero', cat: 'arma', dmg: 48, range: 46, stamina: 22, cd: 0.7, noise: 140, kb: 30, color: '#c0392b', desc: 'Devastadora pero agotadora. Daño 48.' },
  // Armas de fuego (ver RANGED arriba para los parámetros de disparo)
  pistola_vibora: {
    name: 'Víbora VP-9', cat: 'arma', ranged: true, gunClass: 'pistola',
    dmg: 34, cd: 0.30, range: 560, spread: 0.045, pellets: 1,
    reload: 1.5, draw: 0.55, noise: 620, kb: 9, shake: 3, gunLen: 17,
    magType: 'cargador_9mm', ammo: 'bala_9mm', sfx: 'pistola',
    color: '#3a3f46', stack: 1,
    desc: 'Pistola semiautomática 9×19mm. Fiable y precisa. Cargador de 15.',
  },
  escopeta_guardian: {
    name: 'Guardián 12', cat: 'arma', ranged: true, gunClass: 'escopeta',
    dmg: 15, cd: 0.92, range: 310, spread: 0.22, pellets: 6,
    shellTime: 0.5, draw: 0.7, noise: 800, kb: 34, shake: 6, gunLen: 23,
    tubeCap: 6, ammo: 'cartucho_12', sfx: 'escopeta',
    color: '#5a4632', stack: 1,
    desc: 'Escopeta de corredera calibre 12. 6 postas por cartucho. Tubo de 6, sin cargador.',
  },
  rifle_condor: {
    name: 'Cóndor AR-56', cat: 'arma', ranged: true, gunClass: 'rifle',
    dmg: 31, cd: 0.11, range: 760, spread: 0.055, pellets: 1,
    reload: 2.1, draw: 0.75, noise: 760, kb: 11, shake: 3.5, gunLen: 24,
    magType: 'cargador_556', ammo: 'bala_556', sfx: 'rifle', auto: true,
    color: '#2e3428', stack: 1,
    desc: 'Rifle de asalto 5.56×45mm automático. Cargador de 30. Ruidoso a más no poder.',
  },
  // ---- v0.16: armas nuevas ----
  revolver_aspid: {
    name: 'Áspid .357', cat: 'arma', ranged: true, gunClass: 'revolver',
    dmg: 52, cd: 0.5, range: 540, spread: 0.04, pellets: 1,
    shellTime: 1.1, draw: 0.5, noise: 680, kb: 15, shake: 4.5, gunLen: 16,
    tubeCap: 5, ammo: 'bala_357', sfx: 'revolver',
    color: '#8a8f96', stack: 1,
    desc: 'Revólver .357 Magnum. Tambor de 5, recarga lenta cámara a cámara. Daño alto.',
  },
  escopeta_yarara: {
    name: 'Yarará Doble', cat: 'arma', ranged: true, gunClass: 'dobles',
    dmg: 13, cd: 0.3, range: 300, spread: 0.24, pellets: 6,
    shellTime: 0.85, draw: 0.6, noise: 820, kb: 30, shake: 6, gunLen: 21,
    tubeCap: 2, ammo: 'cartucho_12', sfx: 'escopeta',
    color: '#4a3a2a', stack: 1,
    desc: 'Escopeta de dos cañones calibre 12. 2 cartuchos, cadencia rapidísima.',
  },
  rifle_nandu: {
    name: 'Ñandú .308', cat: 'arma', ranged: true, gunClass: 'cerrojo',
    dmg: 85, cd: 1.15, range: 820, spread: 0.02, pellets: 1,
    shellTime: 1.2, draw: 0.8, noise: 900, kb: 24, shake: 7, gunLen: 27,
    tubeCap: 5, ammo: 'bala_308', sfx: 'cerrojo',
    color: '#5a4632', stack: 1,
    desc: 'Rifle de caza de cerrojo .308. Daño brutal, cadencia lenta, 5 balas internas.',
  },
  subfusil_cuervo: {
    name: 'Cuervo SMG-9', cat: 'arma', ranged: true, gunClass: 'subfusil',
    dmg: 18, cd: 0.075, range: 520, spread: 0.075, pellets: 1,
    reload: 2.4, draw: 0.65, noise: 700, kb: 7, shake: 2.5, gunLen: 21,
    magType: 'cargador_cuervo', ammo: 'bala_9mm', sfx: 'subfusil', auto: true,
    color: '#26292e', stack: 1,
    desc: 'Subfusil automático 9mm. Cargadores de 35. Solo en la Base Militar.',
  },
  // Munición (apilable) — alimenta los cargadores automáticamente al recogerla
  bala_9mm: { name: 'Balas 9mm', cat: 'municion', color: '#c9a24f', stack: 60, lootMin: 6, lootMax: 18, desc: 'Cartuchos 9×19mm. Rellenan solos los cargadores VP-9 que lleves; el sobrante queda en la mochila.' },
  cartucho_12: { name: 'Cartuchos cal. 12', cat: 'municion', color: '#b0392b', stack: 40, lootMin: 4, lootMax: 12, desc: 'Cartuchos de postas calibre 12. Se cargan directamente en el tubo de la Guardián 12.' },
  bala_556: { name: 'Balas 5.56mm', cat: 'municion', color: '#8a9a4f', stack: 90, lootMin: 8, lootMax: 24, desc: 'Cartuchos 5.56×45mm. Rellenan solos los cargadores AR-56 que lleves; el sobrante queda en la mochila.' },
  // ---- v0.16: munición nueva ----
  bala_357: { name: 'Balas .357', cat: 'municion', color: '#c98a4f', stack: 60, lootMin: 6, lootMax: 14, desc: 'Cartuchos .357 Magnum. Al recogerlas pasan solas al tambor del Áspid; el resto queda en la mochila.' },
  bala_308: { name: 'Balas .308', cat: 'municion', color: '#a8b29a', stack: 50, lootMin: 4, lootMax: 10, desc: 'Cartuchos .308 Winchester de caza. Se insertan una a una en el almacén del Ñandú.' },
  // Cargadores (no apilables): guardan sus balas dentro (item.rounds)
  cargador_9mm: { name: 'Cargador VP-9', cat: 'cargador', cap: 15, ammo: 'bala_9mm', color: '#4a4f56', desc: 'Cargador extraíble de 15 balas 9mm. Se rellena solo con la munición que recogas.' },
  cargador_556: { name: 'Cargador AR-56', cat: 'cargador', cap: 30, ammo: 'bala_556', color: '#3a4232', desc: 'Cargador extraíble de 30 balas 5.56mm. Se rellena solo con la munición que recogas.' },
  cargador_cuervo: { name: 'Cargador Cuervo', cat: 'cargador', cap: 35, ammo: 'bala_9mm', color: '#23262a', desc: 'Cargador extraíble de 35 balas 9mm del subfusil Cuervo. Se rellena solo con la munición que recogas.' },
  // Ropa — slot: cabeza | accesorios | torso | pantalones
  gorra: { name: 'Gorra', cat: 'ropa', slot: 'cabeza', armor: 0.03, color: '#2b2b30', desc: 'Protección simbólica. 3% reducción de daño.' },
  casco_obra: { name: 'Casco de obra', cat: 'ropa', slot: 'cabeza', armor: 0.15, color: '#d9a520', desc: 'Amarillo y sólido. 15% reducción de daño.' },
  casco_tactico: { name: 'Casco táctico', cat: 'ropa', slot: 'cabeza', armor: 0.22, color: '#3a4a3a', desc: 'Equipo militar. 22% reducción de daño.' },
  casco_combate: { name: 'Casco de combate M88', cat: 'ropa', slot: 'cabeza', armor: 0.30, color: '#3a4030', desc: 'Casco reglamentario con arnés. 30% reducción de daño: la mejor protección de cabeza.' },
  lentes: { name: 'Lentes de sol', cat: 'ropa', slot: 'accesorios', armor: 0.02, color: '#1a1a1e', desc: 'Estilo ante el apocalipsis. 2% reducción.' },
  pasamontanas: { name: 'Pasamontañas', cat: 'ropa', slot: 'accesorios', infectProt: 0.25, noiseMod: 0.85, color: '#26262a', desc: 'Cubre el cuello. -25% infección por mordida, pasos más silenciosos.' },
  mascara_gas: { name: 'Máscara de gas', cat: 'ropa', slot: 'accesorios', infectProt: 0.7, color: '#4a5a3a', desc: 'Filtro completo. -70% infección por mordida.' },
  // Fundas (2ª ranura de accesorio): aceleran el desenfunde y la recarga de la PISTOLA
  funda_cadera: { name: 'Funda de cadera', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.55, pistolReloadMod: 0.8, color: '#6a4a2c', desc: 'Funda de cuero al costado. Desenfunde de pistola un 45% más rápido y -20% tiempo de recarga.' },
  funda_hombro: { name: 'Funda de hombro', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.45, pistolReloadMod: 0.68, color: '#3a3a44', desc: 'Funda axilar bajo la chaqueta. Desenfunde un 55% más rápido y -32% tiempo de recarga.' },
  funda_tactica: { name: 'Funda táctica de pierna', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.32, pistolReloadMod: 0.5, color: '#2f3a2f', desc: 'Funda de nylon con retención. Desenfunde prácticamente instantáneo y -50% tiempo de recarga.' },
  // ---- v0.16: equipo militar (EXCLUSIVO de la Base Militar) ----
  funda_muslera: { name: 'Funda de muslera militar', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.25, pistolReloadMod: 0.42, color: '#3d4a35', desc: 'Funda reglamentaria de tiro rápido. El desenfunde más veloz del juego y -58% tiempo de recarga de armas cortas.' },
  mascara_cm4: { name: 'Máscara militar CM-4', cat: 'ropa', slot: 'accesorios', infectProt: 0.85, color: '#39422f', desc: 'Máscara de filtro pesado de dotación militar. -85% infección por mordida: lo mejor que puedes llevar en la cara.' },
  respirador_tactico: { name: 'Respirador táctico', cat: 'ropa', slot: 'accesorios', infectProt: 0.55, noiseMod: 0.88, color: '#2c3330', desc: 'Media máscara con válvula. -55% infección por mordida y respiración filtrada más silenciosa.' },
  playera: { name: 'Playera blanca', cat: 'ropa', slot: 'torso', armor: 0, color: '#c8c8c0', desc: 'Algodón. Sin protección.' },
  chaqueta: { name: 'Chaqueta de cuero', cat: 'ropa', slot: 'torso', armor: 0.12, color: '#5a3a2a', desc: 'Cuero grueso. 12% reducción de daño.' },
  chaleco: { name: 'Chaleco táctico', cat: 'ropa', slot: 'torso', armor: 0.25, slotsBonus: 4, color: '#2f3a2f', desc: 'Placas balísticas. 25% reducción y +4 espacios.' },
  uniforme_cargo: { name: 'Uniforme de campaña', cat: 'ropa', slot: 'torso', armor: 0.18, slotsBonus: 2, color: '#4a5238', desc: 'Uniforme militar de campo. 18% reducción de daño y +2 espacios de bolsillo.' },
  chaleco_balistico: { name: 'Chaleco balístico reforzado', cat: 'ropa', slot: 'torso', armor: 0.34, slotsBonus: 5, color: '#39412e', desc: 'Chaleco con placas cerámicas de dotación militar. 34% reducción (el máximo) y +5 espacios. El mejor torso del juego.' },
  jeans: { name: 'Jeans', cat: 'ropa', slot: 'pantalones', armor: 0, color: '#3a4a6a', desc: 'Denim resistente al roce, no a los dientes.' },
  cargo: { name: 'Pantalón cargo', cat: 'ropa', slot: 'pantalones', slotsBonus: 2, color: '#5a5230', desc: 'Bolsillos everywhere. +2 espacios.' },
  pantalon_cargo_mil: { name: 'Pantalón de campaña', cat: 'ropa', slot: 'pantalones', armor: 0.08, slotsBonus: 4, color: '#454d36', desc: 'Pantalón militar de ripstop. 8% reducción y +4 espacios de carga: el mejor del juego.' },
  shorts: { name: 'Shorts deportivos', cat: 'ropa', slot: 'pantalones', color: '#7a7a8a', desc: 'Aerodinámico. Nada útil.' },
  // ---- v0.16: ración militar (EXCLUSIVA de la Base Militar) ----
  racion_combate: { name: 'Ración de combate', cat: 'comida', hunger: 55, stamina: 20, color: '#4a5238', stack: 4, desc: 'Ración militar de campaña calórica y estable. +55 hambre, +20 energía. La mejor comida del juego.' },
};

// Slots de ropa (orden de render del equipo) — DOS ranuras de accesorio:
// cualquier accesorio (lentes, pasamontañas, máscara, fundas…) puede ir en
// cualquiera de las dos; se rellena primero la primera libre.
export const EQUIP_SLOTS = ['cabeza', 'accesorios', 'accesorios2', 'torso', 'pantalones'];
export const EQUIP_LABELS = {
  cabeza: 'CABEZA', accesorios: 'ACCESORIO 1', accesorios2: 'ACCESORIO 2',
  torso: 'TORSO', pantalones: 'PANTALONES', arma: 'ARMA',
};

// ---------- Contenedores del mundo ----------
export const CONTAINER_DEFS = {
  nevera: { name: 'Nevera', color: '#aeb6ba', letter: 'N', slots: 6 },
  alacena: { name: 'Alacena', color: '#8a6a42', letter: 'A', slots: 5 },
  armario: { name: 'Armario', color: '#6a4a2c', letter: 'R', slots: 5 },
  casillero: { name: 'Casillero', color: '#4a6a6a', letter: 'C', slots: 6 },
  botiquin_pared: { name: 'Botiquín de pared', color: '#d94a4a', letter: '+', slots: 4 },
  // solo dentro de la comisaría (estructura única)
  armeria: { name: 'Armería', color: '#3a4a6a', letter: 'W', slots: 6 },
  // solo dentro de la tienda (estructura única)
  estanteria: { name: 'Estantería', color: '#a84a3a', letter: 'E', slots: 6 },
  // ---- v0.16: solo dentro de la BASE MILITAR ----
  taquilla_mil: { name: 'Taquilla militar', color: '#3f4a3f', letter: 'M', slots: 6 },
  caja_municion: { name: 'Caja de munición', color: '#5a5240', letter: 'X', slots: 6 },
  armeria_mil: { name: 'Armería militar', color: '#2f3a2f', letter: 'G', slots: 6 },
  estanteria_mil: { name: 'Estantería de suministros', color: '#6a6a4a', letter: 'S', slots: 6 },
};

// Tablas de botín ponderadas [idItem, peso]
// Las armas de fuego salen de casilleros (comisaría/instalaciones) y,
// con menos suerte, de armarios de casa. Fundas en armarios y casilleros.
// v0.12: el Cóndor AR-56 SOLO sale de las armerías de la comisaría (fuera
// de su tabla jamás aparece); balas y cargadores 5.56 se encuentran
// raramente en casilleros de cualquier edificio del mapa.
export const LOOT = {
  nevera: [['agua', 24], ['refresco', 14], ['manzana', 12], ['lata_frijoles', 9], ['lata_atun', 7], ['venda', 4]],
  alacena: [['lata_frijoles', 20], ['lata_atun', 16], ['papas', 16], ['chocolate', 12], ['refresco', 8], ['agua', 6]],
  armario: [['playera', 12], ['jeans', 12], ['chaqueta', 10], ['cargo', 10], ['gorra', 10], ['pasamontanas', 7], ['lentes', 6], ['shorts', 6], ['venda', 5], ['mascara_gas', 3], ['funda_cadera', 4], ['funda_hombro', 2], ['bala_9mm', 3]],
  // v0.16: revólver tan común como la VP-9 (peso 4 = pistola); doble Yarará
  // más común que la corredera (3.2 > 2.2); Ñandú a la par de la Yarará.
  casillero: [['tubo', 10], ['bate', 7], ['hacha', 3], ['chaleco', 5], ['casco_obra', 7], ['casco_tactico', 3], ['venda', 8], ['botiquin', 4], ['antibioticos', 3], ['papas', 6], ['refresco', 6], ['agua', 6], ['chocolate', 5], ['mascara_gas', 2], ['pistola_vibora', 4], ['revolver_aspid', 4], ['escopeta_guardian', 2.2], ['escopeta_yarara', 3.2], ['rifle_nandu', 3.2], ['cargador_9mm', 5], ['cargador_556', 2.2], ['bala_9mm', 11], ['bala_357', 11], ['cartucho_12', 8], ['bala_556', 5], ['bala_308', 4], ['funda_cadera', 4], ['funda_hombro', 2.4], ['funda_tactica', 1.6]],
  botiquin_pared: [['venda', 30], ['botiquin', 12], ['antibioticos', 9], ['agua', 6]],
  // ARMERÍA (comisaría): la ÚNICA fuente del Cóndor AR-56 fuera de la base
  // militar (v0.12: rifle y familia 5.56 bastante más raros). v0.16: también
  // suelta las armas nuevas comunes.
  armeria: [
    ['rifle_condor', 9], ['pistola_vibora', 8], ['revolver_aspid', 7],
    ['escopeta_guardian', 6], ['escopeta_yarara', 5], ['rifle_nandu', 5],
    ['cargador_556', 9], ['cargador_9mm', 8],
    ['bala_556', 18], ['bala_9mm', 14], ['bala_357', 12], ['cartucho_12', 9], ['bala_308', 8],
    ['chaleco', 7], ['casco_tactico', 6], ['funda_tactica', 4],
    ['botiquin', 5], ['antibioticos', 3],
  ],
  // ESTANTERÍA (tienda): comida y bebida a porrillo
  estanteria: [
    ['lata_frijoles', 30], ['lata_atun', 26], ['agua', 22], ['refresco', 18],
    ['papas', 15], ['chocolate', 13], ['manzana', 11], ['venda', 3],
  ],
  // ---- v0.16: BASE MILITAR — el mejor botín del juego, más abundante que
  // la comisaría. El Subfusil Cuervo y el equipo militar viven SOLO aquí. ----
  taquilla_mil: [
    ['uniforme_cargo', 16], ['casco_combate', 12], ['racion_combate', 12],
    ['pantalon_cargo_mil', 10], ['respirador_tactico', 8], ['funda_muslera', 8],
    ['mascara_cm4', 7], ['chaleco_balistico', 4],
    ['venda', 6], ['agua', 5], ['antibioticos', 3],
  ],
  caja_municion: [
    ['bala_9mm', 22], ['bala_556', 20], ['cartucho_12', 16],
    ['bala_357', 14], ['bala_308', 12],
    ['cargador_9mm', 8], ['cargador_556', 8], ['cargador_cuervo', 7],
  ],
  armeria_mil: [
    ['subfusil_cuervo', 12], ['cargador_cuervo', 12], ['rifle_condor', 10],
    ['cargador_556', 10], ['rifle_nandu', 8], ['escopeta_yarara', 8],
    ['revolver_aspid', 8], ['escopeta_guardian', 6], ['pistola_vibora', 6],
    ['cargador_9mm', 8], ['bala_556', 18], ['bala_9mm', 16],
    ['cartucho_12', 12], ['bala_357', 12], ['bala_308', 10],
    ['funda_muslera', 6], ['chaleco_balistico', 5], ['casco_combate', 5],
    ['botiquin', 6], ['antibioticos', 4],
  ],
  estanteria_mil: [
    ['racion_combate', 30], ['agua', 22], ['venda', 12],
    ['antibioticos', 8], ['botiquin', 6], ['refresco', 6],
  ],
};

// Probabilidad de que la comida generada esté podrida, por contenedor
export const ROTTEN_CHANCE = { nevera: 0.38, alacena: 0.15, casillero: 0.2, armario: 0, botiquin_pared: 0, armeria: 0, estanteria: 0.12, taquilla_mil: 0, caja_municion: 0, armeria_mil: 0, estanteria_mil: 0.05 };

// ---------- Aparición de armas encontradas ----------
// Un arma hallada SIEMPRE trae algo dentro (cargador con balas o tubo cargado):
// 50% llena del todo, 50% parcial (30%..95% de la capacidad).
export const GUN_FOUND_FULL_CHANCE = 0.5;

// ---------- Inventario ----------
export const BASE_SLOTS = 10;
