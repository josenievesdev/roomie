// Tema visual de cada sala: qué piezas del atlas usa y con qué colores se
// pinta lo que se dibuja por código. Es lo que hace que cada sala tenga
// personalidad propia en vez de ser la misma caja repintada.
//
// Los suelos NO están aquí: cada mapa de Tiled ya guarda los gid de su propio
// tema (ver `tools/genassets.mjs`), así que el suelo sale bien solo.
//
// La paleta es SEMÁNTICA y corta a propósito: "madera", "metal", "acento". Los
// tonos intermedios (luz y sombra de cada cara) se derivan en el dibujo, así
// que añadir un mueble no obliga a inventar seis colores nuevos por sala.

import type { RoomId } from "../net/protocol";

export type RoomPalette = {
  /** Tela: sofás y taburetes */
  tapizado: number;
  /** Superficies: mesas, barra */
  madera: number;
  /** Patas, postes, carcasas */
  metal: number;
  /** El color que da vida: dorado en el salón, neón en el club */
  acento: number;
  alfombra: number;
  /** Hojas de las plantas */
  planta: number;
  maceta: number;
};

export type RoomTheme = {
  /** Nombre de la sala, el que sale en el HUD */
  nombre: string;
  /** Frame de `walls.png` para la pared de la fila 0 (sube a la derecha) */
  wallRight: number;
  /** Frame para la pared de la columna 0 (sube a la izquierda) */
  wallLeft: number;
  door: { hoja: number; marco: number; pomo: number };
  palette: RoomPalette;
};

/** En `walls.png` cada tema ocupa 2 frames seguidos: derecha, izquierda */
const wallFrames = (tema: number) => ({ wallRight: tema * 2, wallLeft: tema * 2 + 1 });

export const ROOM_THEMES: Record<RoomId, RoomTheme> = {
  // La Plaza de la Llave: la calle. Piedra, hierro oscuro en las farolas,
  // madera cálida en los bancos y el oro de la Llave. (Las paredes no se usan:
  // al aire libre van fachadas, que dice el mapa.)
  plaza: {
    nombre: "Plaza de la Llave",
    ...wallFrames(2),
    door: { hoja: 0x6b4a32, marco: 0x3a2a1e, pomo: 0xf1c40f },
    palette: {
      tapizado: 0xb5484a,
      madera: 0xa06a3c, // bancos
      metal: 0x3f4654, // hierro de las farolas
      acento: 0xf2c14e, // el oro de la Llave
      alfombra: 0xb5484a,
      planta: 0x4f9d57,
      maceta: 0x9a9282,
    },
  },
  // Recibidor: terracota y crema, madera, latón y plantas
  room1: {
    nombre: "Salón Central",
    ...wallFrames(0),
    door: { hoja: 0x8b5a2b, marco: 0x4a2f18, pomo: 0xf1c40f },
    palette: {
      tapizado: 0xe8896b, // coral
      madera: 0xa37c56,
      metal: 0xb08d57, // latón
      acento: 0xf0c987, // dorado
      alfombra: 0xb5484a, // alfombra granate
      planta: 0x4f9d57,
      maceta: 0xb5623c,
    },
  },
  // Club nocturno: índigo, violeta y neón menta
  room2: {
    nombre: "Club Neón",
    ...wallFrames(1),
    door: { hoja: 0x3f4f8a, marco: 0x1b2540, pomo: 0x7fe3d1 },
    palette: {
      tapizado: 0x9b7ae8, // violeta
      madera: 0x5c6c8c, // pizarra
      metal: 0x8f9bb3,
      acento: 0x7fe3d1, // neón menta
      // Pista de baile violeta con líneas menta (el acento): turquesa, como
      // antes, desaparecía sobre el suelo turquesa
      alfombra: 0x5b3f9e,
      planta: 0x3fa08a,
      maceta: 0x2b3a63,
    },
  },
};

export function themeFor(room: RoomId): RoomTheme {
  return ROOM_THEMES[room];
}
