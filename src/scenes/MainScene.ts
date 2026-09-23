import Phaser from "phaser";
import { TILE_W, TILE_H, toScreen, toGrid } from "../utils/iso";
import { createAvatarTexture } from "../entities/avatar";
import { findPath, type Cell } from "../utils/pathfinding";

type TiledLayer = {
  name: string;
  type: string;
  data?: number[];
  visible?: boolean;
};

type TiledMap = {
  width: number;
  height: number;
  layers: TiledLayer[];
};

const KEYBOARD_SPEED = 150; // px/s en pantalla (WASD)
const PATH_SPEED = 4.5; // celdas/s (clic + A*)

// Fase 2b: sala desde JSON de Tiled + avatar con animaciones, colisiones,
// movimiento con WASD y con clic (pathfinding A*).
export class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

  private blocked: boolean[][] = [];
  private cols = 0;
  private rows = 0;
  private facing: "down" | "up" | "side" = "down";

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
      .text(8, 8, "Roomie — Fase 2\nWASD / flechas o clic para caminar", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setScrollFactor(0);

    const kb = this.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.wasd = kb.addKeys("W,A,S,D") as MainScene["wasd"];
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button !== 0) return; // solo clic izquierdo
      this.handleWorldClick(pointer);
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1); // tope por si la pestaña estuvo en segundo plano
    const old = toScreen(this.gc, this.gr);

    let dx = 0;
    let dy = 0;
    if (this.cursors?.left.isDown || this.wasd?.A.isDown) dx -= 1;
    if (this.cursors?.right.isDown || this.wasd?.D.isDown) dx += 1;
    if (this.cursors?.up.isDown || this.wasd?.W.isDown) dy -= 1;
    if (this.cursors?.down.isDown || this.wasd?.S.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      // El teclado cancela el camino activado con clic
      this.path = [];
      if (dx !== 0 && dy !== 0) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }
      this.moveKeyboard(dx * KEYBOARD_SPEED * dt, dy * KEYBOARD_SPEED * dt);
    } else if (this.path.length > 0) {
      this.followPath(dt);
    }

    // Convertir cuadrícula -> pantalla y actualizarrender/animación
    const p = toScreen(this.gc, this.gr);
    const moveX = p.x - old.x;
    const moveY = p.y - old.y;
    const moving = Math.abs(moveX) > 1e-6 || Math.abs(moveY) > 1e-6;

    if (moving) {
      if (Math.abs(moveX) > Math.abs(moveY)) {
        this.facing = "side";
        this.player.setFlipX(moveX > 0); // "side" está dibujado mirando a la izquierda
      } else {
        this.facing = moveY < 0 ? "up" : "down";
        this.player.setFlipX(false);
      }
    }

    this.player.setPosition(p.x, p.y);
    this.player.setDepth(p.y); // orden isométrico
    this.player.play(moving ? `walk-${this.facing}` : `idle-${this.facing}`, true);
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
  }

  private handleWorldClick(pointer: Phaser.Input.Pointer): void {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const g = toGrid(world.x, world.y);
    const goal: Cell = { col: Math.round(g.col), row: Math.round(g.row) };

    if (goal.col < 0 || goal.row < 0 || goal.col >= this.cols || goal.row >= this.rows) return;
    if (this.blocked[goal.row][goal.col]) return;

    const start: Cell = { col: Math.round(this.gc), row: Math.round(this.gr) };
    if (start.col === goal.col && start.row === goal.row) {
      this.path = [];
      return;
    }

    const path = findPath(start, goal, this.cols, this.rows, (c, r) => this.blocked[r][c]);
    if (!path || path.length === 0) return;

    this.path = path;
    this.showClickMarker(world.x, world.y);
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
