import { io, Socket } from "socket.io-client";
import type { Cell } from "../utils/pathfinding.ts";
import type {
  ArticuloTienda,
  AuthErrorPayload,
  AuthOkPayload,
  AuthPayload,
  CasaInfo,
  ChatPayload,
  ClientEvents,
  ColocarPayload,
  CosaMochila,
  JoinErrorPayload,
  JoinPayload,
  Look,
  MotivoReporte,
  MuebleColocado,
  PlayerView,
  ResultadoPayload,
  RoomId,
  RoomPayload,
  SalaDatosPayload,
  Saldos,
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
  onAuthOk?: (p: AuthOkPayload) => void;
  onAuthError?: (err: AuthErrorPayload) => void;
  /** Cambió tu lista de bloqueados */
  onBloqueos?: (nombres: string[]) => void;
  /** Ya tienes casa (te acaban de dar las llaves) */
  onCasa?: (casa: CasaInfo) => void;
  /** El mapa y los muebles de tu casa: ya se puede entrar */
  onSalaDatos?: (p: SalaDatosPayload) => void;
  /** Lo que vende la tienda */
  onTienda?: (articulos: ArticuloTienda[]) => void;
  /** Lo que tienes en la mochila */
  onMochila?: (cosas: CosaMochila[]) => void;
  /** Tus saldos cambiaron */
  onSaldo?: (s: Saldos) => void;
  /** Los muebles de tu sala cambiaron */
  onMuebles?: (sala: RoomId, muebles: MuebleColocado[]) => void;
  /** Cómo salió lo último que pediste */
  onResultado?: (r: ResultadoPayload) => void;
};

/**
 * Token de sesión. Es lo ÚNICO de tu identidad que guarda el navegador: el
 * nombre, el aspecto y el saldo vienen siempre del servidor, que es quien los
 * tiene en la base de datos.
 */
const TOKEN_KEY = "roomie:token";

export function tokenGuardado(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // modo privado
  }
}

function guardarToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // sin almacenamiento: habrá que entrar cada vez
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
  /** Lo último que se supo de tu mochila */
  cosas: CosaMochila[] = [];
  /** Identidad confirmada por el servidor (null mientras no hayas entrado) */
  identidad: AuthOkPayload | null = null;

  get autenticado(): boolean {
    return this.identidad !== null;
  }

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
      // Al reconectar hay que volver a demostrar quién eres: el servidor
      // guarda la sesión por socket, y este socket es nuevo.
      const token = tokenGuardado();
      if (token) socket.emit("resume", { token });
      this.handlers.onStatus?.(true);
    });

    socket.on("disconnect", () => {
      this.online = false;
      this.id = "";
      this.players = [];
      // La identidad se revalida al reconectar, así que aquí se olvida: si no,
      // el juego creería estar autenticado con un socket que ya no existe.
      this.identidad = null;
      this.joined = false;
      this.handlers.onStatus?.(false);
      this.handlers.onPlayers?.([]);
    });

    socket.on("welcome", (p) => {
      this.id = p.id;
      this.setPlayers(p.players);
    });

    socket.on("players", (p) => this.setPlayers(p.players));

    socket.on("chat", (msg) => this.handlers.onChat?.(msg));
    socket.on("casa", (p) => {
      if (this.identidad) this.identidad = { ...this.identidad, casa: p };
      this.handlers.onCasa?.(p);
    });
    socket.on("salaDatos", (p) => this.handlers.onSalaDatos?.(p));
    socket.on("tienda", (p) => this.handlers.onTienda?.(p.articulos));
    socket.on("mochila", (p) => {
      this.cosas = p.cosas;
      this.handlers.onMochila?.(p.cosas);
    });
    socket.on("saldo", (p) => {
      if (this.identidad) this.identidad = { ...this.identidad, saldo: p.monedas, creditos: p.creditos };
      this.handlers.onSaldo?.(p);
    });
    socket.on("muebles", (p) => this.handlers.onMuebles?.(p.sala, p.muebles));
    socket.on("resultado", (p) => this.handlers.onResultado?.(p));
    socket.on("bloqueos", (p) => {
      if (this.identidad) this.identidad = { ...this.identidad, bloqueados: p.bloqueados };
      this.handlers.onBloqueos?.(p.bloqueados);
    });
    socket.on("joinError", (err) => this.handlers.onJoinError?.(err));

    socket.on("authOk", (p) => {
      this.identidad = p;
      guardarToken(p.token);
      this.handlers.onAuthOk?.(p);
    });

    socket.on("authError", (err) => {
      this.identidad = null;
      // Un token caducado no sirve de nada: se tira para no reintentar con él
      // en bucle en cada reconexión.
      if (err.code === "BAD_CREDENTIALS") guardarToken(null);
      this.handlers.onAuthError?.(err);
    });
  }

  /** Crear cuenta o entrar con usuario y contraseña */
  auth(p: AuthPayload): void {
    this.socket?.emit("auth", p);
  }

  /** Cerrar sesión: se olvida el token aquí y en el servidor */
  logout(): void {
    this.socket?.emit("logout");
    guardarToken(null);
    this.identidad = null;
    this.joined = false;
    this.lastWhere = null;
    this.players = [];
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
    if (this.identidad) this.identidad = { ...this.identidad, look };
    if (this.online) this.socket?.emit("look", look);
  }

  chat(text: string): void {
    if (this.online) this.socket?.emit("chat", text);
  }

  /** Una frase o un gesto del menú, por su id */
  frase(id: string): void {
    if (this.online) this.socket?.emit("frase", id);
  }

  /** Cuenta de antes: la fecha de nacimiento que faltaba ("AAAA-MM-DD") */
  nacimiento(fecha: string): void {
    this.socket?.emit("nacimiento", fecha);
  }

  reportar(jugador: string, motivo: MotivoReporte): void {
    if (this.online) this.socket?.emit("reportar", { jugador, motivo });
  }

  bloquear(jugador: string, si: boolean): void {
    if (this.online) this.socket?.emit(si ? "bloquear" : "desbloquear", jugador);
  }

  /** En la portería: pedir las llaves de tu piso */
  llaves(): void {
    if (this.online) this.socket?.emit("llaves");
  }

  /** Ir a tu casa (el servidor contesta con su mapa: `onSalaDatos`) */
  irACasa(): void {
    if (this.online) this.socket?.emit("irACasa");
  }

  // ---------- Economía y decorar (los precios y las reglas, en el servidor)

  tienda(): void {
    if (this.online) this.socket?.emit("tienda");
  }

  comprar(code: string): void {
    if (this.online) this.socket?.emit("comprar", code);
  }

  mochila(): void {
    if (this.online) this.socket?.emit("mochila");
  }

  vender(item: string): void {
    if (this.online) this.socket?.emit("vender", item);
  }

  colocar(p: ColocarPayload): void {
    if (this.online) this.socket?.emit("colocar", p);
  }

  recoger(item: string): void {
    if (this.online) this.socket?.emit("recoger", item);
  }

  /** ¿Tienes bloqueado a alguien con ese nombre? */
  tieneBloqueado(nombre: string): boolean {
    return this.identidad?.bloqueados.includes(nombre) ?? false;
  }

  /** ¿Hablas con frases del menú (y no con texto propio)? Lo decide el servidor por tu edad. */
  get hablaConFrases(): boolean {
    return this.identidad?.modoChat === "frases";
  }
}

export const net = new NetClient();
