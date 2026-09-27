import { FACING_SUR, isFacing, type Facing } from "../state/avatarState.ts";
import { sanitizeLook, type Look } from "../state/look.ts";

// Guardado persistente del juego en localStorage: dónde estabas y cómo ibas
// vestido ANTES de entrar (la vista previa del modal). Una vez dentro, el
// aspecto de verdad es el de la cuenta, que viene del servidor.
export type SaveData = {
  version: number;
  room: string;
  col: number;
  row: number;
  facing: Facing;
  look: Look;
  nickname: string;
};

const KEY = "roomie:save";
const VERSION = 2;

/** Dirección de la versión 1 ("down" / "up" / "side") a la de 8 */
const FACING_V1: Record<string, Facing> = { down: 4, up: 0, side: 6 };

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return null;
    if (data.version !== VERSION && data.version !== 1) return null;
    if (typeof data.room !== "string") return null;
    if (typeof data.col !== "number" || !Number.isFinite(data.col)) return null;
    if (typeof data.row !== "number" || !Number.isFinite(data.row)) return null;
    const facing = isFacing(data.facing)
      ? data.facing
      : (FACING_V1[String(data.facing)] ?? FACING_SUR);
    return {
      version: VERSION,
      room: data.room,
      col: data.col,
      row: data.row,
      facing,
      // La versión 1 guardaba `shirt` y `hair` sueltos: `sanitizeLook` los
      // convierte en el aspecto nuevo con los colores más parecidos.
      look: sanitizeLook(data.look ?? data),
      nickname: typeof data.nickname === "string" ? data.nickname.trim().slice(0, 16) : "",
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

// Control de edad: si alguien pone una fecha por debajo de la edad mínima, este
// navegador no deja volver a intentarlo en un día. Sin esto, bastaría con
// cambiar el año y darle otra vez. (No es infalible, pero es lo que piden las
// guías de control de edad: que mentir no sea lo más fácil.)
const KEY_EDAD = "roomie:edad-rechazada";
const DIA_MS = 24 * 60 * 60 * 1000;

export function marcarEdadRechazada(): void {
  try {
    localStorage.setItem(KEY_EDAD, String(Date.now()));
  } catch {
    // sin almacenamiento no hay freno; el servidor sigue rechazando
  }
}

export function edadRechazadaReciente(): boolean {
  try {
    const t = Number(localStorage.getItem(KEY_EDAD));
    return Number.isFinite(t) && t > 0 && Date.now() - t < DIA_MS;
  } catch {
    return false;
  }
}

// El zoom es una preferencia de este navegador, no de la partida: va aparte
// y sobrevive a cerrar sesión.
const KEY_ZOOM = "roomie:zoom";

/** Nivel de zoom guardado (1, 2, 3...), o null si no hay */
export function cargarZoom(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY_ZOOM));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function guardarZoom(nivel: number): void {
  try {
    localStorage.setItem(KEY_ZOOM, String(nivel));
  } catch {
    // sin localStorage el zoom vuelve a 1 al recargar, nada más
  }
}
