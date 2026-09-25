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

export type FurnitureDef = {
  /** ¿Ocupa la celda? (el A* no podrá atravesarla) */
  blocks: boolean;
  /** ¿Se puede terminar un camino aquí y sentarse? */
  sit?: boolean;
  /** Sólo para leer el código: qué es */
  nombre: string;
};

export const FURNITURE: Record<string, FurnitureDef> = {
  // --- Asientos ---
  sofa: { nombre: "Sofá", blocks: true, sit: true },
  taburete: { nombre: "Taburete", blocks: true, sit: true },

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
  return isFurniture(kind) && FURNITURE[kind].sit === true;
}
