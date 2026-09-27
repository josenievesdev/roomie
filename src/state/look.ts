// Catálogo del aspecto del avatar. Módulo PURO (sin Phaser): lo importan el
// navegador (para combinar y colorear), el SERVIDOR (para validar lo que
// llega) y el generador `tools/genavatar.mjs` (para saber qué dibujar).
//
// Igual que con el mobiliario, una sola lista: si cada lado tuviera la suya,
// el servidor aceptaría estilos que el navegador no sabe pintar.
//
// Para añadir una prenda: un estilo aquí + su forma en `tools/avatar/model.mjs`
// + `node tools/genavatar.mjs`. Para añadir un color: una línea aquí; las
// cinco tonalidades salen solas de `rampa()`.

import { distanciaColor, mezcla, rampa, type Rampa } from "../utils/color.ts";

// ---------------------------------------------------------------- Materiales
//
// El generador no pinta colores: escribe en cada píxel QUÉ es (piel, pelo,
// torso...) y con qué luz. El color lo pone el navegador según el aspecto de
// cada jugador, así que una misma capa sirve para todos los colores.

export const MAT = {
  VACIO: 0,
  PIEL: 1,
  PELO: 2,
  TORSO: 3,
  /** Detalle claro fijo: la camiseta bajo la chaqueta, los cordones */
  TORSO_B: 4,
  PIERNAS: 5,
  PIES: 6,
  /** Suela y puntera de las zapatillas */
  SUELA: 7,
  OJO: 8,
  BRILLO_OJO: 9,
  BOCA: 10,
  /** Cejas: del color del pelo, en su tono más oscuro */
  CEJA: 11,
} as const;

export type Material = (typeof MAT)[keyof typeof MAT];

// ---------------------------------------------------------------- Estilos

export const ESTILOS = {
  pelo: {
    corto: "Corto",
    largo: "Melena",
    coleta: "Coleta",
    mono: "Moño",
    afro: "Afro",
    rapado: "Rapado",
  },
  torso: {
    camiseta: "Camiseta",
    mangalarga: "Manga larga",
    tirantes: "Tirantes",
    sudadera: "Sudadera",
    chaqueta: "Chaqueta",
  },
  piernas: {
    pantalon: "Pantalón",
    corto: "Pantalón corto",
    falda: "Falda",
  },
  pies: {
    zapatillas: "Zapatillas",
    botas: "Botas",
  },
} as const;

export type Parte = keyof typeof ESTILOS;
export type EstiloPelo = keyof typeof ESTILOS.pelo;
export type EstiloTorso = keyof typeof ESTILOS.torso;
export type EstiloPiernas = keyof typeof ESTILOS.piernas;
export type EstiloPies = keyof typeof ESTILOS.pies;

export const PARTES: readonly Parte[] = ["pelo", "torso", "piernas", "pies"];

// ---------------------------------------------------------------- Colores
//
// Cada color es el tono "de catálogo" (el que se ve con luz). Las sombras,
// los brillos y el contorno salen de `rampa()`, con la misma regla para todo.

export const PIELES = {
  p1: 0xffe3cc,
  p2: 0xf6c9a2,
  p3: 0xe3a878,
  p4: 0xc68552,
  p5: 0x9b5d38,
  p6: 0x6e4029,
} as const;

export const COLORES_PELO = {
  negro: 0x3a3342,
  castano_oscuro: 0x5a3b2a,
  castano: 0x8a5632,
  rubio: 0xecc66f,
  pelirrojo: 0xd0582c,
  platino: 0xeee8da,
  gris: 0xa3a3b2,
  azul: 0x4a86e0,
  rosa: 0xf07ab4,
  verde: 0x3fb383,
  morado: 0x9460e0,
} as const;

export const COLORES_ROPA = {
  blanco: 0xf1f1f5,
  gris: 0x9a9db0,
  negro: 0x46404f,
  rojo: 0xe24b40,
  naranja: 0xf39237,
  amarillo: 0xf5cf55,
  verde: 0x44ad62,
  menta: 0x62d6b4,
  azul: 0x3f86e0,
  vaquero: 0x55749e,
  marino: 0x39488a,
  morado: 0x7f62e6,
  rosa: 0xf285b5,
  marron: 0x93603d,
  beige: 0xdcc6a0,
} as const;

export type TonoPiel = keyof typeof PIELES;
export type ColorPelo = keyof typeof COLORES_PELO;
export type ColorRopa = keyof typeof COLORES_ROPA;

// ---------------------------------------------------------------- Aspecto

/**
 * Cómo se ve un avatar. Plano a propósito: se guarda en la base (jsonb), viaja
 * en cada snapshot y se valida campo a campo.
 */
export type Look = {
  piel: TonoPiel;
  pelo: EstiloPelo;
  peloColor: ColorPelo;
  torso: EstiloTorso;
  torsoColor: ColorRopa;
  piernas: EstiloPiernas;
  piernasColor: ColorRopa;
  pies: EstiloPies;
  piesColor: ColorRopa;
};

export const DEFAULT_LOOK: Look = {
  piel: "p2",
  pelo: "corto",
  peloColor: "castano",
  torso: "camiseta",
  torsoColor: "morado",
  piernas: "pantalon",
  piernasColor: "vaquero",
  pies: "zapatillas",
  piesColor: "blanco",
};

const esClave = <T extends object>(obj: T, v: unknown): v is keyof T =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(obj, v);

/** El color del catálogo más parecido a un hex suelto (paletas viejas) */
function masParecido<T extends Record<string, number>>(catalogo: T, hex: number): keyof T {
  let mejor = Object.keys(catalogo)[0] as keyof T;
  let dMin = Infinity;
  for (const [id, valor] of Object.entries(catalogo)) {
    const d = distanciaColor(valor, hex);
    if (d < dMin) {
      dMin = d;
      mejor = id as keyof T;
    }
  }
  return mejor;
}

/**
 * Aspecto válido a partir de CUALQUIER cosa: lo que llega por la red, lo que
 * hay en la base o en el navegador. Lo que no se reconoce vuelve al valor por
 * defecto, campo a campo.
 *
 * Acepta también el formato anterior `{ shirt, hair }` (dos colores sueltos):
 * así las cuentas de antes conservan sus colores al pasar al avatar nuevo.
 */
export function sanitizeLook(v: unknown): Look {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const look: Look = { ...DEFAULT_LOOK };

  if (typeof o.shirt === "number" && Number.isFinite(o.shirt)) {
    look.torsoColor = masParecido(COLORES_ROPA, o.shirt);
  }
  if (typeof o.hair === "number" && Number.isFinite(o.hair)) {
    look.peloColor = masParecido(COLORES_PELO, o.hair);
  }

  if (esClave(PIELES, o.piel)) look.piel = o.piel;
  if (esClave(ESTILOS.pelo, o.pelo)) look.pelo = o.pelo;
  if (esClave(COLORES_PELO, o.peloColor)) look.peloColor = o.peloColor;
  if (esClave(ESTILOS.torso, o.torso)) look.torso = o.torso;
  if (esClave(COLORES_ROPA, o.torsoColor)) look.torsoColor = o.torsoColor;
  if (esClave(ESTILOS.piernas, o.piernas)) look.piernas = o.piernas;
  if (esClave(COLORES_ROPA, o.piernasColor)) look.piernasColor = o.piernasColor;
  if (esClave(ESTILOS.pies, o.pies)) look.pies = o.pies;
  if (esClave(COLORES_ROPA, o.piesColor)) look.piesColor = o.piesColor;
  return look;
}

/** Clave estable de un aspecto (para no regenerar texturas iguales) */
export function lookKey(l: Look): string {
  return [l.piel, l.pelo, l.peloColor, l.torso, l.torsoColor, l.piernas, l.piernasColor, l.pies, l.piesColor].join(".");
}

export function mismoLook(a: Look, b: Look): boolean {
  return lookKey(a) === lookKey(b);
}

// ---------------------------------------------------------------- Rampas

const RAMPAS_PIEL = Object.fromEntries(
  Object.entries(PIELES).map(([id, hex]) => [id, rampa(hex, { sombraHacia: 35, contraste: 0.8, giro: 10 })]),
) as Record<TonoPiel, Rampa>;
const RAMPAS_PELO = Object.fromEntries(
  Object.entries(COLORES_PELO).map(([id, hex]) => [id, rampa(hex)]),
) as Record<ColorPelo, Rampa>;
const RAMPAS_ROPA = Object.fromEntries(
  Object.entries(COLORES_ROPA).map(([id, hex]) => [id, rampa(hex)]),
) as Record<ColorRopa, Rampa>;

const BLANCO_FIJO = rampa(0xf4f2ec);
const OJO: Rampa = [0x3b2f45, 0x2e2438, 0x2e2438, 0x241c2c, 0x1a1420];
const BRILLO: Rampa = [0xffffff, 0xffffff, 0xf2f2f7, 0xe0e0ea, 0x9a9ab0];

/** Rampas públicas, para pintar muestras de color en la interfaz */
export const RAMPAS = { piel: RAMPAS_PIEL, pelo: RAMPAS_PELO, ropa: RAMPAS_ROPA };

/**
 * Los 5 tonos con los que se pinta un material para un aspecto dado. Es la
 * única función que convierte "esto es pelo" en un color.
 */
export function rampaDe(look: Look, mat: number): Rampa {
  switch (mat) {
    case MAT.PIEL:
      return RAMPAS_PIEL[look.piel];
    case MAT.PELO:
      return RAMPAS_PELO[look.peloColor];
    case MAT.CEJA: {
      const r = RAMPAS_PELO[look.peloColor];
      return [r[3], r[3], r[3], r[4], r[4]];
    }
    case MAT.TORSO:
      return RAMPAS_ROPA[look.torsoColor];
    case MAT.PIERNAS:
      return RAMPAS_ROPA[look.piernasColor];
    case MAT.PIES:
      return RAMPAS_ROPA[look.piesColor];
    case MAT.TORSO_B:
    case MAT.SUELA:
      return BLANCO_FIJO;
    case MAT.OJO:
      return OJO;
    case MAT.BRILLO_OJO:
      return BRILLO;
    case MAT.BOCA: {
      const p = RAMPAS_PIEL[look.piel];
      const labio = mezcla(p[3], 0xb03a48, 0.45);
      return [labio, labio, labio, p[4], p[4]];
    }
    default:
      return RAMPAS_PIEL[look.piel];
  }
}
