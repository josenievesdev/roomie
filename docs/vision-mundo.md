# Visión del mundo: barrio, moda y vida diaria

**Fecha:** 27 de septiembre de 2026 · Documento de ideas, no de código.

> **José ya respondió** a las preguntas del final. Sus decisiones y el plan
> por pisos (qué va primero para no tener que volver atrás) están en
> `docs/plan-piramide.md`. Donde los dos no coincidan, manda el plan.

José tiene una visión grande: un barrio o colonia donde cada personaje tiene
su casa, sale a la calle, queda con sus amigos diciendo "estoy en tal sitio",
coge el transporte, trabaja, compra ("merca"), vuelve y se hace la cena. Y un
mundo de moda propio: caras y rasgos distintos, peinados, y estilos de hoy
(pantalón ancho, emo, rock...). Aquí va lo que pienso y cómo lo haría.

---

## Lo que pienso

**La visión es grande, pero es coherente, y eso es lo importante.** No son
diez juegos pegados: es uno solo, "vida diaria compartida". Tener casa, salir,
encontrarse, gastar y volver. La moda es la **identidad** (quién eres), la
ciudad es el **escenario** (dónde estás) y la economía es el **pegamento**
(por qué sales de casa). Cada idea que has dicho encaja en una de esas tres.

**El riesgo no es la ambición, es el orden.** Un mundo enorme y vacío se siente
peor que una sala pequeña llena. Habbo enganchó con salas, no con una ciudad.
Mi consejo: **un barrio primero, no una ciudad.** Un barrio pequeño pero vivo
(tu edificio, una calle, una tienda de ropa, un café y un súper) enseña todas
las piezas funcionando juntas. Luego la ciudad es "más barrios", y eso ya es
sobre todo contenido, no programación.

**Lo que ya tienes sirve para todo esto.** El servidor manda, el dinero va por
libro mayor, cada objeto es una fila que no se duplica, el aspecto es un
catálogo validado y el avatar se genera por capas. Nada de eso hay que
tirarlo: son justo los cimientos que piden una tienda, una casa propia y un
mundo de moda.

---

## 1. El mundo: ciudad → barrios → calles → edificios → interiores

Cada **lugar** es una sala, como hoy. La diferencia es de tamaño y de tipo:

| Tipo | Ejemplo | Tamaño |
|---|---|---|
| Interior | tu piso, el café, la tienda | como las salas de ahora |
| Zona exterior | la Plaza de la Llave | un mapa exterior grande (hasta 64×64) |
| Barrio | La Manzana | un conjunto de zonas con su estilo |

Las puertas de los edificios de una calle son puertas como las de ahora, que
llevan a su interior. Eso ya funciona (y ahora también con el teclado).

**Coordenadas y referencias para quedar** (decisión de José: nada de
direcciones postales). Cada punto del mundo tiene coordenadas, y cada zona sus
hitos con nombre: *"estoy en la Plaza de la Llave, junto a la fuente (X 132,
Y 48)"*. Para quedar con un amigo:

- **Compartir ubicación:** un botón que manda por el chat privado dónde estás.
  Al tocarlo, el amigo ve el sitio en el **mapa** del barrio.
- **Ir hasta allí:** andando (gratis), en metro (barato) o en taxi (caro y
  directo). Así el mundo existe: la distancia importa un poco, y el
  transporte tiene sentido.
- **Privacidad:** cada uno decide quién puede ver dónde está (nadie, amigos,
  todos). Esto es importante desde el primer día: saber dónde está otra
  persona en todo momento no puede ser lo normal.

Para esto hace falta antes una **lista de amigos** (una tabla de amistades y
solicitudes) y **salas como datos** en la base, no escritas en el código.

## 2. Transporte

Decisión de José: **andar siempre vale**, y el transporte es "vida pro".

- **Vehículos propios, lo principal:** monopatín, cicla, patinete, moto y
  carro. Se consiguen jugando, te hacen ir más rápido por la calle y son
  estatus y estilo. La escalera de vehículos está en `plan-piramide.md`.
- **Metro o bus, como comodidad:** las estaciones son puertas especiales que
  abren un mapa de líneas. El billete cuesta poco.
- **Taxi:** directo a donde está tu amigo, caro. Una buena forma de que el
  dinero salga de la economía.

## 3. Economía

Una economía sana tiene **fuentes** (de donde sale el dinero) y **sumideros**
(donde se va). Si sólo entra, todo se abarata y deja de importar.

| Fuentes | Sumideros |
|---|---|
| Trabajos por turnos (café, tienda, reparto) | Ropa y accesorios |
| Premio diario por entrar | Muebles y decoración |
| Eventos | Comida, transporte, taxi |
| | Una casa más grande (o alquiler) |

- **Trabajos sociales, no minijuegos solitarios.** Por ejemplo, en el café:
  atender pedidos de otros jugadores (o de clientes del juego si hay poca
  gente), cobrar por turno, con un tope diario para que nadie "granjee".
- **Todo pasa por el servidor y por `mover_saldo()`**, como ya está hecho.
- **Comercio entre jugadores:** sí, por fases (regalos y préstamos con
  devolución automática, luego intercambio seguro, luego un mercado), con
  sus protecciones. El detalle, en `plan-piramide.md`.

## 4. Mercar y la cena

Sin juego de cocina, como dijiste, pero con la idea entera:

1. El **súper** es una sala con estanterías; comprar un ingrediente lo mete en
   tu inventario (un objeto "consumible").
2. En casa, un mueble de **cocina**: eliges una receta sencilla y los
   ingredientes se convierten en un **plato** (receta = combinar objetos).
3. Te lo comes, o lo sirves en la mesa para tus invitados.

Sobre el hambre, José lo quiere realista, entre Club Penguin y Habbo: nadie se
muere, pero hay que comer, y no comer no te impide hacer cosas. Estar bien
comido da ventajas pequeñas; tener hambre se nota, pero nunca bloquea. El
diseño, en `plan-piramide.md`.

## 5. Moda y caras (con calma)

Tienes razón: con todos de cara redonda, la ropa no luce y todo el mundo se
parece. La buena noticia es que el avatar se genera en 3D, así que **las caras
se modelan una vez y valen para las 8 direcciones y todas las poses**.

**Rasgos, por capas:**

- **Forma de cara:** redonda, ovalada, cuadrada, alargada, en corazón; y
  mandíbula y mentón.
- **Ojos** (forma y color), **cejas**, **nariz** (varios tipos), **boca y
  labios**, **orejas**.
- **Detalles:** pecas, lunares, barba, bigote, perilla.
- **Complexión y altura:** delgada, media, ancha; dos o tres alturas.
- **Más tonos de piel**, con subtonos (cálidos, fríos, neutros).

**Sobre las nacionalidades**, una idea con cariño: mejor **ofrecer rasgos**
que etiquetar países. Si hay suficientes formas de ojos, narices, labios,
pelos y tonos, cada persona se puede hacer a sí misma, venga de donde venga, y
evitamos caer en estereotipos (que alguien sienta que "su país" es una
caricatura). Si quieres, se pueden ofrecer **caras de partida** ya hechas
como inspiración, sin nombre de país.

**Peinados nuevos:** degradado (fade), mullet, trenzas, rastas, rizos,
flequillo emo, cresta, coletas altas, moño bajo, raya al lado...

**Estilos (tribus urbanas)**, cada uno un conjunto de prendas y accesorios:

| Estilo | Prendas |
|---|---|
| Urbano / streetwear | pantalón ancho, sudadera oversize, gorra, zapatillas altas |
| Emo | flequillo lateral, rayas, pitillo, cinturón de tachas |
| Rock / metal | chupa de cuero, camiseta de grupo, botas |
| Skater | pantalón cargo, camiseta ancha, zapatillas planas |
| Deportivo, formal, gótico... | lo que vaya pidiendo la gente |

Para que esto funcione, el avatar necesita:

- **Ranuras de accesorios:** cabeza (gorra, gorro), cara (gafas, piercings),
  cuello (cadenas), manos (pulseras).
- **Capas de ropa:** debajo y encima (camiseta y chaqueta a la vez).
- **Siluetas nuevas:** "ancho" es otra forma de pierna en el modelo 3D, no
  otro color.

**La moda da vida al mapa.** Cada barrio con su tienda y su estilo (el barrio
urbano vende streetwear; el de los bares, cuero), con **probador** (el
vestidor, dentro de la tienda: probar antes de comprar). Y **tendencias**:
prendas de temporada o ediciones limitadas. En Habbo los "raros" eran media
cultura del juego; aquí serían tus prendas especiales.

**Orden:** primero el sistema de caras y rasgos, porque es la identidad y la
base de todo lo demás; luego las ranuras de accesorios; y después los estilos
de dos en dos, mirando cada uno en las 8 direcciones.

## 6. Qué cambia por dentro

- **Salas como datos**, con tipo (casa, calle, tienda, trabajo) y dueño.
- **Casa propia:** al registrarte recibes un piso pequeño y apareces ahí.
- **Mapas grandes:** hoy el servidor manda a cada jugador la sala entera 20
  veces por segundo. En una calle con mucha gente, cada uno tiene que recibir
  sólo lo que tiene cerca (gestión de interés por zonas).
- **Memoria de avatares:** cada avatar en pantalla ocupa 1,8 MB de GPU. En una
  calle con 50 personas hay que generar sólo lo que se ve (direcciones y
  animaciones en uso) o bajar el tamaño de la hoja.
- **Amigos y presencia:** amistades, solicitudes, ajustes de privacidad y el
  evento de "compartir ubicación".

## 7. El orden

El orden por hitos (Mi primer piso → Salir a La Manzana → Vivir → Presumir →
La cima), con los cimientos que necesita cada uno, está en
`docs/plan-piramide.md`.
