# ZONA CERO — Prototipo de supervivencia zombi 2D

> **Sobrevive. Cada ruido cuenta.** · v0.7

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
| `Clic izq. / F` | Atacar / **disparar** el arma equipada |
| `R` | **Recargar** el arma de fuego (cargador o cartuchos) |
| `SHIFT` (mantener) | Correr — gasta energía y **hace mucho ruido** |
| `C` | Agacharse (sigilo) — lento pero casi silencioso |
| `E` | Interactuar: puertas, contenedores, recoger objetos |
| `TAB / I` | Inventario y equipo (pausa el mundo) |
| `P` | Pausa · `M` audio on/off |

## Mecánicas del prototipo

- **Contadores vitales**: Vida, Energía (stamina), Hambre y Sed. Las necesidades críticas drenan vida y entorpecen la recuperación de energía. No hay regeneración natural: solo vendas y botiquines.
- **Daño e infección**: los zombis reducen tu vida directamente. Las **mordidas** pueden transmitir la infección (barra verde), que progresa sin pausa hasta la muerte. Los antibióticos la curan solo si está incipiente.
- **Comida y descomposición**: come y bebe para recuperar hambre/sed. La comida **podrida** (etiqueta en el inventario) daña, intoxica y alimenta muy poco.
- **Visión en tiempo real**: solo ves un **cono frontal amplio** (~109°, con raycast: las paredes bloquean, las ventanas dejan ver) más un radio de percepción mínimo junto al cuerpo. **Sin memoria del terreno**: lo que queda a tus espaldas o fuera del cono es negro absoluto — nada se "desbloquea" nunca, así que vigila tu retaguardia girándote. **Paredes delgadas** (muros, ventanas y puertas son una franja fina sobre la línea de muro; el suelo a ambos lados es transitable): los muros, ventanas, puertas, **árboles y coches** con línea de visión se dibujan **nítidos sobre la niebla**, pero el **interior de las casas solo se ve por ventanas y puertas abiertas**. **Árboles y coches no tapan tu visión** (cámara aérea), aunque sí la de los zombis: úsalos como cobertura para esconderte. Los zombis fuera de tu visión son invisibles y no puedes golpear a través de los muros — ni ellos a ti (el cristal de las ventanas deja pasar los golpes en ambos sentidos).
- **Propagación de sonido**: correr, atacar, abrir puertas y registrar muebles emite ruido que **atrae a los zombis cercanos**. Camina agachado para reducir tu firma sonora (medidor RUIDO en el HUD).
- **Inventario por espacios** (sin peso): mochila con slots limitados, contenedores saqueables (neveras, alacenas, armarios, casilleros, botiquines) y objetos apilables.
- **Armas de fuego**: tres modelos con su munición y sus cargadores — la **Víbora VP-9** (pistola 9mm, cargador de 15), la **Guardián 12** (escopeta de corredera, tubo de 6 cartuchos, sin cargador) y el **Cóndor AR-56** (rifle de asalto 5.56 automático, cargador de 30; mantén pulsado el clic). Cada disparo es un rayo instantáneo con dispersión (las postas de la escopeta abren abanico; el fuego sostenido abre el grupo) que **no atraviesa muros** (el cristal de las ventanas sí). Fogonazo, trazadora e impacto en pared. **El ruido del disparo se oye a cientos de metros**: media ciudad vendrá a mirar.
- **Munición y cargadores automáticos**: las balas que recoges **rellenan solas** tus cargadores compatibles (el sobrante queda apilado en la mochila). `R` intercambia por el cargador más lleno o carga cartuchos al tubo de la escopeta; mientras recargas no puedes disparar. Las armas encontradas **siempre traen algo dentro** (cargador con balas o tubo cargado). El HUD muestra cargador actual + reserva.
- **Ropa con categorías** estéticas y funcionales — ahora con **DOS ranuras de accesorio**: cualquier accesorio (máscara de gas, pasamontañas, lentes…) vale en cualquiera de las dos. **Fundas de pistola** (cadera / hombro / táctica de pierna): aceleran el desenfunde y la recarga de la pistola y se ven en tu cadera. **Cabeza** (cascos → reducción de daño), **Torso** (chaleco táctico → blindaje +4 espacios), **Pantalones** (cargo → +2 espacios). Las piezas cambian el aspecto del personaje.
- **IA de zombis** con estados: deambulan, investigan los ruidos, persiguen al verte y atacan. Huyen de tu vista… no.
- **Mundo procedural**: town con calles, manzanas, casas con puertas abribles y ventanas, muebles con botín, coches abandonados y árboles. Cada partida genera un mapa distinto. **Pintura vial anclada al mundo** (nunca se desliza con la cámara): línea central discontinua, líneas de borde, pasos de cebra en los cruces, aceras de losas con bordillo y tapas de alcantarilla.
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
├── world/              — mapa procedural + visión (cono/niebla) + pintura vial
├── entities/           — jugador y zombi (IA, ataque con línea de visión)
├── systems/            — supervivencia, ruido, inventario, combate
└── ui/                 — HUD, inventario, menús, toasts
```

## Historial de versiones

- **v0.7** — **Armas a distancia**: Víbora VP-9 (pistola 9mm), Guardián 12 (escopeta de corredera) y Cóndor AR-56 (rifle de asalto automático), con munición apilable, cargadores con estado propio y auto-relleno al recoger balas. Recarga con `R`. Segunda ranura de accesorio + fundas de pistola (3 variantes) que aceleran desenfunde y recarga. Trazadoras, fogonazos, impactos en pared y disparos que atraen a los zombis desde cientos de metros.
- **v0.6** — Hitbox de ataque de zombis con línea de visión (no golpean a través de muros; el cristal de las ventanas sí deja pasar el golpe, como tu melee). Pintura vial precalculada y anclada al mundo: se acabó el "deslizamiento" de las líneas de la calle. Línea central discontinua ahora en el centro real de la calzada, líneas de borde, pasos de cebra en los 4 accesos de cada cruce, aceras de losas con juntas y bordillo, asfalto con grano/remiendos/grietas y tapas de alcantarilla.
- **v0.5** — Paredes, puertas y ventanas DELGADAS (franja de 10px sobre la línea de muro). Melee del jugador no atraviesa muros.
- **v0.4** — Árboles y coches no tapan la visión del jugador y se redibujan nítidos; sí tapan la vista de los zombis (cobertura).
- **v0.3** — Campo de visión más grande; muros visibles con claridad sobre la niebla.
- **v0.2** — Visión estrictamente en tiempo real (sin memoria del terreno).
- **v0.1** — Prototipo inicial: 5 sistemas (supervivencia, ruido, inventario, ropa, IA).

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
