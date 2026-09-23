// A* sobre la cuadrícula isométrica (8 direcciones, coste octile).
export type Cell = { col: number; row: number };

const SQRT2 = Math.SQRT2;

/** Heurística octile: distancia en rejilla 8-dir */
function heuristic(a: Cell, b: Cell): number {
  const dx = Math.abs(a.col - b.col);
  const dy = Math.abs(a.row - b.row);
  return dx + dy - (2 - SQRT2) * Math.min(dx, dy);
}

/** Min-heap trivial sobre índices de celda */
class MinHeap {
  private items: { f: number; idx: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: { f: number; idx: number }): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].f <= this.items[i].f) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): { f: number; idx: number } {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < this.items.length && this.items[left].f < this.items[smallest].f) smallest = left;
        if (right < this.items.length && this.items[right].f < this.items[smallest].f) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Devuelve el camino de celdas desde `start` hasta `goal` (sin incluir `start`).
 * `null` si no hay camino. Cortar esquinas entre dos celdas bloqueadas no está permitido.
 */
export function findPath(
  start: Cell,
  goal: Cell,
  cols: number,
  rows: number,
  isBlocked: (col: number, row: number) => boolean,
  allowBlockedGoal = false,
): Cell[] | null {
  if (
    goal.col < 0 || goal.row < 0 || goal.col >= cols || goal.row >= rows
  ) {
    return null;
  }
  if (isBlocked(goal.col, goal.row) && !allowBlockedGoal) return null;

  const total = cols * rows;
  const gScore = new Float64Array(total).fill(Infinity);
  const from = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const startIdx = start.row * cols + start.col;
  const goalIdx = goal.row * cols + goal.col;

  gScore[startIdx] = 0;
  const open = new MinHeap();
  open.push({ f: heuristic(start, goal), idx: startIdx });

  while (open.size > 0) {
    const { idx } = open.pop();
    if (closed[idx]) continue;
    closed[idx] = 1;
    if (idx === goalIdx) {
      const path: Cell[] = [];
      let cur = idx;
      while (cur !== startIdx) {
        path.push({ col: cur % cols, row: Math.floor(cur / cols) });
        cur = from[cur];
        if (cur < 0) return null; // no debería pasar
      }
      path.reverse();
      return path;
    }

    const col = idx % cols;
    const row = Math.floor(idx / cols);

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (isBlocked(nc, nr) && !(allowBlockedGoal && nc === goal.col && nr === goal.row)) continue;
        // Sin cortar esquinas: los dos vecinos ortogonales deben estar libres
        if (dc !== 0 && dr !== 0 && (isBlocked(col + dc, row) || isBlocked(col, row + dr))) {
          continue;
        }

        const cost = dc !== 0 && dr !== 0 ? SQRT2 : 1;
        const tentative = gScore[idx] + cost;
        const nIdx = nr * cols + nc;
        if (tentative < gScore[nIdx]) {
          gScore[nIdx] = tentative;
          from[nIdx] = idx;
          open.push({ f: tentative + heuristic({ col: nc, row: nr }, goal), idx: nIdx });
        }
      }
    }
  }

  return null;
}
