# Roomie — Reporte del proyecto

**Fecha del reporte:** 24 de septiembre de 2026
**Estado:** Fase 7 completada. Single-player jugable y estable + **multijugador en tiempo real** (red local / mismo host).
**Repositorio:** https://github.com/josenievesdev/roomie (rama `master`, 11 commits)
**Último commit:** `7f53c92` (docs); la Fase 7 está pendiente de commit

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
| Red | **Socket.io** (`server/`, puerto 3001) | Tiempo real bidireccional; proxy de Vite en `/socket.io` |
| Runtime | Node v24.21.0 · Git 2.55.0.3 | Node 24 corre los `.ts` del servidor sin build |

**Decisión de arquitectura clave (cumplida en la Fase 7):** toda la lógica de
movimiento/estado del avatar vive en `src/state/avatarState.ts`, un módulo **puro
sin Phaser**. **El servidor la ejecuta tal cual** (`server/src/index.ts`) en un
tick fijo: misma física, mismas colisiones, sin reescribir el render. El cliente
sólo *predice* localmente y dibuja a los demás con lo que llega de la red.

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
| `7f53c92` | **docs** | Este reporte |
| _(pendiente)_ | **7** | **Multijugador**: servidor Node + Socket.io (`server/`) con `AvatarState` autoritativo a 20 Hz, avatares remotos interpolados con su propia paleta, chat de sala con avisos de sistema, validación de entradas, proxy de Vite y smoke test E2E |

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

### Fase 7 (multijugador) — aprendizajes nuevos

6. **Una textura/animación compartida por todos los avatares no sirve online**:
   cada jugador tiene su propia paleta, así que `createAvatarTexture` ahora
   acepta una **clave** (`avatar` para el local, `avatar:<id>` para cada remoto)
   y registra las animaciones con prefijo `${clave}:`. Regla mantenida: la
   textura y sus animaciones se destruyen y recrean **siempre** juntas
   (el bug de la pantalla negra aplica a cada clave).

7. **Todo lo que llega por la red hay que validarlo**: el servidor comprueba
   que el camino empieza **junto al avatar** (si no, un cliente manipulado se
   teletransportaba), saltos de 8 vecinos, celdas dentro de la sala y que la
   última celda sólo esté bloqueada si es sofá o puerta. Además, la entrada de
   teclado se corta a los 1 s sin refuerzo (pestaña congelada = avatar fantasma).

8. **`node --watch` del servidor se reinicia si cambia `node_modules`**
   (p. ej. al instalar un paquete): el log muestra `Restarting` inofensivo.

9. **El smoke test choca con el mobiliario**: el avatar avanza en diagonal en
   la cuícula (p. ej. `move(1,0)` = `col+ row-`), así que desde (6,6) acaba en
   la celda de la **mesa (7,5)** y se queda contra ella. *Es el comportamiento
   correcto* (colisión bien aplicada), pero hay que elegir bien la dirección al
   medir avance en un test.

## 5. Estado actual (qué funciona hoy)

- ✅ Isométrico 2:1 con render ordenado por profundidad (piso, paredes, muebles, avatar).
- ✅ Avatar animado (idle/caminar/sentar) con 3 direcciones, recoloreable en caliente.
- ✅ Movimiento por **clic con A\*** y por **WASD/flechas**; colisiones por celda.
- ✅ Sentarse en el sofá (y levantarse con un segundo clic).
- ✅ Chat local con burbuja sobre el avatar (Enter → escribir → Enter envía; Esc cancela).
- ✅ Personalización de ropa y pelo (tecla **C**), persistida.
- ✅ Guardado automático cada 5 s + al cerrar la pestaña (posición, sala, facing, paleta).
- ✅ **Dos salas conectadas por puertas** con transición fade.
- ✅ **Multijugador**: servidor `server/` (Node + Socket.io) que ejecuta
  `AvatarState` de forma **autoritativa** (tick de 50 ms, snapshots a 20 Hz).
- ✅ **Se ven los demás avatares** moverse en tiempo real, con su nombre, su
  paleta propia e interpolación suave (caminar y sentarse incluidos).
- ✅ **Chat de sala** por servidor: buruja sobre quien habla + avisos
  "entró/salió" en la esquina, anti-spam de 400 ms y nombres desduplicados.
- ✅ El cliente **predice en local** (movimiento instantáneo) y cada 2 s
  corrige su posición si se desvía más de 1 celda de lo que dice el servidor.
- ✅ **Single-player intacto**: sin servidor todo funciona como antes (HUD
  "○ Sin servidor — single-player") y se reconecta solo si aparece uno.
- ✅ Compilación limpia cliente + servidor (`npm run typecheck`), build de
  producción correcto y **smoke test E2E en verde (20 comprobaciones)**.

**Cómo se prueba hoy:** `npm run dev:server` + `npm run dev` y **dos pestañas**
en http://localhost:5173 (o dos ordenadores con `npm run dev -- --host`).

## 6. Estructura del código

```
roomie/
├── index.html              # Casco HTML + CSS de pixel art nítido
├── vite.config.ts          # Proxy /socket.io → :3001 (dev y preview)
├── src/
│   ├── main.ts             # Config del juego Phaser (960×540, pixelArt, FIT)
│   ├── scenes/
│   │   └── MainScene.ts    # Escena única: render, entrada, puertas, chat,
│   │                       #   guardado, avatares remotos y reconciliación
│   ├── entities/
│   │   ├── avatar.ts       # Textura por avatar (`avatar`, `avatar:<id>`) + anims
│   │   └── furniture.ts    # Sofá y mesa (Graphics isométricos)
│   ├── state/
│   │   ├── avatarState.ts  # ★ Módulo PURO sin Phaser (lo ejecuta el SERVIDOR)
│   │   └── palette.ts      # Paleta de ropa/pelo (puro)
│   ├── net/
│   │   ├── protocol.ts     # ★ Eventos/tipos compartidos cliente ↔ servidor (puro)
│   │   └── client.ts       # Cliente socket.io (sin Phaser; sobrevive a restarts)
│   └── utils/
│       ├── iso.ts          # toScreen / toGrid, TILE_W/H
│       ├── pathfinding.ts  # A* (8 dirs, octile, allowBlockedGoal)
│       └── storage.ts      # localStorage con validación de versión
├── server/                 # Paquete Node aparte (su propio package.json)
│   ├── package.json        # socket.io; scripts dev/start (Node corre los .ts)
│   ├── tsconfig.json       # typecheck propio (reutiliza el tsc de la raíz)
│   └── src/
│       ├── index.ts        # Conexiones + validación + simulación 20 Hz + chat
│       └── world.ts        # Lee los JSON de Tiled → colisiones/puertas/sofás
├── tools/
│   ├── genassets.mjs       # Genera tileset.png + room1.json + room2.json
│   └── smoke-multiplayer.mjs  # Smoke test E2E (2 clientes reales, 20 checks)
├── public/assets/          # tileset.png, room1.json, room2.json
└── docs/                   # Este reporte
```

**Convención:** `src/state/`, `src/utils/` y `src/net/protocol.ts` son **puros
(sin Phaser)** → el servidor los importa tal cual (`server/src/index.ts` los
carga con rutas `../../src/...ts`; Node 24 ejecuta el TypeScript directo).
Phaser sólo vive en `scenes/`, `entities/`, `net/client.ts` y `main.ts`.

**Protocolo (Fase 7):**

| Sentido | Eventos |
|---|---|
| cliente → servidor | `join`, `move(mx,my)`, `path(celdas)`, `stand`, `look`, `room`, `chat` |
| servidor → cliente | `welcome(id, jugadores)`, `players` (snapshot 20 Hz por sala), `chat` (mensajes + sistema) |

## 7. Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Cliente → http://localhost:5173 |
| `npm run dev:server` | Servidor del juego → `:3001` (en otra terminal) |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build (con proxy de `/socket.io`) |
| `npm run typecheck` | `tsc` del cliente **y** del servidor |
| `node tools/smoke-multiplayer.mjs` | Smoke test E2E del multijugador (servidor arriba) |
| `node tools/genassets.mjs` | Regenera tileset y mapas (si cambias `genassets.mjs`) |
| `npm --prefix server run ...` | Scripts del paquete servidor |
| `git push` | Sube cambios (tracking ya configurado con `origin`) |

## 8. Qué falta (roadmap)

### Siguiente fase candidata: **despliegue** (la apuesta original ya arrancó)
1. Red local: `npm run dev -- --host` → otros dispositivos entran por IP.
   El proxy de Vite ya enruta `/socket.io`, así que **no hay que tocar nada más**.
2. Hosting (Railway/Fly/VPS): subir el servidor (`npm --prefix server start`)
   y apuntar `GAME_SERVER` + el reverse proxy de `/socket.io` del cliente.
3. Estabilidad en WAN: medir con 4-6 jugadores reales (interpolación, lag).

### Multijugador — siguiente paso lógico
- **Matchmaking/selector de sala** (hoy todo entra a la sala del save).
- Presencia persistente (nombres propios, no `Huésped-###`), lista de jugadores.
- Poses compartidas: que el sofá ocupe sitio (dos avatares no en la misma celda).
- Chat con historial en pantalla y comandos (`/saludo`, etc.).

### Pulir (posterior o paralelo)
- Más mobiliario y decoración (lámparas, alfombras, cuadros, plantas).
- Sombra bajo el avatar; variaciones de sala (más plantas/habitaciones).
- Sonidos (pasos, puertas, chat).
- Zoom de cámara y animaciones de transición más suaves.
- Cámara: considerar *deadzone* para menos movimiento con el avatar.

### Calidad / infra
- Tests unitarios formales de `pathfinding` y `avatarState` (hoy: smoke test E2E).
- CI (GitHub Actions: `typecheck` + smoke test en cada push; necesita un servicio
  de servidor en el runner → `npm --prefix server ci & npm run dev:server &`).
- Decide rama `master` → `main` si se quiere el estándar de GitHub.
- Fijar versiones exactas de `socket.io`/`socket.io-client` en el lockfile.

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
  `KEYBOARD_SPEED` vive en **`src/net/protocol.ts`** porque la necesita el
  servidor: al cambiarla cambian cliente Y servidor a la vez (ese es el punto).
- **Dos procesos:** `npm run dev:server` (terminal 1) y `npm run dev` (terminal 2).
  El servidor corre con `node --watch`: **se reinicia solo** al guardar cualquier
  `.ts` de `server/src` (y también si cambia algo de `server/node_modules`, inofensivo);
  al reiniciar **pierde a todos los jugadores**, que se re-conectan solos.
- **Verificar el multijugador sin navegador del agente:** `node tools/smoke-multiplayer.mjs`
  (con el servidor arriba) reproduce 2 clientes reales y valida presencia,
  movimiento, colisiones, A*, sofá, chat, anti-spam, desconexión y cambios de sala.
- **Probar a mano:** dos pestañas en http://localhost:5173 → la segunda aparece
  con su nombre (si ambas comparten nombre, el servidor le añade " 2").
