# Plan de Roomie: la pirámide

**Fecha:** 27 de septiembre de 2026 · Sustituye al orden de `estado-actual.md`
y aterriza `vision-mundo.md` con las respuestas de José.

La idea que pidió José: construir como una pirámide, **de abajo arriba**, para
que al llegar a la cima no haya que volver a los cimientos a arreglar algo,
porque si se rompe lo de abajo se cae lo de arriba. Así que primero va lo que
todo lo demás necesita, aunque no se vea.

---

## Lo que decidió José

| Tema | Decisión | Cómo lo aterrizo |
|---|---|---|
| Transporte | Andar siempre vale. El transporte es "vida pro": cicla, monopatín, carro... que se consiguen jugando. Sin dejar fuera el transporte público | Vehículos propios como objetos, con su velocidad; metro y taxi opcionales |
| La casa | Llegas a un sitio (un lobby) donde te explican cómo conseguir casa. Te la ganas "recién mudado": cama y clóset, y lo demás jugando | "La llegada": terminal, tres tareas cortas, llaves y piso recién mudado |
| Ubicación | Nada de direcciones reales: coordenadas o referencias ("estoy por donde está el mall") | Coordenadas del mundo + hitos con nombre en el mapa |
| Hambre | Realista, como mezcla de Club Penguin y Habbo pero original. Nadie se muere, pero hay que comer, y no comer no te impide hacer cosas | Energía que baja jugando; da ventajas estar bien comido, nunca bloquea |
| Comercio | Sí, con ideas: que el juego se lucre, que se pueda jugar gratis, que comprar créditos mejore el estatus, que un amigo pueda prestar algo | Regalos, préstamo con devolución automática e intercambio seguro, por fases |
| El barrio | Tipo la Gran Manzana: concurrido, con vida, moderno, con monumentos propios, para presumir el estilo | "La Manzana": seis zonas alrededor de una plaza con monumento propio |

---

## La pirámide

```
                         /\
                        /  \       PISO 4 · La cima
                       / 4  \      eventos, tendencias, Club, mercado, mascotas
                      /------\
                     /   3    \    PISO 3 · Contenido
                    /          \   el barrio, la moda, los vehículos, la vida
                   /------------\
                  /      2       \   PISO 2 · Sistemas
                 /                \  casa, tienda, amigos, trabajo, comida, vehículos, comercio
                /------------------\
               /         1          \   PISO 1 · Cimientos que faltan
              /                      \  lugares, estado, objetos, red, avatar, seguridad...
             /------------------------\
            /            0             \   PISO 0 · Lo que ya está firme
           /____________________________\
```

**La regla:** cada pieza de un piso dice qué necesita de los de abajo. Si
falta, se hace antes, y bien: nada de apaños que haya que rehacer.

---

## Piso 0 — Lo que ya está firme

- **El servidor manda** en posiciones, colisiones, nombre y dinero.
- **Cuentas y sesiones** con contraseña bien guardada y freno a fuerza bruta.
- **Dinero con libro mayor**: no se puede crear de la nada ni quedar en negativo.
- **Objetos que no se duplican**: cada mueble es una fila con dueño; o está en
  el inventario o colocado. La marca `tradable` ya existe.
- **La tabla `rooms`** ya existe, con dueño, tipo y mapa (aunque aún no se usa).
- **Avatar y muebles generados en 3D**, coloreados en el navegador.
- **Kit de interfaz** y **pruebas que intentan romper las reglas** (smoke test y
  `db:check`).

---

## Piso 1 — Los cimientos que faltan

Cada uno lleva **lo que se rompe arriba si no se hace**.

### C1. Lugares como datos
Hoy las salas están escritas en el código (`ROOMS` en `src/net/protocol.ts`) y
sus mapas son ficheros sueltos. Además, el servidor acepta un cambio de sala
sin mirar si venías de una puerta.

- Cada lugar es una fila: tipo (terminal, zona exterior, interior, casa),
  tamaño, mapa, puertas con destino, puntos de aparición e **hitos** con
  nombre ("la fuente", "la entrada del mall").
- El mapa guarda el **tipo de suelo** de cada celda: acera, calzada, césped,
  agua. Los carros irán por la calzada, y nadie andará por el agua de la fuente.
- Las puertas viven en el servidor: sólo se cambia de lugar por una puerta.

**Si no:** cada sitio nuevo es un cambio de código; no hay casa por jugador; y
cualquiera se teletransporta mandando un evento falso.

### C2. El mundo como cuadrícula de zonas
Recomiendo **zonas conectadas por los bordes**, como Club Penguin, en vez de un
mapa continuo gigante. Cada zona es una sala (lo que ya funciona), de hasta
64×64 celdas, y ocupa su cuadrado en una **cuadrícula del mundo**. Así las
coordenadas son globales (origen de la zona + celda) y significan algo:
*"Plaza de la Llave · X 132 · Y 48"*. Si una zona se llena, se abre una copia
("Plaza de la Llave · 2").

**Si no:** con un mapa continuo haría falta cargar el mundo a trozos (mucho más
difícil); con salas sueltas sin cuadrícula, las coordenadas no dicen nada.

### C3. El estado del jugador, en el servidor
Hoy la sala y la celda donde apareces salen del navegador (`localStorage`).
El servidor tiene que guardar dónde apareces (tu casa o la terminal), tu
progreso (las tareas de la llegada) y tu energía.

**Si no:** "apareces en tu casa", la llegada y el hambre no tienen dónde vivir.

### C4. Objetos de todo tipo, y dos monedas
Hoy un objeto sólo puede ser un mueble de suelo o de pared, y el saldo es uno.

- Tipos: mueble, prenda, vehículo, comida, ingrediente, especial.
- Cantidad, para lo que se gasta (tres manzanas son una fila, no tres).
- Marcas: comerciable (ya existe), se puede poner, se gasta.
- Estado: en el inventario, colocado, puesto o prestado.
- **Dos monedas en el libro mayor:** monedas (se ganan jugando) y créditos (se
  compran). Aunque los créditos no se usen todavía.

**Si no:** el comercio tendría que entender cinco modelos distintos (y ahí se
duplican cosas); y añadir los créditos después obliga a migrar el libro mayor
y cada precio.

### C5. Una red que aguante multitudes
Medido hoy: cada jugador ocupa 336 bytes en cada instantánea porque su aspecto
completo viaja 20 veces por segundo. Con 50 personas en una zona son **328 KB/s
por cliente** (imposible en un móvil) y 16 MB/s de salida del servidor.

- El aspecto, sólo al entrar o al cambiar; en cada instantánea, sólo posición
  y estado, compactos, y sólo de quien cambió. Objetivo: unos 10 KB/s.
- **Entidades genéricas**: jugadores, personajes del juego (NPC) y vehículos
  con el mismo formato, no sólo `PlayerView`.
- **Velocidad y modo** en `AvatarState` (andando, en monopatín, en carro),
  validados por el servidor.

**Si no:** el barrio concurrido no funciona, y NPCs y vehículos serían parches.

### C6. Objetos de varias celdas, y edificios que no tapan
Hoy todo mide una celda. Edificios, el monumento, camas, sofás de dos plazas y
carros ocupan varias. Y un edificio alto tapa a quien pasa detrás: se tiene que
volver transparente.

**Si no:** no se puede construir el barrio.

### C7. El avatar definitivo, antes de fabricar moda
Esto es lo más delicado. Mirando el generador (`tools/avatar/model.mjs`):
todo el pelo se cuelga de las medidas de la cabeza, y la ropa repite a mano
las medidas del cuerpo. Si se hacen 50 prendas para un cuerpo y luego se
añade otro, hay que rehacer las 50. Por eso, **antes de hacer más ropa o
peinados**:

- **Cráneo común, cara variable.** Las formas de cara cambian mandíbula,
  mofletes, mentón, nariz y ojos, pero no el cráneo. Así cada peinado y cada
  gorra valen para todas las caras sin retocarlos.
- **Un solo juego de medidas del cuerpo**, que lean la piel y la ropa. La
  complexión (delgada, media, ancha) pasa a ser un parámetro y la ropa se
  ajusta sola.
- **Ranuras y orden de capas:** ropa de abajo y de encima; accesorios de
  cabeza, cara, cuello y manos; el pelo, bajo la gorra.
- **Poses nuevas:** montar (monopatín de pie, cicla sentado, carro) y comer.
- **La altura, con cuidado:** cambia dónde cae el trasero en un asiento y
  dónde va el nombre. Dos o tres alturas como mucho, o ninguna al principio.
- **Memoria:** cada avatar ocupa 1,8 MB de la tarjeta gráfica; 50 en una plaza
  son 90 MB. Hay que generar sólo lo que se ve.

### C8. El reloj del mundo
Día y noche compartidos por todos. Lo necesitan el hambre, los turnos de
trabajo, las luces del barrio y los eventos.

### C9. Convivir seguros
Bloquear, silenciar y reportar; herramientas para moderar; filtro de chat
(teléfonos, direcciones); privacidad de la ubicación. Y **una cuenta con
correo verificado y recuperación**: hoy sólo hay usuario y contraseña.

**Si no:** el primer acosador o estafador no tiene quien lo pare. En Habbo, lo
que más daño hizo fueron las cuentas robadas para quitarles los objetos
valiosos: sin correo y recuperación, el comercio y los créditos son un
imán para eso.

### C10. Interfaz que se adapta
El lienzo mide 960×540 fijo y los paneles se colocan con números a mano.
Anclas (arriba a la izquierda, centro...) **antes** de hacer los paneles nuevos
(tienda, inventario, mapa, amigos, comercio).

**Si no:** jugar bien en el móvil, que es donde está la gente, obligaría a
rehacer cada panel.

### C11. Poder abrirlo al mundo
Desplegar (servidor y base en la misma región), copias de seguridad de la
base, bots para probar 50 personas en una zona, y métricas de la economía
(cuánto dinero entra y sale cada día).

**Si no:** no se puede invitar a amigos de verdad, y la inflación llegaría sin
que nadie la viera.

---

## Piso 2 — Los sistemas

| Sistema | Qué es | Se apoya en |
|---|---|---|
| S1. Inventario y tienda | Ver lo tuyo y comprar con monedas | C4, C10 |
| S2. La llegada y la casa | Terminal, tareas, llaves, piso recién mudado, colocar muebles, visitas, aparecer en casa | C1, C3, C4, C6 |
| S3. Amigos | Solicitudes, mensajes privados, compartir ubicación, mapa con los amigos | C1, C2, C9 |
| S4. Trabajo | El primer trabajo, en el café: pedidos, turnos, tope diario | C4, C5, C8 |
| S5. Comer | Energía, comida, cocina sencilla, cenar en casa | C3, C4, C7, C8 |
| S6. Moverse | Vehículos propios; metro y taxi | C1, C4, C5, C6, C7 |
| S7. Comercio | Regalos, préstamos con devolución, intercambio seguro | C4, C9 |
| S8. Créditos y Club | Pagos reales, membresía | C4, C9, y lo legal |

## Piso 3 — El contenido

- **El barrio, "La Manzana"** (ver abajo).
- **La moda:** caras y rasgos, peinados nuevos, tribus (urbano, emo, rock,
  skater), accesorios.
- **Los vehículos:** monopatín, cicla, patinete, moto, carro.
- **La vida:** peatones del juego, tráfico, palomas, luces de noche, sonido,
  pantallas gigantes.

## Piso 4 — La cima

Desfiles en la pasarela y fiestas; tendencias de temporada y ediciones
limitadas; el Club Roomie; un mercado entre jugadores; mascotas (lo que eran
los *puffles* de Club Penguin); más barrios y metro entre ellos.

---

## Cómo se sube sin romper

1. **Nada se construye sobre un hueco.** Si una pieza necesita algo de abajo
   que no existe, se hace antes, y bien.
2. **Cada piso deja su prueba automática.** Como `db:check` hoy: por ejemplo,
   "un intercambio nunca duplica ni pierde un objeto, aunque alguien se
   desconecte a mitad".
3. **Sistemas antes que contenido.** No hacer 50 prendas antes de cerrar
   cuerpos y caras (C7); no dibujar 20 edificios antes de los objetos de
   varias celdas (C6).
4. **La economía se mide** antes de tocar precios o de cobrar dinero real.
5. **Por hitos jugables.** Una pirámide entera antes de ver nada sería
   eterna y aburrida. Cada hito trae sólo los cimientos que necesita, hechos
   bien, y acaba con algo que se puede jugar con amigos.

---

## Los hitos: el orden real

### Hito 1 — "Mi primer piso"
El gancho: llegar, ganarse las llaves y tener algo tuyo.

- **Cimientos:** C1 (lugares y puertas en el servidor), C3, C4 (objetos y dos
  monedas), C6 (al menos la cama de dos celdas), C10 (anclas).
- **Sistemas:** S1 y S2.
- **Contenido:** la terminal (una plaza provisional), un edificio, el piso
  recién mudado, una guía y unos 15 muebles a la venta.
- **La prueba:** una cuenta nueva aparece en la terminal, completa las
  tareas, recibe las llaves una sola vez, al volver a entrar aparece en su
  casa, compra un mueble, lo coloca y un amigo que la visita lo ve. Nadie
  coloca nada en casa ajena.

Es el hito más grande, porque trae la mayoría de cimientos.

### Hito 2 — "Salir a La Manzana"
El primer "salir de casa" y encontrarse.

- **Cimientos:** C2, C5, C8, C9 (bloquear, reportar, privacidad), C11
  (despliegue y bots).
- **Sistemas:** S3.
- **Contenido:** las seis zonas, primero en bruto (bloques sin arte) para
  pasearlas con amigos, y luego con arte; peatones del juego; día y noche.
- **La prueba:** 50 bots en una zona sin tirones; la ubicación sólo la ven
  los amigos; un bloqueado no puede escribirte.

### Hito 3 — "Vivir"
Por qué salir cada día: trabajar, comer y moverse.

- **Cimientos:** C7 (las poses de montar y comer).
- **Sistemas:** S4, S5 y S6 (monopatín y cicla primero; metro y taxi).
- **Contenido:** el café, el súper, el restaurante, el parque con skatepark,
  la estación de metro.
- **La prueba:** el trabajo tiene tope diario; tener hambre no bloquea nada;
  nadie monta en un vehículo que no tiene ni va más rápido de lo que permite.

### Hito 4 — "Presumir"
La moda, la identidad y el estatus.

- **Cimientos:** C7 completo (cuerpos, caras, ranuras) **antes que ninguna
  prenda nueva**; la ropa pasa a ser algo que tienes.
- **Sistemas:** S7 y S8.
- **Contenido:** caras y rasgos, diez peinados, los primeros estilos, la
  Avenida de la Moda con sus boutiques y la pasarela.
- **La prueba:** nadie viste lo que no tiene; un intercambio nunca duplica
  ni pierde nada.

### Hito 5 — "La cima"
Eventos, tendencias, Club Roomie, mercado, mascotas y un segundo barrio.

---

## Mi opinión, punto por punto

### El transporte como "vida pro"
Me encanta, y además es estatus: el vehículo es moda también. Propongo una
escalera:

| Vehículo | Velocidad | Dónde | Precio (idea) |
|---|---|---|---|
| Monopatín | ×1,5 | exteriores | barato, el primero |
| Cicla | ×1,8 | exteriores | medio |
| Patinete eléctrico | ×2 | exteriores | medio |
| Moto | ×2,5 | calzada | caro |
| Carro | ×3 | sólo calzada, y se aparca | muy caro o con créditos |

- Se modelan con el mismo generador 3D que los muebles, y se colorean con el
  mismo sistema que la ropa: cada uno a su gusto.
- Al entrar en un edificio el vehículo se guarda solo, y al salir vuelve.
- El carro es el último: ocupa varias celdas, necesita calzada y en una plaza
  llena de gente sería un caos.
- Metro y taxi quedan como comodidad para ir lejos, nunca como obligación.

### La llegada y la casa
Tu idea es buena: es la sensación de Habbo y del iglú de Club Penguin, empezar
con poco y hacerlo tuyo. La afinaría así:

1. **Llegas en autobús a la terminal** de la plaza, con una maleta: la
   fantasía de mudarse a la gran ciudad.
2. **La casera** te da la bienvenida: tiene un piso para ti, pero pide una
   fianza.
3. **Tres tareas cortas** que enseñan a jugar: moverte y hablar, hacer tu
   primer turno en el café (ganas la fianza), y pagarla.
4. **Te da las llaves.** Tu piso: una cama, un clóset y unas cajas de mudanza
   por el suelo. Lo demás, jugando.

- **Tiene que ser rápido** (menos de diez minutos): tener tu sitio es lo que
  engancha, y tu amigo tiene que poder visitarte pronto.
- **Nunca bloquea lo social:** durante la llegada se puede hablar con quien sea.
- **Al volver a entrar, apareces en casa**, como querías desde el principio.
- Hoy una cuenta nace con 500 monedas; con esto nacería con poco, y la fianza
  se ganaría en el primer turno.

### Coordenadas y referencias
De acuerdo: más de juego que una dirección postal. Con la cuadrícula de zonas
(C2) cada punto tiene coordenadas, y cada zona sus hitos. Al compartir tu
ubicación, a tu amigo le llega algo como *"Luna está en la Plaza de la Llave,
junto a la fuente (X 132, Y 48)"* con un botón para verlo en el mapa. En el
HUD, discreto, dónde estás. Y por defecto sólo te ven tus amigos.

### El hambre
Tu idea (nadie se muere, pero hay que comer, y no comer no te impide nada)
es justo el punto bueno. Cómo lo haría:

- Una barra de **energía** que baja sólo mientras juegas. Volver tras una
  semana y encontrarte muerto de hambre sería un castigo.
- **Bien comido** tienes ventajas pequeñas: cobras un poco más en el trabajo y
  tu avatar va contento.
- **Con hambre** se nota: te suena la tripa, caminas cansado y cobras menos.
  Pero puedes hacer de todo.
- **Tres formas de comer:** algo rápido (barato, llena poco), el restaurante
  (más caro, llena más, y se come con gente) y cocinar en casa (lo que más
  llena por lo que cuesta, pero hay que ir al súper).
- **Comer juntos da un extra.** Eso convierte la comida en plan con amigos,
  como la pizzería de Club Penguin.
- El mismo sistema servirá mañana para las mascotas.

### El comercio
Mi opinión: **sí, pero por fases**, porque en Habbo fue a la vez lo mejor
(los "raros" eran media cultura del juego) y lo peor (estafas y cuentas
robadas).

1. **Regalos y préstamos.** Regalar a un amigo, y **prestar con devolución
   automática**: le dejas tu carro dos horas y vuelve solo. Es tu idea de "un
   amigo le presta algo", pero sin que nadie pueda quedárselo. El dinero no se
   presta, porque el juego no puede obligar a devolverlo; sólo se regala, con
   límite.
2. **Intercambio seguro, cara a cara.** Una ventana donde los dos ponen lo
   suyo, los dos confirman dos veces y el servidor lo cambia de golpe.
3. **Un mercado**, mucho más adelante.

**Protecciones:**
- Las cuentas nuevas no comercian los primeros días.
- Los créditos no se pasan de uno a otro; sólo los objetos.
- Cada intercambio queda apuntado y se puede deshacer si hubo estafa.
- Hay cosas no comerciables.

**Y aquí está el negocio:** lo que se compra con créditos vale más si se
puede intercambiar. Eso hace que la gente compre créditos sin que el juego
sea de pago para ganar.

### Ganar dinero con el juego
- Todo lo esencial se consigue jugando.
- Lo de pago es **estilo, estatus y comodidad**: prendas exclusivas,
  ediciones limitadas, vehículos especiales...
- Y un **Club Roomie** mensual, como la membresía de Club Penguin: un regalo
  al mes, un color de nombre y una terraza VIP.
- Nada de cajas sorpresa de pago: es apostar, y en varios países ya está
  regulado.
- Cobrar de verdad pide antes un proveedor de pagos, términos, devoluciones y
  pensar en los menores. Por eso va en el Hito 4 y no antes.

### El barrio: "La Manzana"
El nombre tiene doble sentido: guiña a la Gran Manzana, y en muchos países una
manzana es justo un bloque de calles. Seis zonas alrededor de una plaza:

```
                      [ Parque Central ]
                   fuente, bancos, skatepark
                              |
[ Residencial ] --- [ Plaza de la Llave ] --- [ Avenida de la Moda ] --- [ Mall ]
 tu edificio,        terminal, monumento,      boutiques por estilo,    tiendas,
 buzón               pantallas gigantes        pasarela                 comida
                              |
                     [ Calle del Sabor ]
                   café, súper, restaurante
```

**El monumento: La Llave.** Una llave gigante en el centro de la plaza. Es
nuestra, no copia a nadie, y cuenta la historia del juego: todos llegan a la
ciudad a por las llaves de su casa. Además, es el sitio perfecto para quedar
("te espero en la Llave").

**Cada zona tiene tres cosas:** para qué se va (comprar, comer, presumir), un
hito que la hace reconocible, y un motivo para volver cada día (el turno del
café, la tendencia de la semana, el evento de la plaza).

**Para que se sienta concurrida aunque haya poca gente**, que al principio
pasará:
- Peatones del juego que pasean.
- Tráfico por la calzada y palomas en la plaza.
- Luces de noche y sonido de calle.
- Pantallas gigantes que enseñan los looks de la semana y los próximos eventos.

Una Nueva York vacía da pena; una plaza pequeña llena de detalles, no.

**Cómo planearla, paso a paso:**
1. Qué se siente en cada zona.
2. Dibujo de burbujas (como el de arriba).
3. **Versión en bruto** con bloques, sin arte, para pasearla con amigos y ver
   si las distancias funcionan.
4. El arte.
5. La vida: gente, sonidos y luces.

### Lo que pienso de todo junto
- **Lo más original es la ciudad.** Habbo son salas y Club Penguin una isla
  de minijuegos. Roomie puede ser **la vida en la ciudad**: tu casa, tu
  barrio, tu estilo, tu vehículo, tu trabajo y tu cena. Coge lo mejor de cada
  uno:
  - De Habbo: la casa, los muebles y el comercio.
  - De Club Penguin: un mundo amable, fiestas, mascotas y catálogo de temporada.
  - Lo tuyo: el barrio, la moda por tribus y la vida diaria.
- **Los riesgos**, cada uno con su respuesta:
  - Que el proyecto crezca más rápido que las ganas: hitos jugables.
  - Un mundo vacío: vida del juego y eventos.
  - La inflación: sumideros y métricas.
  - Los abusos: el cimiento C9, antes del comercio.

---

## Lo que falta decidir

1. **¿Para qué edades es Roomie?** Cambia el chat, los regalos y el comercio:
   si juegan niños, las reglas tienen que ser mucho más estrictas.
2. **¿Te gustan "La Manzana" y "La Llave"**, o prefieres otros nombres?
3. **Día y noche:** ¿con la hora real (la misma para todos) o con un día de
   juego más corto, para que quien juega siempre a la misma hora vea las dos?
