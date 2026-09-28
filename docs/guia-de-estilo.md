# Guía de estilo visual

**Última actualización:** 26 de septiembre de 2026 (fase 5)

Roomie tiene que parecer un solo juego, no piezas de sitios distintos. Estas
reglas son las que hacen que un avatar, un sofá y una pared encajen. Casi
todas están en código, así que es difícil saltárselas sin querer. Cuando algo
nuevo "no pega", casi siempre rompe una de estas.

![Avatares de ejemplo en las 8 direcciones](img/avatares-direcciones.png)

## 1. Una sola escala: 1 píxel de arte = 1 píxel de pantalla

Todo se dibuja a tamaño real (×1): suelo, paredes, muebles y avatares. Nada se
escala ×2 para "que se vea más grande". El avatar viejo iba a ×2 y cada píxel
suyo era el doble de gordo que los de la sala: se notaba enseguida.

| Pieza | Medida | Dónde vive |
|---|---|---|
| Baldosa | 64×32 (rombo 2:1) | `src/utils/iso.ts` |
| Avatar de pie | ~64 px de alto | `tools/avatar/model.mjs` (`P`) |
| Pared | 96 px de cara (1,5 avatares) | `WALL_H` en `tools/genassets.mjs` y `ALTO_PARED` en `MainScene.ts` |
| Puerta | ~75 px (algo más que el avatar) | `puerta` en `tools/muebles/modelos.mjs` |
| Barra | ~40 px: a la altura del pecho | `barra` en `tools/muebles/modelos.mjs` |
| Asiento del sofá | 14 px sobre el suelo | `sit.alto` en `src/state/furniture-catalog.ts` |
| Asiento del taburete | 30 px | ídem |

El avatar es la vara de medir: un mueble nuevo se diseña pensando en a qué
altura del cuerpo le llega (una barra, al pecho; un asiento, a la rodilla).

## 2. Una sola cámara

Proyección isométrica 2:1: una cámara a 30° sobre el suelo, girada 45°. El eje
`col` va a (32, 16) px y el eje `row` a (−32, 16). Lo que se modela en 3D (los
avatares) se fotografía con esa misma cámara (`CAM` en
`tools/avatar/render.mjs`). Con otra, los pies patinarían sobre las baldosas.

La única trampa permitida: la cabeza del avatar mira un poco hacia arriba
(`P.tilt`). Con la cámara a 30°, una cabeza recta enseña más coronilla que
cara. Habbo hace lo mismo.

## 3. Una sola luz

La luz viene **de arriba y del lado del eje col** (la derecha de la pantalla):

- lo que mira hacia arriba, lo más claro;
- lo que mira hacia +col (abajo a la derecha), tono medio;
- lo que mira hacia +row (abajo a la izquierda), en sombra.

Es la regla que ya seguían los muebles (tapa clara, cara sureste media, cara
suroeste oscura). Las paredes la tenían al revés y se corrigió en esta tanda.
El vector está en `LUZ` (`tools/avatar/render.mjs`).

## 4. Color: rampas de 5 tonos, siempre con la misma regla

Cada color es una **rampa**: `0 brillo · 1 luz · 2 media · 3 sombra · 4 contorno`.
El color "de catálogo" es el tono 1, el que se ve con luz. Los otros cuatro los
calcula `rampa()` (`src/utils/color.ts`), así que añadir un color es una línea.

La regla, en OKLCH (un espacio donde "más oscuro" se *ve* igual de más oscuro
para cualquier color):

- **las luces tiran hacia el amarillo, las sombras hacia el azul**, y ganan un
  poco de croma al oscurecer. Oscurecer multiplicando da sombras grises y
  sucias; girar el tono da sombras con color, como la luz real;
- **la piel tira hacia el rojo** en sombra, no hacia el azul, y con menos
  contraste;
- los grises reciben un tono frío mínimo para que su sombra no quede sucia.

Los catálogos de color (piel, pelo, ropa) están en `src/state/look.ts`.

## 5. Contorno: oscuro del propio color, nunca negro

- Contorno exterior de 1 px con el **tono 4 de la rampa** de lo que rodea. El
  negro convierte las cosas en alambres.
- Líneas interiores **sólo donde algo tapa a otra cosa** con un salto de
  profundidad (un brazo delante del pecho, el flequillo sobre la frente), con
  el contorno de lo que está *delante*. No se trazan líneas entre materiales
  pegados (la camiseta y el pantalón se separan por el color).

## 6. Pocas bandas de luz, y lejos de los umbrales

Tres o cuatro bandas por volumen, no degradados. Los umbrales se colocan
**lejos** de las orientaciones típicas: la cara frontal de un avatar cae holgada
en una banda. Con el umbral encima, medio cuerpo bailaba entre dos bandas y
salía a manchas.

**La piel va casi plana**: sin brillo (un parche claro en la frente parece una
mancha) y sin sombra dura por orientación (una barbilla en sombra profunda
parece barba).

**El pelo rizado va sin franja de brillo** (`mate` en el grupo): con un
brillo por rizo, sale moteado.

## 6b. La cara

- **Los rasgos son sellos, no geometría.** Un ojo son 2×3 píxeles: modelado,
  bailaría entre 1 y 3 según cayera. Cada estilo (ojos, cejas, nariz, boca,
  pecas, rubor) es un dibujo de pocos píxeles con su variante de frente y de
  perfil (`src/render/cara.ts`), estampado donde el generador dice que cae ese
  rasgo en cada fotograma.
- **Ojos y cejas se reflejan de un lado al otro; nariz y boca no.** El
  brillo del ojo va arriba, del lado de fuera.
- **Todo sobre la piel y con colores de rampa**: la nariz es la propia piel en
  sombra o con brillo; el rubor y las pecas, la piel mezclada con rosa o con
  marrón; las cejas y la barba, el pelo. Nunca un color suelto.
- **La barba tiñe zonas de la piel** (mandíbula, bigote, perilla, patillas),
  así que se adapta a la forma de la cara y conserva su luz.
- **El cráneo es común**: una forma de cara nueva sólo cambia lo de abajo
  (mofletes, mandíbula, barbilla), de uno o dos píxeles.

## 7. Sombra en el suelo

Todo lo que se apoya en el suelo lleva una elipse de sombra debajo (violeta
muy oscuro, ~27% de opacidad). Ancla la pieza a la baldosa. Quien está sentado
no la lleva: su sombra caería sobre el asiento.

## 8. Profundidad con nombre

Ningún `setDepth` con un número suelto (`src/render/layers.ts`):
suelo < lo que se pisa (alfombras, luz) < mundo < nombres < burbujas < HUD <
paneles < modal. Dentro del mundo manda la Y de pantalla, y dos avatares en la
misma celda se desempatan por lo adelantado que está cada uno
(`avatarDepth`). Lo que no tiene altura va SIEMPRE en su banda, nunca en la
del mundo: una alfombra con la Y de su celda tapaba el sofá de detrás.

## 9. Interfaz

**La idea: fina, pero pixel art.** Líneas de 1 píxel, esquinas redondeadas,
paneles de cristal oscuro y una línea de color arriba en el panel principal.
Nada de biseles gordos ni letra duplicada: eso era lo que la hacía parecer de
Minecraft. El carácter lo ponen los colores y un motivo propio, el **rombo
isométrico** (la baldosa del juego en pequeño) como viñeta de los títulos.

**Una fuente:** "Roomie Pixel" (`tools/fuente/glifos.mjs`), siempre a través
de `texto()` del kit (`src/ui/kit.ts`), nunca un `fontFamily` suelto. Trazo
de 1 px, mayúsculas de 9, minúsculas de 6 y rabos de 3; el em son 12 px, así
que sólo se usa a 12 (todo) o a 24 (sólo el logo). La caja del texto mide 15
de alto (3 de aire para las tildes arriba): para centrar una línea en un hueco
se centran las mayúsculas con `yCentrada()`.

**Unas piezas:** paneles, botones, campos, pastillas, teclas y burbujas son las
de 9 porciones del kit (`pieza()`, `boton()`), dibujadas a tamaño real: borde
de 1 px, un brillo de 1 px bajo el borde de arriba (o una sombra, en los campos
hundidos) y esquina redondeada. Un botón tiene tres estados (normal, encima:
se enciende el borde; pulsado: se hunde) y actúa al soltar. Los botones de
sólo icono llevan su `pista` al pasar por encima. Las coordenadas se
redondean: medio píxel emborrona el texto.

**Iconos:** de línea de 1 px en los botones (chat, vestidor, perfil, zoom), con
un punto de color; de color y con contorno cuando tienen que leerse sobre
cualquier fondo (casa, moneda).

Medidas: HUD y botones de 24 px de alto, campos de 24, botones de modal de 26,
nombres sobre los avatares de 16, teclas de la chuleta de 16.

Paleta de la interfaz:

| Uso | Color |
|---|---|
| Fondo de panel | `#17151f` (95 %) |
| Borde | `#3d3860` (encima `#7a72b8`) |
| Línea de arriba del panel | `#8577f2` |
| Botón principal | `#6c5ce7` (borde `#8b7cf6`) |
| Campo activo, acento | `#9d90ff` |
| Texto | `#f4f1ff` |
| Títulos, nombres y monedas | `#ffe9a8` |
| Texto secundario | `#9a96c4` (apagado `#6c6890`) |
| En línea / error | `#7bed9f` / `#ff8a8a` |

**Zoom y tamaño fijo.** La sala se amplía ×1, ×2 o ×3 (enteros: con ×1,5 unos
píxeles saldrían dobles y otros no). La interfaz, los nombres y las burbujas
NO se amplían: los dibuja otra cámara sin zoom. Lo decide la profundidad: de
`LAYER.WORLD_LABEL` para arriba va en la cámara de la interfaz, así que un
nombre o una burbuja se colocan en coordenadas de PANTALLA (`sobreCabeza()`
en MainScene), no del mundo.

Los paneles fijos a la cámara se hacen con objetos sueltos, nunca con un
`Container` (ver `CLAUDE.md`).

## Cómo añadir cosas sin romper el estilo

**Un color de ropa o pelo:** una línea en `COLORES_ROPA` / `COLORES_PELO`
(`src/state/look.ts`). Las cinco tonalidades salen solas.

**Una prenda o un peinado:**
1. El estilo en `ESTILOS` (`src/state/look.ts`): así el servidor lo acepta.
2. Su forma en `tools/avatar/model.mjs`. Es una "segunda piel" colgada de los
   mismos huesos que el cuerpo, un poco más gruesa (mira `TORSO` o `PELO`).
   Un peinado se cuelga del cráneo (`peloBase`, `sobrePelo`); lo que cuelga
   (colas, trenzas) va en su propio grupo, o la línea del pelo lo corta.
3. `node tools/genavatar.mjs --solo=torso/nueva --preview=<carpeta>` y mirar
   la vista previa en las 8 direcciones y las poses (los peinados, en
   `peinados.png`).

**Un rasgo de la cara** (ojos, cejas, nariz, boca, detalle): su id en el
catálogo de `src/state/look.ts` y su sello en `src/render/cara.ts`. No hay que
regenerar nada; `--preview` saca `rasgos-<parte>.png` para mirarlo.

**Una forma de cara:** su id en `CARAS` (`src/state/look.ts`) y su parte de
abajo en `CARAS` de `tools/avatar/model.mjs`, sin tocar el cráneo. Luego
`node tools/genavatar.mjs` (rehace las anclas de `cara.json`).

**Un mueble** (de suelo o de pared):
1. Su entrada en `src/state/furniture-catalog.ts`: si estorba, si es un asiento
   (con su `alto` y hacia dónde se mira), si es plano o si cuelga de la pared.
2. Su modelo en `tools/muebles/modelos.mjs`, con materiales de `MAT_MUEBLE`
   (el color lo pondrá la sala) y su variante en `VARIANTES`.
3. `node tools/genmuebles.mjs --solo=nuevo --preview=<carpeta>` y mirar el
   resultado con los dos temas.
4. Su fila en la tienda: una migración en `db/migrations/`. `db:check` falla si
   el cliente dibuja algo que no se puede comprar.

**Un tema de sala:** una entrada en `ROOM_THEMES` (`src/render/theme.ts`). Los
muebles toman sus tonos de ahí; no hay que redibujar ninguno.

## Lo que todavía no sigue la guía

- **El suelo y las paredes** son pixel art dibujado píxel a píxel
  (`tools/genassets.mjs`), no modelado en 3D. Siguen la luz y la paleta, pero
  con otra técnica.
- **El marcador del clic** reutiliza una baldosa del suelo.
