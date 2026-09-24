import type { Facing } from "../state/avatarState";
import { DEFAULT_PALETTE } from "../state/palette";

// Guardado persistente del juego en localStorage.
// Cuando exista servidor, este módulo será el que haga sync con la API.
export type SaveData = {
  version: number;
  room: string;
  col: number;
  row: number;
  facing: Facing;
  shirt: number;
  hair: number;
  nickname: string;
};

const KEY = "roomie:save";
const VERSION = 1;

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SaveData> | null;
    if (!data || typeof data !== "object") return null;
    if (data.version !== VERSION) return null;
    if (typeof data.room !== "string") return null;
    if (typeof data.col !== "number" || !Number.isFinite(data.col)) return null;
    if (typeof data.row !== "number" || !Number.isFinite(data.row)) return null;
    if (data.facing !== "down" && data.facing !== "up" && data.facing !== "side") return null;
    if (typeof data.nickname !== "string") return null;
    return {
      version: VERSION,
      room: data.room,
      col: data.col,
      row: data.row,
      facing: data.facing,
      // Paleta: con defaults para guardados antiguos que no la traían
      shirt:
        typeof data.shirt === "number" && Number.isFinite(data.shirt)
          ? data.shirt
          : DEFAULT_PALETTE.shirt,
      hair:
        typeof data.hair === "number" && Number.isFinite(data.hair)
          ? data.hair
          : DEFAULT_PALETTE.hair,
      nickname: data.nickname.trim().slice(0, 16),
    };
  } catch {
    return null; // localStorage no disponible o dato corrupto
  }
}

export function writeSave(data: Omit<SaveData, "version">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...data }));
  } catch {
    // modo privado / cuota llena: el juego sigue funcionando sin guardar
  }
}

/** Borra el guardado (logout) */
export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
