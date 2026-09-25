# Roomie 🏠

Mundo abierto 2D en pixel art con proyección isométrica, estilo Habbo.
Juego web hecho con **Phaser 3 + TypeScript + Vite**, con **servidor Node + Socket.io**
(multijugador en tiempo real).

> **Estado del proyecto y qué viene:** `docs/estado-actual.md`.

## Requisitos

- Node.js 24+ (`node -v`) — el servidor ejecuta los `.ts` directamente, sin build
- Una base Postgres (Supabase sirve): desde el login real, la identidad es
  obligatoria y no hay modo sin servidor

## Puesta en marcha

```bash
npm install && npm --prefix server install

cp server/.env.example server/.env    # y pegar dentro la cadena de conexión
npm --prefix server run db:migrate    # crea el esquema
```

Y luego, en dos terminales:

```bash
npm run dev:server   # servidor del juego → :3001
npm run dev          # cliente Vite      → http://localhost:5173
```

Regístrate, y abre **otra pestaña con otra cuenta** para ver el multijugador
(la misma cuenta no puede estar dentro dos veces).

Otros comandos:

```bash
npm run typecheck                        # tsc del cliente + tsc del servidor
npm run build                            # compilación de producción en dist/
npm run preview                          # previsualizar el build
node tools/smoke-multiplayer.mjs         # E2E: registra cuentas reales y juega
npm --prefix server run db:check         # ejerce los invariantes de la base
npm --prefix server run db:migrate       # aplica db/migrations/*.sql
node tools/genassets.mjs                 # regenera tileset, paredes y mapas
```

## Roadmap

Hecho:

- [x] Isométrico, avatar animado, A\* y colisiones, dos salas con puertas
- [x] Multijugador con servidor autoritativo, chat y personalización
- [x] **Movimiento sin tirones**: simulación con tiempo real e interpolación
- [x] **Capas de interfaz** separadas del mundo
- [x] **Teclado en móvil** y panel de chat con historial
- [x] **Pixel art de verdad** y una identidad visual por sala
- [x] **Catálogo de mobiliario** compartido entre cliente y servidor
- [x] **Base de datos Postgres** con cuentas, libro mayor e inventario
- [x] **Login real** con sesiones persistentes

Siguiente:

- [ ] Tienda e inventario (las tablas ya están; falta la interfaz)
- [ ] Colocar muebles comprados en una sala
- [ ] Salas como datos, para poder crear plazas y locales sin tocar código
- [ ] Salas propias por cuenta
- [ ] Trabajos y economía

El detalle de cada punto, y por qué en ese orden, en `docs/estado-actual.md`.

## Arquitectura

```
src/
├── main.ts                  # configuración del juego
├── scenes/MainScene.ts      # render, entrada, chat, red, modales
├── state/                   # PURO (sin Phaser) — lo ejecuta el SERVIDOR
│   ├── avatarState.ts       #   movimiento y colisiones
│   ├── furniture-catalog.ts #   qué mueble estorba y en cuál se sienta uno
│   └── palette.ts
├── net/
│   ├── protocol.ts          # PURO — eventos y tipos compartidos
│   └── client.ts            # socket.io + token de sesión
├── render/
│   ├── layers.ts            # bandas de profundidad (mundo / HUD / modal)
│   └── theme.ts             # paleta y piezas de atlas por sala
├── entities/                # avatar y mobiliario (Phaser)
├── ui/textInput.ts          # <input> real: teclado en móvil
└── utils/                   # iso, A*, guardado local

server/                      # paquete Node aparte
└── src/
    ├── index.ts             # socket.io + autenticación + simulación 20 Hz
    ├── world.ts             # lee los mapas de Tiled → colisiones
    └── db/                  # conexión, migraciones, cuentas, sesiones

db/migrations/*.sql          # esquema, en orden
tools/                       # generador de assets y smoke test E2E
docs/                        # estado-actual.md + informe de cada tanda
```

- `AvatarState` es un módulo **sin dependencias de Phaser**: recibe órdenes
  (`keyboardMove`, `startPath`, `tick`) y devuelve posición/orientación.
  **Lo ejecuta el servidor** en un tick fijo de 50 ms; el cliente predice en
  local (instantáneo) y sólo dibuja a los demás con los snapshots a 20 Hz.
- El navegador se conecta a su propia origen y **Vite hace de proxy** de
  `/socket.io` hacia `:3001` (`vite.config.ts`), así que funciona igual en dev,
  con `vite --host` (red local) y detrás de cualquier hosting.
- Guardado automático cada 5 s y al cerrar la pestaña (`localStorage`,
  clave `roomie:save`). Si la celda guardada quedó bloqueada (p. ej.
  sentado en el sofá), se busca la celda libre más cercana.

## Multijugador (Fase 7)

| Mensaje | Cliente → servidor | Servidor → cliente |
|---|---|---|
| Entrar / cambiar de sala | `join`, `room` | `welcome` (id + todos), `players` (20 Hz) |
| Moverse | `move` (ejes -1..1), `path` (A*), `stand` | — |
| Aspecto | `look` (ropa/pelo) | reflejado en `players` |
| Chat | `text` (≤60 car., anti-spam 400 ms) | `chat` (incluido el eco propio) + avisos de sistema |

El servidor **valida** todo lo que llega: salas y celdas dentro de límites,
caminos con saltos de 8 vecinos que empiezan junto al avatar, intermedias libres
y última celda sólo si es sofá/puerta (mismas reglas que el A* del cliente).


## Assets y mapas

- `tools/genassets.mjs` regenera el tileset y `room1.json`:
  `node tools/genassets.mjs`
- `public/assets/room1.json` es un mapa de **Tiled** (isométrico 12×12):
  ábrelo con el editor Tiled para modificarlo. La capa `colisiones`
  (oculta) marca las celdas bloqueadas y la capa `objetos` coloca el
  mobiliario mediante las propiedades enteras `col` y `row` de cada objeto
  (tipo `sofa` o `mesa`).
- Las paredes traseras se generan en código sobre la fila 0 y la columna 0.
- El servidor **lee los mismos `room1.json`/`room2.json`** (`server/src/world.ts`):
  si editas un mapa en Tiled, recuerda reiniciar el servidor (o déjalo con `--watch`).
