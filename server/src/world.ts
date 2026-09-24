import { readFileSync } from "node:fs";
import type { RoomId } from "../../src/net/protocol.ts";
import type { Cell } from "../../src/utils/pathfinding.ts";

// Carga las salas de Tiled (los MISMOS JSON que usa el navegador) y construye
// el mundo que necesita `AvatarState`: celdas, colisiones y celdas especiales.
// Ni Phaser ni Tiled aquí: sólo JSON plano.

type TiledObject = {
  type?: string;
  class?: string;
  properties?: { name: string; value: unknown }[];
};

type TiledLayer = {
  name: string;
  type: string;
  data?: number[];
  objects?: TiledObject[];
};

type TiledMap = {
  width: number;
  height: number;
  layers: TiledLayer[];
};

export type RoomWorld = {
  cols: number;
  rows: number;
  blocked: boolean[][];
  /** Celdas de sofá: se puede terminar un camino ahí (y sentarse) */
  sitCells: Set<string>;
  /** Celdas de puerta: meta válida aunque estén bloqueadas */
  doorCells: Set<string>;
  isBlocked(col: number, row: number): boolean;
  /** Celda libre más cercana al centro (respaldo de spawn) */
  freeCell(): Cell;
};

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function intProp(
  props: { name: string; value: unknown }[] | undefined,
  name: string,
): number | undefined {
  const p = props?.find((x) => x.name === name);
  return typeof p?.value === "number" ? p.value : undefined;
}

/** Lee una sala de Tiled y devuelve el mundo del servidor */
export function loadWorld(assetsDir: string, roomId: RoomId): RoomWorld {
  const raw = readFileSync(`${assetsDir}/${roomId}.json`, "utf8");
  const map = JSON.parse(raw) as TiledMap;
  const cols = map.width;
  const rows = map.height;

  const blocked: boolean[][] = Array.from({ length: rows }, () =>
    Array<boolean>(cols).fill(false),
  );

  const floor = map.layers.find((l) => l.name === "colisiones");
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      blocked[row][col] = (floor?.data?.[row * cols + col] ?? 0) !== 0;
    }
  }

  const sitCells = new Set<string>();
  const doorCells = new Set<string>();

  // La capa "objetos" coloca mobiliario y puertas (mismas reglas que el cliente)
  const objs = map.layers.find((l) => l.name === "objetos");
  for (const o of objs?.objects ?? []) {
    const kind = o.type || o.class;
    const col = intProp(o.properties, "col");
    const row = intProp(o.properties, "row");
    if (col === undefined || row === undefined) continue;
    if (col < 0 || row < 0 || col >= cols || row >= rows) continue;

    if (kind === "puerta") {
      doorCells.add(cellKey(col, row));
      continue; // ya viene bloqueada por la capa de colisiones
    }
    if (kind === "sofa") {
      sitCells.add(cellKey(col, row));
      blocked[row][col] = true;
    } else if (kind === "mesa") {
      blocked[row][col] = true;
    }
  }

  const isBlocked = (col: number, row: number): boolean => blocked[row][col];

  const freeCell = (): Cell => {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = (cx + c) % cols;
        const row = (cy + r) % rows;
        if (!blocked[row][col]) return { col, row };
      }
    }
    return { col: cx, row: cy };
  };

  return { cols, rows, blocked, sitCells, doorCells, isBlocked, freeCell };
}

/** Carga todas las salas del juego */
export function loadWorlds(
  assetsDir: string,
  rooms: readonly RoomId[],
): Map<RoomId, RoomWorld> {
  const map = new Map<RoomId, RoomWorld>();
  for (const room of rooms) map.set(room, loadWorld(assetsDir, room));
  return map;
}
