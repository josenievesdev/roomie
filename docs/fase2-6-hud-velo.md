# Fase 2.6 — Contador del HUD y velo del modal

**Fecha:** 24 de septiembre de 2026
**Alcance:** dos correcciones de una línea cada una en `src/scenes/MainScene.ts`.
No se tocó movimiento, Socket.io, `avatarState.ts`, el protocolo, los mapas de
Tiled, los assets ni las capas de la Fase 2.5.

Ambos síntomas venían reportados como problemas distintos ("jugador fantasma" y
"problema de la sala"). Ninguna de las dos hipótesis era correcta.

---

## 1. El HUD mostraba "En línea — 2 en room1" estando solo

**Archivo:** `src/scenes/MainScene.ts` · **Función:** `updateStatusHud()`

```ts
const here = 1 + this.netPlayers.filter((p) => p.room === this.roomId).length;
```

### No había ningún jugador fantasma

El ciclo de conexión estaba sano. Se auditó contra el servidor real, con 14
comprobaciones:

| Escenario | Resultado |
|---|---|
| Censo con un solo cliente | el servidor conoce **1** jugador |
| Desconexión limpia (`close`) | desaparece del censo |
| Desconexión abrupta (transporte cortado sin `close`) | desaparece del censo |
| Reconexión rápida | **una** sola instancia, el socket viejo no sobrevive |
| Cambio `room1 → room2` | sale del snapshot de la sala origen |

**La causa era que el HUD se contaba a sí mismo dos veces.** El servidor emite
el snapshot de la sala incluyéndote a ti, así que `netPlayers` ya te contiene y
el `1 +` te sumaba otra vez. Estando solo: `1 + 1 = 2`.

Por eso pasaba igual en room2: no dependía de la sala.

### Corrección

```ts
const here = this.netPlayers.filter((p) => p.room === this.roomId).length;
```

Verificado con 1, 2 y 3 jugadores reales, tras un cambio de sala y tras una
desconexión: el contador coincide siempre con los jugadores reales.

---

## 2. La VISTA PREVIA del modal salía cortada por el borde de la pantalla

**Archivo:** `src/scenes/MainScene.ts` · **Función:** `showLoginModal()`

El `preview` era el **único** de los 14 objetos del modal que no fijaba
`setScrollFactor(0)`. Sin eso vivía en coordenadas del **mundo**, así que la
cámara se lo llevaba — y el desplazamiento de cámara **sí** depende del tamaño
de la sala, porque `roomBounds()` centra los límites en ella:

| Sala | Centro | Scroll de cámara | Preview acaba en | Resultado |
|---|---|---|---|---|
| room1 (12×12) | x = 0 | −480 | **x = 960** | borde derecho del lienzo → **50% visible, cortada** |
| room2 (14×10) | x = 64 | −416 | x = 896 | dentro → 100% visible |

Esos 64 px de diferencia entre los centros de las dos salas son justo los que
dejaban la preview dentro o fuera. El modal usa coordenadas universales del
lienzo (480, 270…), pero a este objeto se le sumaba encima el desplazamiento de
cámara de la sala.

### Corrección

```ts
.setScrollFactor(0)
```

Con eso la preview se queda en (480, panelY+170) — centrada en el panel y 100%
visible — en cualquier sala, y sea cual sea el tamaño que tengan las futuras.

Auditados los demás objetos de interfaz de la escena: no hay más fugas.

---

## 3. Avatares del MUNDO visibles a través del modal

**Archivo:** `src/scenes/MainScene.ts` · **Función:** `showLoginModal()`

```ts
.rectangle(480, 270, 960, 540, 0x000000, 0.86)        // velo
.rectangle(480, 270, panelW, panelH, 0x12121a, 0.96)  // panel
```

### No dependía de la sala

Las capas de la Fase 2.5 estaban bien: nada del mundo se dibujaba por encima del
modal. El problema era que **el modal no ocultaba el mundo, sólo lo atenuaba, y
lo atenuaba de forma desigual**: fuera del panel el mundo se veía al **14%**,
detrás del panel al **4%**. Un avatar que cruzara el borde del panel cambiaba de
brillo **3,5× de golpe**, y eso es lo que se lee como "cortado".

Barrido de todas las celdas libres de ambas salas:

| | room1 (12×12) | room2 (14×10) |
|---|---|---|
| tapado por el panel | 80 % | 79 % |
| a caballo del borde → **cortado** | 8 % | 9 % |
| al aire, sólo el velo | 12 % | 13 % |

Estadísticamente idénticas. **Dependía de dónde estabas**, y lo que lo volvía
determinista por sala era la celda de llegada de cada puerta:

| Vienes de | Llegas a | En pantalla | Resultado |
|---|---|---|---|
| room2 → **room1** | celda (9,1) | x 720..752 | **fuera del panel** (acaba en 660) → avatar bien visible |
| room1 → **room2** | celda (1,1) | x 400..432 | dentro del panel → oculto |

De ahí que room2 "funcionara" y room1 no. El spawn por defecto
(`firstFreeCell`: (6,6) y (7,5)) queda tapado en ambas, así que un jugador nuevo
sin guardado no lo veía nunca.

### Corrección

```ts
.rectangle(480, 270, 960, 540, 0x000000, 1)   // velo opaco
```

Mientras el panel sea más opaco que el velo, cualquier avatar que cruce el borde
se verá cortado: es aritmética de alfas, no un defecto que se pueda pulir. La
única solución es no dejar ver el mundo.

**Compromiso aceptado:** se pierde ver la sala de fondo mientras el modal está
abierto. La alternativa era ocultar los sprites del mundo al abrir
(`setVisible(false)` sobre el jugador y los peers, restaurándolo al cerrar),
pero son ~6 líneas y toca el ciclo de vida del modal; con el velo opaco es un
número y cero riesgo.

---

## Verificación

| | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm run build` | OK |
| `node tools/smoke-multiplayer.mjs` (20 checks) | OK |
| Contador del HUD (1/2/3 jugadores, cambio de sala, desconexión) | OK |
| Ciclo de conexión (14 comprobaciones) | OK — sin fantasmas |
| Orden de capas de la Fase 2.5 (19 aserciones) | OK — sin regresión |
| Dos clientes simultáneos (movimiento, chat, burbujas, colores) | OK |

## Rollback

```bash
git revert <commit de esta fase>
```

Son dos valores independientes: se puede revertir sólo uno editando la línea
correspondiente.
