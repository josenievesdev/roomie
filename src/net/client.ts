import { io, Socket } from "socket.io-client";
import type { Cell } from "../utils/pathfinding.ts";
import type {
  ChatPayload,
  ClientEvents,
  JoinErrorPayload,
  JoinPayload,
  Look,
  PlayerView,
  RoomPayload,
  ServerEvents,
} from "./protocol.ts";

// Cliente de red. Módulo PURO sin Phaser: sólo socket.io.
// Es un singleton de módulo para que la conexión SOBREVIVA a los reinicios de
// escena (Phaser destruye los game objects al cruzar una puerta, no el módulo).
//
// Si no hay servidor, el juego sigue funcionando exactamente igual que antes
// en single-player: todo lo que llega por aquí es opcional.

export type NetHandlers = {
  onPlayers?: (players: PlayerView[]) => void;
  onChat?: (msg: ChatPayload) => void;
  onStatus?: (online: boolean) => void;
  onJoinError?: (err: JoinErrorPayload) => void;
};

const NAME_KEY = "roomie:name";

/** Nombre estable del jugador (persistido en localStorage) */
export function playerName(): string {
  const fallback = `Huésped-${Math.floor(100 + Math.random() * 900)}`;
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved && saved.trim()) return saved.trim().slice(0, 16);
    localStorage.setItem(NAME_KEY, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

class NetClient {
  private socket: Socket<ServerEvents, ClientEvents> | null = null;
  private handlers: NetHandlers = {};
  private players: PlayerView[] = [];
  private online = false;
  private joined = false;
  /** Último join/room enviado: se reenvía al reconectar */
  private lastWhere: JoinPayload | null = null;

  /** Tu id en el servidor (vacío si no hay conexión) */
  id = "";

  get isOnline(): boolean {
    return this.online;
  }

  get isJoined(): boolean {
    return this.joined;
  }

  /** Último snapshot conocido de todos los jugadores */
  get roster(): PlayerView[] {
    return this.players;
  }

  /** Tu propio estado según el servidor (para corregir derivas) */
  self(): PlayerView | undefined {
    return this.players.find((p) => p.id === this.id);
  }

  /** Registra los callbacks de la escena activa (se sobrescriben al cambiar) */
  setHandlers(h: NetHandlers): void {
    this.handlers = h;
  }

  /**
   * Abre la conexión (idempotente). Va por el proxy de Vite: `/socket.io`
   * → `http://localhost:3001` (ver `vite.config.ts`).
   */
  connect(): void {
    if (this.socket) {
      if (this.online) this.handlers.onStatus?.(true);
      return;
    }
    const socket = io({
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 3000,
    }) as Socket<ServerEvents, ClientEvents>;
    this.socket = socket;

    socket.on("connect", () => {
      this.online = true;
      this.id = socket.id ?? "";
      // Reentrar con la última sala conocida (reconexión o primera entrada)
      if (this.lastWhere) socket.emit("join", this.lastWhere);
      this.handlers.onStatus?.(true);
    });

    socket.on("disconnect", () => {
      this.online = false;
      this.id = "";
      this.players = [];
      this.handlers.onStatus?.(false);
      this.handlers.onPlayers?.([]);
    });

    socket.on("welcome", (p) => {
      this.id = p.id;
      this.setPlayers(p.players);
    });

    socket.on("players", (p) => this.setPlayers(p.players));

    socket.on("chat", (msg) => this.handlers.onChat?.(msg));
    socket.on("joinError", (err) => this.handlers.onJoinError?.(err));
  }

  private setPlayers(list: PlayerView[]): void {
    this.players = list;
    this.handlers.onPlayers?.(list);
  }

  /** Entra al juego en la sala dada */
  join(p: JoinPayload): void {
    this.lastWhere = p;
    this.joined = true;
    if (this.online) this.socket?.emit("join", p);
  }

  /** Cambia de sala (al cruzar una puerta) */
  changeRoom(p: RoomPayload): void {
    if (!this.lastWhere) return;
    this.lastWhere = { ...this.lastWhere, ...p };
    if (this.online) this.socket?.emit("room", p);
  }

  move(mx: number, my: number): void {
    if (this.online) this.socket?.emit("move", mx, my);
  }

  path(cells: Cell[]): void {
    if (this.online) this.socket?.emit("path", cells);
  }

  stand(): void {
    if (this.online) this.socket?.emit("stand");
  }

  look(look: Look): void {
    if (!this.lastWhere) return;
    this.lastWhere = { ...this.lastWhere, look };
    if (this.online) this.socket?.emit("look", look);
  }

  chat(text: string): void {
    if (this.online) this.socket?.emit("chat", text);
  }
}

export const net = new NetClient();
