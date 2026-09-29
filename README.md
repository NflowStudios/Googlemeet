# ZONA CERO — Prototipo de supervivencia zombi 2D

> **Sobrevive. Cada ruido cuenta.** · v0.3

Videojuego de supervivencia zombi con **vista cenital (top-down)** inspirado en la tensión de *Project Zomboid* y *DayZ*. Programado en **JavaScript vanilla + Canvas 2D** con arquitectura modular por módulos ES, **sin dependencias ni pasos de compilación**: se juega directamente en el navegador.

## Jugar

**GitHub Pages:** https://nflowstudios.github.io/Googlemeet/

Clona el repo y ábrelo con cualquier servidor estático:

```bash
# Python
python3 -m http.server 8000

# o Node
npx serve .
```

Luego abre `http://localhost:8000`. (Los módulos ES requieren servidor; no funciona con doble clic `file://`.)

## Controles

| Tecla | Acción |
|---|---|
| `W A S D` | Moverse |
| `Ratón` | Apuntar (el cono de visión sigue tu mira) |
| `Clic izq. / F` | Atacar con el arma equipada |
| `SHIFT` (mantener) | Correr — gasta energía y **hace mucho ruido** |
| `C` | Agacharse (sigilo) — lento pero casi silencioso |
| `E` | Interactuar: puertas, contenedores, recoger objetos |
| `TAB / I` | Inventario y equipo (pausa el mundo) |
| `P` | Pausa · `M` audio on/off |

## Mecánicas del prototipo

- **Contadores vitales**: Vida, Energía (stamina), Hambre y Sed. Las necesidades críticas drenan vida y entorpecen la recuperación de energía. No hay regeneración natural: solo vendas y botiquines.
- **Daño e infección**: los zombis reducen tu vida directamente. Las **mordidas** pueden transmitir la infección (barra verde), que progresa sin pausa hasta la muerte. Los antibióticos la curan solo si está incipiente.
- **Comida y descomposición**: come y bebe para recuperar hambre/sed. La comida **podrida** (etiqueta en el inventario) daña, intoxica y alimenta muy poco.
- **Visión en tiempo real**: solo ves un **cono frontal amplio** (~109°, con raycast: las paredes bloquean, las ventanas dejan ver) más un radio de percepción mínimo junto al cuerpo. **Sin memoria del terreno**: lo que queda a tus espaldas o fuera del cono es negro absoluto — nada se "desbloquea" nunca, así que vigila tu retaguardia girándote. Los muros, ventanas y puertas con línea de visión se dibujan **nítidos sobre la niebla** (la estructura se distingue con claridad), pero el **interior de las casas solo se ve por ventanas y puertas abiertas**. Los zombis fuera de tu visión son invisibles.
- **Propagación de sonido**: correr, atacar, abrir puertas y registrar muebles emite ruido que **atrae a los zombis cercanos**. Camina agachado para reducir tu firma sonora (medidor RUIDO en el HUD).
- **Inventario por espacios** (sin peso): mochila con slots limitados, contenedores saqueables (neveras, alacenas, armarios, casilleros, botiquines) y objetos apilables.
- **Ropa con 4 categorías** estéticas y funcionales: **Cabeza** (cascos → reducción de daño), **Accesorios** (máscara de gas / pasamontañas → protección contra mordidas y sigilo), **Torso** (chaleco táctico → blindaje +4 espacios), **Pantalones** (cargo → +2 espacios). Las piezas cambian el aspecto del personaje.
- **IA de zombis** con estados: deambulan, investigan los ruidos, persiguen al verte y atacan. Huyen de tu vista… no.
- **Mundo procedural**: town con calles, manzanas, casas con puertas abribles y ventanas, muebles con botín, coches abandonados y árboles. Cada partida genera un mapa distinto.
- **Audio 100% procedural** (WebAudio, sin archivos): pasos, golpes, gemidos espaciales de zombis, latido con vida crítica y viento ambiental.

## Arquitectura

```
index.html              — estructura y pantallas (HUD, inventario, menús)
css/style.css           — estilos del HUD e interfaz
js/
├── main.js             — orquestador: bucle, estados, interacción
├── config.js           — balance, base de datos de objetos, tablas de botín
├── utils.js / rng.js   — matemáticas y RNG con semilla
├── core/               — input, cámara, audio procedural
├── world/              — mapa procedural + visión (cono/niebla)
├── entities/           — jugador y zombi (IA)
├── systems/            — supervivencia, ruido, inventario, combate
└── ui/                 — HUD, inventario, menús, toasts
```

## Roadmap (siguientes iteraciones)

- [ ] Armas a distancia y munición
- [ ] Ciclo día/noche y clima
- [ ] Descomposición dinámica de comida con el tiempo
- [ ] Registro de cadáveres zombi (botín)
- [ ] Hordas migratorias y meta-eventos (helicóptero, disparos lejanos)
- [ ] Guardado de partida (localStorage)
- [ ] Gamepad y soporte táctil básico

---

Hecho con Vanilla JS + Canvas. Sin frameworks, sin build, sin límites.
