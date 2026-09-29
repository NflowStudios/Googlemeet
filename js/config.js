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
export const MAP_W = 100;   // tiles
export const MAP_H = 80;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

// Tipos de tile
export const T = {
  GRASS: 0, ROAD: 1, SIDEWALK: 2, FLOOR: 3, WALL: 4,
  DOOR_CLOSED: 5, TREE: 6, WINDOW: 7, DOOR_OPEN: 8, CAR: 9,
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
export const ZOMBIE_CFG = {
  count: 44,
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
  // Munición (apilable) — alimenta los cargadores automáticamente al recogerla
  bala_9mm: { name: 'Balas 9mm', cat: 'municion', color: '#c9a24f', stack: 60, lootMin: 6, lootMax: 18, desc: 'Cartuchos 9×19mm. Rellenan solos los cargadores VP-9 que lleves; el sobrante queda en la mochila.' },
  cartucho_12: { name: 'Cartuchos cal. 12', cat: 'municion', color: '#b0392b', stack: 40, lootMin: 4, lootMax: 12, desc: 'Cartuchos de postas calibre 12. Se cargan directamente en el tubo de la Guardián 12.' },
  bala_556: { name: 'Balas 5.56mm', cat: 'municion', color: '#8a9a4f', stack: 90, lootMin: 8, lootMax: 24, desc: 'Cartuchos 5.56×45mm. Rellenan solos los cargadores AR-56 que lleves; el sobrante queda en la mochila.' },
  // Cargadores (no apilables): guardan sus balas dentro (item.rounds)
  cargador_9mm: { name: 'Cargador VP-9', cat: 'cargador', cap: 15, ammo: 'bala_9mm', color: '#4a4f56', desc: 'Cargador extraíble de 15 balas 9mm. Se rellena solo con la munición que recogas.' },
  cargador_556: { name: 'Cargador AR-56', cat: 'cargador', cap: 30, ammo: 'bala_556', color: '#3a4232', desc: 'Cargador extraíble de 30 balas 5.56mm. Se rellena solo con la munición que recogas.' },
  // Ropa — slot: cabeza | accesorios | torso | pantalones
  gorra: { name: 'Gorra', cat: 'ropa', slot: 'cabeza', armor: 0.03, color: '#2b2b30', desc: 'Protección simbólica. 3% reducción de daño.' },
  casco_obra: { name: 'Casco de obra', cat: 'ropa', slot: 'cabeza', armor: 0.15, color: '#d9a520', desc: 'Amarillo y sólido. 15% reducción de daño.' },
  casco_tactico: { name: 'Casco táctico', cat: 'ropa', slot: 'cabeza', armor: 0.22, color: '#3a4a3a', desc: 'Equipo militar. 22% reducción de daño.' },
  lentes: { name: 'Lentes de sol', cat: 'ropa', slot: 'accesorios', armor: 0.02, color: '#1a1a1e', desc: 'Estilo ante el apocalipsis. 2% reducción.' },
  pasamontanas: { name: 'Pasamontañas', cat: 'ropa', slot: 'accesorios', infectProt: 0.25, noiseMod: 0.85, color: '#26262a', desc: 'Cubre el cuello. -25% infección por mordida, pasos más silenciosos.' },
  mascara_gas: { name: 'Máscara de gas', cat: 'ropa', slot: 'accesorios', infectProt: 0.7, color: '#4a5a3a', desc: 'Filtro completo. -70% infección por mordida.' },
  // Fundas (2ª ranura de accesorio): aceleran el desenfunde y la recarga de la PISTOLA
  funda_cadera: { name: 'Funda de cadera', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.55, pistolReloadMod: 0.8, color: '#6a4a2c', desc: 'Funda de cuero al costado. Desenfunde de pistola un 45% más rápido y -20% tiempo de recarga.' },
  funda_hombro: { name: 'Funda de hombro', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.45, pistolReloadMod: 0.68, color: '#3a3a44', desc: 'Funda axilar bajo la chaqueta. Desenfunde un 55% más rápido y -32% tiempo de recarga.' },
  funda_tactica: { name: 'Funda táctica de pierna', cat: 'ropa', slot: 'accesorios', pistolDrawMod: 0.32, pistolReloadMod: 0.5, color: '#2f3a2f', desc: 'Funda de nylon con retención. Desenfunde prácticamente instantáneo y -50% tiempo de recarga.' },
  playera: { name: 'Playera blanca', cat: 'ropa', slot: 'torso', armor: 0, color: '#c8c8c0', desc: 'Algodón. Sin protección.' },
  chaqueta: { name: 'Chaqueta de cuero', cat: 'ropa', slot: 'torso', armor: 0.12, color: '#5a3a2a', desc: 'Cuero grueso. 12% reducción de daño.' },
  chaleco: { name: 'Chaleco táctico', cat: 'ropa', slot: 'torso', armor: 0.25, slotsBonus: 4, color: '#2f3a2f', desc: 'Placas balísticas. 25% reducción y +4 espacios.' },
  jeans: { name: 'Jeans', cat: 'ropa', slot: 'pantalones', armor: 0, color: '#3a4a6a', desc: 'Denim resistente al roce, no a los dientes.' },
  cargo: { name: 'Pantalón cargo', cat: 'ropa', slot: 'pantalones', slotsBonus: 2, color: '#5a5230', desc: 'Bolsillos everywhere. +2 espacios.' },
  shorts: { name: 'Shorts deportivos', cat: 'ropa', slot: 'pantalones', color: '#7a7a8a', desc: 'Aerodinámico. Nada útil.' },
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
};

// Tablas de botín ponderadas [idItem, peso]
// Las armas de fuego salen de casilleros (comisaría/instalaciones) y,
// con menos suerte, de armarios de casa. Fundas en armarios y casilleros.
export const LOOT = {
  nevera: [['agua', 24], ['refresco', 14], ['manzana', 12], ['lata_frijoles', 9], ['lata_atun', 7], ['venda', 4]],
  alacena: [['lata_frijoles', 20], ['lata_atun', 16], ['papas', 16], ['chocolate', 12], ['refresco', 8], ['agua', 6]],
  armario: [['playera', 12], ['jeans', 12], ['chaqueta', 10], ['cargo', 10], ['gorra', 10], ['pasamontanas', 7], ['lentes', 6], ['shorts', 6], ['venda', 5], ['mascara_gas', 3], ['funda_cadera', 4], ['funda_hombro', 2], ['bala_9mm', 3]],
  casillero: [['tubo', 10], ['bate', 7], ['hacha', 3], ['chaleco', 5], ['casco_obra', 7], ['casco_tactico', 3], ['venda', 8], ['botiquin', 4], ['antibioticos', 3], ['papas', 6], ['refresco', 6], ['agua', 6], ['chocolate', 5], ['mascara_gas', 2], ['pistola_vibora', 4], ['escopeta_guardian', 2.2], ['rifle_condor', 1.4], ['cargador_9mm', 5], ['cargador_556', 2.6], ['bala_9mm', 11], ['cartucho_12', 8], ['bala_556', 7], ['funda_cadera', 4], ['funda_hombro', 2.4], ['funda_tactica', 1.6]],
  botiquin_pared: [['venda', 30], ['botiquin', 12], ['antibioticos', 9], ['agua', 6]],
};

// Probabilidad de que la comida generada esté podrida, por contenedor
export const ROTTEN_CHANCE = { nevera: 0.38, alacena: 0.15, casillero: 0.2, armario: 0, botiquin_pared: 0 };

// ---------- Aparición de armas encontradas ----------
// Un arma hallada SIEMPRE trae algo dentro (cargador con balas o tubo cargado):
// 50% llena del todo, 50% parcial (30%..95% de la capacidad).
export const GUN_FOUND_FULL_CHANCE = 0.5;

// ---------- Inventario ----------
export const BASE_SLOTS = 10;
