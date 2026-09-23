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

```
src/
├── main.ts              # configuración del juego
├── scenes/
│   └── MainScene.ts     # escena principal (sala de prueba)
└── utils/
    └── iso.ts           # proyección isométrica 2:1 (cuadrícula ↔ pantalla)
```

## Roadmap

- [x] Fase 0 — proyecto Vite + TS + Phaser, primera escena
- [ ] Fase 1 — proyección isométrica, panorama de sala y cámara
- [ ] Fase 2 — avatar con animaciones + colisiones con tilemap (Tiled)
- [ ] Fase 3 — sala real con mobiliario y límites
- [ ] Fase 4 — interacciones (sentarse, burbuja de chat, personalización)
- [ ] Fase 5 — guardado (localStorage) y arquitectura lista para online
- [ ] Futuro — múltiples salas, inventario, multijugador (Node + Socket.io)
