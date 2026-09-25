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

**Ningún `setDepth` con un número suelto.** O es `worldDepth(...)` o es una
constante de `src/render/layers.ts`. Las bandas están separadas a propósito
(mundo < burbujas < HUD < paneles < modal).

**Mobiliario: una entrada en `src/state/furniture-catalog.ts` y una función de
dibujo.** El catálogo lo leen cliente Y servidor; si cada lado tuviera su lista,
discreparían sobre qué celdas están libres.

**El dinero sólo se mueve con `mover_saldo()`.** Nunca un `update balances`
suelto: el libro mayor y el saldo se tocan en la misma transacción.

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

## Assets

`node tools/genassets.mjs` regenera el tileset, las paredes **y los dos mapas**.
Si editas una sala en Tiled y luego lo ejecutas, la pierdes.
