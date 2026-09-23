import Phaser from "phaser";
import { toScreen, toGrid } from "../utils/iso";
import { createAvatarTexture } from "../entities/avatar";

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

// Fase 2: sala desde JSON de Tiled + avatar placeholder con animaciones y colisiones.
export class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

  private blocked: boolean[][] = [];
  private cols = 0;
  private rows = 0;
  private facing: "down" | "up" | "side" = "down";

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
    const pos = toScreen(start.col, start.row);
    this.player = this.add
      .sprite(pos.x, pos.y, "avatar", "down-0")
      .setOrigin(0.5, 1)
      .setDepth(pos.y);
    this.player.play("idle-down");

    this.cameras.main.setBounds(...this.roomBounds());
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.add
      .text(8, 8, "Roomie — Fase 2\nWASD / flechas · sala room1", {
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
  }

  update(_time: number, delta: number): void {
    const speed = 150; // px/s en pantalla
    const dt = delta / 1000;
    let dx = 0;
    let dy = 0;

    if (this.cursors?.left.isDown || this.wasd?.A.isDown) dx -= 1;
    if (this.cursors?.right.isDown || this.wasd?.D.isDown) dx += 1;
    if (this.cursors?.up.isDown || this.wasd?.W.isDown) dy -= 1;
    if (this.cursors?.down.isDown || this.wasd?.S.isDown) dy += 1;

    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    // Ejepar por ejes por separado: así se desliza por el muro en vez de quedarse pegado
    if (dx !== 0) {
      const nx = this.player.x + dx * speed * dt;
      if (this.canStand(nx, this.player.y)) this.player.x = nx;
    }
    if (dy !== 0) {
      const ny = this.player.y + dy * speed * dt;
      if (this.canStand(this.player.x, ny)) this.player.y = ny;
    }

    this.player.setDepth(this.player.y); // orden isométrico

    // Dirección mirada: horizontal tiene prioridad
    const moving = dx !== 0 || dy !== 0;
    if (dx !== 0) {
      this.facing = "side";
      this.player.setFlipX(dx > 0); // el sprite "side" está dibujado mirando a la izquierda
    } else if (dy !== 0) {
      this.facing = dy < 0 ? "up" : "down";
      this.player.setFlipX(false);
    }
    this.player.play(moving ? `walk-${this.facing}` : `idle-${this.facing}`, true);
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

  /** ¿Puede el avatar estar con los pies en esta posición de pantalla? */
  private canStand(x: number, y: number): boolean {
    const g = toGrid(x, y);
    const col = Math.round(g.col);
    const row = Math.round(g.row);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
    return !this.blocked[row][col];
  }

  /** Celda libre más cercana al centro de la sala */
  private firstFreeCell(): { col: number; row: number } {
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
    return [minX, minY, maxX - minX, maxY - minY];
  }
}
