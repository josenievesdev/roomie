// Genera las capas del avatar en public/assets/avatar/*.png.
//
// Cada capa (el cuerpo, cada peinado, cada prenda) se modela en 3D
// (`tools/avatar/model.mjs`) y se fotografía con la cámara isométrica del
// juego en las 8 direcciones y todas las poses. El resultado no son colores
// sino material + luz + profundidad por píxel; el navegador combina las capas
// del aspecto de cada jugador y las colorea (`src/render/avatarSheet.ts`).
//
// Uso:
//   node tools/genavatar.mjs                      todas las capas
//   node tools/genavatar.mjs --solo=cuerpo,pelo/corto
//   node tools/genavatar.mjs --preview=<carpeta>   además, vistas previas
//        ampliadas de varios aspectos (leídas de los PNG, como el juego)
import fs from "node:fs";
import path from "node:path";
import { decodePng, encodePng, upscale } from "./avatar/png.mjs";
import { CAPAS, pose, rasgos, skeleton } from "./avatar/model.mjs";
import { pintarCara, profByte, trazar } from "./avatar/render.mjs";
import {
  ALTO_HOJA,
  ANCHO_HOJA,
  ANIMS,
  HOJA,
  capasDe,
  componer,
  ficheroCapa,
  marco,
} from "../src/render/avatarSheet.ts";
import { DEFAULT_LOOK } from "../src/state/look.ts";

const OUT = path.join("public", "assets", "avatar");
const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];
const solo = arg("solo")?.split(",");
const carpetaPreview = arg("preview");
const sinGenerar = process.argv.includes("--sin-generar");

fs.mkdirSync(OUT, { recursive: true });

function generarCapa(nombre) {
  const construir = CAPAS[nombre];
  const img = new Uint8Array(ANCHO_HOJA * ALTO_HOJA * 4);
  const { frameW: W, frameH: H, anclaX, anclaY } = HOJA;
  for (let dir = 0; dir < HOJA.dirs; dir++) {
    for (const anim of ANIMS) {
      for (let i = 0; i < HOJA.anims[anim].n; i++) {
        const J = skeleton(pose(anim, i));
        const f = trazar(construir(J), dir, W, H, anclaX, anclaY);
        if (nombre === "cuerpo") pintarCara(f, rasgos(J), dir, W, H, anclaX, anclaY);
        const m = marco(anim, i, dir);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const k = y * W + x;
            if (f.mat[k] === 0) continue;
            const o = ((m.y + y) * ANCHO_HOJA + m.x + x) * 4;
            img[o] = f.mat[k];
            img[o + 1] = f.shade[k];
            img[o + 2] = profByte(f.depth[k]);
            img[o + 3] = 255;
          }
        }
      }
    }
  }
  const png = encodePng(ANCHO_HOJA, ALTO_HOJA, img);
  fs.writeFileSync(path.join(OUT, ficheroCapa(nombre)), png);
  return png.length;
}

if (!sinGenerar) {
  const nombres = Object.keys(CAPAS).filter((n) => !solo || solo.includes(n));
  let total = 0;
  for (const nombre of nombres) {
    const t0 = Date.now();
    const bytes = generarCapa(nombre);
    total += bytes;
    console.log(`  ${nombre.padEnd(20)} ${(bytes / 1024).toFixed(1).padStart(6)} KB  ${Date.now() - t0} ms`);
  }
  console.log(`${nombres.length} capas, ${(total / 1024).toFixed(0)} KB en ${OUT}`);
}

// ---------------------------------------------------------------- Vistas previas

if (carpetaPreview) {
  fs.mkdirSync(carpetaPreview, { recursive: true });
  const cache = new Map();
  const capa = (nombre) => {
    if (!cache.has(nombre)) cache.set(nombre, decodePng(fs.readFileSync(path.join(OUT, ficheroCapa(nombre)))));
    return cache.get(nombre);
  };
  const FONDO = [44, 110, 116]; // el suelo turquesa del club, para juzgar el contraste

  const LOOKS = [
    DEFAULT_LOOK,
    { piel: "p4", pelo: "largo", peloColor: "negro", torso: "sudadera", torsoColor: "rojo", piernas: "pantalon", piernasColor: "negro", pies: "botas", piesColor: "marron" },
    { piel: "p1", pelo: "coleta", peloColor: "rubio", torso: "tirantes", torsoColor: "menta", piernas: "falda", piernasColor: "marino", pies: "zapatillas", piesColor: "rosa" },
    { piel: "p6", pelo: "afro", peloColor: "negro", torso: "chaqueta", torsoColor: "amarillo", piernas: "corto", piernasColor: "beige", pies: "zapatillas", piesColor: "blanco" },
    { piel: "p3", pelo: "mono", peloColor: "pelirrojo", torso: "mangalarga", torsoColor: "azul", piernas: "pantalon", piernasColor: "gris", pies: "botas", piesColor: "negro" },
    { piel: "p5", pelo: "rapado", peloColor: "castano_oscuro", torso: "camiseta", torsoColor: "blanco", piernas: "pantalon", piernasColor: "vaquero", pies: "zapatillas", piesColor: "rojo" },
  ].filter((l) => capasDe(l).every((c) => fs.existsSync(path.join(OUT, ficheroCapa(c)))));

  /** Rejilla de fotogramas: filas = aspectos, columnas = lo que diga `celdas` */
  function rejilla(fichero, celdas, escala) {
    const { frameW: W, frameH: H } = HOJA;
    const ancho = celdas.length * W;
    const alto = LOOKS.length * H;
    const img = new Uint8Array(ancho * alto * 4);
    LOOKS.forEach((look, fila) => {
      const capas = capasDe(look).map(capa);
      celdas.forEach(([anim, i, dir], col) => {
        const m = marco(anim, i, dir);
        const rgba = componer(capas, look, { x: m.x, y: m.y, w: W, h: H });
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const s = (y * W + x) * 4;
            const d = ((fila * H + y) * ancho + col * W + x) * 4;
            img[d] = rgba[s];
            img[d + 1] = rgba[s + 1];
            img[d + 2] = rgba[s + 2];
            img[d + 3] = rgba[s + 3];
          }
        }
      });
    });
    const big = upscale(ancho, alto, img, escala, FONDO);
    fs.writeFileSync(path.join(carpetaPreview, fichero), encodePng(ancho * escala, alto * escala, big));
  }

  const dirs = [0, 1, 2, 3, 4, 5, 6, 7];
  rejilla("direcciones.png", dirs.map((d) => ["idle", 0, d]), 3);
  rejilla("caminar-sureste.png", [...Array(8).keys()].map((i) => ["walk", i, 3]), 3);
  rejilla("caminar-sur.png", [...Array(8).keys()].map((i) => ["walk", i, 4]), 3);
  rejilla("poses.png", [["idle", 1, 4], ["sit", 0, 5], ["sit", 0, 3], ["wave", 0, 4], ["wave", 1, 4], ["walk", 2, 6]], 3);
  console.log(`vistas previas en ${carpetaPreview}`);
}
