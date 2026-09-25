# Fase 2.10 — Pasada visual: pixel art de verdad y salas con identidad

**Fecha:** 24 de septiembre de 2026

## El problema

El arte era el placeholder de la Fase 0: dos rombos de color plano con un borde
oscuro, y paredes dibujadas como polígonos vectoriales grises. Las dos salas
usaban exactamente lo mismo, así que room1 y room2 eran indistinguibles.

## Lo que se ha hecho

### 1. Los suelos son pixel art, no rombos planos

`tools/genassets.mjs` ahora pinta **píxel a píxel**, con las reglas del oficio:

- **Biselado**: la luz entra por arriba, así que los cantos superiores del
  rombo se aclaran y los inferiores se oscurecen. Es lo que da volumen.
- **Junta** oscura de 1 px entre baldosas.
- **Tramado ordenado** (matriz de Bayer 4×4) de baja intensidad, para romper el
  color plano sin ensuciar.
- Tres variantes por tema: baldosa lisa, baldosa con mota central y **cenefa**
  con un rombo interior en color de acento.

### 2. Las paredes son sprites, no polígonos

Antes: un polígono relleno con una franja oscura abajo. Ahora `walls.png`, con
cada cara dibujada a mano alzada de píxel:

- remate superior claro,
- juntas verticales de panel cada 8 px,
- **moldura** a media altura,
- **zócalo** al pie,
- tramado, cantos marcados y un tono más oscuro en la cara que mira al noroeste
  (dos tonos, como en todo isométrico decente).

La geometría es la misma de antes (32 px de ancho, 48 de alto más 16 de sesgo),
así que encajan en esquina sin costuras.

### 3. Cada sala tiene su tema

`src/render/theme.ts` define, por sala, las piezas del atlas y la paleta del
mobiliario y la puerta:

| | room1 | room2 |
|---|---|---|
| nombre | Salón cálido | Sala fría |
| suelo | terracota, cenefa dorada | turquesa, cenefa menta |
| paredes | crema con moldura marrón | índigo con moldura azul |
| sofá | coral | violeta |
| mesa | madera | pizarra |
| puerta | madera y pomo dorado | azul y pomo menta |

Los **suelos no pasan por el tema en el cliente**: cada mapa de Tiled guarda ya
los gid de su propio tema, así que el mapa se sigue viendo bien en el editor y
el cliente no tiene que desplazar nada. La cenefa forma un marco decorativo
sobre las celdas pegadas a la pared.

### 4. El mobiliario deja de parecer un alambre

El fallo era el contorno: cada cara se trazaba en **casi negro**, lo que
convertía el sofá en una caja de líneas. Ahora el contorno es un tono oscuro
**del propio color de la cara**.

Además, el sofá:

- lleva reposabrazos a los dos lados y respaldo, con **cara superior** además de
  la frontal — sin ella eran paredes de un píxel y el mueble se leía como una
  caja hueca;
- tiene el cojín marcado hacia dentro, costura central y capitoné en el respaldo;
- se dibuja en orden de pintor, de atrás hacia delante.

La mesa tiene vetas y brillo en el canto trasero, y ambos muebles proyectan una
sombra elíptica que los ancla a la baldosa.

## Verificación

`typecheck`, `build`, smoke E2E y las aserciones de capas, en verde. Revisado en
navegador real: el tileset y las paredes generadas, las dos salas y el
mobiliario de cerca.

De paso, la comprobación de capas encontró que `createFurniture` era el último
`setDepth` del proyecto que no pasaba por `worldDepth()`. Corregido.

## Lo que queda

- Sólo hay dos muebles (sofá y mesa). Faltan alfombras, plantas, lámparas y
  cuadros, que es lo que acabaría de llenar las salas.
- El avatar sigue siendo el placeholder de 16×24 escalado ×2, con tres
  direcciones. Subirlo a autoría nativa y ocho direcciones es la Fase 6 del plan
  original.
- Las paredes no tienen ventanas ni huecos más allá de la puerta.

## Nota sobre el generador

`node tools/genassets.mjs` regenera tileset, paredes y **los dos mapas**. Si
editas una sala en Tiled, volver a ejecutarlo la sobrescribe.
