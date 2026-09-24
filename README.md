# Roomie 🏠

Mundo abierto 2D en pixel art con proyección isométrica, estilo Habbo.
Juego web hecho con **Phaser 3 + TypeScript + Vite**, con **servidor Node + Socket.io**
(multijugador en tiempo real).

## Requisitos

- Node.js 24+ (`node -v`) — el servidor se ejecuta en `.ts` directamente (sin build)

## Puesta en marcha

Dos terminales:

```bash
npm run dev:server   # servidor del juego → :3001
npm run dev          # cliente Vite      → http://localhost:5173
```

Abre **dos pestañas** en http://localhost:5173 y verás a los dos avatares moverse
en tiempo real. Sin servidor, el juego sigue funcionando en single-player.

Otros comandos:

```bash
npm run typecheck                        # tsc del cliente + tsc del servidor
npm run build                            # compilación de producción en dist/
npm run preview                          # previsualizar el build
node tools/smoke-multiplayer.mjs         # smoke test E2E del multijugador (20 checks)
```

## Estructura

Ver sección **Arquitectura** más abajo.

## Roadmap

- [x] Fase 0 — proyecto Vite + TS + Phaser, primera escena
- [x] Fase 1 — proyección isométrica, panorama de sala y cámara
- [x] Fase 2 — avatar con animaciones, colisiones y clic para caminar (A*)
- [x] Fase 3 — sala real con paredes y mobiliario
- [x] Fase 4 — sentarse en el sofá y burbuja de chat (Enter)
- [x] Fase 5 — guardado (localStorage) + estado aislado para el online
- [x] Personalización del avatar (tecla **C**: ropa y pelo, se guarda)
- [x] Múltiples salas: room1 ↔ room2 con puertas (clic en la puerta)
- [x] Fase 7 — **multijugador**: servidor autoritativo + ver a los demás + chat de sala
- [ ] Despliegue (red local con `vite --host`, luego hosting público)
- [ ] Futuro — cuentas, inventario, más salas, sonidos

## Arquitectura

```
src/
├── main.ts              # configuración del juego
├── scenes/
│   └── MainScene.ts     # render + entrada + chat + guardado + avatares remotos
├── state/
│   ├── avatarState.ts   # LÓGICA PURA del avatar (sin Phaser) → la ejecuta el SERVIDOR
│   └── palette.ts       # paleta del avatar: colores de ropa y pelo
├── net/
│   ├── protocol.ts      # eventos y tipos compartidos cliente ↔ servidor (PURO)
│   └── client.ts        # cliente socket.io (sin Phaser, sobrevive a los reinicios)
├── entities/
│   ├── avatar.ts        # textura por avatar (`avatar`, `avatar:<id>`) + animaciones
│   └── furniture.ts     # sofá, mesa...
├── utils/
│   ├── iso.ts           # proyección isométrica 2:1
│   ├── pathfinding.ts   # A* (8 direcciones, octile)
│   └── storage.ts       # guardado en localStorage
├── tools/
│   ├── genassets.mjs            # genera tileset.png y room1.json
│   └── smoke-multiplayer.mjs    # smoke test E2E contra el servidor
server/                  # paquete Node aparte (su propio package.json)
└── src/
    ├── index.ts         # Socket.io + simulación autoritativa (AvatarState) a 20 Hz
    └── world.ts         # lee los JSON de Tiled y construye colisiones/puertas/sofás
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
