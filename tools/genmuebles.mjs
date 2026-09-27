// Genera el mobiliario en public/assets/muebles/: un PNG por variante y
// muebles.json con el tamaño y el ancla de cada una.
//
// Cada mueble se modela en 3D (`tools/muebles/modelos.mjs`) y se fotografía
// con la cámara del juego, igual que el avatar. Los PNG guardan material,
// luz y profundidad; el color lo pone la sala en el navegador según su tema
// (`src/render/muebleSheet.ts`).
//
// Uso:
//   node tools/genmuebles.mjs
//   node tools/genmuebles.mjs --solo=sofa,cuadro-der
//   node tools/genmuebles.mjs --preview=<carpeta>   además, cada variante
//        coloreada con los dos temas, ampliada, leída de los PNG como el juego
import fs from "node:fs";
import path from "node:path";
import { decodePng, encodePng, upscale } from "./avatar/png.mjs";
import { profByte, trazar } from "./avatar/render.mjs";
import { VARIANTES } from "./muebles/modelos.mjs";
import { componerMueble } from "../src/render/muebleSheet.ts";
import { ROOM_THEMES } from "../src/render/theme.ts";

const OUT = path.join("public", "assets", "muebles");
const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];
const solo = arg("solo")?.split(",");
const carpetaPreview = arg("preview");

/**
 * Lienzo de trazado: sobra sitio para el mueble más alto, la pared entera y,
 * por debajo del ancla, los muebles que ocupan más de una celda (la cama se
 * alarga hacia +row, que en pantalla es abajo a la izquierda).
 */
const W = 144;
const HF = 216;
const AX = 72;
const AY = 164;

fs.mkdirSync(OUT, { recursive: true });
const rutaManifiesto = path.join(OUT, "muebles.json");
const manifiesto = fs.existsSync(rutaManifiesto) ? JSON.parse(fs.readFileSync(rutaManifiesto, "utf8")) : {};

for (const v of VARIANTES) {
  if (solo && !solo.includes(v.nombre)) continue;
  const t0 = Date.now();
  const m = v.modelo();
  const f = trazar(m.grupos, v.dir, W, HF, AX, AY);

  // Recorte: lo que hay, más la sombra, más 1 px de contorno alrededor
  let x0 = W;
  let y0 = HF;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < HF; y++) {
    for (let x = 0; x < W; x++) {
      if (f.mat[y * W + x] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error(`${v.nombre}: el modelo no se ve (¿fuera de cámara?)`);
  if (m.sombra) {
    // La sombra va en el centro de la huella, que en un mueble de varias
    // celdas no es el ancla (dx, dy en px de pantalla)
    const cx = AX + (m.sombra.dx ?? 0);
    const cy = AY + (m.sombra.dy ?? 0);
    x0 = Math.min(x0, Math.floor(cx - m.sombra.rx));
    x1 = Math.max(x1, Math.ceil(cx + m.sombra.rx));
    y0 = Math.min(y0, Math.floor(cy - m.sombra.ry));
    y1 = Math.max(y1, Math.ceil(cy + m.sombra.ry));
  }
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(W - 1, x1 + 1);
  y1 = Math.min(HF - 1, y1 + 1);
  if (x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === HF - 1) {
    console.warn(`  aviso: ${v.nombre} toca el borde del lienzo; agrándalo`);
  }

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const img = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y + y0) * W + (x + x0);
      if (f.mat[k] === 0) continue;
      const o = (y * w + x) * 4;
      img[o] = f.mat[k];
      img[o + 1] = f.shade[k];
      img[o + 2] = profByte(f.depth[k]);
      img[o + 3] = 255;
    }
  }
  const fichero = `${v.nombre}.png`;
  fs.writeFileSync(path.join(OUT, fichero), encodePng(w, h, img));
  manifiesto[v.nombre] = { fichero, w, h, ax: AX - x0, ay: AY - y0, sombra: m.sombra ?? null, contorno: m.contorno !== false };
  console.log(`  ${v.nombre.padEnd(18)} ${String(w).padStart(3)}×${String(h).padEnd(3)} ${Date.now() - t0} ms`);
}

// El manifiesto se escribe ordenado: así el diff de git sólo enseña lo que cambió
const ordenado = Object.fromEntries(Object.keys(manifiesto).sort().map((k) => [k, manifiesto[k]]));
fs.writeFileSync(rutaManifiesto, JSON.stringify(ordenado, null, 2) + "\n");
console.log(`${Object.keys(ordenado).length} variantes en ${OUT}`);

// ---------------------------------------------------------------- Vistas previas

if (carpetaPreview) {
  fs.mkdirSync(carpetaPreview, { recursive: true });
  const nombres = Object.keys(ordenado).filter((n) => !n.startsWith("alfombra-") || n === "alfombra-15" || n === "alfombra-0");
  const celda = { w: 110, h: 150 };
  const porFila = 8;
  for (const [id, tema] of Object.entries(ROOM_THEMES)) {
    const filas = Math.ceil(nombres.length / porFila);
    const ancho = celda.w * porFila;
    const alto = celda.h * filas;
    const lienzo = new Uint8Array(ancho * alto * 4);
    nombres.forEach((n, i) => {
      const e = ordenado[n];
      const capa = decodePng(fs.readFileSync(path.join(OUT, e.fichero)));
      const rgba = componerMueble(capa, e, tema);
      const ox = (i % porFila) * celda.w + Math.floor(celda.w / 2) - e.ax;
      const oy = Math.floor(i / porFila) * celda.h + celda.h - 16 - e.ay;
      for (let y = 0; y < e.h; y++) {
        for (let x = 0; x < e.w; x++) {
          const s = (y * e.w + x) * 4;
          if (rgba[s + 3] === 0) continue;
          const dx = ox + x;
          const dy = oy + y;
          if (dx < 0 || dy < 0 || dx >= ancho || dy >= alto) continue;
          const d = (dy * ancho + dx) * 4;
          const a = rgba[s + 3] / 255;
          for (let c = 0; c < 3; c++) lienzo[d + c] = Math.round(rgba[s + c] * a + lienzo[d + c] * (1 - a));
          lienzo[d + 3] = 255;
        }
      }
    });
    const fondo = id === "room1" ? [192, 122, 85] : [47, 127, 140];
    fs.writeFileSync(path.join(carpetaPreview, `muebles-${id}.png`), encodePng(ancho * 2, alto * 2, upscale(ancho, alto, lienzo, 2, fondo)));
  }
  console.log(`vistas previas en ${carpetaPreview}`);
}
