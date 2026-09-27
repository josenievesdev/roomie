# Fase 7 — Seguridad de los niños y niñas (cimiento C0)

**Fecha:** 27 de septiembre de 2026 · **Rama:** `feat/avatar-v2`

José decidió que en Roomie puede haber niños y niñas "de cierta edad hacia
adelante", con filtro de edades, y que es quizás lo más importante del
proyecto: tener tráfico sin acabar con los problemas de Roblox con los niños y
los depredadores. Por eso es el cimiento más bajo de la pirámide
(`docs/plan-piramide.md`): todo lo que se construya encima (amigos, mensajes
privados, regalos, comercio, visitas, compartir ubicación) tiene que pasar por
aquí.

## La idea que lo sostiene

**Todos comparten los espacios públicos, pero lo que le llega a cada uno
depende de su edad.** Así hay vida y gente (sin separar el mundo por edades),
y lo peligroso no llega a quien no debe.

1. **Un niño habla con frases y nunca lee texto libre.** Es la regla del
   "Safe Chat" de Club Penguin, la que mejor ha funcionado. Un niño elige
   frases de un menú y sólo ve las frases y los gestos de los demás: el texto
   que escriben otros no le llega nunca.
2. **Aunque alguien mienta con su edad, no puede hacer daño con el chat.** El
   peligro real es un adulto que se registra como niño para acercarse a
   niños. Con esta regla, al hacerse pasar por niño sólo puede usar las
   mismas frases del menú: no puede pedir un teléfono, ni una foto, ni que se
   vean por otra app. Mentir con la edad no le da nada.
3. **La edad es privada.** Nadie ve la edad ni la franja de nadie: una lista
   de "quién es niño" sería un mapa para quien busca niños. El servidor la usa
   para decidir y no la envía nunca (ni siquiera al propio jugador: sólo le
   dice cómo habla).
4. **Para todos, fuera los datos personales.** El servidor para los mensajes
   con teléfonos, correos, enlaces, nombres de apps de mensajería y redes,
   preguntas por dónde vive alguien o peticiones de fotos. Es lo que usa un
   depredador para sacar a alguien del juego, que es donde pasa lo grave.
5. **Bloquear y reportar, a un toque.** Desde el menú de cada avatar, y con
   palabras que entiende un niño ("Me está molestando", "Pide datos o fotos").

## Las franjas

| Franja | Edad | Cómo habla | Qué lee |
|---|---|---|---|
| Niño | de 8 a 12 | sólo frases y gestos del menú | sólo frases y gestos |
| Joven | de 13 a 17 | texto propio, filtrado | todo lo que pasa el filtro |
| Adulto | 18 o más | texto propio, filtrado | todo lo que pasa el filtro |

Los números viven en `src/state/normas.ts` (`EDAD_MINIMA`,
`EDAD_CONSENTIMIENTO`, `EDAD_ADULTO`): cambiarlos es cambiar una línea.

## Qué se hizo

**Normas en un solo sitio** (`src/state/normas.ts`, módulo puro compartido):
franjas, edad mínima, quién necesita permiso de un tutor, cómo habla y qué
lee cada franja. El servidor decide con él; el cliente sólo lo usa para
enseñar la interfaz que toca.

**La fecha de nacimiento, al registrarse.** Tres cajas (día, mes y año) que
sólo aceptan cifras y saltan solas a la siguiente. El control de edad es
"neutral": no dice cuál es el mínimo, porque anunciarlo invita a mentir. Si
alguien no llega, el navegador no deja volver a intentarlo en un día (si no,
bastaría con cambiar el año). Las cuentas de antes piden la fecha al entrar
("Un último paso"), y sin ella el servidor no deja jugar. Una vez dicha, no se
cambia desde el juego.

**Las frases** (`src/state/frases.ts`): seis temas (saludos, preguntas,
respuestas, ánimo, cumplidos, planes) y los gestos, en español neutro y sin
género. El cliente manda sólo el id y el texto lo pone el servidor, así que
no se cuela nada. Son de todos, no sólo de los niños: quien escribe las tiene
en la barra del chat (botón "Frases"), cómodas también en el móvil. Los gestos
del menú de avatar (👋 😀 😂) antes eran texto libre: ahora son frases, y un
niño también puede saludar.

**El filtro del chat** (`src/state/filtroChat.ts`), en el servidor, para el
texto libre y los nombres:

- **Bloquea** (no se entrega, y a quien lo escribió se le explica por qué):
  datos de contacto y contenido sexual.
- **Tapa** las groserías con estrellas.
- Contra los trucos: normaliza tildes y números que imitan letras
  ("wh4ts4pp"), junta las letras sueltas ("w h a t s a p p"), mira el texto
  junto ("what's app", "tik tok") y compara sin repetidas cuando alguien
  estira una palabra ("puuuta"). Sin comerse lo inocente: "computadora",
  "pera", "cono de helado" o "sexto grado" pasan.
- Una mención "@Luna" vale si Luna está en la sala; "@luna_22" es una red.

**Entrega uno a uno.** El servidor ya no manda el chat a toda la sala de
golpe: mira a cada uno, y a quien no lee texto libre sólo le manda frases, y a
nadie le llega lo de alguien a quien tiene bloqueado.

**Bloquear y reportar**, desde el menú de avatar. El reporte guarda las
últimas 40 líneas de la sala, **incluidas las que el filtro paró**: son la
prueba que necesita un moderador, aunque el niño no llegara a verlas. Hay un
freno para no reportar en bucle.

**La base de datos** (`db/migrations/006_seguridad.sql`): fecha de nacimiento
y estado del permiso del tutor en `accounts`; `blocks`, `reports` y
`chat_log`. El registro del chat se borra solo a los 30 días.

## Lo que falta antes de abrir el juego al público

Esto es un cimiento, no la casa entera. Antes de invitar a niños que no sean
de confianza:

1. **Permiso del tutor por correo.** Las cuentas de menores de 13 quedan
   "pendientes" (`consent = 'pendiente'`), pero todavía no hay correo que
   mandar al padre, madre o tutor. Hace falta un proveedor de correo, y una
   página para que el tutor apruebe y vea la cuenta de su hijo o hija.
2. **Un panel de moderación.** Hoy los reportes se guardan en la base y se
   miran a mano. Hace falta ver los pendientes, el contexto, silenciar, echar
   y banear.
3. **Quién modera.** Con niños, alguien tiene que mirar los reportes a diario.
   Y si alguna vez aparece algo grave (abuso, un adulto intentando quedar con
   un niño), hay que tener claro cómo avisar a las autoridades.
4. **Revisión legal.** Las edades y los permisos dependen del país: en EE. UU.
   la ley COPPA pide permiso de los padres por debajo de 13; en la UE el RGPD
   pone el límite entre 13 y 16 según el país (en España, 14); en Colombia,
   hasta donde sé, el tratamiento de datos de cualquier menor de 18 requiere
   la autorización de su representante. Antes de abrir, hay que confirmarlo
   con alguien que sepa de leyes. El sistema está hecho para que esos números
   se cambien sin tocar nada más.
5. **El filtro, a mejorar con el uso.** No entiende números escritos con
   letras ("tres uno dos...") ni otros idiomas, y ninguna lista de palabras
   es completa. Por eso lo importante son las frases de los niños, que no
   dependen del filtro.

## Las reglas para lo que venga

Cada sistema nuevo que ponga en contacto a dos jugadores añade su regla en
`src/state/normas.ts` antes de existir. Propuesta de partida:

| Sistema | Regla |
|---|---|
| Mensajes privados | Sólo entre amigos. Un niño, sólo con frases. |
| Amistades | Un niño no puede ser amigo de un adulto, salvo que lo apruebe su tutor (una familia que juega junta). |
| Regalos y comercio | Nunca de un adulto a un niño. Los créditos no se pasan entre cuentas. |
| Visitas a casa | La casa de un niño, sólo para sus amigos. |
| Compartir ubicación | Sólo con amigos, y apagado por defecto para menores. |
| Compras reales | Un niño, sólo con el permiso de su tutor y con límite. |

## Verificación

- `node tools/prueba-normas.mjs` (nuevo): 52 casos del filtro y de las
  edades, incluidos los trucos para esquivarlo y las frases inocentes que un
  filtro torpe se comería.
- `node tools/smoke-multiplayer.mjs`: **61 comprobaciones**, 17 nuevas con un
  niño de 10 años de verdad en la sala: su texto libre no sale; sus frases sí;
  no recibe el texto libre de un adulto pero sí sus frases; su edad no viaja;
  un teléfono no llega a nadie y se explica por qué; las groserías llegan
  tapadas; bloquear y desbloquear; reportar (y no duplicarlo); sin fecha o por
  debajo de la edad mínima no hay cuenta.
- `npm --prefix server run db:check`: 14 reglas nuevas. Nadie se bloquea a sí
  mismo; no hay fechas absurdas ni permisos inventados; una fecha dicha no se
  cambia; el chat viejo se purga y el reciente no; un reporte sobrevive a que
  se borre quien lo hizo.
- En el navegador:
  - una cuenta de antes pide la fecha;
  - con la de un niño, el chat es el menú de frases, y el texto libre del
    visitante adulto no le llegó (sus frases sí);
  - el menú de avatar ofrece "Decir algo", Bloquear y Reportar;
  - el reporte llega a la base con el contexto;
  - el registro rechaza una fecha de 6 años y el reintento;
  - un adulto tiene su barra con el botón "Frases".
