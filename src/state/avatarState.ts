import { TILE_W, TILE_H, toScreen } from "../utils/iso.ts";
import type { Cell } from "../utils/pathfinding";

// Estado autoritativo del avatar. Módulo PURO (sin Phaser): solo depende de
// las utilidades isométricas. Diseñado para que un servidor pueda ejecutarlo
// en el futuro (multijugador) sin tocar el render.

/**
 * Hacia dónde mira un avatar: 8 direcciones de PANTALLA en sentido horario,
 * 0 = norte (arriba), 2 = este, 4 = sur (de cara a la cámara), 6 = oeste.
 * Los caminos del A* van por los ejes de la rejilla, que en pantalla son las
 * diagonales (1, 3, 5, 7); el teclado va por los ejes de pantalla.
 *
 * Antes eran tres ("down", "up", "side" + espejo): de lado se reflejaba el
 * dibujo y la luz cambiaba de lado con él. Ahora cada dirección tiene su
 * propio dibujo, con la luz siempre en el mismo sitio.
 */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FACING_SUR: Facing = 4;

export function isFacing(v: unknown): v is Facing {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 7;
}

/** Dirección más cercana a un desplazamiento en píxeles de pantalla */
export function facingDesde(dx: number, dy: number): Facing {
  // Ángulo en sentido horario desde "arriba" (y de pantalla crece hacia abajo)
  const a = Math.atan2(dx, -dy);
  return (((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8) as Facing;
}

/**
 * Altura (px de pantalla) a la que el avatar sentado apoya el trasero en su
 * propio dibujo: la del asiento del sofá. Un asiento más alto (taburete)
 * sube el sprite la diferencia.
 */
export const ASIENTO_MODELO = 14;

/** Sentarse en una celda: el asiento dice su altura y hacia dónde se mira */
export type SitTarget = { col: number; row: number; alto: number; dir: Facing };

/** Cuánto sube el sprite de alguien sentado en un asiento de esa altura */
export const subidaSentado = (alto: number): number => alto - ASIENTO_MODELO;

/** Contexto del mundo que rodea al avatar */
export interface World {
  cols: number;
  rows: number;
  isBlocked(col: number, row: number): boolean;
  /**
   * ¿Hay OTRO avatar plantado (quieto o sentado) en esa celda? Lo aporta
   * quien conoce a los demás: el servidor con su lista de jugadores, el
   * cliente con el último snapshot. Sin él, nadie ocupa sitio.
   */
  isOccupied?(col: number, row: number): boolean;
  /**
   * ¿Es una puerta? Las puertas están bloqueadas para andar por encima, pero
   * el teclado puede entrar en ellas (y quien conoce la sala, cruzar).
   */
  isDoor?(col: number, row: number): boolean;
  /**
   * El asiento de una celda, si lo hay. El teclado puede entrar en un asiento
   * libre, y al entrar se sienta, igual que al terminar un camino en él.
   */
  seatAt?(col: number, row: number): SitTarget | null;
}

export const PATH_SPEED = 3; // celdas/s (clic + A*)

/**
 * Profundidad isométrica de un avatar. La usan el avatar propio y los
 * remotos: si cada uno tuviera su fórmula, dos jugadores juntos se
 * ordenarían distinto según quién mire.
 *
 * La base sale de la celda que CONTIENE los pies (redondeo), nunca de la
 * posición fraccionaria: si no, al parar a mitad de celda (teclas o clic que
 * cancela el camino) el suelo de la celda contenedora se dibuja encima del
 * cuerpo y solo asoma la cabeza.
 *
 * +0.5 deja el avatar SIEMPRE por encima del suelo (+0), las alfombras
 * (+0.25) y el mueble de su propia celda, y por debajo de la fila de delante
 * (+16). Dentro de esa franja, hasta +0.4 más según lo adelantado que esté en
 * la celda: dos avatares en la misma celda ya no empatan (antes el orden lo
 * decidía la inserción y uno tapaba al otro aunque estuviera detrás).
 */
export function avatarDepth(col: number, row: number): number {
  const cell = toScreen(Math.round(col), Math.round(row));
  const offset = toScreen(col, row).y - cell.y; // -TILE_H/2 .. +TILE_H/2
  const t = Math.min(Math.max(offset / TILE_H + 0.5, 0), 1);
  return cell.y + 0.5 + t * 0.4;
}

export class AvatarState {
  col: number;
  row: number;
  facing: Facing;
  path: Cell[] = [];
  sitting: SitTarget | null = null;
  private pendingSit: SitTarget | null = null;
  /**
   * Dirección de teclado con la que se entró sentándose en un asiento, hasta
   * que se suelta. Sin esto, la misma tecla que te sienta te levantaría en el
   * frame siguiente y sentarse con el teclado sería imposible.
   */
  private sentadoCon: { x: number; y: number } | null = null;
  private world: World;

  constructor(world: World, start: Cell, facing: Facing = FACING_SUR) {
    this.world = world;
    this.col = start.col;
    this.row = start.row;
    this.facing = facing;
  }

  /**
   * Orden de teclado en px de pantalla. Devuelve true si hubo orden.
   *
   * Entrar con el teclado en un asiento libre sienta, como llegar a él con un
   * camino; y se sigue sentado mientras no se suelte o cambie la tecla. En
   * una puerta se puede entrar: cruzarla lo decide quien conoce la sala.
   */
  keyboardMove(sx: number, sy: number): boolean {
    if (sx === 0 && sy === 0) return false;
    const dir = { x: Math.sign(sx), y: Math.sign(sy) };
    if (this.sitting) {
      const s = this.sentadoCon;
      if (s && s.x === dir.x && s.y === dir.y) return true;
      this.stand();
    }
    this.cancelPath();

    // Dos pasos por ejes de pantalla para deslizar por los muros
    if (sx !== 0 && this.pasoTeclado(this.col + sx / TILE_W, this.row - sx / TILE_W, dir)) return true;
    if (sy !== 0) this.pasoTeclado(this.col + sy / TILE_H, this.row + sy / TILE_H, dir);
    return true;
  }

  /**
   * Un paso de teclado hasta (col, row), si se puede pisar. Si el paso entra
   * en un asiento, se sienta en él y devuelve true (ya no se sigue andando).
   */
  private pasoTeclado(col: number, row: number, dir: { x: number; y: number }): boolean {
    if (!this.puedeEntrar(col, row)) return false;
    const antes = { col: Math.round(this.col), row: Math.round(this.row) };
    this.col = col;
    this.row = row;
    const c = Math.round(col);
    const r = Math.round(row);
    if (c === antes.col && r === antes.row) return false;
    const seat = this.world.seatAt?.(c, r);
    if (!seat) return false;
    this.sitAt(seat);
    this.sentadoCon = dir;
    return true;
  }

  /** Inicia un camino (con destino "sofá" si `sit` no es null) */
  startPath(path: Cell[], sit: SitTarget | null = null): void {
    this.stand(); // levantarse al empezar a caminar
    this.path = path.slice();
    this.pendingSit = sit;
  }

  cancelPath(): void {
    this.path = [];
    this.pendingSit = null;
  }

  stand(): void {
    this.sitting = null;
    this.sentadoCon = null;
  }

  /**
   * Avanza por el camino. Devuelve true si hubo movimiento este frame. Se
   * llama cuando NO hay teclas: por eso aquí se da por soltada la tecla con
   * la que alguien se sentó.
   */
  tick(dt: number): boolean {
    this.sentadoCon = null;
    if (this.sitting || this.path.length === 0) return false;
    let move = PATH_SPEED * dt;
    let moved = false;
    while (move > 0 && this.path.length > 0) {
      this.skipPassed();
      // Dentro del bucle y no antes: en un mismo paso se puede llegar a la
      // penúltima celda y seguir hacia la última con lo que sobra.
      this.yieldIfTaken();
      if (this.path.length === 0) break;
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
    // Al terminar un camino con destino "sofá": sentarse, mirando hacia
    // donde mira el asiento
    if (this.path.length === 0 && this.pendingSit) {
      this.sitting = this.pendingSit;
      this.facing = this.pendingSit.dir;
      this.pendingSit = null;
    }
    return moved;
  }

  /** Sentarse ya, sin caminar (lo usa el cliente para acatar al servidor) */
  sitAt(seat: SitTarget): void {
    this.cancelPath();
    this.col = seat.col;
    this.row = seat.row;
    this.sitting = seat;
    this.facing = seat.dir;
  }

  /**
   * Descarta los puntos del camino que ya quedaron atrás: los que el avatar
   * ha rebasado en la dirección del siguiente tramo.
   *
   * Andando sólo se llega a un punto pisándolo, pero la corrección del
   * cliente (que arrastra hacia la posición del servidor) puede llevar al
   * avatar MÁS ALLÁ del punto al que iba. Sin esto, el avatar seguía andando
   * hacia ese punto, ya detrás, mientras la corrección tiraba hacia delante:
   * los dos empataban y el avatar se quedaba clavado a media celda del
   * servidor, con el camino sin gastar.
   */
  private skipPassed(): void {
    while (this.path.length >= 2) {
      const a = this.path[0];
      const b = this.path[1];
      const pasado = (this.col - a.col) * (b.col - a.col) + (this.row - a.row) * (b.row - a.row);
      if (pasado <= 0) return;
      this.path.shift();
    }
  }

  /**
   * Si la celda FINAL del camino la ha ocupado otro avatar mientras llegaba,
   * se renuncia a ella en vez de acabar uno encima del otro: se vuelve al
   * centro de la celda en la que ya está y se olvida el asiento.
   *
   * Sólo se mira en el último tramo y antes de cruzar su mitad: más atrás es
   * pronto (quien está ahí puede irse) y pasada la mitad ya se está dentro.
   * Cliente y servidor ejecutan esta misma regla, cada uno con lo que sabe
   * de los demás, así que casi siempre coinciden sin hablar entre ellos.
   */
  private yieldIfTaken(): void {
    if (this.path.length !== 1 || !this.world.isOccupied) return;
    const goal = this.path[0];
    const here = { col: Math.round(this.col), row: Math.round(this.row) };
    if (here.col === goal.col && here.row === goal.row) return;
    if (!this.world.isOccupied(goal.col, goal.row)) return;
    this.pendingSit = null;
    const centered = Math.abs(this.col - here.col) < 1e-9 && Math.abs(this.row - here.row) < 1e-9;
    this.path = centered ? [] : [here];
  }

  /** Posición de render (con ajuste si está sentado) y profundidad isométrica */
  screen(): { x: number; y: number; depth: number } {
    const base = toScreen(this.col, this.row);
    const depth = avatarDepth(this.col, this.row);
    if (this.sitting) {
      return { x: base.x, y: base.y - subidaSentado(this.sitting.alto), depth };
    }
    return { x: base.x, y: base.y, depth };
  }

  /** Orientación según el desplazamiento de pantalla de este frame */
  updateFacing(moveX: number, moveY: number): void {
    this.facing = facingDesde(moveX, moveY);
  }

  /**
   * ¿Puede el teclado llevar los pies hasta ahí? Celdas libres, puertas y
   * asientos que nadie ocupa. Y moverse dentro de la celda en la que ya se
   * está vale siempre: si no, quien está sentado en un sofá (celda
   * bloqueada) no podría levantarse andando.
   */
  private puedeEntrar(col: number, row: number): boolean {
    const c = Math.round(col);
    const r = Math.round(row);
    if (c < 0 || r < 0 || c >= this.world.cols || r >= this.world.rows) return false;
    if (c === Math.round(this.col) && r === Math.round(this.row)) return true;
    if (!this.world.isBlocked(c, r)) return true;
    if (this.world.isDoor?.(c, r)) return true;
    return !!this.world.seatAt?.(c, r) && !this.world.isOccupied?.(c, r);
  }
}
