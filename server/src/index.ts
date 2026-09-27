import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { AvatarState, FACING_SUR, isFacing, type Facing } from "../../src/state/avatarState.ts";
import { sanitizeLook } from "../../src/state/look.ts";
import { toScreen } from "../../src/utils/iso.ts";
import { findPath, type Cell } from "../../src/utils/pathfinding.ts";
import {
  CHAT_COOLDOWN_MS,
  CHAT_MAX,
  KEYBOARD_SPEED,
  MAX_PATH_CELLS,
  NAME_MAX,
  PASS_MAX,
  PASS_MIN,
  ROOMS,
  TICK_MS,
  USER_MAX,
  USER_MIN,
  isRoomId,
  type AuthErrorCode,
  type AuthPayload,
  type ChatPayload,
  type ClientEvents,
  type JoinErrorPayload,
  type JoinPayload,
  type Look,
  type PlayerView,
  type ResumePayload,
  type RoomId,
  type ServerEvents,
} from "../../src/net/protocol.ts";
import { cellKey, loadWorlds, type RoomWorld } from "./world.ts";
import { cerrarSesion, entrar, purgar, reanudar, type Sesion } from "./db/auth.ts";
import { crearCuenta, guardarLook, nicknameLibre, nombreLibre } from "./db/repo.ts";

// Roomie — servidor multijugador (Fase 7).
//
// Autoridad: el servidor SIMULA cada avatar con `AvatarState` (el módulo puro
// del cliente, sin Phaser) en un tick fijo de 50 ms y emite el snapshot a 20 Hz.
// El cliente predice en local para que su movimiento sea instantáneo y sólo
// usa el servidor para dibujar a los DEMÁS.
//
// Ejecutar:  npm run dev   (dentro de server/, Node 24+ corre el .ts directo)

const PORT = Number(process.env.PORT ?? 3001);
const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "..", "public", "assets");

type Player = {
  id: string;
  /** Cuenta autenticada. El nombre sale de aquí, no de lo que diga el cliente. */
  accountId: string;
  name: string;
  room: RoomId;
  look: Look;
  world: RoomWorld;
  state: AvatarState;
  /** Ejes de teclado normalizados (-1..1) que llegaron del cliente */
  input: { mx: number; my: number };
  moving: boolean;
  lastMoveAt: number;
  lastChatAt: number;
};

const worlds = loadWorlds(ASSETS, ROOMS);
const players = new Map<string, Player>();

// ---------- Sanitizadores (NUNCA confíes en lo que llega por la red) ----------

const clampAxis = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;

function normalizeFacing(v: unknown): Facing {
  return isFacing(v) ? v : FACING_SUR;
}

function sanitizeName(v: unknown): string {
  const clean = String(v ?? "")
    .replace(/[^\p{L}\p{N} _\-.]/gu, "")
    .trim()
    .slice(0, NAME_MAX);
  return clean || "Huésped";
}

function sanitizeChat(v: unknown): string {
  return String(v ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, CHAT_MAX);
}

/** Nombre de usuario: letras, números y guiones. Nada más. */
function sanitizeUser(v: unknown): string {
  return String(v ?? "")
    .replace(/[^\p{L}\p{N}_.-]/gu, "")
    .trim()
    .slice(0, USER_MAX);
}

/**
 * Celda de entrada: la pedida si es válida, o la libre más cercana al centro.
 * Y en ambos casos, sin nadie encima: dos jugadores que cruzan la misma
 * puerta piden la misma celda y antes aparecían uno dentro del otro.
 */
function spawnCell(
  world: RoomWorld,
  col: unknown,
  row: unknown,
  taken: (col: number, row: number) => boolean,
): Cell {
  const pedida =
    typeof col === "number" &&
    typeof row === "number" &&
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    row >= 0 &&
    col < world.cols &&
    row < world.rows &&
    !world.isBlocked(col, row)
      ? { col, row }
      : world.freeCell();
  return world.nearestFree(pedida, taken);
}

/**
 * ¿Hay alguien plantado en esa celda de la sala? Quieto o sentado; quien va
 * andando no ocupa sitio (está de paso). Las puertas no se ocupan nunca: quien
 * llega a una está a punto de irse de la sala.
 *
 * Quien está sentado ocupa aunque en este paso se haya movido: al sentarse con
 * el teclado salta al centro del asiento, y ese salto no puede dejar el
 * asiento libre para otro que entre en el mismo paso.
 */
function occupied(room: RoomId, col: number, row: number, except: string): boolean {
  const world = worlds.get(room);
  if (world?.doorCells.has(cellKey(col, row))) return false;
  for (const p of players.values()) {
    if (p.id === except || p.room !== room) continue;
    if (p.moving && !p.state.sitting) continue;
    if (Math.round(p.state.col) === col && Math.round(p.state.row) === row) return true;
  }
  return false;
}

/**
 * El avatar autoritativo de un jugador en una sala. Cambiar de sala crea uno
 * nuevo, así que la sala puede quedar fija aquí dentro.
 */
function newState(id: string, room: RoomId, start: Cell, facing: Facing): AvatarState {
  const world = worlds.get(room)!;
  return new AvatarState(
    {
      cols: world.cols,
      rows: world.rows,
      isBlocked: world.isBlocked,
      isOccupied: (col, row) => occupied(room, col, row, id),
      // Las mismas puertas y asientos que ve el cliente: con el teclado se
      // entra en ellos igual en los dos lados
      isDoor: (col, row) => world.doorCells.has(cellKey(col, row)),
      seatAt: (col, row) => world.seats.get(cellKey(col, row)) ?? null,
    },
    start,
    facing,
  );
}

/**
 * Cuántas celdas puede ir el servidor por detrás del camino que manda el
 * cliente. El cliente calcula el camino desde donde SE VE (va por delante: su
 * entrada tarda en llegar aquí), así que al cambiar de rumbo en plena marcha
 * el camino empieza a dos celdas de donde el servidor lo tiene. Antes eso se
 * rechazaba sin avisar: el cliente seguía andando, el servidor no, y la
 * corrección acababa arrastrándolo hacia atrás. 3 celdas cubren ~600 ms de
 * retraso a 3 celdas/s; más allá ya no es retraso, es otra cosa.
 */
const MAX_BRIDGE = 3;

/**
 * Si el camino empieza a más de un paso del servidor, se le antepone un
 * tramo corto (A* sobre la misma sala) desde la posición autoritativa hasta
 * su primera celda. No da ventaja a nadie: el puente se recorre andando, a la
 * velocidad de siempre. Devuelve el camino tal cual si no hace falta puente,
 * o `null` si el hueco es demasiado grande.
 */
function bridged(world: RoomWorld, cells: unknown, from: Cell): unknown {
  if (!Array.isArray(cells) || cells.length === 0) return cells;
  const first = cells[0] as Partial<Cell> | null;
  if (!first || !Number.isInteger(first.col) || !Number.isInteger(first.row)) return cells;
  const head = first as Cell;
  const origin = { col: Math.round(from.col), row: Math.round(from.row) };
  const gap = Math.max(Math.abs(head.col - origin.col), Math.abs(head.row - origin.row));
  if (gap <= 1) return cells;
  if (gap > MAX_BRIDGE) return null;
  const key = cellKey(head.col, head.row);
  const special = cells.length === 1 && (world.sitCells.has(key) || world.doorCells.has(key));
  const puente = findPath(origin, head, world.cols, world.rows, world.isBlocked, special);
  if (!puente || puente.length > MAX_BRIDGE) return null;
  return [...puente, ...cells.slice(1)];
}

/**
 * Un camino del cliente sólo es válido si: empieza CERCA de donde estás ahora,
 * celdas enteras dentro de la sala, saltos de 8 vecinos (nada de teletransporte),
 * intermedias libres y la última libre o bien sofá/puerta (las mismas reglas
 * del A* del cliente).
 */
function validPath(world: RoomWorld, cells: unknown, from: Cell): cells is Cell[] {
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_PATH_CELLS) {
    return false;
  }
  const origin = { col: Math.round(from.col), row: Math.round(from.row) };
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Partial<Cell> | null;
    if (
      !c ||
      typeof c.col !== "number" ||
      typeof c.row !== "number" ||
      !Number.isInteger(c.col) ||
      !Number.isInteger(c.row)
    ) {
      return false;
    }
    if (c.col < 0 || c.row < 0 || c.col >= world.cols || c.row >= world.rows) {
      return false;
    }
    if (i > 0) {
      const p = cells[i - 1] as Cell;
      if (Math.max(Math.abs(c.col - p.col), Math.abs(c.row - p.row)) !== 1) return false;
    } else if (Math.max(Math.abs(c.col - origin.col), Math.abs(c.row - origin.row)) > 1) {
      return false; // el camino no puede empezar lejos del avatar
    }
    if (world.isBlocked(c.col, c.row)) {
      const last = i === cells.length - 1;
      const key = cellKey(c.col, c.row);
      const special = world.sitCells.has(key) || world.doorCells.has(key);
      if (!last || !special) return false;
    }
  }
  return true;
}

// ---------- Simulación ----------

/** Un paso del avatar: MISMO código que ejecuta el cliente en su update() */
function step(p: Player, dt: number): void {
  // Entrada huérfana: si dejaron de mandar `move` con teclas pulsadas
  // (pestaña congelada), se corta a los 1 s para no caminar eternamente.
  const stale = Date.now() - p.lastMoveAt > 1000;
  const mx = stale ? 0 : p.input.mx;
  const my = stale ? 0 : p.input.my;

  const before = toScreen(p.state.col, p.state.row);
  if (mx !== 0 || my !== 0) {
    p.state.keyboardMove(mx * KEYBOARD_SPEED * dt, my * KEYBOARD_SPEED * dt);
  } else {
    p.state.tick(dt);
  }
  const after = toScreen(p.state.col, p.state.row);

  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const moved = Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6;
  p.moving = moved;
  if (moved && !p.state.sitting) p.state.updateFacing(dx, dy);
}

function view(p: Player): PlayerView {
  return {
    id: p.id,
    name: p.name,
    room: p.room,
    col: p.state.col,
    row: p.state.row,
    facing: p.state.facing,
    sitting: p.state.sitting !== null,
    moving: p.moving && p.state.sitting === null,
    look: p.look,
  };
}

const allViews = (): PlayerView[] => [...players.values()].map(view);

function system(room: RoomId, text: string): void {
  const msg: ChatPayload = { from: null, name: "sistema", room, text, system: true };
  io.to(room).emit("chat", msg);
}

function enterRoom(socket: Socket<ClientEvents, ServerEvents>, p: Player, room: RoomId): void {
  if (p.room === room) return;
  socket.leave(p.room);
  system(p.room, `${p.name} salió de la sala`);
  p.room = room;
  socket.join(room);
  system(room, `${p.name} entró a la sala`);
}

// ---------- Servidor ----------

const httpServer = createServer();
const io = new Server<ClientEvents, ServerEvents>(httpServer, {
  // Por el proxy de Vite todo llega en same-origin; el CORS abierto sólo
  // sirve de red de seguridad si alguien conecta directo a :3001.
  cors: { origin: "*" },
  serveClient: false,
});

/** Quién es cada socket. Sin entrada aquí, el socket no puede `join`. */
const sesiones = new Map<string, Sesion>();

io.on("connection", (socket) => {
  let me: Player | null = null;

  const fallo = (code: AuthErrorCode, message: string): void => {
    socket.emit("authError", { code, message });
  };

  /** Confirma la identidad al cliente y la deja lista para `join` */
  const confirmar = (s: Sesion): void => {
    sesiones.set(socket.id, s);
    socket.emit("authOk", {
      token: s.token,
      username: s.account.username,
      nickname: s.avatar.nickname,
      look: sanitizeLook(s.avatar.look),
      saldo: s.saldo,
    });
  };

  socket.on("auth", async (p: AuthPayload) => {
    try {
      const username = sanitizeUser(p?.username);
      const password = String(p?.password ?? "");

      if (username.length < USER_MIN) {
        return fallo("INVALID", `El usuario necesita al menos ${USER_MIN} caracteres.`);
      }
      if (password.length < PASS_MIN || password.length > PASS_MAX) {
        return fallo("INVALID", `La contraseña necesita entre ${PASS_MIN} y ${PASS_MAX} caracteres.`);
      }

      if (p?.mode === "register") {
        const nickname = sanitizeName(p?.nickname);
        if (!(await nombreLibre(username))) {
          return fallo("USERNAME_TAKEN", `El usuario "${username}" ya existe.`);
        }
        if (!(await nicknameLibre(nickname))) {
          return fallo("NICKNAME_TAKEN", `El nombre "${nickname}" ya está cogido.`);
        }
        const creada = await crearCuenta(username, password, nickname, sanitizeLook(p?.look));
        // Recién creada, se entra directo: no tiene sentido pedir la
        // contraseña que acaba de escribir.
        const s = await entrar(username, password);
        if ("error" in s) return fallo(s.error, "No se pudo iniciar la sesión recién creada.");
        console.log(`[roomie] alta: ${username} (${creada.avatar.nickname})`);
        return confirmar(s);
      }

      const s = await entrar(username, password);
      if ("error" in s) {
        return s.error === "RATE_LIMITED"
          ? fallo("RATE_LIMITED", "Demasiados intentos fallidos. Prueba dentro de un rato.")
          : fallo("BAD_CREDENTIALS", "Usuario o contraseña incorrectos.");
      }
      confirmar(s);
    } catch (e) {
      console.error("[roomie] auth:", e);
      fallo("NO_DB", "No se pudo hablar con la base de datos.");
    }
  });

  socket.on("resume", async (p: ResumePayload) => {
    try {
      const datos = await reanudar(String(p?.token ?? ""));
      if (!datos) return fallo("BAD_CREDENTIALS", "La sesión caducó.");
      confirmar({ ...datos, token: String(p.token) });
    } catch (e) {
      console.error("[roomie] resume:", e);
      fallo("NO_DB", "No se pudo hablar con la base de datos.");
    }
  });

  socket.on("logout", async () => {
    const s = sesiones.get(socket.id);
    sesiones.delete(socket.id);
    if (me) {
      players.delete(me.id);
      system(me.room, `${me.name} salió de la sala`);
      me = null;
    }
    if (s) await cerrarSesion(s.token).catch(() => {});
  });

  socket.on("join", (payload: JoinPayload) => {
    if (me) return; // ya estaba dentro

    // Sin identidad no se entra. El nombre y el aspecto salen de la cuenta:
    // el cliente ya no puede decir cómo se llama.
    const sesion = sesiones.get(socket.id);
    if (!sesion) {
      socket.emit("authError", { code: "BAD_CREDENTIALS", message: "Entra con tu cuenta primero." });
      return;
    }

    const room = isRoomId(payload?.room) ? payload.room : ROOMS[0];
    const world = worlds.get(room)!;
    const desiredName = sesion.avatar.nickname;

    // La misma cuenta no puede estar dos veces dentro (dos pestañas)
    const yaDentro = [...players.values()].some((p) => p.accountId === sesion.account.id);
    if (yaDentro) {
      const err: JoinErrorPayload = {
        code: "DUPLICATE_NAME",
        message: "Esa cuenta ya está conectada en otra pestaña.",
      };
      socket.emit("joinError", err);
      return;
    }

    const start = spawnCell(world, payload?.col, payload?.row, (c, r) =>
      occupied(room, c, r, socket.id),
    );

    const player: Player = {
      id: socket.id,
      accountId: sesion.account.id,
      name: desiredName,
      room,
      look: sanitizeLook(sesion.avatar.look),
      world,
      state: newState(socket.id, room, start, normalizeFacing(payload?.facing)),
      input: { mx: 0, my: 0 },
      moving: false,
      lastMoveAt: 0,
      lastChatAt: 0,
    };

    me = player;
    players.set(player.id, player);
    socket.join(room);
    socket.emit("welcome", { id: player.id, players: allViews() });
    system(room, `${player.name} entró a la sala`);
  });

  socket.on("move", (mx: number, my: number) => {
    if (!me) return;
    me.input.mx = clampAxis(mx);
    me.input.my = clampAxis(my);
    me.lastMoveAt = Date.now();
  });

  socket.on("path", (raw: Cell[]) => {
    if (!me) return;
    const from = { col: me.state.col, row: me.state.row };
    const cells = bridged(me.world, raw, from);
    if (!validPath(me.world, cells, from)) return;
    const last = cells[cells.length - 1];
    // ¿El destino es un asiento? → el servidor manda sentarse (no el cliente),
    // y el asiento dice hacia dónde se mira
    const sit = me.world.seats.get(cellKey(last.col, last.row)) ?? null;
    me.state.startPath(cells, sit);
  });

  socket.on("stand", () => {
    if (me) me.state.stand();
  });

  socket.on("look", (look: Look) => {
    if (!me) return;
    const limpio = sanitizeLook(look);
    me.look = limpio;
    // Y a la cuenta: si sólo viviera en memoria, al cerrar sesión volverías a
    // salir con los colores por defecto.
    const sesion = sesiones.get(socket.id);
    if (sesion) {
      sesion.avatar.look = limpio;
      guardarLook(sesion.account.id, limpio).catch((e) =>
        console.error("[roomie] guardar aspecto:", e),
      );
    }
  });

  socket.on("room", (p) => {
    if (!me || !isRoomId(p?.room)) return;
    const world = worlds.get(p.room)!;
    const player = me; // narrow for TS

    // Rechazar si el nombre ya está en uso en la sala DESTINO
    const nameTaken = [...players.values()].some(
      (pl) => pl.room === p.room && pl.id !== player.id && pl.name.toLowerCase() === player.name.toLowerCase()
    );
    if (nameTaken) {
      const err: JoinErrorPayload = {
        code: "DUPLICATE_NAME",
        message: `El nombre "${player.name}" ya está en uso en esa sala.`,
      };
      socket.emit("joinError", err);
      return;
    }

    enterRoom(socket, player, p.room);
    player.world = world;
    const start = spawnCell(world, p?.col, p?.row, (c, r) => occupied(p.room, c, r, player.id));
    player.state = newState(player.id, p.room, start, normalizeFacing(p?.facing));
    player.input = { mx: 0, my: 0 };
  });

  socket.on("chat", (text: unknown) => {
    if (!me) return;
    const now = Date.now();
    if (now - me.lastChatAt < CHAT_COOLDOWN_MS) return; // anti-spam
    const msg = sanitizeChat(text);
    if (!msg) return;
    me.lastChatAt = now;
    io.to(me.room).emit("chat", {
      from: me.id,
      name: me.name,
      room: me.room,
      text: msg,
      system: false,
    });
  });

  socket.on("disconnect", () => {
    sesiones.delete(socket.id);
    if (!me) return;
    players.delete(me.id);
    system(me.room, `${me.name} salió de la sala`);
    me = null;
  });
});

// ---------- Bucle de simulación ----------
//
// Paso FIJO de TICK_MS, pero avanzando según el tiempo que ha pasado DE VERDAD.
//
// Antes esto era `setInterval(..., TICK_MS)` simulando TICK_MS por disparo.
// Un temporizador nunca dispara puntual: en Windows la resolución del reloj es
// de 15.625 ms, así que un `setInterval(50)` salta cada ~62.5 ms. El servidor
// avanzaba 50 ms de movimiento por cada ~64 ms de reloj → caminaba un 21% más
// lento que el cliente, la deriva crecía sin parar y la reconciliación acababa
// devolviendo el avatar hacia atrás (rubber banding).
//
// Ahora el temporizador va fino (SCHED_MS) y sólo ACUMULA tiempo real; la
// simulación consume ese tiempo en pasos exactos de TICK_MS. El ritmo de la
// física deja de depender de la puntualidad del temporizador o del sistema.
const STEP_S = TICK_MS / 1000;
/** Cada cuánto despierta el planificador (más fino que el paso de simulación) */
const SCHED_MS = 16;
/** Tope de pasos por despertada: si el proceso se congela, NO se recupera todo
 *  el atraso de golpe (sería un tirón visible para todos los jugadores). */
const MAX_CATCHUP_STEPS = 5;

let acc = 0;
let lastAt = performance.now();

setInterval(() => {
  const now = performance.now();
  acc += now - lastAt;
  lastAt = now;

  let steps = 0;
  while (acc >= TICK_MS && steps < MAX_CATCHUP_STEPS) {
    for (const p of players.values()) step(p, STEP_S);
    acc -= TICK_MS;
    steps++;
  }
  // Se alcanzó el tope: el atraso restante se DESCARTA. Mejor perder tiempo
  // simulado que empujar a todo el mundo hacia delante de golpe.
  if (acc >= TICK_MS) acc = 0;

  // Sin paso simulado no hay nada nuevo que contar: así el snapshot sigue
  // saliendo a ~20 Hz de media aunque el planificador despierte a ~60 Hz.
  if (steps === 0) return;

  const byRoom = new Map<RoomId, PlayerView[]>();
  for (const p of players.values()) {
    const list = byRoom.get(p.room) ?? [];
    list.push(view(p));
    byRoom.set(p.room, list);
  }
  for (const [room, list] of byRoom) io.to(room).emit("players", { players: list });
}, SCHED_MS);

httpServer.listen(PORT, () => {
  const rooms = ROOMS.join(", ");
  console.log(`[roomie] servidor en :${PORT} — salas: ${rooms}`);
});

// Sesiones caducadas e intentos viejos, una vez al arrancar y cada 6 h. No
// hace falta un cron para esto.
const limpiar = (): void => {
  purgar()
    .then(({ sesiones: s, intentos: i }) => {
      if (s || i) console.log(`[roomie] purga: ${s} sesión(es), ${i} intento(s)`);
    })
    .catch((e) => console.error("[roomie] purga:", e));
};
limpiar();
setInterval(limpiar, 6 * 60 * 60 * 1000).unref();

// Cierre limpio (Ctrl+C / `npm stop`)
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    io.close();
    httpServer.close();
    process.exit(0);
  });
}
