// Catálogo del aspecto del avatar. Módulo PURO (sin Phaser): lo importan el
// navegador (para combinar y colorear), el SERVIDOR (para validar lo que
// llega) y el generador `tools/genavatar.mjs` (para saber qué dibujar).
//
// Igual que con el mobiliario, una sola lista: si cada lado tuviera la suya,
// el servidor aceptaría estilos que el navegador no sabe pintar.
//
// Para añadir un peinado o una prenda: un estilo aquí + su forma en
// `tools/avatar/model.mjs` + `node tools/genavatar.mjs`. Para un rasgo de la
// cara (ojos, cejas, nariz, boca, detalle): un estilo aquí + su sello en
// `src/render/cara.ts` (no hace falta regenerar nada). Para un color: una
// línea aquí; las cinco tonalidades salen solas de `rampa()`.

import { distanciaColor, mezcla, rampa, type Rampa } from "../utils/color.ts";

// ---------------------------------------------------------------- Materiales
//
// El generador no pinta colores: escribe en cada píxel QUÉ es (piel, pelo,
// torso...) y con qué luz. El color lo pone el navegador según el aspecto de
// cada jugador, así que una misma capa sirve para todos los colores. Los
// rasgos de la cara los pinta el navegador encima (`src/render/cara.ts`).

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
  /** El contorno del ojo y la pupila */
  OJO: 8,
  BRILLO_OJO: 9,
  /** La línea de la boca */
  BOCA: 10,
  /** Cejas: del color del pelo, en su tono más oscuro */
  CEJA: 11,
  /** El color de los ojos */
  IRIS: 12,
  RUBOR: 13,
  PECA: 14,
  LUNAR: 15,
  /** Barba, bigote y perilla: del color del pelo */
  BARBA: 16,
  /** Barba de tres días: la piel teñida del color del pelo */
  SOMBRA_BARBA: 17,
  DIENTES: 18,
  /** El labio de abajo, más claro que la línea de la boca */
  LABIO: 19,
  LENGUA: 20,
} as const;

export type Material = (typeof MAT)[keyof typeof MAT];

/**
 * Zonas de la cara: el generador marca en cada píxel de la cabeza a qué zona
 * de la piel pertenece (en los bits altos del canal de la luz), y el
 * navegador pinta ahí la barba, el bigote o la perilla.
 */
export const ZONA = {
  NINGUNA: 0,
  MANDIBULA: 1,
  BIGOTE: 2,
  PERILLA: 3,
  PATILLA: 4,
} as const;

// ---------------------------------------------------------------- Estilos
//
// Cada catálogo: id → nombre que se ve en el vestidor. El orden es el del
// vestidor.

/**
 * Formas de cara. Cambia lo de abajo (mofletes, mandíbula, barbilla); el
 * cráneo es el mismo en todas, y por eso cualquier peinado vale para
 * cualquier cara.
 */
export const CARAS = {
  redonda: "Redonda",
  ovalada: "Ovalada",
  cuadrada: "Cuadrada",
  corazon: "Corazón",
  mofletes: "Mofletes",
} as const;

export const OJOS = {
  redondos: "Redondos",
  grandes: "Grandes",
  puntitos: "Puntitos",
  almendrados: "Almendrados",
  finos: "Finos",
  pestanas: "Con pestañas",
  dormilones: "Dormilones",
  felinos: "Felinos",
  felices: "Felices",
} as const;

export const CEJAS = {
  normales: "Normales",
  finas: "Finas",
  gruesas: "Gruesas",
  rectas: "Rectas",
  arqueadas: "Arqueadas",
  decididas: "Decididas",
  preocupadas: "Preocupadas",
} as const;

export const NARICES = {
  pequena: "Pequeña",
  punto: "Punto",
  boton: "Botón",
  respingona: "Respingona",
  ancha: "Ancha",
  larga: "Larga",
} as const;

export const BOCAS = {
  normal: "Normal",
  sonrisa: "Sonrisa",
  amplia: "Sonrisa amplia",
  dientes: "Con dientes",
  seria: "Seria",
  pequena: "Pequeña",
  labios: "Labios",
  picara: "Pícara",
  sorpresa: "Sorpresa",
  lengua: "Lengua fuera",
} as const;

export const DETALLES = {
  ninguno: "Ninguno",
  pecas: "Pecas",
  rubor: "Rubor",
  pecasRubor: "Pecas y rubor",
  lunar: "Lunar",
} as const;

export const BARBAS = {
  ninguna: "Ninguna",
  bigote: "Bigote",
  perilla: "Perilla",
  candado: "Bigote y perilla",
  sombra: "De tres días",
  barba: "Barba",
} as const;

export const ESTILOS = {
  pelo: {
    corto: "Corto",
    rapado: "Rapado",
    calvo: "Sin pelo",
    rizado: "Rizado",
    tupe: "Tupé",
    atras: "Hacia atrás",
    cresta: "Cresta",
    flequillo: "Flequillo",
    bob: "Bob",
    largo: "Melena",
    rizos: "Rizos largos",
    afro: "Afro",
    coleta: "Coleta",
    coletas: "Dos coletas",
    mono: "Moño",
    monoAlto: "Moño alto",
    monos: "Dos moños",
    trenzas: "Trenzas",
    rastas: "Rastas",
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
export type FormaCara = keyof typeof CARAS;
export type EstiloOjos = keyof typeof OJOS;
export type EstiloCejas = keyof typeof CEJAS;
export type EstiloNariz = keyof typeof NARICES;
export type EstiloBoca = keyof typeof BOCAS;
export type EstiloDetalle = keyof typeof DETALLES;
export type EstiloBarba = keyof typeof BARBAS;

/** Las partes que son una capa generada en 3D (la cabeza va aparte: `cabeza/<forma>`) */
export const PARTES: readonly Parte[] = ["pelo", "torso", "piernas", "pies"];

// ---------------------------------------------------------------- Colores
//
// Cada color es el tono "de catálogo" (el que se ve con luz). Las sombras,
// los brillos y el contorno salen de `rampa()`, con la misma regla para todo.

/**
 * Tonos de piel, de claro a oscuro, con matices distintos (rosados, dorados,
 * oliva): así cualquiera puede hacer a alguien que se le parezca. Los ids de
 * antes (p1…p6) no cambian: las cuentas guardadas siguen siendo las mismas.
 */
export const PIELES = {
  p1: 0xffe3cc,
  p7: 0xf6d6c4,
  p2: 0xf6c9a2,
  p8: 0xebc193,
  p3: 0xe3a878,
  p9: 0xcf9a68,
  p4: 0xc68552,
  p10: 0xae7446,
  p5: 0x9b5d38,
  p11: 0x80492c,
  p6: 0x6e4029,
  p12: 0x553122,
} as const;

export const COLORES_PELO = {
  negro: 0x3a3342,
  castano_oscuro: 0x5a3b2a,
  caoba: 0x7e3a2c,
  castano: 0x8a5632,
  castano_claro: 0xae7a4c,
  miel: 0xd3a15a,
  rubio: 0xecc66f,
  platino: 0xeee8da,
  gris: 0xa3a3b2,
  pelirrojo: 0xd0582c,
  rojo: 0xd8393f,
  rosa: 0xf07ab4,
  lila: 0xbf9df2,
  morado: 0x9460e0,
  azul: 0x4a86e0,
  turquesa: 0x33bfb4,
  verde: 0x3fb383,
} as const;

/** El color de los ojos (el iris): los oscuros son los de siempre */
export const COLORES_OJOS = {
  oscuros: 0x3b2f45,
  marron: 0x6e4428,
  avellana: 0x9b6d34,
  ambar: 0xc58a2e,
  verde: 0x4e9b58,
  azul: 0x4886d6,
  gris: 0x8c95a8,
  violeta: 0x8b63d6,
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
export type ColorOjos = keyof typeof COLORES_OJOS;
export type ColorRopa = keyof typeof COLORES_ROPA;

// ---------------------------------------------------------------- Aspecto

/**
 * Qué catálogo valida cada campo del aspecto. Es la tabla de la que sale
 * todo lo demás (el tipo `Look`, la validación, la clave y el código que
 * viaja por la red), así que un campo nuevo es una línea aquí.
 */
const CATALOGOS = {
  piel: PIELES,
  cara: CARAS,
  ojos: OJOS,
  ojosColor: COLORES_OJOS,
  cejas: CEJAS,
  nariz: NARICES,
  boca: BOCAS,
  detalle: DETALLES,
  barba: BARBAS,
  pelo: ESTILOS.pelo,
  peloColor: COLORES_PELO,
  torso: ESTILOS.torso,
  torsoColor: COLORES_ROPA,
  piernas: ESTILOS.piernas,
  piernasColor: COLORES_ROPA,
  pies: ESTILOS.pies,
  piesColor: COLORES_ROPA,
} as const;

/**
 * Cómo se ve un avatar. Plano a propósito: se guarda en la base (jsonb) y se
 * valida campo a campo. Por la red viaja en código compacto (`codificarLook`).
 */
export type Look = { [K in keyof typeof CATALOGOS]: keyof (typeof CATALOGOS)[K] };
export type CampoLook = keyof Look;

/** Los campos del aspecto, en el orden de la clave y del código */
export const CAMPOS_LOOK = Object.keys(CATALOGOS) as CampoLook[];

/** Los ids de cada catálogo, en su orden (el índice es lo que viaja en el código) */
const IDS = Object.fromEntries(CAMPOS_LOOK.map((c) => [c, Object.keys(CATALOGOS[c])])) as Record<CampoLook, string[]>;

/** Los ids posibles de un campo, en el orden del vestidor */
export const opcionesDe = (campo: CampoLook): readonly string[] => IDS[campo];

/**
 * El aspecto de siempre: la cara, el pelo y la ropa que tenían todos antes de
 * que hubiera caras. Lo que falte en un aspecto guardado sale de aquí.
 */
export const DEFAULT_LOOK: Look = {
  piel: "p2",
  cara: "redonda",
  ojos: "redondos",
  ojosColor: "oscuros",
  cejas: "normales",
  nariz: "pequena",
  boca: "normal",
  detalle: "ninguno",
  barba: "ninguna",
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
 * defecto, campo a campo (y lo que falta, como la cara de las cuentas de
 * antes de que hubiera caras, también).
 *
 * Acepta también el formato anterior `{ shirt, hair }` (dos colores sueltos):
 * así las cuentas de antes conservan sus colores al pasar al avatar nuevo.
 */
export function sanitizeLook(v: unknown): Look {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const look = { ...DEFAULT_LOOK } as Record<CampoLook, string>;

  if (typeof o.shirt === "number" && Number.isFinite(o.shirt)) {
    look.torsoColor = masParecido(COLORES_ROPA, o.shirt);
  }
  if (typeof o.hair === "number" && Number.isFinite(o.hair)) {
    look.peloColor = masParecido(COLORES_PELO, o.hair);
  }

  for (const c of CAMPOS_LOOK) {
    if (esClave(CATALOGOS[c], o[c])) look[c] = o[c] as string;
  }
  return look as Look;
}

/** Clave estable de un aspecto (para no regenerar texturas iguales) */
export function lookKey(l: Look): string {
  return CAMPOS_LOOK.map((c) => l[c]).join(".");
}

export function mismoLook(a: Look, b: Look): boolean {
  return lookKey(a) === lookKey(b);
}

/**
 * El aspecto en código compacto: un carácter por campo (el índice en su
 * catálogo, en base 36) tras la versión. Viaja en cada instantánea de la
 * sala, 20 veces por segundo por jugador: 18 caracteres en vez de unos 400
 * de JSON. Cliente y servidor salen del mismo código, así que los índices
 * coinciden siempre (en la base se guarda el aspecto entero, no el código).
 */
const VERSION_CODIGO = "1";

export function codificarLook(l: Look): string {
  return VERSION_CODIGO + CAMPOS_LOOK.map((c) => Math.max(0, IDS[c].indexOf(l[c])).toString(36)).join("");
}

/** El aspecto a partir de su código; lo que no se entienda, por defecto (como `sanitizeLook`) */
export function decodificarLook(codigo: unknown): Look {
  const look = { ...DEFAULT_LOOK } as Record<CampoLook, string>;
  if (typeof codigo !== "string" || codigo[0] !== VERSION_CODIGO || codigo.length !== CAMPOS_LOOK.length + 1) {
    return look as Look;
  }
  CAMPOS_LOOK.forEach((c, i) => {
    const id = IDS[c][parseInt(codigo[i + 1], 36)];
    if (id !== undefined) look[c] = id;
  });
  return look as Look;
}

// Un carácter por campo: ningún catálogo puede pasar de 36 opciones
for (const c of CAMPOS_LOOK) {
  if (IDS[c].length > 36) throw new Error(`el catálogo de ${c} tiene más de 36 opciones: el código necesitaría dos caracteres`);
}

/**
 * Un aspecto al azar (el botón "Sorpréndeme" del vestidor): cambia sólo los
 * `campos` que se digan y deja el resto de `base`. `azar` devuelve [0, 1).
 */
export function lookAlAzar(base: Look, campos: readonly CampoLook[] = CAMPOS_LOOK, azar: () => number = Math.random): Look {
  const elegir = (c: CampoLook) => IDS[c][Math.floor(azar() * IDS[c].length)];
  const look = { ...base } as Record<CampoLook, string>;
  for (const c of campos) look[c] = elegir(c);
  // La barba y los detalles, de vez en cuando: casi nadie los lleva
  if (campos.includes("barba") && azar() < 0.7) look.barba = "ninguna";
  if (campos.includes("detalle") && azar() < 0.5) look.detalle = "ninguno";
  return look as Look;
}

// ---------------------------------------------------------------- Rampas

const RAMPAS_PIEL = Object.fromEntries(
  Object.entries(PIELES).map(([id, hex]) => [id, rampa(hex, { sombraHacia: 35, contraste: 0.8, giro: 10 })]),
) as Record<TonoPiel, Rampa>;
const RAMPAS_PELO = Object.fromEntries(
  Object.entries(COLORES_PELO).map(([id, hex]) => [id, rampa(hex)]),
) as Record<ColorPelo, Rampa>;
const RAMPAS_OJOS = Object.fromEntries(
  Object.entries(COLORES_OJOS).map(([id, hex]) => [id, rampa(hex)]),
) as Record<ColorOjos, Rampa>;
const RAMPAS_ROPA = Object.fromEntries(
  Object.entries(COLORES_ROPA).map(([id, hex]) => [id, rampa(hex)]),
) as Record<ColorRopa, Rampa>;

const BLANCO_FIJO = rampa(0xf4f2ec);
const OJO: Rampa = [0x3b2f45, 0x2e2438, 0x2e2438, 0x241c2c, 0x1a1420];
const BRILLO: Rampa = [0xffffff, 0xffffff, 0xf2f2f7, 0xe0e0ea, 0x9a9ab0];
const DIENTES: Rampa = [0xffffff, 0xf7f5f0, 0xe6e2da, 0xcfc9bf, 0x8f8a80];
const LUNAR: Rampa = [0x6a3c2c, 0x4e2a20, 0x4e2a20, 0x3e2018, 0x2c1610];
const LENGUA: Rampa = rampa(0xe8707e);

/** Mezcla dos rampas tono a tono */
const mezclaRampa = (a: Rampa, b: Rampa, t: number): Rampa =>
  [0, 1, 2, 3, 4].map((i) => mezcla(a[i], b[i], t)) as unknown as Rampa;

/** Rampas públicas, para pintar muestras de color en la interfaz */
export const RAMPAS = { piel: RAMPAS_PIEL, pelo: RAMPAS_PELO, ojos: RAMPAS_OJOS, ropa: RAMPAS_ROPA };

/**
 * Los 5 tonos con los que se pinta un material para un aspecto dado. Es la
 * única función que convierte "esto es pelo" en un color.
 */
export function rampaDe(look: Look, mat: number): Rampa {
  const piel = RAMPAS_PIEL[look.piel];
  switch (mat) {
    case MAT.PIEL:
      return piel;
    case MAT.PELO:
    case MAT.BARBA:
      return RAMPAS_PELO[look.peloColor];
    case MAT.CEJA: {
      const r = RAMPAS_PELO[look.peloColor];
      return [r[3], r[3], r[3], r[4], r[4]];
    }
    case MAT.SOMBRA_BARBA:
      return mezclaRampa(piel, RAMPAS_PELO[look.peloColor], 0.38);
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
    case MAT.IRIS:
      return RAMPAS_OJOS[look.ojosColor];
    case MAT.BRILLO_OJO:
      return BRILLO;
    case MAT.BOCA: {
      const labio = mezcla(piel[3], 0xb03a48, 0.45);
      return [labio, labio, labio, piel[4], piel[4]];
    }
    case MAT.LABIO: {
      const labio = mezcla(piel[1], 0xc9485e, 0.48);
      return [labio, labio, labio, piel[4], piel[4]];
    }
    case MAT.RUBOR: {
      const rubor = mezcla(piel[1], 0xff6f8a, 0.3);
      return [rubor, rubor, rubor, piel[4], piel[4]];
    }
    case MAT.PECA: {
      const peca = mezcla(piel[2], 0x7a3f22, 0.36);
      return [peca, peca, peca, piel[4], piel[4]];
    }
    case MAT.LUNAR:
      return LUNAR;
    case MAT.DIENTES:
      return DIENTES;
    case MAT.LENGUA:
      return LENGUA;
    default:
      return piel;
  }
}
