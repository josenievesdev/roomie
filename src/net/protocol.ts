import type { Facing } from "../state/avatarState.ts";
import type { Palette } from "../state/palette.ts";
import type { Cell } from "../utils/pathfinding.ts";

// Protocolo cliente ↔ servidor. Módulo PURO (sin Phaser, sin Node): lo importa
// tanto el navegador (`src/net/client.ts`) como el servidor (`server/src/`).
// Si cambia este archivo, cambian las DOS partes a la vez.
//
// Diseño de la Fase 7:
// - El servidor SIMULA cada avatar con `AvatarState` (el mismo módulo puro que
//   usa el cliente) en un tick fijo → posiciones autoritativas.
// - El cliente predice localmente (igual que ahora) y sólo RENDERIZA a los
//   demás con lo que llega del servidor.
// - Mensajes con nombre de evento (socket.io), no con etiqueta "t".

export const ROOMS = ["room1", "room2"] as const;
export type RoomId = (typeof ROOMS)[number];

export function isRoomId(v: unknown): v is RoomId {
  return typeof v === "string" && (ROOMS as readonly string[]).includes(v);
}

/** px/s de pantalla para el teclado. Debe ser IGUAL en cliente y servidor. */
export const KEYBOARD_SPEED = 105;
/** ms por tick de simulación en el servidor (20 ticks/s) */
export const TICK_MS = 50;

export const NAME_MAX = 16;
export const USER_MIN = 3;
export const USER_MAX = 16;
export const PASS_MIN = 6;
export const PASS_MAX = 72;
export const CHAT_MAX = 60;
export const CHAT_COOLDOWN_MS = 400;
export const MAX_PATH_CELLS = 400;

/** Cómo se ve un avatar (paleta recoloreable en caliente) */
export type Look = Palette;

/** Estado visible de un jugador, tal y como lo decide el servidor */
export type PlayerView = {
  id: string;
  name: string;
  room: RoomId;
  col: number;
  row: number;
  facing: Facing;
  flip: boolean;
  sitting: boolean;
  moving: boolean;
  look: Look;
};

// ---------------------------------------------------------------- Identidad
//
// El nombre YA NO viaja en `join`. Antes el cliente decía cómo se llamaba y el
// servidor se lo creía, así que el nickname era una etiqueta que cada uno se
// ponía, no una identidad. Ahora sale de la cuenta autenticada y el cliente no
// puede elegirlo al entrar a una sala.

export type AuthMode = "login" | "register";

export type AuthPayload = {
  mode: AuthMode;
  username: string;
  password: string;
  /** Sólo al registrarse */
  nickname?: string;
  look?: Look;
};

/** Reanudar con el token guardado, sin volver a teclear la contraseña */
export type ResumePayload = { token: string };

export type AuthOkPayload = {
  /** Se guarda en el navegador; es lo único que conserva de su identidad */
  token: string;
  username: string;
  nickname: string;
  look: Look;
  saldo: number;
};

export type AuthErrorCode =
  | "BAD_CREDENTIALS"
  | "USERNAME_TAKEN"
  | "NICKNAME_TAKEN"
  | "INVALID"
  | "RATE_LIMITED"
  | "NO_DB";

export type AuthErrorPayload = { code: AuthErrorCode; message: string };

export type JoinPayload = {
  room: RoomId;
  col: number;
  row: number;
  facing: Facing;
};

export type RoomPayload = { room: RoomId; col: number; row: number; facing: Facing };

export type ChatPayload = {
  /** id de quien habla, o null si es un mensaje de sistema */
  from: string | null;
  name: string;
  room: RoomId;
  text: string;
  system: boolean;
};

/** Error al unirse (nickname duplicado, sala llena, etc.) */
export type JoinErrorPayload = { code: "DUPLICATE_NAME" | "ROOM_FULL" | "INVALID"; message: string };

/** Eventos que el cliente emite y el servidor escucha */
export interface ClientEvents {
  /** Crear cuenta o entrar con usuario y contraseña */
  auth: (p: AuthPayload) => void;
  /** Entrar con el token guardado de una sesión anterior */
  resume: (p: ResumePayload) => void;
  /** Cerrar sesión y olvidar el token */
  logout: () => void;
  /** Entrar (o reentrar) al mundo. Requiere estar autenticado. */
  join: (p: JoinPayload) => void;
  /** Teclado: ejes normalizados de PANTALLA (-1..1, diagonal ya escalada) */
  move: (mx: number, my: number) => void;
  /** Clic: camino de celdas calculado con A* por el cliente (sin start) */
  path: (path: Cell[]) => void;
  /** Segundo clic en el sofá: levantarse */
  stand: () => void;
  /** Cambió la paleta de ropa/pelo (tecla C) */
  look: (look: Look) => void;
  /** Cruzó una puerta: cambia de sala en el servidor */
  room: (p: RoomPayload) => void;
  /** Mensaje de chat */
  chat: (text: string) => void;
}

/** Eventos que el servidor emite y el cliente escucha */
export interface ServerEvents {
  /** Identidad confirmada: ya se puede `join` */
  authOk: (p: AuthOkPayload) => void;
  /** No se pudo entrar ni registrar */
  authError: (p: AuthErrorPayload) => void;
  /** Respuesta al `join`: tu id + todos los jugadores conectados */
  welcome: (p: { id: string; players: PlayerView[] }) => void;
  /** Error al unirse (nickname duplicado, etc.) */
  joinError: (p: JoinErrorPayload) => void;
  /** Snapshot a 20 Hz con los jugadores (emitted a la sala de cada uno) */
  players: (p: { players: PlayerView[] }) => void;
  /** Chat de sala (incluido el eco de tu propio mensaje) + avisos de sistema */
  chat: (p: ChatPayload) => void;
}
