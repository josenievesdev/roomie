# Fase 2.11 — Decoración con temática, y el catálogo que la hace posible

**Fecha:** 24 de septiembre de 2026

## Lo importante no es la decoración, es cómo se añade

Antes, meter un mueble nuevo eran **cuatro sitios**: el tipo en la unión de
TypeScript, la función de dibujo, un `if` en el cliente para decidir si bloquea
y **otro `if` distinto en el servidor**. Olvidar el del servidor significa que
el cliente cree que una celda está libre y el servidor no: la peor clase de bug
de este juego, y la más difícil de ver.

Ahora hay **un catálogo**, `src/state/furniture-catalog.ts`, módulo puro que
importan los dos lados:

```ts
export const FURNITURE = {
  sofa:     { nombre: "Sofá",           blocks: true, sit: true },
  taburete: { nombre: "Taburete",       blocks: true, sit: true },
  barra:    { nombre: "Barra",          blocks: true },
  planta:   { nombre: "Planta",         blocks: true },
  alfombra: { nombre: "Alfombra/pista", blocks: false },
  ...
};
```

`server/src/world.ts` y `MainScene.buildRoom` leen de ahí. Añadir mobiliario
son ahora **dos** sitios: una entrada en el catálogo y una función de dibujo.

Comprobado automáticamente: los asientos que declara el catálogo coinciden con
los que ve el servidor en las dos salas (3 y 4), y las alfombras no bloquean.

## Muebles nuevos

Seis, todos dibujados con las mismas reglas de volumen que el sofá y la mesa
(tres tonos por cara, contorno en el propio color, sombra en el suelo):

| pieza | estorba | sentarse |
|---|---|---|
| barra / mostrador | sí | no |
| taburete | sí | **sí** |
| planta | sí | no |
| lámpara de pie | sí | no |
| altavoz | sí | no |
| alfombra / pista | **no** | no |

Sentarse dejó de ser "si es un sofá" y pasó a ser "si el catálogo dice que es
un asiento": los taburetes de la barra funcionan sin tocar nada más.

## Las salas tienen ahora un para qué

- **room1 — Plaza Central**: zona de estar sobre una alfombra granate (sofá y
  mesa), mostrador de recepción con dos taburetes, tres plantas y una lámpara.
- **room2 — Club Neón**: pista de baile de 4×4 en el centro, barra de tres
  módulos con tres taburetes, dos altavoces de columna, reservado con sofá.

Comprobado por programa que las dos siguen siendo transitables, que se llega
del spawn a la puerta y que **ningún asiento queda inalcanzable**.

## Dos fallos encontrados por el camino

**Las alfombras no se veían.** Les puse una profundidad por *debajo* de su celda
para que no taparan a los avatares, y eso las metió debajo de la propia baldosa.
Tienen que ir entre las dos: la baldosa está en `worldDepth(y)` y el avatar en
`worldDepth(y) + 0.5`, así que la alfombra va en `+0.25`.

**Los taburetes parecían charcos.** El poste era un rectángulo de 6 px en color
latón sobre suelo terracota: a tamaño de juego, y medio tapado por la barra de
al lado, desaparecía. Rehechos con polígonos, base de disco y poste en dos
tonos.

## El smoke test ya no depende de la decoración

Fallaba al redecorar, porque daba por hecho que el sofá estaba en (4,2) y la
mesa en (7,5). Ahora **busca** en el mapa: el asiento sale de `room1.sitCells`,
y para la prueba de colisión recorre la sala hasta encontrar una celda libre
con un mueble al lado. Mover un mueble ya no rompe el test.

## Verificación

`typecheck`, `build`, smoke E2E (20 checks), aserciones de capas y la
comprobación de coherencia del catálogo: todo en verde. Revisado en navegador:
room1 con toda la decoración, mostrador y taburetes de cerca.

room2 se validó por programa (28 objetos, 4 asientos, transitable) pero no se
llegó a ver en pantalla: usa exactamente el mismo camino de código que room1.
