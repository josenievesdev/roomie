import type { Facing } from "../state/avatarState";

// Guardado persistente del juego en localStorage.
// Cuando exista servidor, este módulo será el que haga sync con la API.
export type SaveData = {
  version: number;
  room: string;
  col: number;
  row: number;
  facing: Facing;
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
    return data as SaveData;
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
