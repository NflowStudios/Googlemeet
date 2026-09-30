# ZONA CERO — Prototipo de supervivencia zombi 2D

> **Sobrevive. Cada ruido cuenta.** · v0.11

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
| `E` | Interactuar: puertas, contenedores, recoger objetos, **subir/bajar escaleras** |
| `TAB / I` | Inventario y equipo (pausa el mundo) |
| `1 · 2 · 3` | **Barra rápida**: arma de fuego / arma melee / objeto |
| `P` | Pausa · `M` audio on/off |

## Mecánicas del prototipo

- **Ciclo día/noche**: un ciclo completo (día + noche) dura **12 minutos reales = 24 h de juego** (1 hora del reloj = 30 s) y la partida amanece a las **08:00** del día 1. El HUD luce un **reloj digital de 12 horas** (HH:MM AM/PM) en la esquina superior derecha, con el día de supervivencia debajo. De día la niebla de guerra es algo más clara y el mundo se ve limpio; al **anochecer (20:00)** el mundo se tiñe de azul oscuro, la niebla se vuelve opresiva y aparece un aviso. Al **amanecer (06:00)** vuelve la luz con un golpe cálido anaranjado. La hora solo avanza jugando: pausa, inventario y menú la congelan.
- **Respawn nocturno**: cada hora de la noche (21:00–05:00) el mapa **repone un grupo de zombis** en tiles exteriores caminables **siempre fuera de tu línea de visión** (a 500+ px, fuera del cono y sin línea de vista directa — nunca los verás aparecer). El total nunca supera el tope de 110: limpiar el barrio deja margen para que la noche traiga nuevos muertos.
- **Contadores vitales**: Vida, Energía (stamina), Hambre y Sed. Las necesidades críticas drenan vida y entorpecen la recuperación de energía. No hay regeneración natural: solo vendas y botiquines.
- **Daño e infección**: los zombis reducen tu vida directamente. Las **mordidas** pueden transmitir la infección (barra verde), que progresa sin pausa hasta la muerte. Los antibióticos la curan solo si está incipiente.
- **Comida y descomposición**: come y bebe para recuperar hambre/sed. La comida **podrida** (etiqueta en el inventario) daña, intoxica y alimenta muy poco.
- **Casas con 2º piso o sótano**: algunas casas generan una planta extra (nunca ambas) con una **escalera interior** que conecta con la planta baja — misma posición de mundo en ambas plantas. Mecánica visual gemela a la de los techos: **en planta baja no se ve la otra planta**; mientras subes/bajas las escaleras la planta destino **va apareciendo con un fundido progresivo** (cada peldaño más nítida); al llegar, la capa de tu planta es opaca y tapa lo que hay debajo. El 2º piso es madera clara con alfombra, armarios y ventanas (con buhardillas asomando en el tejado: pista visual desde la calle); el sótano es hormigón agrietado sin ventanas, con casilleros de mejor botín. Colisión, visión y combate **despachan por planta**: los zombis viven en la planta baja — no te ven ni te muerden a través del suelo, y tus balas desde el 2º piso vuelan sobre la calle. Tampoco puedes registrar un armario del piso de arriba desde abajo, ni coger objetos del suelo a través del techo.
- **Visión en tiempo real**: solo ves un **cono frontal amplio** (~109°, con raycast: las paredes bloquean, las ventanas dejan ver) más un radio de percepción mínimo junto al cuerpo. **Sin memoria del terreno**: lo que queda a tus espaldas o fuera del cono se hunde en una **oscuridad del 85%** — intuyes el terreno pero no lo ves. **Paredes delgadas** (muros, ventanas y puertas son una franja fina sobre la línea de muro; el suelo a ambos lados es transitable): los muros, ventanas, puertas, **árboles y coches** con línea de visión se dibujan **nítidos sobre la niebla**, pero el **interior de las casas solo se ve por ventanas y puertas abiertas**. **Árboles y coches no tapan tu visión** (cámara aérea), aunque sí la de los zombis: úsalos como cobertura para esconderte. Los zombis fuera de tu visión son invisibles y no puedes golpear a través de los muros — ni ellos a ti (el cristal de las ventanas deja pasar los golpes en ambos sentidos).
- **Techos**: los edificios están cubiertos y el techo **bloquea la visión del interior** desde fuera. Al acercarte **se atenuan** y dejan ver el interior **por las ventanas**; al **entrar** desaparecen por completo y al **salir vuelven**. La sangre y los cadáveres quedan **anclados al mundo** (no a la pantalla): donde cayó la mancha, se queda.
- **Propagación de sonido**: correr, atacar, abrir puertas y registrar muebles emite ruido que **atrae a los zombis cercanos**. Camina agachado para reducir tu firma sonora (medidor RUIDO en el HUD).
- **Inventario por espacios** (sin peso): mochila con slots limitados, contenedores saqueables (neveras, alacenas, armarios, casilleros, botiquines) y objetos apilables.
- **Armas de fuego**: tres modelos con su munición y sus cargadores — la **Víbora VP-9** (pistola 9mm, cargador de 15), la **Guardián 12** (escopeta de corredera, tubo de 6 cartuchos, sin cargador) y el **Cóndor AR-56** (rifle de asalto 5.56 automático, cargador de 30; mantén pulsado el clic). Cada disparo es un rayo instantáneo con dispersión (las postas de la escopeta abren abanico; el fuego sostenido abre el grupo) que **no atraviesa muros** (el cristal de las ventanas sí). Fogonazo, trazadora e impacto en pared. **El ruido del disparo se oye a cientos de metros**: media ciudad vendrá a mirar. El **AR-56 reina en la comisaría**: sus armerías son la fuente más prolífica de rifles, cargadores y balas 5.56 del mapa.
- **Munición y cargadores automáticos**: las balas que recoges **rellenan solas** tus cargadores compatibles (el sobrante queda apilado en la mochila). `R` intercambia por el cargador más lleno o carga cartuchos al tubo de la escopeta; mientras recargas no puedes disparar. Las armas encontradas **siempre traen algo dentro** (cargador con balas o tubo cargado). El HUD muestra cargador actual + reserva.
- **Ropa con categorías** estéticas y funcionales — ahora con **DOS ranuras de accesorio**: cualquier accesorio (máscara de gas, pasamontañas, lentes…) vale en cualquiera de las dos. **Fundas de pistola** (cadera / hombro / táctica de pierna): aceleran el desenfunde y la recarga de la pistola y se ven en tu cadera. **Cabeza** (cascos → reducción de daño), **Torso** (chaleco táctico → blindaje +4 espacios), **Pantalones** (cargo → +2 espacios). Las piezas cambian el aspecto del personaje.
- **Barra rápida (1·2·3)**: tres ranuras — **arma a distancia**, **arma melee** y **un objeto cualquiera** — que se asignan **desde el inventario** («A la barra»). Pulsa la tecla para empuñar esa arma (o guardarla si ya la llevas) o para **consumir al instante** el objeto de la ranura 3 (venda, botiquín, agua…). Las ranuras muestran las balas listas y se vacían solas si te deshaces del objeto.
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
├── world/              — mapa procedural + visión (cono/niebla) + pintura vial + techos
├── entities/           — jugador y zombi (IA, ataque con línea de visión)
├── systems/            — supervivencia, ruido, inventario, combate, barra rápida
└── ui/                 — HUD, inventario, menús, toasts
```

## Historial de versiones

- **v0.11** — **Ciclo día/noche + respawn nocturno + AR-56 manda en la comisaría**: día y noche completos en **12 minutos** (1 h = 30 s), amanecer inicial a las 08:00, **reloj digital de 12 h (HH:MM AM/PM)** en la esquina superior derecha con el día de supervivencia. La noche (20:00–06:00) trae **niebla más opresiva, velo azul y transiciones cálidas** al alba/ocaso; **cada hora nocturna repone 5 zombis** (tope 110) en puntos exteriores **fuera de la línea de visión del jugador** (500+ px, sin LOS directa). Las **armerías de la comisaría** concentran ahora el botín más rico en **rifles Cóndor AR-56, cargadores y balas 5.56** (el arma más común del edificio, por delante de pistolas y escopetas); los casilleros de la comisaría también suben la familia 5.56.
- **v0.10** — **Mapa ampliado + comisaría y tienda**: el mundo crece a 130×104 tiles (~69% más superficie) con 5×4 manzanas y 4 calles en cada eje. Dos estructuras ÚNICAS por partida, cada una con su tejado plano inconfundible: la **COMISARÍA** (losa azul con placa-estrella, bandas de peligro y antena) guarda la mejor armería del mapa — armerías W con pistolas, escopetas, rifles, munición y equipo táctico — pero concentra el mayor peligro zombi (10 extra dentro/alrededor); la **TIENDA** (grava con marquesina roja, diana comercial y lucernarios) tiene pasillos de estanterías rebosantes de comida y bebida con presión zombi media (5 extra). Suelos propios: linóleo azul en la comisaría, baldosa ajedrez en la tienda. Doble puerta principal en ambas.
- **v0.9** — **Casas con 2º piso o sótano**: plantas extra con escalera interior y mecánica visual gemela a la de los techos — en planta baja la otra planta es invisible, mientras subes/bajas se revela con un fundido y al llegar es opaca. Contenedores y reparto interior propios por planta; despacho de colisión/visión/combate por planta (los zombis no cruzan techos); filtros de interacción por planta.
- **v0.8** — **Techos y barra rápida**: los edificios tienen techo que bloquea la visión del interior (se atenúa al acercarse y deja ver por las ventanas, desaparece al entrar y vuelve al salir). Oscuridad fuera del cono de visión al **85%** (antes 99%). **FIX sangre**: los decals estaban mal anclados a la pantalla — la mancha roja que "seguía" al jugador desaparece; ahora la sangre queda donde cayó. **Barra rápida de 3 ranuras** (arma de fuego / melee / objeto) asignable desde el inventario con las teclas 1·2·3.
- **v0.7** — **Armas a distancia**: Víbora VP-9 (pistola 9mm), Guardián 12 (escopeta de corredera) y Cóndor AR-56 (rifle de asalto automático), con munición apilable, cargadores con estado propio y auto-relleno al recoger balas. Recarga con `R`. Segunda ranura de accesorio + fundas de pistola (3 variantes) que aceleran desenfunde y recarga. Trazadoras, fogonazos, impactos en pared y disparos que atraen a los zombis desde cientos de metros.
- **v0.6** — Hitbox de ataque de zombis con línea de visión (no golpean a través de muros; el cristal de las ventanas sí deja pasar el golpe, como tu melee). Pintura vial precalculada y anclada al mundo: se acabó el "deslizamiento" de las líneas de la calle. Línea central discontinua ahora en el centro real de la calzada, líneas de borde, pasos de cebra en los 4 accesos de cada cruce, aceras de losas con juntas y bordillo, asfalto con grano/remiendos/grietas y tapas de alcantarilla.
- **v0.5** — Paredes, puertas y ventanas DELGADAS (franja de 10px sobre la línea de muro). Melee del jugador no atraviesa muros.
- **v0.4** — Árboles y coches no tapan la visión del jugador y se redibujan nítidos; sí tapan la vista de los zombis (cobertura).
- **v0.3** — Campo de visión más grande; muros visibles con claridad sobre la niebla.
- **v0.2** — Visión estrictamente en tiempo real (sin memoria del terreno).
- **v0.1** — Prototipo inicial: 5 sistemas (supervivencia, ruido, inventario, ropa, IA).

## Roadmap (siguientes iteraciones)

- [ ] Clima (lluvia que tapa el sonido de tus pasos)
- [ ] Descomposición dinámica de comida con el tiempo
- [ ] Registro de cadáveres zombi (botín)
- [ ] Hordas migratorias y meta-eventos (helicóptero, disparos lejanos)
- [ ] Guardado de partida (localStorage)
- [ ] Gamepad y soporte táctil básico

---

Hecho con Vanilla JS + Canvas. Sin frameworks, sin build, sin límites.
