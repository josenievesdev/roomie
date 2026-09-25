# Roomie — estado actual y qué viene

**Última actualización:** 24 de septiembre de 2026
**Rama de trabajo:** `fix/hud-count-modal-veil` · **Base estable:** `master`

Este documento es el punto de entrada. Los `docs/fase*.md` son el detalle de
cada tanda, con la causa raíz de cada fallo y cómo se verificó.

---

## Dónde está el proyecto

Roomie es jugable: entras con tu cuenta, te mueves por dos salas decoradas,
hablas por chat, saludas a otros avatares con emojis y tu aspecto te sigue
entre sesiones. Todo eso va contra un servidor autoritativo y una base de datos
Postgres real en Supabase.

Lo que **no** existe todavía: tienda, inventario visible, salas propias,
trabajos ni economía. Las tablas están y probadas, pero sin interfaz.

## Arquitectura

```
Navegador (Phaser 3 + TS + Vite)
  · predice su movimiento, dibuja a los demás interpolados
  · NUNCA habla con la base de datos
        │ socket.io (proxy /socket.io de Vite → :3001)
        ▼
Servidor (Node 24 + socket.io) — la autoridad
  · simula a todos con AvatarState en pasos fijos de 50 ms
  · decide posiciones, colisiones, nombre y dinero
        │ postgres.js (conexión directa, nada de PostgREST)
        ▼
Postgres (Supabase, us-east-1)
```

**Módulos puros compartidos** (`src/state/`, `src/utils/`, `src/net/protocol.ts`):
sin Phaser, los carga el servidor tal cual. Es lo que permite que cliente y
servidor ejecuten exactamente la misma física y las mismas reglas de colisión.

## Qué funciona, y cómo se comprobó

| | Verificado con |
|---|---|
| Movimiento multijugador sin tirones | medición de deriva con 1/2/4 jugadores |
| Interpolación de avatares remotos | buffer a 100 ms, 0% de cortes en 12 s |
| Cuentas, login, sesiones persistentes | navegador real + `db:check` |
| Dinero con libro mayor auditable | `db:check` intenta dejarlo en negativo |
| Objetos que no se duplican | cada mueble es una fila con id propio |
| Chat con panel de historial | navegador real |
| Menú al tocar a otro avatar | mensaje recibido por el otro jugador |
| Teclado en móvil | `<input>` reales; probado por el usuario con un amigo |
| Dos salas con identidad visual propia | capturas en navegador |

## Las decisiones que no hay que deshacer

**El servidor simula con tiempo real acumulado, no con un `dt` nominal.**
Antes avanzaba 50 ms por disparo de `setInterval(50)`, que en Windows salta
cada ~64 ms: el avatar autoritativo iba un 21% más lento que el que veías y la
reconciliación te devolvía atrás. Ese era el rubber banding.

**La corrección de posición arrastra, no teletransporta,** y tiene una zona
muerta de 0.35 celdas. Sin números de secuencia en la entrada (eso sería la
fase siguiente), el servidor va siempre un poco por detrás; corregir ese
desfase constante frenaría al jugador.

**El dinero es un libro mayor append-only.** El saldo es una caché que sólo se
toca dentro de la misma transacción que su apunte, y un `check (amount >= 0)`
hace imposible quedarse en negativo sin depender de que el código se acuerde de
comprobarlo. Con un saldo mutable no se puede auditar y un fallo de
concurrencia imprime dinero en silencio.

**Un objeto está o en tu inventario o colocado en una sala, nunca a medias.**
Lo fuerza un `CHECK`, más un trigger que limpia las coordenadas si se queda sin
sala. Borrar una sala devuelve sus muebles al inventario en vez de destruirlos.

**El nombre sale de la cuenta.** Ya no viaja en `join`. Si algún evento vuelve
a llevar un campo `name` desde el cliente, se está deshaciendo esto.

**Bandas de profundidad con nombre** (`src/render/layers.ts`) en vez de números
a ojo. El bug que lo motivó: el modal estaba en `1e5` y todo el HUD en `1e6`,
así que las burbujas de chat de los avatares flotaban por encima del modal.

## Base de datos

Siete tablas más sesiones. Pocas y con los invariantes correctos, en vez de
muchas preparadas para funciones que no existen.

```
accounts ─┬─ avatars (nickname, look)
          ├─ sessions (token HASHEADO, caducidad)
          ├─ balances (caché)  ←→  ledger (append-only, la verdad)
          ├─ items (uno por mueble; en inventario o colocado)
          └─ rooms (owner NULL = pública)
catalog_items (la tienda)        login_attempts (freno a fuerza bruta)
```

Migraciones en `db/migrations/*.sql`, se aplican con
`npm --prefix server run db:migrate` y quedan anotadas en `_migrations`.

**Credenciales:** `server/.env`, ignorado por git. Nunca en el código.

**Despliegue:** la base está en `us-east-1`; el servidor de juego debe ir en la
misma región (Fly.io `iad`, Railway `us-east`). El cliente es estático y puede
ir a Cloudflare Pages, pero **Workers no puede alojar el servidor**: es un
proceso vivo con bucle a 20 Hz y WebSockets abiertos.

## Qué viene, por orden

**1. Tienda e inventario (siguiente).** Las tablas están y probadas; falta la
interfaz: un catálogo donde gastar las monedas y un inventario donde ver lo
comprado. Es lo que da sentido al saldo.

**2. Colocar muebles en una sala.** `items.room_id/col/row/stack` ya lo
soporta, incluido apilar (alfombra debajo, sofá encima). Falta el modo de
edición en el cliente y que el servidor valide la celda.

**3. Salas como datos.** Hoy `ROOMS = ["room1","room2"]` está escrito en el
código. Para tener plazas, centros comerciales y discotecas, crear una sala
tiene que ser una fila en `rooms`, no un cambio de código. La tabla ya existe.

**4. Salas propias.** Que cada cuenta tenga la suya y pueda decorarla. Es lo
que enganchó a la gente en Habbo: no trabajar, sino tener algo tuyo que
enseñar.

**5. Y entonces sí, trabajos y economía.** Con cuentas, saldo, objetos y salas
propias, "atender la barra y cobrar" es una capa fina encima. Antes no tiene
dónde apoyarse.

## Deuda conocida

- **El avatar es el placeholder de la Fase 0**: 16×24 escalado ×2 con tres
  direcciones. Para el detalle tipo Habbo (ocho direcciones, partes por capas,
  accesorios) hay que rehacerlo. Es un trabajo grande de arte.
- **No hay mobiliario de pared** (cuadros, televisores, ventanas). El catálogo
  ya tiene el campo `kind: 'floor' | 'wall'` preparado.
- **El lienzo es 960×540 fijo con `Scale.FIT`**: en un móvil en vertical queda
  una franja pequeña. Falta diseño adaptable.
- **La interpolación usa la hora de llegada**, no la de simulación, así que
  queda un temblor residual acotado. Arreglarlo pide un sello de tiempo en el
  snapshot: cambio de protocolo.
- **Cambiar el nickname una vez dentro** no llega al servidor: el nombre
  tendría que viajar en `room` o en un evento propio.
- **Las cuentas `sk...` de la base son del smoke test.** Cada ejecución crea
  las suyas con sufijo único. Para limpiarlas:
  `delete from accounts where username like 'sk%';`

## Historial por tandas

| Documento | Qué resolvió |
|---|---|
| `fase1-movimiento.md` | El rubber banding. Causa medida, no supuesta |
| `fase2-ui.md` | Borrado del nickname, listeners acumulados, teclado en conflicto |
| `fase2-5-ui-layer.md` | Separación de capas World/UI |
| `fase2-6-hud-velo.md` | Contador que se sumaba a sí mismo; preview fuera de pantalla |
| `fase2-7-teclado-movil.md` | `<input>` reales; el "Huésped" irreversible |
| `fase2-8-chat-y-menu-avatar.md` | El botón de chat se cerraba solo; menú de avatar |
| `fase2-9-panel-chat.md` | Panel de chat con historial |
| `fase2-10-pasada-visual.md` | Pixel art de verdad; una identidad por sala |
| `fase2-11-decoracion.md` | Catálogo de mobiliario compartido |
| `fase3-login-real.md` | Cuentas, sesiones y la identidad en el servidor |

`reporte-proyecto.md` es anterior a todo esto y está desfasado; se conserva
como historia.
