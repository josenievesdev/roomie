// Capas de render del juego. ÚNICA fuente de verdad para `setDepth`.
//
// Phaser no tiene capas: sólo un número de profundidad por objeto y un orden
// de inserción para los empates. Sin una convención explícita, cada pantalla
// elige su número a ojo y acaba pasando lo que pasaba aquí: el modal se creó
// en 1e5 y el HUD en 1e6, así que el HUD (y las burbujas de chat de los
// avatares) se dibujaba POR ENCIMA del modal.
//
// Regla: NINGÚN `setDepth` del proyecto lleva un número suelto. O es una
// profundidad isométrica del mundo (la Y de pantalla, vía `worldDepth`), o es
// una de estas constantes.

export const LAYER = {
  /**
   * Mundo: suelo, paredes, muebles y avatares. La profundidad es la Y
   * isométrica, que se ordena sola: lo que está más abajo en pantalla tapa a
   * lo que está más arriba.
   *
   * Cota superior real: una sala de N×M celdas llega a (N+M-2)·16. Con las
   * salas actuales (12×12 y 14×10) el máximo es 352; incluso una sala de
   * 100×100 se quedaría en 3168. WORLD_MAX deja margen de sobra.
   */
  WORLD: 0,
  WORLD_MAX: 10_000,

  /**
   * Encima de TODO el mundo, pero todavía dentro de él: burbujas de chat y
   * marcador de destino. Van ancladas a una posición del mundo y deben tapar
   * paredes y muebles, pero nunca a la interfaz.
   */
  WORLD_TOP: 10_000,

  /** HUD permanente: título de sala, estado de conexión, avisos, botón Perfil */
  UI_HUD: 100_000,

  /** Paneles que tapan el HUD: barra de chat, panel de personalización */
  UI_PANEL: 200_000,

  /** Modal de entrada/perfil: se come todo lo anterior */
  UI_MODAL: 300_000,
} as const;

/**
 * Profundidad de un objeto del mundo a partir de su Y de pantalla.
 * Se limita a la banda del mundo para que un mapa enorme no pueda colarse
 * nunca por encima de la interfaz.
 */
export function worldDepth(screenY: number): number {
  return Math.min(screenY, LAYER.WORLD_MAX - 1);
}
