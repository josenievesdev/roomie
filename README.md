# Roomie 🏠

Mundo abierto 2D en pixel art con proyección isométrica, estilo Habbo.
Juego web hecho con **Phaser 3 + TypeScript + Vite**.

## Requisitos

- Node.js 20+ (`node -v`)

## Puesta en marcha

```bash
npm install
npm run dev      # → http://localhost:5173
```

Otros comandos:

```bash
npm run build    # compilación de producción en dist/
npm run preview  # previsualizar el build
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
- [ ] Futuro — multijugador (Node + Socket.io), salas múltiples, inventario

## Arquitectura

```
src/
├── main.ts              # configuración del juego
├── scenes/
│   └── MainScene.ts     # render + entrada + chat + guardado
├── state/
│   └── avatarState.ts   # LÓGICA PURA del avatar (sin Phaser)
├── entities/
│   ├── avatar.ts        # spritesheet y animaciones del personaje
│   └── furniture.ts     # sofá, mesa...
├── utils/
│   ├── iso.ts           # proyección isométrica 2:1
│   ├── pathfinding.ts   # A* (8 direcciones, octile)
│   └── storage.ts       # guardado en localStorage
└── tools/
    └── genassets.mjs    # genera tileset.png y room1.json
```

- `AvatarState` es un módulo **sin dependencias de Phaser**: recibe órdenes
  (`keyboardMove`, `startPath`, `tick`) y devuelve posición/orientación.
  Es el candidato natural a ejecutarse **en el servidor** cuando haya online.
- Guardado automático cada 5 s y al cerrar la pestaña (`localStorage`,
  clave `roomie:save`). Si la celda guardada quedó bloqueada (p. ej.
  sentado en el sofá), se busca la celda libre más cercana.

## Assets y mapas

- `tools/genassets.mjs` regenera el tileset y `room1.json`:
  `node tools/genassets.mjs`
- `public/assets/room1.json` es un mapa de **Tiled** (isométrico 12×12):
  ábrelo con el editor Tiled para modificarlo. La capa `colisiones`
  (oculta) marca las celdas bloqueadas y la capa `objetos` coloca el
  mobiliario mediante las propiedades enteras `col` y `row` de cada objeto
  (tipo `sofa` o `mesa`).
- Las paredes traseras se generan en código sobre la fila 0 y la columna 0.
