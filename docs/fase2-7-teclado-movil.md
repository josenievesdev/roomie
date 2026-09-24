# Fase 2.7 — Teclado en móvil (nickname y chat)

**Fecha:** 24 de septiembre de 2026
**Alcance:** entrada de texto. No se tocó movimiento, Socket.io, `avatarState.ts`,
el protocolo, los mapas de Tiled, los assets ni las capas.

## El problema

Probando el multijugador por un túnel de VS Code, un amigo abrió el juego desde
un Android: veía la pantalla de login, **aparecía en el PC del anfitrión como
"Huésped-###"**, y no podía escribir su nombre ni le salía el teclado.

Eran **tres** problemas distintos.

---

## 1. El teclado nunca aparecía en el móvil

El "campo" de nickname era un `Phaser.GameObjects.Text` y la entrada se
capturaba con un `keydown` sobre `window`. En un teléfono **no hay teclado
físico y no hay ningún elemento editable del DOM con el foco**, así que el
sistema nunca abre el teclado virtual y no se dispara ni un solo `keydown`.
Tocar el campo tampoco hacía nada: `nickBg` tenía `setInteractive()` pero
ningún manejador.

Y como `submitLogin` hace `if (!clean) return;`, pulsar "Entrar" con el nombre
vacío no hacía absolutamente nada. Callejón sin salida.

El chat tenía exactamente el mismo problema, con un agravante: se abre con
Enter, tecla que en un móvil no existe.

### Solución: `src/ui/textInput.ts`

Un `<input>` real e invisible que existe **sólo** para que el navegador nos
entregue lo que el usuario escribe. Phaser sigue pintando el texto.

Detalles que importan:

- `opacity:0` y **no** `display:none` ni `visibility:hidden`: esos dos impiden
  enfocar el elemento, y sin foco no hay teclado.
- `pointer-events:none`, para que no se coma los toques del lienzo.
- `font-size:16px`: por debajo de eso, iOS hace zoom automático al enfocar.
- `position:fixed` centrado, para que el móvil no desplace la página al enfocar.
- `focus({ preventScroll: true })`.

Se enfoca al abrir, y también al tocar el campo o el panel — en el móvil el
teclado sólo se abre dentro de un gesto del usuario.

**Botón "Chat" en el HUD**, junto a "Perfil": sin él no habría forma de abrir el
chat en un teléfono.

### La regla del `stopPropagation`

El `keydown` del input **detiene la propagación**. Sin eso apareció un fallo
durante la prueba: el mismo Enter que confirmaba el nickname seguía subiendo
hasta `window`, donde `closeLoginModal` acababa de **reactivar** el teclado de
Phaser, y el manejador abría el chat solo. Enviar un mensaje tenía el problema
simétrico: cerraba el chat y acto seguido lo reabría.

> Mientras un `<input>` tiene el foco, el teclado es suyo y la tecla no sube.

Como red de seguridad, el manejador de Phaser y el respaldo del modal consultan
`textInputFocused()` y se apartan. Así, si el foco se perdiera, escritorio
sigue funcionando por el camino antiguo en vez de quedarse mudo.

Los `<input>` viven en el DOM, fuera de Phaser: se destruyen al cerrar el modal
o el chat, y también en el `SHUTDOWN` de la escena, o se acumularía uno por cada
cruce de puerta.

---

## 2. Entrabas solo como "Huésped-###"

`setupNet()` registraba `onStatus` para llamar a `sendWhere()` en cuanto
conectaba el socket, **sin mirar si el modal estaba pidiendo el nombre**. Sin
guardado, `sendWhere` usa `playerName()` → `Huésped-###` → `net.join()`.

```ts
if (up && !this.loginModalOpen) this.sendWhere();
```

## 3. Y el nombre elegido ya no podía sustituirlo

Consecuencia del anterior: ese primer `join` pone `joined = true`, así que al
pulsar Entrar `sendWhere()` tomaba la rama `net.changeRoom()` en vez de
`net.join()` — y el evento `room` no lleva nombre (el handler del servidor
tampoco toca `p.name`). Reproducido contra el servidor real:

```
paso 1: la escena se une sola como "Huésped-533"
paso 2: el jugador escribe "Carlos" y pulsa Entrar
paso 3: el anfitrión lo sigue viendo como -> "Huésped-533"
        (los colores sí cambiaban: 'look' es un evento aparte)
```

**Afectaba a cualquier jugador nuevo, también en PC.** No se había notado porque
los navegadores ya usados tenían un nickname guardado.

Al no entrar con el modal abierto, el primer `join` sale de `submitLogin` y ya
lleva el nombre elegido.

---

## Verificación

`typecheck`, `build` y smoke E2E en verde. Y el flujo completo en navegador
real, leyendo el estado de la escena:

```
modal abierto     -> enServidor: []          <- ya NO entra solo como Huésped
escribir "Nuria"  -> loginNick "Nuria"       <- sin duplicar letras
                                             <- la "c" ya no abre el panel C
Enter             -> modal cerrado, el chat NO se abre solo
                  -> inputs en el DOM: 0     <- sin fugas
                  -> enServidor: ["Carlos","Nuria"]   <- entra con SU nombre

Chat (botón)      -> input con maxLength 60, enfocado
escribir          -> la barra sigue al input
Enter             -> enviado, chat cerrado, NO se reabre, burbuja creada
```

## Lo que sigue pendiente en móvil

- El lienzo es 960×540 fijo con `Scale.FIT`: en un teléfono en vertical queda
  una franja pequeña. Eso es diseño responsive, Fase 3.
- Cambiar el nickname **una vez dentro** (editar perfil) sigue sin llegar al
  servidor: el nombre tendría que viajar en `room` o en un evento propio. Eso
  es protocolo, y está fuera del alcance de esta fase.
- El cursor "▌" no parpadea y siempre está al final; no hay selección de texto
  ni portapapeles dentro del campo dibujado.
