# Fase 6 — Interfaz fina, teclado en puertas y asientos, y zoom

**Fecha:** 27 de septiembre de 2026 · **Rama:** `feat/avatar-v2`

Lo que pidió José tras la fase 5:

1. La interfaz se sentía gigante, con líneas muy gruesas y con aire de
   Minecraft. Quería minimalismo sin perder carácter ni colores, siempre en
   pixel art y con un estilo propio.
2. Con el teclado, el avatar no cruzaba puertas ni se sentaba: sólo con clic.
3. No había forma de hacer zoom para mirar algo de cerca.

## 1. Una interfaz fina y propia

**La causa de lo "gigante".** Todo se dibujaba al doble: la letra era una
fuente de 8 px usada a 16 (cada trazo, 2 píxeles del lienzo), y las piezas de
9 porciones iban a escala 2 con biseles de dos tonos. Sobre un lienzo de
960×540 que el navegador aún amplía para llenar la ventana, cada línea salía
de 4 píxeles de pantalla. Los biseles grises y la letra gorda con sombra
dura eran justo la receta de Minecraft.

**La fuente, rehecha.** `tools/fuente/glifos.mjs` tiene ahora una letra de
trazo de 1 px pensada para verse a tamaño real: em de 12, mayúsculas de 9,
minúsculas de 6, rabos de 3 y tildes con su fila de aire. A 12 px cada píxel
de la letra cae en un píxel del lienzo. También se añadieron `× − ◆` y se
quitó la barra del cero (en la interfaz, "500" parecía "5ØØ").

**Las piezas, rehechas** (`src/ui/kit.ts`). Un solo marco de 12×12 con
esquina redondeada, borde de 1 px, un brillo de 1 px bajo el borde de arriba
(sombra, en los campos, para que se lean hundidos) y relleno de cristal
oscuro. El panel principal lleva una línea violeta en el borde de arriba: es
lo que le da carácter sin engordar nada. Botones planos: al pasar se enciende
el borde, al pulsar se hunde 1 px.

**Iconos de línea.** Los del HUD son de trazo de 1 px con un punto de color
(chat, vestidor, perfil, zoom). Casa y moneda, que tienen que leerse sobre la
sala, siguen siendo de color con contorno. El motivo propio es un **rombo
isométrico** (la baldosa del juego en pequeño) como viñeta de los títulos.

**Todo, recolocado a las medidas nuevas:**

| Qué | Antes | Ahora |
|---|---|---|
| HUD | pastillas de 44, botones con texto de 88–124 de ancho | pastillas y botones de 24; botones de sólo icono con pista |
| Chat | 440 de ancho, líneas de 20 | 360 de ancho, líneas de 16 |
| Modal de cuenta | 400 de ancho, campos de 34 | 300 de ancho, campos de 24 |
| Menú de avatar | 240×108 | 180×92 |
| Vestidor | 580×360 | 520×300 |
| Nombres | pastilla de 13 con letra de 8 | pastilla de 16 con letra de 12 |

Para centrar texto, la caja de una línea mide 15 px (3 de aire arriba para
las tildes), así que no se centra la caja sino las mayúsculas: `yCentrada()`.

## 2. El teclado cruza puertas y se sienta

**La causa.** `AvatarState.keyboardMove` sólo dejaba pisar celdas libres, y
puertas y asientos están bloqueados en el mapa (se llega a ellos sólo como
meta de un camino). Además, quien estaba sentado no podía ni levantarse
andando: su propia celda, el sofá, estaba bloqueada.

**El arreglo**, en el módulo puro y por tanto igual en cliente y servidor:

- `World` aporta `isDoor` y `seatAt`. El teclado puede entrar en una puerta y
  en un asiento **libre** (el ocupado sigue estorbando), y moverse dentro de
  la celda en la que ya está, aunque esté bloqueada.
- Entrar en un asiento sienta, mirando hacia donde mira el asiento, igual que
  terminar un camino en él.
- **Sentado con la tecla aún pulsada, se sigue sentado** hasta soltarla o
  cambiar de dirección. Sin eso, la misma tecla que te sienta te levantaba en
  el frame siguiente y sentarse con el teclado era imposible.
- Cruzar ya no depende de haber hecho clic en la puerta: **estar en una
  puerta sin camino por delante es cruzarla**, se llegue andando, con el
  teclado o por una corrección del servidor. `pendingDoor` desaparece.
- En el servidor, quien está sentado ocupa su asiento aunque en ese paso se
  haya movido (al sentarse salta al centro): si no, otro que entrara en el
  mismo paso se sentaría encima.

## 3. Zoom para mirar

- **Niveles enteros: ×1, ×2, ×3.** A ×1,5 unos píxeles del arte saldrían
  dobles y otros sencillos.
- **Rueda** (hacia donde apunta el ratón; los touchpads acumulan hasta un
  paso), **botones + / −** abajo a la derecha y **teclas + / −**. El nivel se
  guarda en el navegador (`roomie:zoom`).
- **Arrastrar para mirar.** Con zoom, arrastrar por la sala la desplaza; el
  clic en el mundo se decide ahora al soltar, y sólo camina si no hubo
  arrastre. Al echar a andar, la cámara vuelve contigo.

**Lo difícil: que la interfaz no se amplíe.** En Phaser el zoom de una cámara
afecta a todo lo que dibuja, aunque tenga `scrollFactor(0)`: el HUD se
ampliaba y se salía de la pantalla. Ahora hay dos cámaras: la principal, con
zoom, dibuja la sala; otra sin zoom ni scroll, encima, dibuja la interfaz.
Qué va en cuál lo decide la profundidad, justo antes de dibujar
(`repartirCamaras`, en el evento `prerender`): da igual cuándo se cree un
objeto. Los filtros de cámara también mandan en el clic, así que cada botón
recibe el suyo.

**Nombres y burbujas, a tamaño fijo.** La primera versión los dejaba en la
cámara de la sala, y a ×2 volvían a verse gruesos, justo lo que se quería
evitar. Ahora van en la cámara de la interfaz (de `LAYER.WORLD_LABEL` hacia
arriba) y se colocan cada frame en coordenadas de pantalla sobre la cabeza de
su avatar (`sobreCabeza()`). El menú de avatar, igual.

## Verificación

- `npm run typecheck`, `npm run build`: limpios.
- `node tools/smoke-multiplayer.mjs`: **44 comprobaciones**, cinco nuevas:
  el teclado entra en un asiento y se sienta mirando hacia donde mira; sigue
  sentado con la tecla pulsada; otra tecla lo levanta y lo saca; el teclado
  entra en la puerta. La prueba de "el mueble frena" ahora busca un mueble de
  verdad (ni asiento, ni puerta, ni el anillo de muros).
- `npm --prefix server run db:check`: correcta.
- Navegador: login, registro, vestidor, HUD y pistas, chat abierto con
  historial, burbujas y nombres con otro jugador conectado, menú de avatar,
  zoom ×1/×2 con la interfaz intacta, arrastre sin caminar y persistencia del
  nivel al recargar.
