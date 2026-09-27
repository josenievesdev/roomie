# Fase 10 — Economía, tienda, decorar y el móvil (Hito 1, segunda parte)

**Fecha:** 27 de septiembre de 2026 · **Rama:** `feat/avatar-v2`

Con esta tanda el Hito 1 ya se juega entero salvo las tareas de la llegada:
recoges las llaves, compras en la tienda, lo que compras va a tu mochila y lo
pones en tu casa donde quieras. Y todo se juega igual de bien con el dedo, en
vertical o en horizontal.

## Cómo se vive

1. **Dinero.** Al crear la cuenta hay 500 monedas de bienvenida. Cada día, al
   entrar, llega el **premio del día** (+50), y el chat lo dice. Arriba a la
   derecha se ven las monedas (y los créditos, cuando los haya).
2. **La tienda** (bolsa, o la tecla T): secciones en pestañas (Salón,
   Dormitorio, Decoración, Pared, Fiesta) y una tarjeta por mueble con su
   dibujo, nombre y precio. **Comprar pide dos toques**: "Comprar" y luego
   "¿Seguro?". Lo que no te llega sale atenuado.
3. **La mochila** (tecla M): lo tuyo que no está puesto, agrupado ("Alfombra
   ×2"). Cada cosa tiene "Poner" (sólo en tu casa) y "Vender": la tienda te lo
   recompra **por la mitad**, también con dos toques. Lo que no se vende (las
   cajas de la mudanza) sólo se puede tirar.
4. **Decorar tu casa.** En tu casa, el botón de la casa del HUD se vuelve un
   rodillo de pintar: **decorar**.
   - Decorando, tocar un mueble lo elige (se marca su huella en el suelo) y
     sale su menú: **Mover**, **Girar** (lo que tiene dos caras: estantería y
     armario) y **Guardar** (vuelve a la mochila).
   - Al poner o mover algo aparece su **fantasma**, con las celdas que ocupará
     marcadas en el suelo: verdes si cabe, rojas si no.
   - Con el ratón, el fantasma sigue al puntero y un clic lo pone (R gira,
     Esc cancela).
   - Con el dedo, se toca dónde va (o se arrastra el propio fantasma, que va
     "cogido" por donde se tocó) y se confirma con **Poner aquí**.
   - Si no cabe, se dice por qué: "Deja libre la puerta.", "Ahí ya hay otro
     mueble.", "Apártate un poco para ponerlo ahí."…
   - Lo de pared va en la pared: basta con mover el puntero a lo largo de ella.
   - Las alfombras juntas se unen: la cenefa sólo rodea el conjunto.
   - "Listo" (o Esc) sale del modo decorar. Fuera de él, tocar el sofá sigue
     siendo sentarse.

## El móvil, al 100 %

- **El lienzo mide lo que mide la pantalla**, en vertical o en horizontal, y
  se recoloca al girar el móvil. La escala es entera (el pixel art no se
  deforma): un monitor de 1080 va a ×2; un móvil, a ×1 y nítido.
- **Todo se coloca con la pantalla de ese momento**, nunca con un 960×540
  escrito a mano: HUD, chat, tienda, mochila, vestidor, menús, portería y el
  modal de cuenta. Al girar, lo pasajero (menús) se cierra y los paneles se
  rehacen sin perder lo que tenían: la sección de la tienda, lo escrito en el
  modal, el borrador del vestidor.
- **Con el dedo:**
  - los botones del HUD van en una barra abajo, al alcance del pulgar, y son
    más grandes;
  - cada botón tiene una zona de toque mayor que su dibujo;
  - la barra del chat va **arriba**, y mientras se escribe, el historial también
    (abajo lo taparía el teclado);
  - **pellizcar hace zoom** (y no echa a andar al avatar);
  - el modal de cuenta va arriba y, al escribir en un campo que quedaría bajo
    el teclado, sube hasta que asome.
- **El vestidor**, en un móvil en vertical, pasa a una columna: la vista
  previa arriba y las opciones debajo.
- **Las frases** ocupan el ancho del móvil y las pestañas saltan de fila.
- La **chuleta de controles** sale una vez por visita (no en cada puerta), y
  mientras se ve, el chat queda encima de ella.

## Los cimientos que trajo

- **Dos monedas en el libro mayor (C4).** `ledger`, `balances` y
  `catalog_items` llevan moneda (`monedas` o `creditos`). `mover_saldo()`
  tiene un parámetro más, la moneda, con `monedas` por defecto. Los créditos
  se comprarán con dinero real, pero todavía no: falta el proveedor de pagos,
  el permiso de los padres y la revisión legal. El libro ya los distingue,
  para que eso no obligue a rehacer nada.
- **El premio del día**, una vez por cuenta y día (hora de Bogotá, la de La
  Manzana). La clave primaria de `premios_diarios` es lo que garantiza que no
  se cobra dos veces, aunque lleguen dos peticiones a la vez.
- **Vender** borra el objeto y devuelve la mitad, en una transacción. Sólo lo
  que está en tu mochila: lo puesto, primero se guarda.
- **Las reglas de decorar son un módulo puro compartido**
  (`src/state/decorar.ts`, `motivoNoCabe`). El cliente las usa para pintar el
  fantasma de verde o de rojo; el servidor, para decidir. Si cada lado tuviera
  las suyas, el verde podría mentir.
- **Pisos:** las alfombras van en el suelo (`stack` 0) y lo demás encima (1),
  así una alfombra puede ir debajo de un sofá. El índice único de `items`
  impide dos cosas en la misma celda y el mismo piso.
- **La interfaz que se adapta (C10).** `src/ui/pantalla.ts` dice si se usa el
  dedo y las medidas que dependen de eso (`medidas()`); `src/ui/panel.ts` es
  el panel base (velo que cierra al tocar fuera, título y cerrar) de la tienda
  y la mochila.
- **Los nombres de los muebles son los de la tienda.** Los avisos del
  servidor ("Sofá: ¡puesto!") usan el nombre del catálogo del código, y la
  tienda el de la base: `db:check` exige que sean el mismo.

## Dos fallos que salieron por el camino

- **Al girar el móvil, el lienzo se quedaba con la medida vieja.** En el modo
  `Scale.NONE`, Phaser sólo pone el tamaño CSS del lienzo al cambiar el zoom
  (`setZoom`), no al cambiar de tamaño. Llamando a `setZoom` y luego a
  `resize`, el CSS se calculaba con el tamaño de antes. Ahora `main.ts` pone
  el zoom y el tamaño CSS y luego llama a `resize`, que además avisa a la
  escena una sola vez.
- **Los clics simulados no llegaban.** Phaser sólo emite `pointerup` si el
  `mouseup` cae sobre el lienzo; si no, es `pointerupoutside`. La escena
  ahora también escucha ese evento para no dejar a medias un arrastre, un
  pellizco o un fantasma cogido. (Para probar con la ventana oculta: el
  `mouseup` sintético, sobre el lienzo; y los `Touch` sintéticos necesitan
  `pageX`/`pageY`, y nada encima del lienzo, porque Phaser comprueba
  `elementFromPoint` en cada `touchmove`.)

## Verificación

- `node tools/smoke-multiplayer.mjs`: 86 comprobaciones; once son nuevas de
  la tienda y de decorar:
  - la tienda vende el sofá y no las cajas de regalo;
  - comprar descuenta y va a la mochila; lo regalado no se compra;
  - colocar en tu casa manda los muebles a quien está dentro;
  - no se tapa la entrada de la puerta ni los pies de la cama;
  - el servidor conoce el sofá nuevo (el camino acaba sentándote en él);
  - guardar lo quita de la casa, y venderlo devuelve la mitad;
  - girar el armario lo gira en su sitio ("¡Girado!");
  - fuera de tu casa no se decora.
- `npm --prefix server run db:check`: la sección Economía (el premio del día
  una vez al día, créditos que no bajan de cero, cada cosa en su moneda,
  vender por la mitad y una sola vez, lo puesto no se vende, el libro cuadra
  moneda a moneda) y que cada cosa se llame igual en la tienda y en los avisos.
- `node tools/prueba-normas.mjs`: trece reglas de decorar.
- `npm run typecheck` y `npm run build`.
- En el navegador, con el ratón y emulando el dedo a 390×740 (vertical) y
  844×390 (horizontal):
  - la tienda (comprar con dos toques), la mochila, poner, mover, girar,
    guardar, alfombras que se unen, un cuadro en la pared;
  - el rechazo en rojo con su motivo;
  - el pellizco, el chat arriba, las frases, el vestidor en columna, el
    registro que sube sobre el teclado y el menú de otro jugador.

## Lo que falta del Hito 1

- **Las tareas de la llegada.** Hoy las llaves se dan sin más; cuando exista
  el trabajo en el café (Hito 3), la fianza se ganará en el primer turno.
- **Visitas.** Hasta que haya amigos, en tu casa sólo entras tú.
- Más muebles a la venta: hoy son 18.
