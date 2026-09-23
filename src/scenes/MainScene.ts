import Phaser from "phaser";
import { TILE_W, TILE_H, toScreen, toGrid } from "../utils/iso";
import { createAvatarTexture } from "../entities/avatar";
import { createFurniture, type FurnitureKind } from "../entities/furniture";
import { findPath, type Cell } from "../utils/pathfinding";

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

const KEYBOARD_SPEED = 150; // px/s en pantalla (WASD)
const PATH_SPEED = 4.5; // celdas/s (clic + A*)
const SIT_OFFSET = 10; // px que sube el avatar al sentarse
const SIT_SHIFT = 4; // px que se adelanta hacia la delantera del sofá

// Fase 4: sala desde Tiled + avatar, colisiones, clic con A*, sentarse en el
// sofá y burbuja de chat local (Enter para escribir).
export class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

  private blocked: boolean[][] = [];
  private cols = 0;
  private rows = 0;
  private facing: "down" | "up" | "side" = "down";
  private furniture: PlacedFurniture[] = [];

  // Sentarse
  private sitting: PlacedFurniture | null = null;
  private pendingSit: PlacedFurniture | null = null;

  // Chat
  private chatOpen = false;
  private chatText = "";
  private chatBg!: Phaser.GameObjects.Rectangle;
  private chatLabel!: Phaser.GameObjects.Text;
  private bubble: Phaser.GameObjects.Container | null = null;

  // Posición autoritativa del avatar en cuadrícula (valores continuos)
  private gc = 0;
  private gr = 0;
  private path: Cell[] = [];

  constructor() {
    super("main");
  }

  preload(): void {
    this.load.json("room1", "assets/room1.json");
    this.load.spritesheet("tileset", "assets/tileset.png", {
      frameWidth: 64,
      frameHeight: 32,
    });
  }

  create(): void {
    createAvatarTexture(this);
    this.buildRoom();

    const start = this.firstFreeCell();
    this.gc = start.col;
    this.gr = start.row;
    const pos = toScreen(this.gc, this.gr);
    this.player = this.add
      .sprite(pos.x, pos.y, "avatar", "down-0")
      .setOrigin(0.5, 1)
      .setDepth(pos.y);
    this.player.play("idle-down");

    this.cameras.main.setBounds(...this.roomBounds());
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.add
      .text(8, 8, "Roomie — Fase 4\nClic: caminar/sofá · WASD · Enter: chat", {
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

    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys("W,A,S,D") as MainScene["wasd"];

      kb.on("keydown", (e: { key?: string }) => {
        const key = e.key ?? "";
        if (!this.chatOpen) {
          if (key === "Enter") this.openChat();
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
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1); // tope por si la pestaña estuvo en segundo plano
    const old = { x: this.player.x, y: this.player.y };

    let dx = 0;
    let dy = 0;
    if (!this.chatOpen) {
      if (this.cursors?.left.isDown || this.wasd?.A.isDown) dx -= 1;
      if (this.cursors?.right.isDown || this.wasd?.D.isDown) dx += 1;
      if (this.cursors?.up.isDown || this.wasd?.W.isDown) dy -= 1;
      if (this.cursors?.down.isDown || this.wasd?.S.isDown) dy += 1;
    }

    // Una orden de movimiento levanta del sofá
    if (this.sitting && (dx !== 0 || dy !== 0)) this.sitting = null;
    if (this.sitting) {
      dx = 0;
      dy = 0;
      this.path = [];
      this.pendingSit = null;
    }

    if (dx !== 0 || dy !== 0) {
      // El teclado cancela el camino activado con clic
      this.path = [];
      this.pendingSit = null;
      if (dx !== 0 && dy !== 0) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }
      this.moveKeyboard(dx * KEYBOARD_SPEED * dt, dy * KEYBOARD_SPEED * dt);
    } else if (this.path.length > 0) {
      this.followPath(dt);
    }

    // Cuadrícula -> pantalla (con ajuste si está sentado)
    const base = toScreen(this.gc, this.gr);
    const p = this.sitting
      ? { x: base.x - SIT_SHIFT, y: base.y - SIT_OFFSET }
      : base;
    const moveX = p.x - old.x;
    const moveY = p.y - old.y;
    const moving = Math.abs(moveX) > 1e-6 || Math.abs(moveY) > 1e-6;

    if (this.sitting) {
      this.player.setFlipX(false);
      this.player.play("idle-sit", true);
    } else {
      if (moving) {
        if (Math.abs(moveX) > Math.abs(moveY)) {
          this.facing = "side";
          this.player.setFlipX(moveX > 0); // "side" está dibujado mirando a la izquierda
        } else {
          this.facing = moveY < 0 ? "up" : "down";
          this.player.setFlipX(false);
        }
      }
      this.player.play(moving ? `walk-${this.facing}` : `idle-${this.facing}`, true);
    }

    this.player.setPosition(p.x, p.y);
    this.player.setDepth(base.y); // orden isométrico

    // La burbuja de chat sigue al avatar
    if (this.bubble) this.bubble.setPosition(p.x, p.y - 30);
  }

  /**
   * Movimiento por teclado en dos pasos (eje X de pantalla y luego Y)
   * para deslizar por los muros en vez de quedarse pegado.
   * Fórmulas: col = x/TILE_W + y/TILE_H · row = y/TILE_H - x/TILE_W
   */
  private moveKeyboard(sx: number, sy: number): void {
    if (sx !== 0) {
      const col = this.gc + sx / TILE_W;
      const row = this.gr - sx / TILE_W;
      if (this.canStand(col, row)) {
        this.gc = col;
        this.gr = row;
      }
    }
    if (sy !== 0) {
      const col = this.gc + sy / TILE_H;
      const row = this.gr + sy / TILE_H;
      if (this.canStand(col, row)) {
        this.gc = col;
        this.gr = row;
      }
    }
  }

  /** Avanza por el camino A* a velocidad constante en unidades de celda */
  private followPath(dt: number): void {
    let move = PATH_SPEED * dt;
    while (move > 0 && this.path.length > 0) {
      const target = this.path[0];
      const dCol = target.col - this.gc;
      const dRow = target.row - this.gr;
      const segLen = Math.hypot(dCol, dRow);
      if (segLen < 1e-9) {
        this.path.shift();
        continue;
      }
      if (move >= segLen) {
        this.gc = target.col;
        this.gr = target.row;
        this.path.shift();
        move -= segLen;
      } else {
        this.gc += (dCol / segLen) * move;
        this.gr += (dRow / segLen) * move;
        move = 0;
      }
    }
    // Al llegar al final de un camino con destino "sofá": sentarse
    if (this.path.length === 0 && this.pendingSit) {
      this.sitting = this.pendingSit;
      this.pendingSit = null;
    }
  }

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    if (this.chatOpen) {
      this.closeChat(); // un clic en el mundo cierra el chat
      return;
    }

    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const g = toGrid(world.x, world.y);
    const goal: Cell = { col: Math.round(g.col), row: Math.round(g.row) };

    if (goal.col < 0 || goal.row < 0 || goal.col >= this.cols || goal.row >= this.rows) return;

    const furn = this.furnitureAt(goal.col, goal.row);
    const sitTarget = furn?.kind === "sofa" ? furn : null;
    if (!sitTarget && this.blocked[goal.row][goal.col]) return;

    const start: Cell = { col: Math.round(this.gc), row: Math.round(this.gr) };
    if (start.col === goal.col && start.row === goal.row) {
      this.path = [];
      this.pendingSit = null;
      if (this.sitting) this.sitting = null; // segundo clic en el sofá: levantarse
      return;
    }

    const path = findPath(
      start,
      goal,
      this.cols,
      this.rows,
      (c, r) => this.blocked[r][c],
      sitTarget !== null, // el sofá es meta válida aunque su celda esté bloqueada
    );
    if (!path || path.length === 0) return;

    this.sitting = null; // levantarse al empezar a caminar
    this.pendingSit = sitTarget;
    this.path = path;
    this.showClickMarker(world.x, world.y);
  }

  private furnitureAt(col: number, row: number): PlacedFurniture | undefined {
    return this.furniture.find((f) => f.col === col && f.row === row);
  }

  // ---------- Chat ----------

  private openChat(): void {
    this.chatOpen = true;
    this.chatText = "";
    this.path = [];
    this.pendingSit = null;
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

    const container = this.add.container(this.player.x, this.player.y - 30, [bg, txt]);
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
    const data = this.cache.json.get("room1") as TiledMap;
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
      const kind = (o.type || o.class) as FurnitureKind | undefined;
      const col = this.intProp(o.properties, "col");
      const row = this.intProp(o.properties, "row");
      if (kind !== "sofa" && kind !== "mesa") continue;
      if (col === undefined || row === undefined) continue;
      if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
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

  /** ¿Puede el avatar estar con los pies en esta celda (valores continuos)? */
  private canStand(col: number, row: number): boolean {
    const c = Math.round(col);
    const r = Math.round(row);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return !this.blocked[r][c];
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
    const minX = Math.min(...xs) - TILE_W / 2;
    const minY = Math.min(...ys) - TILE_H / 2;
    const maxX = Math.max(...xs) + TILE_W / 2;
    const maxY = Math.max(...ys) + TILE_H / 2;
    return [minX, minY, maxX - minX, maxY - minY];
  }
}
