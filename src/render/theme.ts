// Tema visual de cada sala: qué piezas del atlas usa y con qué colores se
// pinta su mobiliario. Es lo que hace que room1 y room2 no se parezcan.
//
// Los suelos NO están aquí: cada mapa de Tiled ya guarda los gid de su propio
// tema (ver `tools/genassets.mjs`), así que el suelo sale bien solo. Aquí vive
// lo que se dibuja por código: paredes, puerta y muebles.

import type { RoomId } from "../net/protocol";

/** Colores de una pieza de mobiliario, del tono claro al de sombra */
export type FurniturePalette = {
  sofaTop: number;
  sofaBack: number;
  sofaSideE: number;
  sofaSideO: number;
  sofaSeam: number;
  tableTop: number;
  tableSideE: number;
  tableSideO: number;
  tableLeg: number;
};

export type RoomTheme = {
  nombre: string;
  /** Frame de `walls.png` para la pared de la fila 0 (sube a la derecha) */
  wallRight: number;
  /** Frame para la pared de la columna 0 (sube a la izquierda) */
  wallLeft: number;
  door: { hoja: number; marco: number; pomo: number };
  furniture: FurniturePalette;
};

/** En `walls.png` cada tema ocupa 2 frames seguidos: derecha, izquierda */
const wallFrames = (tema: number) => ({ wallRight: tema * 2, wallLeft: tema * 2 + 1 });

export const ROOM_THEMES: Record<RoomId, RoomTheme> = {
  // Salón cálido: terracota y crema, muebles de madera y tapicería coral
  room1: {
    nombre: "Salón cálido",
    ...wallFrames(0),
    door: { hoja: 0x8b5a2b, marco: 0x4a2f18, pomo: 0xf1c40f },
    furniture: {
      sofaTop: 0xe8896b,
      sofaBack: 0xef9a7d,
      sofaSideE: 0xc05f42,
      sofaSideO: 0xa85038,
      sofaSeam: 0x8d3f2c,
      tableTop: 0xa37c56,
      tableSideE: 0x7a5b3c,
      tableSideO: 0x6b4f34,
      tableLeg: 0x5b4632,
    },
  },
  // Sala fría: índigo y turquesa, tapicería violeta y mesa de pizarra
  room2: {
    nombre: "Sala fría",
    ...wallFrames(1),
    door: { hoja: 0x3f4f8a, marco: 0x1b2540, pomo: 0x7fe3d1 },
    furniture: {
      sofaTop: 0x9b7ae8,
      sofaBack: 0xae90f2,
      sofaSideE: 0x6f52b8,
      sofaSideO: 0x5b429c,
      sofaSeam: 0x412f73,
      tableTop: 0x5c6c8c,
      tableSideE: 0x44526d,
      tableSideO: 0x36425a,
      tableLeg: 0x28324a,
    },
  },
};

export function themeFor(room: RoomId): RoomTheme {
  return ROOM_THEMES[room];
}
