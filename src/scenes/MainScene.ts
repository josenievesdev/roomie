import Phaser from "phaser";
import { toScreen, toGrid } from "../utils/iso";
import { createAvatarTexture } from "../entities/avatar";
import { createFurniture, type FurnitureKind } from "../entities/furniture";
import { findPath, type Cell } from "../utils/pathfinding";
import { AvatarState, type Facing } from "../state/avatarState";
import {
  DEFAULT_PALETTE,
  HAIR_COLORS,
  SHIRT_COLORS,
  paletteFrom,
  type Palette,
} from "../state/palette";
import { loadSave, writeSave, type SaveData } from "../utils/storage";

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

const ROOMS = ["room1", "room2"] as const;
type RoomId = (typeof ROOMS)[number];

const KEYBOARD_SPEED = 150; // px/s en pantalla (WASD)
const SAVE_INTERVAL = 5000; // ms entre guardados automáticos

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
  private bubble: Phaser.GameObjects.Container | null = null;

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
    this.bubble = null;
    this.furniture = [];
    this.doors = [];
    this.pendingDoor = null;
    this.customUI = [];
    this.shirtSwatches = [];
    this.hairSwatches = [];

    const save = loadSave();
    this.palette = paletteFrom(save);

    createAvatarTexture(this, this.palette);
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
      .setDepth(p.depth);
    this.player.play(`idle-${this.avatar.facing}`);

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
      .setScrollFactor(0);

    // Barra de chat (interfaz fija en pantalla)
    this.chatBg = this.add
      .rectangle(480, 512, 420, 26, 0x000000, 0.65)
      .setScrollFactor(0)
      .setDepth(1e6)
      .setVisible(false);
    this.chatLabel = this.add
      .text(280, 512, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#ffffff",
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1e6 + 1)
      .setVisible(false);

    this.buildCustomPanel();

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
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1); // tope por si la pestaña estuvo en segundo plano
    const old = { x: this.player.x, y: this.player.y };

    // Entrada -> estado (el estado decide qué hacer)
    let dx = 0;
    let dy = 0;
    if (!this.chatOpen) {
      if (this.cursors?.left.isDown || this.wasd?.A.isDown) dx -= 1;
      if (this.cursors?.right.isDown || this.wasd?.D.isDown) dx += 1;
      if (this.cursors?.up.isDown || this.wasd?.W.isDown) dy -= 1;
      if (this.cursors?.down.isDown || this.wasd?.S.isDown) dy += 1;
    }

    if (dx !== 0 || dy !== 0) {
      this.pendingDoor = null; // moverse cancela el camino de la puerta
      if (dx !== 0 && dy !== 0) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }
      this.avatar.keyboardMove(dx * KEYBOARD_SPEED * dt, dy * KEYBOARD_SPEED * dt);
    } else {
      this.avatar.tick(dt);
    }

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
      this.player.play("idle-sit", true);
    } else {
      if (moving) this.avatar.updateFacing(moveX, moveY);
      this.player.play(
        moving ? `walk-${this.avatar.facing}` : `idle-${this.avatar.facing}`,
        true,
      );
    }
    this.player.setFlipX(this.avatar.flipX);

    this.player.setPosition(p.x, p.y);
    this.player.setDepth(p.depth); // orden isométrico

    // La burbuja de chat sigue al avatar (48px de alto con la escala x2)
    if (this.bubble) this.bubble.setPosition(p.x, p.y - 54);
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
      if (this.avatar.sitting) this.avatar.stand(); // segundo clic en el sofá: levantarse
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
      () => {
        this.scene.restart();
      },
    );
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

    const g = this.add.graphics().setDepth(cy); // misma profundidad que su pared
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
        .setDepth(1e6 + 3);

    const ui: Array<Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text> = [];
    ui.push(
      this.add
        .rectangle(x + w / 2, y + h / 2, w, h, 0x12121a, 0.94)
        .setScrollFactor(0)
        .setDepth(1e6 + 2)
        .setStrokeStyle(1, 0x6d6d94, 1),
    );
    ui.push(title(x + 12, y + 10, "Personaliza tu look"));
    ui.push(title(x + 12, y + 40, "Ropa"));

    SHIRT_COLORS.forEach((c, i) => {
      const s = this.add
        .rectangle(x + 22 + i * 30, y + 68, 20, 20, c.value)
        .setScrollFactor(0)
        .setDepth(1e6 + 3)
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
        .setDepth(1e6 + 3)
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
    this.player.play(this.avatar.sitting ? "idle-sit" : `idle-${this.avatar.facing}`, true);

    this.refreshSwatches();
    this.saveGame();
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
    writeSave({
      room: this.roomId,
      col: Math.round(this.avatar.col),
      row: Math.round(this.avatar.row),
      facing: this.avatar.facing,
      shirt: this.palette.shirt,
      hair: this.palette.hair,
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
    if (msg) this.showBubble(msg);
  }

  private renderChatBar(): void {
    this.chatLabel.setText(
      this.chatText
        ? `> ${this.chatText}▌`
        : "Escribe un mensaje... (Enter envía, Esc cancela)",
    );
  }

  /** Burbuja blanca sobre la cabeza que dura 4 segundos */
  private showBubble(message: string): void {
    this.bubble?.destroy();

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

    const container = this.add.container(this.player.x, this.player.y - 54, [bg, txt]);
    container.setDepth(1e6);
    container.setScale(0.4);
    this.bubble = container;

    this.tweens.add({ targets: container, scale: 1, duration: 220, ease: "Back.easeOut" });
    this.time.delayedCall(4000, () => {
      if (this.bubble !== container) return; // ya se sustituyó por otra
      this.tweens.add({
        targets: container,
        alpha: 0,
        duration: 250,
        onComplete: () => {
          if (this.bubble === container) this.bubble = null;
          container.destroy();
        },
      });
    });
  }

  /** Destello isométrico en la celda de destino */
  private showClickMarker(x: number, y: number): void {
    const marker = this.add
      .image(x, y, "tileset", 0)
      .setDepth(1e6)
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
          this.add.image(pos.x, pos.y, "tileset", gid - 1).setDepth(pos.y);
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
        this.add.graphics().setDepth(y),
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
        this.add.graphics().setDepth(y),
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
