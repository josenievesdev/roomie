# Roomie — contexto del proyecto

Juego web estilo Habbo Hotel: mundo isométrico 2D en pixel art, multijugador en
tiempo real. Proyecto personal de José, en castellano: **todo el código,
comentarios, mensajes de commit y documentación van en español**.

**Empieza leyendo `docs/estado-actual.md`**, que dice qué está hecho, qué está
a medias y qué viene después. Este fichero es sólo lo que hay que tener en la
cabeza antes de tocar nada.

## Arrancar

```bash
npm install && npm --prefix server install
cp server/.env.example server/.env     # y pegar la cadena de Supabase
npm --prefix server run db:migrate     # aplica db/migrations/*.sql
npm run dev:server                     # servidor de juego → :3001
npm run dev                            # cliente Vite     → :5173
```

Sin `server/.env` el servidor no arranca: desde la Fase 3 la identidad es
obligatoria y no hay modo sin base de datos.

## Verificar (ejecútalo SIEMPRE antes de dar algo por bueno)

```bash
npm run typecheck                  # cliente + servidor
npm run build
node tools/prueba-normas.mjs       # filtro del chat y edades, sin servidor
node tools/smoke-multiplayer.mjs   # E2E: registra cuentas reales y juega
npm --prefix server run db:check   # ejerce los invariantes de la base
```

`db:check` no comprueba que la base conecte: **intenta romper las reglas**
(saldo negativo, comprar fuera de catálogo, colocar un objeto ajeno, dos
muebles en la misma celda) y falla si alguna se deja romper.

## Reglas del proyecto

**Módulos puros compartidos.** `src/state/`, `src/utils/` y `src/net/protocol.ts`
no importan Phaser: el servidor los carga tal cual con rutas `../../src/...ts`.
Si metes Phaser ahí, rompes el servidor. Phaser sólo vive en `scenes/`,
`entities/`, `render/`, `ui/`, `net/client.ts` y `main.ts`.

**El servidor es la autoridad.** Posiciones, colisiones, nombre y dinero los
decide él. El navegador nunca habla con la base de datos; si lo hiciera, se
perdería el modelo anti-trampas.

**En Roomie juegan niños: la seguridad va primero** (`docs/fase7-seguridad-menores.md`).
- Toda interacción entre dos jugadores (chat, mensajes privados, amistades,
  regalos, comercio, visitas, ubicación) pasa por una regla de
  `src/state/normas.ts`, y la aplica el servidor. Nunca una regla de edad
  suelta en otro sitio.
- **La edad es privada:** no viaja a ningún otro cliente, ni en `PlayerView`
  ni en ningún evento.
- **Una casa es una sala de la base** (`casa:<uuid>`): su mapa y sus muebles
  los manda el servidor (`salaDatos`), y quién entra lo decide
  `puedeEntrarEnCasa` en `src/state/normas.ts`, en `join` Y en `room`.
- Los niños hablan con frases (`src/state/frases.ts`) y no reciben texto
  libre; el texto libre de los demás pasa por `filtrarChat()`, y el chat se
  entrega uno a uno (`emitirChat` en el servidor), nunca con un `io.to(sala)`
  directo.

**Ningún `setDepth` con un número suelto.** O es `worldDepth(...)` o es una
constante de `src/render/layers.ts`. Las bandas están separadas a propósito
(mundo < burbujas < HUD < paneles < modal).

**Mobiliario: una entrada en `src/state/furniture-catalog.ts` y una función de
dibujo.** Si ocupa varias celdas, su `huella`; y todo lo que estorba bloquea
TODAS las celdas de `celdasDe()`, en el cliente y en el servidor. El catálogo lo leen cliente Y servidor; si cada lado tuviera su lista,
discreparían sobre qué celdas están libres.

**El dinero sólo se mueve con `mover_saldo()`.** Nunca un `update balances`
suelto: el libro mayor y el saldo se tocan en la misma transacción.

**El avatar se genera, no se dibuja.** `public/assets/avatar/*.png` no son
colores: cada píxel es material + banda de luz + profundidad, y el navegador
combina y colorea las capas por jugador (`src/render/avatarSheet.ts`). Prenda
nueva: estilo en `src/state/look.ts` + forma en `tools/avatar/model.mjs` +
`node tools/genavatar.mjs --preview=<dir>` (y MIRAR las imágenes).

**Los muebles también se generan.** Modelo en `tools/muebles/modelos.mjs` +
entrada en el catálogo + `node tools/genmuebles.mjs` + su fila en la tienda
(migración): `db:check` falla si el cliente dibuja algo que no se puede
comprar. El color lo pone el tema de la sala, no el PNG. Lo que pone la
ciudad (farolas, árboles, el monumento) lleva `mundo: true` y no se vende.

**Todo texto pasa por el kit** (`texto()` de `src/ui/kit.ts`): la fuente
pixel propia a 12 px (24 sólo el logo), nunca un `fontFamily` suelto. Las
piezas de interfaz (paneles, botones, campos) también salen del kit, con
líneas de 1 px: nada de duplicar la escala para que "se vea".

**Con zoom, lo de tamaño fijo va en la cámara de la interfaz.** La sala se
amplía; interfaz, nombres y burbujas no. Lo decide la profundidad: de
`LAYER.WORLD_LABEL` para arriba lo dibuja la cámara sin zoom, así que se
coloca en coordenadas de pantalla (`aPantalla()`/`sobreCabeza()`).

**El aspecto sólo se valida con `sanitizeLook()`** (`src/state/look.ts`,
compartido). El servidor corrige campo a campo contra el catálogo.

**Una escala, una cámara, una luz.** Todo a ×1, proyección 2:1, luz desde
arriba y el eje col, rampas de `rampa()`, contorno del propio color. Las
reglas y sus números, en `docs/guia-de-estilo.md`.

## Trampas que ya nos costaron tiempo

- **Phaser pausa el bucle cuando la pestaña no está en primer plano**, y procesa
  los clics dentro de ese bucle. Al automatizar el navegador sin foco parece que
  el juego está roto y no lo está. Para depurar:
  `__roomie.events.removeAllListeners('hidden'); __roomie.loop.wake()`.
- **Los archivos del repo son CRLF.** Un reemplazo con LF no casa nunca.
- **Destruir una textura sin recrear sus animaciones** deja frames muertos y la
  pantalla en negro. `createAvatarTexture` las recrea siempre.
- **Hijos de un `Container` con `scrollFactor(0)`**: se dibujan donde crees pero
  el hit-test va a otro sitio. Usa objetos sueltos, como el modal.
- **En Windows, `import.meta.url` nunca casa con una ruta construida a mano**
  (`C:\...` frente a `file:///C:/...`). Usa `pathToFileURL`.
- **El cliente no puede decir cómo se llama.** Si añades un campo `name` a algún
  evento, lo estás deshaciendo.
- **Las cuentas nuevas necesitan fecha de nacimiento.** Un cliente de prueba
  que se registre sin `nacimiento` ("AAAA-MM-DD") recibe `INVALID`; las cuentas
  de antes reciben `necesitaNacimiento` y el servidor no las deja entrar.
- **Probar el control de edad deja una marca en el navegador**
  (`roomie:edad-rechazada`, 24 h) que impide registrarse: bórrala al acabar.
- **Con la ventana de Chrome oculta** el juego va a 2 fps, los `setTimeout` se
  frenan a 1 por segundo y los clics reales no llegan. Para probar, mover el
  bucle a mano cediendo con `MessageChannel` y simular `PointerEvent` sobre el
  canvas (receta en `docs/fase4-avatar-y-convivencia.md`).
- **Vite en Windows a veces se pierde la última de varias escrituras seguidas**
  y sirve un módulo a medias (código nuevo mezclado con viejo). `touch` al
  fichero y recargar.
- **Phaser mide cada fuente UNA vez.** Si se crea un texto antes de que la
  fuente pixel haya cargado, mide la de reserva y se queda con esa medida: por
  eso `main.ts` espera a `document.fonts.load` antes de crear el juego.
- **El servidor con `--watch` se reinicia al tocar cualquier módulo
  compartido**: los clientes de prueba conectados pierden la partida (socket.io
  reconecta, pero no vuelve a hacer `auth` ni `join`).

## Assets

`node tools/genassets.mjs` regenera el tileset, las paredes, las fachadas **y los
tres mapas** (plaza, room1, room2) y la plantilla del piso (`piso.json`).
Si editas una sala en Tiled y luego lo ejecutas, la pierdes. Para retocar sólo
el arte: `--solo=paredes` o `--solo=suelos` (los mapas no se tocan).

`node tools/genavatar.mjs` regenera las 17 capas del avatar (~8 s);
`node tools/genmuebles.mjs`, las 51 variantes del mobiliario (~1 s);
`node tools/genfuente.mjs`, la fuente pixel.
