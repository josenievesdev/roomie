// Capas generadas en 3D → píxeles de color. Módulo PURO (sin Phaser ni DOM):
// lo usan el avatar (`avatarSheet.ts`), los muebles (`muebleSheet.ts`) y las
// vistas previas de los generadores, así que lo que se ve en una vista previa
// es exactamente lo que dibuja el juego.
//
// Cada capa es una imagen que en vez de colores guarda en cada píxel:
//   R = material · G = banda de luz (0 brillo … 3 sombra)
//   B = profundidad (menor = más cerca de la cámara) · A = 255 si hay algo
// Combinar es quedarse, píxel a píxel, con lo más cercano; colorear es pasar
// cada (material, banda) por su rampa.

import type { Rampa } from "../utils/color.ts";

export type Capa = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type Region = { x: number; y: number; w: number; h: number };

/** Salto de profundidad (en bytes, 3 = 1 unidad) a partir del cual se traza una línea interior */
const BORDE = 10;

export type OpcionesCombinar = {
  /**
   * Contorno exterior de 1 px (por defecto, sí). Las alfombras no lo llevan:
   * cada celda es un sprite y su contorno partiría la alfombra en baldosas.
   */
  contorno?: boolean;
};

/**
 * Combina y colorea capas en una región. Devuelve RGBA listo para una textura.
 *
 *  1. Lo más cercano de todas las capas, píxel a píxel (a igual profundidad
 *     gana la capa que va después).
 *  2. Color por rampa, y línea interior donde algo tapa a otra cosa con un
 *     salto de profundidad (el brazo delante del pecho, el cojín sobre el
 *     sofá): del tono de contorno de lo que está DELANTE.
 *  3. Contorno exterior de 1 px, del tono más oscuro de lo que rodea (nunca
 *     negro: la regla de la guía de estilo).
 */
export function combinar(
  capas: Capa[],
  rampaDe: (mat: number) => Rampa,
  rg: Region,
  opciones: OpcionesCombinar = {},
): Uint8ClampedArray {
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
  const rampa = (m: number): Rampa => (rampas[m] ??= rampaDe(m));

  const out = new Uint8ClampedArray(n * 4);
  const pinta = (k: number, color: number): void => {
    out[k * 4] = (color >> 16) & 0xff;
    out[k * 4 + 1] = (color >> 8) & 0xff;
    out[k * 4 + 2] = color & 0xff;
    out[k * 4 + 3] = 255;
  };

  // Los 4 vecinos, sin crear arrays: esto corre una vez por píxel (en la hoja
  // del avatar, 450.000 veces) y con arrays tardaba ~90 ms por avatar.
  const vec = new Int32Array(4);
  const vecinos = (x: number, y: number): number => {
    let c = 0;
    const k = y * w + x;
    if (x > 0) vec[c++] = k - 1;
    if (x < w - 1) vec[c++] = k + 1;
    if (y > 0) vec[c++] = k - w;
    if (y < h - 1) vec[c++] = k + w;
    return c;
  };
  const contorno = opciones.contorno !== false;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const c = vecinos(x, y);
      if (mat[k] !== 0) {
        let delante = -1;
        for (let j = 0; j < c; j++) {
          const q = vec[j];
          if (mat[q] !== 0 && depth[q] + BORDE < depth[k] && (delante < 0 || depth[q] < depth[delante])) delante = q;
        }
        if (delante >= 0) pinta(k, rampa(mat[delante])[4]);
        else pinta(k, rampa(mat[k])[Math.min(shade[k], 4)]);
        continue;
      }
      if (!contorno) continue;
      let junto = -1;
      for (let j = 0; j < c; j++) {
        const q = vec[j];
        if (mat[q] !== 0 && (junto < 0 || depth[q] < depth[junto])) junto = q;
      }
      if (junto >= 0) pinta(k, rampa(mat[junto])[4]);
    }
  }
  return out;
}

/** Color y opacidad de TODAS las sombras en el suelo (guía de estilo, punto 7) */
export const SOMBRA = { color: [26, 20, 32], alfa: 70 } as const;

/**
 * Sombra elíptica en el suelo, pintada sólo donde no hay nada (queda debajo
 * del objeto). `cx, cy` en píxeles de `out`.
 */
export function sombraElipse(
  out: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 > 1) continue;
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
