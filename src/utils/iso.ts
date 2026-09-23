// Utilidades de proyección isométrica 2:1.
// El mundo se piensa en cuadrícula (col, row); la pantalla recibe rombos.
export const TILE_W = 64;
export const TILE_H = 32;

/** Cuadrícula -> posición en pantalla */
export function toScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

/** Posición en pantalla -> cuadrícula (valores continuos dentro de la celda) */
export function toGrid(x: number, y: number): { col: number; row: number } {
  const a = x / (TILE_W / 2);
  const b = y / (TILE_H / 2);
  return {
    col: (a + b) / 2,
    row: (b - a) / 2,
  };
}
