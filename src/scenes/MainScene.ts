import Phaser from "phaser";
import { toScreen, toGrid } from "../utils/iso";
import { animKey, createAvatarTexture, destroyAvatarAssets } from "../entities/avatar";
import { createFurniture, type FurnitureKind } from "../entities/furniture";
import { findPath, type Cell } from "../utils/pathfinding";
import { AvatarState, SIT_OFFSET, SIT_SHIFT, type Facing } from "../state/avatarState";
import {
  DEFAULT_PALETTE,
  HAIR_COLORS,
  SHIRT_COLORS,
  paletteFrom,
  type Palette,
} from "../state/palette";
import { loadSave, writeSave, clearSave, type SaveData } from "../utils/storage";
import { LAYER, worldDepth } from "../render/layers";
import { net, playerName } from "../net/client";
import {
  KEYBOARD_SPEED,
  NAME_MAX,
  ROOMS,
  type ChatPayload,
  type JoinErrorPayload,
  type Look,
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

/** Textura propia de la vista previa del modal (independiente de la del jugador) */
const PREVIEW_KEY = "avatar:preview";

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

/** Avatar remoto dibujado en la escena (su textura es `avatar:<id>`) */
type Peer = {
  view: PlayerView;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  /** Posición interpolada en celdas (va detrás del snapshot del servidor) */
  col: number;
  row: number;
  textureKey: string;
  look: Look;
};

/** Render de un avatar remoto: MISMA fórmula que `AvatarState.screen()` */
function peerScreen(
  col: number,
  row: number,
  sitting: boolean,
): { x: number; y: number; depth: number } {
  const base = toScreen(col, row);
  const depth = toScreen(Math.round(col), Math.round(row)).y + 0.5;
  return sitting
    ? { x: base.x - SIT_SHIFT, y: base.y - SIT_OFFSET, depth }
    : { x: base.x, y: base.y, depth };
}

// Fase 6: múltiples salas con puertas. Render + entrada + chat + guardado +
// personalización; la lógica del avatar vive en AvatarState (módulo puro).
export class MainScene extends Phaser.Scene {
  private roomId: RoomId = "room1";
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

  private avatar!: AvatarState;
  private blocked: boolean[][] = [];
  private cols = 0;
  private rows = 0;
  private furniture: PlacedFurniture[] = [];
  private doors: Door[] = [];
  private pendingDoor: Door | null = null;
  private transitioning = false;

  // Personalización
  private palette: Palette = DEFAULT_PALETTE;
  private customOpen = false;
  private customUI: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [];
  private shirtSwatches: Phaser.GameObjects.Rectangle[] = [];
  private hairSwatches: Phaser.GameObjects.Rectangle[] = [];
  private readonly PANEL = { x: 736, y: 40, w: 216, h: 168 };

  // Chat
  private chatOpen = false;
  private chatText = "";
  private chatBg!: Phaser.GameObjects.Rectangle;
  private chatLabel!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  /** Burbujas por avatar: "me" o el id del jugador remoto */
  private bubbles = new Map<string, Phaser.GameObjects.Container>();
  /** Avisos de sistema (entró/salió) en la esquina inferior izquierda */
  private logLines: string[] = [];
  private logLabel!: Phaser.GameObjects.Text;

  // Multijugador (Fase 7)
  private peers = new Map<string, Peer>();
  private netPlayers: PlayerView[] = [];
  private netOnline = false;
  private alive = false; // false durante un reinicio de escena (transición)
  private sentMove = { mx: 0, my: 0 };
  private lastMoveSent = 0;
  /** Historia reciente de snapshots, para interpolar a los remotos */
  private snapshots: Snapshot[] = [];
  private loginModalOpen = false;
  private loginUI: Phaser.GameObjects.GameObject[] = [];
  /**
   * Valor REAL del nickname que se está escribiendo. Antes se sacaba del propio
   * objeto Text quitándole el cursor (`text.replace("▌", "")`), y por eso el
   * borrado no funcionaba: `slice(0, -1)` se comía el cursor, no la letra, y
   * al volver a pegarlo el texto quedaba igual que estaba.
   */
  private loginNick = "";
  /** Listener de teclado del modal. Se guarda para poder QUITARLO al cerrar. */
  private loginKeys: ((e: KeyboardEvent) => void) | null = null;
  /** Texto de error del modal (referencia directa, no búsqueda por contenido) */
  private loginError: Phaser.GameObjects.Text | null = null;
  /** Paleta al abrir el modal, para poder descartar los cambios al cancelar */
  private loginPaletteOnOpen: Palette | null = null;

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
  }

  create(): void {
    // Reinicio limpio (la escena se reinicia al cruzar puertas)
    this.transitioning = false;
    this.chatOpen = false;
    this.chatText = "";
    this.customOpen = false;
    this.loginModalOpen = false;
    this.loginNick = "";
    this.loginKeys = null;
    this.loginError = null;
    this.loginPaletteOnOpen = null;
    this.alive = true;
    this.peers = new Map(); // los game objects viejos ya los destruyó el restart
    this.bubbles = new Map();
    this.logLines = [];
    this.sentMove = { mx: 0, my: 0 };
    this.lastMoveSent = 0;
    this.snapshots = [];
    this.furniture = [];
    this.doors = [];
    this.pendingDoor = null;
    this.customUI = [];
    this.shirtSwatches = [];
    this.hairSwatches = [];

    const save = loadSave();
    this.palette = paletteFrom(save);

    createAvatarTexture(this, this.palette);
    // Vecino más cercano también para el tileset (nítido al escalar)
    this.textures.get("tileset").setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.buildRoom();

    this.avatar = new AvatarState(
      {
        cols: this.cols,
        rows: this.rows,
        isBlocked: (c, r) => this.blocked[r][c],
      },
      this.resolveStartCell(save),
      this.resolveStartFacing(save),
    );

    const p = this.avatar.screen();
    this.player = this.add
      .sprite(p.x, p.y, "avatar", `${this.avatar.facing}-0`)
      .setOrigin(0.5, 1)
      .setScale(2) // 24px -> 48px de alto: proporción Habbo frente a los tiles
      .setDepth(worldDepth(p.depth));
    this.player.play(this.anim(`idle-${this.avatar.facing}`));

    const [bx, by, bw, bh] = this.roomBounds();
    this.cameras.main.setBounds(bx, by, bw, bh);
    // Centrar al cargar: con límites más pequeños que la ventana, Phaser
    // ancla el scroll al borde mínimo y la sala queda pegada arriba.
    this.cameras.main.centerOn(bx + bw / 2, by + bh / 2);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.fadeIn(250, 0, 0, 0);

    this.add
      .text(8, 8, `Roomie — ${this.roomId}\nClic/WASD · Enter: chat · C: personalizar`, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setScrollFactor(0)
      // Sin esta línea se quedaba en profundidad 0 y el SUELO de la sala
      // (que llega a ~352) lo tapaba en cuanto la cámara ponía baldosas
      // detrás de esa esquina.
      .setDepth(LAYER.UI_HUD);

    // Estado de la conexión (multijugador)
    const statusStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#ffe9a8",
    };
    this.statusText = this.add
      .text(8, 46, "", statusStyle)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_HUD);
    // Log de avisos del servidor (entró/salió), 3 líneas máx.
    this.logLabel = this.add
      .text(8, 452, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#9a9ad0",
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_HUD);

    // Barra de chat (interfaz fija en pantalla)
    this.chatBg = this.add
      .rectangle(480, 512, 420, 26, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_PANEL)
      .setVisible(false);
    this.chatLabel = this.add
      .text(280, 512, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#ffffff",
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_PANEL + 1)
      .setVisible(false);

    this.buildCustomPanel();
    this.buildProfileButton();

    // Red: registro los handlers de ESTA escena y aviso de mi sala/posición
    this.setupNet();

    // Si no hay nickname guardado, mostrar modal de login
    if (!save?.nickname) {
      this.showLoginModal();
    } else {
      // Ya hay nickname: entrar directo
      this.sendWhere();
    }

    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys("W,A,S,D") as MainScene["wasd"];

      kb.on("keydown", (e: { key?: string }) => {
        const key = e.key ?? "";
        if (!this.chatOpen) {
          if (key === "Enter") this.openChat();
          else if (key === "c" || key === "C") this.toggleCustomPanel();
          return;
        }
        if (key === "Enter") this.sendChat();
        else if (key === "Escape") this.closeChat();
        else if (key === "Backspace") {
          this.chatText = this.chatText.slice(0, -1);
          this.renderChatBar();
        } else if (key.length === 1 && this.chatText.length < 40) {
          this.chatText += key;
          this.renderChatBar();
        }
      });
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return; // solo clic izquierdo
      if (this.loginModalOpen) return; // el modal se lleva todos los clics
      this.handleWorldClick(pointer);
    });

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
      if (this.loginKeys) {
        window.removeEventListener("keydown", this.loginKeys);
        this.loginKeys = null;
      }
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
    if (!this.chatOpen) {
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
      this.pendingDoor = null; // moverse cancela el camino de la puerta
      this.avatar.keyboardMove(dx * KEYBOARD_SPEED * dt, dy * KEYBOARD_SPEED * dt);
    } else {
      this.avatar.tick(dt);
    }
    this.sendMove(dx, dy);

    // ¿Llegó a una puerta? → cruzar
    if (this.pendingDoor && this.avatar.path.length === 0) {
      const d = this.pendingDoor;
      this.pendingDoor = null;
      if (
        Math.round(this.avatar.col) === d.col &&
        Math.round(this.avatar.row) === d.row
      ) {
        this.transitionTo(d);
      }
    }

    // Estado -> render
    const p = this.avatar.screen();
    const moveX = p.x - old.x;
    const moveY = p.y - old.y;
    const moving = Math.abs(moveX) > 1e-6 || Math.abs(moveY) > 1e-6;

    if (this.avatar.sitting) {
      this.player.play(this.anim("idle-sit"), true);
    } else {
      if (moving) this.avatar.updateFacing(moveX, moveY);
      this.player.play(
        this.anim(moving ? `walk-${this.avatar.facing}` : `idle-${this.avatar.facing}`),
        true,
      );
    }
    this.player.setFlipX(this.avatar.flipX);

    this.player.setPosition(p.x, p.y);
    this.player.setDepth(worldDepth(p.depth)); // orden isométrico

    // Multijugador: dibujo a los demás (interpolados) y muevo las burbujas de
    // chat (la mía y las ajenas). Mi corrección ya se aplicó al principio.
    this.syncPeers();
    this.moveBubbles();
  }

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    // Los clics sobre el panel de personalización no mueven al avatar
    if (this.isOverCustomUI(pointer)) return;
    if (this.chatOpen) {
      this.closeChat(); // un clic en el mundo cierra el chat
      return;
    }

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const g = toGrid(world.x, world.y);
    const goal: Cell = { col: Math.round(g.col), row: Math.round(g.row) };

    if (!this.inBounds(goal.col, goal.row)) return;

    const door = this.doorAt(goal.col, goal.row);
    const furn = this.furnitureAt(goal.col, goal.row);
    const sitTarget = furn?.kind === "sofa" ? furn : null;
    if (!door && !sitTarget && this.blocked[goal.row][goal.col]) return;

    const start: Cell = { col: Math.round(this.avatar.col), row: Math.round(this.avatar.row) };
    if (start.col === goal.col && start.row === goal.row) {
      this.avatar.cancelPath();
      this.pendingDoor = null;
      if (this.avatar.sitting) {
        this.avatar.stand(); // segundo clic en el sofá: levantarse
        net.stand();
      }
      return;
    }

    const path = findPath(
      start,
      goal,
      this.cols,
      this.rows,
      (c, r) => this.blocked[r][c],
      door !== null || sitTarget !== null, // meta válida aunque bloqueada
    );
    if (!path || path.length === 0) return;

    this.pendingDoor = door ?? null;
    this.avatar.startPath(path, sitTarget);
    net.path(path); // el servidor simula el mismo camino con AvatarState
    this.showClickMarker(world.x, world.y);
  }

  private furnitureAt(col: number, row: number): PlacedFurniture | undefined {
    return this.furniture.find((f) => f.col === col && f.row === row);
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

  /** Puerta dibujada sobre la pared trasera de su celda */
  private drawDoor(col: number, row: number): void {
    const { x: cx, y: cy } = toScreen(col, row);
    let a: { x: number; y: number };
    let b: { x: number; y: number };
    if (row === 0) {
      a = { x: cx, y: cy - 16 }; // borde inferior de la pared (izq)
      b = { x: cx + 32, y: cy };
    } else if (col === 0) {
      a = { x: cx - 32, y: cy };
      b = { x: cx, y: cy - 16 };
    } else {
      return; // sin pared trasera no hay puerta visual
    }

    const h = 40;
    const lerp = (
      p: { x: number; y: number },
      q: { x: number; y: number },
      t: number,
    ) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const p0 = lerp(a, b, 0.25);
    const p1 = lerp(a, b, 0.75);
    const quad = [
      { x: p0.x, y: p0.y - h },
      { x: p1.x, y: p1.y - h },
      p1,
      p0,
    ];

    const g = this.add.graphics().setDepth(worldDepth(cy)); // misma profundidad que su pared
    g.fillStyle(0x8b5a2b, 1);
    g.fillPoints(quad, true);
    g.lineStyle(1, 0x4a2f18, 1);
    g.strokePoints(quad, true);
    // Pomo
    const knob = lerp(p0, p1, 0.72);
    g.fillStyle(0xf1c40f, 1);
    g.fillCircle(knob.x, knob.y - h * 0.5, 2);
  }

  // ---------- Personalización ----------

  private buildCustomPanel(): void {
    const { x, y, w, h } = this.PANEL;
    const title = (tx: number, ty: number, label: string) =>
      this.add
        .text(tx, ty, label, {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#ffffff",
        })
        .setScrollFactor(0)
        .setDepth(LAYER.UI_PANEL + 1);

    const ui: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [];
    ui.push(
      this.add
        .rectangle(x + w / 2, y + h / 2, w, h, 0x12121a, 0.94)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_PANEL)
        .setStrokeStyle(1, 0x6d6d94, 1),
    );
    ui.push(title(x + 12, y + 10, "Personaliza tu look"));
    ui.push(title(x + 12, y + 40, "Ropa"));

    SHIRT_COLORS.forEach((c, i) => {
      const s = this.add
        .rectangle(x + 22 + i * 30, y + 68, 20, 20, c.value)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_PANEL + 1)
        .setStrokeStyle(1, 0x000000, 1)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.applyPalette({ ...this.palette, shirt: c.value }));
      this.shirtSwatches.push(s);
      ui.push(s);
    });

    ui.push(title(x + 12, y + 92, "Pelo"));
    HAIR_COLORS.forEach((c, i) => {
      const s = this.add
        .rectangle(x + 22 + i * 30, y + 120, 20, 20, c.value)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_PANEL + 1)
        .setStrokeStyle(1, 0x000000, 1)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.applyPalette({ ...this.palette, hair: c.value }));
      this.hairSwatches.push(s);
      ui.push(s);
    });

    ui.push(title(x + 12, y + 146, "(C para cerrar)"));

    this.customUI = ui;
    this.refreshSwatches();
    for (const o of ui) o.setVisible(false);
  }

  private toggleCustomPanel(): void {
    this.customOpen = !this.customOpen;
    for (const o of this.customUI) o.setVisible(this.customOpen);
    if (this.customOpen) this.refreshSwatches();
  }

  /** Regenera la textura con la nueva paleta y guarda */
  private applyPalette(next: Palette): void {
    this.palette = next;
    createAvatarTexture(this, next);

    // El sprite necesita reengancharse a la textura nueva
    const frame = this.avatar.sitting ? "sit-0" : `${this.avatar.facing}-0`;
    this.player.setTexture("avatar", frame);
    this.player.play(
      this.anim(this.avatar.sitting ? "idle-sit" : `idle-${this.avatar.facing}`),
      true,
    );

    this.refreshSwatches();
    this.saveGame();
    net.look(next); // los demás me ven con la ropa nueva
  }

  /** Nombre de animación del avatar LOCAL (prefijo `avatar:`) */
  private anim(name: string): string {
    return animKey("avatar", name);
  }

  /** Resalta con borde blanco el color seleccionado en cada fila */
  private refreshSwatches(): void {
    SHIRT_COLORS.forEach((c, i) => {
      const sel = c.value === this.palette.shirt;
      this.shirtSwatches[i]?.setStrokeStyle(sel ? 2 : 1, sel ? 0xffffff : 0x000000, 1);
    });
    HAIR_COLORS.forEach((c, i) => {
      const sel = c.value === this.palette.hair;
      this.hairSwatches[i]?.setStrokeStyle(sel ? 2 : 1, sel ? 0xffffff : 0x000000, 1);
    });
  }

  /** ¿El clic cayó sobre el panel? (coords de cámara = scrollFactor 0) */
  private isOverCustomUI(pointer: Phaser.Input.Pointer): boolean {
    if (!this.customOpen) return false;
    const { x, y, w, h } = this.PANEL;
    return (
      pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h
    );
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
      shirt: this.palette.shirt,
      hair: this.palette.hair,
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
    return "down";
  }

  // ---------- Chat ----------

  private openChat(): void {
    this.chatOpen = true;
    this.chatText = "";
    this.avatar.cancelPath();
    this.pendingDoor = null;
    this.chatBg.setVisible(true);
    this.chatLabel.setVisible(true);
    this.renderChatBar();
  }

  private closeChat(): void {
    this.chatOpen = false;
    this.chatText = "";
    this.chatBg.setVisible(false);
    this.chatLabel.setVisible(false);
  }

  private sendChat(): void {
    const msg = this.chatText.trim();
    this.closeChat();
    if (!msg) return;
    // Sin servidor la burbuja es sólo local; con servidor, el eco del server
    // la dibuja (así TODOS vemos lo mismo, incluido yo).
    if (net.isOnline) net.chat(msg);
    else this.showBubble("me", msg);
  }

  private renderChatBar(): void {
    this.chatLabel.setText(
      this.chatText
        ? `> ${this.chatText}▌`
        : "Escribe un mensaje... (Enter envía, Esc cancela)",
    );
  }

  /** Punto donde flota la burbuja de un avatar ("me" o un id de la sala) */
  private bubbleAnchor(ownerId: string): { x: number; y: number } | null {
    if (ownerId === "me") return { x: this.player.x, y: this.player.y - 54 };
    const peer = this.peers.get(ownerId);
    if (!peer) return null;
    return { x: peer.sprite.x, y: peer.sprite.y - 72 }; // hueco para su nombre
  }

  /** Las burbujas siguen a su avatar (o desaparecen si el avatar ya no está) */
  private moveBubbles(): void {
    for (const [id, bubble] of this.bubbles) {
      const at = this.bubbleAnchor(id);
      if (!at) {
        bubble.destroy();
        this.bubbles.delete(id);
      } else {
        bubble.setPosition(at.x, at.y);
      }
    }
  }

  /** Burbuja blanca sobre la cabeza que dura 4 segundos */
  private showBubble(ownerId: string, message: string): void {
    const at = this.bubbleAnchor(ownerId);
    if (!at) return;
    this.bubbles.get(ownerId)?.destroy();

    const txt = this.add
      .text(0, 0, message, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#1a1a24",
      })
      .setOrigin(0.5, 1);
    const bg = this.add
      .rectangle(0, -txt.height / 2 - 1, txt.width + 12, txt.height + 6, 0xffffff, 0.95)
      .setStrokeStyle(1, 0x1a1a24, 1);

    const container = this.add.container(at.x, at.y, [bg, txt]);
    container.setDepth(LAYER.WORLD_TOP);
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
        if (up) this.sendWhere();
      },
      onJoinError: (err) => {
        if (!this.alive) return;
        this.onJoinError(err);
      },
    });
    net.connect();
    this.netOnline = net.isOnline;
    this.netPlayers = net.roster;
    this.updateStatusHud();
  }

  /** Me presento al servidor (o aviso de que cambié de sala) */
  private sendWhere(): void {
    const save = loadSave();
    const nickname = save?.nickname ?? playerName();
    const where = {
      room: this.roomId,
      col: Math.round(this.avatar.col),
      row: Math.round(this.avatar.row),
      facing: this.avatar.facing,
    };
    if (net.isJoined) net.changeRoom(where);
    else net.join({ name: nickname, ...where, look: this.palette });
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
      this.pushLog(msg.text);
      return;
    }
    if (!msg.text) return;
    if (msg.from && msg.from !== net.id) {
      const view = this.netPlayers.find((p) => p.id === msg.from);
      if (!view || view.room !== this.roomId) return; // no está en mi sala
      this.showBubble(msg.from, msg.text);
    } else {
      this.showBubble("me", msg.text);
    }
  }

  /** Aviso del servidor en la esquina inferior (entró/salió), 3 líneas */
  private pushLog(text: string): void {
    this.logLines = [...this.logLines, text].slice(-3);
    this.logLabel.setText(this.logLines.join("\n"));
  }

  /** Contador de la sala en la barra de estado */
  private updateStatusHud(): void {
    if (!this.statusText) return;
    if (!this.netOnline) {
      this.statusText.setText("○ Sin servidor — single-player");
      this.statusText.setColor("#8a8aa8");
      return;
    }
    // "netPlayers" es el snapshot de la sala que manda el servidor y YA me
    // incluye a mí. El "1 +" que había aquí me sumaba una segunda vez: estando
    // solo, el HUD mostraba "2 en room1".
    const here = this.netPlayers.filter((p) => p.room === this.roomId).length;
    this.statusText.setText(`● En línea — ${here} en ${this.roomId}`);
    this.statusText.setColor("#7bed9f");
  }

  /** Error al unirse (nickname duplicado, etc.) */
  private onJoinError(err: JoinErrorPayload): void {
    if (err.code !== "DUPLICATE_NAME") return;

    // El texto de error pertenece al modal: si está cerrado hay que abrirlo
    // ANTES de intentar escribir en él.
    if (!this.loginModalOpen) this.showLoginModal();

    // Antes se buscaba el objeto por su contenido (`text === ""`), que casaba
    // con cualquier Text vacío del modal. Ahora es una referencia directa.
    const errorText = this.loginError;
    if (!errorText) return;
    errorText.setText(err.message);
    this.time.delayedCall(3000, () => {
      if (errorText.active) errorText.setText("");
    });
  }

  /** Botón "Perfil" en el HUD (esquina superior derecha) */
  private buildProfileButton(): void {
    const btn = this.add
      .rectangle(910, 20, 80, 28, 0x1a1a2e, 0.9)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_HUD)
      .setStrokeStyle(1, 0x6d6d94, 1)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => btn.setFillStyle(0x2a2a4e, 0.9))
      .on("pointerout", () => btn.setFillStyle(0x1a1a2e, 0.9))
      .on("pointerdown", () => this.showLoginModal(true));

    this.add
      .text(910, 20, "Perfil", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffe9a8",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_HUD + 1);

    // OJO: este botón NO va en `loginUI`. Ahí estaba antes, y como
    // `closeLoginModal` destruye todo lo que hay en esa lista, al cerrar el
    // perfil una vez el botón desaparecía y ya no se podía volver a abrir.
    // Vive lo que viva la escena; Phaser lo destruye en el SHUTDOWN.
  }

  /** Modal de login / edición de perfil */
  private showLoginModal(isEdit = false): void {
    // Ya abierto: no se apila otro encima. Antes, con isEdit, cada pulsación
    // del botón Perfil creaba un modal nuevo y dejaba el anterior huérfano
    // debajo (con su listener de teclado incluido).
    if (this.loginModalOpen) return;
    this.loginModalOpen = true;
    this.chatOpen = false;
    this.closeChat();
    // El panel de personalización se ocultaba a medias: se ponía `customOpen`
    // a false pero sus objetos seguían dibujados por encima del modal.
    if (this.customOpen) this.toggleCustomPanel();
    // Los selectores de color cambian `this.palette` en vivo para que la
    // preview los muestre; si se cancela hay que poder volver atrás.
    this.loginPaletteOnOpen = { ...this.palette };
    // El teclado del juego se apaga entero: si no, escribir una "c" en el
    // nickname abre el panel de personalización y un Enter abre el chat
    // DETRÁS del modal, y además el avatar camina con WASD mientras escribes.
    this.setGameKeyboard(false);

    const overlay = this.add
      // Velo OPACO a propósito. Translúcido, el mundo se veía al 14% fuera del
      // panel y al 4% detrás de él: un avatar que cruzara el borde del panel
      // cambiaba de brillo 3,5x de golpe y se leía como "cortado". Mientras el
      // panel sea más opaco que el velo eso es aritmética de alfas, no un
      // defecto que se pueda pulir; la única solución es no dejar ver el mundo.
      .rectangle(480, 270, 960, 540, 0x000000, 1)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL)
      .setInteractive();

    // Disposición en columna, medida siempre desde `panelY`, para que el panel
    // pueda cambiar de alto sin descuadrarse: la pantalla de entrada no lleva
    // botón Cancelar y por tanto es más baja.
    //
    // Antes el panel medía 380 y el Cancelar se colocaba en `panelH - 40 + 44`
    // = 384: se dibujaba FUERA del panel. La preview también se solapaba con
    // la fila de tonos de pelo.
    const panelW = 360;
    const panelH = isEdit ? 400 : 358;
    const panelX = 480 - panelW / 2;
    const panelY = 270 - panelH / 2;
    const colX = panelX + 24; // margen izquierdo del contenido

    const panel = this.add
      .rectangle(480, 270, panelW, panelH, 0x12121a, 0.96)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 1)
      .setStrokeStyle(2, 0x6d6d94, 1);

    const title = this.add
      .text(480, panelY + 26, isEdit ? "Editar perfil" : "Entrar a Roomie", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffe9a8",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2);

    // Input nickname (simulado con Text + eventos de teclado)
    const nicknameLabel = this.add
      .text(colX, panelY + 52, `Nickname (máx ${NAME_MAX}):`, {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#cccccc",
      })
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2);

    const save = loadSave();
    this.loginNick = save?.nickname ?? "";
    const nickBg = this.add
      .rectangle(colX, panelY + 72, panelW - 48, 34, 0x1a1a2e, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 1)
      .setStrokeStyle(1, 0x6d6d94, 1)
      .setInteractive({ useHandCursor: true });

    const nickText = this.add
      .text(colX + 8, panelY + 80, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2);
    /** El Text sólo DIBUJA; el valor vive en `this.loginNick` */
    const drawNick = (): void => {
      nickText.setText(this.loginNick + "▌");
    };
    drawNick();

    // Mensaje de error
    const errorText = this.add
      .text(480, panelY + 118, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ff6b6b",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2);
    this.loginError = errorText;

    // Vista previa del avatar.
    //
    // Ojo con la animación: `this.anim("idle-down")` devuelve "avatar:idle-down",
    // cuyos frames pertenecen a la textura del JUGADOR. Al reproducirla aquí, el
    // sprite se reenganchaba a esa textura e ignoraba la de la preview, así que
    // los colores elegidos no se veían. Hay que usar la animación de ESTA textura.
    createAvatarTexture(this, this.palette, PREVIEW_KEY);
    const preview = this.add
      .sprite(480, panelY + 170, PREVIEW_KEY, "down-0")
      .setOrigin(0.5)
      .setScale(3)
      .setDepth(LAYER.UI_MODAL + 2);
    preview.play(animKey(PREVIEW_KEY, "idle-down"), true);

    /**
     * Repinta la preview con la paleta actual.
     *
     * `createAvatarTexture` DESTRUYE y recrea textura y animaciones. Un sprite
     * que siguiera reproduciendo la animación vieja se quedaría con frames
     * muertos — es el mismo fallo que dejaba la pantalla en negro al cruzar una
     * puerta. Por eso se para la animación ANTES y se vuelve a lanzar después.
     */
    const redrawPreview = (): void => {
      preview.anims.stop();
      createAvatarTexture(this, this.palette, PREVIEW_KEY);
      preview.setTexture(PREVIEW_KEY, "down-0");
      preview.play(animKey(PREVIEW_KEY, "idle-down"), true);
    };

    // Selectores de color (reutilizamos la lógica del panel C)
    const shirtLabel = this.add
      .text(colX, panelY + 216, "Ropa:", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#cccccc",
      })
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2);

    const hairLabel = this.add
      .text(colX, panelY + 266, "Pelo:", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#cccccc",
      })
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2);

    const shirtSwatches: Phaser.GameObjects.Rectangle[] = [];
    const hairSwatches: Phaser.GameObjects.Rectangle[] = [];

    SHIRT_COLORS.forEach((c, i) => {
      const s = this.add
        .rectangle(colX + 10 + i * 32, panelY + 246, 20, 20, c.value)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_MODAL + 2)
        .setStrokeStyle(1, c.value === this.palette.shirt ? 0xffffff : 0x000000, 2)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          this.palette = { ...this.palette, shirt: c.value };
          this.refreshLoginSwatches(shirtSwatches, hairSwatches);
          redrawPreview();
        });
      shirtSwatches.push(s);
      this.loginUI.push(s);
    });

    HAIR_COLORS.forEach((c, i) => {
      const s = this.add
        .rectangle(colX + 10 + i * 32, panelY + 296, 20, 20, c.value)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_MODAL + 2)
        .setStrokeStyle(1, c.value === this.palette.hair ? 0xffffff : 0x000000, 2)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          this.palette = { ...this.palette, hair: c.value };
          this.refreshLoginSwatches(shirtSwatches, hairSwatches);
          redrawPreview();
        });
      hairSwatches.push(s);
      this.loginUI.push(s);
    });

    // Botones anclados al BORDE INFERIOR del panel, no a una altura fija.
    const cancelY = panelY + panelH - 28;
    const saveY = panelY + panelH - (isEdit ? 68 : 28);

    // Botón Guardar / Entrar
    const saveBtn = this.add
      .rectangle(480, saveY, 180, 36, 0x6c5ce7, 1)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 2)
      .setStrokeStyle(1, 0x8c7ce7, 1)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", () => saveBtn.setFillStyle(0x8c7ce7, 1))
      .on("pointerout", () => saveBtn.setFillStyle(0x6c5ce7, 1))
      .on("pointerdown", () => this.submitLogin(this.loginNick, isEdit));

    const saveLabel = this.add
      .text(480, saveY, isEdit ? "Guardar cambios" : "Entrar", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_MODAL + 3);

    // Botón Cancelar (solo en modo edición)
    let cancelBtn: Phaser.GameObjects.Rectangle | null = null;
    if (isEdit) {
      cancelBtn = this.add
        .rectangle(480, cancelY, 180, 30, 0x3a3a55, 1)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_MODAL + 2)
        .setStrokeStyle(1, 0x6d6d94, 1)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", () => cancelBtn?.setFillStyle(0x4a4a75, 1))
        .on("pointerout", () => cancelBtn?.setFillStyle(0x3a3a55, 1))
        .on("pointerdown", () => this.closeLoginModal());

      const cancelLabel = this.add
        .text(480, cancelY, "Cancelar", {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#cccccc",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(LAYER.UI_MODAL + 3);
      this.loginUI.push(cancelBtn, cancelLabel);
    }

    // Captura de teclado para el nickname
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!this.loginModalOpen) return;

      if (e.key === "Enter") {
        this.submitLogin(this.loginNick, isEdit);
        return;
      }
      if (e.key === "Escape") {
        this.closeLoginModal();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault(); // en algunos navegadores retrocede de página
        this.loginNick = this.loginNick.slice(0, -1);
        drawNick();
        return;
      }
      // Atajos del navegador (Ctrl+R, Cmd+L...): no son texto
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1 && this.loginNick.length < NAME_MAX) {
        this.loginNick += e.key;
        drawNick();
      }
    };
    // Sólo puede haber UN listener vivo: si quedara el de una apertura
    // anterior, cada tecla se escribiría dos veces y el borrado se comería
    // dos letras. Por eso se guarda la referencia y se quita al cerrar.
    this.loginKeys = onKeyDown;
    window.addEventListener("keydown", onKeyDown);

    // Guardar referencias para limpiar
    this.loginUI.push(
      overlay,
      panel,
      title,
      nicknameLabel,
      nickBg,
      nickText,
      errorText,
      preview,
      shirtLabel,
      hairLabel,
      saveBtn,
      saveLabel,
      ...shirtSwatches,
      ...hairSwatches
    );
  }

  private refreshLoginSwatches(
    shirts: Phaser.GameObjects.Rectangle[],
    hairs: Phaser.GameObjects.Rectangle[]
  ): void {
    shirts.forEach((s, i) => {
      const sel = SHIRT_COLORS[i].value === this.palette.shirt;
      s.setStrokeStyle(sel ? 2 : 1, sel ? 0xffffff : 0x000000, 2);
    });
    hairs.forEach((h, i) => {
      const sel = HAIR_COLORS[i].value === this.palette.hair;
      h.setStrokeStyle(sel ? 2 : 1, sel ? 0xffffff : 0x000000, 2);
    });
  }

  private submitLogin(nickname: string, isEdit: boolean): void {
    const clean = nickname
      .replace(/[^\p{L}\p{N} _\-.]/gu, "")
      .trim()
      .slice(0, 16);
    if (!clean) return;

    writeSave({
      room: this.roomId,
      col: Math.round(this.avatar.col),
      row: Math.round(this.avatar.row),
      facing: this.avatar.facing,
      shirt: this.palette.shirt,
      hair: this.palette.hair,
      nickname: clean,
    });

    // Actualizar textura local
    createAvatarTexture(this, this.palette);
    this.player.setTexture("avatar", `${this.avatar.facing}-0`);
    this.player.play(this.anim(`idle-${this.avatar.facing}`), true);

    // Los colores quedan confirmados: al cerrar ya no hay nada que descartar.
    this.loginPaletteOnOpen = null;
    this.closeLoginModal();

    if (isEdit) {
      // Cambiar nickname en el servidor
      net.look(this.palette);
      // Re-enviar join con nuevo nombre (el servidor validará duplicados)
      this.sendWhere();
    } else {
      // Primera vez: entrar al juego
      this.sendWhere();
    }
  }

  private closeLoginModal(): void {
    this.loginModalOpen = false;

    // Cerrar sin guardar descarta los colores que se estaban probando.
    if (this.loginPaletteOnOpen) {
      this.palette = this.loginPaletteOnOpen;
      this.loginPaletteOnOpen = null;
    }
    this.loginError = null;

    // Quitar SIEMPRE el listener: es lo que antes se acumulaba en cada
    // apertura (tres aperturas = cada tecla escrita tres veces).
    if (this.loginKeys) {
      window.removeEventListener("keydown", this.loginKeys);
      this.loginKeys = null;
    }

    for (const o of this.loginUI) {
      if (o.active) o.destroy();
    }
    this.loginUI = [];

    // La preview tiene textura y animaciones propias: si no se liberan, cada
    // apertura del perfil dejaba una textura y siete animaciones huérfanas.
    // Va DESPUÉS de destruir los sprites, nunca antes.
    destroyAvatarAssets(this, PREVIEW_KEY);

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
    createAvatarTexture(this, v.look, textureKey);
    const sprite = this.add
      .sprite(0, 0, textureKey, `${v.facing}-0`)
      .setOrigin(0.5, 1)
      .setScale(2);
    const label = this.add
      .text(0, 0, v.name, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffe9a8",
        stroke: "#12121a",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);

    const peer: Peer = {
      view: v,
      sprite,
      label,
      col: v.col,
      row: v.row,
      textureKey,
      look: { ...v.look },
    };
    this.peers.set(v.id, peer);
    return peer;
  }

  /** Borra un jugador remoto del mundo (y sus texturas) */
  private removePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.sprite.destroy();
    peer.label.destroy();
    this.bubbles.get(id)?.destroy();
    this.bubbles.delete(id);
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

      // Cambió la ropa/pelo del remoto → regenerar SU textura (no la mía)
      if (peer.look.shirt !== v.look.shirt || peer.look.hair !== v.look.hair) {
        peer.look = { ...v.look };
        createAvatarTexture(this, peer.look, peer.textureKey);
        peer.sprite.setTexture(peer.textureKey, `${peer.view.facing}-0`);
      }

      peer.col = v.col;
      peer.row = v.row;

      const p = peerScreen(peer.col, peer.row, v.sitting);
      peer.sprite.setPosition(p.x, p.y).setDepth(worldDepth(p.depth)).setFlipX(v.flip);
      // La animación la decide el SERVIDOR (`moving`/`facing`), que ya lo envía
      // en cada snapshot. Antes se deducía del desplazamiento en píxeles entre
      // frames: con un suavizado el delta nunca llega a cero exacto, así que el
      // remoto parpadeaba entre caminar y estar quieto.
      peer.sprite.play(
        animKey(
          peer.textureKey,
          v.sitting ? "idle-sit" : v.moving ? `walk-${v.facing}` : `idle-${v.facing}`,
        ),
        true,
      );
      peer.label.setPosition(p.x, p.y - 52).setDepth(worldDepth(p.depth) + 0.1);
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

    const dCol = self.col - this.avatar.col;
    const dRow = self.row - this.avatar.row;
    const drift = Math.hypot(dCol, dRow);

    if (drift <= CORRECTION_DEADZONE) return;

    // Divergencia real, no deriva: adoptar la posición autoritativa.
    if (drift > CORRECTION_TELEPORT) {
      this.avatar.col = self.col;
      this.avatar.row = self.row;
      this.avatar.cancelPath();
      this.pendingDoor = null;
      return;
    }

    // Arrastre exponencial, independiente del fps
    const k = 1 - Math.exp(-CORRECTION_RATE * dt);
    const col = this.avatar.col + dCol * k;
    const row = this.avatar.row + dRow * k;
    // El destino del servidor siempre es válido, pero el punto intermedio del
    // arrastre podría rozar una esquina bloqueada: el arrastre no salta muros.
    const c = Math.round(col);
    const r = Math.round(row);
    if (this.inBounds(c, r) && !this.blocked[r][c]) {
      this.avatar.col = col;
      this.avatar.row = row;
    }
  }

  /** Destello isométrico en la celda de destino */
  private showClickMarker(x: number, y: number): void {
    const marker = this.add
      .image(x, y, "tileset", 0)
      .setDepth(LAYER.WORLD_TOP)
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
          this.add.image(pos.x, pos.y, "tileset", gid - 1).setDepth(worldDepth(pos.y));
        }
        this.blocked[row][col] = (colsLayer?.data?.[i] ?? 0) !== 0;
      }
    }

    // Paredes traseras y luego mobiliario (la capa "objetos" de Tiled)
    this.buildWalls();

    const objs = data.layers.find((l) => l.name === "objetos");
    for (const o of objs?.objects ?? []) {
      const kind = (o.type || o.class) as FurnitureKind | "puerta" | undefined;
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
        this.drawDoor(col, row);
        continue; // el anillo de colisiones ya bloquea la celda
      }

      if (kind !== "sofa" && kind !== "mesa") continue;
      createFurniture(this, kind, col, row);
      this.blocked[row][col] = true;
      this.furniture.push({ kind, col, row });
    }
  }

  /**
   * Paredes isométricas sobre los dos bordes traseros (fila 0 y columna 0),
   * una pieza por celda con su propia profundidad.
   */
  private buildWalls(): void {
    const h = 48; // altura de pared en px
    for (let col = 0; col < this.cols; col++) {
      const { x, y } = toScreen(col, 0);
      this.paintWallFace(
        this.add.graphics().setDepth(worldDepth(y)),
        [
          { x, y: y - 16 - h }, // arriba-izq
          { x: x + 32, y: y - h }, // arriba-der
          { x: x + 32, y }, // abajo-der
          { x, y: y - 16 }, // abajo-izq
        ],
      );
    }
    for (let row = 0; row < this.rows; row++) {
      const { x, y } = toScreen(0, row);
      this.paintWallFace(
        this.add.graphics().setDepth(worldDepth(y)),
        [
          { x: x - 32, y: y - h },
          { x, y: y - 16 - h },
          { x, y: y - 16 },
          { x: x - 32, y },
        ],
      );
    }
  }

  /** Cara de pared + zócalo + remate superior. pts en orden horario desde arriba */
  private paintWallFace(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[]): void {
    const [p0, p1, p2, p3] = pts;
    g.fillStyle(0x6d6d94, 1);
    g.fillPoints(pts, true);
    g.lineStyle(1, 0x3a3a55, 1);
    g.strokePoints(pts, true);
    // Zócalo: franja oscura de 5px pegada al suelo
    g.fillStyle(0x4e4e70, 1);
    g.fillPoints(
      [p3, p2, { x: p2.x, y: p2.y - 5 }, { x: p3.x, y: p3.y - 5 }],
      true,
    );
    // Remate superior claro
    g.lineStyle(2, 0x9a9ad0, 1);
    g.lineBetween(p0.x, p0.y, p1.x, p1.y);
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
    const minY = Math.min(...ys) - 16;
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
