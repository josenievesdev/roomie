// La cara del avatar. Módulo PURO (sin Phaser ni DOM): lo usan el navegador
// (`src/entities/avatar.ts`, a través de `componer`) y las vistas previas del
// generador, así que lo que se ve en una vista previa es lo que dibuja el
// juego.
//
// A este tamaño un ojo son 2×3 píxeles: modelado como geometría, parpadearía
// entre 1 y 3 según cayera. Por eso la cara se pinta con SELLOS (dibujos de
// pocos píxeles, uno por estilo) en ANCLAS: el generador busca en 3D dónde
// cae cada rasgo (el ojo, la ceja, la boca...) en cada fotograma y cada
// forma de cara, y guarda el píxel (`public/assets/avatar/cara.json`). Aquí se
// estampa el sello del estilo elegido en esa ancla, con su variante de
// frente o de lado según lo que mire el rasgo a la cámara.
//
// La barba no es un sello: el generador marca en la piel de la cabeza qué
// zona es cada píxel (mandíbula, bigote, perilla, patillas) y aquí se tiñe la
// zona. Así se adapta a cada forma de cara y conserva la luz del modelo.
//
// Para añadir un estilo de ojos, cejas, nariz, boca o detalle: su id en
// `src/state/look.ts` y su sello aquí. No hay que regenerar nada.

import {
  MAT,
  ZONA,
  type EstiloBarba,
  type EstiloBoca,
  type EstiloCejas,
  type EstiloDetalle,
  type EstiloNariz,
  type EstiloOjos,
  type Look,
} from "../state/look.ts";
import type { Fundido, Region } from "./capas.ts";

// ---------------------------------------------------------------- Sellos

/**
 * Un sello: filas de caracteres (ver `TINTA`) y la celda que cae en el
 * ancla. Los de los ojos, las cejas y las mejillas se dibujan para el lado
 * derecho de la pantalla (el exterior a la derecha) y se reflejan para el
 * otro; los del centro (nariz y boca) no se reflejan.
 */
type Sello = { filas: readonly string[]; ox: number; oy: number };

/** Qué pinta cada carácter de un sello: material y banda de luz ("." nada) */
const TINTA: Record<string, { mat: number; banda: number }> = {
  O: { mat: MAT.OJO, banda: 1 },
  I: { mat: MAT.IRIS, banda: 1 },
  B: { mat: MAT.BRILLO_OJO, banda: 0 },
  c: { mat: MAT.CEJA, banda: 1 },
  /** Ceja fina: el pelo en su tono medio, más claro que una ceja normal */
  f: { mat: MAT.PELO, banda: 2 },
  /** Nariz: la propia piel, en sombra o con brillo */
  n: { mat: MAT.PIEL, banda: 3 },
  h: { mat: MAT.PIEL, banda: 0 },
  m: { mat: MAT.BOCA, banda: 1 },
  l: { mat: MAT.LABIO, banda: 1 },
  d: { mat: MAT.DIENTES, banda: 1 },
  t: { mat: MAT.LENGUA, banda: 1 },
  r: { mat: MAT.RUBOR, banda: 1 },
  p: { mat: MAT.PECA, banda: 1 },
  x: { mat: MAT.LUNAR, banda: 1 },
};

const s = (filas: readonly string[], ox = 0, oy = 0): Sello => ({ filas, ox, oy });

/**
 * Ojos. `frente` cuando el ojo mira a la cámara, `lado` de perfil (una sola
 * columna), y los mismos cerrados para el parpadeo. El ancla es la columna
 * de dentro del ojo; la fila `oy` es la del centro.
 */
const OJOS: Record<EstiloOjos, { frente: Sello; lado: Sello; cerrado: Sello; ladoCerrado: Sello }> = {
  redondos: {
    frente: s(["OO", "IB", "II"], 0, 1),
    lado: s(["O", "I", "I"], 0, 1),
    cerrado: s(["OO"], 0, -1),
    ladoCerrado: s(["O"], 0, -1),
  },
  grandes: {
    frente: s(["OO", "IB", "II", "II"], 0, 1),
    lado: s(["O", "I", "I", "I"], 0, 1),
    cerrado: s(["OO"], 0, -1),
    ladoCerrado: s(["O"], 0, -1),
  },
  // Dos puntos, sin brillo: los muñecos de toda la vida
  puntitos: {
    frente: s(["O", "O"], 0, 0),
    lado: s(["O", "O"], 0, 0),
    cerrado: s(["O"], 0, -1),
    ladoCerrado: s(["O"], 0, -1),
  },
  almendrados: {
    frente: s(["OOO", "IIB"], 0, 0),
    lado: s(["O", "I"], 0, 0),
    cerrado: s(["OOO"], 0, -1),
    ladoCerrado: s(["O"], 0, -1),
  },
  finos: {
    frente: s(["OOO", ".II"], 0, 0),
    lado: s(["O", "I"], 0, 0),
    cerrado: s(["OOO"], 0, -1),
    ladoCerrado: s(["O"], 0, -1),
  },
  pestanas: {
    frente: s(["OOO", "IB.", "II."], 0, 1),
    lado: s(["OO", "I.", "I."], 0, 1),
    cerrado: s(["OOO"], 0, -1),
    ladoCerrado: s(["OO"], 0, -1),
  },
  felinos: {
    frente: s(["..O", "OOO", "IB."], 0, 1),
    lado: s([".O", "O.", "I."], 0, 1),
    cerrado: s(["..O", "OO."], 0, 0),
    ladoCerrado: s([".O", "O."], 0, 0),
  },
  // Párpado caído: una fila de sombra de la propia piel encima del ojo
  dormilones: {
    frente: s(["nn", "OO", "IB"], 0, 1),
    lado: s(["n", "O", "I"], 0, 1),
    cerrado: s(["nn", "OO"], 0, 0),
    ladoCerrado: s(["n", "O"], 0, 0),
  },
  felices: {
    frente: s([".O.", "O.O"], 0, 1),
    lado: s([".O", "O."], 0, 1),
    cerrado: s([".O.", "O.O"], 0, 1),
    ladoCerrado: s([".O", "O."], 0, 1),
  },
};

/** Cejas: el ancla es la columna de dentro; la fila `oy`, la de la ceja */
const CEJAS: Record<EstiloCejas, { frente: Sello; lado: Sello }> = {
  normales: { frente: s(["cc"]), lado: s(["c"]) },
  finas: { frente: s(["ff"]), lado: s(["f"]) },
  gruesas: { frente: s(["ccc", "cc."], 0, 1), lado: s(["c", "c"], 0, 1) },
  rectas: { frente: s(["ccc"]), lado: s(["cc"]) },
  arqueadas: { frente: s([".c.", "c.c"], 0, 1), lado: s([".c", "c."], 0, 1) },
  decididas: { frente: s(["..c", "cc."], 0, 1), lado: s([".c", "c."], 0, 1) },
  preocupadas: { frente: s(["cc.", "..c"], 0, 0), lado: s(["c.", ".c"], 0, 0) },
};

/** Narices: centradas en su ancla (no se reflejan) */
const NARICES: Record<EstiloNariz, { frente: Sello | null; lado: Sello | null }> = {
  pequena: { frente: null, lado: null },
  punto: { frente: s(["n"]), lado: s(["n"]) },
  boton: { frente: s(["h", "n"], 0, 1), lado: s(["n"]) },
  respingona: { frente: s(["hn"], 0, 0), lado: s(["n"]) },
  ancha: { frente: s(["n.n"], 1, 0), lado: s(["n"]) },
  larga: { frente: s(["h", "h", "n"], 0, 2), lado: s(["h", "n"], 0, 1) },
};

/** Bocas: centradas en su ancla (no se reflejan). `lado`, girada tres cuartos */
const BOCAS: Record<EstiloBoca, { frente: Sello; lado: Sello }> = {
  normal: { frente: s(["mm"], 1, 0), lado: s(["m"]) },
  sonrisa: { frente: s(["m.m", ".m."], 1, 0), lado: s(["m.", ".m"], 0, 0) },
  amplia: { frente: s(["m..m", ".mm."], 2, 0), lado: s(["m.", ".m"], 0, 0) },
  dientes: { frente: s(["mddm", ".mm."], 2, 0), lado: s(["md", ".m"], 0, 0) },
  seria: { frente: s(["mmm"], 1, 0), lado: s(["mm"], 0, 0) },
  pequena: { frente: s(["m"]), lado: s(["m"]) },
  labios: { frente: s(["mm", "ll"], 1, 0), lado: s(["m", "l"]) },
  picara: { frente: s(["..m", "mm."], 1, 0), lado: s([".m", "m."], 0, 0) },
  sorpresa: { frente: s(["mm", "mm"], 1, 0), lado: s(["m", "m"]) },
  lengua: { frente: s(["mm", ".t"], 1, 0), lado: s(["m", "t"]) },
};

/** Detalles de las mejillas: el ancla es el centro del moflete */
const DETALLES: Record<EstiloDetalle, { frente: Sello; lado: Sello; soloIzquierda?: boolean } | null> = {
  ninguno: null,
  rubor: { frente: s(["rr"], 1, 0), lado: s(["r"]) },
  pecas: { frente: s(["p.p", ".p."], 1, 0), lado: s(["p", ".", "p"], 0, 1) },
  pecasRubor: { frente: s(["p.p", "rpr"], 1, 0), lado: s(["p", "r"], 0, 0) },
  lunar: { frente: s(["x"], -1, -1), lado: s(["x"], 0, -1), soloIzquierda: true },
};

/** Qué zonas de la piel tiñe cada barba, y con qué */
const BARBAS: Record<EstiloBarba, { zonas: number[]; mat: number } | null> = {
  ninguna: null,
  bigote: { zonas: [ZONA.BIGOTE], mat: MAT.BARBA },
  perilla: { zonas: [ZONA.PERILLA], mat: MAT.BARBA },
  candado: { zonas: [ZONA.BIGOTE, ZONA.PERILLA], mat: MAT.BARBA },
  sombra: { zonas: [ZONA.BIGOTE, ZONA.PERILLA, ZONA.MANDIBULA, ZONA.PATILLA], mat: MAT.SOMBRA_BARBA },
  barba: { zonas: [ZONA.BIGOTE, ZONA.PERILLA, ZONA.MANDIBULA, ZONA.PATILLA], mat: MAT.BARBA },
};

/** Los estilos que tienen sello, para comprobar que no falta ninguno (`tools/prueba-avatar.mjs`) */
export const SELLOS = { ojos: OJOS, cejas: CEJAS, nariz: NARICES, boca: BOCAS, detalle: DETALLES, barba: BARBAS };

// ---------------------------------------------------------------- Anclas

/**
 * Las anclas de la cara que genera `tools/genavatar.mjs`, por forma de cara:
 * por cada fotograma de la hoja (dirección × columna), cada rasgo en 4
 * bytes: x e y en el fotograma, la profundidad de la piel en ese punto (la
 * misma escala que las capas) y cuánto mira a la cámara (0…200 → -1…1).
 */
export type DatosCara = {
  anclas: readonly string[];
  columnas: number;
  formas: Record<string, Uint8Array>;
};

/** Los rasgos, en el orden en que los guarda el generador */
export const ANCLAS = ["ojoL", "ojoR", "cejaL", "cejaR", "nariz", "boca", "mejillaL", "mejillaR"] as const;
type Ancla = (typeof ANCLAS)[number];

/** Base64 → bytes, sin depender del navegador ni de Node */
function deBase64(b64: string): Uint8Array {
  const ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const limpio = b64.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((limpio.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of limpio) {
    acc = (acc << 6) | ALFA.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Lee `cara.json` (lo que escribe el generador); null si no se entiende */
export function leerDatosCara(json: unknown): DatosCara | null {
  const j = json as { version?: number; anclas?: string[]; columnas?: number; formas?: Record<string, string> } | null;
  if (!j || j.version !== 1 || !Array.isArray(j.anclas) || typeof j.columnas !== "number" || !j.formas) return null;
  if (j.anclas.join() !== ANCLAS.join()) return null;
  const formas: Record<string, Uint8Array> = {};
  for (const [forma, b64] of Object.entries(j.formas)) formas[forma] = deBase64(b64);
  return { anclas: j.anclas, columnas: j.columnas, formas };
}

// ---------------------------------------------------------------- Pintar

/** Cuánto tiene que mirar a la cámara cada rasgo para verse, y para verse de frente */
const UMBRAL = {
  ojo: { ver: 0.18, frente: 0.62 },
  ceja: { ver: 0.3, frente: 0.62 },
  nariz: { ver: 0.4, frente: 0.7 },
  boca: { ver: 0.35, frente: 0.7 },
  mejilla: { ver: 0.3, frente: 0.62 },
};

/**
 * Diferencia de profundidad (en bytes de capa, 3 = 1 unidad) a partir de la
 * cual lo que se ve en el píxel NO es la piel del ancla: una mano delante de
 * la cara. Holgura de 3 unidades: la cara es curva.
 */
const HOLGURA = 9;

export type HojaCara = {
  frameW: number;
  frameH: number;
  /** ¿Es un fotograma de parpadeo? (por columna de la hoja) */
  parpadeo: (columna: number) => boolean;
};

/**
 * Pinta la cara de un aspecto sobre lo ya fundido de una región de la hoja
 * (antes de colorear): en cada fotograma que toque la región, la barba en
 * sus zonas y los sellos de los rasgos en sus anclas.
 */
export function pintarCara(f: Fundido, rg: Region, datos: DatosCara, look: Look, hoja: HojaCara): void {
  const bytes = datos.formas[look.cara];
  if (!bytes) return;
  const n = ANCLAS.length;
  const { frameW, frameH } = hoja;
  for (let fy = Math.floor(rg.y / frameH); fy * frameH < rg.y + rg.h; fy++) {
    for (let fx = Math.floor(rg.x / frameW); fx * frameW < rg.x + rg.w; fx++) {
      if (fx >= datos.columnas) continue;
      const base = (fy * datos.columnas + fx) * n * 4;
      if (base + n * 4 > bytes.length) continue;
      // Esquina del fotograma en coordenadas de la región
      const ox = fx * frameW - rg.x;
      const oy = fy * frameH - rg.y;
      const ancla = (a: Ancla) => {
        const i = base + ANCLAS.indexOf(a) * 4;
        return { x: ox + bytes[i], y: oy + bytes[i + 1], prof: bytes[i + 2], frente: bytes[i + 3] / 100 - 1 };
      };
      barba(f, look, Math.max(0, ox), Math.max(0, oy), Math.min(f.w, ox + frameW), Math.min(f.h, oy + frameH));
      rasgos(f, look, ancla, hoja.parpadeo(fx));
    }
  }
}

/** Tiñe las zonas de la barba (sólo sobre piel) en un rectángulo de la región */
function barba(f: Fundido, look: Look, x0: number, y0: number, x1: number, y1: number): void {
  const b = BARBAS[look.barba];
  if (!b) return;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = y * f.w + x;
      if (f.mat[k] === MAT.PIEL && f.zona[k] !== ZONA.NINGUNA && b.zonas.includes(f.zona[k])) f.mat[k] = b.mat;
    }
  }
}

type AnclaPx = { x: number; y: number; prof: number; frente: number };

function rasgos(f: Fundido, look: Look, ancla: (a: Ancla) => AnclaPx, parpado: boolean): void {
  const soloPiel = [MAT.PIEL];
  // Las mejillas, la nariz y la boca antes que ojos y cejas: si se tocan,
  // mandan los ojos
  const d = DETALLES[look.detalle];
  if (d) {
    for (const [a, lado] of [["mejillaL", 1], ["mejillaR", -1]] as const) {
      if (d.soloIzquierda && lado < 0) continue;
      const p = ancla(a);
      if (p.frente < UMBRAL.mejilla.ver) continue;
      estampar(f, p.frente >= UMBRAL.mejilla.frente ? d.frente : d.lado, p, lado < 0, soloPiel);
    }
  }

  const nariz = NARICES[look.nariz];
  const pn = ancla("nariz");
  if (pn.frente >= UMBRAL.nariz.ver) {
    const sello = pn.frente >= UMBRAL.nariz.frente ? nariz.frente : nariz.lado;
    if (sello) estampar(f, sello, pn, false, soloPiel);
  }

  const pb = ancla("boca");
  if (pb.frente >= UMBRAL.boca.ver) {
    const boca = BOCAS[look.boca];
    // La boca se ve también dentro de la barba
    estampar(f, pb.frente >= UMBRAL.boca.frente ? boca.frente : boca.lado, pb, false, [MAT.PIEL, MAT.BARBA, MAT.SOMBRA_BARBA]);
  }

  const cejas = CEJAS[look.cejas];
  for (const [a, lado] of [["cejaL", 1], ["cejaR", -1]] as const) {
    const p = ancla(a);
    if (p.frente < UMBRAL.ceja.ver) continue;
    estampar(f, p.frente >= UMBRAL.ceja.frente ? cejas.frente : cejas.lado, p, lado < 0, soloPiel);
  }

  const ojos = OJOS[look.ojos];
  for (const [a, lado] of [["ojoL", 1], ["ojoR", -1]] as const) {
    const p = ancla(a);
    if (p.frente < UMBRAL.ojo.ver) continue;
    const deFrente = p.frente >= UMBRAL.ojo.frente;
    const sello = parpado ? (deFrente ? ojos.cerrado : ojos.ladoCerrado) : deFrente ? ojos.frente : ojos.lado;
    estampar(f, sello, p, lado < 0, soloPiel);
  }
}

/**
 * Estampa un sello en su ancla. `reflejar`: el rasgo del otro lado de la
 * cara. Sólo pinta sobre `sobre` (la piel, casi siempre: el flequillo tapa
 * las cejas) y donde lo que se ve está a la profundidad del ancla (una mano
 * delante de la cara no se pinta).
 */
function estampar(f: Fundido, sello: Sello, p: AnclaPx, reflejar: boolean, sobre: readonly number[]): void {
  const alto = sello.filas.length;
  for (let fila = 0; fila < alto; fila++) {
    const linea = sello.filas[fila];
    for (let col = 0; col < linea.length; col++) {
      const tinta = TINTA[linea[col]];
      if (!tinta) continue;
      const dx = col - sello.ox;
      const x = p.x + (reflejar ? -dx : dx);
      const y = p.y + fila - sello.oy;
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const k = y * f.w + x;
      if (!sobre.includes(f.mat[k])) continue;
      if (Math.abs(f.depth[k] - p.prof) > HOLGURA) continue;
      f.mat[k] = tinta.mat;
      f.shade[k] = tinta.banda;
    }
  }
}
