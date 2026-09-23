import { TILE_W, TILE_H, toScreen } from "../utils/iso.ts";
import type { Cell } from "../utils/pathfinding";

// Estado autoritativo del avatar. Módulo PURO (sin Phaser): solo depende de
// las utilidades isométricas. Diseñado para que un servidor pueda ejecutarlo
// en el futuro (multijugador) sin tocar el render.
export type Facing = "down" | "up" | "side";
export type SitTarget = { col: number; row: number };

/** Contexto del mundo que rodea al avatar */
export interface World {
  cols: number;
  rows: number;
  isBlocked(col: number, row: number): boolean;
}

export const PATH_SPEED = 3; // celdas/s (clic + A*); con walk a 12fps las patas van sincronizadas
export const SIT_OFFSET = 10; // px que sube el avatar al sentarse
export const SIT_SHIFT = 4; // px que se adelanta hacia la delantera del sofá

export class AvatarState {
  col: number;
  row: number;
  facing: Facing;
  path: Cell[] = [];
  sitting: SitTarget | null = null;
  private pendingSit: SitTarget | null = null;
  private faceRight = false;
  private world: World;

  constructor(world: World, start: Cell, facing: Facing = "down") {
    this.world = world;
    this.col = start.col;
    this.row = start.row;
    this.facing = facing;
  }

  /** Orden de teclado en px de pantalla. Devuelve true si hubo orden. */
  keyboardMove(sx: number, sy: number): boolean {
    if (sx === 0 && sy === 0) return false;
    if (this.sitting) this.stand();
    this.cancelPath();

    // Dos pasos por ejes de pantalla para deslizar por los muros
    if (sx !== 0) {
      const col = this.col + sx / TILE_W;
      const row = this.row - sx / TILE_W;
      if (this.canStand(col, row)) {
        this.col = col;
        this.row = row;
      }
    }
    if (sy !== 0) {
      const col = this.col + sy / TILE_H;
      const row = this.row + sy / TILE_H;
      if (this.canStand(col, row)) {
        this.col = col;
        this.row = row;
      }
    }
    return true;
  }

  /** Inicia un camino (con destino "sofá" si `sit` no es null) */
  startPath(path: Cell[], sit: SitTarget | null = null): void {
    this.sitting = null; // levantarse al empezar a caminar
    this.path = path.slice();
    this.pendingSit = sit;
  }

  cancelPath(): void {
    this.path = [];
    this.pendingSit = null;
  }

  stand(): void {
    this.sitting = null;
  }

  /** Avanza por el camino. Devuelve true si hubo movimiento este frame. */
  tick(dt: number): boolean {
    if (this.sitting || this.path.length === 0) return false;
    let move = PATH_SPEED * dt;
    let moved = false;
    while (move > 0 && this.path.length > 0) {
      const target = this.path[0];
      const dCol = target.col - this.col;
      const dRow = target.row - this.row;
      const segLen = Math.hypot(dCol, dRow);
      if (segLen < 1e-9) {
        this.path.shift();
        continue;
      }
      moved = true;
      if (move >= segLen) {
        this.col = target.col;
        this.row = target.row;
        this.path.shift();
        move -= segLen;
      } else {
        this.col += (dCol / segLen) * move;
        this.row += (dRow / segLen) * move;
        move = 0;
      }
    }
    // Al terminar un camino con destino "sofá": sentarse
    if (this.path.length === 0 && this.pendingSit) {
      this.sitting = this.pendingSit;
      this.pendingSit = null;
    }
    return moved;
  }

  /** Posición de render (con ajuste si está sentado) y profundidad isométrica */
  screen(): { x: number; y: number; depth: number } {
    const base = toScreen(this.col, this.row);
    // La profundidad sale de la celda que CONTIENE los pies (redondeo), nunca
    // de la posición fraccionaria: si no, al parar a mitad de celda (teclas o
    // clic que cancela el camino) el suelo de la celda contenedora se dibuja
    // encima del cuerpo y solo asoma la cabeza. Empates con el suelo de esa
    // celda los gana el sprite por orden de inserción.
    const cell = toScreen(Math.round(this.col), Math.round(this.row));
    // +0.5 de sesgo: el sprite queda SIEMPRE por encima del suelo y del
    // mobiliario de su misma celda (empates exactos los perderían si algo
    // reordena la lista), pero por debajo de lo que está al frente (+16).
    const depth = cell.y + 0.5;
    if (this.sitting) {
      return { x: base.x - SIT_SHIFT, y: base.y - SIT_OFFSET, depth };
    }
    return { x: base.x, y: base.y, depth };
  }

  /** Orientación según el desplazamiento de pantalla de este frame */
  updateFacing(moveX: number, moveY: number): void {
    if (Math.abs(moveX) > Math.abs(moveY)) {
      this.facing = "side";
      this.faceRight = moveX > 0; // "side" está dibujado mirando a la izquierda
    } else {
      this.facing = moveY < 0 ? "up" : "down";
      this.faceRight = false;
    }
  }

  get flipX(): boolean {
    return this.sitting ? false : this.faceRight;
  }

  private canStand(col: number, row: number): boolean {
    const c = Math.round(col);
    const r = Math.round(row);
    if (c < 0 || r < 0 || c >= this.world.cols || r >= this.world.rows) return false;
    return !this.world.isBlocked(c, r);
  }
}
