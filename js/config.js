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

// ---------- Base de datos de objetos ----------
// cat: comida | bebida | medico | arma | ropa
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
  // Ropa — slot: cabeza | accesorios | torso | pantalones
  gorra: { name: 'Gorra', cat: 'ropa', slot: 'cabeza', armor: 0.03, color: '#2b2b30', desc: 'Protección simbólica. 3% reducción de daño.' },
  casco_obra: { name: 'Casco de obra', cat: 'ropa', slot: 'cabeza', armor: 0.15, color: '#d9a520', desc: 'Amarillo y sólido. 15% reducción de daño.' },
  casco_tactico: { name: 'Casco táctico', cat: 'ropa', slot: 'cabeza', armor: 0.22, color: '#3a4a3a', desc: 'Equipo militar. 22% reducción de daño.' },
  lentes: { name: 'Lentes de sol', cat: 'ropa', slot: 'accesorios', armor: 0.02, color: '#1a1a1e', desc: 'Estilo ante el apocalipsis. 2% reducción.' },
  pasamontanas: { name: 'Pasamontañas', cat: 'ropa', slot: 'accesorios', infectProt: 0.25, noiseMod: 0.85, color: '#26262a', desc: 'Cubre el cuello. -25% infección por mordida, pasos más silenciosos.' },
  mascara_gas: { name: 'Máscara de gas', cat: 'ropa', slot: 'accesorios', infectProt: 0.7, color: '#4a5a3a', desc: 'Filtro completo. -70% infección por mordida.' },
  playera: { name: 'Playera blanca', cat: 'ropa', slot: 'torso', armor: 0, color: '#c8c8c0', desc: 'Algodón. Sin protección.' },
  chaqueta: { name: 'Chaqueta de cuero', cat: 'ropa', slot: 'torso', armor: 0.12, color: '#5a3a2a', desc: 'Cuero grueso. 12% reducción de daño.' },
  chaleco: { name: 'Chaleco táctico', cat: 'ropa', slot: 'torso', armor: 0.25, slotsBonus: 4, color: '#2f3a2f', desc: 'Placas balísticas. 25% reducción y +4 espacios.' },
  jeans: { name: 'Jeans', cat: 'ropa', slot: 'pantalones', armor: 0, color: '#3a4a6a', desc: 'Denim resistente al roce, no a los dientes.' },
  cargo: { name: 'Pantalón cargo', cat: 'ropa', slot: 'pantalones', slotsBonus: 2, color: '#5a5230', desc: 'Bolsillos everywhere. +2 espacios.' },
  shorts: { name: 'Shorts deportivos', cat: 'ropa', slot: 'pantalones', color: '#7a7a8a', desc: 'Aerodinámico. Nada útil.' },
};

// Slots de ropa (orden de render del equipo)
export const EQUIP_SLOTS = ['cabeza', 'accesorios', 'torso', 'pantalones'];
export const EQUIP_LABELS = {
  cabeza: 'CABEZA', accesorios: 'ACCESORIOS', torso: 'TORSO',
  pantalones: 'PANTALONES', arma: 'ARMA',
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
export const LOOT = {
  nevera: [['agua', 24], ['refresco', 14], ['manzana', 12], ['lata_frijoles', 9], ['lata_atun', 7], ['venda', 4]],
  alacena: [['lata_frijoles', 20], ['lata_atun', 16], ['papas', 16], ['chocolate', 12], ['refresco', 8], ['agua', 6]],
  armario: [['playera', 12], ['jeans', 12], ['chaqueta', 10], ['cargo', 10], ['gorra', 10], ['pasamontanas', 7], ['lentes', 6], ['shorts', 6], ['venda', 5], ['mascara_gas', 3]],
  casillero: [['tubo', 10], ['bate', 7], ['hacha', 3], ['chaleco', 5], ['casco_obra', 7], ['casco_tactico', 3], ['venda', 8], ['botiquin', 4], ['antibioticos', 3], ['papas', 6], ['refresco', 6], ['agua', 6], ['chocolate', 5], ['mascara_gas', 2]],
  botiquin_pared: [['venda', 30], ['botiquin', 12], ['antibioticos', 9], ['agua', 6]],
};

// Probabilidad de que la comida generada esté podrida, por contenedor
export const ROTTEN_CHANCE = { nevera: 0.38, alacena: 0.15, casillero: 0.2, armario: 0, botiquin_pared: 0 };

// ---------- Inventario ----------
export const BASE_SLOTS = 10;
