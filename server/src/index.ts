import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { AvatarState, type Facing } from "../../src/state/avatarState.ts";
import { DEFAULT_PALETTE, type Palette } from "../../src/state/palette.ts";
import { toScreen } from "../../src/utils/iso.ts";
import type { Cell } from "../../src/utils/pathfinding.ts";
import {
  CHAT_COOLDOWN_MS,
  CHAT_MAX,
  KEYBOARD_SPEED,
  MAX_PATH_CELLS,
  NAME_MAX,
  ROOMS,
  TICK_MS,
  isRoomId,
  type ChatPayload,
  type ClientEvents,
  type JoinErrorPayload,
  type JoinPayload,
  type Look,
  type PlayerView,
  type RoomId,
  type ServerEvents,
} from "../../src/net/protocol.ts";
import { cellKey, loadWorlds, type RoomWorld } from "./world.ts";

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
  return v === "up" || v === "side" ? v : "down";
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

function sanitizeLook(v: unknown): Look {
  const o = (v ?? {}) as Partial<Palette>;
  const ok = (n: unknown, fallback: number): number =>
    typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return {
    shirt: ok(o.shirt, DEFAULT_PALETTE.shirt),
    hair: ok(o.hair, DEFAULT_PALETTE.hair),
  };
}

/**
 * Dos pestañas del mismo navegador comparten localStorage y llegarían con el
 * MISMO nombre (p. ej. "Huésped-123"): se desduplica aquí para poder distinguirlos.
 */
let nameSeq = 0;
function uniqueName(base: string): string {
  const taken = new Set([...players.values()].map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} ${i}`.slice(0, NAME_MAX);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${++nameSeq}`.slice(0, NAME_MAX);
}

/** Celda de entrada: válida y libre, o la libre más cercana al centro */function spawnCell(world: RoomWorld, col: unknown, row: unknown): Cell {
  if (
    typeof col === "number" &&
    typeof row === "number" &&
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    row >= 0 &&
    col < world.cols &&
    row < world.rows &&
    !world.isBlocked(col, row)
  ) {
    return { col, row };
  }
  return world.freeCell();
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
    flip: p.state.flipX,
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

io.on("connection", (socket) => {
  let me: Player | null = null;

  socket.on("join", (payload: JoinPayload) => {
    if (me) return; // ya estaba dentro
    const room = isRoomId(payload?.room) ? payload.room : ROOMS[0];
    const world = worlds.get(room)!;
    const desiredName = sanitizeName(payload?.name);

    // Rechazar si el nombre ya está en uso en ESA sala
    const nameTaken = [...players.values()].some(
      (p) => p.room === room && p.name.toLowerCase() === desiredName.toLowerCase()
    );
    if (nameTaken) {
      const err: JoinErrorPayload = {
        code: "DUPLICATE_NAME",
        message: `El nombre "${desiredName}" ya está en uso en esta sala.`,
      };
      socket.emit("joinError", err);
      return;
    }

    const start = spawnCell(world, payload?.col, payload?.row);

    const player: Player = {
      id: socket.id,
      name: desiredName,
      room,
      look: sanitizeLook(payload?.look),
      world,
      state: new AvatarState(
        { cols: world.cols, rows: world.rows, isBlocked: world.isBlocked },
        start,
        normalizeFacing(payload?.facing),
      ),
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

  socket.on("path", (cells: Cell[]) => {
    if (!me) return;
    if (!validPath(me.world, cells, { col: me.state.col, row: me.state.row })) return;
    const last = cells[cells.length - 1];
    // ¿El destino es un sofá? → el servidor manda sentarse (no el cliente)
    const sit = me.world.sitCells.has(cellKey(last.col, last.row)) ? last : null;
    me.state.startPath(cells, sit);
  });

  socket.on("stand", () => {
    if (me) me.state.stand();
  });

  socket.on("look", (look: Look) => {
    if (me) me.look = sanitizeLook(look);
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
    player.state = new AvatarState(
      { cols: world.cols, rows: world.rows, isBlocked: world.isBlocked },
      spawnCell(world, p?.col, p?.row),
      normalizeFacing(p?.facing),
    );
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
    if (!me) return;
    players.delete(me.id);
    system(me.room, `${me.name} salió de la sala`);
    me = null;
  });
});

// Tick: simula a todos y emite el snapshot a su sala
setInterval(() => {
  const dt = TICK_MS / 1000;
  for (const p of players.values()) step(p, dt);

  const byRoom = new Map<RoomId, PlayerView[]>();
  for (const p of players.values()) {
    const list = byRoom.get(p.room) ?? [];
    list.push(view(p));
    byRoom.set(p.room, list);
  }
  for (const [room, list] of byRoom) io.to(room).emit("players", { players: list });
}, TICK_MS);

httpServer.listen(PORT, () => {
  const rooms = ROOMS.join(", ");
  console.log(`[roomie] servidor en :${PORT} — salas: ${rooms}`);
});

// Cierre limpio (Ctrl+C / `npm stop`)
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    io.close();
    httpServer.close();
    process.exit(0);
  });
}
