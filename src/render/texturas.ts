import Phaser from "phaser";
import type { Capa } from "./capas";

// Puente entre las capas generadas (material + luz + profundidad por píxel) y
// las texturas de Phaser. Lo usan el avatar y los muebles.

/**
 * Píxeles de una imagen ya cargada, leídos UNA vez y guardados (sobreviven
 * al reinicio de escena, como las texturas). Los PNG no llevan perfil de
 * color, así que el navegador no los retoca al dibujarlos y los valores
 * (material, banda, profundidad) llegan intactos.
 */
const pixeles = new Map<string, Capa>();

export function pixelesDe(scene: Phaser.Scene, textura: string): Capa {
  const hecha = pixeles.get(textura);
  if (hecha) return hecha;
  const img = scene.textures.get(textura).getSourceImage() as HTMLImageElement;
  const lienzo = document.createElement("canvas");
  lienzo.width = img.width;
  lienzo.height = img.height;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("sin contexto 2D");
  ctx.drawImage(img, 0, 0);
  const c: Capa = { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
  pixeles.set(textura, c);
  return c;
}

/** Vuelca RGBA en una textura de lienzo nueva (sustituye a la que hubiera) */
export function texturaDesde(
  scene: Phaser.Scene,
  key: string,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`no se pudo crear la textura ${key}`);
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  // Vecino más cercano: con muestreo lineal el pixel art se emborrona
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return tex;
}
