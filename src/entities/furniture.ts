import Phaser from "phaser";
import { toScreen } from "../utils/iso";
import { worldDepth } from "../render/layers";
import type { FurniturePalette } from "../render/theme";

// Mobiliario isométrico. El origen de cada pieza es el centro de su celda y
// los pies quedan en y=0.
//
// Reglas de pixel art que sigue: tres tonos por volumen (cara superior
// iluminada, lateral este media, lateral oeste en sombra), contorno en un tono
// OSCURO DEL PROPIO COLOR —nunca negro, que convierte el mueble en un
// alambre— y detalles finos (costuras, vetas) para que no sean bloques planos.
// Los colores vienen del tema de la sala, así que el mismo sofá se ve distinto
// en cada una.
export type FurnitureKind = "sofa" | "mesa";

type Pt = { x: number; y: number };

/** Oscurece un color para el contorno de su propia cara */
function sombraDe(hex: number, f = 0.62): number {
  const r = Math.floor(((hex >> 16) & 0xff) * f);
  const g = Math.floor(((hex >> 8) & 0xff) * f);
  const b = Math.floor((hex & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

function poly(g: Phaser.GameObjects.Graphics, pts: Pt[], color: number): void {
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
  g.lineStyle(1, sombraDe(color), 0.85);
  g.strokePoints(pts, true);
}

/** Línea fina de detalle (costura, veta, brillo) */
function linea(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, color: number, alpha = 0.55): void {
  g.lineStyle(1, color, alpha);
  g.lineBetween(a.x, a.y, b.x, b.y);
}

/** Sombra elíptica en el suelo: ancla el mueble a la baldosa */
function sombra(g: Phaser.GameObjects.Graphics, rx: number, ry: number): void {
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(0, 4, rx, ry);
}

/** Mezcla hacia blanco, para los cantos iluminados */
function claro(hex: number, t = 0.3): number {
  const r = Math.round(((hex >> 16) & 0xff) + (255 - ((hex >> 16) & 0xff)) * t);
  const g = Math.round(((hex >> 8) & 0xff) + (255 - ((hex >> 8) & 0xff)) * t);
  const b = Math.round((hex & 0xff) + (255 - (hex & 0xff)) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Sofá mirando al sur-oeste. El rombo de la celda tiene sus vértices en
 * N(0,-16) E(32,0) S(0,16) O(-32,0); el asiento es ese mismo rombo extruido
 * 14 px hacia arriba, y encima van respaldo y reposabrazos.
 *
 * El orden es el del pintor, de atrás hacia delante: si el brazo delantero se
 * pintara antes que el asiento, el mueble se leería como una caja hueca.
 */
function drawSofa(g: Phaser.GameObjects.Graphics, c: FurniturePalette): void {
  sombra(g, 60, 20);

  // Vértices del asiento (rombo de la celda subido 14 px)
  const N = { x: 0, y: -30 };
  const E = { x: 32, y: -14 };
  const S = { x: 0, y: 2 };
  const O = { x: -32, y: -14 };
  const BRAZO = 7; // alto del reposabrazos

  // 1. Caras laterales del bloque del asiento
  poly(g, [O, S, { x: 0, y: 16 }, { x: -32, y: 0 }], c.sofaSideO); // suroeste, en sombra
  poly(g, [E, S, { x: 0, y: 16 }, { x: 32, y: 0 }], c.sofaSideE); // sureste

  // 2. Tapizado, con el cojín marcado hacia dentro
  poly(g, [N, E, S, O], c.sofaTop);
  const cojin = [
    { x: 0, y: -24 },
    { x: 21, y: -14 },
    { x: 0, y: -4 },
    { x: -21, y: -14 },
  ];
  poly(g, cojin, claro(c.sofaTop, 0.12));
  linea(g, { x: 0, y: -24 }, { x: 0, y: -4 }, c.sofaSeam, 0.5); // costura central

  // Reposabrazos y respaldo llevan CARA SUPERIOR además de la frontal: sin
  // ella son paredes de un píxel de grosor y el sofá se lee como una caja.
  const GROSOR = 7; // cuánto se mete la cara superior hacia el centro

  // 3. Reposabrazos noroeste (detrás, a la izquierda)
  poly(g, [{ x: -32, y: -14 - BRAZO }, { x: 0, y: -30 - BRAZO }, N, O], c.sofaSideE);
  poly(g, [
    { x: -32, y: -14 - BRAZO },
    { x: 0, y: -30 - BRAZO },
    { x: GROSOR, y: -30 - BRAZO + GROSOR / 2 },
    { x: -32 + GROSOR, y: -14 - BRAZO + GROSOR / 2 },
  ], claro(c.sofaSideE, 0.22));

  // 4. Respaldo sobre el borde noreste
  poly(g, [{ x: 0, y: -46 }, { x: 32, y: -30 }, E, N], c.sofaBack);
  poly(g, [
    { x: 0, y: -46 },
    { x: 32, y: -30 },
    { x: 32 - GROSOR, y: -30 + GROSOR / 2 },
    { x: -GROSOR, y: -46 + GROSOR / 2 },
  ], claro(c.sofaBack, 0.22));
  linea(g, { x: 11, y: -40 }, { x: 11, y: -28 }, c.sofaSeam, 0.4); // capitoné
  linea(g, { x: 21, y: -35 }, { x: 21, y: -23 }, c.sofaSeam, 0.4);

  // 5. Reposabrazos sureste (delante: el último, tapa lo que le toca)
  poly(g, [S, E, { x: 32, y: -14 - BRAZO }, { x: 0, y: 2 - BRAZO }], c.sofaBack);
  poly(g, [
    { x: 0, y: 2 - BRAZO },
    { x: 32, y: -14 - BRAZO },
    { x: 32 - GROSOR, y: -14 - BRAZO - GROSOR / 2 },
    { x: -GROSOR, y: 2 - BRAZO - GROSOR / 2 },
  ], claro(c.sofaBack, 0.22));
}

/** Mesa auxiliar (tablero a 16px con dos patas) */
function drawTable(g: Phaser.GameObjects.Graphics, c: FurniturePalette): void {
  sombra(g, 52, 18);

  // Patas (primero, el tablero tapa la unión)
  g.fillStyle(c.tableLeg, 1);
  g.fillRect(-14, -6, 4, 14);
  g.fillRect(8, 2, 4, 10);

  // Canto del tablero
  poly(g, [
    { x: 32, y: -16 },
    { x: 0, y: 0 },
    { x: 0, y: 6 },
    { x: 32, y: -10 },
  ], c.tableSideE);
  poly(g, [
    { x: -32, y: -16 },
    { x: 0, y: 0 },
    { x: 0, y: 6 },
    { x: -32, y: -10 },
  ], c.tableSideO);

  // Cara superior
  poly(g, [
    { x: 0, y: -32 },
    { x: 32, y: -16 },
    { x: 0, y: 0 },
    { x: -32, y: -16 },
  ], c.tableTop);
  // Vetas de la madera, paralelas al canto
  linea(g, { x: -16, y: -24 }, { x: 16, y: -8 }, c.tableSideE, 0.32);
  linea(g, { x: -16, y: -16 }, { x: 16, y: 0 }, c.tableSideE, 0.26);
  linea(g, { x: -8, y: -28 }, { x: 24, y: -12 }, c.tableSideE, 0.22);
  // Brillo del canto trasero
  linea(g, { x: -32, y: -16 }, { x: 0, y: -32 }, claro(c.tableTop, 0.3), 0.7);
}

/** Crea una pieza de mobiliario en la celda indicada (con orden isométrico) */
export function createFurniture(
  scene: Phaser.Scene,
  kind: FurnitureKind,
  col: number,
  row: number,
  palette: FurniturePalette,
): Phaser.GameObjects.Graphics {
  const pos = toScreen(col, row);
  // La profundidad pasa por worldDepth: la regla de la Fase 2.5 es que nada
  // del mundo pueda colarse en la banda de la interfaz, por grande que sea la sala.
  const g = scene.add.graphics().setDepth(worldDepth(pos.y));
  if (kind === "sofa") drawSofa(g, palette);
  else drawTable(g, palette);
  g.setPosition(pos.x, pos.y);
  return g;
}
