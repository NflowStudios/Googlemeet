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
// v0.16: mapa ampliado al doble (13.520 → 27.232 m²) y v0.26: ¡AL TRIPLE!
// 300×300 tiles (9.600×9.600 px · 90.000 m²): una ciudad de verdad para
// CONDUCIR. La retícula pasa a 11×11 manzanas (calles de 4 tiles cada 30
// verticales / 28 horizontales) y la densidad zombi se re-calibra (240 de
// salida: menos zombis por metro cuadrado, pero el mapa triplicado suma) para
// que los COCHES tengan carretera de sobra y las GASOLINERAS (norte, sur y
// este) queden a un viaje de distancia de cualquier rincón.
// v0.29 — EL PUEBLO REVIVE: en el CENTRO EXACTO del mapa cruza ahora una
// AVENIDA de norte a sur (8 tiles de calzada con doble línea central),
// flanqueada por aceras con FAROLAS y árboles, y a su paso por el centro se
// abren las DOS PLAZAS gemelas (fuente de piedra al oeste, parque al este).
// El pueblo gana PROPS decorativos (bancos, hidrantes, jardineras, arbustos,
// flores, papeleras, señales) y las casas estrenan FACHADAS de colores: el
// mundo sigue muerto, pero ya no lo parece.
// v0.30 — EL DESPOJO: adiós a lo alegre (bancos, hidrantes, jardineras,
// arbustos y flores). Quedan SOLO los mínimos (farolas, señales, papeleras,
// papeles, fuente) y unos ESCOMBROS: el pueblo debe sentirse apocalíptico,
// no de postal. La geografía NO cambia (guardados v0.29 válidos).
export const MAP_W = 300;   // tiles (v0.26: antes 184)
export const MAP_H = 300;   // tiles (v0.26: antes 148)
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
// v0.18 — HOSPITAL: grande, DOS PISOS (planta baja + planta de
//  hospitalización) y en APAGÓN permanente: sin luz eléctrica, de noche no
//  se ve nada sin linterna (ver HOSPITAL más abajo). Ambos pisos INFESTADOS
//  (15 abajo + 10 arriba + 5 alrededor) y con los objetos médicos
//  EXCLUSIVOS del juego: suero, adrenalina, antibióticos potentes y morfina.
export const SPECIALS = {
  police: { w: 17, h: 13, inside: 6, around: 4 },   // armería + casilleros
  store:  { w: 14, h: 10, inside: 3, around: 2 },   // pasillos de estanterías
  military: { w: 22, h: 20, inside: 18, around: 5, basement: 4 },  // arsenal subterráneo
  hospital: { w: 20, h: 16, inside: 15, around: 5, upper: 10 },    // apagón + 2 pisos infestados
  // v0.25 — HOME & TOOLS: la FERRETERÍA tipo gran almacén. Tamaño MEDIO y
  // UN SOLO piso (sin 2º planta ni sótano): la presión zombi es PARECIDA a
  // la de la tienda (dentro/alrededor), pero el botín es otra cosa — los
  // MATERIALES de construcción y de AGRICULTURA (semillas) salen aquí a
  // porrillo, y el MAZO PESADO solo vive en sus estanterías.
  tools:  { w: 16, h: 11, inside: 3, around: 2 },
  // v0.26 — GASOLINERA "YUNQUE GAS": NO es única — hay TRES en todo el mapa
  // (norte, sur y este, cada una en su extremo). Tienda pequeña + pista de
  // surtidores con marquesina. Presión zombi LIGERA (2 dentro + 2 alrededor,
  // sin brutos: la gasolina del apocalipsis casi se guarda sola) pero el
  // BOTÍN es único en su especie: BIDONES DE GASOLINA a porrillo en los
  // surtidores y PIEZAS DE MOTOR (batería, bujías, neumáticos, radiador)
  // más comunes que en ningún otro rincón.
  gas:    { w: 12, h: 9, inside: 2, around: 2 },
};

// ---------- Linterna (v0.17) ----------
// Equipada en una ranura de ACCESORIO y encendida con L, extiende el cono de
// visión según lo MALA que sea la luz ambiental: de noche, con neblina/lluvia
// y en INTERIORES (edificios, 2º piso, sótanos). Las pilas funcionan como la
// munición de las armas: mientras el haz está encendido se consume carga y
// al quedar baja se cambia sola por una pila del inventario.
//  - una pila entera = drainSec segundos de haz ENCENDIDO (240 s ≈ casi una
//    noche completa: la noche dura 300 s reales);
//  - el bono de alcance es el MAYOR de los que apliquen (no se apilan):
//    noche ×1.35 · neblina ×1.5 · lluvia ×1.14 · interior ×1.25 ·
//    día despejado en calle ×1.06 (apenas: hay sol).
export const FLASH = {
  cap: 100,             // carga interna de la linterna (porcentaje)
  drainSec: 240,        // una pila completa = 240 s de juego con el haz ENCENDIDO
  lowAt: 15,            // por debajo de esto → cambio automático de pila
  rangeNight: 1.35,     // de noche cerrada (escala suave con la oscuridad)
  rangeFog: 1.5,        // con neblina (recupera la mitad de lo perdido)
  rangeRain: 1.14,      // bajo la lluvia (prácticamente lo recupera)
  rangeIndoor: 1.25,    // dentro de estructuras (siempre que estés dentro)
  rangeDay: 1.06,       // de día, en exterior y despejado (casi nada)
  fogAlphaCap: 0.90,    // con el haz encendido la niebla nocturna no pasa de aquí
};

// ---------- Hospital (v0.18): el APAGÓN ----------
// El hospital está a oscuras (no hay luz eléctrica): la visión DENTRO del
// edificio depende de la luz ambiental y de la linterna:
//  - DE DÍA: la luz que entra por las ventanas deja ver casi normal
//    (dayMul 0,88: 440 → 387 px).
//  - DE NOCHE SIN LINTERNA: blackout casi total (nightMul 0,42:
//    440 → 185 px — como la neblina más densa, pero dentro).
//  - DE NOCHE CON LINTERNA: el haz despeja el apagón y además rinde como
//    en cualquier interior (flashNight 1,35 → 594 px); de día apenas
//    aporta (flashDay 1,08). Estos bonos SUSTITUYEN a los de calle de
//    flashRangeMul (no se apilan: dentro manda el apagón).
//  - El velo oscuro extra sobre la pantalla llega a tintMax (0,30) de
//    noche sin haz y casi desaparece con el haz encendido.
export const HOSPITAL = {
  dayMul: 0.88,        // blackout con luz de día (ventanas)
  nightMul: 0.42,      // blackout de noche sin linterna
  flashDay: 1.08,      // de día con el haz (apenas mejora)
  flashNight: 1.35,    // de noche con el haz (despeja el apagón)
  tintMax: 0.30,       // velo oscuro extra en pantalla (noche sin haz)
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
  // v0.21: la lluvia es LIGERAMENTE más común a petición del usuario
  // (0.55 → 0.70: 7 de cada 10 frentes llegan lloviendo, el resto neblina)
  rainChance: 0.70,
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

// ---------- Profesiones (v0.24) ----------
// Se eligen al CREAR la partida (una sola vez, NO se pueden cambiar) y dan
// una BONIFICACIÓN PASIVA permanente para toda esa partida. Los valores
// viven aquí para que la enciclopedia y la pantalla de selección se generen
// solas (igual que el resto de la guía). El desempleado es la partida
// "pura": ningún bono, para quien quiera el reto sin ayudas.
//  · policia:    gunDmgMul   → +5% de daño en TODAS las armas de fuego
//  · medico:     healMul     → +5% de curación en objetos curativos
//  · ladron:     stepNoiseMul→ pasos a la mitad de ruido (radios de paso)
//  · carpintero: repairMul   → reparar construcciones cuesta la mitad
//  · granjero:   cropYieldMul+growFast → cosecha ×2 y maduran 1 día antes
//  · mecanico:   GATE de las recetas `mech` → craftea PIEZAS DE COCHE y
//                repara motores (v0.26)
//  · desempleado: sin efectos — la partida sin ayudas
export const PROFESSIONS = [
  {
    id: 'policia', name: 'Policía', color: '#6a9ac8',
    tagline: 'Orden hasta el final',
    desc: 'Ex agente del orden público. La ciudad cayó, el cuerpo se disolvió, pero las horas del campo de tiro quedaron en las manos: cada disparo suyo pica un poco más. En un mundo donde las balas escasean y cada zombi que cae a plomo son menos que te rodean, ese margen extra decide quién entierra a quién.',
    perks: ['+5% de daño con armas de fuego'],
    fx: { gunDmgMul: 1.05 },
  },
  {
    id: 'medico', name: 'Médico', color: '#d8d5cc',
    tagline: 'Juró salvar vidas',
    desc: 'Vendas, dosis y puntos de sutura: todo lo que cura, cura un poco mejor en sus manos. Lo que en otras manos es un botiquín de campaña, en las suyas rinde más — y con los exclusivos del hospital (suero, adrenalina, antibióticos potentes) el kit médico completo estira la vida un poco más lejos.',
    perks: ['+5% de curación con objetos curativos'],
    fx: { healMul: 1.05 },
  },
  {
    id: 'ladron', name: 'Ladrón', color: '#9a7ab8',
    tagline: 'Nadie lo oyó llegar',
    desc: 'Vivía de lo ajeno y de no ser oído: pisadas de gato, peso repartido, suelo leído. Los muertos que cazan por el oído apenas notan su paso — camina donde otros despiertan a la manzana entera. Ideal para saquear de noche, atravesar barrios infestados y desaparecer antes de que alguien gire la cabeza.',
    perks: ['Pasos un 50% más silenciosos'],
    fx: { stepNoiseMul: 0.5 },
  },
  {
    id: 'carpintero', name: 'Carpintero', color: '#a87848',
    tagline: 'La madera obedece',
    desc: 'Mano de obra, clavos y madera: levanta y REPARA. Su oficio abarata el mantenimiento del refugio — las barricadas destrozadas por un asedio se reponen con la mitad de tablas y clavos, y los refugios que se mantienen en pie son los que mantienen vivo a su dueño. Donde otros ven escombros, él ve material.',
    perks: ['Reparar estructuras cuesta la mitad de materiales'],
    fx: { repairMul: 0.5 },
  },
  {
    id: 'granjero',
    name: 'Granjero', color: '#7aa348',
    tagline: 'La tierra todavía da',
    desc: 'Semillas, surcos y cielo: sacaba comida del suelo cuando la ciudad todavía compraba la suya enlatada. Sus cultivos maduran un día antes, cada cosecha rinde el doble y hasta el peor invierno respeta sus plántulas. Cuando las estanterías queden peladas, su huerto seguirá dando: el apocalipsis acaba de convertirse en una temporada de siembra.',
    perks: ['Los cultivos maduran 1 día antes y la cosecha rinde EL DOBLE'],
    fx: { cropYieldMul: 2, growFast: 1 },
  },
  {
    id: 'mecanico',
    name: 'Mecánico', color: '#8a6a3a',
    tagline: 'Todo se puede arreglar',
    desc: 'Grasa bajo las uñas y un oído que diagnostica motores al arrancar. Con chatarra y cuatro dólares de nada fabrica BATERÍAS, BUJÍAS, NEUMÁTICOS y RADIADORES — las piezas que convierten un cascarón abandonado en un coche de verdad — y remienda motores humeantes sin taller de por medio. En una ciudad triplicada donde la gasolina es el oro nuevo, el hombre que resucita coches es el que nunca camina.',
    perks: ['Craftea PIEZAS DE COCHE (batería, bujías, neumático, radiador) con chatarra y materiales', 'REPARA motores dañados junto al coche con 4 de chatarra'],
    fx: {},   // el bono es el GATE de las recetas `mech` (canCraft) — no un multiplicador
  },
  {
    id: 'desempleado', name: 'Desempleado', color: '#6d6f64',
    tagline: 'Sin oficio ni ventaja',
    desc: 'Sin título, sin oficio, sin ventajas: no prometía nada y ahí sigue. La supervivencia en su forma pura, para quien quiera contarse la historia sin ninguna ayuda — nadie le regaló nada el día que amaneció el mundo muerto, y eso también es un motivo de orgullo.',
    perks: ['Ninguno — la partida pura, sin ayudas'],
    fx: {},
  },
];

/** Índice id → definición de profesión. */
export const PROF_BY_ID = {};
for (const p of PROFESSIONS) PROF_BY_ID[p.id] = p;

// ---------- AGRICULTURA (v0.25) ----------
// Los CULTIVOS son construcciones vivas: se SIEMBRA una semilla sobre
// césped o acera (botón PLANTAR del inventario → fantasma del modo
// construcción) y la planta AVANZA SOLO CON LOS DÍAS de juego — no hay que
// regarla ni tocarla: cada día que amanece cuenta un escalón
// (semilla → brote → planta → MADURA). Madura → [E] cosecha verduras
// apilables; si tardas witherDays días más, se MARCHITA (recuperas 1
// semilla). La FOGATA (construcción nueva) convierte las verduras crudas
// en ASADOS con el doble de alimento (recetas marcadas `fire`).
//  · growFast (granjero): días que se restan a `days` (mínimo 1)
//  · cropYieldMul (granjero): multiplicador de piezas por cosecha
export const CROPS = {
  tomate:    { name: 'Tomate',    seed: 'semillas_tomate',    days: 2, yield: [2, 3], color: '#c85a3a', leaf: '#5a7a3a' },
  zanahoria: { name: 'Zanahoria', seed: 'semillas_zanahoria', days: 3, yield: [2, 3], color: '#d9822a', leaf: '#4a7a2a' },
  calabaza:  { name: 'Calabaza',  seed: 'semillas_calabaza',  days: 4, yield: [1, 2], color: '#d9a520', leaf: '#6a8a3a' },
  maiz:      { name: 'Maíz',      seed: 'semillas_maiz',      days: 5, yield: [2, 4], color: '#e8d05a', leaf: '#6a9a4a' },
};

export const AGRICULTURA = {
  witherDays: 3,      // días tras madurar antes de marchitarse (recupera 1 semilla)
  cookRange: 90,      // radio de la FOGATA para cocinar (px)
};

// ---------- VEHÍCULOS (v0.26) ----------
// CUATRO MODELOS con marca y modelo ficticios, cada uno con su carácter:
//  · sedan  — Aurora Cierzo 400: ligero y razonablemente rápido EN PAVIMENTO,
//    el que menos bebe y el más silencioso. Cajuela media (6 huecos). En
//    tierra se queda (offroad 0,42): es un coche de ciudad.
//  · pickup — Yaguareté Sierra 4x4: algo más lento pero con la CAJUELA GRANDE
//    (10) y tranquilo fuera del asfalto (0,75). Bebe moderado-alto.
//  · suv    — Bóer Meridiano: pesado, bebe bastante (0,62 L/s a fondo) y
//    guarda 8 huecos. Fuera de carretera se defiende (0,8).
//  · van    — Carabela Mula 3000: ALMACÉN MÓVIL (16 huecos)… a cambio de la
//    aceleración más lenta (70), el giro más torpe (1,45 rad/s) y el motor
//    MÁS RUIDOSO del juego (430 px: los zombis lo oyen llegar de lejos).
// stats por modelo:
//  · top/accel/turn — px/s máximos, px/s² de aceleración y rad/s de giro
//  · fuelCap (L) · fuelRate (L/s a fondo, escala con la velocidad)
//  · noise — radio del ruido del motor en marcha (cada motor SUENA distinto:
//    ver audio.setEngine)
//  · storage — huecos de la CAJUELA (contenedor del coche)
//  · offroad — multiplicador de velocidad sobre césped (el asfalto es 1)
//  · crashMul — cómo de mal lo pasa el MOTOR al chocar (el pesado sufre menos)
export const VEHICULOS = {
  enterR: 62,          // radio para ENTRAR/inspeccionar (px, al centro del coche)
  fuelPerBidon: 8,    // litros que aporta un bidón de gasolina
  roadkillMin: 70,    // velocidad mínima para ATROPELLAR (px/s)
  crashMin: 140,      // a partir de aquí un choque frontal daña el motor
  startNoiseMul: 1.35,// el arranque cantará más que el ralente
  smokeAt: 35,        // vida del motor por debajo de la cual ECHA HUMO
  tireMul: [0.45, 0.62, 0.78, 0.9, 1],   // velocidad por neumáticos puestos 0-4
  partsMissing: { bat: 0.3, buj: 0.25, rad: 0.25, tires: 0.3 },  // prob. de pieza ausente al generar (la mayoría nacen cojos)
  models: {
    sedan: {
      brand: 'Aurora', name: 'Cierzo 400', type: 'Sedán',
      w: 58, h: 26, top: 310, accel: 185, turn: 2.6,
      fuelCap: 35, fuelRate: 0.32, noise: 240, storage: 6, offroad: 0.42,
      crashMul: 1, mass: 1, seats: 4, colors: ['#7a3030', '#3a4a5a', '#6a6a3a', '#42548a', '#8a8f96'],
    },
    pickup: {
      brand: 'Yaguareté', name: 'Sierra 4x4', type: 'Camioneta',
      w: 62, h: 28, top: 265, accel: 130, turn: 2.2,
      fuelCap: 50, fuelRate: 0.5, noise: 300, storage: 10, offroad: 0.75,
      crashMul: 0.8, mass: 1.3, seats: 3, colors: ['#54423a', '#3a5a44', '#8a6a3a', '#4a4a52', '#6a3a2a'],
    },
    suv: {
      brand: 'Bóer', name: 'Meridiano', type: 'SUV',
      w: 60, h: 30, top: 285, accel: 120, turn: 2.0,
      fuelCap: 55, fuelRate: 0.62, noise: 330, storage: 8, offroad: 0.8,
      crashMul: 0.7, mass: 1.5, seats: 4, colors: ['#2e3428', '#39422f', '#4a3a2a', '#26292e', '#5a4632'],
    },
    van: {
      brand: 'Carabela', name: 'Mula 3000', type: 'Furgoneta',
      w: 66, h: 32, top: 235, accel: 70, turn: 1.45,
      fuelCap: 60, fuelRate: 0.66, noise: 430, storage: 16, offroad: 0.6,
      crashMul: 0.6, mass: 1.8, seats: 4, colors: ['#c8c8c0', '#8a98a8', '#b0a078', '#8a8f96', '#6a7a6a'],
    },
  },
  // reparto de modelos entre los coches generados (pesos)
  modelWeights: { sedan: 40, pickup: 25, suv: 20, van: 15 },
  carCount: 34,        // coches abandonados por el mapa (v0.26: 20 → 34, mapa al triple)
};

// ---------- LIMPIEZA (v0.29): la segunda vida de la ESCOBA ----------
// Equipada como arma y junto a un cadáver de zombi o una mancha de sangre,
// [E] BARRÉ: borra el decal del canvas, lo quita del registro (para que no
// reaparezca al cargar una partida) y difunde el gesto en multijugador.
// Barrer es de lo más sigiloso que se puede hacer (menos ruido que caminar)
// y apenas cansa: el orden y la higiene del apocalipsis son baratos.
export const ESCOBA = {
  cleanRange: 52,     // px — a esta distancia del decal aparece el prompt
  cleanR: 36,         // radio de borrado (px de mundo) — cubre cadáver+charco
  cleanNoise: 42,     // ruido del barrido (un susurro)
  cleanStamina: 4,    // energía por barrido
  cleanCd: 0.35,      // s — pequeño cooldown tras cada barrido
};

// ---------- MULTIJUGADOR (v0.27) ----------
// Co-op P2P de 2 a 4 SOBREVIVIENTES sobre PeerJS (señalización por el
// servidor público de PeerJS; el juego viaja DIRECTO entre navegadores
// por WebRTC — sin servidor de juego).
//
// ARQUITECTURA «ANFITRIÓN AUTORITATIVO + PREDICCIÓN LOCAL»:
//  · El ANFITRIÓN (quien crea la sala) simula el mundo: IA de zombis,
//    respawn nocturno, gritadores, clima, hora, ruido y resolución de
//    botín de contenedores. Los demás reciben su palabra como ley.
//  · Cada cliente mueve a SU superviviente EN LOCAL (colisiones con el
//    mapa incluidas: el mundo es determinista por semilla y todos tienen
//    la misma ciudad) → CERO RETARDO en tu propio movimiento y disparos.
//    La posición viaja al anfitrión, que la re-transmite al resto.
//  · Los demás jugadores y los zombis se ven INTERPOLADOS suavemente
//    hacia la última instantánea (retardo visual ~100 ms, invisible
//    contra muertos vivos que caminan).
//  · El mundo se reconstruye SOLO con la SEMILLA (map.js no usa
//    Math.random): el paquete de inicio solo lleva semilla, reloj, clima,
//    horda inicial y jugadores — kilobytes, no megas.
//
// CANALES: cada pareja anfitrión↔cliente abre DOS conexiones: `ctl`
// (FIABLE — eventos que no pueden perderse: arranque de partida, botín,
// muertes, construcciones, coches) y `snap` (NO fiable, sin orden —
// instantáneas de posición: si se pierde una, la siguiente manda; así no
// se acumula retardo por reenvíos).
export const NET = {
  maxPlayers: 4,          // anfitrión + 3 invitados
  codeLen: 5,             // caracteres del código de sala
  codeChars: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',   // sin I/L/O/0/1 (confusos)
  peerPrefix: 'zc30-',    // id de PeerJS: «zc30-CODIGO» (versionado por higiene; v0.30: solo cambian decoraciones — el mundo es compatible, pero las salas se versionan para no mezclar clientes)
  snapHz: 15,             // instantáneas por segundo (anfitrión → clientes)
  stateHz: 15,            // estado del propio jugador (cliente → anfitrión)
  lerpK: 14,              // suavidad de interpolación (1-e^(-k·dt))
  zombieSyncR: 1300,      // solo se sincronizan zombis a este radio de CUALQUIER jugador
  joinTimeout: 12,        // s para encontrar la sala antes de rendirse
  pingEvery: 2,           // s entre medidas de latencia (ping/pong por ctl)
  colors: ['#e5484d', '#e0b34d', '#4db8e0', '#b48ce0'],   // camiseta por jugador
  mpSaveNote: 'Las SALAS no se guarda: viven mientras el ANFITRIÓN siga conectado. Para progreso que permanece, crea un SERVIDOR.',

  // ---- v0.28: REVIVIR ----
  reviveWindow: 30,        // s de ventana para reanimar a un compañero caído
  reviveR: 52,             // px de radio para reanimar al caído
  reviveHp: 50,            // % de vida con el que despierta el reanimado
  reviveNeedVendas: 2,     // coste A: 2 vendas
  reviveNeedBotiquin: 1,   // coste B: 1 botiquín

  // ---- v0.28: CHAT de sala ----
  chatMaxLen: 90,          // caracteres por mensaje
  chatHistory: 40,         // líneas conservadas en el registro

  // ---- v0.28: SERVIDORES persistentes ----
  srvCodeLen: 6,           // caracteres del código de servidor (distinto de sala)
  srvPassLen: 4,           // dígitos de la contraseña del servidor
  srvPeerPrefix: 'zc30s-', // id de PeerJS del mundo: «zc30s-CODIGO» (v0.30: los mundos v0.29 siguen siendo válidos — tiles idénticos — pero el prefijo se versiona)
  srvSaveEvery: 60,        // s entre sincronizaciones del mundo (anfitrión → miembros)
  srvStateEvery: 20,       // s entre estados de jugador (miembro → anfitrión)
  srvSaveNote: 'El mundo se guarda en el navegador de CADA MIEMBRO: quien lo abra continúa desde la última sincronización.',
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
// v0.15, y aún más lentos desde v0.17) y BRUTOS (escasos: comisaría/tienda +
// algún errante ocasional; lentos, durísimos y brutales).
// Los valores de la cabecera son el zombi NORMAL; las variantes los
// sobreescriben en ZOMBIE_CFG.variants.
export const ZOMBIE_CFG = {
  count: 240,            // v0.26: mapa al triple → 240 de salida (densidad ~60% de la v0.25: hay que dejarte la carretera libre para conducir)
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
  nightBatch: 14,      // v0.26: 10 → 14 (más mapa que reponer por hora de noche)
  nightCap: 350,       // v0.26: 240 → 350 (la horda inicial del mapa triplicado
                       // ronda 329-332 con los errantes: el tope deja aire para
                       // que las noches REPONGAN de verdad — con 330 se bloqueaba)
  // --- v0.14: variantes ---
  runnerChance: 0.15,        // proporción de corredores en la horda callejera
  nightRunnerChance: 0.25,   // de noche los corredores presionan más
  bruteSpecials: { police: 2, store: 1, military: 4, hospital: 2, tools: 1, gas: 0 },  // brutos de guarnición por estructura (las gasolineras NO guardan brutos)
  bruteRoamChance: 0.55,     // probabilidad de que el mapa tenga brutos errantes
  // --- v0.23: GRITADOR — 4ª variante RARA, ligada a la presión local ---
  // No forma parte de la horda inicial: EMERGE cuando el jugador está en
  // una zona con mucha población zombi alrededor (aglomeraciones, asedios a
  // la barricada, noches de respawn). Su chillido convoca a todo lo que lo
  // oiga: mátalo durante el aviso (queda paralizado preparando el grito).
  screamerPopNear: 16,       // zombis necesarios a la redonda para que EMERJA
  screamerPopR: 640,         // radio de ese recuento (px, alrededor del jugador)
  screamerMax: 2,            // gritadores vivos a la vez (raro, no plaga)
  screamerCheckEvery: 8,     // segundos entre comprobaciones de población
  screamerChance: 0.5,       // probabilidad por comprobación (con población alta)
  variants: {
    // CORREDOR: carne fresca. Mitad de vida y rápido. v0.15 lo bajó de 160 a
    // 148 px/s; v0.17 lo deja en 128 (techo 134.4): caminando te alcanza
    // (cierra 16 px/s), pero esprintando le ganas por 60+ px/s y, sobre
    // todo, entre mordisco y mordisco queda hueco de sobra para contragolpear
    // con cualquier melee y retirarte. Su golpe NO se ha tocado (1.05 s).
    runner: {
      hp: 50,
      radius: 9,
      wanderSpeed: 40,
      investigateSpeed: 92,
      chaseSpeed: 128,             // v0.17: ~0.66 × esprint — ventana de contragolpe real
      speedMulRange: [0.95, 1.05], // techo 134.4 < 195: esprintando SIEMPRE le ganas
      attackCd: 1.05,              // v0.15: ventana de contragolpe (INTACTA en v0.17)
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
    // v0.23 — GRITADOR: alarma ambulante. Frágil y de ataque débil, pero al
    // VERTE se para en seco, hincha el pecho (aviso de ~1,1 s: TU ventana
    // para matarlo) y suelta un CHILLIDO que atrae a todos los zombis en
    // screamR px hacia su posición. Repite cada screamCd s mientras te siga
    // viendo. Raro: solo emerge donde hay mucha gente muerta junta.
    screamer: {
      hp: 80,
      radius: 10,
      wanderSpeed: 26,
      investigateSpeed: 62,
      chaseSpeed: 96,              // caminando le ganas; corriendo, de sobra
      speedMulRange: [0.9, 1.1],
      attackCd: 1.1,
      attackRange: 26,
      dmgMin: 6,
      dmgMax: 10,
      loseSightTime: 3.0,
      kbMult: 1.1,
      groanPitch: 1.9,             // casi un silbido agudo
      screamR: 900,                // radio del chillido (px): varias manzanas
      screamCd: 9,                 // segundos entre chillidos
      screamWindup: 1.1,           // aviso parado antes de chillar (ventana)
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
  // v0.29 — LA ESCOBA: arma melee de DOBLE UTILIDAD. Floja como arma (menos
  // pegada que un tubo) pero BARATÍSIMA de agitar (la que menos energía
  // cuesta, con más alcance que los puños) y con su segunda vida: equipada,
  // con [E] junto a CADÁVERES de zombi y MANCHAS DE SANGRE los LIMPIA
  // (desaparecen del suelo y del guardado; el barrido casi no hace ruido).
  escoba: {
    name: 'Escoba', cat: 'arma', broom: true,
    dmg: 11, range: 44, stamina: 7, cd: 0.42, noise: 85, kb: 12,
    color: '#b8935a',
    desc: 'Palo y cerdas. Poca pegada, pero cuesta tan poco agitarla… y equipada, con [E] LIMPIA cadáveres y manchas de sangre.',
  },
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
  // ---- v0.17: linterna (accesorio) y pilas ----
  // La linterna se EQUIPA en una ranura de accesorio (o se asigna a las
  // ranuras 4/5 de la barra rápida) y se enciende/apaga con L. Las pilas
  // (cat 'bateria', apilables) son su "munición": se gastan solas cuando el
  // haz está encendido y la carga queda baja.
  linterna: {
    name: 'Linterna Faro 300', cat: 'ropa', slot: 'accesorios', flashlight: true,
    color: '#c8a03a',
    desc: 'Linterna de aluminio de 300 lúmenes. Enciéndela con L: de noche, con neblina o lluvia y en interiores verás mucho más lejos. Gasta pilas mientras esté encendida (una pila ≈ 4 minutos de haz).',
  },
  bateria: {
    name: 'Pilas alcalinas', cat: 'bateria', color: '#3a76b8', stack: 12,
    lootMin: 1, lootMax: 3,
    desc: 'Pilas AA de larga duración. Alimentan la linterna automáticamente cuando su carga queda baja — no hace falta hacer nada.',
  },
  // ---- v0.18: objetos EXCLUSIVOS del HOSPITAL (solo armarios de medicina y
  // carritos de curas del hospital, jamás en tablas civiles ni militares) ----
  suero_medico: {
    name: 'Suero médico', cat: 'medico', thirstFull: true, color: '#7ac8d9', stack: 3,
    desc: 'Bolsa de suero fisiológico de 500 ml con torundas. Restaura la SED al 100% de un trago.',
  },
  adrenalina: {
    name: 'Inyección de adrenalina', cat: 'medico', adrenalinSec: 25, color: '#d9a03a', stack: 2,
    desc: 'Jeringa precargada de epinefrina. Energía INFINITA durante 25 segundos: corre sin agotarte.',
  },
  antibioticos_potentes: {
    name: 'Antibióticos potentes', cat: 'medico', heal: 20, cureBelow: 35, color: '#e8f0d8', stack: 2,
    desc: 'Ciclo hospitalario de espectro amplio. Regenera un 20% de vida y CURA la infección si aún está por debajo del 35%.',
  },
  morfina: {
    name: 'Morfina', cat: 'medico', morphineSec: 45, color: '#b8a0d9', stack: 2,
    desc: 'Ampolla de clorhidrato de morfina. Recibes un 50% MENOS de daño durante 45 segundos.',
  },
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
  // ---- v0.20: MATERIALES DE CRAFTEO (cat 'material', apilables) ----
  // La chatarra, la cuerda y el resto de la ferretería del apocalipsis: sin
  // uso directo, son los ladrillos de TODAS las recetas de la pestaña Crafteo.
  clavos: { name: 'Clavos', cat: 'material', color: '#b8b8c0', stack: 40, lootMin: 4, lootMax: 12, desc: 'Clavos de acero variados. El pegamento de todas las construcciones serias.' },
  tablas: { name: 'Tablas de madera', cat: 'material', color: '#a87848', stack: 20, lootMin: 1, lootMax: 4, desc: 'Tablones rescatados de palés y derribos. Barricadas, vallas, camas…' },
  tela: { name: 'Retazos de tela', cat: 'material', color: '#c8b8a0', stack: 30, lootMin: 2, lootMax: 6, desc: 'Jirones limpios de sábanas y cortinas. Vendas, mechas y colchones.' },
  botella_vacia: { name: 'Botella vacía', cat: 'material', color: '#7ab8a0', stack: 10, lootMin: 1, lootMax: 3, desc: 'Botella de vidrio con la etiqueta lavada. Esperando un destino incendiario.' },
  queroseno: { name: 'Lata de queroseno', cat: 'material', color: '#c8a03a', stack: 10, lootMin: 1, lootMax: 2, desc: 'Combustible de lámpara y estufa. Arde como la venganza.' },
  alcohol_etilico: { name: 'Alcohol etílico', cat: 'material', color: '#d8e8e0', stack: 15, lootMin: 1, lootMax: 4, desc: 'Alcohol de botiquín al 96%. Desinfecta heridas… o enciende antorchas.' },
  cinta_adhesiva: { name: 'Cinta adhesiva', cat: 'material', color: '#8a8a92', stack: 25, lootMin: 1, lootMax: 5, desc: 'Cinta plateada de aparatoso. Sujeta el fin del mundo con la esperanza.' },
  cuerda: { name: 'Cuerda de nailon', cat: 'material', color: '#b0a078', stack: 10, lootMin: 1, lootMax: 2, desc: 'Cuerda trenzada de 5 m. Atar, tirar y colgar.' },
  chatarra: { name: 'Chatarra metálica', cat: 'material', color: '#9aa0a6', stack: 20, lootMin: 1, lootMax: 4, desc: 'Recortes y tornillos oxidados. Punta de lanza y dientes de trampa.' },
  // ---- v0.20: objetos CRAFTEABLES ----
  molotov: {
    name: 'Cóctel molotov', cat: 'arma', throwable: true, stack: 3,
    color: '#b8c832',
    desc: 'Botella incendiaria: al estallar deja una zona de FUEGO de 10 segundos que achicharra a los zombis dentro (y a ti, si te quedas). Equípala y ataca para lanzarla hacia donde apuntas.',
  },
  bate_con_clavos: {
    name: 'Bate con clavos', cat: 'arma',
    dmg: 46, range: 52, stamina: 17, cd: 0.62, noise: 140, kb: 38,
    color: '#8a6a4a',
    desc: 'Un bate de béisbol al que alguien quiso mal. Daño 46 (antes 34) y empuje brutal. La artillería artesanal de barricada en barricada. [Requiere mesa de trabajo]',
  },
  lanza_chatarra: {
    name: 'Lanza de chatarra', cat: 'arma',
    dmg: 26, range: 66, stamina: 12, cd: 0.65, noise: 120, kb: 16,
    color: '#7a8a92',
    desc: 'Tubo de acero con punta de chatarra afilada. Daño 26 pero ALCANCE 66: pincha antes de que te toquen. [Requiere mesa de trabajo]',
  },
  antorcha: {
    name: 'Antorcha', cat: 'arma',
    dmg: 16, range: 44, stamina: 10, cd: 0.55, noise: 110, kb: 10,
    ignite: 3.5, color: '#d98a3a',
    desc: 'Tabla envuelta en tela empapada de queroseno. Golpe débil (16) pero PRENDE a los zombis: arden 3,5 s achicharrándose.',
  },
  // ---- v0.16: ración militar (EXCLUSIVA de la Base Militar) ----
  racion_combate: { name: 'Ración de combate', cat: 'comida', hunger: 55, stamina: 20, color: '#4a5238', stack: 4, desc: 'Ración militar de campaña calórica y estable. +55 hambre, +20 energía. La mejor comida del juego.' },
  // ---- v0.25: AGRICULTURA — SEMILLAS (cat 'semilla', apilables) ----
  // Se PLANTAN desde el inventario (botón PLANTAR): sobre césped o acera
  // nace un CULTIVO que avanza solo con los DÍAS de juego. Abundantes en
  // el expositor de jardinería de HOME & TOOLS; la tienda y las alacenas
  // guardan alguna que otra bolsa.
  semillas_tomate: { name: 'Semillas de tomate', cat: 'semilla', color: '#c85a3a', stack: 12, lootMin: 2, lootMax: 5, desc: 'Bolsita de semillas de tomate. Se plantan sobre césped o acera (PLANTAR en el inventario) y en 2 días dan 2-3 tomates.' },
  semillas_zanahoria: { name: 'Semillas de zanahoria', cat: 'semilla', color: '#d9822a', stack: 12, lootMin: 2, lootMax: 5, desc: 'Semillas de zanahoria. 3 días de cultivo para 2-3 piezas: la zanahoria asada alimenta mucho más.' },
  semillas_calabaza: { name: 'Semillas de calabaza', cat: 'semilla', color: '#d9a520', stack: 8, lootMin: 1, lootMax: 3, desc: 'Semillas de calabaza. Cultivo LENTO (4 días) pero cada pieza asada es un banquete (+36 hambre).' },
  semillas_maiz: { name: 'Semillas de maíz', cat: 'semilla', color: '#e8d05a', stack: 12, lootMin: 2, lootMax: 5, desc: 'Semillas de maíz. El cultivo más largo (5 días) y el más generoso: 2-4 mazorcas del mejor asado del juego.' },
  // ---- v0.25: VERDURAS (crudas, cosecha del huerto) ----
  tomate: { name: 'Tomate', cat: 'comida', hunger: 12, thirst: 3, color: '#c85a3a', stack: 8, desc: 'Tomate recién cosechado. +12 hambre crudo… pero ASADO a la fogata sube a +20.' },
  zanahoria: { name: 'Zanahoria', cat: 'comida', hunger: 16, color: '#d9822a', stack: 8, desc: 'Zanahoria del huerto. +16 hambre cruda; asada a la fogata, +26.' },
  calabaza: { name: 'Calabaza', cat: 'comida', hunger: 22, color: '#d9a520', stack: 6, desc: 'Calabaza madura. +22 hambre cruda; asada a la fogata, +36.' },
  maiz: { name: 'Maíz', cat: 'comida', hunger: 26, color: '#e8d05a', stack: 6, desc: 'Mazorca de maíz. +26 hambre cruda; ASADA a la fogata alimenta +44, el mejor plato cultivado.' },
  // ---- v0.25: VERDURAS ASADAS (receta FOGATA: ×1 cruda) ----
  tomate_asado: { name: 'Tomate asado', cat: 'comida', hunger: 20, thirst: 4, color: '#b0402a', stack: 8, desc: 'Tomate pasado por la fogata. +20 hambre y +4 sed: el fuego concentra el azúcar.' },
  zanahoria_asada: { name: 'Zanahoria asada', cat: 'comida', hunger: 26, color: '#b86a1a', stack: 8, desc: 'Zanahoria asada al rescoldo. +26 hambre: casi el doble que cruda.' },
  calabaza_asada: { name: 'Calabaza asada', cat: 'comida', hunger: 36, color: '#b8861a', stack: 6, desc: 'Calabaza asada en la fogata. +36 hambre: comida seria de temporada.' },
  maiz_asado: { name: 'Maíz asado', cat: 'comida', hunger: 44, stamina: 6, color: '#c8b03a', stack: 6, desc: 'Mazorca asada a la brasa. +44 hambre y +6 energía: el mejor plato que puedes CULTIVAR.' },
  // ---- v0.25: HOME & TOOLS — el MAZO PESADO ----
  // Contundente, lento y AGOTADOR (la mayor demanda de energía de todo el
  // melee) con un empuje brutal. Su especialidad: DEMOLER construcciones
  // al triple de velocidad (conDmgMul). EXCLUSIVO de la ferretería.
  mazo: {
    name: 'Mazo pesado', cat: 'arma',
    dmg: 44, range: 48, stamina: 26, cd: 0.85, noise: 150, kb: 44,
    conDmgMul: 2.5, color: '#8a8f96',
    desc: 'Mazo de demolición: daño contundente 44 y el mayor EMPUJE del juego, pero cada golpe cuesta 26 de energía. A construcciones pega TRIPLE: desmonta barricadas en un momento. Exclusivo de HOME & TOOLS.',
  },
  // ---- v0.26: PIEZAS DE COCHE (cat 'pieza') — la otra cara de los
  // vehículos. Batería (no se gasta: solo ESTAR en el motor), bujías (juego),
  // neumáticos (1 por rueda, hasta 4) y radiador (sin él, el motor se
  // sobrecalienta y humea). Se INSTALAN desde el menú de inspección del
  // coche; el MECÁNICO además las CRAFTEA con chatarra (recetas mech). ----
  bateria_coche: {
    name: 'Batería de coche', cat: 'pieza', color: '#384048', stack: 2, lootMin: 1, lootMax: 1,
    desc: 'Batería de plomo de 12 V. No se gasta: solo necesita ESTAR en su hueco para que el motor arranque. Sin ella, el coche es un adorno.',
  },
  bujias: {
    name: 'Juego de bujías', cat: 'pieza', color: '#c9a24f', stack: 4, lootMin: 1, lootMax: 2,
    desc: 'Cuatro bujías de encendido con sus cables. Sin chispa no hay combustión: el motor no arranca aunque tengas batería y gasolina.',
  },
  neumatico: {
    name: 'Neumático', cat: 'pieza', color: '#23262a', stack: 4, lootMin: 1, lootMax: 2,
    desc: 'Rueda de repuesto con llanta. Cada una que montes devuelve velocidad y agarre: con 4 vas a plena marcha y sin ninguna, el coche apenas rueda (y rechina).',
  },
  radiador: {
    name: 'Radiador', cat: 'pieza', color: '#7ab8a0', stack: 2, lootMin: 1, lootMax: 1,
    desc: 'Intercambiador de refrigeración. Sin él el motor se SOBRECALIENTA al rato de conducir: la aguja sube, la vida del motor baja… y acaba echando humo.',
  },
  // ---- v0.26: COMBUSTIBLE (cat 'combustible') — la gasolina del juego.
  // Cada bidón aporta VEHICULOS.fuelPerBidon litros al REPOSTAR desde la
  // inspección. El botín concentrated en las GASOLINERAS (surtidores);
  // algún bidón suelto en casilleros y estanterías de taller. ----
  bidon_gasolina: {
    name: 'Bidón de gasolina', cat: 'combustible', color: '#c8341f', stack: 3, lootMin: 1, lootMax: 2,
    desc: 'Bidón metálico de 8 litros. La gasolina del apocalipsis: se consigue en las GASOLINERAS (norte, sur y este del mapa) y sin ella el coche es un club de campo muy caro.',
  },
};

// Slots de ropa (orden de render del equipo) — TRES ranuras de accesorio
// (v0.18): cualquier accesorio (lentes, pasamontañas, máscara, fundas,
// linterna…) puede ir en cualquiera de las tres; se rellena primero la
// primera libre.
export const EQUIP_SLOTS = ['cabeza', 'accesorios', 'accesorios2', 'accesorios3', 'torso', 'pantalones'];
export const EQUIP_LABELS = {
  cabeza: 'CABEZA', accesorios: 'ACCESORIO 1', accesorios2: 'ACCESORIO 2', accesorios3: 'ACCESORIO 3',
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
  // ---- v0.18: solo dentro del HOSPITAL (ambos pisos) ----
  armario_medico: { name: 'Armario de medicina', color: '#3a7a6a', letter: 'F', slots: 6 },
  carrito_curas: { name: 'Carrito de curas', color: '#5a8a9a', letter: 'T', slots: 5 },
  // ---- v0.25: solo dentro de HOME & TOOLS (ferretería, estructura única) ----
  estanteria_ferreteria: { name: 'Estantería de ferretería', color: '#c8742a', letter: 'H', slots: 6 },
  expositor_jardin: { name: 'Expositor de jardinería', color: '#6a9a4a', letter: 'J', slots: 5 },
  // ---- v0.26: GASOLINERAS (3 en el mapa: norte, sur y este) ----
  // El surtidor (la bomba de la pista) escupe BIDONES; la estantería de
  // taller (dentro de la tienda) guarda las PIEZAS DE MOTOR más comunes
  // del juego. La cajuela de cada coche es un contenedor aparte (V huecos
  // según el modelo) que se abre desde la INSPECCIÓN.
  surtidor: { name: 'Surtidor de gasolina', color: '#c8341f', letter: 'B', slots: 5 },
  estanteria_taller: { name: 'Estantería de taller', color: '#3a7a8a', letter: 'K', slots: 6 },
  cajuela: { name: 'Cajuela', color: '#6a5a3a', letter: 'V', slots: 6 },   // slots reales = modelo.storage
};

// Tablas de botín ponderadas [idItem, peso]
// Las armas de fuego salen de casilleros (comisaría/instalaciones) y,
// con menos suerte, de armarios de casa. Fundas en armarios y casilleros.
// v0.12: el Cóndor AR-56 SOLO sale de las armerías de la comisaría (fuera
// de su tabla jamás aparece); balas y cargadores 5.56 se encuentran
// raramente en casilleros de cualquier edificio del mapa.
export const LOOT = {
  nevera: [['agua', 24], ['refresco', 14], ['manzana', 12], ['lata_frijoles', 9], ['lata_atun', 7], ['venda', 4]],
  alacena: [['lata_frijoles', 20], ['lata_atun', 16], ['papas', 16], ['chocolate', 12], ['refresco', 8], ['agua', 6], ['botella_vacia', 7], ['alcohol_etilico', 4], ['semillas_tomate', 3], ['semillas_zanahoria', 3]],
  armario: [['playera', 12], ['jeans', 12], ['chaqueta', 10], ['cargo', 10], ['gorra', 10], ['pasamontanas', 7], ['lentes', 6], ['shorts', 6], ['venda', 5], ['mascara_gas', 3], ['funda_cadera', 4], ['funda_hombro', 2], ['bala_9mm', 3], ['linterna', 3], ['bateria', 4], ['tela', 12], ['cinta_adhesiva', 7], ['botella_vacia', 5], ['cuerda', 3], ['escoba', 9]],
  // v0.16: revólver tan común como la VP-9 (peso 4 = pistola); doble Yarará
  // más común que la corredera (3.2 > 2.2); Ñandú a la par de la Yarará.
  casillero: [['tubo', 10], ['bate', 7], ['hacha', 3], ['chaleco', 5], ['casco_obra', 7], ['casco_tactico', 3], ['venda', 8], ['botiquin', 4], ['antibioticos', 3], ['papas', 6], ['refresco', 6], ['agua', 6], ['chocolate', 5], ['mascara_gas', 2], ['pistola_vibora', 4], ['revolver_aspid', 4], ['escopeta_guardian', 2.2], ['escopeta_yarara', 3.2], ['rifle_nandu', 3.2], ['cargador_9mm', 5], ['cargador_556', 2.2], ['bala_9mm', 11], ['bala_357', 11], ['cartucho_12', 8], ['bala_556', 5], ['bala_308', 4], ['funda_cadera', 4], ['funda_hombro', 2.4], ['funda_tactica', 1.6], ['linterna', 3], ['bateria', 5], ['clavos', 14], ['tablas', 10], ['chatarra', 9], ['cinta_adhesiva', 8], ['tela', 7], ['alcohol_etilico', 4], ['botella_vacia', 5], ['cuerda', 3], ['queroseno', 2.5], ['bidon_gasolina', 2], ['bujias', 2], ['bateria_coche', 1.5], ['neumatico', 1.2], ['radiador', 1]],
  botiquin_pared: [['venda', 30], ['botiquin', 12], ['antibioticos', 9], ['agua', 6], ['alcohol_etilico', 12]],
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
    ['linterna', 2], ['bateria', 3],
    ['cinta_adhesiva', 6], ['chatarra', 7],
  ],
  // ESTANTERÍA (tienda): comida y bebida a porrillo — y linternas/pilas
  // (v0.17), que en una tienda es donde tocaría encontrarlas. v0.20: también
  // la FERRETERÍA improvisada (clavos, tablas, tela, queroseno…).
  estanteria: [
    ['lata_frijoles', 30], ['lata_atun', 26], ['agua', 22], ['refresco', 18],
    ['papas', 15], ['chocolate', 13], ['manzana', 11], ['venda', 3],
    ['linterna', 5], ['bateria', 7],
    ['clavos', 18], ['tablas', 14], ['tela', 12], ['cinta_adhesiva', 10],
    ['botella_vacia', 9], ['queroseno', 6], ['alcohol_etilico', 5], ['cuerda', 5], ['chatarra', 4],
    // v0.25: la tienda tiene su rinconcito de jardinería (semillas raras:
    // lo abundante vive en el expositor de HOME & TOOLS)
    ['semillas_tomate', 6], ['semillas_zanahoria', 5], ['semillas_maiz', 4], ['semillas_calabaza', 3],
    // v0.29: escobas de la sección de hogar
    ['escoba', 4],
  ],
  // ---- v0.16: BASE MILITAR — el mejor botín del juego, más abundante que
  // la comisaría. El Subfusil Cuervo y el equipo militar viven SOLO aquí. ----
  taquilla_mil: [
    ['uniforme_cargo', 16], ['casco_combate', 12], ['racion_combate', 12],
    ['pantalon_cargo_mil', 10], ['respirador_tactico', 8], ['funda_muslera', 8],
    ['mascara_cm4', 7], ['chaleco_balistico', 4],
    ['venda', 6], ['agua', 5], ['antibioticos', 3],
    ['linterna', 2], ['bateria', 5],
    ['cuerda', 8], ['chatarra', 7], ['cinta_adhesiva', 6],
  ],
  caja_municion: [
    ['bala_9mm', 22], ['bala_556', 20], ['cartucho_12', 16],
    ['bala_357', 14], ['bala_308', 12],
    ['cargador_9mm', 8], ['cargador_556', 8], ['cargador_cuervo', 7],
    ['bateria', 4], ['chatarra', 7], ['cuerda', 4],
  ],
  armeria_mil: [
    ['subfusil_cuervo', 12], ['cargador_cuervo', 12], ['rifle_condor', 10],
    ['cargador_556', 10], ['rifle_nandu', 8], ['escopeta_yarara', 8],
    ['revolver_aspid', 8], ['escopeta_guardian', 6], ['pistola_vibora', 6],
    ['cargador_9mm', 8], ['bala_556', 18], ['bala_9mm', 16],
    ['cartucho_12', 12], ['bala_357', 12], ['bala_308', 10],
    ['funda_muslera', 6], ['chaleco_balistico', 5], ['casco_combate', 5],
    ['botiquin', 6], ['antibioticos', 4],
    ['chatarra', 6], ['cuerda', 5],
  ],
  estanteria_mil: [
    ['racion_combate', 30], ['agua', 22], ['venda', 12],
    ['antibioticos', 8], ['botiquin', 6], ['refresco', 6],
    ['linterna', 3], ['bateria', 8],
    ['tela', 10], ['cinta_adhesiva', 8], ['queroseno', 6], ['alcohol_etilico', 5],
  ],
  // ---- v0.18: HOSPITAL — los cuatro objetos EXCLUSIVOS viven SOLO aquí
  // (armarios de medicina F y carritos de curas T, en cualquiera de los dos
  // pisos). Jamás en tablas civiles ni militares. ----
  armario_medico: [
    ['suero_medico', 16], ['antibioticos_potentes', 10], ['adrenalina', 8],
    ['morfina', 6],
    ['venda', 18], ['botiquin', 10], ['antibioticos', 8],
    ['agua', 8], ['linterna', 2], ['bateria', 4],
    ['alcohol_etilico', 14], ['tela', 7],
  ],
  carrito_curas: [
    ['venda', 24], ['suero_medico', 8], ['botiquin', 8],
    ['antibioticos', 6], ['adrenalina', 3], ['morfina', 2],
    ['agua', 10], ['refresco', 4],
    ['alcohol_etilico', 10], ['tela', 6],
  ],
  // ---- v0.25: HOME & TOOLS — la FERRETERÍA del apocalipsis. Los
  // MATERIALES DE CONSTRUCCIÓN salen aquí MÁS ABUNDANTES que en ningún
  // otro rincón (la tienda era la ferretería improvisada: esta es la de
  // verdad), y el MAZO PESADO vive en EXCLUSIVA en sus estanterías. El
  // EXPOSITOR DE JARDINERÍA guarda las SEMILLAS a porrillo: el
  // agricultor del fin del mundo hace aquí la compra de temporada. ----
  estanteria_ferreteria: [
    ['clavos', 30], ['tablas', 24], ['cuerda', 12], ['cinta_adhesiva', 16],
    ['chatarra', 14], ['queroseno', 9], ['tela', 8], ['alcohol_etilico', 4],
    ['botella_vacia', 6], ['bateria', 5], ['linterna', 3],
    ['mazo', 5], ['hacha', 3], ['casco_obra', 6],
    ['escoba', 7],
  ],
  expositor_jardin: [
    ['semillas_tomate', 24], ['semillas_zanahoria', 22], ['semillas_maiz', 18],
    ['semillas_calabaza', 14], ['cuerda', 6], ['cinta_adhesiva', 5], ['agua', 8],
  ],
  // ---- v0.26: GASOLINERAS — la economía del combustible. El SURTIDOR
  // (la bomba de la pista, con su marquesina) es la fuente REINA de
  // BIDONES; la ESTANTERÍA DE TALLER de la tienda guarda las PIEZAS DE
  // MOTOR más comunes del juego (alguna pieza suelta también cae en
  // casilleros y en la gasolinera misma). ----
  surtidor: [
    ['bidon_gasolina', 55], ['chatarra', 10], ['bujias', 8],
    ['bateria_coche', 7], ['neumatico', 6], ['radiador', 4],
    ['agua', 6], ['cinta_adhesiva', 4],
  ],
  estanteria_taller: [
    ['bidon_gasolina', 14], ['bujias', 18], ['bateria_coche', 12],
    ['neumatico', 14], ['radiador', 9], ['chatarra', 24],
    ['bateria', 8], ['cuerda', 8], ['cinta_adhesiva', 12],
    ['casco_obra', 6], ['tubo', 5], ['escoba', 3],
  ],
};

// Probabilidad de que la comida generada esté podrida, por contenedor
export const ROTTEN_CHANCE = { nevera: 0.38, alacena: 0.15, casillero: 0.2, armario: 0, botiquin_pared: 0, armeria: 0, estanteria: 0.12, taquilla_mil: 0, caja_municion: 0, armeria_mil: 0, estanteria_mil: 0.05, armario_medico: 0, carrito_curas: 0, estanteria_ferreteria: 0, expositor_jardin: 0, surtidor: 0, estanteria_taller: 0, cajuela: 0 };

// ---------- Aparición de armas encontradas ----------
// Un arma hallada SIEMPRE trae algo dentro (cargador con balas o tubo cargado):
// 50% llena del todo, 50% parcial (30%..95% de la capacidad).
export const GUN_FOUND_FULL_CHANCE = 0.5;

// ---------- Crafteo (v0.20) ----------
// Dos familias de recetas: OBJETOS (van a la mochila al craftearlos) y
// CONSTRUCCIONES (no se guardan en la mochila: al pulsar CONSTRUIR el
// jugador entra en MODO CONSTRUCCIÓN — fantasma que sigue al ratón, R rota,
// clic derecho coloca y gasta los materiales, clic izquierdo cancela).
// Las recetas marcadas `wb: true` exigen una MESA DE TRABAJO a menos de
// CRAFTEO.wbRange px (los avances "de taller", no a mano alzada).
export const CRAFTEO = {
  range: 150,        // alcance de construcción alrededor del jugador (px)
  snapR: 96,         // radio de imán puerta/ventana para barricadas y tablones
  wbRange: 140,      // radio de la mesa de trabajo (px)
  fireR: 46,         // radio de la zona de fuego del molotov
  fireDur: 10,       // segundos que arde la zona de fuego
  fireDpsZ: 22,      // daño por segundo a los zombis dentro del fuego
  fireDpsP: 9,       // daño por segundo al jugador si se queda dentro
  burnDur: 3.5,      // quemadura del antorcha al impactar (s)
  burnDps: 12,       // daño por segundo de la quemadura
  throwSpd: 380,     // velocidad de vuelo del molotov (px/s)
  throwMax: 0.95,    // vuelo máximo del molotov (s) ≈ 360 px
  trapDmg: 30,       // daño por pisada de la trampa de pinchos
  trapUses: 10,      // pisadas que aguanta la trampa
  trapEvery: 0.5,    // cadencia de daño de la trampa (s)
  sleepSafeR: 260,   // radio de "nadie cerca" para poder dormir
  sleepHeal: 10,     // vida repuesta al dormir
  conHp: {           // vida de cada construcción (a golpes de zombi/melee)
    barricada: 140, tapiar: 100, valla: 90, trampa: 40, caja: 60, cama: 80, mesa: 50,
    fogata: 40,       // v0.25: la fogata es frágil (unos pocos golpes)
    cultivo: 25,      // v0.25: un cultivo pisoteado a golpes no sobrevive
    barril: 60,       // v0.26: el barril de lluvia aguanta lo suyo
  },
  // --- v0.23: el FUEGO ES UNA ALARMA ---
  // El estallido del molotov ROMPE CRISTAL (ruido fuerte y seco) y las
  // llamas se ven desde lejos: mientras arde, cada 1,5 s emite un pulso de
  // atracción de fireAlarmR px. Prender fuego = despejar una zona… y
  // CONVERTIRTE en el centro de atención del barrio entero.
  fireBreakNoise: 300,    // ruido del cristal roto al estallar (px de radio)
  fireAlarmR: 420,        // radio del pulso «las llamas se ven de lejos»
  fireAlarmEvery: 1.5,    // cadencia del pulso de alarma (s)
};

// ---------- Inventario ----------
export const BASE_SLOTS = 10;
