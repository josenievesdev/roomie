# Fase 2.9 — Panel de chat estilo Minecraft

**Fecha:** 24 de septiembre de 2026
**Alcance:** interfaz de chat. No se tocó movimiento, Socket.io,
`avatarState.ts`, el protocolo, los mapas de Tiled ni los assets.

## Antes

El chat sólo dejaba rastro en dos sitios inconexos:

- una **burbuja** sobre la cabeza que desaparecía a los 4 s, y
- un log de 3 líneas abajo a la izquierda, sólo para avisos del servidor
  (entró/salió). Lo que decía la gente no quedaba en ninguna parte.

Si mirabas para otro lado, el mensaje se perdía.

## Ahora

Panel en la esquina inferior izquierda, con el comportamiento de Minecraft:

| | chat cerrado | chat abierto |
|---|---|---|
| mensaje reciente | se ve | se ve |
| mensaje de hace más de 12 s | se oculta | se ve (historial completo) |
| fondo del panel | oculto | visible |

- 10 líneas a la vista, 60 de historial.
- Colores por tipo: avisos del servidor en morado apagado, lo tuyo en ámbar,
  lo de los demás en blanco.
- Los mensajes largos se parten **por palabras**.
- La barra de escritura se alinea con el panel, en vez de ir centrada.
- Las burbujas sobre la cabeza se mantienen: son la parte "Habbo". La burbuja
  se va en 4 s, el panel conserva la conversación.

### Por qué el texto se parte a mano

Phaser tiene `wordWrap`, pero obliga a usar **un** objeto de texto para todo el
bloque, y entonces no se puede dar un color distinto a cada línea. Con un
objeto por línea hacen falta líneas ya partidas, así que el corte por palabras
se hace en `wrapChat()` al añadir el mensaje al historial.

Los 10 objetos de texto se crean una vez y se reutilizan; no se recrean en cada
mensaje.

### Repintado

`renderChatPanel()` se llama al añadir una línea, al abrir y al cerrar el chat,
y desde un temporizador de 500 ms — el desvanecido depende del reloj, no de que
ocurra nada.

## Verificación

`typecheck`, `build` y smoke E2E en verde, más comprobación en navegador real:

- corte por palabras de un mensaje largo, sin partir palabras a la mitad
- los tres colores según el tipo de línea
- emojis del menú de avatar en el historial
- con el chat cerrado: mensaje reciente visible, mensaje caducado oculto
- con el chat abierto: fondo visible y todo el historial, aunque esté caducado
