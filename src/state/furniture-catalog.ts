// Catálogo de mobiliario. Módulo PURO (sin Phaser): lo importan el cliente
// para dibujar y el SERVIDOR para las colisiones.
//
// Que sea uno solo es lo que impide el peor bug posible de este juego: que el
// cliente crea que una celda está libre y el servidor no. Antes cada lado
// tenía su propia lista de `if (kind === "sofa")`, y añadir un mueble obligaba
// a tocar los dos y acordarse de los dos.
//
// Para añadir mobiliario nuevo: una entrada aquí + una función de dibujo en
// `src/entities/furniture.ts`. Nada más.

import type { Facing, SitTarget } from "./avatarState.ts";

export type FurnitureDef = {
  /** ¿Ocupa la celda? (el A* no podrá atravesarla) */
  blocks: boolean;
  /**
   * Si es un asiento: a qué altura (px de pantalla) está la superficie donde
   * se apoya el trasero, y hacia dónde mira quien se sienta. Lo usan el
   * servidor (hacia dónde mira) y el cliente (a qué altura dibujarlo).
   */
  sit?: { alto: number; dir: Facing };
  /** Sólo para leer el código: qué es */
  nombre: string;
};

export const FURNITURE: Record<string, FurnitureDef> = {
  // --- Asientos ---
  // El sofá tiene el respaldo en el borde noreste: se mira al suroeste (5)
  sofa: { nombre: "Sofá", blocks: true, sit: { alto: 14, dir: 5 } },
  // Los taburetes están delante de la barra, que queda al este de la
  // rejilla (+col): se mira al sureste (3), de cara al mostrador
  taburete: { nombre: "Taburete", blocks: true, sit: { alto: 30, dir: 3 } },

  // --- Superficies ---
  mesa: { nombre: "Mesa auxiliar", blocks: true },
  barra: { nombre: "Barra / mostrador", blocks: true },

  // --- Decoración que estorba ---
  planta: { nombre: "Planta", blocks: true },
  lampara: { nombre: "Lámpara de pie", blocks: true },
  altavoz: { nombre: "Altavoz", blocks: true },

  // --- Decoración que NO estorba (se pisa) ---
  alfombra: { nombre: "Alfombra / pista", blocks: false },
};

export type FurnitureKind = keyof typeof FURNITURE;

export function isFurniture(kind: string | undefined): kind is FurnitureKind {
  return kind !== undefined && kind in FURNITURE;
}

/** ¿Es un asiento? (lo usan el A* del cliente y la validación del servidor) */
export function isSeat(kind: string | undefined): boolean {
  return isFurniture(kind) && FURNITURE[kind].sit !== undefined;
}

/** El asiento de un mueble en una celda, listo para `AvatarState` (o null) */
export function seatAt(kind: string | undefined, col: number, row: number): SitTarget | null {
  if (!isFurniture(kind)) return null;
  const s = FURNITURE[kind].sit;
  return s ? { col, row, alto: s.alto, dir: s.dir } : null;
}
