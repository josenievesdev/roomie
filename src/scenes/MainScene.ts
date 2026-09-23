import Phaser from "phaser";
import { TILE_W, TILE_H, toScreen, toGrid } from "../utils/iso";

// Fase 1 (proyección isométrica 2:1): piso de rombos, placeholder del avatar
// con orden por profundidad y límites de la sala.
// En Fase 2 el piso pasa a tilemap de Tiled y el placeholder a sprite animado.
export class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;

  private readonly room = 12; // sala de prueba 12x12 celdas

  constructor() {
    super("main");
  }

  create(): void {
    this.createDiamondTexture();
    this.drawFloor();

    // Placeholder del personaje (Fase 2: sprite con animaciones)
    const start = toScreen(2, 2);
    this.player = this.add
      .rectangle(start.x, start.y, 14, 26, 0x6c5ce7)
      .setOrigin(0.5, 1)
      .setDepth(start.y);

    this.cameras.main.setBounds(...this.roomBounds());
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.add
      .text(8, 8, "Roomie — Fase 1 isométrica\nWASD / flechas para mover", {
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

    // Normalizar diagonal para que no vaya más rápido
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    // Mover en pantalla y recuadrar a la cuadrícula para no salir de la sala
    const grid = toGrid(
      this.player.x + dx * speed * dt,
      this.player.y + dy * speed * dt,
    );
    const col = Phaser.Math.Clamp(grid.col, 0, this.room - 1);
    const row = Phaser.Math.Clamp(grid.row, 0, this.room - 1);
    const pos = toScreen(col, row);

    this.player.setPosition(pos.x, pos.y);
    this.player.setDepth(pos.y); // orden isométrico: lo más abajo se pinta encima
  }

  private createDiamondTexture(): void {
    const g = this.make.graphics({}, false);
    const pts = [
      { x: TILE_W / 2, y: 0 },
      { x: TILE_W, y: TILE_H / 2 },
      { x: TILE_W / 2, y: TILE_H },
      { x: 0, y: TILE_H / 2 },
    ];
    g.fillStyle(0xffffff, 1);
    g.fillPoints(pts, true);
    g.lineStyle(1, 0x000000, 0.35);
    g.strokePoints(pts, true);
    g.generateTexture("diamond", TILE_W, TILE_H);
    g.destroy();
  }

  private drawFloor(): void {
    for (let row = 0; row < this.room; row++) {
      for (let col = 0; col < this.room; col++) {
        const pos = toScreen(col, row);
        this.add
          .image(pos.x, pos.y, "diamond")
          .setTint((col + row) % 2 === 0 ? 0x3a3a52 : 0x31314a)
          .setDepth(pos.y);
      }
    }
  }

  /** Extremos exactos de la losa de diamantes para los límites de cámara */
  private roomBounds(): [number, number, number, number] {
    const last = this.room - 1;
    const corners = [
      toScreen(0, 0),
      toScreen(last, 0),
      toScreen(0, last),
      toScreen(last, last),
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
