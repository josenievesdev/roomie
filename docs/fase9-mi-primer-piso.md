# Fase 9 — Mi primer piso (Hito 1, primera parte)

**Fecha:** 27 de septiembre de 2026 · **Rama:** `feat/avatar-v2`

El gancho del juego, según el plan: llegar, ganarse las llaves y tener algo
tuyo. Esta tanda hace la parte de "tener tu casa". La tienda, el inventario
y colocar muebles van en la siguiente.

## Cómo se vive

1. Quien llega por primera vez aparece en la **Plaza de la Llave**, y el
   chat le dice que su piso le espera en la portería del **Edificio Roomie**
   (la puerta del edificio pastel, con un aplique a cada lado).
2. En la portería, **Rita, la portera**, le da la bienvenida y le ofrece las
   llaves: "es pequeño, pero es tuyo".
3. Con las llaves, entra en su **piso recién mudado** (8×8): tarima clara,
   paredes crema, dos ventanas y un aplique. Dentro hay una cama contra la
   pared, un armario y dos pilas de cajas de la mudanza por el suelo.
4. **Al volver a entrar al juego, aparece en su casa.** Desde cualquier sitio,
   el botón de la casa del HUD le lleva a ella; la puerta del piso sale a la
   plaza, delante de la portería.
5. **Nadie más puede entrar.** Hasta que haya amigos, la norma
   (`puedeEntrarEnCasa` en `src/state/normas.ts`) es que sólo entra el dueño.
   Es lo más seguro, también para los niños, y cuando lleguen los amigos es
   esa regla la que cambiará.

## Los cimientos que trajo

- **Las casas son datos (parte de C1).** Una casa es una fila de `rooms`
  (tipo `personal`, con dueño). Su id en el juego es `casa:<uuid>`
  (`CasaId` en el protocolo). Su mapa se guarda en la base: una copia de la
  plantilla `public/assets/piso.json`, que genera `tools/genassets.mjs` como
  las demás salas. Sus muebles son filas de `items`: son del jugador.
- **El servidor decide quién entra (parte de C1 y C3).** Una casa se carga de
  la base al entrar (`cargarCasa`), y el servidor sólo deja pasar a quien la
  norma permite, en `join` y en `room`. El cliente no tiene el mapa de las
  casas en sus ficheros: se lo manda el servidor (`salaDatos`), y la escena lo
  guarda en la caché antes de entrar. La casa de cada cuenta la sabe el
  servidor y la manda al entrar (`authOk.casa`).
- **Las llaves se dan una sola vez.** Un índice único en la base
  (`rooms_una_casa_por_cuenta`) lo garantiza aunque lleguen dos peticiones a
  la vez; la casa y sus muebles de regalo se crean en una sola transacción.
- **Muebles de varias celdas (C6).** El catálogo dice la huella de cada
  mueble (`huella`), y cliente y servidor bloquean las mismas celdas
  (`celdasDe`). La cama mide 1×2: se dibuja con la profundidad de su celda
  más adelantada y su sombra va centrada en la huella.
- **Lo que se regala no se vende.** `catalog_items.for_sale`: las cajas de la
  mudanza están en el catálogo (son objetos de verdad) pero no se pueden
  comprar.
- **Una privacidad de paso:** al entrar, el servidor ya sólo manda la gente
  de tu sala, no la de todo el juego. Dónde está cada uno, y quién está en su
  casa, no es asunto de nadie más.

## Verificación

- `node tools/smoke-multiplayer.mjs`: 75 comprobaciones. Diez son nuevas de
  la casa:
  - una cuenta nueva no tiene casa;
  - la portera da las llaves, y pedirlas otra vez no crea otra;
  - el piso trae cama, armario y cajas;
  - se entra;
  - la cama bloquea sus dos celdas, y un camino a sus pies se rechaza;
  - nadie más entra, y desde fuera no se ve a nadie de dentro;
  - al volver a entrar, el servidor recuerda la casa.
- `npm --prefix server run db:check`: siete reglas nuevas.
  - Una cuenta no puede tener dos casas, ni saltándose el servidor.
  - Dar las llaves dos veces devuelve la misma casa.
  - Los regalos se crean colocados en la casa.
  - Las cajas no se pueden comprar.
  - La casa queda apuntada a su dueño.
  - Borrar la cuenta se lleva su casa.
- `npm run typecheck`, `npm run build`, `node tools/prueba-normas.mjs`.
- En el navegador:
  - llegar andando a la portería;
  - recoger las llaves y entrar en el piso;
  - recargar la página y aparecer en casa.

## Lo que falta del Hito 1

- **La tienda y el inventario (S1):** comprar con las monedas y ver lo tuyo.
  Pide antes las dos monedas en el libro mayor (C4).
- **Colocar, mover y recoger muebles en tu casa**, con el servidor validando
  cada celda.
- **La interfaz que se adapta (C10)**, antes de esos paneles nuevos.
- **Las tareas de la llegada.** Hoy las llaves se dan sin más; cuando exista
  el trabajo en el café (Hito 3), la fianza se ganará en el primer turno.
