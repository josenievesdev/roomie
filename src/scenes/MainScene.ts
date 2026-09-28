import Phaser from "phaser";
import { toScreen, toGrid, TILE_W } from "../utils/iso";
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
  texturaMueble,
} from "../entities/furniture";
import { FURNITURE, celdasDe, isFurniture, seatAt, vaGirado, type FurnitureKind } from "../state/furniture-catalog";
import { findPath, type Cell } from "../utils/pathfinding";
import {
  AvatarState,
  FACING_SUR,
  avatarDepth,
  subidaSentado,
  type Facing,
  type SitTarget,
} from "../state/avatarState";
import { DEFAULT_LOOK, decodificarLook, mismoLook, sanitizeLook } from "../state/look";
import { frasePorId, GESTOS, GESTO_SALUDO } from "../state/frases";
import { parsearNacimiento } from "../state/normas";
import { Vestidor } from "../ui/vestidor";
import { MenuFrases } from "../ui/menuFrases";
import { Tienda } from "../ui/tienda";
import { Mochila } from "../ui/mochila";
import { FichaPerfil, type OpcionesPerfil } from "../ui/perfil";
import { medidas } from "../ui/pantalla";
import { motivoNoCabe, planoDesdeMapa, type Plano } from "../state/decorar";
import { Hud } from "../ui/hud";
import {
  anchoTexto,
  avisoFlotante,
  boton,
  centrar,
  crearTexturasUI,
  icono,
  partirTexto,
  pieza,
  texto,
  UI,
  UI_HEX,
  yCentrada,
} from "../ui/kit";
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
  esCasa,
  isRoomId,
  type ArticuloTienda,
  type CategoriaTienda,
  type ChatPayload,
  type MuebleColocado,
  type PerfilPublico,
  type Saldos,
  type SalaDatosPayload,
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
  /** Propiedades de la sala: `exterior`, y las fachadas de cada celda */
  properties?: { name: string; value: unknown }[];
};

type PlacedFurniture = { kind: FurnitureKind; col: number; row: number; girado: boolean };

type Door = {
  col: number;
  row: number;
  target: string;
  targetCol: number;
  targetRow: number;
};

const SAVE_INTERVAL = 5000; // ms entre guardados automáticos

/**
 * Los muebles de las casas que ha mandado el servidor, por sala. Viven fuera
 * de la escena porque ésta se reinicia al cruzar una puerta, y la casa se
 * dibuja DESPUÉS del reinicio. (El mapa va a la caché de JSON de Phaser, que
 * también sobrevive.)
 */
const mueblesDeCasas = new Map<string, MuebleColocado[]>();
/** Al entrar al juego se va a casa una sola vez; si no, cada reconexión te llevaría */
let llegadaHecha = false;
/** Lo que vende la tienda (lo manda el servidor; se guarda para la mochila) */
let articulos: ArticuloTienda[] = [];

/**
 * Colocando un mueble: el fantasma que sigue al ratón (o al dedo) por las
 * celdas, verde donde cabe y rojo donde no. Con el ratón, un clic lo pone;
 * con el dedo, se toca (o se arrastra) y "Poner aquí" lo confirma.
 */
type Colocando = {
  item: string;
  code: string;
  rot: number;
  col: number;
  row: number;
  fantasma: Phaser.GameObjects.Image | null;
  /** Las celdas que ocupará, marcadas en el suelo */
  huella: Phaser.GameObjects.Graphics;
  /** Variante de la textura del fantasma (cambia al pasar de una pared a otra) */
  variante: string;
  /** Cuándo se mandó al servidor (0 = aún no): mientras, no se manda otra vez */
  enviadoEn: number;
};

/** Lo que se dibujó de un mueble de la casa, para rehacerlo, esconderlo o tocarlo */
type DibujoCasa = {
  mueble: MuebleColocado;
  imagen: Phaser.GameObjects.Image | null;
  objetos: Phaser.GameObjects.GameObject[];
};

/** Lo que tarda como mucho el servidor en contestar a "colocar" antes de dejar reintentar */
const ESPERA_COLOCAR_MS = 2500;
/** Colores de la huella en el suelo: cabe, no cabe, elegido */
const HUELLA = { cabe: 0x7bed9f, noCabe: 0xff8a8a, elegido: 0xffe9a8 } as const;

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
 * Al aire libre, en vez de paredes hay fachadas de edificio: IGUAL que
 * `FACHADA_H` en tools/genassets.mjs (dos plantas).
 */
const ALTO_FACHADA = 152;

/**
 * Los modos del modal de cuenta. "nacimiento" es para las cuentas de antes,
 * que aún no dijeron su fecha de nacimiento: sin ella no se entra.
 */
type AuthModalMode = "login" | "register" | "nacimiento";
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
 * Dónde va exactamente depende de la pantalla (`calcularChat`).
 */
type ColocacionChat = {
  x: number;
  /** Pie de la línea más nueva: las demás se apilan hacia ARRIBA desde aquí */
  bottom: number;
  w: number;
  /** Cuántas líneas caben a la vez */
  lines: number;
  /**
   * Lo mismo con el chat abierto. Con el dedo, escribiendo, el historial va
   * bajo la barra, arriba: abajo lo taparía el teclado del móvil.
   */
  bottomAbierto: number;
  linesAbierto: number;
  /** Alto de línea: la fuente pixel a 12 px (15 de caja) más 1 de aire */
  lineH: number;
  /** La barra de escribir */
  barraY: number;
  barraH: number;
};
/** Líneas que se crean (luego se usan las que quepan) */
const CHAT_LINEAS_MAX = 8;

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
  /** El aspecto tal cual llega en la instantánea (código compacto): si no cambia, no se toca nada */
  lookCodigo: string;
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
  /** Alto de lo que cierra la sala por detrás: pared dentro, fachada fuera */
  private altoMuro = ALTO_PARED;
  /** Ya se pidió la casa al servidor (esperando su mapa) */
  private pidiendoCasa = false;
  /** La celda de puerta en la que se está (para reaccionar al llegar, no cada frame) */
  private puertaPisada = "";
  /** Panel de la portería abierto */
  private porteria: Phaser.GameObjects.GameObject[] = [];

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
  /** El velo del modal (lo único que no sube con `asomarCampo`) */
  private authVelo: Phaser.GameObjects.GameObject | null = null;
  /** Cuánto ha subido el modal para que el teclado del móvil no tape el campo */
  private authDesplazado = 0;
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
  /** Dónde va el chat en esta pantalla */
  private chat: ColocacionChat = {
    x: 8,
    bottom: 497,
    w: 360,
    lines: 8,
    bottomAbierto: 497,
    linesAbierto: 8,
    lineH: 16,
    barraY: 508,
    barraH: 24,
  };

  // Perfiles
  /** La ficha de un perfil abierta (la tuya o la de otro), y con qué se abrió (para rehacerla al girar el móvil) */
  private ficha: FichaPerfil | null = null;
  private opcionesFicha: OpcionesPerfil | null = null;
  /** El perfil que se pidió al servidor y aún no ha llegado */
  private perfilPedido: string | null = null;

  // Tienda, mochila y decorar
  private tienda: Tienda | null = null;
  private mochila: Mochila | null = null;
  /**
   * Decorando tu casa: tocar un mueble lo elige (en vez de andar o sentarse)
   * y sale su menú. Se entra con el botón de la casa estando en ella, o al
   * poner algo de la mochila.
   */
  private decorando = false;
  private colocando: Colocando | null = null;
  /** Arrastrando el fantasma con el dedo (en vez de mover la cámara) */
  private arrastrandoFantasma = false;
  /**
   * Dónde se agarró el fantasma, respecto al centro de su celda (en px del
   * mundo): al arrastrarlo va "cogido" por ahí, sin saltar a poner la base
   * bajo el dedo.
   */
  private agarre = { dx: 0, dy: 0 };
  /** La barra de abajo mientras se decora: qué hacer y los botones */
  private barraDeco: Phaser.GameObjects.GameObject[] = [];
  /** Lo que ocupa esa barra (0 si no está): los menús se ponen encima */
  private altoBarraDeco = 0;
  /** Menú de un mueble de tu casa (Mover, Girar, Guardar) */
  private menuMueble: Phaser.GameObjects.GameObject[] = [];
  /** El mueble elegido (el del menú) o el que hay bajo el ratón, marcado en el suelo */
  private elegido: { id: string; huella: Phaser.GameObjects.Graphics } | null = null;
  /** Lo que se dibujó de cada mueble de la casa, por id (para rehacerlo al decorar) */
  private objetosCasa = new Map<string, DibujoCasa>();
  /** Las colisiones y los muebles de la sala SIN los de la casa (lo que trae el mapa) */
  private bloqueoBase: boolean[][] = [];
  private mueblesBase: PlacedFurniture[] = [];
  /** Tamaño y puertas de la casa, para saber dónde cabe cada cosa (null fuera de una casa) */
  private plano: Plano | null = null;
  /** Pellizco con dos dedos: la distancia de partida */
  private pellizco: { base: number } | null = null;
  /** Se pidió la tienda y se abrirá al llegar el catálogo */
  private quiereTienda = false;

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
    // Las salas fijas tienen su fichero; el mapa de una casa ya lo trajo el
    // servidor y está en la caché
    if (!this.cache.json.exists(this.roomId)) this.load.json(this.roomId, `assets/${this.roomId}.json`);
    this.load.spritesheet("tileset", "assets/tileset.png", {
      frameWidth: 64,
      frameHeight: 32,
    });
    // Caras de pared: 32 de ancho por ALTO_PARED MÁS 16 de sesgo isométrico
    this.load.spritesheet("walls", "assets/walls.png", {
      frameWidth: 32,
      frameHeight: ALTO_PARED + 16,
    });
    this.load.spritesheet("fachadas", "assets/fachadas.png", {
      frameWidth: 32,
      frameHeight: ALTO_FACHADA + 16,
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
    this.pidiendoCasa = false;
    this.porteria = [];
    this.ficha = null;
    this.opcionesFicha = null;
    this.perfilPedido = null;
    this.tienda = null;
    this.mochila = null;
    this.decorando = false;
    this.colocando = null;
    this.arrastrandoFantasma = false;
    this.barraDeco = [];
    this.menuMueble = [];
    this.elegido = null;
    this.objetosCasa = new Map();
    this.plano = null;
    this.pellizco = null;
    this.quiereTienda = false;
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
    this.textures.get("fachadas").setFilter(Phaser.Textures.FilterMode.NEAREST);
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
    // En tu casa, el botón de la casa es el de decorarla
    this.hud = new Hud(
      this,
      {
        chat: () => this.alternarChat(),
        vestidor: () => this.abrirVestidor(),
        perfil: () => (net.autenticado ? this.abrirPerfil() : this.showAuthModal("login")),
        casa: () => (this.enMiCasa() ? this.alternarDecorar() : this.irACasa()),
        tienda: () => this.abrirTienda(),
        mochila: () => this.abrirMochila(),
        zoom: (paso) => this.cambiarZoom(paso),
      },
      {
        enCasa: esCasa(this.roomId),
        // Mientras se ve la chuleta, el chat va encima; al irse, baja
        alIrseChuleta: () => {
          if (!this.alive) return;
          this.calcularChat();
          this.colocarChat();
        },
      },
    );
    this.hud.nivelZoom(this.nivelZoom, 0, ZOOMS.length - 1);

    // Al girar el móvil o cambiar la ventana, se recoloca todo (ver main.ts)
    const alCambiarTamano = () => this.alRedimensionar();
    this.scale.on(Phaser.Scale.Events.RESIZE, alCambiarTamano);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, alCambiarTamano));

    // Panel de chat: fondo (sólo visible mientras se escribe) + líneas
    this.calcularChat();
    this.chatPanelBg = pieza(this, "chip", 0, 0, 40, 40).setScrollFactor(0).setDepth(LAYER.UI_PANEL).setVisible(false);

    // Una línea = un objeto de texto reutilizado, para no recrearlos sin parar
    this.chatLineTexts = [];
    for (let i = 0; i < CHAT_LINEAS_MAX; i++) {
      this.chatLineTexts.push(
        texto(this, 0, 0, "", { color: CHAT_COLORS.other, sombra: true })
          .setOrigin(0, 1)
          .setScrollFactor(0)
          .setDepth(LAYER.UI_PANEL + 1)
          .setVisible(false),
      );
    }
    // El desvanecido depende del reloj, no de que ocurra nada
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.renderChatPanel() });

    // Barra de escritura, alineada con el panel: un campo hundido
    this.chatBg = pieza(this, "campo-activo", 0, 0, 40, 24).setScrollFactor(0).setDepth(LAYER.UI_PANEL).setVisible(false);
    this.chatLabel = texto(this, 0, 0, "").setScrollFactor(0).setDepth(LAYER.UI_PANEL + 1).setVisible(false);
    this.colocarChat();

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
      else {
        this.sendWhere();
        this.hud.arrancarChuleta();
      }
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
        if (key === "Escape" && this.porteria.length > 0) {
          this.cerrarPorteria();
          return;
        }
        if (this.ficha) {
          if (key === "Escape") this.cerrarFicha();
          return;
        }
        // Decorando, Esc deshace de uno en uno: el panel, lo que colocabas,
        // el menú del mueble y, por último, el propio modo
        if (key === "Escape" && (this.tienda || this.mochila)) {
          this.cerrarTienda();
          this.cerrarMochila();
          return;
        }
        if (key === "Escape" && this.colocando) {
          this.cancelarColocar();
          return;
        }
        if (key === "Escape" && this.menuMueble.length > 0) {
          this.cerrarMenuMueble();
          return;
        }
        if (key === "Escape" && this.decorando) {
          this.salirDecorar();
          return;
        }
        // Con la tienda o la mochila abiertas, sólo sus teclas
        if (this.tienda || this.mochila) {
          if (key === "t" || key === "T") this.abrirTienda();
          else if (key === "m" || key === "M") this.abrirMochila();
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
          else if (key === "t" || key === "T") this.abrirTienda();
          else if (key === "m" || key === "M") this.abrirMochila();
          else if ((key === "r" || key === "R") && this.colocando) this.girarFantasma();
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
        this.arrastrandoFantasma = false;
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

        // El segundo dedo: es un pellizco (zoom), no un paso ni un arrastre
        const dedos = this.distanciaDedos();
        if (dedos !== null) {
          this.pellizco = { base: dedos };
          this.arrastre = null;
          this.arrastrandoFantasma = false;
          return;
        }

        // Colocando, el dedo que cae sobre el fantasma lo arrastra (no mueve la cámara)
        const c = this.colocando;
        if (c?.fantasma && this.pixelBajo(c.fantasma, pointer)) {
          const w = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const base = toScreen(c.col, c.row);
          this.agarre = { dx: w.x - base.x, dy: w.y - base.y };
          this.arrastrandoFantasma = true;
          return;
        }

        const cam = this.cameras.main;
        this.arrastre = { x: pointer.x, y: pointer.y, scrollX: cam.scrollX, scrollY: cam.scrollY, activo: false };
      },
    );
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer, sobre: Phaser.GameObjects.GameObject[]) => {
      // Pellizcar: al separar los dedos un tercio más, se acerca un nivel
      if (this.pellizco) {
        const d = this.distanciaDedos();
        if (d === null) return;
        const r = d / this.pellizco.base;
        if (r > 1.35 || r < 0.74) {
          const a = this.input.pointer1;
          const b = this.input.pointer2;
          this.cambiarZoom(r > 1 ? 1 : -1, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          this.pellizco.base = d;
        }
        return;
      }
      if (this.arrastrandoFantasma) {
        this.moverFantasma(this.celdaBajo(pointer, this.agarre));
        return;
      }
      // Con el ratón: colocando, el fantasma lo sigue (si no está sobre un
      // botón); decorando, se marca el mueble que hay debajo
      if (!pointer.wasTouch && !pointer.isDown) {
        if (this.colocando && sobre.length === 0) this.moverFantasma(this.celdaBajo(pointer));
        else if (this.decorando && !this.colocando && this.menuMueble.length === 0) {
          this.elegir(sobre.length === 0 ? (this.muebleBajo(pointer)?.id ?? null) : null);
        }
        return;
      }
      const a = this.arrastre;
      if (!a || !pointer.isDown) return;
      if (!a.activo && Math.hypot(pointer.x - a.x, pointer.y - a.y) < UMBRAL_ARRASTRE) return;
      a.activo = true;
      this.soltarCamara();
      const cam = this.cameras.main;
      cam.setScroll(a.scrollX - (pointer.x - a.x) / cam.zoom, a.scrollY - (pointer.y - a.y) / cam.zoom);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer, sobre: Phaser.GameObjects.GameObject[]) => {
      // Al levantar un dedo del pellizco, se acabó el pellizco (y el otro dedo no anda)
      if (this.pellizco) {
        if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) this.pellizco = null;
        this.arrastre = null;
        return;
      }
      // Se soltó el fantasma: con el ratón, eso es ponerlo; con el dedo, se
      // queda ahí hasta "Poner aquí"
      if (this.arrastrandoFantasma) {
        this.arrastrandoFantasma = false;
        if (!pointer.wasTouch) this.confirmarColocar();
        return;
      }
      const a = this.arrastre;
      this.arrastre = null;
      if (!a || a.activo || this.authModalOpen || this.vestidor) return;
      if (sobre.length > 0) return; // se soltó encima de un botón: es suyo
      // Colocando: con el ratón, el clic lo pone; con el dedo, lo lleva ahí
      // (y "Poner aquí" lo confirma: con el dedo no hay "pasar por encima")
      if (this.colocando) {
        this.moverFantasma(this.celdaBajo(pointer));
        if (!pointer.wasTouch) this.confirmarColocar();
        return;
      }
      // Decorando: tocar un mueble lo elige; tocar el suelo, lo suelta
      if (this.decorando) {
        const m = this.muebleBajo(pointer);
        if (m) this.abrirMenuMueble(m);
        else this.cerrarMenuMueble();
        return;
      }
      // Un clic en el mundo con un menú abierto (de avatar, de frases) sólo lo cierra
      if (this.peerMenuItems.length > 0) {
        this.closePeerMenu();
        return;
      }
      if (this.menuFrases) {
        this.cerrarFrases();
        return;
      }
      if (this.porteria.length > 0) {
        this.cerrarPorteria();
        return;
      }
      this.handleWorldClick(pointer);
    });

    // Soltar fuera del lienzo (el ratón se fue de la ventana): nada de lo que
    // estaba a medias sigue en marcha
    this.input.on("pointerupoutside", () => {
      this.arrastre = null;
      this.arrastrandoFantasma = false;
      this.pellizco = null;
    });

    // Rueda: zoom hacia donde apunta el ratón
    this.input.on(
      "wheel",
      (pointer: Phaser.Input.Pointer, _sobre: unknown, _dx: number, dy: number) => {
        if (this.authModalOpen || this.vestidor || this.tienda || this.mochila || this.ficha) return;
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
      // La textura del retrato es del gestor global: se va con la ficha
      this.ficha?.destroy();
      this.ficha = null;
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
    if (!this.chatOpen && !this.vestidor && !this.tienda && !this.mochila && !this.ficha) {
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
    const enPuerta = this.avatar.path.length === 0 ? this.doorAt(Math.round(this.avatar.col), Math.round(this.avatar.row)) : undefined;
    const clave = enPuerta ? `${enPuerta.col},${enPuerta.row}` : "";
    if (enPuerta?.target === "casa") {
      // La portería: sólo al LLEGAR a la puerta, no en cada frame que se está en ella
      if (clave !== this.puertaPisada) this.alLlegarAPorteria();
    } else if (enPuerta) this.transitionTo(enPuerta);
    this.puertaPisada = clave;

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

  /** Distancia entre los dos primeros dedos, si hay dos en la pantalla (null si no) */
  private distanciaDedos(): number | null {
    const a = this.input.pointer1;
    const b = this.input.pointer2;
    if (!a?.isDown || !b?.isDown) return null;
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  /**
   * La pantalla cambió de tamaño (se giró el móvil, se cambió la ventana):
   * cámaras, HUD y chat se recolocan; lo pasajero (los menús) se cierra, y
   * los paneles abiertos se rehacen a la medida nueva sin perder lo que
   * tenían (la sección de la tienda, lo escrito en el modal, el borrador del
   * vestidor).
   */
  private alRedimensionar(): void {
    if (!this.alive) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const cam = this.cameras.main;
    cam.setSize(W, H);
    this.camaraUI.setSize(W, H);
    const [bx, by, bw, bh] = this.roomBounds();
    cam.setBounds(bx, by, bw, bh);
    this.hud?.recolocar();
    this.calcularChat();
    this.colocarChat();
    if (this.chatOpen) this.ponerBotonFrases();
    this.closePeerMenu();
    this.cerrarFrases();
    this.cerrarMenuMueble();
    this.pintarBarraDeco();
    if (this.porteria.length > 0) {
      this.cerrarPorteria();
      this.abrirPorteria();
    }
    if (this.tienda) {
      const seccion = this.tienda.seccionActual;
      this.cerrarTienda();
      this.mostrarTienda(seccion);
    }
    if (this.mochila) {
      this.cerrarMochila();
      this.abrirMochila();
    }
    this.vestidor?.recolocar();
    if (this.ficha && this.opcionesFicha) this.mostrarFicha(this.opcionesFicha);
    if (this.authModalOpen) this.rehacerAuthModal();
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

  /** Punto del mundo → punto de la pantalla (del lienzo, mida lo que mida), con el zoom */
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
    this.caminarA({ col: Math.round(g.col), row: Math.round(g.row) });
  }

  /** Echa a andar hacia una celda (y, si es un asiento, a sentarse; si es una puerta, a cruzarla) */
  private caminarA(goal: Cell): void {
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
    const centro = toScreen(goal.col, goal.row);
    this.showClickMarker(centro.x, centro.y);
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
      const seat = seatAt(f.kind, col, row, f.girado);
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
    // Una casa, sólo si el servidor ya mandó su mapa (al recargar la página no
    // lo hay: se empieza en la plaza y, al entrar, se va a casa)
    if (save && esCasa(save.room) && this.cache.json.exists(save.room)) return save.room;
    // Quien llega por primera vez, llega a la ciudad: la Plaza de la Llave
    return ROOMS[0];
  }

  /** Guarda la partida y reinicia la escena en la sala destino */
  private transitionTo(d: Door): void {
    if (this.transitioning) return;
    if (!isRoomId(d.target)) return;
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

  // ---------- Tu casa ----------

  /** Al llegar a la puerta de la portería: a casa si ya tienes, o a por las llaves */
  private alLlegarAPorteria(): void {
    if (net.identidad?.casa) this.irACasa();
    else this.abrirPorteria();
  }

  /** Pide la casa al servidor; cuando llega su mapa (`onSalaDatos`), se entra */
  private irACasa(): void {
    if (!net.identidad?.casa) {
      this.pushChatLine("Aún no tienes casa: pasa por la portería del Edificio Roomie, en la plaza.", CHAT_COLORS.system);
      return;
    }
    if (this.pidiendoCasa || this.transitioning || this.roomId === net.identidad.casa.id) return;
    this.pidiendoCasa = true;
    net.irACasa();
  }

  /** El servidor mandó el mapa y los muebles de tu casa: a la caché, y dentro */
  private onSalaDatos(p: SalaDatosPayload): void {
    this.pidiendoCasa = false;
    if (this.cache.json.exists(p.id)) this.cache.json.remove(p.id);
    this.cache.json.add(p.id, p.mapa);
    mueblesDeCasas.set(p.id, p.muebles);
    // Se aparece delante de la puerta del piso
    const objetos = (p.mapa as TiledMap).layers.find((l) => l.name === "objetos")?.objects ?? [];
    const puerta = objetos.find((o) => (o.type || o.class) === "puerta");
    const col = this.intProp(puerta?.properties, "col") ?? 1;
    const row = this.intProp(puerta?.properties, "row") ?? 1;
    const dentro = row === 0 ? { col, row: 1 } : { col: 1, row };
    this.transitionTo({ col, row, target: p.id, targetCol: dentro.col, targetRow: dentro.row });
  }

  /** La portería del Edificio Roomie: Rita, la portera, da las llaves del piso */
  private abrirPorteria(): void {
    if (this.porteria.length > 0 || this.authModalOpen || this.vestidor) return;
    this.closeChat();
    this.cerrarFrases();
    this.closePeerMenu();
    this.cerrarTienda();
    this.cerrarMochila();
    const alto = medidas().fila + 4;
    const W = Math.min(320, this.scale.width - 16);
    const lineas = partirTexto(
      "¡Hola! Soy Rita, la portera. ¿Te acabas de mudar a La Manzana? Tu piso ya está listo: es pequeño, pero es tuyo. Aquí tienes las llaves.",
      W - 28,
    );
    const H = 34 + lineas.length * 16 + 12 + alto + 14;
    const X = Math.round((this.scale.width - W) / 2);
    const Y = Math.round((this.scale.height - H) / 2);
    const add = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(o: T, capa = 1): T => {
      o.setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
      this.porteria.push(o);
      return o;
    };
    add(pieza(this, "panel", X, Y, W, H).setInteractive(), 0);
    add(icono(this, "casa", X + 14, Y + 11));
    add(texto(this, X + 32, yCentrada(Y + 8, 16), "Portería · Edificio Roomie", { color: UI.titulo }));
    add(texto(this, X + 14, Y + 32, lineas.join("\n"), { interlineado: 1 }));
    const yb = Y + H - 14 - alto;
    this.porteria.push(
      ...boton(this, X + 14, yb, W - 28 - 108, alto, "Recoger las llaves", () => this.recogerLlaves(), {
        primario: true,
        capa: LAYER.UI_PANEL + 2,
      }).objetos,
      ...boton(this, X + W - 14 - 100, yb, 100, alto, "Ahora no", () => this.cerrarPorteria(), { capa: LAYER.UI_PANEL + 2 }).objetos,
    );
  }

  private cerrarPorteria(): void {
    for (const o of this.porteria) o.destroy();
    this.porteria = [];
  }

  private recogerLlaves(): void {
    if (!net.isOnline) return;
    net.llaves();
  }

  /** Ya tienes casa: si estabas en la portería, se entra directamente */
  private onCasa(): void {
    const enPorteria = this.porteria.length > 0;
    this.cerrarPorteria();
    this.pushChatLine("¡Ya tienes casa! Rita te da las llaves de tu piso.", CHAT_COLORS.mine);
    if (enPorteria) this.irACasa();
  }

  // ---------- Tienda y mochila ----------
  //
  // Lo que se vende, lo que cuesta y si te llega lo decide el servidor: aquí
  // sólo se enseña (y se atenúa lo que no te llega).

  /** ¿Estás en tu casa? Sólo ahí se decora */
  private enMiCasa(): boolean {
    const casa = net.identidad?.casa;
    return !!casa && this.roomId === casa.id;
  }

  /** Tus saldos, tal como los dijo el servidor la última vez */
  private saldos(): Saldos {
    return { monedas: net.identidad?.saldo ?? 0, creditos: net.identidad?.creditos ?? 0 };
  }

  /** El nombre de un mueble como lo llama la tienda (o el catálogo, si no se vende) */
  private nombreMueble(code: string): string {
    return articulos.find((a) => a.code === code)?.nombre ?? (isFurniture(code) ? FURNITURE[code].nombre : code);
  }

  /** Cierra lo pasajero que estorba a un panel: el chat, los menús, la portería, una ficha de perfil */
  private despejar(): void {
    this.closeChat();
    this.cerrarFrases();
    this.closePeerMenu();
    this.cerrarPorteria();
    this.cerrarMenuMueble();
    this.cerrarFicha();
  }

  // ---------- Perfiles ----------

  /** Tu perfil: tu retrato, desde cuándo juegas, tu casa, tu dinero, y cambiar de aspecto o cerrar sesión */
  private abrirPerfil(): void {
    const yo = net.identidad;
    if (!yo || this.authModalOpen || this.vestidor) return;
    this.despejar();
    this.cerrarTienda();
    this.cerrarMochila();
    this.mostrarFicha({
      datos: {
        nombre: yo.nickname,
        look: this.look,
        desde: yo.desde,
        propio: { usuario: yo.username, monedas: yo.saldo, creditos: yo.creditos, tieneCasa: yo.casa !== null },
      },
      alCerrar: () => this.cerrarFicha(),
      alVestidor: () => {
        this.cerrarFicha();
        this.abrirVestidor();
      },
      alCerrarSesion: () => {
        this.cerrarFicha();
        this.cerrarSesion();
      },
    });
  }

  /** El perfil de otro jugador de la sala: se pide al servidor (que mira las normas) y se abre al llegar */
  private verPerfil(id: string): void {
    this.closePeerMenu();
    this.perfilPedido = id;
    net.perfil(id);
  }

  private onPerfil(p: PerfilPublico): void {
    if (p.id !== this.perfilPedido) return;
    this.perfilPedido = null;
    if (this.authModalOpen || this.vestidor) return;
    this.despejar();
    this.mostrarFicha({ datos: { nombre: p.nombre, look: sanitizeLook(p.look), desde: p.desde }, alCerrar: () => this.cerrarFicha() });
  }

  private mostrarFicha(o: OpcionesPerfil): void {
    this.ficha?.destroy();
    this.opcionesFicha = o;
    this.ficha = new FichaPerfil(this, o);
  }

  private cerrarFicha(): void {
    this.ficha?.destroy();
    this.ficha = null;
    this.opcionesFicha = null;
  }

  /** La tienda (T). Si el catálogo aún no ha llegado, se pide y se abre al llegar */
  private abrirTienda(): void {
    if (this.tienda) return this.cerrarTienda();
    if (this.authModalOpen || this.vestidor || !net.autenticado) return;
    this.despejar();
    this.cerrarMochila();
    this.cancelarColocar();
    this.quiereTienda = true;
    if (articulos.length > 0) this.mostrarTienda();
    else net.tienda();
  }

  private mostrarTienda(seccion?: CategoriaTienda): void {
    this.quiereTienda = false;
    if (this.tienda || this.authModalOpen || this.vestidor) return;
    this.tienda = new Tienda(this, {
      articulos,
      saldos: this.saldos(),
      seccion,
      alComprar: (code) => net.comprar(code),
      alCerrar: () => this.cerrarTienda(),
    });
  }

  private cerrarTienda(): void {
    this.quiereTienda = false;
    this.tienda?.destroy();
    this.tienda = null;
  }

  /** La mochila (M): lo tuyo que no está puesto. En tu casa, se pone desde aquí */
  private abrirMochila(): void {
    if (this.mochila) return this.cerrarMochila();
    if (this.authModalOpen || this.vestidor || !net.autenticado) return;
    this.despejar();
    this.cerrarTienda();
    this.cancelarColocar();
    this.mochila = new Mochila(this, {
      cosas: net.cosas,
      enCasa: this.enMiCasa(),
      articulos,
      alPoner: (cosa) => this.empezarColocar(cosa.id, cosa.code, 0, null),
      alVender: (cosa) => net.vender(cosa.id),
      alTienda: () => {
        this.cerrarMochila();
        this.abrirTienda();
      },
      alCerrar: () => this.cerrarMochila(),
    });
    // Por si cambió desde otra pestaña
    net.mochila();
  }

  private cerrarMochila(): void {
    this.mochila?.destroy();
    this.mochila = null;
  }

  // ---------- Decorar tu casa ----------
  //
  // Decorando, tocar un mueble lo elige y saca su menú (Mover, Girar,
  // Guardar); fuera de ese modo, tocar un sofá sigue siendo sentarse. Dónde
  // cabe cada cosa lo dicen las reglas de `src/state/decorar.ts`, las mismas
  // que aplica el servidor: si el fantasma sale verde, el servidor lo acepta
  // (salvo que alguien se cruce justo entonces).

  private alternarDecorar(): void {
    if (this.decorando) this.salirDecorar();
    else this.entrarDecorar();
  }

  private entrarDecorar(): void {
    if (!this.enMiCasa() || this.authModalOpen || this.vestidor) return;
    this.despejar();
    this.cerrarTienda();
    this.cerrarMochila();
    this.decorando = true;
    this.pintarBarraDeco();
  }

  private salirDecorar(): void {
    this.cancelarColocar();
    this.cerrarMenuMueble();
    this.elegir(null);
    this.decorando = false;
    this.pintarBarraDeco();
  }

  /**
   * Empieza a colocar algo: de la mochila (`desde` null) o algo ya puesto,
   * para moverlo (`desde` es donde está; el original se esconde mientras).
   * Sacado de la mochila, aparece en el sitio libre más cercano a ti.
   */
  private empezarColocar(item: string, code: string, rot: number, desde: Cell | null): void {
    if (!this.enMiCasa() || !isFurniture(code)) return;
    this.cancelarColocar();
    this.cerrarMochila();
    this.cerrarTienda();
    this.despejar();
    this.decorando = true;
    const inicio = desde ??
      this.sitioPara(code, item) ?? { col: Math.round(this.avatar.col), row: Math.round(this.avatar.row) };
    this.colocando = {
      item,
      code,
      rot,
      col: inicio.col,
      row: inicio.row,
      fantasma: null,
      huella: this.add.graphics().setDepth(LAYER.ALFOMBRA + 1),
      variante: "",
      enviadoEn: 0,
    };
    this.verOriginal(item, false);
    this.pintarFantasma();
    this.pintarBarraDeco();
  }

  /** Deja de colocar. Con `restaurar`, lo que se estaba moviendo vuelve a verse donde estaba */
  private cancelarColocar(restaurar = true): void {
    const c = this.colocando;
    if (!c) return;
    c.fantasma?.destroy();
    c.huella.destroy();
    this.colocando = null;
    this.arrastrandoFantasma = false;
    if (restaurar) this.verOriginal(c.item, true);
    this.pintarBarraDeco();
  }

  /** Lleva el fantasma a otra celda (sin salirse de la sala) */
  private moverFantasma(celda: Cell): void {
    const c = this.colocando;
    if (!c) return;
    const col = Phaser.Math.Clamp(celda.col, 0, this.cols - 1);
    const row = Phaser.Math.Clamp(celda.row, 0, this.rows - 1);
    if (col === c.col && row === c.row) return;
    c.col = col;
    c.row = row;
    this.pintarFantasma();
  }

  /** Gira lo que se coloca (sólo lo que tiene dos caras: la estantería, el armario) */
  private girarFantasma(): void {
    const c = this.colocando;
    if (!c || !FURNITURE[c.code]?.orientable) return;
    c.rot = c.rot === 1 ? 0 : 1;
    this.pintarFantasma();
  }

  /**
   * Dibuja el fantasma donde está: el mueble en su celda (con su cara de
   * pared o su giro) y, en el suelo, las celdas que ocupará: verdes si cabe,
   * rojas si no.
   */
  private pintarFantasma(): void {
    const c = this.colocando;
    if (!c) return;
    const def = FURNITURE[c.code];
    let sufijo: string | number | undefined;
    // Una alfombra suelta lleva la cenefa por los cuatro lados
    if (def.plano) sufijo = 15;
    else if (def.pared) sufijo = ladoPared(c.col, c.row) ?? (c.col >= c.row ? "der" : "izq");
    else if (vaGirado(c.code, c.col, c.rot === 1)) sufijo = "se";
    const variante = String(sufijo ?? "");
    if (!c.fantasma || c.variante !== variante) {
      c.fantasma?.destroy();
      const t = texturaMueble(this, c.code, sufijo, this.theme);
      c.fantasma = t ? this.add.image(0, 0, t.key).setOrigin(t.ax / t.w, t.ay / t.h).setAlpha(0.85) : null;
      c.variante = variante;
    }
    const cabe = this.motivoEn(c.code, c.col, c.row, c.item) === null;
    const pos = toScreen(c.col, c.row);
    const celdas = celdasDe(c.code, c.col, c.row);
    const frente = toScreen(celdas[celdas.length - 1].col, celdas[celdas.length - 1].row);
    // Donde iría el de verdad (ver `crearMueble`), un pelo por delante
    const z = def.plano ? LAYER.ALFOMBRA + 0.5 : def.pared ? worldDepth(pos.y) + 0.2 : worldDepth(frente.y) + 0.2;
    c.fantasma?.setPosition(pos.x, pos.y).setDepth(z).setTint(cabe ? 0xd8ffe2 : 0xff9a9a);
    this.pintarHuella(c.huella, c.code, c.col, c.row, cabe ? HUELLA.cabe : HUELLA.noCabe);
  }

  /** Rombos en el suelo sobre las celdas que ocupa (u ocuparía) un mueble */
  private pintarHuella(g: Phaser.GameObjects.Graphics, code: string, col: number, row: number, color: number): void {
    g.clear();
    for (const c of celdasDe(code, col, row)) {
      const p = toScreen(c.col, c.row);
      const rombo = [
        { x: p.x, y: p.y - 15 },
        { x: p.x + 30, y: p.y },
        { x: p.x, y: p.y + 15 },
        { x: p.x - 30, y: p.y },
      ];
      g.fillStyle(color, 0.22);
      g.fillPoints(rombo, true);
      g.lineStyle(1, color, 0.85);
      g.strokePoints(rombo, true);
    }
  }

  /** Pone lo que se coloca donde está el fantasma, si cabe (si no, dice por qué) */
  private confirmarColocar(): void {
    const c = this.colocando;
    if (!c) return;
    // Ya se mandó: se espera la respuesta (o, si no llega, un rato)
    if (c.enviadoEn && this.time.now - c.enviadoEn < ESPERA_COLOCAR_MS) return;
    const motivo = this.motivoEn(c.code, c.col, c.row, c.item);
    if (motivo) {
      avisoFlotante(this, motivo, false);
      return;
    }
    c.enviadoEn = this.time.now;
    net.colocar({ item: c.item, col: c.col, row: c.row, rot: c.rot });
  }

  /**
   * Por qué no cabe `code` ahí, o null si cabe. Las reglas del servidor, con
   * los muebles de ahora y la gente que hay de pie (a nadie se le pone un
   * armario encima).
   */
  private motivoEn(code: string, col: number, row: number, excepto: string): string | null {
    if (!this.plano) return "Sólo puedes decorar tu casa.";
    const pisadas: Cell[] = [{ col: Math.round(this.avatar.col), row: Math.round(this.avatar.row) }];
    for (const v of this.netPlayers) {
      if (v.id === net.id || v.room !== this.roomId) continue;
      pisadas.push({ col: Math.round(v.col), row: Math.round(v.row) });
    }
    return motivoNoCabe(this.plano, mueblesDeCasas.get(this.roomId) ?? [], code, col, row, { excepto, pisadas });
  }

  /** La celda más cercana a ti donde cabe `code` (null si no cabe en ninguna) */
  private sitioPara(code: string, excepto: string): Cell | null {
    const yo = { col: Math.round(this.avatar.col), row: Math.round(this.avatar.row) };
    let mejor: Cell | null = null;
    let distancia = Infinity;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const d = Math.abs(col - yo.col) + Math.abs(row - yo.row);
        if (d >= distancia || this.motivoEn(code, col, row, excepto) !== null) continue;
        mejor = { col, row };
        distancia = d;
      }
    }
    return mejor;
  }

  /**
   * La celda que señala el puntero para lo que se coloca. Lo de pared sólo
   * mira la X: la pared de la fila 0 va de la esquina hacia la derecha y la
   * de la columna 0 hacia la izquierda, así que basta con saber cuánto a un
   * lado u otro de la esquina está el puntero (esté a la altura que esté).
   */
  private celdaBajo(pointer: Phaser.Input.Pointer, agarre = { dx: 0, dy: 0 }): Cell {
    const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const w = { x: p.x - agarre.dx, y: p.y - agarre.dy };
    const code = this.colocando?.code;
    if (code && isFurniture(code) && FURNITURE[code].pared) {
      const x = w.x / (TILE_W / 2);
      return x >= 0 ? { col: Math.round(x), row: 0 } : { col: 0, row: Math.round(-x) };
    }
    const g = toGrid(w.x, w.y);
    return { col: Math.round(g.col), row: Math.round(g.row) };
  }

  /** ¿El puntero está sobre un píxel pintado de esa imagen del mundo? (lo transparente no cuenta) */
  private pixelBajo(img: Phaser.GameObjects.Image, pointer: Phaser.Input.Pointer): boolean {
    if (!img.visible) return false;
    const w = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(w.x - (img.x - img.displayOriginX));
    const y = Math.floor(w.y - (img.y - img.displayOriginY));
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
    return (this.textures.getPixelAlpha(x, y, img.texture.key) ?? 0) > 0;
  }

  /** El mueble de tu casa que hay bajo el puntero (el de delante, si se tapan) */
  private muebleBajo(pointer: Phaser.Input.Pointer): MuebleColocado | null {
    let mejor: DibujoCasa | null = null;
    for (const d of this.objetosCasa.values()) {
      if (!d.imagen || !this.pixelBajo(d.imagen, pointer)) continue;
      if (!mejor?.imagen || d.imagen.depth > mejor.imagen.depth) mejor = d;
    }
    return mejor?.mueble ?? null;
  }

  /** Enseña o esconde lo dibujado de un mueble de la casa (mientras se mueve, no está en dos sitios) */
  private verOriginal(id: string, visible: boolean): void {
    for (const o of this.objetosCasa.get(id)?.objetos ?? []) {
      (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(visible);
    }
  }

  /** Marca en el suelo un mueble de la casa (el del menú, o el que hay bajo el ratón); null, ninguno */
  private elegir(id: string | null): void {
    if ((this.elegido?.id ?? null) === id) return;
    this.elegido?.huella.destroy();
    this.elegido = null;
    const d = id ? this.objetosCasa.get(id) : undefined;
    if (!d) return;
    const g = this.add.graphics().setDepth(LAYER.ALFOMBRA + 1);
    this.pintarHuella(g, d.mueble.code, d.mueble.col, d.mueble.row, HUELLA.elegido);
    this.elegido = { id: d.mueble.id, huella: g };
  }

  /** Tocaste algo tuyo decorando: qué hacer con ello */
  private abrirMenuMueble(m: MuebleColocado): void {
    this.cerrarMenuMueble();
    const def = FURNITURE[m.code];
    if (!def) return;
    this.elegir(m.id);
    const acciones: { etiqueta: string; accion: () => void; primario?: boolean; icono?: string }[] = [
      { etiqueta: "Mover", primario: true, accion: () => this.empezarColocar(m.id, m.code, m.rot, { col: m.col, row: m.row }) },
    ];
    if (def.orientable) {
      acciones.push({
        etiqueta: "Girar",
        icono: "girar",
        accion: () => {
          this.cerrarMenuMueble();
          net.colocar({ item: m.id, col: m.col, row: m.row, rot: m.rot === 1 ? 0 : 1 });
        },
      });
    }
    acciones.push({
      etiqueta: "Guardar",
      icono: "mochila",
      accion: () => {
        this.cerrarMenuMueble();
        net.recoger(m.id);
      },
    });

    const f = medidas().fila;
    const W = 150;
    const H = 30 + acciones.length * (f + 4) + 4;
    // Encima del mueble (a la escala que esté la sala), sin salirse de la
    // pantalla ni tapar el HUD o la barra de decorar
    const img = this.objetosCasa.get(m.id)?.imagen;
    const suelo = toScreen(m.col, m.row);
    const ancla = img ? this.aPantalla(img.x, img.y - img.displayOriginY) : this.aPantalla(suelo.x, suelo.y);
    const arriba = (this.hud?.altoSuperior ?? 0) + 4;
    const abajo = this.scale.height - (this.hud?.altoInferior ?? 0) - this.altoBarraDeco - 8;
    const x0 = Math.round(Phaser.Math.Clamp(ancla.x - W / 2, 8, this.scale.width - W - 8));
    const y0 = Math.round(Phaser.Math.Clamp(ancla.y - H - 6, arriba, Math.max(arriba, abajo - H)));
    const add = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(o: T, capa = 0): T => {
      o.setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
      this.menuMueble.push(o);
      return o;
    };
    // El fondo se come los toques: tocar dentro del menú no elige otro mueble
    add(pieza(this, "panel", x0, y0, W, H).setInteractive());
    add(icono(this, "rombo", x0 + 8, y0 + 11), 1);
    let nombre = this.nombreMueble(m.code);
    while (anchoTexto(nombre) > W - 30 && nombre.length > 3) nombre = nombre.slice(0, -2) + "…";
    add(texto(this, x0 + 22, yCentrada(y0, 26), nombre, { color: UI.titulo }), 1);
    acciones.forEach((a, i) => {
      const b = boton(this, x0 + 8, y0 + 30 + i * (f + 4), W - 16, f, a.etiqueta, a.accion, {
        primario: a.primario,
        icono: a.icono,
        capa: LAYER.UI_PANEL + 2,
      });
      this.menuMueble.push(...b.objetos);
    });
  }

  private cerrarMenuMueble(): void {
    for (const o of this.menuMueble) o.destroy();
    this.menuMueble = [];
    this.elegir(null);
  }

  /**
   * La barra de decorar, abajo (encima de la de botones): qué se puede hacer
   * y sus botones. Colocando: "Poner aquí" (con el dedo), Girar y Cancelar;
   * si no, la mochila y "Listo".
   */
  private pintarBarraDeco(): void {
    for (const o of this.barraDeco) o.destroy();
    this.barraDeco = [];
    this.altoBarraDeco = 0;
    if (!this.decorando) return;
    // La chuleta de controles va en el mismo sitio: decorando, sobra
    this.hud?.quitarChuleta();
    const m = medidas();
    const c = this.colocando;
    const W = this.scale.width;
    const H = this.scale.height;
    let pista: string;
    const botones: { etiqueta: string; icono?: string; primario?: boolean; accion: () => void }[] = [];
    if (c) {
      const nombre = this.nombreMueble(c.code);
      pista = m.tactil ? `${nombre}: toca dónde va y pulsa «Poner aquí».` : `${nombre}: haz clic en su sitio.`;
      if (m.tactil) botones.push({ etiqueta: "Poner aquí", primario: true, accion: () => this.confirmarColocar() });
      if (FURNITURE[c.code]?.orientable) {
        botones.push({ etiqueta: m.tactil ? "Girar" : "Girar · R", icono: "girar", accion: () => this.girarFantasma() });
      }
      botones.push({ etiqueta: m.tactil ? "Cancelar" : "Cancelar · Esc", accion: () => this.cancelarColocar() });
    } else {
      pista = m.tactil
        ? "Decorando: toca un mueble para moverlo, girarlo o guardarlo."
        : "Decorando: haz clic en un mueble para moverlo, girarlo o guardarlo.";
      botones.push({ etiqueta: "Mochila", icono: "mochila", accion: () => this.abrirMochila() });
      botones.push({ etiqueta: "Listo", primario: true, accion: () => this.salirDecorar() });
    }

    const f = m.fila;
    const anchos = botones.map((b) => anchoTexto(b.etiqueta) + (b.icono ? 15 : 0) + 20);
    const anchoBotones = anchos.reduce((a, b) => a + b, 0) + (botones.length - 1) * 6;
    const anchoMax = Math.min(W - 16, 440);
    const lineas = partirTexto(pista, anchoMax - 24);
    const anchoLineas = Math.max(...lineas.map((l) => anchoTexto(l)));
    const w = Math.min(anchoMax, Math.max(anchoBotones, anchoLineas) + 24);
    const h = 8 + lineas.length * 16 + 6 + f + 8;
    const x = Math.round((W - w) / 2);
    const y = Math.round(H - (this.hud?.altoInferior ?? 0) - 8 - h);
    const add = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(o: T, capa: number): T => {
      o.setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
      this.barraDeco.push(o);
      return o;
    };
    // Por encima del historial del chat, que puede quedar debajo
    add(pieza(this, "panel", x, y, w, h).setInteractive(), 2);
    add(centrar(texto(this, 0, 0, lineas.join("\n"), { alinear: "center", interlineado: 1 }), x + w / 2, y + 8 + (lineas.length * 16) / 2 - 1), 3);
    let bx = Math.round(x + (w - anchoBotones) / 2);
    const by = y + 8 + lineas.length * 16 + 6;
    botones.forEach((b, i) => {
      const bt = boton(this, bx, by, anchos[i], f, b.etiqueta, b.accion, {
        primario: b.primario,
        icono: b.icono,
        capa: LAYER.UI_PANEL + 3,
      });
      this.barraDeco.push(...bt.objetos);
      bx += anchos[i] + 6;
    });
    this.altoBarraDeco = h + 8;
  }

  /**
   * Los muebles de una casa: no vienen en el mapa, son del jugador y los
   * manda el servidor (al entrar y cada vez que se decora). De cada uno se
   * recuerda lo dibujado, para rehacerlo, esconderlo o tocarlo.
   */
  private ponerMueblesCasa(): void {
    const muebles = mueblesDeCasas.get(this.roomId) ?? [];
    // Las alfombras eligen su cenefa según sus vecinas, como las del mapa
    const alfombras = new Set(muebles.filter((m) => isFurniture(m.code) && FURNITURE[m.code].plano).map((m) => `${m.col},${m.row}`));
    const esAlfombra = (c: number, r: number) => alfombras.has(`${c},${r}`);
    for (const m of muebles) {
      if (!isFurniture(m.code) || !this.inBounds(m.col, m.row)) continue;
      const def = FURNITURE[m.code];
      const girado = m.rot === 1;
      let sufijo: string | number | undefined;
      if (def.plano) sufijo = mascaraAlfombra(m.col, m.row, esAlfombra);
      else if (def.pared) {
        const lado = ladoPared(m.col, m.row);
        if (!lado) continue;
        sufijo = lado;
      } else if (vaGirado(m.code, m.col, girado)) sufijo = "se";
      this.objetosCasa.set(m.id, { mueble: m, ...this.ponerMueble(m.code, sufijo, m.col, m.row, girado) });
    }
  }

  /** Cambiaron los muebles de la casa (se decoró): fuera los de antes, dentro los de ahora */
  private rehacerMueblesCasa(): void {
    for (const d of this.objetosCasa.values()) for (const o of d.objetos) o.destroy();
    this.objetosCasa.clear();
    this.blocked = this.bloqueoBase.map((fila) => [...fila]);
    this.furniture = [...this.mueblesBase];
    this.ponerMueblesCasa();
    // El menú era de un mueble que quizá ya no está ahí; lo que se está
    // moviendo sigue escondido, y el fantasma se vuelve a mirar (quizá ya no cabe)
    this.cerrarMenuMueble();
    if (this.colocando) {
      this.verOriginal(this.colocando.item, false);
      this.pintarFantasma();
    }
  }

  // ---------- Aspecto ----------

  /**
   * Abre el vestidor sobre el aspecto actual. Nada cambia hasta Guardar.
   * `bienvenida` es la primera vez, recién creada la cuenta.
   */
  private abrirVestidor(bienvenida = false): void {
    if (this.vestidor || this.authModalOpen) return;
    this.despejar();
    this.cerrarTienda();
    this.cerrarMochila();
    this.salirDecorar();
    this.avatar.cancelPath();
    const pista = medidas().tactil ? undefined : "C o Esc para cerrar · ←/→ giran";
    this.vestidor = new Vestidor(this, {
      look: this.look,
      titulo: bienvenida ? "¡Bienvenido a Roomie!" : "Vestidor",
      subtitulo: bienvenida ? "Elige cómo quieres que te vean" : pista,
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

  /**
   * Dónde va el chat en esta pantalla. El historial, abajo a la izquierda
   * (encima de la barra de botones si la hay). La barra de escribir, debajo
   * del historial; pero con el dedo va ARRIBA: abajo la taparía el teclado
   * del móvil al escribir.
   */
  private calcularChat(): void {
    const m = medidas();
    const W = this.scale.width;
    const H = this.scale.height;
    const abajo = this.hud?.altoInferior ?? 0;
    const barraH = m.barra;
    const barraY = m.tactil ? (this.hud?.altoSuperior ?? 36) + 6 : H - 8 - abajo - barraH;
    const bottom = m.tactil ? H - abajo - 12 - (this.hud?.altoChuleta ?? 0) : barraY - 11;
    // Como mucho, algo menos de media pantalla de historial
    const lines = Math.max(3, Math.min(CHAT_LINEAS_MAX, Math.floor((H * 0.42) / 16)));
    // Escribiendo con el dedo: bajo la barra, hasta donde empieza el teclado (media pantalla)
    const debajo = barraY + barraH + 6;
    const linesAbierto = m.tactil ? Math.max(3, Math.min(CHAT_LINEAS_MAX, Math.floor((H * 0.45 - debajo) / 16))) : lines;
    const bottomAbierto = m.tactil ? debajo + 15 + (linesAbierto - 1) * 16 : bottom;
    this.chat = { x: 8, bottom, w: Math.min(360, W - 16), lines, bottomAbierto, linesAbierto, lineH: 16, barraY, barraH };
  }

  /** Coloca los objetos del chat donde dice `this.chat` */
  private colocarChat(): void {
    const c = this.chat;
    // El fondo sólo se ve con el chat abierto: va donde va el historial entonces
    const alturaPanel = c.linesAbierto * c.lineH + 10;
    this.chatPanelBg.setPosition(c.x, c.bottomAbierto + 5 - alturaPanel).setSize(c.w, alturaPanel);
    this.chatBg.setPosition(c.x, c.barraY).setSize(c.w, c.barraH);
    this.chatLabel.setPosition(c.x + 8, yCentrada(c.barraY, c.barraH));
    this.renderChatPanel();
  }

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
      abajo: this.hud?.altoInferior ?? 0,
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
    this.ponerBotonFrases();
  }

  /** Las frases, a mano también para quien escribe (rápidas, y en el móvil), al final de la barra */
  private ponerBotonFrases(): void {
    for (const o of this.chatFrasesBtn) o.destroy();
    const anchoBtn = 56;
    this.chatFrasesBtn = boton(
      this,
      this.chat.x + this.chat.w - 3 - anchoBtn,
      this.chat.barraY + 3,
      anchoBtn,
      this.chat.barraH - 6,
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
    // Con el dedo no hay Enter ni Esc: envía la tecla del teclado del móvil
    const pista = medidas().tactil ? "Escribe algo…" : "Escribe algo…  (Enter envía, Esc cancela)";
    this.chatLabel.setText(this.chatText ? `${this.chatText}▌` : pista);
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
      onCasa: () => {
        if (this.alive) this.onCasa();
      },
      onSalaDatos: (p) => {
        if (this.alive) this.onSalaDatos(p);
      },
      onTienda: (lista) => {
        articulos = lista;
        if (this.alive && this.quiereTienda) this.mostrarTienda();
      },
      onMochila: (cosas) => {
        if (this.alive) this.mochila?.actualizar(cosas);
      },
      onSaldo: (s) => {
        if (!this.alive) return;
        this.updateStatusHud();
        this.tienda?.actualizarSaldo(s);
      },
      onMuebles: (sala, muebles) => {
        mueblesDeCasas.set(sala, muebles);
        if (this.alive && sala === this.roomId) this.rehacerMueblesCasa();
      },
      onPerfil: (p) => {
        if (this.alive) this.onPerfil(p);
      },
      onResultado: (r) => {
        if (!this.alive) return;
        avisoFlotante(this, r.texto, r.ok);
        // Colocando: si salió bien se termina (el mueble de verdad llega con
        // `muebles`, así que el original no se vuelve a enseñar); si no, se
        // sigue probando
        if (this.colocando?.enviadoEn) {
          if (r.ok) this.cancelarColocar(false);
          else this.colocando.enviadoEn = 0;
        }
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
    return partirTexto(text, this.chat.w - 18);
  }

  /**
   * Dibuja el panel. Con el chat abierto se ve entero y con fondo; cerrado,
   * sólo las líneas recientes y sin fondo, como en Minecraft.
   */
  private renderChatPanel(): void {
    if (this.chatLineTexts.length === 0) return;
    const ahora = this.time.now;
    const c = this.chat;
    const bottom = this.chatOpen ? c.bottomAbierto : c.bottom;
    const visibles = this.chatLines
      .filter((l) => this.chatOpen || ahora - l.at < CHAT_FADE_MS)
      .slice(-(this.chatOpen ? c.linesAbierto : c.lines));

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
        .setPosition(c.x + 8, bottom - i * c.lineH)
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
      creditos: net.identidad?.creditos ?? 0,
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
    // El catálogo y la mochila, para tenerlos a mano al abrir la tienda o la mochila
    if (articulos.length === 0) net.tienda();
    net.mochila();
    // Ya se está en el mundo: la chuleta de controles empieza a contar
    this.hud?.arrancarChuleta();
    // Al entrar al juego se aparece en casa, si la hay (una vez por visita:
    // no en cada reconexión). Quien aún no tiene, empieza en la plaza.
    if (!llegadaHecha) {
      llegadaHecha = true;
      if (p.casa && this.roomId !== p.casa.id) this.irACasa();
      else if (!p.casa) this.pushChatLine("Tu piso te espera: pasa por la portería del Edificio Roomie, en la plaza.", CHAT_COLORS.system);
    }
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
  //   login      — usuario + contraseña
  //   register   — usuario + contraseña + nombre en el juego + fecha de nacimiento
  //   nacimiento — cuentas de antes: sólo la fecha de nacimiento
  //
  // Ya dentro, tu perfil es otra cosa: la ficha de `src/ui/perfil.ts`.
  //
  // El nombre del jugador YA NO se elige aquí cada vez: pertenece a la cuenta
  // y vive en la base de datos. Antes el cliente decía cómo se llamaba y el
  // servidor se lo creía.

  private showAuthModal(modo: AuthModalMode = "login"): void {
    if (this.authModalOpen) return; // no apilar
    this.authModalOpen = true;
    this.authMode = modo;
    this.chatOpen = false;
    this.despejar();
    this.cerrarVestidor();
    this.cerrarTienda();
    this.cerrarMochila();
    this.salirDecorar();
    // El teclado del juego se apaga entero: si no, escribir una "c" abre el
    // vestidor y Enter abre el chat detrás del modal.
    this.setGameKeyboard(false);

    const registro = modo === "register";
    const nacimiento = modo === "nacimiento";
    const tactil = medidas().tactil;
    const SW = this.scale.width;
    const SH = this.scale.height;
    const cx = Math.round(SW / 2);
    // En una pantalla bajita (un móvil en horizontal) todo va más junto
    const apretado = SH < 420;

    // La altura se CALCULA a partir de lo que va dentro, no se elige a ojo.
    // Puesta a mano, el botón acababa montado encima de lo de arriba.
    //
    // El aspecto ya no se elige aquí: tiene su vestidor, que se abre solo al
    // crear la cuenta y desde tu perfil.
    const PAD = apretado ? 10 : 16;
    const TITULO = 16 + 12; // rombo y título + hueco
    const ALTO_CAMPO = tactil ? 28 : 24;
    const CAMPO = 15 + 3 + ALTO_CAMPO + (apretado ? 4 : 10); // etiqueta + caja + hueco
    const MENSAJE = apretado ? 32 : 36; // hasta dos líneas
    const ALTO_BOTON = tactil ? 30 : 26;
    const BOTONES = ALTO_BOTON + 8 + ALTO_BOTON;
    // Filas de campos: usuario, contraseña, nombre y fecha de nacimiento
    const nCampos = nacimiento ? 1 : registro ? 4 : 2;
    const EXPLICA = nacimiento ? 40 : 0; // por qué se pide la fecha
    const W = Math.min(300, SW - 16);
    const H = PAD + TITULO + EXPLICA + nCampos * CAMPO + MENSAJE + BOTONES + PAD;
    // Encima del panel, el nombre del juego (si cabe)
    const LOGO = SH < H + 64 + 16 ? 0 : 64;
    const X = cx - Math.round(W / 2);
    // Con el dedo, arriba: el teclado del móvil sale por abajo y taparía los campos
    const Y = tactil ? 8 + LOGO : Math.max(8, Math.round((SH - LOGO - H) / 2)) + LOGO;
    const colX = X + 16;
    const anchoCampo = W - 32;
    this.authDesplazado = 0;

    const add = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(
      o: T,
      capa = 1,
    ): T => {
      o.setScrollFactor(0).setDepth(LAYER.UI_MODAL + capa);
      this.authUI.push(o);
      return o;
    };

    // Velo: la sala se intuye detrás, oscurecida; se come todos los clics
    this.authVelo = add(this.add.rectangle(SW / 2, SH / 2, SW, SH, UI_HEX.velo, 0.82).setInteractive(), 0);

    if (LOGO > 0) {
      // El logo es lo único a 24 px: la casa y la palabra, a la par
      const logo = texto(this, 0, 0, "Roomie", { tam: 2, color: UI.titulo });
      const casa = icono(this, "casa", 0, 0).setScale(2);
      const ancho = casa.displayWidth + 10 + logo.width;
      const x0 = Math.round(cx - ancho / 2);
      const yLogo = Y - LOGO;
      casa.setPosition(x0, yLogo + 4);
      logo.setPosition(x0 + casa.displayWidth + 10, yLogo);
      add(casa, 2);
      add(logo, 2);
      add(centrar(texto(this, 0, 0, "Tu casa, tu gente, tu mundo", { color: UI.suave }), cx, Y - 18), 2);
    }

    add(pieza(this, "panel", X, Y, W, H).setInteractive(), 1);
    const titulo = registro ? "Crear cuenta" : nacimiento ? "Un último paso" : "Entrar";
    const tituloTxt = texto(this, 0, yCentrada(Y + PAD, 16), titulo, { color: UI.titulo });
    const rombo = icono(this, "rombo", 0, 0);
    const anchoTitulo = rombo.width + 6 + tituloTxt.width;
    rombo.setPosition(Math.round(cx - anchoTitulo / 2), Y + PAD + 6);
    tituloTxt.setX(rombo.x + rombo.width + 6);
    add(rombo, 2);
    add(tituloTxt, 2);

    let cursorY = Y + PAD + TITULO;

    if (nacimiento) {
      const explica = partirTexto("Para cuidar a todo el mundo en Roomie, dinos cuándo naciste. Nadie más lo verá.", anchoCampo);
      const t = texto(this, 0, cursorY, explica.join("\n"), { color: UI.suave, alinear: "center" });
      add(t.setX(Math.round(cx - t.width / 2)), 2);
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
      // Las tres cajas llenan el ancho del campo (día y mes, iguales; el año, algo más)
      const corta = Math.floor((anchoCampo - 16) * 0.3);
      const cajas: [CampoClave, string, number, number, string][] = [
        ["dia", "Día", 2, corta, "bday-day"],
        ["mes", "Mes", 2, corta, "bday-month"],
        ["anio", "Año", 4, anchoCampo - 16 - corta * 2, "bday-year"],
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

    if (!nacimiento) {
      campo("username", "Usuario", false, "username");
      campo("password", "Contraseña", true, registro ? "new-password" : "current-password");
    }
    if (registro) campo("nickname", "Tu nombre en el juego", false, "nickname");
    if (registro || nacimiento) campoFecha();

    // ---------- Mensaje (errores, "Conectando…") ----------
    // Una o dos líneas centradas en su hueco (ver `mensajeAuth`)
    this.authError = add(texto(this, cx, cursorY + 4, "", { color: UI.error, alinear: "center" }).setOrigin(0.5, 0), 2);
    this.authError.setData("y0", cursorY + 4);
    cursorY += MENSAJE;

    // ---------- Botones ----------
    // Los botones cuelgan del final del contenido, no de una altura fija
    const principal = registro ? "Crear cuenta y entrar" : nacimiento ? "Seguir" : "Entrar";
    const b1 = boton(
      this,
      colX,
      cursorY,
      anchoCampo,
      ALTO_BOTON,
      principal,
      () => this.submitAuth(),
      { primario: true, capa: LAYER.UI_MODAL + 2 },
    );
    const segundo = nacimiento ? "Cerrar sesión" : registro ? "Ya tengo cuenta" : "Crear una cuenta nueva";
    const b2 = boton(
      this,
      colX,
      cursorY + ALTO_BOTON + 8,
      anchoCampo,
      ALTO_BOTON,
      segundo,
      () => {
        if (nacimiento) return this.cerrarSesion();
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
    this.asomarCampo(c);
    this.pintarCampos();
  }

  /**
   * Con el dedo, el teclado del móvil tapa la mitad de abajo de la pantalla:
   * si el campo que se va a escribir cae ahí, el modal entero sube hasta que
   * asome (y baja otra vez al volver a uno de arriba). El velo no se mueve.
   */
  private asomarCampo(c: CampoAuth): void {
    if (!medidas().tactil) return;
    const limite = Math.round(this.scale.height * 0.45);
    const pie = c.fondo.y - this.authDesplazado + c.fondo.height;
    const destino = Math.min(0, limite - pie);
    const paso = destino - this.authDesplazado;
    if (paso === 0) return;
    for (const o of this.authUI) {
      if (o === this.authVelo) continue;
      const t = o as unknown as Phaser.GameObjects.Components.Transform;
      t.y += paso;
    }
    this.authDesplazado = destino;
  }

  /** El modal de cuenta a la medida nueva de la pantalla, sin perder lo que ya se había escrito */
  private rehacerAuthModal(): void {
    const modo = this.authMode;
    const valores = this.authCampos.map((c) => ({ clave: c.clave, valor: c.input?.el.value ?? "" }));
    const activo = this.campoActivo?.clave;
    const mensaje = this.authError?.text ? { texto: this.authError.text.replace(/\n/g, " "), color: String(this.authError.style.color) } : null;
    this.closeAuthModal();
    this.showAuthModal(modo);
    for (const v of valores) this.authCampos.find((c) => c.clave === v.clave)?.input?.setValue(v.valor);
    const campo = this.authCampos.find((c) => c.clave === activo);
    if (campo) this.enfocarCampo(campo);
    this.pintarCampos();
    if (mensaje) this.mensajeAuth(mensaje.texto, mensaje.color);
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
    const lineas = partirTexto(texto, Math.min(268, this.scale.width - 48)).slice(0, 2);
    // Su sitio sin desplazar (ver `asomarCampo`), más lo que haya subido el modal
    const y0 = (this.authError.getData("y0") as number) + this.authDesplazado;
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
    llegadaHecha = false; // quien entre después llegará a SU casa
    mueblesDeCasas.clear();
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
    const look = decodificarLook(v.look);
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
      lookCodigo: v.look,
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

      // Cambió el aspecto del remoto → regenerar SU textura (no la mía). Se
      // compara el código tal cual llega: sólo se descodifica si cambió.
      if (v.look !== peer.lookCodigo) {
        peer.lookCodigo = v.look;
        const look = decodificarLook(v.look);
        if (!mismoLook(peer.look, look)) {
          peer.look = look;
          createAvatarTexture(this, look, peer.textureKey);
          peer.sprite.setTexture(peer.textureKey, frameInicial(v.facing));
        }
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

    // Con el dedo, todo algo más grande (ver `medidas`)
    const f = medidas().fila;
    const g = f + 2; // lado de los botones de gesto
    const W = 16 + GESTOS.length * (g + 4) - 4;
    const yHablar = 28 + g + 8;
    const yBloquear = yHablar + g + 6;
    const H = yBloquear + f - 2 + 8;
    this.menuTam = { w: W, h: H };
    const m = this.piezasMenu();
    m.fondo(W, H);
    m.cabecera(peer.view.name);

    // Gestos: el emoji lo pinta la fuente del sistema
    GESTOS.forEach((gesto, i) => {
      const dx = 8 + i * (g + 4);
      m.boton("", dx, 28, g, g, () => {
        this.closePeerMenu();
        this.enviarFrase(gesto.id);
      });
      m.add(this.add.text(0, 0, gesto.texto, { fontSize: "13px" }).setOrigin(0.5), dx + g / 2, 28 + g / 2, LAYER.UI_PANEL + 1);
    });

    // Su perfil, y hablarle: con texto propio, o con frases si hablas con frases
    const mitad = Math.floor((W - 16 - 4) / 2);
    m.boton("Ver perfil", 8, yHablar, mitad, g, () => this.verPerfil(peer.view.id));
    if (net.hablaConFrases) {
      m.boton("Decir algo", 8 + mitad + 4, yHablar, mitad, g, () => this.abrirFrases(), true);
    } else {
      m.boton("Escribirle", 8 + mitad + 4, yHablar, mitad, g, () => this.chatTo(peer.view.name), true);
    }

    const bloqueado = net.tieneBloqueado(peer.view.name);
    m.boton(bloqueado ? "Desbloquear" : "Bloquear", 8, yBloquear, mitad, f - 2, () => {
      this.closePeerMenu();
      net.bloquear(peer.view.id, !bloqueado);
    });
    m.boton("Reportar", 8 + mitad + 4, yBloquear, mitad, f - 2, () => this.abrirReporte(peer.view.id));

    this.peerMenuItems = m.items;
    this.peerMenuFor = id;
    this.movePeerMenu();
  }

  /** Reportar: por qué, con palabras que entiende cualquiera */
  private abrirReporte(id: string): void {
    const peer = this.peers.get(id);
    this.closePeerMenu();
    if (!peer) return;
    const f = medidas().fila;
    const W = 220;
    const H = 30 + (MOTIVOS_REPORTE.length + 1) * (f + 4) + 4;
    this.menuTam = { w: W, h: H };
    const m = this.piezasMenu();
    m.fondo(W, H);
    m.cabecera(`¿Qué pasa con ${peer.view.name}?`);
    MOTIVOS_REPORTE.forEach((r, i) => {
      m.boton(r.texto, 8, 30 + i * (f + 4), W - 16, f, () => {
        this.closePeerMenu();
        net.reportar(peer.view.id, r.motivo);
      });
    });
    m.boton("Cancelar", 8, 30 + MOTIVOS_REPORTE.length * (f + 4), W - 16, f, () => this.closePeerMenu());
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

    // Paredes traseras (o, al aire libre, las fachadas de los edificios) y
    // luego el mobiliario (la capa "objetos" de Tiled)
    const prop = (nombre: string) => data.properties?.find((p) => p.name === nombre)?.value;
    if (prop("exterior") === true) {
      this.altoMuro = ALTO_FACHADA;
      const frames = (v: unknown) => String(v ?? "").split(",").map(Number);
      this.buildFachadas(frames(prop("fachadaDer")), frames(prop("fachadaIzq")));
    } else {
      this.altoMuro = ALTO_PARED;
      this.buildWalls();
    }
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
      // lo orientable girado si está pegado a la pared de la columna 0 o si
      // el mapa lo pide (un banco mirando al sureste)
      const girado = this.intProp(o.properties, "girado") === 1;
      let sufijo: string | number | undefined;
      if (def.plano) sufijo = mascaraAlfombra(col, row, esAlfombra);
      else if (def.pared) {
        const lado = ladoPared(col, row);
        if (!lado) continue; // colgado en mitad de la sala: no hay muro
        sufijo = lado;
      } else if (vaGirado(kind, col, girado)) sufijo = "se";
      this.ponerMueble(kind, sufijo, col, row, girado);
    }

    // Hasta aquí, lo que trae el mapa. Los muebles de una casa van aparte
    // (son del jugador) y se rehacen cada vez que se decora
    this.bloqueoBase = this.blocked.map((fila) => [...fila]);
    this.mueblesBase = [...this.furniture];
    this.plano = esCasa(this.roomId) ? planoDesdeMapa(data) : null;
    this.ponerMueblesCasa();
  }

  /**
   * Dibuja un mueble y marca lo que estorba: TODAS las celdas de su huella
   * (`celdasDe`, la misma regla que el servidor). Qué estorba y qué se pisa
   * lo decide el catálogo, no un `if` aquí. Devuelve lo dibujado.
   */
  private ponerMueble(
    kind: FurnitureKind,
    sufijo: string | number | undefined,
    col: number,
    row: number,
    girado: boolean,
  ): { imagen: Phaser.GameObjects.Image | null; objetos: Phaser.GameObjects.GameObject[] } {
    const imagen = crearMueble(this, kind, sufijo, col, row, this.theme);
    const luces = crearLuz(this, kind, col, row, this.theme);
    if (FURNITURE[kind].blocks) {
      for (const c of celdasDe(kind, col, row)) if (this.inBounds(c.col, c.row)) this.blocked[c.row][c.col] = true;
    }
    this.furniture.push({ kind, col, row, girado });
    return { imagen, objetos: imagen ? [imagen, ...luces] : luces };
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

  /**
   * Al aire libre: las fachadas de los edificios, una pieza por celda en los
   * dos bordes traseros, como las paredes (y por eso se ordenan igual con los
   * avatares). Qué edificio va en cada celda lo dice el mapa.
   */
  private buildFachadas(der: number[], izq: number[]): void {
    const h = ALTO_FACHADA;
    for (let col = 0; col < this.cols; col++) {
      const { x, y } = toScreen(col, 0);
      this.add
        .image(x, y - 16 - h, "fachadas", der[col] ?? 0)
        .setOrigin(0, 0)
        .setDepth(worldDepth(y));
    }
    for (let row = 0; row < this.rows; row++) {
      const { x, y } = toScreen(0, row);
      this.add
        .image(x - 32, y - 16 - h, "fachadas", izq[row] ?? 1)
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
    const minY = Math.min(...ys) - 16 - this.altoMuro;
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
