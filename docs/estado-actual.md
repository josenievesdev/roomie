# Roomie — estado actual y qué viene

**Última actualización:** 27 de septiembre de 2026
**Rama de trabajo:** `feat/avatar-v2` (sale de `fix/hud-count-modal-veil`) · **Base estable:** `master`

Este documento es el punto de entrada. Los `docs/fase*.md` son el detalle de
cada tanda, con la causa raíz de cada fallo y cómo se verificó.

---

## Dónde está el proyecto

Roomie es jugable: entras con tu cuenta, te mueves por dos salas decoradas,
hablas por chat, saludas a otros avatares (y el tuyo agita la mano) y eliges tu
aspecto en un vestidor que te sigue entre sesiones. Todo eso va contra un
servidor autoritativo y una base de datos Postgres real en Supabase.

Desde la Fase 4 el avatar es de verdad: por capas (cuerpo, pelo, torso,
piernas, calzado), en 8 direcciones y a la misma escala que la sala, y cada
jugador ocupa su baldosa. En la Fase 5 los muebles pasaron a la misma técnica
3D (con el color del tema de cada sala), las paredes se llenaron de ventanas,
cuadros, apliques y neones, y la interfaz entera es pixel art con una fuente
propia. En la Fase 6 esa interfaz pasó a ser fina y propia (líneas de 1 px),
el teclado cruza puertas y se sienta, y hay zoom para mirar la sala de cerca.
En la Fase 7 llegó lo más importante, porque en Roomie jugarán niños y niñas:
la edad de cada cuenta (privada), el chat de frases para los niños, el filtro
de datos personales y groserías, y bloquear y reportar
(`docs/fase7-seguridad-menores.md`). Y en la Fase 8, la ciudad: la **Plaza de
la Llave**, primera zona de La Manzana y entrada del juego, con su monumento,
edificios, farolas, árboles y bancos; las dos salas son ahora edificios de la
plaza (`docs/fase8-plaza-de-la-llave.md`). En la Fase 9, **tu casa**: la
portería de la plaza da las llaves de un piso recién mudado (cama, armario y
cajas), sólo entra su dueño y al volver al juego apareces en él
(`docs/fase9-mi-primer-piso.md`). En la Fase 10, **la economía y decorar**:
dos monedas en el libro mayor, el premio del día, la tienda, la mochila,
vender por la mitad y poner, mover, girar y guardar muebles en tu casa con el
servidor validando cada celda; y **el móvil al 100 %**: el lienzo mide lo que
mide la pantalla, en vertical o en horizontal, con botones al alcance del
pulgar, pellizco para el zoom y todos los paneles adaptables
(`docs/fase10-economia-tienda-movil.md`). En la Fase 11, **caras y
peinados**: cinco formas de cara con el mismo cráneo, nueve ojos con ocho
colores, cejas, narices, bocas, pecas, rubor y barbas, doce tonos de piel,
diecinueve peinados y diecisiete colores de pelo; el vestidor rehecho y una
ficha de perfil de verdad, también para ver la de otros
(`docs/fase11-caras-y-peinados.md`).
Las reglas visuales que hacen que todo encaje están en
`docs/guia-de-estilo.md`.

Hacia dónde va el mundo (barrio, direcciones, transporte, economía, moda y
caras) está pensado en `docs/vision-mundo.md`.

Lo que **no** existe todavía: trabajos (la única forma de ganar monedas es el
premio del día y vender), visitas a otras casas, amigos ni comercio entre
jugadores.

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
| Avatar por capas, 8 direcciones, caminar/sentarse/saludar | vistas previas del generador + navegador |
| Vestidor: estilos y colores, guardado en la cuenta | navegador real + smoke test (aspecto) |
| Cada jugador en su baldosa (también en los asientos) | smoke test (convivencia) |
| Cambiar de destino andando sin tirones | smoke test (puente de caminos) |
| Muebles en 3D coloreados por el tema de la sala | vistas previas del generador + navegador |
| Paredes decoradas y luz de ambiente | navegador, en las dos salas |
| Interfaz pixel art con fuente propia | navegador (HUD, login, chat, vestidor, menús) |
| Interfaz fina de 1 px, iconos con pista | navegador |
| Teclado: entra en puertas y asientos | smoke test (5c, 5d) |
| Zoom ×1/×2/×3 con la interfaz a tamaño fijo | navegador (rueda, botones, arrastre) |
| Los niños hablan con frases y no leen texto libre | smoke test (4b) con un niño de 10 años + navegador |
| Fuera teléfonos, redes, correos y fotos; groserías tapadas | `tools/prueba-normas.mjs` + smoke test |
| Bloquear y reportar, con el contexto guardado | smoke test + `db:check` + navegador |
| Fecha de nacimiento al registrarse (y en las cuentas de antes) | smoke test + navegador |
| La Plaza de la Llave: entrada del juego, con puertas a las dos salas | smoke test (7b) + navegador |
| Tu casa: llaves una sola vez, piso recién mudado, sólo entra el dueño | smoke test (7c) + `db:check` + navegador |
| Muebles de varias celdas (la cama, 1×2) | smoke test + navegador |
| Dos monedas, premio del día, vender por la mitad | `db:check` (Economía) + smoke test (7d) |
| Tienda y mochila, con dos toques para comprar y vender | smoke test (7d) + navegador |
| Poner, mover, girar y guardar muebles; el fantasma verde o rojo | smoke test (7d) + `prueba-normas` + navegador |
| Pantalla de cualquier tamaño, en vertical y en horizontal | navegador (390×740, 844×390 y escritorio) |
| Caras: 5 formas, ojos, cejas, nariz, boca, detalles, barba; 19 peinados | `prueba-avatar` + vistas previas del generador + navegador |
| El aspecto viaja en código compacto (18 caracteres) | `prueba-avatar` + smoke test (3d) |
| Ficha de perfil; ver el de otro sólo si está en tu sala y no te bloqueó | smoke test (4b) + `prueba-normas` + navegador |
| Con el dedo: barra abajo, pellizco, chat arriba, paneles a lo ancho | navegador, con toques simulados |

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
concurrencia imprime dinero en silencio. Cada apunte y cada saldo llevan su
moneda (monedas o créditos); el precio de cada cosa, también.

**Dónde cabe un mueble lo dice un solo módulo** (`src/state/decorar.ts`), que
usan el fantasma del cliente y el servidor. Si cada lado tuviera sus reglas,
el verde del fantasma podría mentir.

**Nada se coloca con un 960×540 escrito a mano.** El lienzo mide lo que mida
la pantalla; todo pregunta a `this.scale` y a `medidas()` (`src/ui/pantalla.ts`)
y se rehace al girar el móvil (`alRedimensionar`).

**Un objeto está o en tu inventario o colocado en una sala, nunca a medias.**
Lo fuerza un `CHECK`, más un trigger que limpia las coordenadas si se queda sin
sala. Borrar una sala devuelve sus muebles al inventario en vez de destruirlos.

**El nombre sale de la cuenta.** Ya no viaja en `join`. Si algún evento vuelve
a llevar un campo `name` desde el cliente, se está deshaciendo esto.

**El avatar se genera, no se dibuja.** Las capas de `public/assets/avatar/`
no son colores: cada píxel guarda material, banda de luz y profundidad, y el
navegador las combina y colorea por jugador (`src/render/avatarSheet.ts`). Si
alguien pinta a mano un PNG de colores y lo mete ahí, deja de combinar con el
resto de prendas. Para cambiar el arte se toca `tools/avatar/model.mjs` y se
regenera.

**El cráneo es el mismo en todas las caras.** Las formas de cara cambian lo de
abajo (mofletes, mandíbula, barbilla); peinados (y mañana gorras) se cuelgan
del cráneo. Si una cara nueva cambiara el cráneo, habría que rehacer cada
peinado.

**La cara son sellos en anclas, y la barba, zonas** (`src/render/cara.ts`). El
generador sólo calcula dónde cae cada rasgo (`cara.json`) y marca las zonas de
la piel; el navegador pinta. Un rasgo nuevo no pide regenerar nada.

**El aspecto es un catálogo, validado en el servidor.** Estilos y colores
viven en `src/state/look.ts`, compartido; el servidor corrige campo a campo lo
que no esté ahí. Si el cliente pudiera mandar colores sueltos, cualquiera
podría pedir prendas que nadie sabe dibujar (y la tienda no tendría nada que
vender).

**Los muebles también se generan, y el color lo pone la sala.** Igual que
el avatar: `public/assets/muebles/` guarda material, luz y profundidad, y
`src/render/muebleSheet.ts` los colorea con el tema. Pintar un PNG de colores
a mano rompería los temas; se toca el modelo y se regenera.

**Lo que no tiene altura va en su banda.** Suelo (`LAYER.SUELO`) y
alfombras, luz y marcador (`LAYER.ALFOMBRA`) quedan por debajo de todo el
mundo. Con la Y de su celda, una alfombra delante del sofá lo tapaba.

**Una fuente, cargada antes que Phaser.** Todo el texto pasa por `texto()`
del kit (`src/ui/kit.ts`) en la fuente pixel propia, a 12 px (24 el logo).
Phaser mide cada fuente una sola vez: si arrancara antes de que llegue,
mediría la de reserva y todo el texto quedaría descolocado.

**En Roomie juegan niños: todos comparten el mundo, pero a cada uno le llega
según su edad.** Las normas viven en un solo sitio (`src/state/normas.ts`) y
las aplica el servidor. Un niño habla con frases y no lee texto libre: así,
aunque un adulto mienta con su edad, sólo puede usar las mismas frases. La
edad no sale nunca del servidor. Cada sistema nuevo que ponga en contacto a
dos jugadores añade su regla ahí ANTES de existir.

**Dos cámaras: la sala con zoom, la interfaz sin él.** Qué dibuja cada una lo
decide la profundidad justo antes de dibujar (`repartirCamaras`): de
`LAYER.WORLD_LABEL` hacia arriba, la de la interfaz. Por eso nombres y
burbujas se colocan en coordenadas de pantalla. Con una sola cámara, el zoom
ampliaba también el HUD (aunque tenga `scrollFactor(0)`) y lo sacaba de la
pantalla.

**Estar en una puerta sin camino es cruzarla.** Da igual cómo se llegara: con
un clic, con el teclado o por una corrección del servidor.

**La ocupación de baldosas vive en `AvatarState`.** Cliente y servidor
ejecutan la misma regla ("si la celda final la ocupa alguien, renuncio"), cada
uno con lo que sabe. Si se sacara a sólo uno de los dos lados, volverían a
discrepar y a corregirse a tirones.

**Bandas de profundidad con nombre** (`src/render/layers.ts`) en vez de números
a ojo. El bug que lo motivó: el modal estaba en `1e5` y todo el HUD en `1e6`,
así que las burbujas de chat de los avatares flotaban por encima del modal.

## Base de datos

Pocas tablas y con los invariantes correctos, en vez de muchas preparadas
para funciones que no existen.

```
accounts (fecha de nacimiento, permiso del tutor) ─┬─ avatars (nickname, look)
          ├─ sessions (token HASHEADO, caducidad)
          ├─ balances (caché, por moneda)  ←→  ledger (append-only, la verdad)
          ├─ premios_diarios (uno por cuenta y día)
          ├─ items (uno por mueble; en la mochila o colocado)
          ├─ rooms (owner NULL = pública; las casas, `personal`)
          ├─ blocks (a quién ha bloqueado cada uno)
          ├─ reports (con el chat de alrededor como contexto)
          └─ chat_log (lo que se escribe; se borra solo a los 30 días)
catalog_items (la tienda: precio, moneda, sección)   login_attempts (freno a fuerza bruta)
```

Migraciones en `db/migrations/*.sql`, se aplican con
`npm --prefix server run db:migrate` y quedan anotadas en `_migrations`.

**Credenciales:** `server/.env`, ignorado por git. Nunca en el código.

**Despliegue:** la base está en `us-east-1`; el servidor de juego debe ir en la
misma región (Fly.io `iad`, Railway `us-east`). El cliente es estático y puede
ir a Cloudflare Pages, pero **Workers no puede alojar el servidor**: es un
proceso vivo con bucle a 20 Hz y WebSockets abiertos.

## Qué viene, por orden

El plan completo está en **`docs/plan-piramide.md`**: primero los cimientos
(que no se ven, pero sin ellos se cae lo de arriba), luego los sistemas, el
contenido y la cima, subiendo por hitos jugables:

0. **Seguros (hecho).** El cimiento más bajo: edades, frases para los niños,
   filtro, bloquear y reportar.
1. **Mi primer piso** (casi entero: casa, tienda, mochila, decorar y móvil;
   faltan las tareas de la llegada y las visitas). Llegar a la terminal,
   ganarse las llaves con tres tareas cortas y tener un piso recién mudado
   (cama y clóset) que se decora con la tienda. Trajo los cimientos grandes:
   casas como datos, dos monedas, objetos de varias celdas e interfaz que se
   adapta.
2. **Salir a La Manzana.** Seis zonas alrededor de la Plaza de la Llave,
   amigos, compartir ubicación y una red que aguante 50 personas por zona.
3. **Vivir.** Trabajo en el café, hambre y comida, vehículos propios.
4. **Presumir.** Caras y rasgos (hecho, adelantado en la fase 11), moda por
   estilos (con el resto del avatar definitivo ANTES de fabricar prendas:
   complexión, ranuras y gorras), comercio seguro, créditos y Club.
5. **La cima.** Eventos, tendencias, mercado, mascotas, más barrios.

## Deuda conocida

- **Sólo gira lo que tiene dos caras** (estantería y armario, variante `-se`).
  Girar el resto (el sofá, la cama) pide generar más variantes; la cama, que
  mide 1×2, además cambiaría su huella.
- **Sólo se gana dinero con el premio del día y vendiendo.** Hasta que llegue
  el trabajo (Hito 3), la economía no tiene fuente de verdad; antes de tocar
  precios hay que medirla (C11).
- **Cada avatar en pantalla ocupa 1,8 MB de GPU** (hoja de 672×672). Con
  decenas de jugadores por sala habrá que generar sólo las direcciones en uso.
- **Las 35 capas del avatar (878 KB) se descargan todas al empezar**, aunque
  cada uno use seis. Con la moda habrá que cargarlas según se necesiten.
- **Las formas de cara se notan poco a tamaño real** (uno o dos píxeles, como
  en Habbo): donde de verdad se ven es en el vestidor y en el perfil.
- **El teclado atraviesa a la gente de pie**: con las flechas se puede pasar
  por encima de alguien (los asientos ocupados sí estorban). El clic sí está
  protegido.
- **El cambio de sala no se comprueba en el servidor**: acepta un `room` sin
  mirar si estabas en una puerta que lleva allí. Con salas como datos, la
  puerta y su destino deberían vivir en el servidor.
- **Antes de abrir al público con niños**:
  - falta el permiso del tutor por correo (las cuentas de menores de 13 se
    quedan "pendientes");
  - falta un panel de moderación y alguien que modere;
  - falta una revisión legal de las edades según el país.
  El filtro no entiende números escritos con letras ni otros idiomas.
- **El táctil se ha probado con toques simulados**, no en un teléfono de
  verdad. Falta probarlo en uno (iOS y Android), sobre todo el teclado del
  sistema con el modal de cuenta y con el chat.
- **La interpolación usa la hora de llegada**, no la de simulación, así que
  queda un temblor residual acotado. Arreglarlo pide un sello de tiempo en el
  snapshot: cambio de protocolo.
- **Cambiar el nickname una vez dentro** no llega al servidor: el nombre
  tendría que viajar en `room` o en un evento propio.
- **Las cuentas `sk...` de la base son del smoke test.** Cada ejecución crea
  las suyas con sufijo único. Para limpiarlas:
  `delete from accounts where username like 'sk%';`
  y luego sus reportes, que se quedan sin nadie:
  `delete from reports where reporter_id is null and reported_id is null;`

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
| `fase4-avatar-y-convivencia.md` | Clics en marcha, orden de dibujo, cada uno en su baldosa; avatar por capas y vestidor |
| `fase5-muebles-y-ui.md` | Alfombra que cortaba el sofá; muebles en 3D, paredes decoradas y luz; interfaz pixel art |
| `fase6-interfaz-fina-teclado-zoom.md` | Interfaz fina y propia; teclado en puertas y asientos; zoom con la interfaz a tamaño fijo |
| `fase7-seguridad-menores.md` | Niños seguros: edad privada, frases, filtro, bloquear y reportar |
| `fase8-plaza-de-la-llave.md` | La primera zona de La Manzana: la plaza al aire libre, con la Llave |
| `fase9-mi-primer-piso.md` | Tu casa: la portería, las llaves, el piso recién mudado; casas como datos y muebles de varias celdas |
| `fase10-economia-tienda-movil.md` | Dos monedas, premio del día, tienda, mochila y decorar; el móvil al 100 % (y el lienzo que no se redimensionaba al girar) |
| `fase11-caras-y-peinados.md` | Caras (formas, rasgos, barbas), 19 peinados, más pieles y colores; el vestidor rehecho y la ficha de perfil |
| `vision-mundo.md` | Ideas: barrio, ubicación, transporte, economía, cena, moda y caras |
| `plan-piramide.md` | El plan: cimientos, sistemas, contenido y cima, por hitos jugables |
| `guia-de-estilo.md` | Las reglas visuales: escala, cámara, luz, rampas de color, contorno |

`reporte-proyecto.md` es anterior a todo esto y está desfasado; se conserva
como historia.
