import { readFileSync } from "node:fs";
import { FURNITURE, isFurniture, seatAt } from "../../src/state/furniture-catalog.ts";
import type { SitTarget } from "../../src/state/avatarState.ts";
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
  /** El asiento de cada celda de `sitCells`: altura y hacia dónde se mira */
  seats: Map<string, SitTarget>;
  /** Celdas de puerta: meta válida aunque estén bloqueadas */
  doorCells: Set<string>;
  isBlocked(col: number, row: number): boolean;
  /** Celda libre más cercana al centro (respaldo de spawn) */
  freeCell(): Cell;
  /**
   * Celda libre más cercana a `from` que no esté `taken` (ocupada por otro
   * avatar). La propia `from` vale si cumple. Búsqueda en anchura: la
   * primera que aparece es la más cercana en pasos.
   */
  nearestFree(from: Cell, taken: (col: number, row: number) => boolean): Cell;
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
  const seats = new Map<string, SitTarget>();
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
    // Las reglas salen del CATÁLOGO, el mismo que usa el cliente. Antes había
    // aquí una lista de `if` propia y añadir un mueble obligaba a acordarse de
    // los dos lados; si se olvidaba uno, cliente y servidor discrepaban sobre
    // qué celdas están libres.
    if (!isFurniture(kind)) continue;
    const def = FURNITURE[kind];
    // Girado (un banco mirando al sureste): el asiento mira hacia otro lado
    const seat = seatAt(kind, col, row, intProp(o.properties, "girado") === 1);
    if (seat) {
      sitCells.add(cellKey(col, row));
      seats.set(cellKey(col, row), seat);
    }
    if (def.blocks) blocked[row][col] = true;
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

  const nearestFree = (from: Cell, taken: (col: number, row: number) => boolean): Cell => {
    const seen = new Set<string>([cellKey(from.col, from.row)]);
    const queue: Cell[] = [from];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      if (!blocked[c.row][c.col] && !taken(c.col, c.row)) return c;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const n = { col: c.col + dc, row: c.row + dr };
          if (n.col < 0 || n.row < 0 || n.col >= cols || n.row >= rows) continue;
          const key = cellKey(n.col, n.row);
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push(n);
        }
      }
    }
    return from; // sala llena: mejor solaparse que no entrar
  };

  return { cols, rows, blocked, sitCells, seats, doorCells, isBlocked, freeCell, nearestFree };
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
