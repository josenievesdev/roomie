import type { Facing } from "../state/avatarState.ts";
import type { Look } from "../state/look.ts";
import type { ModoChat } from "../state/normas.ts";
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

/**
 * Las salas. La primera es la entrada del juego: la Plaza de la Llave, la
 * primera zona de La Manzana. Las otras dos son edificios de la plaza.
 */
export const ROOMS = ["plaza", "room1", "room2"] as const;
/** Una sala fija del juego: su mapa está en `public/assets/<id>.json` */
export type SalaFija = (typeof ROOMS)[number];
/**
 * La casa de un jugador: "casa:" + el id de su fila en la tabla `rooms`. Su
 * mapa no está en los ficheros del juego: lo manda el servidor (`salaDatos`).
 */
export type CasaId = `casa:${string}`;
export type RoomId = SalaFija | CasaId;

export function esSalaFija(v: unknown): v is SalaFija {
  return typeof v === "string" && (ROOMS as readonly string[]).includes(v);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esCasa(v: unknown): v is CasaId {
  return typeof v === "string" && v.startsWith("casa:") && UUID.test(v.slice(5));
}

/**
 * ¿Tiene forma de sala? Ojo: que exista una casa no quiere decir que se
 * pueda entrar en ella; eso lo decide el servidor con `src/state/normas.ts`.
 */
export function isRoomId(v: unknown): v is RoomId {
  return esSalaFija(v) || esCasa(v);
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

/** Cómo se ve un avatar: estilos y colores del catálogo (`src/state/look.ts`) */
export type { Look };

/** Estado visible de un jugador, tal y como lo decide el servidor */
export type PlayerView = {
  id: string;
  name: string;
  room: RoomId;
  col: number;
  row: number;
  /** 0..7, ver `Facing`. Sentado, hacia donde mira el asiento. */
  facing: Facing;
  sitting: boolean;
  moving: boolean;
  /**
   * El aspecto, en código compacto (`codificarLook` en src/state/look.ts):
   * viaja en cada instantánea, 20 veces por segundo por jugador, y como
   * objeto eran unos 400 bytes. Se lee con `decodificarLook`.
   */
  look: string;
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
  /** Sólo al registrarse, y obligatoria: "AAAA-MM-DD" (ver `src/state/normas.ts`) */
  nacimiento?: string;
};

/** Reanudar con el token guardado, sin volver a teclear la contraseña */
export type ResumePayload = { token: string };

export type AuthOkPayload = {
  /** Se guarda en el navegador; es lo único que conserva de su identidad */
  token: string;
  username: string;
  nickname: string;
  look: Look;
  /** Tus monedas (las que se ganan jugando) */
  saldo: number;
  /** Tus créditos (se comprarán con dinero real; de momento, 0) */
  creditos: number;
  /**
   * Cómo hablas: con frases del menú o con texto propio. Lo decide el
   * servidor por tu edad; tu edad en sí no viaja nunca.
   */
  modoChat: ModoChat;
  /** Cuenta de antes: falta la fecha de nacimiento y no se entra sin ella */
  necesitaNacimiento: boolean;
  /** Nombres de quienes has bloqueado */
  bloqueados: string[];
  /** Tu casa, o null si aún no te han dado las llaves */
  casa: CasaInfo | null;
  /** Desde cuándo tienes la cuenta, "AAAA-MM" (sale en tu perfil) */
  desde: string | null;
};

/** Tu casa: su sala y cómo se llama */
export type CasaInfo = { id: CasaId; nombre: string };

/**
 * Lo que se ve en el perfil de otro jugador. Poco, a propósito: el nombre y
 * el aspecto (que ya se ven en la sala) y desde cuándo juega. Nunca la edad,
 * ni dónde vive, ni con quién habla. Quién puede verlo lo decide
 * `puedeVerPerfil` en src/state/normas.ts.
 */
export type PerfilPublico = { id: string; nombre: string; look: Look; desde: string | null };

// ---------------------------------------------------------------- Economía
//
// Dos monedas: las monedas se ganan jugando; los créditos se comprarán con
// dinero real (todavía no). Los precios los pone SIEMPRE el servidor.

export type Moneda = "monedas" | "creditos";
export type Saldos = { monedas: number; creditos: number };

/** Secciones de la tienda */
export type CategoriaTienda = "salon" | "dormitorio" | "fiesta" | "deco" | "pared";

/** Un artículo de la tienda */
export type ArticuloTienda = { code: string; nombre: string; precio: number; moneda: Moneda; categoria: CategoriaTienda };

/** Algo tuyo que no está puesto en ninguna sala (en tu mochila) */
export type CosaMochila = { id: string; code: string };

/** Poner (o mover) un objeto tuyo en tu casa. `rot` 1 = girado. */
export type ColocarPayload = { item: string; col: number; row: number; rot: number };

/** Cómo salió una compra, una venta o colocar algo: para avisar en pantalla */
export type ResultadoPayload = { ok: boolean; texto: string };

/** Un mueble puesto en una sala (una fila de la tabla `items`) */
export type MuebleColocado = { id: string; code: string; col: number; row: number; rot: number };

/**
 * Lo que hace falta para dibujar una sala que no está en los ficheros del
 * juego (una casa): su mapa, con el mismo formato de Tiled, y sus muebles.
 */
export type SalaDatosPayload = { id: RoomId; mapa: unknown; muebles: MuebleColocado[] };

export type AuthErrorCode =
  | "BAD_CREDENTIALS"
  | "USERNAME_TAKEN"
  | "NICKNAME_TAKEN"
  | "INVALID"
  | "RATE_LIMITED"
  | "NO_DB"
  /** Por debajo de la edad mínima: no se puede crear la cuenta */
  | "UNDER_AGE";

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
  /** Si es una frase del menú, su id (`src/state/frases.ts`) */
  frase?: string;
};

/** Por qué se reporta a alguien (lo que ve quien reporta, en palabras sencillas) */
export type MotivoReporte = "acoso" | "lenguaje" | "datos" | "otro";

export type ReportePayload = {
  /** id del jugador reportado (el de `PlayerView`) */
  jugador: string;
  motivo: MotivoReporte;
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
  /** Cambió el aspecto (vestidor) */
  look: (look: Look) => void;
  /** Cruzó una puerta: cambia de sala en el servidor */
  room: (p: RoomPayload) => void;
  /** Mensaje de chat con texto propio (los niños no pueden: ver `frase`) */
  chat: (text: string) => void;
  /** Una frase o un gesto del menú, por su id */
  frase: (id: string) => void;
  /** Cuenta de antes: la fecha de nacimiento que faltaba ("AAAA-MM-DD") */
  nacimiento: (fecha: string) => void;
  /** Reportar a un jugador de la sala */
  reportar: (p: ReportePayload) => void;
  /** Dejar de recibir lo que dice un jugador (por su id) */
  bloquear: (jugador: string) => void;
  desbloquear: (jugador: string) => void;
  /** En la portería: recoger las llaves de tu piso (se da una sola vez) */
  llaves: () => void;
  /** Ir a tu casa: el servidor contesta con `salaDatos` y ya se puede entrar */
  irACasa: () => void;
  /** Pedir la tienda (contesta `tienda`) */
  tienda: () => void;
  /** Comprar un artículo de la tienda, por su código */
  comprar: (code: string) => void;
  /** Pedir tu mochila (contesta `mochila`) */
  mochila: () => void;
  /** Vender algo de tu mochila (la tienda lo recompra por la mitad) */
  vender: (item: string) => void;
  /** Poner o mover un objeto tuyo en tu casa */
  colocar: (p: ColocarPayload) => void;
  /** Guardar en la mochila un objeto puesto en tu casa */
  recoger: (item: string) => void;
  /** Ver el perfil de otro jugador de tu sala (contesta `perfil`, si las normas lo dejan) */
  perfil: (jugador: string) => void;
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
  /** Tu lista de bloqueados cambió */
  bloqueos: (p: { bloqueados: string[] }) => void;
  /** Ya tienes casa (la portera te dio las llaves) */
  casa: (p: CasaInfo) => void;
  /** El mapa y los muebles de una sala que no está en los ficheros (tu casa) */
  salaDatos: (p: SalaDatosPayload) => void;
  /** Lo que vende la tienda */
  tienda: (p: { articulos: ArticuloTienda[] }) => void;
  /** Lo que tienes en la mochila */
  mochila: (p: { cosas: CosaMochila[] }) => void;
  /** Tus saldos cambiaron */
  saldo: (p: Saldos) => void;
  /** Los muebles de una sala cambiaron (alguien decoró su casa) */
  muebles: (p: { sala: RoomId; muebles: MuebleColocado[] }) => void;
  /** Cómo salió lo último que pediste (compra, venta, colocar) */
  resultado: (p: ResultadoPayload) => void;
  /** El perfil que pediste */
  perfil: (p: PerfilPublico) => void;
}
