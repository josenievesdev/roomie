// Muebles generados en 3D: materiales, colores por tema y combinación.
// Módulo PURO (sin Phaser ni DOM): lo usan el navegador
// (`src/entities/furniture.ts`) y el generador (`tools/genmuebles.mjs`).
//
// Igual que el avatar, cada mueble se modela en 3D y se fotografía con la
// cámara del juego (`tools/muebles/modelos.mjs`). La imagen guarda material,
// luz y profundidad, no colores: el color lo pone la SALA con su tema. El
// mismo sofá sale coral en la plaza y violeta en el club, y un tema nuevo no
// obliga a redibujar ningún mueble.

import { mezcla, rampa, type Rampa } from "../utils/color.ts";
import { combinar, sombraElipse, type Capa } from "./capas.ts";
import type { RoomTheme } from "./theme.ts";

/**
 * Materiales de los muebles. Del 32 en adelante para no confundirse nunca con
 * los del avatar (`MAT` en `src/state/look.ts`).
 */
export const MAT_MUEBLE = {
  // --- Del tema de la sala ---
  TAPIZADO: 32,
  /** Botones y costuras: el tapizado, más oscuro */
  TAPIZADO_B: 33,
  MADERA: 34,
  /** Patas, vetas y cantos: la madera, más oscura */
  MADERA_OSC: 35,
  METAL: 36,
  ACENTO: 37,
  ALFOMBRA: 38,
  /** Dibujo y cenefa de la alfombra */
  ALFOMBRA_B: 39,
  /** Canto exterior de la alfombra */
  ALFOMBRA_OSC: 40,
  PLANTA: 41,
  /** Hojas más claras, para que la planta no sea una bola */
  PLANTA_B: 42,
  MACETA: 43,
  /** Lo que da luz: pantallas de lámpara, neón del tema */
  LUZ: 44,
  PUERTA_HOJA: 45,
  PUERTA_MARCO: 46,
  PUERTA_POMO: 47,
  // --- Fijos: el mismo color en cualquier sala ---
  TIERRA: 48,
  VIDRIO: 49,
  VIDRIO_BRILLO: 50,
  PAPEL: 51,
  OSCURO: 52,
  BLANCO: 53,
  LIBRO_1: 54,
  LIBRO_2: 55,
  LIBRO_3: 56,
  LIBRO_4: 57,
  CIELO: 58,
  HIERBA: 59,
  HIERBA_B: 60,
  SOL: 61,
  NEON_ROSA: 62,
  NOCHE: 63,
} as const;

const M = MAT_MUEBLE;

const FIJOS: Record<number, Rampa> = {
  [M.TIERRA]: rampa(0x6b4a32),
  [M.VIDRIO]: rampa(0xbfe0ee, { contraste: 0.6 }),
  [M.VIDRIO_BRILLO]: rampa(0xf2fbff, { contraste: 0.4 }),
  [M.PAPEL]: rampa(0xf1e8d2, { contraste: 0.7 }),
  [M.OSCURO]: rampa(0x3a3848),
  [M.BLANCO]: rampa(0xf2f0ea, { contraste: 0.7 }),
  [M.LIBRO_1]: rampa(0xc2473b),
  [M.LIBRO_2]: rampa(0x3f7ec9),
  [M.LIBRO_3]: rampa(0x4a9c5a),
  [M.LIBRO_4]: rampa(0xe0b04a),
  [M.CIELO]: rampa(0x86c5e8, { contraste: 0.6 }),
  [M.HIERBA]: rampa(0x6fae52),
  [M.HIERBA_B]: rampa(0x4c8a45),
  [M.SOL]: rampa(0xffd36b, { contraste: 0.5 }),
  [M.NEON_ROSA]: rampa(0xff6fb0, { contraste: 0.6 }),
  [M.NOCHE]: rampa(0x2c2450),
};

const cache = new WeakMap<RoomTheme, (mat: number) => Rampa>();

/**
 * Los tonos de cada material en una sala. Es la única función que convierte
 * "esto es tapizado" en un color de mueble.
 */
export function rampasDeTema(tema: RoomTheme): (mat: number) => Rampa {
  const hecha = cache.get(tema);
  if (hecha) return hecha;
  const p = tema.palette;
  const d = tema.door;
  const oscura = (c: number, t: number) => mezcla(c, 0x000000, t);
  const porMaterial: Record<number, Rampa> = {
    [M.TAPIZADO]: rampa(p.tapizado),
    [M.TAPIZADO_B]: rampa(oscura(p.tapizado, 0.3)),
    [M.MADERA]: rampa(p.madera),
    [M.MADERA_OSC]: rampa(oscura(p.madera, 0.35)),
    [M.METAL]: rampa(p.metal, { contraste: 1.2 }),
    [M.ACENTO]: rampa(p.acento),
    [M.ALFOMBRA]: rampa(p.alfombra, { contraste: 0.7 }),
    [M.ALFOMBRA_B]: rampa(mezcla(p.alfombra, p.acento, 0.45), { contraste: 0.7 }),
    [M.ALFOMBRA_OSC]: rampa(oscura(p.alfombra, 0.4), { contraste: 0.6 }),
    [M.PLANTA]: rampa(p.planta),
    [M.PLANTA_B]: rampa(mezcla(p.planta, 0xd8f0a0, 0.3)),
    [M.MACETA]: rampa(p.maceta),
    [M.LUZ]: rampa(mezcla(p.acento, 0xffffff, 0.55), { contraste: 0.5 }),
    [M.PUERTA_HOJA]: rampa(d.hoja),
    [M.PUERTA_MARCO]: rampa(d.marco),
    [M.PUERTA_POMO]: rampa(d.pomo, { contraste: 1.2 }),
  };
  const fn = (mat: number): Rampa => porMaterial[mat] ?? FIJOS[mat] ?? FIJOS[M.OSCURO];
  cache.set(tema, fn);
  return fn;
}

/** Una variante de mueble en el manifiesto (`public/assets/muebles/muebles.json`) */
export type EntradaMueble = {
  fichero: string;
  w: number;
  h: number;
  /** Píxel de la imagen que cae en el centro de la celda (el origen del sprite) */
  ax: number;
  ay: number;
  /** Sombra elíptica en el suelo, centrada en el ancla (null = sin sombra) */
  sombra: { rx: number; ry: number } | null;
  /** Contorno exterior (las alfombras no lo llevan: partiría la alfombra) */
  contorno: boolean;
};

export type ManifiestoMuebles = Record<string, EntradaMueble>;

/**
 * Nombre de una variante:
 *  - un mueble de suelo: `sofa`
 *  - uno de pared, según la pared: `cuadro-izq` (columna 0) o `cuadro-der` (fila 0)
 *  - una celda de alfombra, según qué lados son borde: `alfombra-5`
 */
export const variante = (tipo: string, sufijo?: string | number): string =>
  sufijo === undefined ? tipo : `${tipo}-${sufijo}`;

/** Colorea una variante con los tonos de una sala. RGBA del tamaño de la entrada. */
export function componerMueble(capa: Capa, e: EntradaMueble, tema: RoomTheme): Uint8ClampedArray {
  const out = combinar([capa], rampasDeTema(tema), { x: 0, y: 0, w: e.w, h: e.h }, { contorno: e.contorno });
  if (e.sombra) sombraElipse(out, e.w, e.h, e.ax, e.ay, e.sombra.rx, e.sombra.ry);
  return out;
}
