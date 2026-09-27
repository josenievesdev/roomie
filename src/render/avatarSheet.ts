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
import { combinar, sombraElipse, type Capa, type Region } from "./capas.ts";

export type { Capa, Region };

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

/** Sombra del suelo: elipse bajo los pies, en fotogramas de pie */
const SOMBRA_PIES = { rx: 10.5, ry: 4 } as const;

/**
 * Combina y colorea las capas de un aspecto en una región de la hoja (por
 * defecto, la hoja entera), con la sombra del suelo en los fotogramas de pie
 * (sentado, caería en el asiento). Devuelve RGBA listo para una textura.
 */
export function componer(capas: Capa[], look: Look, region?: Region): Uint8ClampedArray {
  const rg = region ?? { x: 0, y: 0, w: ANCHO_HOJA, h: ALTO_HOJA };
  const out = combinar(capas, (m) => rampaDe(look, m), rg);

  const { frameW, frameH, anclaX, anclaY } = HOJA;
  const sit = HOJA.anims.sit;
  for (let fy = Math.floor(rg.y / frameH); fy * frameH < rg.y + rg.h; fy++) {
    for (let fx = Math.floor(rg.x / frameW); fx * frameW < rg.x + rg.w; fx++) {
      if (fx >= sit.desde && fx < sit.desde + sit.n) continue;
      sombraElipse(out, rg.w, rg.h, fx * frameW + anclaX - rg.x, fy * frameH + anclaY - rg.y, SOMBRA_PIES.rx, SOMBRA_PIES.ry);
    }
  }
  return out;
}
