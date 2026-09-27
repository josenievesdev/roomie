# Fase 8 — La Plaza de la Llave (primera zona de La Manzana)

**Fecha:** 27 de septiembre de 2026 · **Rama:** `feat/avatar-v2`

José quería ver ya la ciudad. Esta es la primera zona de La Manzana: la
Plaza de la Llave, al aire libre, que pasa a ser **la entrada del juego**.
Las dos salas que había (el Salón Central y el Club Neón) ahora son
edificios de la plaza: se entra y se sale por sus puertas.

## Qué hay

- **20×20 celdas al aire libre.** Adoquín de piedra (cada baldosa son cuatro
  piedras), dos caminos en cruz hacia el centro, aceras junto a las fachadas
  y una calzada de asfalto que rodea la plaza por delante.
- **Edificios al fondo**, en cuatro estilos: ladrillo, piedra, moderno y
  pastel. Tienen dos plantas, cornisa, ventanas que reflejan el cielo, toldo
  de rayas y escaparate. La puerta del Salón lleva un aplique a cada lado; la
  del Club Neón, dos neones.
- **La Llave**, en el centro: una llave dorada gigante clavada en un pedestal
  de piedra con forma de cerradura. En su ojo, el rombo de Roomie, que brilla.
  Alrededor, un anillo de mosaico dorado, cuatro jardineras con flores y
  cuatro bancos mirando al monumento.
- **Farolas** con su charco de luz, y **cuatro parterres de césped con un
  árbol** cada uno.

## Cómo está hecha (y por qué no hubo que tocar los cimientos)

Todo se apoya en lo que ya funcionaba; nada se construyó sobre un hueco:

- **Una sala más.** La plaza es un mapa como `room1` y `room2`
  (`public/assets/plaza.json`, generado en `tools/genassets.mjs`). Es la
  primera de `ROOMS`, así que quien llega por primera vez, o pide una sala que
  no existe, aparece en ella. Cuando las salas pasen a ser datos (cimiento C1)
  se mudará junto con las otras dos, sin rehacerse.
- **Las fachadas son las paredes de la calle.** Una pieza por celda en la
  fila 0 y en la columna 0, igual que las paredes, así que se ordenan con los
  avatares sin trucos. Miden 152 px (dos plantas); qué edificio va en cada
  celda lo dicen las propiedades del mapa (`exterior`, `fachadaDer`,
  `fachadaIzq`). Por eso no hizo falta todavía el cimiento C6 (objetos de
  varias celdas).
- **Todo el mobiliario de la calle mide una celda**, generado en 3D como el
  resto (`tools/muebles/modelos.mjs`): `llave`, `farola`, `arbol`, `banco` y
  `jardinera`. Llevan la marca `mundo` en el catálogo: los pone la ciudad y no
  se venden (`db:check` ya no exige que estén en la tienda).
- **Suelos nuevos**: césped y asfalto, iguales en todos los temas. Ahora son
  cinco por tema, así que los mapas de las salas se regeneraron con los
  nuevos números de baldosa.
- **Bancos girados.** Un mueble orientable se puede girar desde el mapa
  (propiedad `girado`), no sólo pegado a la columna 0. El asiento sabe hacia
  dónde se mira girado (`dirGirado`): el cliente y el servidor usan la misma
  regla (`vaGirado()` en el catálogo).

## Verificación

- `npm run typecheck`, `npm run build`, `node tools/prueba-normas.mjs`.
- `node tools/smoke-multiplayer.mjs`: 65 comprobaciones, cuatro nuevas:
  - la plaza tiene sus dos puertas;
  - quien pide una sala que no existe entra en la plaza;
  - hay un banco girado;
  - sentado en él, se mira al sureste.
- `npm --prefix server run db:check`: correcta (lo del mundo no se vende).
- En el navegador:
  - la plaza entera, vista de cerca y de lejos;
  - la ida y vuelta de la plaza al Club Neón, apareciendo delante de cada
    puerta;
  - la entrada desde el Salón.

## Lo siguiente en la ciudad

Por el plan (`docs/plan-piramide.md`):

- las otras zonas de La Manzana (Avenida de la Moda, parque, mall...), cada
  una conectada por los bordes;
- día y noche, con las farolas encendiéndose;
- el clima y la música de cada lugar;
- peatones del juego para que se sienta concurrida.

Antes toca el Hito 1 ("Mi primer piso"), que trae los cimientos que esas
zonas necesitan.
