# Fase 2 — Problemas críticos de UI (sin migrar a DOM)

**Fecha:** 24 de septiembre de 2026
**Rama:** `fase1-movimiento` · **Punto de retorno:** tag `fase1-base`
**Commits:** `445a97e` (input) · `d1291b6` (preview) · `382794f` (modal)

**Alcance:** sólo el modal de login/perfil, dentro de Phaser. No se tocó
movimiento, Socket.io, `avatarState.ts`, el protocolo, los mapas de Tiled ni
los assets. El único archivo modificado es `src/scenes/MainScene.ts`.

Esta fase **no** migra la UI: la deja funcionando para poder hacer la migración
a DOM con calma en la Fase 3, en vez de a la carrera.

---

## Bloque 1 — Input del nickname (`445a97e`)

### Borrar no hacía nada

El valor no existía en ningún sitio: se sacaba del propio objeto `Text`
quitándole el cursor. Y Backspace hacía:

```ts
nickText.setText(nickText.text.slice(0, -1) + "▌");
```

Con el texto `"pepe▌"`, `slice(0, -1)` devuelve `"pepe"` — se come el **cursor**,
no la letra — y al volver a pegar el `"▌"` el resultado es otra vez `"pepe▌"`.
**Borrar era literalmente una operación nula.**

Ahora el valor vive en un campo (`loginNick`) y el `Text` sólo lo dibuja. El
cursor es decoración, no dato.

### Listeners acumulados

`showLoginModal` registraba un `keydown` en `window`; `closeLoginModal` no lo
quitaba. Abrir el perfil tres veces dejaba tres listeners vivos: cada tecla se
escribía tres veces, y los de aperturas anteriores apuntaban a objetos `Text`
ya destruidos.

Ahora la referencia se guarda en `loginKeys` y se retira al cerrar — y también
en el `SHUTDOWN` de la escena, por si muere con el modal abierto al cruzar una
puerta.

### El teclado del juego seguía activo

El handler de teclado de Phaser no comprobaba si el modal estaba abierto:

- escribir una **"c"** en el nickname abría el panel de personalización,
- **Enter** abría la barra de chat detrás del modal,
- **WASD** hacía caminar al avatar mientras escribías.

Ahora se apaga entero mientras el modal tiene el foco, con `resetKeys()` para
que una tecla pulsada al abrir no se quede "pulsada" y el avatar no salga
andando solo al cerrar. Los clics tampoco atraviesan ya el modal.

### Extras

- Se ignoran los atajos con Ctrl/Cmd/Alt — `Ctrl+R` escribía una "r" antes de
  recargar.
- `Backspace` hace `preventDefault()`: en algunos navegadores retrocedía de página.
- El límite de longitud usa `NAME_MAX` del protocolo en vez de un `16` suelto.

---

## Bloque 2 — Preview del avatar (`d1291b6`)

### La preview ignoraba los colores elegidos

El modal creaba su propia textura `avatar:preview`, pero acto seguido hacía:

```ts
preview.play(this.anim("idle-down"), true);  // -> "avatar:idle-down"
```

Esa animación pertenece a la textura del **jugador**. Al reproducirla, el sprite
se reenganchaba a esa otra textura y la preview mostraba el avatar actual, no el
que estabas configurando. Ahora usa `animKey(PREVIEW_KEY, "idle-down")`, la
animación de su propia textura.

### Frames muertos al recolorear

`createAvatarTexture` **destruye y recrea** textura y animaciones. El sprite
seguía reproduciendo la animación vieja, quedándose con frames muertos: es
exactamente el fallo que dejaba la pantalla en negro al cruzar puertas
(documentado en el reporte del proyecto, punto 3). El repintado ahora para la
animación antes y la relanza después.

### Fuga de recursos

`closeLoginModal` no liberaba nada: cada apertura del perfil dejaba una textura
y siete animaciones huérfanas. Ahora llama a `destroyAvatarAssets`, después de
destruir los sprites que la usaban (nunca antes).

---

## Bloque 3 — Disposición y estabilidad del modal (`382794f`)

### Elementos fuera del panel y solapados

Comprobación geométrica del layout **anterior** (panel `y 80..460`):

```
  ok    preview          y 284..356
  ok    etiqueta pelo    y 280..293
  ok    tonos pelo       y 288..308
  FUERA botón cancelar   y 449..479      <- 19 px por debajo del panel
  SOLAPE  preview <-> tonos pelo
  SOLAPE  etiqueta pelo <-> tonos pelo
```

El Cancelar se colocaba en `panelH - 40 + 44` = 384 sobre un panel de 380.

Ahora la columna se mide desde `panelY` con posiciones que no chocan, los
botones se anclan al **borde inferior** del panel en vez de a una altura fija, y
el panel cambia de alto según el modo (400 con Cancelar, 358 sin él) en lugar de
dejar un hueco muerto en la pantalla de entrada.

Comprobación del layout nuevo, en los dos modos:

```
=== Entrar (sin Cancelar) ===   panel y 91..449
  ok  título/nickname/error/preview/ropa/pelo/guardar   margen mín 10px
=== Editar perfil ===           panel y 70..470
  ok  ...además botón cancelar  y 427..457             margen mín 13px
=== GEOMETRÍA CORRECTA: nada fuera del panel, ningún solape ===
```

### El botón "Perfil" se autodestruía

`buildProfileButton` metía el botón en `loginUI`… y `closeLoginModal` destruye
**todo** lo que hay en esa lista. Al cerrar el perfil una vez, el botón
desaparecía y no había forma de volver a abrirlo sin recargar. Ya no se mete ahí.

### Modales apilados

La guarda de reentrada era `if (this.loginModalOpen && !isEdit) return;`, así que
en modo edición **no aplicaba**: cada pulsación del botón Perfil creaba un modal
nuevo y dejaba el anterior huérfano debajo, con su listener de teclado incluido.
Ahora no se apila.

### El panel de personalización se ocultaba a medias

Al abrir el modal se ponía `customOpen = false` pero sus objetos seguían
dibujados por encima. Ahora se oculta de verdad.

### Texto de error localizado por contenido

`onJoinError` buscaba en `loginUI` un `Text` cuyo contenido fuera `""` — casaba
con cualquier `Text` vacío del modal. Ahora es una referencia directa
(`loginError`), y si el modal está cerrado se abre **antes** de escribir en él.

### Cancelar no descartaba los colores

Los selectores cambian `this.palette` en vivo para que la preview los muestre.
Al cancelar, esos cambios se quedaban aplicados. Ahora se guarda la paleta al
abrir y se restaura si se cierra sin guardar; guardar la confirma.

---

## Verificación

Tras **cada** bloque:

| | Bloque 1 | Bloque 2 | Bloque 3 |
|---|---|---|---|
| `npm run typecheck` | OK | OK | OK |
| `npm run build` | OK | OK | OK |
| `node tools/smoke-multiplayer.mjs` (20 checks) | OK | OK | OK |

Más la comprobación geométrica del modal en sus dos modos (arriba).

### Pendiente: prueba visual manual

La verificación en navegador quedó a medias — la extensión de Chrome se
desconectó y al reconectar dejó de poder abrir `localhost`. Lo verificado arriba
es real, pero **teclear en el modal no se ha probado en vivo**. Son 30 segundos:

```bash
npm run dev:server   # terminal 1
npm run dev          # terminal 2
```

Con `localStorage.removeItem('roomie:save')` en la consola y recarga, comprobar:

1. Escribir un nombre y **borrar con Backspace** — debe borrar letra a letra.
2. Escribir una **"c"** — no debe abrirse el panel de personalización.
3. Pulsar **Enter** dentro del modal — debe entrar, no abrir el chat.
4. Pulsar **WASD** con el modal abierto — el avatar no debe moverse.
5. Elegir otro color de ropa — **la preview debe cambiar** de color.
6. Abrir Perfil, **Cancelar**, y volver a abrir Perfil — el botón debe seguir ahí
   y los colores probados deben haberse descartado.
7. Abrir y cerrar el perfil 3 veces, luego escribir — cada tecla debe escribirse
   **una** vez.

## Rollback

```bash
git revert 382794f   # sólo disposición/estabilidad del modal
git revert d1291b6   # sólo la preview
git revert 445a97e   # sólo el input del nickname
```

Los tres bloques son independientes entre sí y se pueden revertir por separado,
en cualquier orden.

## Lo que sigue sin arreglarse (y es correcto que así sea)

Esto es maquillaje sobre una UI que no debería estar en Phaser. Sigue sin
resolver, y lo resuelve la **Fase 3** migrando a DOM:

- Sin teclado virtual en móvil: no hay `<input>` real, así que en un teléfono no
  se puede escribir el nickname.
- Sin seleccionar texto, portapapeles, ni mover el cursor dentro del campo.
- El lienzo sigue siendo 960×540 fijo con `Scale.FIT`: en pantallas pequeñas se
  encoge todo junto y el modal queda ilegible.
- El cursor "▌" no parpadea y siempre está al final.
