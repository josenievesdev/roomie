# Fase 2.5 — Estabilización de la capa UI (Phaser)

**Fecha:** 24 de septiembre de 2026
**Rama:** `fase1-movimiento`
**Alcance:** sólo orden de renderizado. No se tocó movimiento, Socket.io,
`avatarState.ts`, el protocolo, los mapas de Tiled ni los assets. Sigue sin
haber React ni DOM.

## Síntoma reportado

> Al abrir el perfil algunos avatares aparecen encima o parcialmente visibles
> sobre la interfaz del modal.

## Qué pasaba en realidad

No era un problema de avatares ni de multijugador: **el modal se creó en una
banda de profundidad inferior a la del HUD.**

Phaser no tiene capas. Sólo hay un número de profundidad por objeto y el orden
de inserción para los empates. Sin una convención explícita, cada pantalla
eligió su número a ojo:

| Elemento | Profundidad | |
|---|---|---|
| suelo, paredes, muebles, avatares | 0 – 352 | Y isométrica |
| **modal de perfil** | **100.000** | `1e5` |
| burbujas de chat | **1.000.000** | `1e6` — **10× el modal** |
| botón Perfil | 1.000.000 | |
| barra de chat | 1.000.000 | |
| panel de personalización | 1.000.002 | |
| marcador de clic | 1.000.000 | |
| texto "Roomie — room1" | **0** | nunca recibió profundidad |

El modal estaba a `1e5` y **todo el HUD a `1e6`**, así que el HUD entero se
dibujaba por encima del modal.

Lo que se percibía como "avatares encima del modal" eran las **burbujas de
chat**: van ancladas a la cabeza del avatar, se mueven con él y contienen lo
que dice, así que se leen como parte del avatar. Al estar en `1e6` flotaban por
encima del modal. Lo mismo el botón Perfil y la barra de chat.

Y lo de "parcialmente visibles" era el velo del modal, que estaba a `alpha 0.7`:
el mundo se seguía leyendo a través de él.

### Bug adicional encontrado

El texto `"Roomie — room1 / Clic·WASD · Enter: chat · C: personalizar"` se
creaba **sin `setDepth`**, o sea en profundidad 0. El suelo de la sala llega a
~352, así que las baldosas se dibujaban *por encima* del texto en cuanto la
cámara ponía suelo detrás de esa esquina. Pasaba desapercibido porque en la
posición inicial esa esquina cae sobre el fondo vacío.

## Solución

### `src/render/layers.ts` (nuevo)

Única fuente de verdad para las profundidades. Bandas separadas y con nombre:

```
WORLD        0 … 9.999    suelo, paredes, muebles, avatares (Y isométrica)
WORLD_TOP       10.000    burbujas de chat, marcador de clic
UI_HUD         100.000    título de sala, estado, avisos, botón Perfil
UI_PANEL       200.000    barra de chat, panel de personalización
UI_MODAL       300.000    modal de entrada/perfil (+1 panel, +2 contenido, +3 texto sobre botones)
```

Más `worldDepth(screenY)`, que además **acota** la profundidad del mundo a su
banda: por grande que fuera una sala futura, no puede colarse por encima de la
interfaz. Con las salas actuales (12×12 y 14×10) el máximo es 352; incluso una
sala de 100×100 se quedaría en 3168.

### La separación World / UI

- **World Layer** — mapa, paredes, muebles, avatares (locales y remotos) y sus
  nombres. Profundidad = Y isométrica vía `worldDepth()`, que es lo que hace
  que lo que está más abajo en pantalla tape a lo que está más arriba.
- **World top** — burbujas de chat y marcador de destino. Pertenecen al mundo
  (siguen a una posición del mundo, no a la cámara) pero deben tapar paredes y
  muebles. Por eso tienen banda propia justo encima del mundo y **por debajo**
  de la interfaz.
- **UI Layer** — todo lo que va fijo a la cámara (`scrollFactor 0`): HUD,
  paneles y modal, en ese orden.

### Regla que ahora se cumple sin excepciones

> Ningún `setDepth` del proyecto lleva un número suelto. O es `worldDepth(...)`,
> o es una constante de `LAYER`.

35 profundidades migradas. Verificado automáticamente: 0 `setDepth` con número
literal, 0 fuera de la convención.

### Cambio de estética (revertible en una línea)

El velo del modal pasa de `alpha 0.7` a `0.86`. Con 0.7 el mundo se leía a
través del modal y los avatares parecían estar "encima" aunque estuvieran
detrás. Es la única decisión de gusto de esta fase; si prefieres el velo más
claro, es un número.

> **Corregido después.** 0.86 no fue suficiente: el mundo seguía viéndose al
> 14% fuera del panel y al 4% detrás de él, y un avatar que cruzara el borde
> del panel cambiaba de brillo 3,5× de golpe, leyéndose como "cortado". El velo
> está ahora en `alpha 1`. Ver `docs/fase2-6-hud-velo.md`.

## Verificación

| | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run build` | OK |
| `node tools/smoke-multiplayer.mjs` (20 checks) | OK |
| Orden de capas (19 aserciones) | OK |

La comprobación de capas lee las constantes reales y el fuente real de
`MainScene`, y verifica el orden de las bandas, el acotado de `worldDepth`, el
recuento por banda (16 objetos en el modal, 2 en WORLD_TOP, 5 en el HUD) y el
caso concreto que fallaba:

```
ANTES  modal 100000  <  burbuja 1000000   -> la burbuja tapaba el modal
AHORA  modal 300000  >  burbuja 10000     -> el modal tapa la burbuja
  ok  burbuja de chat de un avatar por DEBAJO del modal
  ok  botón Perfil y estado por DEBAJO del modal
  ok  barra de chat y panel de personalización por DEBAJO del modal
  ok  cualquier avatar por DEBAJO del modal
```

### Prueba manual pendiente

Sigue sin poder usarse el navegador desde la sesión (la extensión de Chrome
perdió el acceso a `localhost`). Para confirmarlo a ojo, con dos pestañas:

1. Que el otro jugador diga algo por chat y, con su burbuja en pantalla, abrir
   **Perfil** → la burbuja debe quedar **detrás** del modal.
2. Con el modal abierto, mirar la esquina superior derecha → el botón **Perfil**
   debe quedar detrás.
3. Abrir el chat (Enter), escribir sin enviar, abrir Perfil → la barra de chat
   debe quedar detrás.
4. Caminar hasta que el suelo quede bajo la esquina superior izquierda → el
   texto "Roomie — room1" debe seguir legible por encima de las baldosas.

## Por qué bandas de profundidad y no `Phaser.GameObjects.Layer`

Phaser 3.60 tiene objetos `Layer` reales. Habrían dado una separación
estructural, pero obligan a redirigir **cada** `this.add.*` (unos 30 sitios) al
contenedor correcto, y olvidar uno deja el objeto en el sitio equivocado sin
error visible. En una fase cuyo objetivo es *estabilizar*, y sobre el sistema
de profundidad isométrica que ya dio bugs dolorosos (cabezas asomando, pantallas
negras), el riesgo no compensa.

Las bandas con nombre dan la misma garantía de orden, se verifican
automáticamente y no tocan cómo se crean los objetos. Cuando la Fase 4 trocee
`MainScene`, `layers.ts` ya es el sitio natural donde vive esa decisión y migrar
a `Layer` será un cambio localizado.

## Lo que esto NO arregla

- El modal sigue siendo Phaser: sin teclado en móvil, sin selección de texto ni
  portapapeles. Eso es la Fase 3.
- El lienzo sigue siendo 960×540 fijo con `Scale.FIT`.
- Las burbujas de chat siguen pudiendo solaparse entre sí si dos avatares
  hablan pegados: es un problema de *layout*, no de capas.

## Rollback

```bash
git revert <commit de esta fase>
```

Revierte también `src/render/layers.ts`, que sólo se usa aquí. Ninguna otra
fase depende de este cambio.
