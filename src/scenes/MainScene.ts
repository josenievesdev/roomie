import Phaser from "phaser";
import { toScreen, toGrid } from "../utils/iso";
import {
  ALTO_AVATAR,
  ORIGEN,
  animKey,
  createAvatarTexture,
  destroyAvatarAssets,
  frameInicial,
  preloadAvatar,
} from "../entities/avatar";
import {
  crearLuz,
  crearMueble,
  crearSombraMuros,
  ladoPared,
  mascaraAlfombra,
  preloadMuebles,
} from "../entities/furniture";
import { FURNITURE, isFurniture, seatAt, type FurnitureKind } from "../state/furniture-catalog";
import { findPath, type Cell } from "../utils/pathfinding";
import {
  AvatarState,
  FACING_SUR,
  avatarDepth,
  subidaSentado,
  type Facing,
  type SitTarget,
} from "../state/avatarState";
import { DEFAULT_LOOK, mismoLook, sanitizeLook } from "../state/look";
import { frasePorId, GESTOS, GESTO_SALUDO } from "../state/frases";
import { parsearNacimiento } from "../state/normas";
import { Vestidor } from "../ui/vestidor";
import { MenuFrases } from "../ui/menuFrases";
import { Hud } from "../ui/hud";
import { boton, centrar, crearTexturasUI, icono, partirTexto, pieza, texto, UI, UI_HEX, yCentrada } from "../ui/kit";
import {
  loadSave,
  writeSave,
  clearSave,
  cargarZoom,
  guardarZoom,
  edadRechazadaReciente,
  marcarEdadRechazada,
  type SaveData,
} from "../utils/storage";
import { LAYER, worldDepth } from "../render/layers";
import { themeFor, type RoomTheme } from "../render/theme";
import { createTextInput, textInputFocused, type TextInput } from "../ui/textInput";
import { net, tokenGuardado } from "../net/client";
import {
  CHAT_MAX,
  KEYBOARD_SPEED,
  NAME_MAX,
  PASS_MIN,
  PASS_MAX,
  ROOMS,
  USER_MIN,
  type ChatPayload,
  type JoinErrorPayload,
  type AuthErrorPayload,
  type AuthOkPayload,
  type Look,
  type MotivoReporte,
  type PlayerView,
  type RoomId,
} from "../net/protocol";

type TiledObject = {
  name?: string;
  type?: string;
  class?: string;
  x?: number;
  y?: number;
  properties?: { name: string; value: unknown }[];
};

type TiledLayer = {
  name: string;
  type: string;
  data?: number[];
  visible?: boolean;
  objects?: TiledObject[];
};

type TiledMap = {
  width: number;
  height: number;
  layers: TiledLayer[];
};

type PlacedFurniture = { kind: FurnitureKind; col: number; row: number };

type Door = {
  col: number;
  row: number;
  target: string;
  targetCol: number;
  targetRow: number;
};

const SAVE_INTERVAL = 5000; // ms entre guardados automáticos

/** Cuánto dura el saludo del avatar cuando alguien manda 👋 */
const SALUDO_MS = 1600;
/**
 * Nombre sobre la cabeza y burbuja sobre el nombre, en píxeles de PANTALLA
 * por encima de la cabeza: nombres y burbujas van a tamaño fijo, con el zoom
 * que sea (ver `repartirCamaras`).
 */
const HUECO_NOMBRE = 3;
const ALTO_ETIQUETA = 16;
const HUECO_BURBUJA = HUECO_NOMBRE + ALTO_ETIQUETA + 5;
/**
 * Alto de la cara de pared, IGUAL que `WALL_H` en tools/genassets.mjs: 1,5
 * veces el avatar. (La puerta, algo más alta que él, es un modelo 3D:
 * `puerta` en tools/muebles/modelos.mjs.)
 */
const ALTO_PARED = 96;

/**
 * Los modos del modal de cuenta. "nacimiento" es para las cuentas de antes,
 * que aún no dijeron su fecha de nacimiento: sin ella no se entra.
 */
type AuthModalMode = "login" | "register" | "profile" | "nacimiento";
type CampoClave = "username" | "password" | "nickname" | "dia" | "mes" | "anio";

/** Un campo de texto del modal: lo dibuja Phaser, lo escribe un <input> real */
type CampoAuth = {
  clave: CampoClave;
  fondo: Phaser.GameObjects.NineSlice;
  texto: Phaser.GameObjects.Text;
  secreto: boolean;
  input: TextInput | null;
  /** Lo que se ve, apagado, mientras está vacío ("Día", "Mes", "Año") */
  placeholder?: string;
};

/** Motivos de reporte, con palabras que entiende un niño */
const MOTIVOS_REPORTE: { motivo: MotivoReporte; texto: string }[] = [
  { motivo: "acoso", texto: "Me está molestando" },
  { motivo: "lenguaje", texto: "Dice groserías" },
  { motivo: "datos", texto: "Pide datos o fotos" },
  { motivo: "otro", texto: "Otra cosa" },
];

/**
 * Panel de chat de la esquina inferior izquierda: historial a la vista que
 * se desvanece solo, y al abrir para escribir se muestra entero con fondo.
 */
const CHAT_PANEL = {
  x: 8,
  /** Pie de la línea más nueva: las demás se apilan hacia ARRIBA desde aquí */
  bottom: 497,
  w: 360,
  /** Cuántas líneas caben a la vez */
  lines: 8,
  /** Alto de línea: la fuente pixel a 12 px (15 de caja) más 1 de aire */
  lineH: 16,
};
/** Barra de escritura del chat, al pie */
const CHAT_BARRA = { y: 508, h: 24 };

/**
 * Niveles de zoom. Enteros a propósito: a ×1,5 unos píxeles del arte
 * saldrían dobles y otros sencillos, y el pixel art se deforma.
 */
const ZOOMS = [1, 2, 3] as const;
/** Cuánto hay que girar la rueda para cambiar un nivel (los touchpads mandan pasitos) */
const RUEDA_PASO = 60;
/** Píxeles que tiene que moverse el puntero para que un clic pase a ser arrastre */
const UMBRAL_ARRASTRE = 6;
/** Con el chat cerrado, una línea se desvanece a los 12 s */
const CHAT_FADE_MS = 12000;
/** Historial guardado (más de lo que cabe en pantalla) */
const CHAT_HISTORY = 60;

const CHAT_COLORS = {
  system: "#9a9ad0",
  mine: "#ffe9a8",
  other: "#ffffff",
} as const;

/** Una línea ya partida del historial */
type ChatLine = { text: string; color: string; at: number };

/**
 * Pieza del menú de avatar con su desplazamiento respecto al ancla.
 *
 * Son objetos SUELTOS, no un `Container`: con el contenedor a
 * `scrollFactor(0)` sus hijos conservaban el suyo propio (1) y Phaser
 * calculaba las zonas de toque con una transformación distinta a la del
 * dibujo — los botones se veían pero no recibían el clic.
 */
type MenuItem = {
  o: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;
  /** Desplazamiento desde la esquina superior izquierda del menú */
  dx: number;
  dy: number;
};

// ---------- Sincronización multijugador (Fase 1) ----------

/** Snapshot recibido + la hora LOCAL de llegada (ese sello no viaja por la red) */
type Snapshot = { at: number; players: PlayerView[] };

/**
 * Los remotos se dibujan 100 ms EN EL PASADO. Así siempre hay un snapshot
 * posterior con el que interpolar y el movimiento sale continuo. Antes se
 * perseguía el último snapshot con un suavizado exponencial: eso nunca alcanza
 * el blanco, va permanentemente retrasado y convierte cualquier irregularidad
 * de la red en un cambio de velocidad visible.
 */
const INTERP_DELAY_MS = 100;
/** Historia guardada (a 20 Hz son ~1 s) */
const SNAPSHOT_BUFFER = 20;

/**
 * Zona muerta de la corrección, en celdas. El servidor va SIEMPRE un poco por
 * detrás de mí porque mi entrada tarda en llegarle; ese desfase es normal y
 * corregirlo continuamente me frenaría. Un tercio de baldosa es invisible.
 */
const CORRECTION_DEADZONE = 0.35;
/** Velocidad del arrastre correctivo (1/s): absorbe el error en ~1/4 de segundo */
const CORRECTION_RATE = 4;
/**
 * Por encima de esto ya no es deriva, es divergencia real (cambio de sala,
 * respawn, camino rechazado): se adopta la posición del servidor de golpe.
 */
const CORRECTION_TELEPORT = 3;
/**
 * Zona muerta con los DOS quietos. La de arriba existe porque, andando, el
 * servidor va por detrás; parados ese desfase ya no existe, y dejarlo en 0.35
 * era quedarse para siempre a un tercio de baldosa de donde te ven los demás
 * (junto a alguien en tu pantalla, encima de él en la suya).
 */
const REST_DEADZONE = 0.1;
/**
 * Si el servidor y yo discrepamos en si estoy sentado durante más de un viaje
 * de ida y vuelta, no es retraso: el servidor me sentó donde yo no (o me negó
 * un asiento que alguien ocupó primero). Manda él.
 */
const SIT_MISMATCH_MS = 400;

/** Avatar remoto dibujado en la escena (su textura es `avatar:<id>`) */
type Peer = {
  view: PlayerView;
  sprite: Phaser.GameObjects.Sprite;
  /** Nombre sobre la cabeza: pastilla oscura y texto pixel a 1× */
  label: Phaser.GameObjects.Container;
  /** Posición interpolada en celdas (va detrás del snapshot del servidor) */
  col: number;
  row: number;
  textureKey: string;
  look: Look;
};

/**
 * Render de un avatar remoto: MISMA fórmula que `AvatarState.screen()`.
 * `asiento` es la altura del asiento si está sentado (null de pie).
 */
function peerScreen(
  col: number,
  row: number,
  asiento: number | null,
): { x: number; y: number; depth: number } {
  const base = toScreen(col, row);
  const depth = avatarDepth(col, row);
  return asiento !== null
    ? { x: base.x, y: base.y - subidaSentado(asiento), depth }
    : { x: base.x, y: base.y, depth };
}

// Fase 6: múltiples salas con puertas. Render + entrada + chat + guardado +
// personalización; la lógica del avatar vive en AvatarState (módulo puro).
export class MainScene extends Phaser.Scene {
  private roomId: RoomId = "room1";
  /** Paleta y piezas de atlas de la sala actual */
  private theme!: RoomTheme;
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

  private avatar!: AvatarState;
  private blocked: boolean[][] = [];
  private cols = 0;
  private rows = 0;
  private furniture: PlacedFurniture[] = [];
  private doors: Door[] = [];
  private transitioning = false;

  // Aspecto
  private look: Look = DEFAULT_LOOK;
  /** Vestidor abierto (null = cerrado) */
  private vestidor: Vestidor | null = null;
  /** Hasta cuándo saluda cada avatar ("me" o id remoto), en ms de `time.now` */
  private saludos = new Map<string, number>();

  // Chat
  private chatOpen = false;
  private chatText = "";
  private chatBg!: Phaser.GameObjects.NineSlice;
  private chatLabel!: Phaser.GameObjects.Text;
  private hud: Hud | null = null;
  /** Burbujas por avatar: "me" o el id del jugador remoto */
  private bubbles = new Map<string, Phaser.GameObjects.Container>();
  /** Historial del panel de chat (ya partido en líneas) */
  private chatLines: ChatLine[] = [];
  /** Objetos de texto reutilizados, uno por línea visible */
  private chatLineTexts: Phaser.GameObjects.Text[] = [];
  private chatPanelBg!: Phaser.GameObjects.NineSlice;

  // Multijugador (Fase 7)
  private peers = new Map<string, Peer>();
  private netPlayers: PlayerView[] = [];
  private netOnline = false;
  private alive = false; // false durante un reinicio de escena (transición)
  private sentMove = { mx: 0, my: 0 };
  private lastMoveSent = 0;
  /** Historia reciente de snapshots, para interpolar a los remotos */
  private snapshots: Snapshot[] = [];
  /** Desde cuándo discrepamos el servidor y yo en si estoy sentado (0 = no) */
  private sitMismatchSince = 0;
  private authModalOpen = false;
  private authMode: AuthModalMode = "login";
  private authUI: Phaser.GameObjects.GameObject[] = [];
  private authCampos: CampoAuth[] = [];
  private campoActivo: CampoAuth | null = null;
  private authError: Phaser.GameObjects.Text | null = null;
  /** Se acaba de crear la cuenta: al entrar se abre el vestidor */
  private recienRegistrado = false;
  /** <input> real del chat: sin él no hay teclado en el móvil */
  private chatInput: TextInput | null = null;
  /** Piezas del menú que sale al tocar a otro jugador (vacío = cerrado) */
  private peerMenuItems: MenuItem[] = [];
  /** Id del jugador al que pertenece el menú abierto */
  private peerMenuFor = "";
  /** Medidas del menú de avatar abierto (el de reportar es más alto) */
  private menuTam = { w: 180, h: 118 };
  /** Menú de frases abierto (null = cerrado) */
  private menuFrases: MenuFrases | null = null;
  /** Botón "Frases" de la barra del chat, mientras está abierta */
  private chatFrasesBtn: Phaser.GameObjects.GameObject[] = [];

  // Cámara
  /**
   * Cámara de la interfaz: sin zoom ni scroll. La principal hace zoom sobre
   * la sala; si la interfaz fuera en ella, también se ampliaría (y se
   * saldría de la pantalla), aunque tenga `scrollFactor(0)`.
   */
  private camaraUI!: Phaser.Cameras.Scene2D.Camera;
  /** Índice en ZOOMS */
  private nivelZoom = 0;
  /** La cámara dejó de seguir al avatar para mirar otra cosa (rueda o arrastre) */
  private camaraLibre = false;
  /** Rueda acumulada hasta completar un paso */
  private ruedaAcum = 0;
  /** Clic en el mundo en curso: dónde empezó y si ya es un arrastre */
  private arrastre: { x: number; y: number; scrollX: number; scrollY: number; activo: boolean } | null = null;

  constructor() {
    super("main");
  }

  preload(): void {
    this.roomId = this.resolveRoom();
    this.load.json(this.roomId, `assets/${this.roomId}.json`);
    this.load.spritesheet("tileset", "assets/tileset.png", {
      frameWidth: 64,
      frameHeight: 32,
    });
    // Caras de pared: 32 de ancho por ALTO_PARED MÁS 16 de sesgo isométrico
    this.load.spritesheet("walls", "assets/walls.png", {
      frameWidth: 32,
      frameHeight: ALTO_PARED + 16,
    });
    // Capas del avatar (cuerpo, peinados, prendas): se combinan en create()
    preloadAvatar(this);
    // Muebles generados en 3D: el manifiesto y, al llegar, sus imágenes
    preloadMuebles(this);
  }

  create(): void {
    // Reinicio limpio (la escena se reinicia al cruzar puertas)
    this.transitioning = false;
    this.chatOpen = false;
    this.chatText = "";
    this.vestidor = null;
    this.saludos = new Map();
    this.recienRegistrado = false;
    this.authModalOpen = false;
    this.authUI = [];
    this.authCampos = [];
    this.campoActivo = null;
    this.chatInput = null;
    this.peerMenuItems = [];
    this.peerMenuFor = "";
    this.authError = null;
    this.alive = true;
    this.peers = new Map(); // los game objects viejos ya los destruyó el restart
    this.bubbles = new Map();
    this.chatLines = [];
    this.chatLineTexts = [];
    this.sentMove = { mx: 0, my: 0 };
    this.lastMoveSent = 0;
    this.snapshots = [];
    this.sitMismatchSince = 0;
    this.furniture = [];
    this.doors = [];
    this.camaraLibre = false;
    this.ruedaAcum = 0;
    this.arrastre = null;
    this.menuFrases = null;
    this.chatFrasesBtn = [];

    const save = loadSave();
    // Con sesión, el aspecto es el de la cuenta; sin ella, el último guardado
    this.look = net.identidad ? sanitizeLook(net.identidad.look) : (save?.look ?? DEFAULT_LOOK);

    createAvatarTexture(this, this.look);
    // Vecino más cercano en TODO el pixel art: con muestreo lineal los
    // bordes de las baldosas se emborronan al escalar el lienzo.
    this.textures.get("tileset").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.textures.get("walls").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.theme = themeFor(this.roomId);
    this.buildRoom();

    this.avatar = new AvatarState(
      {
        cols: this.cols,
        rows: this.rows,
        isBlocked: (c, r) => this.blocked[r][c],
        isOccupied: (c, r) => this.peerOccupies(c, r),
        // Con el teclado también se entra en puertas y asientos
        isDoor: (c, r) => this.doorAt(c, r) !== undefined,
        seatAt: (c, r) => this.seatAtCell(c, r),
      },
      this.resolveStartCell(save),
      this.resolveStartFacing(save),
    );

    const p = this.avatar.screen();
    // A tamaño real (×1), como los muebles y el suelo: un píxel del avatar es
    // un píxel de la sala. Antes iba escalado ×2 y se notaba el doble grano.
    this.player = this.add
      .sprite(p.x, p.y, "avatar", frameInicial(this.avatar.facing))
      .setOrigin(ORIGEN.x, ORIGEN.y)
      .setDepth(worldDepth(p.depth));
    this.player.play(this.anim(`idle-${this.avatar.facing}`));

    // Cámaras: la principal mira la sala (con zoom y siguiendo al avatar); la
    // de la interfaz, encima, dibuja sólo la interfaz y nunca se mueve. Qué
    // va en cuál lo decide la profundidad, justo antes de dibujar.
    this.camaraUI = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, "ui");
    const repartir = () => this.repartirCamaras();
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, repartir);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.PRE_RENDER, repartir));

    const guardado = cargarZoom();
    this.nivelZoom = Math.max(0, ZOOMS.indexOf((guardado ?? 1) as (typeof ZOOMS)[number]));
    const cam = this.cameras.main;
    cam.setZoom(ZOOMS[this.nivelZoom]);
    const [bx, by, bw, bh] = this.roomBounds();
    cam.setBounds(bx, by, bw, bh);
    // Centrar al cargar: con límites más pequeños que la ventana, Phaser
    // ancla el scroll al borde mínimo y la sala queda pegada arriba.
    cam.centerOn(bx + bw / 2, by + bh / 2);
    cam.startFollow(this.player, true, 0.1, 0.1);
    cam.fadeIn(250, 0, 0, 0);

    // Interfaz: piezas pixel art (una vez) y el HUD
    crearTexturasUI(this);
    this.hud = new Hud(this, {
      chat: () => this.alternarChat(),
      vestidor: () => this.abrirVestidor(),
      perfil: () => this.showAuthModal(net.autenticado ? "profile" : "login"),
      zoom: (paso) => this.cambiarZoom(paso),
    });
    this.hud.nivelZoom(this.nivelZoom, 0, ZOOMS.length - 1);

    // Panel de chat: fondo (sólo visible mientras se escribe) + líneas
    const alturaPanel = CHAT_PANEL.lines * CHAT_PANEL.lineH + 10;
    this.chatPanelBg = pieza(this, "chip", CHAT_PANEL.x, CHAT_PANEL.bottom + 5 - alturaPanel, CHAT_PANEL.w, alturaPanel)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_PANEL)
      .setVisible(false);

    // Una línea = un objeto de texto reutilizado, para no recrearlos sin parar
    this.chatLineTexts = [];
    for (let i = 0; i < CHAT_PANEL.lines; i++) {
      this.chatLineTexts.push(
        texto(this, CHAT_PANEL.x + 8, 0, "", { color: CHAT_COLORS.other, sombra: true })
          .setOrigin(0, 1)
          .setScrollFactor(0)
          .setDepth(LAYER.UI_PANEL + 1)
          .setVisible(false),
      );
    }
    // El desvanecido depende del reloj, no de que ocurra nada
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.renderChatPanel() });

    // Barra de escritura, alineada con el panel: un campo hundido
    this.chatBg = pieza(this, "campo-activo", CHAT_PANEL.x, CHAT_BARRA.y, CHAT_PANEL.w, CHAT_BARRA.h)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_PANEL)
      .setVisible(false);
    this.chatLabel = texto(this, CHAT_PANEL.x + 8, yCentrada(CHAT_BARRA.y, CHAT_BARRA.h), "")
      .setScrollFactor(0)
      .setDepth(LAYER.UI_PANEL + 1)
      .setVisible(false);

    // Red: registro los handlers de ESTA escena y aviso de mi sala/posición
    this.setupNet();

    // Quién eres lo decide el servidor. Si ya hay sesión (token válido que
    // `net` reanudó al conectar) se entra directo; si no, a identificarse.
    //
    // Si todavía no ha llegado la respuesta al `resume`, no se abre el modal:
    // lo hará `onAuthError` si el token no valía.
    if (net.autenticado) {
      // Cuenta de antes sin fecha de nacimiento: primero eso
      if (net.identidad?.necesitaNacimiento) this.showAuthModal("nacimiento");
      else this.sendWhere();
    } else if (!net.isOnline || !tokenGuardado()) this.showAuthModal("login");

    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys("W,A,S,D") as MainScene["wasd"];

      kb.on("keydown", (e: { key?: string }) => {
        // Si el foco está en un <input> real, las teclas son suyas: si no, cada
        // letra se escribiría dos veces.
        if (textInputFocused(...this.authCampos.map((c) => c.input), this.chatInput)) return;
        const key = e.key ?? "";
        if (key === "Escape" && this.peerMenuItems.length > 0) {
          this.closePeerMenu();
          return;
        }
        if (key === "Escape" && this.menuFrases) {
          this.cerrarFrases();
          return;
        }
        // Con el vestidor abierto, el teclado sólo lo cierra o gira la vista
        if (this.vestidor) {
          if (key === "Escape" || key === "c" || key === "C") this.cerrarVestidor();
          else if (key === "ArrowLeft") this.vestidor.girar(1);
          else if (key === "ArrowRight") this.vestidor.girar(-1);
          return;
        }
        if (!this.chatOpen) {
          if (key === "Enter") this.alternarChat();
          else if (key === "c" || key === "C") this.abrirVestidor();
          else if (key === "+" || key === "=") this.cambiarZoom(1);
          else if (key === "-" || key === "_") this.cambiarZoom(-1);
          return;
        }
        if (key === "Enter") this.sendChat();
        else if (key === "Escape") this.closeChat();
        else if (key === "Backspace") {
          this.chatText = this.chatText.slice(0, -1);
          this.renderChatBar();
        } else if (key.length === 1 && this.chatText.length < CHAT_MAX) {
          this.chatText += key;
          this.renderChatBar();
        }
      });
    }

    // Clic en el mundo: se decide al SOLTAR. Si entre medias el puntero se
    // movió, era un arrastre para mirar la sala (con zoom) y no se camina.
    this.input.on(
      "pointerdown",
      (pointer: Phaser.Input.Pointer, sobre: Phaser.GameObjects.GameObject[]) => {
        this.arrastre = null;
        if (pointer.button !== 0) return; // solo clic izquierdo
        if (this.authModalOpen || this.vestidor) return; // el modal se lleva todos los clics

        // El clic cayó sobre un elemento interactivo (botón, selector, avatar):
        // es suyo, no del mundo.
        //
        // Este manejador es GLOBAL: se dispara en el mismo clic que el del
        // botón. Sin esta guarda, pulsar "Chat" abría el chat y acto seguido
        // `handleWorldClick` lo cerraba ("un clic en el mundo cierra el chat"),
        // así que el botón no hacía nada ni en PC ni en móvil.
        if (sobre.length > 0) return;

        const cam = this.cameras.main;
        this.arrastre = { x: pointer.x, y: pointer.y, scrollX: cam.scrollX, scrollY: cam.scrollY, activo: false };
      },
    );
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const a = this.arrastre;
      if (!a || !pointer.isDown) return;
      if (!a.activo && Math.hypot(pointer.x - a.x, pointer.y - a.y) < UMBRAL_ARRASTRE) return;
      a.activo = true;
      this.soltarCamara();
      const cam = this.cameras.main;
      cam.setScroll(a.scrollX - (pointer.x - a.x) / cam.zoom, a.scrollY - (pointer.y - a.y) / cam.zoom);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer, sobre: Phaser.GameObjects.GameObject[]) => {
      const a = this.arrastre;
      this.arrastre = null;
      if (!a || a.activo || this.authModalOpen || this.vestidor) return;
      if (sobre.length > 0) return; // se soltó encima de un botón: es suyo
      // Un clic en el mundo con un menú abierto (de avatar, de frases) sólo lo cierra
      if (this.peerMenuItems.length > 0) {
        this.closePeerMenu();
        return;
      }
      if (this.menuFrases) {
        this.cerrarFrases();
        return;
      }
      this.handleWorldClick(pointer);
    });

    // Rueda: zoom hacia donde apunta el ratón
    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _sobre: unknown, _dx: number, dy: number) => {
        if (this.authModalOpen || this.vestidor) return;
        // Cambiar de sentido empieza la cuenta de cero
        if (Math.sign(dy) !== Math.sign(this.ruedaAcum)) this.ruedaAcum = 0;
        this.ruedaAcum += dy;
        if (Math.abs(this.ruedaAcum) < RUEDA_PASO) return;
        const paso = this.ruedaAcum < 0 ? 1 : -1;
        this.ruedaAcum = 0;
        this.cambiarZoom(paso, { x: pointer.x, y: pointer.y });
      },
    );

    // Guardado: periódico + al cerrar la pestaña/escena
    this.time.addEvent({
      delay: SAVE_INTERVAL,
      loop: true,
      callback: () => this.saveGame(),
    });
    const onSave = () => this.saveGame();
    window.addEventListener("beforeunload", onSave);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!this.transitioning) this.saveGame(); // al cruzar puerta ya se guardó el destino
      window.removeEventListener("beforeunload", onSave);
      // Los objetos de esta escena mueren: nada de red debe tocarlos ya
      this.alive = false;
      net.setHandlers({});
      // Si la escena muere con el modal abierto, su listener de teclado
      // sobreviviría al reinicio y escribiría sobre objetos destruidos.
      // Los <input> viven en el DOM, fuera de Phaser: hay que quitarlos a mano
      // o se acumularían uno por cada cruce de puerta.
      for (const c of this.authCampos) c.input?.destroy();
      this.authCampos = [];
      this.chatInput?.destroy();
      this.chatInput = null;
      // Las texturas de los remotos viven en el gestor GLOBAL de texturas y
      // sobreviven al reinicio: sin esto, cada jugador que se cruzó en una
      // sala dejaba su hoja (1,8 MB) en memoria para siempre. Animaciones y
      // textura se van juntas (ver `destroyAvatarAssets`).
      for (const peer of this.peers.values()) destroyAvatarAssets(this, peer.textureKey);
      this.vestidor?.destroy();
      this.vestidor = null;
      this.menuFrases?.destroy();
      this.menuFrases = null;
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1); // tope por si la pestaña estuvo en segundo plano

    // La autoridad se aplica ANTES que la entrada, a propósito: si el arrastre
    // correctivo ocurriera después, entraría en el cálculo de `moving`/`facing`
    // de más abajo y una corrección estando quieto te haría girar y animar
    // como si caminaras.
    this.reconcile(dt);
    const old = this.avatar.screen();

    // Entrada -> estado (el estado decide qué hacer)
    let dx = 0;
    let dy = 0;
    if (!this.chatOpen && !this.vestidor) {
      if (this.cursors?.left.isDown || this.wasd?.A.isDown) dx -= 1;
      if (this.cursors?.right.isDown || this.wasd?.D.isDown) dx += 1;
      if (this.cursors?.up.isDown || this.wasd?.W.isDown) dy -= 1;
      if (this.cursors?.down.isDown || this.wasd?.S.isDown) dy += 1;
    }
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2; // diagonal normalizada (igual que el servidor)
      dy *= Math.SQRT1_2;
    }

    if (dx !== 0 || dy !== 0) {
      this.avatar.keyboardMove(dx * KEYBOARD_SPEED * dt, dy * KEYBOARD_SPEED * dt);
    } else {
      this.avatar.tick(dt);
    }
    this.sendMove(dx, dy);

    // ¿Está en una puerta sin camino por delante? → cruzar. Da igual cómo
    // llegara: al final de un camino, con el teclado o por una corrección
    // del servidor (que sólo te pone en una puerta si ibas hacia ella).
    if (this.avatar.path.length === 0) {
      const d = this.doorAt(Math.round(this.avatar.col), Math.round(this.avatar.row));
      if (d) this.transitionTo(d);
    }

    // Estado -> render
    const p = this.avatar.screen();
    const moveX = p.x - old.x;
    const moveY = p.y - old.y;
    const moving = Math.abs(moveX) > 1e-6 || Math.abs(moveY) > 1e-6;
    // Si estabas mirando otra parte de la sala, al echar a andar la cámara
    // vuelve contigo
    if (moving && this.camaraLibre) this.seguirAvatar();

    if (moving && !this.avatar.sitting) this.avatar.updateFacing(moveX, moveY);
    this.player.play(
      this.anim(this.animacion("me", this.avatar.facing, this.avatar.sitting !== null, moving)),
      true,
    );

    this.player.setPosition(p.x, p.y);
    this.player.setDepth(worldDepth(p.depth)); // orden isométrico

    // Multijugador: dibujo a los demás (interpolados) y muevo las burbujas de
    // chat (la mía y las ajenas). Mi corrección ya se aplicó al principio.
    this.syncPeers();
    this.movePeerMenu();
    this.moveBubbles();
  }

  // ---------- Cámara y zoom ----------

  /**
   * Cambia de nivel de zoom. Con `ancla` (la rueda), el punto de la sala que
   * hay bajo el ratón se queda bajo el ratón, y la cámara deja de seguir al
   * avatar para poder mirar de cerca otra cosa. Sin ancla (teclas, botones),
   * se amplía sobre lo que ya se estaba viendo.
   */
  private cambiarZoom(paso: number, ancla?: { x: number; y: number }): void {
    const nivel = Phaser.Math.Clamp(this.nivelZoom + paso, 0, ZOOMS.length - 1);
    if (nivel === this.nivelZoom) return;
    const cam = this.cameras.main;
    const antes = ancla ? cam.getWorldPoint(ancla.x, ancla.y) : null;
    this.nivelZoom = nivel;
    const z = ZOOMS[nivel];
    cam.setZoom(z);
    // Los límites dependen del zoom: la vista mide la ventana entre el zoom
    const [bx, by, bw, bh] = this.roomBounds();
    cam.setBounds(bx, by, bw, bh);
    if (antes && ancla) {
      this.soltarCamara();
      const w = cam.width;
      const h = cam.height;
      cam.setScroll(antes.x - w / 2 - (ancla.x - w / 2) / z, antes.y - h / 2 - (ancla.y - h / 2) / z);
    }
    this.hud?.nivelZoom(nivel, 0, ZOOMS.length - 1);
    guardarZoom(z);
  }

  /** La cámara deja de seguir al avatar (para mirar la sala a gusto) */
  private soltarCamara(): void {
    if (this.camaraLibre) return;
    this.camaraLibre = true;
    this.cameras.main.stopFollow();
  }

  /** La cámara vuelve a seguir al avatar, deslizándose hasta él */
  private seguirAvatar(): void {
    this.camaraLibre = false;
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  /**
   * Reparte los objetos entre las dos cámaras según su profundidad: de
   * `LAYER.WORLD_LABEL` para arriba (nombres, burbujas y toda la interfaz)
   * sólo lo dibuja la cámara de la interfaz, a tamaño fijo; el resto es la
   * sala y sólo lo dibuja la principal, con su zoom. Nombres y burbujas
   * siguen a su avatar, pero en coordenadas de pantalla: ampliados ×2 o ×3
   * volvían a verse gruesos. Va justo antes de dibujar, así que da igual
   * cuándo o dónde se cree un objeto. (Con los filtros de cámara, el clic
   * también va a la cámara correcta.)
   */
  private repartirCamaras(): void {
    const sala = this.cameras.main.id;
    const ui = this.camaraUI.id;
    for (const o of this.children.list) {
      const profundidad = (o as Phaser.GameObjects.GameObject & { depth?: number }).depth ?? 0;
      o.cameraFilter = profundidad >= LAYER.WORLD_LABEL ? sala : ui;
    }
  }

  /** Punto del mundo → punto de la pantalla (lienzo de 960×540), con el zoom */
  private aPantalla(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    const z = cam.zoom;
    return {
      x: (x - cam.scrollX - cam.width / 2) * z + cam.width / 2,
      y: (y - cam.scrollY - cam.height / 2) * z + cam.height / 2,
    };
  }

  /**
   * Animación de un avatar (propio o remoto) según su estado. El saludo sólo
   * se ve de pie y quieto: andando o sentado manda lo que esté haciendo.
   */
  private animacion(quien: string, dir: Facing, sentado: boolean, andando: boolean): string {
    if (sentado) return `sit-${dir}`;
    if (andando) return `walk-${dir}`;
    if ((this.saludos.get(quien) ?? 0) > this.time.now) return `wave-${dir}`;
    return `idle-${dir}`;
  }

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    if (this.chatOpen) {
      this.closeChat(); // un clic en el mundo cierra el chat
      return;
    }

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const g = toGrid(world.x, world.y);
    const goal: Cell = { col: Math.round(g.col), row: Math.round(g.row) };

    if (!this.inBounds(goal.col, goal.row)) return;

    const door = this.doorAt(goal.col, goal.row);
    const sitTarget = this.seatAtCell(goal.col, goal.row);
    if (!door && !sitTarget && this.blocked[goal.row][goal.col]) return;
    // Ahí ya hay alguien (de pie o sentado): cada uno ocupa su baldosa
    if (this.peerOccupies(goal.col, goal.row)) return;

    const start: Cell = { col: Math.round(this.avatar.col), row: Math.round(this.avatar.row) };
    if (start.col === goal.col && start.row === goal.row) {
      this.avatar.cancelPath();
      if (this.avatar.sitting) {
        this.avatar.stand(); // segundo clic en el sofá: levantarse
        net.stand();
      }
      return;
    }

    // Se rodea a quien esté parado en medio. El servidor no lo exige (sólo
    // valida contra el mapa), así que un snapshot algo viejo no invalida nada.
    const path = findPath(
      start,
      goal,
      this.cols,
      this.rows,
      (c, r) => this.blocked[r][c] || this.peerOccupies(c, r),
      door !== null || sitTarget !== null, // meta válida aunque bloqueada
    );
    if (!path || path.length === 0) return;

    // Si la meta es una puerta, se cruza sola al llegar (ver update)
    this.avatar.startPath(path, sitTarget);
    net.path(path); // el servidor simula el mismo camino con AvatarState
    this.showClickMarker(world.x, world.y);
  }

  /**
   * ¿Hay otro jugador plantado (quieto o sentado) en esa celda? Con el ÚLTIMO
   * snapshot, no con el interpolado: éste va 100 ms por detrás a propósito, y
   * aquí interesa lo más parecido a lo que sabe el servidor, que aplica esta
   * misma regla. Las puertas no se ocupan: quien llega a una se está yendo.
   */
  private peerOccupies(col: number, row: number): boolean {
    if (this.doorAt(col, row)) return false;
    for (const v of this.netPlayers) {
      if (v.id === net.id || v.room !== this.roomId || v.moving) continue;
      if (Math.round(v.col) === col && Math.round(v.row) === row) return true;
    }
    return false;
  }

  /**
   * El asiento de una celda, si lo hay. Se miran TODOS los muebles de la
   * celda: en la plaza hay una alfombra bajo el sofá, y buscar sólo el primer
   * mueble devolvía la alfombra, así que ese sofá no se podía usar con el
   * ratón (el servidor sí lo aceptaba).
   */
  private seatAtCell(col: number, row: number): SitTarget | null {
    for (const f of this.furniture) {
      if (f.col !== col || f.row !== row) continue;
      const seat = seatAt(f.kind, col, row);
      if (seat) return seat;
    }
    return null;
  }

  private doorAt(col: number, row: number): Door | undefined {
    return this.doors.find((d) => d.col === col && d.row === row);
  }

  // ---------- Salas ----------

  private resolveRoom(): RoomId {
    const save = loadSave();
    if (save && (ROOMS as readonly string[]).includes(save.room)) {
      return save.room as RoomId;
    }
    return "room1";
  }

  /** Guarda la partida y reinicia la escena en la sala destino */
  private transitionTo(d: Door): void {
    if (this.transitioning) return;
    if (!(ROOMS as readonly string[]).includes(d.target)) return;
    // Guardar el destino ANTES de marcar la transición: a partir de aquí
    // saveGame() ignora los guardados automáticos para que no sobrescriban
    // la sala destino con la posición vieja de la sala actual.
    this.saveGame({ room: d.target, col: d.targetCol, row: d.targetRow });
    this.transitioning = true;
    this.cameras.main.fadeOut(250, 0, 0, 0);
    // El nombre real del evento en Phaser 3 es "camerafadeoutcomplete"
    this.cameras.main.once(
      Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
      () => this.finishTransition(),
    );
    // Respaldo: si el evento de la cámara no llegara, se cruza igual
    this.time.delayedCall(500, () => this.finishTransition());
  }

  /** Cruza a la sala destino (idempotente por si lo llaman dos vías) */
  private finishTransition(): void {
    if (!this.transitioning) return;
    this.scene.restart();
  }

  // ---------- Aspecto ----------

  /**
   * Abre el vestidor sobre el aspecto actual. Nada cambia hasta Guardar.
   * `bienvenida` es la primera vez, recién creada la cuenta.
   */
  private abrirVestidor(bienvenida = false): void {
    if (this.vestidor || this.authModalOpen) return;
    this.closeChat();
    this.closePeerMenu();
    this.cerrarFrases();
    this.avatar.cancelPath();
    this.vestidor = new Vestidor(this, {
      look: this.look,
      titulo: bienvenida ? "¡Bienvenido a Roomie!" : "Vestidor",
      subtitulo: bienvenida ? "Elige cómo quieres que te vean" : "C o Esc para cerrar · ←/→ giran",
      onGuardar: (look) => {
        this.applyLook(look);
        this.cerrarVestidor();
      },
      onCerrar: () => this.cerrarVestidor(),
    });
  }

  private cerrarVestidor(): void {
    this.vestidor?.destroy();
    this.vestidor = null;
  }

  /** Regenera la textura del avatar propio con su aspecto (sin tocar la red) */
  private applyLookLocal(): void {
    createAvatarTexture(this, this.look);
    // El sprite necesita reengancharse a la textura nueva
    this.player.setTexture("avatar", frameInicial(this.avatar.facing));
    this.player.play(
      this.anim(this.animacion("me", this.avatar.facing, this.avatar.sitting !== null, false)),
      true,
    );
  }

  /** Aspecto nuevo: textura, guardado y aviso al servidor (los demás lo ven) */
  private applyLook(next: Look): void {
    const cambio = !mismoLook(next, this.look);
    this.look = next;
    if (!cambio) return;
    this.applyLookLocal();
    this.saveGame();
    net.look(next);
  }

  /** Nombre de animación del avatar LOCAL (prefijo `avatar:`) */
  private anim(name: string): string {
    return animKey("avatar", name);
  }

  // ---------- Guardado ----------

  private saveGame(overrides: Partial<Omit<SaveData, "version">> = {}): void {
    // Durante el cruce de puerta solo se guarda el destino (con overrides)
    if (this.transitioning) return;
    const save = loadSave();
    writeSave({
      room: this.roomId,
      col: Math.round(this.avatar.col),
      row: Math.round(this.avatar.row),
      facing: this.avatar.facing,
      look: this.look,
      nickname: save?.nickname ?? "",
      ...overrides,
    });
  }

  /** Celda de inicio: la guardada si sigue siendo válida, o el centro */
  private resolveStartCell(save: SaveData | null): Cell {
    const fallback = this.firstFreeCell();
    if (!save || save.room !== this.roomId) return fallback;

    const col = Math.round(save.col);
    const row = Math.round(save.row);
    if (!this.inBounds(col, row)) return fallback;
    if (!this.blocked[row][col]) return { col, row };

    // Si la celda guardada está bloqueada (p. ej. el sofá al sentarse),
    // busca la celda libre más cercana
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc;
        const r = row + dr;
        if (this.inBounds(c, r) && !this.blocked[r][c]) return { col: c, row: r };
      }
    }
    return fallback;
  }

  private resolveStartFacing(save: SaveData | null): Facing {
    if (save) return save.facing;
    return FACING_SUR;
  }

  // ---------- Chat ----------

  /** El botón y la tecla del chat: texto propio, o el menú de frases si hablas con frases */
  private alternarChat(): void {
    if (net.hablaConFrases) {
      if (this.menuFrases) this.cerrarFrases();
      else this.abrirFrases();
      return;
    }
    if (this.chatOpen) this.closeChat();
    else this.openChat();
  }

  /** Menú de frases (el chat de los niños, y el rápido de todos) */
  private abrirFrases(): void {
    if (this.authModalOpen || this.vestidor) return;
    this.closeChat();
    this.closePeerMenu();
    this.menuFrases?.destroy();
    this.menuFrases = new MenuFrases(this, {
      alElegir: (id) => {
        this.enviarFrase(id);
        this.cerrarFrases();
      },
      alCerrar: () => this.cerrarFrases(),
    });
  }

  private cerrarFrases(): void {
    this.menuFrases?.destroy();
    this.menuFrases = null;
  }

  /** Una frase o un gesto: el texto lo pone el servidor a partir del id */
  private enviarFrase(id: string): void {
    const f = frasePorId(id);
    if (!f) return;
    if (net.isOnline) {
      net.frase(id);
    } else {
      this.showBubble("me", f.texto);
      this.pushChatLine(`Tú: ${f.texto}`, CHAT_COLORS.mine);
    }
  }

  private openChat(): void {
    if (this.authModalOpen) return; // el modal se lleva la entrada
    // Quien habla con frases no tiene barra de texto
    if (net.hablaConFrases) return this.abrirFrases();
    this.cerrarFrases();
    this.chatOpen = true;
    this.chatText = "";
    this.avatar.cancelPath();
    this.chatBg.setVisible(true);
    this.chatLabel.setVisible(true);
    this.renderChatBar();
    this.renderChatPanel(); // al abrir se ve el historial entero

    // <input> real: en el móvil no hay tecla Enter ni teclado físico, así que
    // sin esto el chat era inaccesible desde un teléfono.
    this.chatInput = createTextInput({
      maxLength: CHAT_MAX,
      onChange: (v) => {
        this.chatText = v;
        this.renderChatBar();
      },
      onSubmit: () => this.sendChat(),
      onCancel: () => this.closeChat(),
    });
    this.chatInput.focus();

    // Las frases, a mano también para quien escribe (rápidas, y en el móvil)
    const anchoBtn = 56;
    this.chatFrasesBtn = boton(
      this,
      CHAT_PANEL.x + CHAT_PANEL.w - 3 - anchoBtn,
      CHAT_BARRA.y + 3,
      anchoBtn,
      CHAT_BARRA.h - 6,
      "Frases",
      () => this.abrirFrases(),
      { capa: LAYER.UI_PANEL + 2 },
    ).objetos;
  }

  private closeChat(): void {
    this.chatOpen = false;
    this.chatText = "";
    this.chatBg.setVisible(false);
    this.chatLabel.setVisible(false);
    for (const o of this.chatFrasesBtn) o.destroy();
    this.chatFrasesBtn = [];
    this.chatInput?.destroy();
    this.chatInput = null;
    this.renderChatPanel(); // al cerrar vuelve el modo "sólo lo reciente"
  }

  private sendChat(): void {
    const msg = this.chatText.trim();
    this.closeChat();
    if (!msg) return;
    // Sin servidor la burbuja es sólo local; con servidor, el eco del server
    // la dibuja (así TODOS vemos lo mismo, incluido yo).
    if (net.isOnline) {
      net.chat(msg); // el eco del servidor lo pintará en el panel
    } else {
      this.showBubble("me", msg);
      this.pushChatLine(`Tú: ${msg}`, CHAT_COLORS.mine);
    }
  }

  private renderChatBar(): void {
    this.chatLabel.setText(
      this.chatText ? `${this.chatText}▌` : "Escribe algo…  (Enter envía, Esc cancela)",
    );
  }

  /** Punto donde flota la burbuja de un avatar ("me" o un id de la sala) */
  private bubbleAnchor(ownerId: string): { x: number; y: number } | null {
    if (ownerId === "me") return this.sobreCabeza(this.player, HUECO_NOMBRE);
    const peer = this.peers.get(ownerId);
    if (!peer) return null;
    return this.sobreCabeza(peer.sprite, HUECO_BURBUJA); // hueco para su nombre
  }

  /** Punto de PANTALLA `hueco` píxeles por encima de la cabeza de un avatar */
  private sobreCabeza(sprite: Phaser.GameObjects.Sprite, hueco: number): { x: number; y: number } {
    const c = this.aPantalla(sprite.x, sprite.y - ALTO_AVATAR);
    return { x: Math.round(c.x), y: Math.round(c.y - hueco) };
  }

  /** Las burbujas siguen a su avatar (o desaparecen si el avatar ya no está) */
  private moveBubbles(): void {
    for (const [id, bubble] of this.bubbles) {
      const at = this.bubbleAnchor(id);
      if (!at) {
        bubble.destroy();
        this.bubbles.delete(id);
      } else {
        bubble.setPosition(Math.round(at.x), Math.round(at.y));
      }
    }
  }

  /**
   * Burbuja sobre la cabeza que dura 4 segundos: pieza pixel art con su
   * cola, el texto partido a la medida. Va en el mundo (sigue al avatar), así
   * que un Container vale: no es interactiva y no tiene scrollFactor 0.
   */
  private showBubble(ownerId: string, message: string): void {
    const at = this.bubbleAnchor(ownerId);
    if (!at) return;
    this.bubbles.get(ownerId)?.destroy();

    // Borde de 1 px, 4 de aire sobre las mayúsculas y 4 bajo la línea base;
    // la cola pisa el borde de abajo para abrirlo
    const txt = texto(this, 0, 0, partirTexto(message, 150).join("\n"), { color: "#1a1a24" });
    const w = txt.width + 12;
    const h = txt.height + 4;
    const x0 = -Math.floor(w / 2);
    const y0 = -h - 6;
    const bg = pieza(this, "burbuja", x0, y0, w, h);
    const cola = this.add.image(-2, y0 + h - 1, "ui:cola").setOrigin(0, 0);
    txt.setPosition(x0 + 6, y0 + 2);

    const container = this.add.container(at.x, at.y, [bg, cola, txt]);
    container.setScrollFactor(0).setDepth(LAYER.WORLD_TOP);
    container.setScale(0.4);
    this.bubbles.set(ownerId, container);

    this.tweens.add({ targets: container, scale: 1, duration: 220, ease: "Back.easeOut" });
    this.time.delayedCall(4000, () => {
      if (this.bubbles.get(ownerId) !== container) return; // ya se sustituyó por otra
      this.tweens.add({
        targets: container,
        alpha: 0,
        duration: 250,
        onComplete: () => {
          if (this.bubbles.get(ownerId) === container) this.bubbles.delete(ownerId);
          container.destroy();
        },
      });
    });
  }

  // ---------- Multijugador (Fase 7) ----------

  /** Conecta y engancha los callbacks de red a ESTA escena */
  private setupNet(): void {
    net.setHandlers({
      onPlayers: (list) => {
        if (!this.alive) return; // escena reiniciándose (cruce de puerta)
        this.netPlayers = list;
        this.snapshots.push({ at: performance.now(), players: list });
        if (this.snapshots.length > SNAPSHOT_BUFFER) this.snapshots.shift();
        this.updateStatusHud();
      },
      onChat: (msg) => {
        if (this.alive) this.onNetChat(msg);
      },
      onStatus: (up) => {
        this.netOnline = up;
        if (!this.alive) return;
        this.updateStatusHud();
        // NO entrar al mundo mientras el modal está pidiendo el nombre.
        //
        // Antes se entraba en cuanto conectaba el socket, así que un jugador
        // nuevo aparecía para los demás como "Huésped-###" sin haber escrito
        // nada. Y era irreversible: ese primer `join` marca `isJoined`, de modo
        // que al pulsar Entrar `sendWhere()` mandaba `room` en vez de `join`
        // — y `room` no lleva nombre. El nickname elegido no llegaba nunca.
        // Sólo se entra al mundo si ya hay identidad confirmada
        if (up && net.autenticado && !this.authModalOpen) this.sendWhere();
      },
      onJoinError: (err) => {
        if (!this.alive) return;
        this.onJoinError(err);
      },
      onAuthOk: (p) => {
        if (!this.alive) return;
        this.onAuthOk(p);
      },
      onAuthError: (err) => {
        if (!this.alive) return;
        this.onAuthError(err);
      },
    });
    net.connect();
    this.netOnline = net.isOnline;
    this.netPlayers = net.roster;
    this.updateStatusHud();
  }

  /** Me presento al servidor (o aviso de que cambié de sala) */
  /**
   * Me presento al servidor. Ya NO manda nombre ni aspecto: eso pertenece a la
   * cuenta y el servidor lo saca de la base de datos.
   */
  private sendWhere(): void {
    // Sin fecha de nacimiento el servidor no deja entrar: se pide antes
    if (!net.autenticado || net.identidad?.necesitaNacimiento) return;
    const where = {
      room: this.roomId,
      col: Math.round(this.avatar.col),
      row: Math.round(this.avatar.row),
      facing: this.avatar.facing,
    };
    if (net.isJoined) net.changeRoom(where);
    else net.join(where);
  }

  /** Manda el teclado cuando cambia (y un refuerzo cada 250 ms mientras se pulsa) */
  private sendMove(mx: number, my: number): void {
    if (!net.isOnline) return;
    const now = this.time.now;
    const changed = mx !== this.sentMove.mx || my !== this.sentMove.my;
    const active = mx !== 0 || my !== 0;
    if (!changed && !(active && now - this.lastMoveSent > 250)) return;
    net.move(mx, my);
    this.sentMove = { mx, my };
    this.lastMoveSent = now;
  }

  /** Chat recibido del servidor: burbuja sobre quien habló, o aviso de sistema */
  private onNetChat(msg: ChatPayload): void {
    if (msg.system) {
      this.pushChatLine(msg.text, CHAT_COLORS.system);
      return;
    }
    if (!msg.text) return;

    const mio = !msg.from || msg.from === net.id;
    const quien = mio ? "me" : (msg.from as string);
    if (!mio) {
      const view = this.netPlayers.find((p) => p.id === msg.from);
      if (!view || view.room !== this.roomId) return; // no está en mi sala
    }
    this.showBubble(quien, msg.text);
    // El gesto de saludar también se ve en el cuerpo, no sólo en la burbuja
    if (msg.frase === GESTO_SALUDO || msg.text === "👋") this.saludos.set(quien, this.time.now + SALUDO_MS);
    // Burbuja sobre la cabeza Y línea en el panel: la burbuja se va en 4 s,
    // el panel conserva la conversación.
    this.pushChatLine(`${msg.name}: ${msg.text}`, mio ? CHAT_COLORS.mine : CHAT_COLORS.other);
  }

  /** Aviso del servidor en la esquina inferior (entró/salió), 3 líneas */
  /**
   * Añade una línea al historial. El texto largo se parte aquí (y no con el
   * `wordWrap` de Phaser) porque cada línea lleva su propio color.
   */
  private pushChatLine(text: string, color: string): void {
    const at = this.time.now;
    for (const trozo of this.wrapChat(text)) {
      this.chatLines.push({ text: trozo, color, at });
    }
    if (this.chatLines.length > CHAT_HISTORY) {
      this.chatLines = this.chatLines.slice(-CHAT_HISTORY);
    }
    this.renderChatPanel();
  }

  /** Parte un mensaje en líneas que quepan en el panel (la fuente es proporcional) */
  private wrapChat(text: string): string[] {
    return partirTexto(text, CHAT_PANEL.w - 18);
  }

  /**
   * Dibuja el panel. Con el chat abierto se ve entero y con fondo; cerrado,
   * sólo las líneas recientes y sin fondo, como en Minecraft.
   */
  private renderChatPanel(): void {
    if (this.chatLineTexts.length === 0) return;
    const ahora = this.time.now;
    const visibles = this.chatLines
      .filter((l) => this.chatOpen || ahora - l.at < CHAT_FADE_MS)
      .slice(-CHAT_PANEL.lines);

    this.chatPanelBg.setVisible(this.chatOpen);

    // Se pintan de abajo hacia arriba: la más nueva, la de más abajo
    for (let i = 0; i < this.chatLineTexts.length; i++) {
      const obj = this.chatLineTexts[i];
      const linea = visibles[visibles.length - 1 - i];
      if (!linea) {
        obj.setVisible(false);
        continue;
      }
      obj
        .setText(linea.text)
        .setColor(linea.color)
        .setPosition(CHAT_PANEL.x + 8, CHAT_PANEL.bottom - i * CHAT_PANEL.lineH)
        .setVisible(true);
    }
  }

  /** Contador de la sala en la barra de estado */
  private updateStatusHud(): void {
    // "netPlayers" es el snapshot de la sala que manda el servidor y YA me
    // incluye a mí. El "1 +" que había aquí me sumaba una segunda vez: estando
    // solo, el HUD mostraba "2 en room1".
    const here = this.netPlayers.filter((p) => p.room === this.roomId).length;
    this.hud?.actualizar({
      sala: this.theme?.nombre ?? this.roomId,
      enLinea: this.netOnline,
      gente: Math.max(here, 1),
      saldo: net.identidad?.saldo ?? null,
    });
  }


  /**
   * Identidad confirmada: el aspecto y el saldo vienen del servidor, no del
   * guardado local. A partir de aquí ya se puede entrar al mundo.
   */
  private onAuthOk(p: AuthOkPayload): void {
    // Cuenta de antes: sin fecha de nacimiento no hay normas que aplicarle, y
    // el servidor no deja entrar. Se pide y, al darla, llega otro authOk.
    if (p.necesitaNacimiento) {
      this.closeAuthModal();
      this.showAuthModal("nacimiento");
      return;
    }
    this.look = sanitizeLook(p.look);
    this.applyLookLocal();
    this.closeAuthModal();
    this.saveGame();
    this.pushChatLine(`Hola, ${p.nickname}. Tienes ${p.saldo} monedas.`, CHAT_COLORS.mine);
    this.sendWhere();
    this.updateStatusHud();
    // Cuenta recién creada: lo primero, elegir cómo te van a ver
    if (this.recienRegistrado) {
      this.recienRegistrado = false;
      this.abrirVestidor(true);
    }
  }

  private onAuthError(err: AuthErrorPayload): void {
    // Por debajo de la edad mínima: este navegador no vuelve a intentarlo en
    // un día. Si no, bastaría con cambiar el año y darle otra vez.
    if (err.code === "UNDER_AGE") marcarEdadRechazada();
    // Si el modal está abierto, el mensaje va dentro. Si no (p. ej. el token
    // guardado caducó al reconectar), hay que volver a pedir credenciales.
    if (this.authModalOpen) {
      this.mensajeAuth(err.message);
      return;
    }
    this.showAuthModal("login");
    this.mensajeAuth(err.message);
  }

  /** Error al unirse (nickname duplicado, etc.) */
  private onJoinError(err: JoinErrorPayload): void {
    if (err.code !== "DUPLICATE_NAME") return;

    // El texto de error pertenece al modal: si está cerrado hay que abrirlo
    // ANTES de intentar escribir en él.
    // Esto ya no es "el nombre está cogido" sino "esa cuenta ya está dentro
    // en otra pestaña", así que no tiene sentido reabrir el formulario.
    this.pushChatLine(err.message, CHAT_COLORS.system);
  }

  // ---------- Modal de cuenta ----------
  //
  // Tres modos sobre el mismo panel:
  //   login    — usuario + contraseña
  //   register — usuario + contraseña + nombre en el juego + aspecto
  //   profile  — ya dentro: sólo aspecto y cerrar sesión
  //
  // El nombre del jugador YA NO se elige aquí cada vez: pertenece a la cuenta
  // y vive en la base de datos. Antes el cliente decía cómo se llamaba y el
  // servidor se lo creía.

  private showAuthModal(modo: AuthModalMode = "login"): void {
    if (this.authModalOpen) return; // no apilar
    this.authModalOpen = true;
    this.authMode = modo;
    this.chatOpen = false;
    this.closeChat();
    this.closePeerMenu();
    this.cerrarFrases();
    this.cerrarVestidor();
    // El teclado del juego se apaga entero: si no, escribir una "c" abre el
    // vestidor y Enter abre el chat detrás del modal.
    this.setGameKeyboard(false);

    const registro = modo === "register";
    const perfil = modo === "profile";
    const nacimiento = modo === "nacimiento";

    // La altura se CALCULA a partir de lo que va dentro, no se elige a ojo.
    // Puesta a mano, el botón acababa montado encima de lo de arriba.
    //
    // El aspecto ya no se elige aquí: tiene su vestidor, que se abre solo al
    // crear la cuenta y desde el botón del perfil.
    const PAD = 16;
    const TITULO = 16 + 12; // rombo y título + hueco
    const ALTO_CAMPO = 24;
    const CAMPO = 15 + 3 + ALTO_CAMPO + 10; // etiqueta + caja + hueco
    const MENSAJE = 36; // hasta dos líneas
    const INFO = 44; // datos de la cuenta en el perfil
    const ALTO_BOTON = 26;
    const BOTONES = ALTO_BOTON + 8 + ALTO_BOTON;
    // Filas de campos: usuario, contraseña, nombre y fecha de nacimiento
    const nCampos = perfil ? 0 : nacimiento ? 1 : registro ? 4 : 2;
    const EXPLICA = nacimiento ? 40 : 0; // por qué se pide la fecha
    const W = 300;
    const H = PAD + TITULO + EXPLICA + nCampos * CAMPO + MENSAJE + (perfil ? INFO : 0) + BOTONES + PAD;
    // Encima del panel, el nombre del juego (no en el perfil: ya estás dentro)
    const LOGO = perfil ? 0 : 64;
    const X = 480 - W / 2;
    const Y = Math.round((540 - LOGO - H) / 2) + LOGO;
    const colX = X + 16;
    const anchoCampo = W - 32;

    const add = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(
      o: T,
      capa = 1,
    ): T => {
      o.setScrollFactor(0).setDepth(LAYER.UI_MODAL + capa);
      this.authUI.push(o);
      return o;
    };

    // Velo: la sala se intuye detrás, oscurecida; se come todos los clics
    add(this.add.rectangle(480, 270, 960, 540, UI_HEX.velo, perfil ? 0.7 : 0.82).setInteractive(), 0);

    if (!perfil) {
      // El logo es lo único a 24 px: la casa y la palabra, a la par
      const logo = texto(this, 0, 0, "Roomie", { tam: 2, color: UI.titulo });
      const casa = icono(this, "casa", 0, 0).setScale(2);
      const ancho = casa.displayWidth + 10 + logo.width;
      const x0 = Math.round(480 - ancho / 2);
      const yLogo = Y - LOGO;
      casa.setPosition(x0, yLogo + 4);
      logo.setPosition(x0 + casa.displayWidth + 10, yLogo);
      add(casa, 2);
      add(logo, 2);
      add(centrar(texto(this, 0, 0, "Tu casa, tu gente, tu mundo", { color: UI.suave }), 480, Y - 18), 2);
    }

    add(pieza(this, "panel", X, Y, W, H).setInteractive(), 1);
    const titulo = perfil ? "Tu perfil" : registro ? "Crear cuenta" : nacimiento ? "Un último paso" : "Entrar";
    const tituloTxt = texto(this, 0, yCentrada(Y + PAD, 16), titulo, { color: UI.titulo });
    const rombo = icono(this, "rombo", 0, 0);
    const anchoTitulo = rombo.width + 6 + tituloTxt.width;
    rombo.setPosition(Math.round(480 - anchoTitulo / 2), Y + PAD + 6);
    tituloTxt.setX(rombo.x + rombo.width + 6);
    add(rombo, 2);
    add(tituloTxt, 2);

    let cursorY = Y + PAD + TITULO;

    if (nacimiento) {
      const explica = partirTexto("Para cuidar a todo el mundo en Roomie, dinos cuándo naciste. Nadie más lo verá.", 268);
      add(texto(this, 480, cursorY, explica.join("\n"), { color: UI.suave, alinear: "center" }).setOrigin(0.5, 0), 2);
      cursorY += EXPLICA;
    }

    // ---------- Campos de texto ----------
    this.authCampos = [];
    const campo = (clave: CampoClave, etiqueta: string, secreto: boolean, autocomplete: string, inicial = ""): void => {
      add(texto(this, colX, cursorY, etiqueta, { color: UI.suave }), 2);
      const yCaja = cursorY + 18;
      const fondo = add(pieza(this, "campo", colX, yCaja, anchoCampo, ALTO_CAMPO).setInteractive({ useHandCursor: true }), 1);
      const txt = add(texto(this, colX + 8, yCentrada(yCaja, ALTO_CAMPO), ""), 2);

      const c: CampoAuth = { clave, fondo, texto: txt, secreto, input: null };
      c.input = createTextInput({
        maxLength: secreto ? PASS_MAX : NAME_MAX,
        initial: inicial,
        type: secreto ? "password" : "text",
        autocomplete,
        onChange: () => this.pintarCampos(),
        onSubmit: () => this.submitAuth(),
        onCancel: () => this.closeAuthModal(),
        onNext: () => this.enfocarSiguiente(),
      });
      fondo.on("pointerdown", () => this.enfocarCampo(c));
      this.authCampos.push(c);
      cursorY += CAMPO;
    };

    // Fecha de nacimiento: día, mes y año en tres cajas. No se dice para qué
    // edad hay límite: un control de edad que lo anuncia invita a mentir.
    const campoFecha = (): void => {
      add(texto(this, colX, cursorY, "Fecha de nacimiento", { color: UI.suave }), 2);
      const yCaja = cursorY + 18;
      const cajas: [CampoClave, string, number, number, string][] = [
        ["dia", "Día", 2, 52, "bday-day"],
        ["mes", "Mes", 2, 52, "bday-month"],
        ["anio", "Año", 4, 76, "bday-year"],
      ];
      let x = colX;
      for (const [clave, placeholder, max, ancho, autocomplete] of cajas) {
        const fondo = add(pieza(this, "campo", x, yCaja, ancho, ALTO_CAMPO).setInteractive({ useHandCursor: true }), 1);
        const txt = add(texto(this, x + 8, yCentrada(yCaja, ALTO_CAMPO), ""), 2);
        const c: CampoAuth = { clave, fondo, texto: txt, secreto: false, input: null, placeholder };
        c.input = createTextInput({
          maxLength: max,
          autocomplete,
          onChange: (v) => {
            // Sólo cifras; al llenar una caja se salta a la siguiente
            const limpio = v.replace(/\D/g, "").slice(0, max);
            if (limpio !== v) c.input?.setValue(limpio);
            if (limpio.length === max && clave !== "anio") this.enfocarSiguiente();
            this.pintarCampos();
          },
          onSubmit: () => this.submitAuth(),
          // Sin fecha no se juega: en ese paso Esc no cierra nada
          onCancel: () => {
            if (!nacimiento) this.closeAuthModal();
          },
          onNext: () => this.enfocarSiguiente(),
        });
        // En el móvil, el teclado de números
        c.input.el.inputMode = "numeric";
        fondo.on("pointerdown", () => this.enfocarCampo(c));
        this.authCampos.push(c);
        x += ancho + 8;
      }
      cursorY += CAMPO;
    };

    if (!perfil && !nacimiento) {
      campo("username", "Usuario", false, "username");
      campo("password", "Contraseña", true, registro ? "new-password" : "current-password");
    }
    if (registro) campo("nickname", "Tu nombre en el juego", false, "nickname");
    if (registro || nacimiento) campoFecha();

    // ---------- Mensaje (errores, "Conectando…") ----------
    // Una o dos líneas centradas en su hueco (ver `mensajeAuth`)
    this.authError = add(texto(this, 480, cursorY + 4, "", { color: UI.error, alinear: "center" }).setOrigin(0.5, 0), 2);
    cursorY += MENSAJE;

    // ---------- Datos de la cuenta (perfil) ----------
    if (perfil) {
      const yo = net.identidad;
      if (yo) {
        const quien = texto(this, 0, cursorY, `${yo.nickname}  ·  @${yo.username}`);
        quien.setX(Math.round(480 - quien.width / 2));
        add(quien, 2);
        const saldo = texto(this, 0, cursorY + 19, `${yo.saldo} monedas`, { color: UI.titulo });
        const moneda = icono(this, "moneda", 0, cursorY + 22);
        const ancho = moneda.width + 6 + saldo.width;
        moneda.setX(Math.round(480 - ancho / 2));
        saldo.setX(moneda.x + moneda.width + 6);
        add(moneda, 2);
        add(saldo, 2);
      }
      cursorY += INFO;
      // Sin campos de texto no hay Esc que valga: el perfil se cierra aquí
      const cerrar = boton(this, X + W - 28, Y + 8, 20, 20, "", () => this.closeAuthModal(), {
        icono: "cerrar",
        capa: LAYER.UI_MODAL + 3,
      });
      this.authUI.push(...cerrar.objetos);
    }

    // ---------- Botones ----------
    // Los botones cuelgan del final del contenido, no de una altura fija
    const principal = perfil ? "Vestidor" : registro ? "Crear cuenta y entrar" : nacimiento ? "Seguir" : "Entrar";
    const b1 = boton(
      this,
      colX,
      cursorY,
      anchoCampo,
      ALTO_BOTON,
      principal,
      () => {
        if (!perfil) return this.submitAuth();
        this.closeAuthModal();
        this.abrirVestidor();
      },
      { primario: true, icono: perfil ? "camiseta" : undefined, capa: LAYER.UI_MODAL + 2 },
    );
    const segundo = perfil || nacimiento ? "Cerrar sesión" : registro ? "Ya tengo cuenta" : "Crear una cuenta nueva";
    const b2 = boton(
      this,
      colX,
      cursorY + ALTO_BOTON + 8,
      anchoCampo,
      ALTO_BOTON,
      segundo,
      () => {
        if (perfil || nacimiento) return this.cerrarSesion();
        this.closeAuthModal();
        this.showAuthModal(registro ? "login" : "register");
      },
      { capa: LAYER.UI_MODAL + 2 },
    );
    this.authUI.push(...b1.objetos, ...b2.objetos);

    this.pintarCampos();
    if (this.authCampos[0]) this.enfocarCampo(this.authCampos[0]);
  }

  /** Dibuja el contenido de cada campo (las contraseñas, con puntos; vacío, su pista apagada) */
  private pintarCampos(): void {
    for (const c of this.authCampos) {
      const valor = c.input?.el.value ?? "";
      const activo = c === this.campoActivo;
      const visible = c.secreto ? "•".repeat(valor.length) : valor;
      const pista = !valor && !activo && c.placeholder;
      c.texto.setText(pista ? (c.placeholder ?? "") : visible + (activo ? "▌" : "")).setColor(pista ? UI.tenue : UI.texto);
      c.fondo.setTexture(activo ? "ui:campo-activo" : "ui:campo");
    }
  }

  private enfocarCampo(c: CampoAuth): void {
    this.campoActivo = c;
    c.input?.focus();
    this.pintarCampos();
  }

  private enfocarSiguiente(): void {
    const i = this.authCampos.indexOf(this.campoActivo as CampoAuth);
    const siguiente = this.authCampos[(i + 1) % this.authCampos.length];
    if (siguiente) this.enfocarCampo(siguiente);
  }

  private valorCampo(clave: CampoClave): string {
    return this.authCampos.find((c) => c.clave === clave)?.input?.el.value ?? "";
  }

  /**
   * Mensaje bajo los campos: cabe en dos líneas del ancho del panel. Si sale
   * una sola, se baja media línea para que quede centrada en el hueco.
   */
  private mensajeAuth(texto: string, color: string = UI.error): void {
    if (!this.authError) return;
    const lineas = partirTexto(texto, 268).slice(0, 2);
    if (!this.authError.getData("y0")) this.authError.setData("y0", this.authError.y);
    const y0 = this.authError.getData("y0") as number;
    this.authError.setColor(color).setText(lineas.join("\n"));
    this.authError.setY(lineas.length > 1 ? y0 : y0 + 8);
  }

  /** La fecha de las tres cajas como "AAAA-MM-DD", o null si no es una fecha real */
  private fechaEscrita(): string | null {
    const dia = this.valorCampo("dia");
    const mes = this.valorCampo("mes");
    const anio = this.valorCampo("anio");
    if (!dia || !mes || anio.length !== 4) return null;
    return parsearNacimiento(`${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`);
  }

  /** Cuenta de antes: manda la fecha que faltaba (el servidor contesta con otro authOk) */
  private submitNacimiento(): void {
    const fecha = this.fechaEscrita();
    if (!fecha) return this.mensajeAuth("Revisa la fecha: día, mes y año.");
    if (edadRechazadaReciente()) return this.mensajeAuth("Lo sentimos: todavía no puedes usar esta cuenta.");
    if (!net.isOnline) return this.mensajeAuth("Sin conexión con el servidor.");
    this.mensajeAuth("Un momento…", UI.suave);
    net.nacimiento(fecha);
  }

  private submitAuth(): void {
    if (this.authMode === "profile") return; // el perfil no envía nada
    if (this.authMode === "nacimiento") return this.submitNacimiento();

    const username = this.valorCampo("username").trim();
    const password = this.valorCampo("password");
    const nickname = this.valorCampo("nickname").trim();
    const registro = this.authMode === "register";

    if (username.length < USER_MIN) {
      return this.mensajeAuth(`El usuario necesita al menos ${USER_MIN} caracteres.`);
    }
    if (password.length < PASS_MIN) {
      return this.mensajeAuth(`La contraseña necesita al menos ${PASS_MIN} caracteres.`);
    }
    if (registro && nickname.length === 0) {
      return this.mensajeAuth("Elige el nombre con el que te verán los demás.");
    }
    const fecha = registro ? this.fechaEscrita() : null;
    if (registro && !fecha) {
      return this.mensajeAuth("Revisa tu fecha de nacimiento: día, mes y año.");
    }
    if (registro && edadRechazadaReciente()) {
      return this.mensajeAuth("Lo sentimos: todavía no puedes crear una cuenta.");
    }
    if (!net.isOnline) {
      return this.mensajeAuth("Sin conexión con el servidor.");
    }

    this.mensajeAuth("Conectando…", UI.suave);
    // Al registrarse se parte del aspecto por defecto (o del último guardado);
    // el vestidor se abre nada más entrar para elegir el suyo.
    this.recienRegistrado = registro;
    net.auth({
      mode: registro ? "register" : "login",
      username,
      password,
      nickname: registro ? nickname : undefined,
      look: registro ? this.look : undefined,
      nacimiento: fecha ?? undefined,
    });
  }

  private cerrarSesion(): void {
    net.logout();
    this.closeAuthModal();
    clearSave();
    this.scene.restart();
  }

  private closeAuthModal(): void {
    this.authModalOpen = false;
    this.authError = null;
    this.campoActivo = null;

    // Los <input> viven en el DOM, fuera de Phaser: hay que quitarlos a mano
    for (const c of this.authCampos) c.input?.destroy();
    this.authCampos = [];

    for (const o of this.authUI) {
      if (o.active) o.destroy();
    }
    this.authUI = [];

    this.setGameKeyboard(true);
  }


  /**
   * Apaga o enciende el teclado del juego. Mientras un modal escribe texto,
   * las teclas son suyas y de nadie más.
   */
  private setGameKeyboard(on: boolean): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.enabled = on;
    // Sin esto, una tecla que estuviera pulsada al abrir el modal se queda
    // "pulsada" para siempre y el avatar camina solo al cerrarlo.
    if (!on) kb.resetKeys();
  }

  /** Sprite + nombre de un jugador remoto (se crea la primera vez que aparece) */
  private ensurePeer(v: PlayerView): Peer {
    const existing = this.peers.get(v.id);
    if (existing) return existing;

    const textureKey = `avatar:${v.id}`;
    const look = sanitizeLook(v.look);
    createAvatarTexture(this, look, textureKey);
    const sprite = this.add.sprite(0, 0, textureKey, frameInicial(v.facing)).setOrigin(ORIGEN.x, ORIGEN.y);
    // Zona de toque: el cuerpo entero y un poco más (coordenadas del
    // fotograma de 48×84; el muñeco ocupa el centro, de ~12 a ~36 de ancho).
    // Con el dedo, ajustarse al dibujo se falla demasiado.
    sprite
      .setInteractive(new Phaser.Geom.Rectangle(8, 6, 32, 76), Phaser.Geom.Rectangle.Contains)
      .on("pointerdown", () => this.openPeerMenu(v.id));
    if (sprite.input) sprite.input.cursor = "pointer";
    const label = this.etiquetaNombre(v.name);

    const peer: Peer = {
      view: v,
      sprite,
      label,
      col: v.col,
      row: v.row,
      textureKey,
      look,
    };
    this.peers.set(v.id, peer);
    return peer;
  }

  /**
   * Nombre sobre la cabeza: pastilla oscura translúcida de 16 px con el texto
   * a 12, anclada abajo al centro. La caja del texto empieza en el borde de
   * arriba: sus 3 px de aire dejan las mayúsculas a 2 px del borde.
   */
  private etiquetaNombre(nombre: string): Phaser.GameObjects.Container {
    const t = texto(this, 0, 0, nombre, { color: UI.titulo });
    const w = t.width + 10;
    const h = 16;
    const x0 = -Math.floor(w / 2);
    const fondo = pieza(this, "nombre", x0, -h, w, h);
    t.setPosition(x0 + 5, -h);
    return this.add.container(0, 0, [fondo, t]);
  }

  /** Borra un jugador remoto del mundo (y sus texturas) */
  private removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (this.peerMenuFor === id) this.closePeerMenu();
    peer.sprite.destroy();
    peer.label.destroy();
    this.bubbles.get(id)?.destroy();
    this.bubbles.delete(id);
    this.saludos.delete(id);
    destroyAvatarAssets(this, peer.textureKey);
    this.peers.delete(id);
  }

  /**
   * Estado de los remotos en `ahora - INTERP_DELAY_MS`, interpolando entre los
   * dos snapshots que rodean ese instante.
   *
   * No se EXTRAPOLA: si el buffer se queda seco (corte de red) el remoto se
   * congela en su última posición conocida. Inventar posiciones que luego hay
   * que desmentir es justo lo que produce tirones.
   */
  private interpolatedViews(): PlayerView[] {
    const buf = this.snapshots;
    // Sin historia suficiente (recién entrado, o escena recién reiniciada al
    // cruzar una puerta): se dibuja el último snapshot crudo.
    if (buf.length < 2) return this.netPlayers;

    const renderAt = performance.now() - INTERP_DELAY_MS;

    let i = -1;
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k].at <= renderAt) {
        i = k;
        break;
      }
    }
    if (i < 0) return buf[0].players; // todo el buffer es posterior al instante
    if (i === buf.length - 1) return buf[i].players; // no hay snapshot siguiente

    const from = buf[i];
    const to = buf[i + 1];
    const span = to.at - from.at;
    const a = span > 0 ? (renderAt - from.at) / span : 0;

    // El snapshot NUEVO manda en todo lo discreto (quién está, hacia dónde
    // mira, si está sentado); sólo la posición se mezcla con el anterior.
    const prev = new Map(from.players.map((p) => [p.id, p]));
    return to.players.map((p) => {
      const q = prev.get(p.id);
      if (!q) return p; // acaba de aparecer: nada con que interpolar
      return { ...p, col: q.col + (p.col - q.col) * a, row: q.row + (p.row - q.row) * a };
    });
  }

  /**
   * Dibuja a los jugadores de MI sala en su posición interpolada.
   * Quien está en otra sala no se dibuja.
   */
  private syncPeers(): void {
    const visible = new Set<string>();

    for (const v of this.interpolatedViews()) {
      if (v.id === net.id || v.room !== this.roomId) continue;
      visible.add(v.id);

      const peer = this.ensurePeer(v);
      peer.view = v;

      // Cambió el aspecto del remoto → regenerar SU textura (no la mía)
      const look = sanitizeLook(v.look);
      if (!mismoLook(peer.look, look)) {
        peer.look = look;
        createAvatarTexture(this, look, peer.textureKey);
        peer.sprite.setTexture(peer.textureKey, frameInicial(v.facing));
      }

      peer.col = v.col;
      peer.row = v.row;

      // Sentado, a la altura de SU asiento (el taburete es más alto que el sofá)
      const asiento = v.sitting ? (this.seatAtCell(Math.round(v.col), Math.round(v.row))?.alto ?? null) : null;
      const p = peerScreen(peer.col, peer.row, asiento);
      peer.sprite.setPosition(p.x, p.y).setDepth(worldDepth(p.depth));
      // La animación la decide el SERVIDOR (`moving`/`facing`), que ya lo envía
      // en cada snapshot. Antes se deducía del desplazamiento en píxeles entre
      // frames: con un suavizado el delta nunca llega a cero exacto, así que el
      // remoto parpadeaba entre caminar y estar quieto.
      peer.sprite.play(animKey(peer.textureKey, this.animacion(v.id, v.facing, v.sitting, v.moving)), true);
      // En pantalla y redondeado: a tamaño fijo con cualquier zoom, y la
      // pastilla a medio píxel emborronaría el texto
      const nombre = this.sobreCabeza(peer.sprite, HUECO_NOMBRE);
      peer.label.setPosition(nombre.x, nombre.y).setScrollFactor(0).setDepth(LAYER.WORLD_LABEL);
    }

    for (const id of [...this.peers.keys()]) {
      if (!visible.has(id)) this.removePeer(id);
    }
  }

  /**
   * Predicción vs. autoridad, SIN salto.
   *
   * Mi avatar lo muevo yo (instantáneo) y el servidor va siempre un poco por
   * detrás, porque mi entrada tarda en llegarle. Ese desfase constante NO se
   * corrige: cae en la zona muerta y es invisible. Lo que la supera se absorbe
   * arrastrando, nunca teletransportando — el salto de antes (cada 2 s, más de
   * 1 celda) era exactamente el rubber banding que se veía al detenerse.
   *
   * Se ejecuta CADA frame, no cada 2 s: cuanto antes se empieza a absorber un
   * error, menos hay que absorber y menos se nota.
   */
  private reconcile(dt: number): void {
    if (!net.isOnline) return;
    const self = net.self();
    if (!self || self.room !== this.roomId) return;

    // Quieto yo (sin camino ni teclas) y quieto el servidor
    const atRest =
      !self.moving &&
      this.avatar.path.length === 0 &&
      this.sentMove.mx === 0 &&
      this.sentMove.my === 0;
    this.reconcileSitting(self, atRest);

    const dCol = self.col - this.avatar.col;
    const dRow = self.row - this.avatar.row;
    const drift = Math.hypot(dCol, dRow);

    if (drift <= (atRest ? REST_DEADZONE : CORRECTION_DEADZONE)) return;

    // Divergencia real, no deriva: adoptar la posición autoritativa.
    //
    // Si me quedé atrás (pestaña congelada, un tirón) y el servidor ya me
    // tiene en una puerta, el salto me deja en ella y `update` cruza: estar
    // en una puerta sin camino es cruzarla, venga de donde venga.
    if (drift > CORRECTION_TELEPORT) {
      this.avatar.col = self.col;
      this.avatar.row = self.row;
      this.avatar.cancelPath();
      return;
    }

    // Arrastre exponencial, independiente del fps
    const k = 1 - Math.exp(-CORRECTION_RATE * dt);
    const col = this.avatar.col + dCol * k;
    const row = this.avatar.row + dRow * k;
    // El destino del servidor siempre es válido, pero el punto intermedio del
    // arrastre podría rozar una esquina bloqueada: el arrastre no salta muros.
    // Salir de la celda en la que ya se está sí vale aunque esté bloqueada
    // (el sofá): si no, quien se levanta de un asiento que el servidor le negó
    // se quedaría clavado en él para siempre.
    const c = Math.round(col);
    const r = Math.round(row);
    const same = c === Math.round(this.avatar.col) && r === Math.round(this.avatar.row);
    if (this.inBounds(c, r) && (same || !this.blocked[r][c])) {
      this.avatar.col = col;
      this.avatar.row = row;
    }
  }

  /**
   * Sentado o de pie: si el servidor y yo no coincidimos durante más de un
   * viaje de ida y vuelta, gana el servidor. Pasa cuando dos llegan al mismo
   * asiento casi a la vez: cada uno decide con lo que sabe y uno de los dos
   * se equivoca. Sin esto, uno se vería sentado encima del otro en su
   * pantalla mientras los demás lo ven de pie al lado.
   */
  private reconcileSitting(self: PlayerView, atRest: boolean): void {
    const sittingHere = this.avatar.sitting !== null;
    // Sólo cuenta la discrepancia cuando ya no puede ser retraso: yo quieto
    // si el servidor me sienta, y el servidor quieto si soy yo quien se sentó.
    const mismatch = self.sitting ? !sittingHere && atRest : sittingHere && !self.moving;
    if (!mismatch) {
      this.sitMismatchSince = 0;
      return;
    }
    const now = performance.now();
    if (this.sitMismatchSince === 0) this.sitMismatchSince = now;
    if (now - this.sitMismatchSince < SIT_MISMATCH_MS) return;

    this.sitMismatchSince = 0;
    this.avatar.cancelPath();
    if (self.sitting) {
      const col = Math.round(self.col);
      const row = Math.round(self.row);
      // El asiento dice altura y dirección; si el servidor me sentó donde yo
      // no veo asiento (no debería pasar), al menos se respeta su dirección.
      this.avatar.sitAt(this.seatAtCell(col, row) ?? { col, row, alto: 14, dir: self.facing });
    } else {
      this.avatar.stand();
    }
  }

  // ---------- Menú de avatar ----------

  /**
   * Menú que sale al tocar a otro jugador: gestos, hablarle, bloquear y
   * reportar. Los gestos son frases del menú: los ve toda la sala, niños
   * incluidos. Bloquear y reportar están SIEMPRE a mano, a un toque.
   */
  private openPeerMenu(id: string): void {
    if (this.authModalOpen || this.vestidor) return;
    this.closePeerMenu();
    this.cerrarFrases();

    const peer = this.peers.get(id);
    if (!peer) return;

    this.menuTam = { w: 180, h: 118 };
    const { w: W, h: H } = this.menuTam;
    const m = this.piezasMenu();
    m.fondo(W, H);
    m.cabecera(peer.view.name);

    // Gestos: el emoji lo pinta la fuente del sistema
    GESTOS.forEach((g, i) => {
      const dx = 8 + i * 28;
      m.boton("", dx, 28, 24, 24, () => {
        this.closePeerMenu();
        this.enviarFrase(g.id);
      });
      m.add(this.add.text(0, 0, g.texto, { fontSize: "13px" }).setOrigin(0.5), dx + 12, 40, LAYER.UI_PANEL + 1);
    });

    // Hablarle: con texto propio, o con frases si hablas con frases
    if (net.hablaConFrases) {
      m.boton("Decir algo", 8, 60, W - 16, 24, () => this.abrirFrases(), true);
    } else {
      m.boton(`Escribir a ${peer.view.name}`, 8, 60, W - 16, 24, () => this.chatTo(peer.view.name), true);
    }

    const bloqueado = net.tieneBloqueado(peer.view.name);
    const mitad = Math.floor((W - 16 - 4) / 2);
    m.boton(bloqueado ? "Desbloquear" : "Bloquear", 8, 90, mitad, 20, () => {
      this.closePeerMenu();
      net.bloquear(peer.view.id, !bloqueado);
    });
    m.boton("Reportar", 8 + mitad + 4, 90, mitad, 20, () => this.abrirReporte(peer.view.id));

    this.peerMenuItems = m.items;
    this.peerMenuFor = id;
    this.movePeerMenu();
  }

  /** Reportar: por qué, con palabras que entiende cualquiera */
  private abrirReporte(id: string): void {
    const peer = this.peers.get(id);
    this.closePeerMenu();
    if (!peer) return;
    const W = 220;
    const H = 30 + (MOTIVOS_REPORTE.length + 1) * 26 + 4;
    this.menuTam = { w: W, h: H };
    const m = this.piezasMenu();
    m.fondo(W, H);
    m.cabecera(`¿Qué pasa con ${peer.view.name}?`);
    MOTIVOS_REPORTE.forEach((r, i) => {
      m.boton(r.texto, 8, 30 + i * 26, W - 16, 22, () => {
        this.closePeerMenu();
        net.reportar(peer.view.id, r.motivo);
      });
    });
    m.boton("Cancelar", 8, 30 + MOTIVOS_REPORTE.length * 26, W - 16, 22, () => this.closePeerMenu());
    this.peerMenuItems = m.items;
    this.peerMenuFor = id;
    this.movePeerMenu();
  }

  /**
   * Piezas de un menú que sigue a un avatar. Se colocan por desplazamiento
   * desde la esquina del menú (ver `MenuItem`), así que los botones se hacen
   * aquí a mano: los del kit no se pueden mover una vez creados.
   */
  private piezasMenu() {
    const items: MenuItem[] = [];
    const add = <T extends MenuItem["o"] & { setScrollFactor(v: number): T; setDepth(v: number): T }>(
      o: T,
      dx: number,
      dy: number,
      capa: number = LAYER.UI_PANEL,
    ): T => {
      o.setScrollFactor(0).setDepth(capa);
      items.push({ o, dx, dy });
      return o;
    };
    return {
      items,
      add,
      // El fondo es interactivo para que un toque DENTRO del menú no lo cierre
      fondo: (w: number, h: number) => add(pieza(this, "panel", 0, 0, w, h).setInteractive(), 0, 0),
      cabecera: (titulo: string) => {
        add(icono(this, "rombo", 0, 0), 8, 11, LAYER.UI_PANEL + 1);
        add(texto(this, 0, 0, titulo, { color: UI.titulo }), 22, yCentrada(0, 26), LAYER.UI_PANEL + 1);
      },
      boton: (etiqueta: string, dx: number, dy: number, w: number, h: number, accion: () => void, primario = false) => {
        const base = primario ? "primario" : "boton";
        const f = add(pieza(this, base, 0, 0, w, h), dx, dy);
        f.setInteractive({ useHandCursor: true })
          .on("pointerover", () => f.setTexture(`ui:${base}-hover`))
          .on("pointerout", () => f.setTexture(`ui:${base}`))
          .on("pointerup", accion);
        if (etiqueta) {
          const t = texto(this, 0, 0, etiqueta);
          add(t, Math.round(dx + (w - t.width) / 2), yCentrada(dy, h), LAYER.UI_PANEL + 1);
        }
        return f;
      },
    };
  }

  private closePeerMenu(): void {
    for (const { o } of this.peerMenuItems) o.destroy();
    this.peerMenuItems = [];
    this.peerMenuFor = "";
  }

  /** El menú sigue a su avatar; si el avatar se va, el menú se cierra */
  private movePeerMenu(): void {
    if (this.peerMenuItems.length === 0) return;
    const peer = this.peers.get(this.peerMenuFor);
    if (!peer) {
      this.closePeerMenu();
      return;
    }
    const { w: W, h: H } = this.menuTam;
    // Sobre la cabeza del avatar (esté la sala a un zoom u otro), pero sin
    // salirse del lienzo; esquina en píxeles enteros para que el texto no se
    // emborrone
    const encima = this.sobreCabeza(peer.sprite, HUECO_NOMBRE + ALTO_ETIQUETA + 4); // sobre su nombre
    const x = Phaser.Math.Clamp(encima.x, W / 2 + 4, this.scale.width - W / 2 - 4);
    const y = Phaser.Math.Clamp(encima.y - H / 2, H / 2 + 4, this.scale.height - H / 2 - 4);
    const x0 = Math.round(x - W / 2);
    const y0 = Math.round(y - H / 2);
    for (const { o, dx, dy } of this.peerMenuItems) o.setPosition(x0 + dx, y0 + dy);
  }

  /** Abre el chat con el mensaje ya dirigido a ese jugador */
  private chatTo(nombre: string): void {
    this.closePeerMenu();
    if (net.hablaConFrases) return this.abrirFrases();
    this.openChat();
    const prefijo = `@${nombre} `;
    this.chatText = prefijo;
    this.chatInput?.setValue(prefijo);
    this.renderChatBar();
  }

  /** Destello isométrico en la celda de destino */
  private showClickMarker(x: number, y: number): void {
    const marker = this.add
      .image(x, y, "tileset", 0)
      .setDepth(LAYER.ALFOMBRA + 1) // en el suelo: los muebles y avatares lo tapan
      .setAlpha(0.75)
      .setScale(0.6);
    this.tweens.add({
      targets: marker,
      alpha: 0,
      scale: 0.15,
      duration: 400,
      ease: "Quad.easeOut",
      onComplete: () => marker.destroy(),
    });
  }

  /** Construye la sala (piso + colisiones) desde el JSON de Tiled */
  private buildRoom(): void {
    const data = this.cache.json.get(this.roomId) as TiledMap;
    this.cols = data.width;
    this.rows = data.height;

    const floor = data.layers.find((l) => l.name === "suelo");
    const colsLayer = data.layers.find((l) => l.name === "colisiones");
    this.blocked = Array.from({ length: this.rows }, () =>
      Array<boolean>(this.cols).fill(false),
    );

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        const gid = floor?.data?.[i] ?? 0;
        if (gid !== 0) {
          const pos = toScreen(col, row);
          this.add.image(pos.x, pos.y, "tileset", gid - 1).setDepth(LAYER.SUELO);
        }
        this.blocked[row][col] = (colsLayer?.data?.[i] ?? 0) !== 0;
      }
    }

    // Paredes traseras y luego mobiliario (la capa "objetos" de Tiled)
    this.buildWalls();
    crearSombraMuros(this, this.cols, this.rows);

    const objs = data.layers.find((l) => l.name === "objetos");
    // Primera pasada: dónde hay alfombra, para que cada celda sepa si es borde
    const alfombras = new Set<string>();
    for (const o of objs?.objects ?? []) {
      if ((o.type || o.class) !== "alfombra") continue;
      alfombras.add(`${this.intProp(o.properties, "col")},${this.intProp(o.properties, "row")}`);
    }
    const esAlfombra = (c: number, r: number) => alfombras.has(`${c},${r}`);

    for (const o of objs?.objects ?? []) {
      const kind = o.type || o.class;
      const col = this.intProp(o.properties, "col");
      const row = this.intProp(o.properties, "row");
      if (col === undefined || row === undefined) continue;
      if (!this.inBounds(col, row)) continue;

      if (kind === "puerta") {
        const target = this.strProp(o.properties, "target");
        const targetCol = this.intProp(o.properties, "targetCol");
        const targetRow = this.intProp(o.properties, "targetRow");
        if (!target || targetCol === undefined || targetRow === undefined) continue;
        const door: Door = { col, row, target, targetCol, targetRow };
        this.doors.push(door);
        // La puerta es un modelo 3D más, colgado de su pared
        const lado = ladoPared(col, row);
        if (lado) crearMueble(this, "puerta", lado, col, row, this.theme);
        continue; // el anillo de colisiones ya bloquea la celda
      }

      if (!isFurniture(kind)) continue;
      const def = FURNITURE[kind];
      // Variante: la alfombra según sus vecinas, lo de pared según su pared,
      // lo orientable girado si está pegado a la pared de la columna 0
      let sufijo: string | number | undefined;
      if (def.plano) sufijo = mascaraAlfombra(col, row, esAlfombra);
      else if (def.pared) {
        const lado = ladoPared(col, row);
        if (!lado) continue; // colgado en mitad de la sala: no hay muro
        sufijo = lado;
      } else if (def.orientable && col === 0) sufijo = "se";
      crearMueble(this, kind, sufijo, col, row, this.theme);
      crearLuz(this, kind, col, row, this.theme);
      // Qué estorba y qué se pisa lo decide el catálogo, no un `if` aquí
      if (def.blocks) this.blocked[row][col] = true;
      this.furniture.push({ kind, col, row });
    }
  }

  /**
   * Paredes isométricas sobre los dos bordes traseros (fila 0 y columna 0),
   * una pieza por celda con su propia profundidad.
   *
   * Son SPRITES de `walls.png`, no polígonos: el pixel art (remate, moldura,
   * zócalo, juntas de panel y tramado) se dibuja en el generador, píxel a
   * píxel, y aquí sólo se coloca. Cada sala usa los frames de su tema.
   */
  private buildWalls(): void {
    const h = ALTO_PARED;
    for (let col = 0; col < this.cols; col++) {
      const { x, y } = toScreen(col, 0);
      this.add
        .image(x, y - 16 - h, "walls", this.theme.wallRight)
        .setOrigin(0, 0)
        .setDepth(worldDepth(y));
    }
    for (let row = 0; row < this.rows; row++) {
      const { x, y } = toScreen(0, row);
      this.add
        .image(x - 32, y - 16 - h, "walls", this.theme.wallLeft)
        .setOrigin(0, 0)
        .setDepth(worldDepth(y));
    }
  }

  /** Lee una propiedad entera de un objeto de Tiled */
  private intProp(
    props: { name: string; value: unknown }[] | undefined,
    name: string,
  ): number | undefined {
    const p = props?.find((x) => x.name === name);
    return typeof p?.value === "number" ? p.value : undefined;
  }

  /** Lee una propiedad de texto de un objeto de Tiled */
  private strProp(
    props: { name: string; value: unknown }[] | undefined,
    name: string,
  ): string | undefined {
    const p = props?.find((x) => x.name === name);
    return typeof p?.value === "string" ? p.value : undefined;
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  /** Celda libre más cercana al centro de la sala */
  private firstFreeCell(): Cell {
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const col = (cx + c) % this.cols;
        const row = (cy + r) % this.rows;
        if (!this.blocked[row][col]) return { col, row };
      }
    }
    return { col: cx, row: cy };
  }

  /** Extremos de la losa de diamantes para los límites de cámara */
  private roomBounds(): [number, number, number, number] {
    const corners = [
      toScreen(0, 0),
      toScreen(this.cols - 1, 0),
      toScreen(0, this.rows - 1),
      toScreen(this.cols - 1, this.rows - 1),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs) - 32;
    // Por arriba, también las paredes: si no, la cámara no llega a enseñar
    // su remate cuando la sala es más alta que la ventana.
    const minY = Math.min(...ys) - 16 - ALTO_PARED;
    const maxX = Math.max(...xs) + 32;
    const maxY = Math.max(...ys) + 16;
    // Al menos el tamaño de la vista, centrado en la sala: si los límites
    // quedan por debajo de la ventana, la cámara no puede centrar y la sala
    // se queda clavada en una esquina con negro alrededor.
    const cam = this.cameras.main;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const w = Math.max(maxX - minX, this.scale.width / cam.zoom);
    const h = Math.max(maxY - minY, this.scale.height / cam.zoom);
    return [cx - w / 2, cy - h / 2, w, h];
  }
}
