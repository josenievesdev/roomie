// Hoja de sprites del avatar: disposición de los fotogramas y combinación de
// capas. Módulo PURO (sin Phaser ni DOM): lo usan el navegador
// (`src/entities/avatar.ts`) y el generador de vistas previas
// (`tools/genavatar.mjs`), así que lo que se ve en la vista previa es
// exactamente lo que dibuja el juego.
//
// Cada capa (cuerpo, pelo/corto, torso/sudadera...) es una imagen con la MISMA
// disposición que la hoja final, pero en vez de colores guarda en cada píxel:
//   R = material (`MAT`) · G = banda de luz (0 brillo … 3 sombra)
//   B = profundidad (menor = más cerca de la cámara) · A = 255 si hay algo
// Combinar es quedarse, píxel a píxel, con lo más cercano; colorear es pasar
// cada (material, banda) por la rampa del aspecto del jugador.

import { rampaDe, type Look } from "../state/look.ts";
import type { Rampa } from "../utils/color.ts";

export const HOJA = {
  frameW: 48,
  frameH: 84,
  /** Píxel del fotograma donde caen los pies: el origen del sprite */
  anclaX: 24,
  anclaY: 77,
  /** 8 direcciones, en sentido horario desde el norte de la pantalla */
  dirs: 8,
  anims: {
    /** De pie: ojos abiertos y un parpadeo */
    idle: { desde: 0, n: 2 },
    walk: { desde: 2, n: 8 },
    sit: { desde: 10, n: 2 },
    wave: { desde: 12, n: 2 },
  },
  columnas: 14,
} as const;

export type Anim = keyof typeof HOJA.anims;
export const ANIMS = Object.keys(HOJA.anims) as Anim[];
export const ANCHO_HOJA = HOJA.columnas * HOJA.frameW;
export const ALTO_HOJA = HOJA.dirs * HOJA.frameH;

/** Esquina superior izquierda de un fotograma en la hoja */
export function marco(anim: Anim, i: number, dir: number): { x: number; y: number } {
  return { x: (HOJA.anims[anim].desde + i) * HOJA.frameW, y: dir * HOJA.frameH };
}

/** Capas que necesita un aspecto. El orden desempata profundidades iguales. */
export function capasDe(look: Look): string[] {
  return ["cuerpo", `piernas/${look.piernas}`, `pies/${look.pies}`, `torso/${look.torso}`, `pelo/${look.pelo}`];
}

/** Nombre de fichero de una capa (`torso/sudadera` → `torso-sudadera.png`) */
export const ficheroCapa = (capa: string): string => `${capa.replace("/", "-")}.png`;

export type Capa = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type Region = { x: number; y: number; w: number; h: number };

/** Salto de profundidad (en bytes, 3 = 1 unidad) a partir del cual se traza una línea interior */
const BORDE = 10;
/** Sombra del suelo: elipse bajo los pies, en fotogramas de pie */
const SOMBRA = { rx: 10.5, ry: 4, color: [26, 20, 32], alfa: 70 } as const;

/**
 * Combina y colorea las capas de un aspecto en una región de la hoja (por
 * defecto, la hoja entera). Devuelve RGBA listo para una textura.
 *
 * Tres pasadas:
 *  1. Lo más cercano de todas las capas, píxel a píxel.
 *  2. Color por rampa, y línea interior donde algo tapa a otra cosa con un
 *     salto de profundidad (el brazo delante del pecho, el flequillo sobre la
 *     frente): del tono de contorno de lo que está DELANTE.
 *  3. Contorno exterior de 1 px, del tono más oscuro de lo que rodea (nunca
 *     negro: la regla de la guía de estilo), y la sombra del suelo.
 */
export function componer(capas: Capa[], look: Look, region?: Region): Uint8ClampedArray {
  const rg = region ?? { x: 0, y: 0, w: ANCHO_HOJA, h: ALTO_HOJA };
  const { w, h } = rg;
  const n = w * h;
  const mat = new Uint8Array(n);
  const shade = new Uint8Array(n);
  const depth = new Uint8Array(n).fill(255);

  for (const capa of capas) {
    const src = capa.data;
    for (let y = 0; y < h; y++) {
      const fila = ((rg.y + y) * capa.width + rg.x) * 4;
      for (let x = 0; x < w; x++) {
        const i = fila + x * 4;
        if (src[i + 3] === 0) continue;
        const k = y * w + x;
        const d = src[i + 2];
        if (d <= depth[k] || mat[k] === 0) {
          mat[k] = src[i];
          shade[k] = src[i + 1];
          depth[k] = d;
        }
      }
    }
  }

  const rampas: (Rampa | undefined)[] = [];
  const rampa = (m: number): Rampa => (rampas[m] ??= rampaDe(look, m));

  const out = new Uint8ClampedArray(n * 4);
  const pinta = (k: number, color: number, alfa = 255): void => {
    out[k * 4] = (color >> 16) & 0xff;
    out[k * 4 + 1] = (color >> 8) & 0xff;
    out[k * 4 + 2] = color & 0xff;
    out[k * 4 + 3] = alfa;
  };

  // Los 4 vecinos, sin crear arrays: esto corre una vez por píxel de la hoja
  // (450.000 veces) y la versión con arrays tardaba ~90 ms por avatar.
  const vec = new Int32Array(4);
  const vecinos = (x: number, y: number): number => {
    let n = 0;
    const k = y * w + x;
    if (x > 0) vec[n++] = k - 1;
    if (x < w - 1) vec[n++] = k + 1;
    if (y > 0) vec[n++] = k - w;
    if (y < h - 1) vec[n++] = k + w;
    return n;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const n = vecinos(x, y);
      if (mat[k] !== 0) {
        // Línea interior: el vecino más cercano que me tapa con un salto claro
        let delante = -1;
        for (let j = 0; j < n; j++) {
          const q = vec[j];
          if (mat[q] !== 0 && depth[q] + BORDE < depth[k] && (delante < 0 || depth[q] < depth[delante])) delante = q;
        }
        if (delante >= 0) pinta(k, rampa(mat[delante])[4]);
        else pinta(k, rampa(mat[k])[Math.min(shade[k], 4)]);
        continue;
      }
      // Contorno exterior: del material más cercano de alrededor
      let junto = -1;
      for (let j = 0; j < n; j++) {
        const q = vec[j];
        if (mat[q] !== 0 && (junto < 0 || depth[q] < depth[junto])) junto = q;
      }
      if (junto >= 0) pinta(k, rampa(mat[junto])[4]);
    }
  }

  // Sombra en el suelo de los fotogramas de pie (sentado, cae en el asiento)
  const { frameW, frameH, anclaX, anclaY } = HOJA;
  const sit = HOJA.anims.sit;
  for (let fy = Math.floor(rg.y / frameH); fy * frameH < rg.y + h; fy++) {
    for (let fx = Math.floor(rg.x / frameW); fx * frameW < rg.x + w; fx++) {
      if (fx >= sit.desde && fx < sit.desde + sit.n) continue;
      const cx = fx * frameW + anclaX - rg.x;
      const cy = fy * frameH + anclaY - rg.y;
      for (let dy = -SOMBRA.ry; dy <= SOMBRA.ry; dy++) {
        for (let dx = -Math.ceil(SOMBRA.rx); dx <= Math.ceil(SOMBRA.rx); dx++) {
          if ((dx / SOMBRA.rx) ** 2 + (dy / SOMBRA.ry) ** 2 > 1) continue;
          const x = Math.floor(cx + dx);
          const y = Math.floor(cy + dy);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const k = y * w + x;
          if (out[k * 4 + 3] !== 0) continue;
          out[k * 4] = SOMBRA.color[0];
          out[k * 4 + 1] = SOMBRA.color[1];
          out[k * 4 + 2] = SOMBRA.color[2];
          out[k * 4 + 3] = SOMBRA.alfa;
        }
      }
    }
  }
  return out;
}
