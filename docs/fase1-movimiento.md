# Fase 1 — Sensación del movimiento multijugador

**Fecha:** 24 de septiembre de 2026
**Rama:** `fase1-movimiento` · **Punto de retorno:** tag `fase1-base` (= `f8377f6`)
**Alcance:** sólo sincronización. No se tocó UI, React, assets, sistema de avatar ni el protocolo de red.

## Problema

Con varios jugadores conectados, al caminar el avatar se movía bien en local
pero **al detenerse volvía a una posición anterior**, y los avatares remotos se
veían robóticos.

## Causa raíz (medida, no supuesta)

El servidor simulaba con un `dt` **nominal**: `setInterval(50)` avanzando 50 ms
de movimiento por disparo. Pero un temporizador nunca dispara puntual — en
Windows la resolución del reloj es de 15.625 ms, así que `setInterval(50)`
salta cada ~62.5 ms.

```
Medido en el código anterior:
  Tick real del servidor : 63.7 ms  (nominal 50.00)
  Velocidad simulada     : 78.4 % del tiempo real
```

**El avatar autoritativo caminaba un 21% más lento que el que veías.** La
diferencia crecía de forma lineal mientras caminabas; al detenerte, el servidor
terminaba de recorrer lo que le faltaba y el reconciliador (que saltaba cada
2 s si la diferencia pasaba de 1 celda) te plantaba en su posición. Eso era el
rubber banding.

Con 1 y con 4 jugadores el déficit era idéntico: **no dependía de la carga**,
dependía del reloj. Con más jugadores simplemente se nota más, porque además de
tu salto ves los de los demás.

## Cambios

### 1. `server/src/index.ts` — bucle de simulación con tiempo real acumulado

El temporizador pasa a despertar cada 16 ms y sólo **acumula tiempo real**; la
simulación consume ese tiempo en pasos exactos de `TICK_MS`. El ritmo de la
física deja de depender de la puntualidad del temporizador o del sistema
operativo.

- `MAX_CATCHUP_STEPS = 5`: si el proceso se congela, no se recupera todo el
  atraso de golpe (sería un tirón visible para todos). El resto se descarta.
- El snapshot se emite sólo cuando hubo al menos un paso, así sigue saliendo a
  ~20 Hz de media aunque el planificador despierte a ~60 Hz.

### 2. `src/scenes/MainScene.ts` — `reconcile()`: corrección suave, sin teleport

El salto duro desaparece. Ahora:

| | Antes | Ahora |
|---|---|---|
| Frecuencia | cada 2 s | cada frame |
| Umbral | > 1 celda | zona muerta de 0.35 celdas |
| Acción | teletransporte | arrastre exponencial (~1/4 s) |
| Teletransporte | siempre que pasara de 1 celda | sólo por encima de 3 celdas |

La **zona muerta** es la clave: sin números de secuencia en la entrada (eso es
Fase 5), el servidor va siempre un poco por detrás porque tu entrada tarda en
llegarle. Ese desfase es normal y corregirlo continuamente te frenaría. Un
tercio de baldosa es invisible y no se toca.

El arrastre **no salta muros**: comprueba la celda destino antes de aplicarse.

La corrección se ejecuta **antes** de procesar la entrada, a propósito: si
ocurriera después, entraría en el cálculo de `moving`/`facing` y una corrección
estando quieto te haría girar y animar como si caminaras.

### 3. `src/scenes/MainScene.ts` — buffer de snapshots para los remotos

Antes los remotos perseguían el último snapshot con un suavizado exponencial
(`peer.col += (v.col - peer.col) * k`). Eso nunca alcanza el blanco: va
permanentemente retrasado y convierte cualquier irregularidad de red en un
cambio de velocidad visible.

Ahora se guarda ~1 s de historia (20 snapshots) y se dibuja a **`ahora - 100 ms`**,
interpolando entre los dos snapshots que rodean ese instante. No se extrapola:
si el buffer se queda seco, el remoto se congela en su última posición conocida
en vez de inventar una que luego habría que desmentir.

El snapshot nuevo manda en todo lo discreto (quién está, hacia dónde mira, si
está sentado); sólo la posición se mezcla.

### 4. `src/scenes/MainScene.ts` — animación de remotos desde el servidor

`v.moving` y `v.facing` ya venían en cada snapshot pero no se usaban: el
walk/idle se deducía del desplazamiento en píxeles entre frames. Con un
suavizado ese delta nunca llega a cero exacto, así que el remoto **parpadeaba**
entre caminar y estar quieto. Ahora la animación la decide el servidor.

El avatar **local** sigue con animación predicha: usar los valores del servidor
para tu propio muñeco le metería la latencia a tu propia animación.

### Extra

`onPlayers` ahora comprueba `this.alive` antes de tocar la escena. Sin eso, un
snapshot que llegue durante el reinicio por cruce de puerta escribe sobre
objetos ya destruidos.

## Resultados

### Deriva predicción ↔ autoridad

Medición: bots recorriendo la sala de ida y vuelta con paradas, 10 s, deriva
física sin corrección aplicada (es lo que la Fase 1 debe reducir).

| Jugadores | | Tick servidor | Velocidad | Deriva media | Deriva máx | Tiempo sobre el umbral de teleport |
|---|---|---|---|---|---|---|
| 1 | antes | 64.00 ms | 78.1 % | 0.888 | 1.889 | **45.4 %** |
| 1 | después | **49.95 ms** | **100.1 %** | **0.374** | **0.748** | **0.0 %** |
| 2 | antes | 63.93 ms | 78.2 % | 0.806 | 1.815 | **39.8 %** |
| 2 | después | **49.89 ms** | **100.2 %** | **0.240** | **0.653** | **0.0 %** |
| 4 | antes | 63.68 ms | 78.5 % | 0.848 | 1.886 | **41.2 %** |
| 4 | después | **49.95 ms** | **100.1 %** | **0.240** | **0.658** | **0.0 %** |

**El snap-back desaparece por completo.** Nunca se alcanza el umbral que lo
provocaba, y lo que queda de deriva lo absorbe el arrastre suave.

### Buffer de interpolación

Medición: un observador quieto mirando a N remotos en movimiento, 12 s,
replicando el algoritmo real de `interpolatedViews()`.

| Remotos | Huecos p50/p95/p99 | Buffer seco | Frames interpolando | Cambios walk/idle |
|---|---|---|---|---|
| 1 | 47.7 / 64.0 / 79.3 ms | **0.00 %** | 100 % | 12 (= los reales) |
| 2 | 47.8 / 64.0 / 78.9 ms | **0.00 %** | 100 % | 12 (= los reales) |
| 4 | 47.7 / 63.9 / 79.6 ms | **0.00 %** | 100 % | 12 (= los reales) |

El patrón de prueba tiene exactamente 12 arranques/paradas en 12 s, y se
cuentan 12 cambios de animación: **cero parpadeos**. El margen del retraso de
render (100 ms) frente al peor hueco observado (80 ms) es de 20 ms.

### Regresión

- `npm run typecheck` — limpio (cliente y servidor).
- `npm run build` — correcto.
- `node tools/smoke-multiplayer.mjs` — **20/20 en verde**, antes y después.

## Residuo conocido (para la Fase 5)

La interpolación usa la **hora de llegada** de cada snapshot, no la hora de
simulación. Los huecos de llegada varían (mínimo observado 30.7 ms, mediana
48 ms) aunque cada snapshot represente siempre un paso de 50 ms. Cuando un
snapshot llega comprimido, ese tramo se reproduce hasta **1.6× más rápido**
durante ~30 ms.

Es pequeño y acotado, e incomparablemente mejor que el 21% de error sistemático
de antes, pero es la razón por la que queda algo de temblor residual.

**El arreglo correcto es interpolar sobre tiempo de simulación**, lo que exige
añadir un sello de tiempo del servidor al snapshot — un cambio de protocolo, y
por eso queda fuera de esta fase. Es el primer candidato de la Fase 5, junto
con los números de secuencia de entrada.

Otro punto pendiente: el teletransporte por encima de 3 celdas no sincroniza el
estado `sitting`. Es el mismo comportamiento que antes (no es una regresión) y
sólo se da en divergencias reales.

## Rollback

```bash
# Descartar la fase entera
git checkout master

# O volver al punto exacto de partida estando en la rama
git reset --hard fase1-base

# Revertir sólo el cliente, manteniendo el arreglo del servidor
git revert <commit del cliente>
```

Los cambios de `MainScene.ts` (corrección, buffer y animación) van en un solo
commit **a propósito**: son interdependientes — el reordenado de `update()` lo
exige la corrección, y la animación desde el servidor depende del buffer.
Separarlos daría commits intermedios que no funcionan.
