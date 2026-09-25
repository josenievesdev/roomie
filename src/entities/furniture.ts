import Phaser from "phaser";
import { toScreen } from "../utils/iso";
import { worldDepth } from "../render/layers";
import type { RoomPalette } from "../render/theme";
import { FURNITURE, type FurnitureKind } from "../state/furniture-catalog";

// Mobiliario isométrico. El origen de cada pieza es el centro de su celda y
// los pies quedan en y=0. El rombo de la celda tiene sus vértices en
// N(0,-16) E(32,0) S(0,16) O(-32,0).
//
// Reglas de pixel art que sigue todo lo de aquí:
//  - Tres tonos por volumen: cara superior iluminada, lateral este media,
//    lateral oeste en sombra. La luz entra siempre por arriba a la izquierda.
//  - Contorno en un tono OSCURO DEL PROPIO COLOR, nunca negro: el negro
//    convierte los muebles en alambres.
//  - Detalles finos (costuras, vetas, brillos) para que no sean bloques planos.
//  - Sombra elíptica en el suelo, que ancla la pieza a la baldosa.
//
// Los tonos intermedios se derivan del color base del tema, así que un mueble
// nuevo no obliga a inventar seis colores por sala.

type Pt = { x: number; y: number };

/** Oscurece un color (para caras en sombra y contornos) */
function osc(hex: number, f: number): number {
  const r = Math.floor(((hex >> 16) & 0xff) * f);
  const g = Math.floor(((hex >> 8) & 0xff) * f);
  const b = Math.floor((hex & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Mezcla hacia blanco (para cantos iluminados) */
function clr(hex: number, t: number): number {
  const r = Math.round(((hex >> 16) & 0xff) + (255 - ((hex >> 16) & 0xff)) * t);
  const g = Math.round(((hex >> 8) & 0xff) + (255 - ((hex >> 8) & 0xff)) * t);
  const b = Math.round((hex & 0xff) + (255 - (hex & 0xff)) * t);
  return (r << 16) | (g << 8) | b;
}

function poly(g: Phaser.GameObjects.Graphics, pts: Pt[], color: number): void {
  g.fillStyle(color, 1);
  g.fillPoints(pts, true);
  g.lineStyle(1, osc(color, 0.62), 0.85);
  g.strokePoints(pts, true);
}

function linea(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, color: number, alpha = 0.55): void {
  g.lineStyle(1, color, alpha);
  g.lineBetween(a.x, a.y, b.x, b.y);
}

function sombra(g: Phaser.GameObjects.Graphics, rx: number, ry: number): void {
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(0, 4, rx, ry);
}

/** Rombo de la celda, subido `alto` px */
function rombo(alto: number): [Pt, Pt, Pt, Pt] {
  return [
    { x: 0, y: -16 - alto },
    { x: 32, y: -alto },
    { x: 0, y: 16 - alto },
    { x: -32, y: -alto },
  ];
}

/**
 * Bloque isométrico: el rombo de la celda extruido `alto` px, con sus dos
 * caras visibles. Es la base de casi todo el mobiliario.
 */
function bloque(
  g: Phaser.GameObjects.Graphics,
  alto: number,
  color: number,
  escala = 1,
): [Pt, Pt, Pt, Pt] {
  const s = escala;
  const N = { x: 0, y: (-16 - alto) * 1 };
  const E = { x: 32 * s, y: -alto };
  const S = { x: 0, y: 16 * s - alto };
  const O = { x: -32 * s, y: -alto };
  const Eb = { x: 32 * s, y: 0 };
  const Sb = { x: 0, y: 16 * s };
  const Ob = { x: -32 * s, y: 0 };
  const Ns = { x: 0, y: -16 * s - alto };

  poly(g, [O, S, Sb, Ob], osc(color, 0.66)); // cara suroeste, en sombra
  poly(g, [E, S, Sb, Eb], osc(color, 0.8)); // cara sureste
  poly(g, [Ns, E, S, O], color); // cara superior
  linea(g, Ob, Ns, clr(color, 0.3), 0.6); // canto iluminado
  return [Ns, E, S, O];
}

// ---------- Piezas ----------

/** Sofá mirando al sur-oeste (respaldo en el borde noreste) */
function drawSofa(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  const c = p.tapizado;
  sombra(g, 60, 20);

  const N = { x: 0, y: -30 };
  const E = { x: 32, y: -14 };
  const S = { x: 0, y: 2 };
  const O = { x: -32, y: -14 };
  const BRAZO = 7;
  const GROSOR = 7; // fondo de la cara superior de brazos y respaldo

  poly(g, [O, S, { x: 0, y: 16 }, { x: -32, y: 0 }], osc(c, 0.66));
  poly(g, [E, S, { x: 0, y: 16 }, { x: 32, y: 0 }], osc(c, 0.8));

  poly(g, [N, E, S, O], c);
  poly(g, [
    { x: 0, y: -24 },
    { x: 21, y: -14 },
    { x: 0, y: -4 },
    { x: -21, y: -14 },
  ], clr(c, 0.12)); // cojín hundido
  linea(g, { x: 0, y: -24 }, { x: 0, y: -4 }, osc(c, 0.5), 0.5);

  // Reposabrazos noroeste
  poly(g, [{ x: -32, y: -14 - BRAZO }, { x: 0, y: -30 - BRAZO }, N, O], osc(c, 0.8));
  poly(g, [
    { x: -32, y: -14 - BRAZO },
    { x: 0, y: -30 - BRAZO },
    { x: GROSOR, y: -30 - BRAZO + GROSOR / 2 },
    { x: -32 + GROSOR, y: -14 - BRAZO + GROSOR / 2 },
  ], clr(osc(c, 0.8), 0.22));

  // Respaldo
  poly(g, [{ x: 0, y: -46 }, { x: 32, y: -30 }, E, N], clr(c, 0.1));
  poly(g, [
    { x: 0, y: -46 },
    { x: 32, y: -30 },
    { x: 32 - GROSOR, y: -30 + GROSOR / 2 },
    { x: -GROSOR, y: -46 + GROSOR / 2 },
  ], clr(c, 0.3));
  linea(g, { x: 11, y: -40 }, { x: 11, y: -28 }, osc(c, 0.5), 0.4);
  linea(g, { x: 21, y: -35 }, { x: 21, y: -23 }, osc(c, 0.5), 0.4);

  // Reposabrazos sureste (delante: el último)
  poly(g, [S, E, { x: 32, y: -14 - BRAZO }, { x: 0, y: 2 - BRAZO }], clr(c, 0.1));
  poly(g, [
    { x: 0, y: 2 - BRAZO },
    { x: 32, y: -14 - BRAZO },
    { x: 32 - GROSOR, y: -14 - BRAZO - GROSOR / 2 },
    { x: -GROSOR, y: 2 - BRAZO - GROSOR / 2 },
  ], clr(c, 0.3));
}

/** Mesa auxiliar (tablero a 16px con dos patas) */
function drawTable(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  const c = p.madera;
  sombra(g, 52, 18);

  g.fillStyle(osc(c, 0.5), 1);
  g.fillRect(-14, -6, 4, 14);
  g.fillRect(8, 2, 4, 10);

  poly(g, [{ x: 32, y: -16 }, { x: 0, y: 0 }, { x: 0, y: 6 }, { x: 32, y: -10 }], osc(c, 0.78));
  poly(g, [{ x: -32, y: -16 }, { x: 0, y: 0 }, { x: 0, y: 6 }, { x: -32, y: -10 }], osc(c, 0.66));
  poly(g, [{ x: 0, y: -32 }, { x: 32, y: -16 }, { x: 0, y: 0 }, { x: -32, y: -16 }], c);

  linea(g, { x: -16, y: -24 }, { x: 16, y: -8 }, osc(c, 0.75), 0.32);
  linea(g, { x: -16, y: -16 }, { x: 16, y: 0 }, osc(c, 0.75), 0.26);
  linea(g, { x: -8, y: -28 }, { x: 24, y: -12 }, osc(c, 0.75), 0.22);
  linea(g, { x: -32, y: -16 }, { x: 0, y: -32 }, clr(c, 0.3), 0.7);
}

/** Barra / mostrador: bloque alto con encimera que vuela y franja de acento */
function drawCounter(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  const c = p.madera;
  sombra(g, 58, 20);

  bloque(g, 26, osc(c, 0.85));

  // Franja de acento como BANDA, no como línea de 1 px: a tamaño de juego una
  // línea suelta desaparece y la barra queda como una caja de madera.
  poly(g, [
    { x: -32, y: -18 },
    { x: 0, y: -2 },
    { x: 0, y: 3 },
    { x: -32, y: -13 },
  ], p.acento);
  poly(g, [
    { x: 32, y: -18 },
    { x: 0, y: -2 },
    { x: 0, y: 3 },
    { x: 32, y: -13 },
  ], osc(p.acento, 0.82));

  // Encimera: rombo algo mayor y bastante más claro, para que sobresalga
  poly(g, [
    { x: 0, y: -48 },
    { x: 35, y: -30 },
    { x: 0, y: -12 },
    { x: -35, y: -30 },
  ], clr(c, 0.3));
  linea(g, { x: -35, y: -30 }, { x: 0, y: -48 }, clr(c, 0.55), 0.9); // canto iluminado
}

/**
 * Taburete de barra: base, poste y asiento con grosor.
 *
 * Va dibujado con polígonos y no con un poste fino: a tamaño de juego, y
 * medio tapado por la barra de al lado, un palo de 6 px desaparecía y el
 * taburete se leía como un charco de color en el suelo.
 */
function drawStool(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  sombra(g, 28, 11);

  const poste = osc(p.metal, 0.5);

  // Base: disco isométrico
  poly(g, [
    { x: -13, y: -2 },
    { x: 0, y: -7 },
    { x: 13, y: -2 },
    { x: 0, y: 3 },
  ], poste);

  // Poste, ancho y en dos tonos para que tenga cilindro
  poly(g, [{ x: -5, y: -26 }, { x: 0, y: -28 }, { x: 0, y: -2 }, { x: -5, y: -4 }], clr(poste, 0.28));
  poly(g, [{ x: 0, y: -28 }, { x: 5, y: -26 }, { x: 5, y: -4 }, { x: 0, y: -2 }], osc(poste, 0.75));

  // Reposapiés
  g.lineStyle(2, clr(p.metal, 0.15), 0.95);
  g.strokeEllipse(0, -9, 22, 9);

  // Asiento: canto + tapa
  g.fillStyle(osc(p.tapizado, 0.55), 1);
  g.fillEllipse(0, -26, 32, 14);
  g.fillStyle(p.tapizado, 1);
  g.fillEllipse(0, -30, 32, 14);
  g.lineStyle(1, clr(p.tapizado, 0.35), 0.9);
  g.strokeEllipse(0, -30, 32, 14);
}

/** Planta en maceta */
function drawPlant(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  sombra(g, 30, 12);
  // Maceta troncocónica
  poly(g, [
    { x: -11, y: -14 },
    { x: 11, y: -14 },
    { x: 8, y: 2 },
    { x: -8, y: 2 },
  ], p.maceta);
  poly(g, [
    { x: -12, y: -16 },
    { x: 12, y: -16 },
    { x: 11, y: -12 },
    { x: -11, y: -12 },
  ], clr(p.maceta, 0.2)); // reborde
  // Follaje: manchas superpuestas, de la sombra a la luz
  const hojas: [number, number, number, number][] = [
    [-9, -24, 16, 14],
    [9, -26, 16, 14],
    [0, -34, 18, 16],
    [-5, -30, 12, 11],
    [6, -32, 12, 11],
  ];
  hojas.forEach(([x, y, w, h], i) => {
    g.fillStyle(i < 2 ? osc(p.planta, 0.7) : i < 4 ? p.planta : clr(p.planta, 0.18), 1);
    g.fillEllipse(x, y, w, h);
  });
  // Nervios
  linea(g, { x: 0, y: -18 }, { x: 0, y: -32 }, osc(p.planta, 0.55), 0.5);
}

/** Lámpara de pie con pantalla */
function drawLamp(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  sombra(g, 24, 9);
  // Base
  poly(g, [
    { x: -10, y: -3 },
    { x: 0, y: -7 },
    { x: 10, y: -3 },
    { x: 0, y: 1 },
  ], osc(p.metal, 0.7));
  // Poste
  g.fillStyle(p.metal, 1);
  g.fillRect(-1, -42, 2, 38);
  // Pantalla
  poly(g, [
    { x: -13, y: -42 },
    { x: 13, y: -42 },
    { x: 9, y: -58 },
    { x: -9, y: -58 },
  ], clr(p.acento, 0.25));
  linea(g, { x: -13, y: -42 }, { x: 13, y: -42 }, clr(p.acento, 0.55), 0.9);
  // Luz que derrama
  g.fillStyle(p.acento, 0.14);
  g.fillEllipse(0, -34, 44, 18);
}

/** Altavoz de columna */
function drawSpeaker(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  sombra(g, 34, 13);
  const c = osc(p.metal, 0.55);
  // Caja
  poly(g, [{ x: -14, y: -44 }, { x: 0, y: -50 }, { x: 14, y: -44 }, { x: 0, y: -38 }], clr(c, 0.25));
  poly(g, [{ x: -14, y: -44 }, { x: 0, y: -38 }, { x: 0, y: 2 }, { x: -14, y: -4 }], osc(c, 0.7));
  poly(g, [{ x: 14, y: -44 }, { x: 0, y: -38 }, { x: 0, y: 2 }, { x: 14, y: -4 }], c);
  // Conos
  for (const [cy, r] of [[-30, 7], [-14, 5]] as const) {
    g.fillStyle(osc(c, 0.5), 1);
    g.fillEllipse(7, cy, r * 2, r * 2.2);
    g.fillStyle(p.acento, 0.85);
    g.fillEllipse(7, cy, r, r * 1.1);
  }
  linea(g, { x: 14, y: -44 }, { x: 14, y: -4 }, clr(c, 0.3), 0.6);
}

/** Alfombra / pista de baile: plana, NO estorba, se pisa */
function drawRug(g: Phaser.GameObjects.Graphics, p: RoomPalette): void {
  const c = p.alfombra;
  // Un pelín más pequeña que la celda, para que se vea la junta del suelo
  poly(g, [
    { x: 0, y: -15 },
    { x: 30, y: 0 },
    { x: 0, y: 15 },
    { x: -30, y: 0 },
  ], c);
  poly(g, [
    { x: 0, y: -9 },
    { x: 18, y: 0 },
    { x: 0, y: 9 },
    { x: -18, y: 0 },
  ], clr(c, 0.16));
  linea(g, { x: 0, y: -15 }, { x: 30, y: 0 }, clr(c, 0.32), 0.6);
  linea(g, { x: -30, y: 0 }, { x: 0, y: -15 }, clr(c, 0.32), 0.6);
}

const DIBUJOS: Record<FurnitureKind, (g: Phaser.GameObjects.Graphics, p: RoomPalette) => void> = {
  sofa: drawSofa,
  mesa: drawTable,
  barra: drawCounter,
  taburete: drawStool,
  planta: drawPlant,
  lampara: drawLamp,
  altavoz: drawSpeaker,
  alfombra: drawRug,
};

/** Crea una pieza de mobiliario en la celda indicada (con orden isométrico) */
export function createFurniture(
  scene: Phaser.Scene,
  kind: FurnitureKind,
  col: number,
  row: number,
  palette: RoomPalette,
): Phaser.GameObjects.Graphics | null {
  const dibujar = DIBUJOS[kind];
  if (!dibujar) return null;

  const pos = toScreen(col, row);
  // La profundidad pasa por worldDepth: nada del mundo puede colarse en la
  // banda de la interfaz, por grande que sea la sala (regla de la Fase 2.5).
  //
  // Lo que se pisa (alfombras) va ENTRE el suelo y el avatar: la baldosa está
  // en `worldDepth(y)` y el avatar en `worldDepth(y) + 0.5`, así que +0.25 lo
  // deja encima del suelo y debajo de quien lo pisa. Restar en vez de sumar lo
  // metía por debajo de la baldosa y la alfombra no se veía.
  const z = worldDepth(pos.y) + (FURNITURE[kind].blocks ? 0 : 0.25);
  const g = scene.add.graphics().setDepth(z);
  dibujar(g, palette);
  g.setPosition(pos.x, pos.y);
  return g;
}

export type { FurnitureKind };
