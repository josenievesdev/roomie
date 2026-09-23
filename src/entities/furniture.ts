import Phaser from "phaser";
import { toScreen } from "../utils/iso";

// Mobiliario dibujado con Graphics (placeholders isométricos 2:1).
// El origen de cada pieza es el centro de su celda; los pies quedan en y=0.
export type FurnitureKind = "sofa" | "mesa";

type Pt = { x: number; y: number };

function poly(g: Phaser.GameObjects.Graphics, pts: Pt[], color: number): void {
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
  g.lineStyle(1, 0x241a24, 0.9);
  g.strokePoints(pts, true);
}

/** Sofá mirando al sur-oeste (respaldar en el borde NE de la celda) */
function drawSofa(g: Phaser.GameObjects.Graphics): void {
  // Caras laterales del asiento (extruido 14px desde el rombo de la celda)
  poly(g, [
    { x: 32, y: -14 },
    { x: 0, y: 2 },
    { x: 0, y: 16 },
    { x: 32, y: 0 },
  ], 0xc05f42); // cara SE
  poly(g, [
    { x: -32, y: -14 },
    { x: 0, y: 2 },
    { x: 0, y: 16 },
    { x: -32, y: 0 },
  ], 0xa85038); // cara SW
  // Tapizado superior
  poly(g, [
    { x: 0, y: -30 },
    { x: 32, y: -14 },
    { x: 0, y: 2 },
    { x: -32, y: -14 },
  ], 0xe8896b);
  // Respaldo sobre el borde superior-derecho
  poly(g, [
    { x: 0, y: -46 },
    { x: 32, y: -30 },
    { x: 32, y: -14 },
    { x: 0, y: -30 },
  ], 0xe07a55);
}

/** Mesa auxiliar de madera (tablero a 16px con dos patas) */
function drawTable(g: Phaser.GameObjects.Graphics): void {
  // Patas (primero, el tablero tapa la unión)
  g.fillStyle(0x5b4632, 1);
  g.fillRect(-14, -6, 4, 14);
  g.fillRect(8, 2, 4, 10);
  // Caras del tablero
  poly(g, [
    { x: 32, y: -16 },
    { x: 0, y: 0 },
    { x: 0, y: 6 },
    { x: 32, y: -10 },
  ], 0x7a5b3c);
  poly(g, [
    { x: -32, y: -16 },
    { x: 0, y: 0 },
    { x: 0, y: 6 },
    { x: -32, y: -10 },
  ], 0x6b4f34);
  // Cara superior
  poly(g, [
    { x: 0, y: -32 },
    { x: 32, y: -16 },
    { x: 0, y: 0 },
    { x: -32, y: -16 },
  ], 0xa37c56);
}

/** Crea una pieza de mobiliario en la celda indicada (con orden isométrico) */
export function createFurniture(
  scene: Phaser.Scene,
  kind: FurnitureKind,
  col: number,
  row: number,
): Phaser.GameObjects.Graphics {
  const pos = toScreen(col, row);
  const g = scene.add.graphics().setDepth(pos.y);
  if (kind === "sofa") drawSofa(g);
  else drawTable(g);
  g.setPosition(pos.x, pos.y);
  return g;
}
