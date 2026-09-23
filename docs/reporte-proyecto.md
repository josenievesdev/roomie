# Roomie — Reporte del proyecto

**Fecha del reporte:** 23 de septiembre de 2026
**Estado:** Fase 6 completada + ronda de correcciones. Single-player jugable y estable.
**Repositorio:** https://github.com/josenievesdev/roomie (rama `master`, 10 commits)
**Último commit:** `cf8a1a2`

---

## 1. ¿Qué es Roomie?

Un juego estilo **Habbo Hotel**: mundo abierto 2D en **pixel art** con **proyección isométrica 2:1**, pensado desde el inicio para convirtirse en un juego multijugador online. Empezó como proyecto nuevo (cero líneas previas) y avanza por fases.

Objetivos del planteamiento inicial:

- Mundo abierto con salas, muebles y navegación por clic.
- Avatar personalizable con chat.
- **Primero single-player; multijugador después, sin reescribir la base.**
- Arte inicial 100 % *placeholder* generado por código; mapas hechos en **Tiled**.

## 2. Stack y decisiones técnicas

| Decisión | Valor elegido | Motivo |
|---|---|---|
| Motor | **Phaser 3** | 2D maduro, ligero, buen soporte WebGL/Canvas |
| Lenguaje | **TypeScript** (strict) | Seguridad de tipos; validado con `tsc --noEmit` en cada fase |
| Bundler | **Vite** | Dev server instantáneo + build rápido |
| Proyección | **Isométrica 2:1**, rombos de **64×32** | Estética Habbo |
| Mapas | **Tiled** (formato JSON), v1.12.2 | Estándar del sector, editable visualmente |
| Arte | Generado por código (`Graphics` → textura) | Sin dependencias externas; recoloreable en caliente |
| Guardado | `localStorage` (`roomie:save`) | Sin servidor por ahora; interfaz aislada en `src/utils/storage.ts` |
| Runtime | Node v24.21.0 · Git 2.55.0.3 | — |

**Decisión de arquitectura clave:** toda la lógica de movimiento/estado del avatar vive en
`src/state/avatarState.ts`, un módulo **puro sin Phaser**. El servidor futuro podrá ejecutar
ese mismo módulo sin tocar el render → el multijugador no exige reescritura.

## 3. Qué se hizo (historial por fases)

| Commit | Fase | Contenido |
|---|---|---|
| `6e847b4` | **0** | Proyecto Vite + TS + Phaser, primera escena, git init |
| `a81350c` | **2** | Avatar placeholder animado (4 frames × 3 direcciones + pose `sit`), tileset y mapa `room1.json` (12×12) generados por `tools/genassets.mjs`, colisiones con anillo exterior |
| `caff436` | **2b** | Clic para caminar con pathfinding **A\*** (8 direcciones, heurística octile, sin cortar esquinas) + marcador de destino |
| `d8ea669` | **3** | Paredes isométricas traseras (fila 0 / col 0) con zócalo, sofá y mesa cargados desde la capa `objetos` de Tiled |
| `148e0d8` | **4** | Sentarse en el sofá (A\* con `allowBlockedGoal`, pose `sit-0`), burbuja de chat local (Enter/Esc), movimiento congelado al escribir |
| `601d7e9` | **5** | Estado extraído a módulo puro (`AvatarState`), guardado en localStorage (cada 5 s + `beforeunload`), celda bloqueada → libre más cercana |
| `a8a515d` | **—** | Personalización: panel de ropa y pelo (tecla **C**), 6 + 6 colores, paleta guardada |
| `c1a3ee3` | **6** | **Múltiples salas con puertas**: `room1` (12×12) ↔ `room2` (14×10), fade de transición, HUD con id de sala |
| `cbb2162` | **fix** | Profundidad del avatar al parar, evento de fade, centrado de cámara, avatar ×2 |
| `cf8a1a2` | **fix** | Pantalla negra al cruzar (anims con frames destruidos), nitidez del render, sync animación/velocidad |

## 4. Bugs importantes que se encontraron y su causa raíz

Estas son las incidencias no obvias que se resolvieron (apuntes para no volver a tropezar):

1. **Solo se veía la cabeza del avatar al parar**
   La `depth` usaba la posición *fraccionaria* del avatar. Al parar a mitad de celda
   (WASD o clic que cancela el camino), el suelo de la celda contenedora se dibujaba
   encima del cuerpo. **Fix:** profundidad calculada desde la celda redondeada + sesgo `+0.5`.

2. **Pantalla negra al cruzar puertas (1.º intento: evento mal nombrado)**
   Se escuchaba `"fadeoutcomplete"`; el nombre real en Phaser 3 es
   **`camerafadeoutcomplete`** (`Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE`).
   El reinicio nunca se ejecutaba y el guardado periódico sobrescribía la sala destino.

3. **Pantalla negra al cruzar puertas (2.ª causa, la verdadera)**
   Las animaciones guardan **referencias directas** a los `Frame` de la textura.
   `textures.remove("avatar")` destruye esos frames (`texture: null, source: null`);
   al regenerar la textura las animaciones viejas **no se recreaban** (las saltaba un
   `if (!anims.exists)`) → `play()` aplicaba frames muertos → la renderización revienta
   y queda el último fotograma del fade (negro). El F5 funcionaba porque no había
   animaciones viejas. **Fix:** destruir y recrear las animaciones **siempre** junto con
   la textura + respaldo `delayedCall(500 ms)` idempotente.

4. **La sala quedaba pegada arriba a la izquierda**
   Los `setBounds` de la sala (768×384) eran menores que la ventana (960×540) y el
   `Clamp` de Phaser ancla al mínimo → sala clavada en la esquina con negro alrededor.
   **Fix:** límites expandidos al menos al tamaño de la vista, centrados en la sala, + `centerOn`.

5. **Avatar "borroso, colores que se mezclan, se corta al caminar"** — combinación de:
   - Filtro de textura: se forzó `setFilter(FilterMode.NEAREST)` en avatar y tileset
     (el muestreo lineal mezcla texels vecinos al escalar ×2).
   - Escala CSS fraccionaria de `Scale.FIT`: añadido `Scale.autoRound` +
     `image-rendering: pixelated` en el canvas.
   - **Animación desincronizada**: 4,5 celdas/s con walk a 8 fps → las patas deslizaban.
     Ahora `PATH_SPEED = 3` celdas/s con walk a **12 fps** (sync exacto: 3 × 4 frames).

## 5. Estado actual (qué funciona hoy)

- ✅ Isométrico 2:1 con render ordenado por profundidad (piso, paredes, muebles, avatar).
- ✅ Avatar animado (idle/caminar/sentar) con 3 direcciones, recoloreable en caliente.
- ✅ Movimiento por **clic con A\*** y por **WASD/flechas**; colisiones por celda.
- ✅ Sentarse en el sofá (y levantarse con un segundo clic).
- ✅ Chat local con burbuja sobre el avatar (Enter → escribir → Enter envía; Esc cancela).
- ✅ Personalización de ropa y pelo (tecla **C**), persistida.
- ✅ Guardado automático cada 5 s + al cerrar la pestaña (posición, sala, facing, paleta).
- ✅ **Dos salas conectadas por puertas** con transición fade.
- ✅ Compilación limpia (`npx tsc --noEmit`), repo en GitHub.

**No hay nada de red:** cada navegador juega aislado. `npm run dev` solo escucha en `localhost`.

## 6. Estructura del código

```
roomie/
├── index.html              # Casco HTML + CSS de pixel art nítido
├── src/
│   ├── main.ts             # Config del juego Phaser (960×540, pixelArt, FIT)
│   ├── scenes/
│   │   └── MainScene.ts    # Escena única: render, entrada, puertas, chat, guardado
│   ├── entities/
│   │   ├── avatar.ts       # Textura del avatar generada por código + animaciones
│   │   └── furniture.ts    # Sofá y mesa (Graphics isométricos)
│   ├── state/
│   │   ├── avatarState.ts  # ★ Módulo PURO sin Phaser (base para el servidor)
│   │   └── palette.ts      # Paleta de ropa/pelo (puro)
│   └── utils/
│       ├── iso.ts          # toScreen / toGrid, TILE_W/H
│       ├── pathfinding.ts  # A* (8 dirs, octile, allowBlockedGoal)
│       └── storage.ts      # localStorage con validación de versión
├── tools/
│   └── genassets.mjs       # Genera tileset.png + room1.json + room2.json
├── public/assets/          # tileset.png, room1.json, room2.json
└── docs/                   # Este reporte
```

**Convención:** `src/state/` y `src/utils/` son **puros** (sin Phaser) → el servidor
podrá importarlos tal cual. Phaser solo vive en `scenes/`, `entities/` y `main.ts`.

## 7. Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Dev server → http://localhost:5173 |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build de producción |
| `npx tsc --noEmit` | Verifica tipos sin compilar |
| `node tools/genassets.mjs` | Regenera tileset y mapas (si cambias `genassets.mjs`) |
| `git push` | Sube cambios (tracking ya configurado con `origin`) |

## 8. Qué falta (roadmap)

### Siguiente fase candidata: **multijugador online** (la apuesta original)
La base ya está preparada (`AvatarState` puro). Pasos previstos:

1. Servidor **Node + Socket.io** ejecutando `AvatarState` de forma autoritativa.
2. Salas compartidas: ver a los demás avatar moverse en tiempo real + chat global.
3. Matchmaking básico por sala (reutilizando las `room1`/`room2` existentes).
4. Despliegue: primero `vite --host` para probar en la red local; después
   hosting (Railway/Fly/VPS) para acceso por internet.

### Pulir (posterior o paralelo)
- Más mobiliario y decoración (lámparas, alfombras, cuadros, plantas).
- Sombra bajo el avatar; variaciones de sala (más plantas/habitaciones).
- Sonidos (pasos, puertas, chat).
- Zoom de cámara y animaciones de transición más suaves.
- Cámara: considerar *deadzone* para menos movimiento con el avatar.

### Calidad / infra
- Tests unitarios formales de `pathfinding` y `avatarState` (hoy se probaban ad hoc en Node).
- CI (GitHub Actions: `tsc` + tests en cada push).
- Decide rama `master` → `main` si se quiere el estándar de GitHub.

## 9. Notas para retomar el trabajo

- **Git en esta máquina:** el ejecutable puede no estar en el PATH de sesiones nuevas;
  se usó la ruta completa `& "C:\Program Files\Git\cmd\git.exe" ...`
  (identidad global: `Roomie Dev <roomie@local>`).
- **Verificación visual:** el navegador de escritorio no siempre está conectado a la
  sesión del agente; para depurar en vivo habilitar la conexión de navegador experimental
  en la app de escritorio, o pedir una captura al usuario.
- **Tests rápidos de lógica pura** (desde la raíz del proyecto):
  `node --input-type=module -e "import { ... } from './src/....ts'"` (los imports de
  valores llevan extensión `.ts`; `allowImportingTsExtensions` está activo).
- **Errores recurrentes de este proyecto:** escuchar eventos de cámara con el nombre
  equivocado (`fadeoutcomplete` vs `camerafadeoutcomplete`); usar `Phaser.GameObjects.Sprite`
  (no `Phaser.Sprite`); destruir texturas sin recrear las animaciones que las referencian.
- **Sincronización caminata:** si se toca `PATH_SPEED` o `KEYBOARD_SPEED`, ajustar el
  `frameRate` del walk en `avatar.ts` (regla: `frameRate = PATH_SPEED × 4`).
