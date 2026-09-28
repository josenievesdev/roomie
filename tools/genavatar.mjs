// Genera las capas del avatar en public/assets/avatar/*.png y las anclas de
// la cara en public/assets/avatar/cara.json.
//
// Cada capa (el cuerpo, cada forma de cabeza, cada peinado, cada prenda) se
// modela en 3D (`tools/avatar/model.mjs`) y se fotografía con la cámara
// isométrica del juego en las 8 direcciones y todas las poses. El resultado
// no son colores sino material + luz + profundidad por píxel; el navegador
// combina las capas del aspecto de cada jugador y las colorea
// (`src/render/avatarSheet.ts`).
//
// La cara no es una capa: son sellos que el navegador pinta en anclas
// (`src/render/cara.ts`). Aquí se calcula, para cada forma de cara y cada
// fotograma, dónde cae cada rasgo (en la piel de verdad, con mofletes y
// barbilla) y cuánto mira a la cámara.
//
// Uso:
//   node tools/genavatar.mjs                      todas las capas y las anclas
//   node tools/genavatar.mjs --solo=cuerpo,pelo/corto
//   node tools/genavatar.mjs --preview=<carpeta>   además, vistas previas
//        ampliadas (leídas de los PNG, como el juego)
//   node tools/genavatar.mjs --sin-generar --preview=<carpeta>
import fs from "node:fs";
import path from "node:path";
import { decodePng, encodePng, upscale } from "./avatar/png.mjs";
import { CAPAS, RASGOS, direccionRasgo, pose, skeleton } from "./avatar/model.mjs";
import { deFrente, normalGrupo, profByte, proyectar, sobreSuperficie, trazar } from "./avatar/render.mjs";
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
import { ANCLAS, leerDatosCara } from "../src/render/cara.ts";
import {
  BARBAS,
  BOCAS,
  CARAS,
  CEJAS,
  COLORES_OJOS,
  DEFAULT_LOOK,
  DETALLES,
  ESTILOS,
  NARICES,
  OJOS,
  PIELES,
  sanitizeLook,
} from "../src/state/look.ts";

const OUT = path.join("public", "assets", "avatar");
const FICHERO_CARA = path.join(OUT, "cara.json");
const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];
const solo = arg("solo")?.split(",");
const carpetaPreview = arg("preview");
const sinGenerar = process.argv.includes("--sin-generar");

fs.mkdirSync(OUT, { recursive: true });

/** Todos los fotogramas de la hoja: [dirección, animación, índice] */
function* fotogramas() {
  for (let dir = 0; dir < HOJA.dirs; dir++) {
    for (const anim of ANIMS) {
      for (let i = 0; i < HOJA.anims[anim].n; i++) yield [dir, anim, i];
    }
  }
}

/**
 * Lo que no se dibuja en una capa pero le hace sombra: la cabeza al cuello y
 * el cuerpo a la barbilla (van en capas distintas).
 */
function oclusoresDe(nombre, J) {
  if (nombre === "cuerpo") return CAPAS["cabeza/redonda"](J);
  if (nombre.startsWith("cabeza/")) return CAPAS.cuerpo(J);
  return [];
}

function generarCapa(nombre) {
  const construir = CAPAS[nombre];
  const img = new Uint8Array(ANCHO_HOJA * ALTO_HOJA * 4);
  const { frameW: W, frameH: H, anclaX, anclaY } = HOJA;
  for (const [dir, anim, i] of fotogramas()) {
    const J = skeleton(pose(anim, i));
    const f = trazar(construir(J), dir, W, H, anclaX, anclaY, { oclusores: oclusoresDe(nombre, J) });
    const m = marco(anim, i, dir);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (f.mat[k] === 0) continue;
        const o = ((m.y + y) * ANCHO_HOJA + m.x + x) * 4;
        img[o] = f.mat[k];
        // La luz en los bits bajos; la zona de la piel (la barba), en los altos
        img[o + 1] = f.shade[k] | (f.zona[k] << 2);
        img[o + 2] = profByte(f.depth[k]);
        img[o + 3] = 255;
      }
    }
  }
  const png = encodePng(ANCHO_HOJA, ALTO_HOJA, img);
  fs.writeFileSync(path.join(OUT, ficheroCapa(nombre)), png);
  return png.length;
}

/**
 * Las anclas de la cara de una forma: por fotograma y por rasgo, el píxel
 * donde cae, la profundidad de la piel y cuánto mira a la cámara.
 */
function anclasDe(forma) {
  const bytes = new Uint8Array(HOJA.dirs * HOJA.columnas * ANCLAS.length * 4);
  const { anclaX, anclaY } = HOJA;
  for (const [dir, anim, i] of fotogramas()) {
    const J = skeleton(pose(anim, i));
    const [cabeza] = CAPAS[`cabeza/${forma}`](J);
    const col = HOJA.anims[anim].desde + i;
    ANCLAS.forEach((a, n) => {
      const [giro, altura] = RASGOS[a];
      const p = sobreSuperficie(cabeza, J.head, direccionRasgo(J, giro, altura));
      const pr = proyectar(p, dir, anclaX, anclaY);
      const frente = deFrente(normalGrupo(cabeza, p), dir);
      const o = ((dir * HOJA.columnas + col) * ANCLAS.length + n) * 4;
      bytes[o] = Math.max(0, Math.min(255, Math.floor(pr.x)));
      bytes[o + 1] = Math.max(0, Math.min(255, Math.floor(pr.y)));
      bytes[o + 2] = profByte(pr.t);
      bytes[o + 3] = Math.round((Math.max(-1, Math.min(1, frente)) + 1) * 100);
    });
  }
  return Buffer.from(bytes).toString("base64");
}

if (!sinGenerar) {
  const nombres = Object.keys(CAPAS).filter((n) => !solo || solo.includes(n));
  let total = 0;
  for (const nombre of nombres) {
    const t0 = Date.now();
    const bytes = generarCapa(nombre);
    total += bytes;
    console.log(`  ${nombre.padEnd(22)} ${(bytes / 1024).toFixed(1).padStart(6)} KB  ${Date.now() - t0} ms`);
  }
  console.log(`${nombres.length} capas, ${(total / 1024).toFixed(0)} KB en ${OUT}`);

  // Las anclas se rehacen siempre: son baratas y dependen de las cabezas
  const cara = {
    version: 1,
    anclas: ANCLAS,
    columnas: HOJA.columnas,
    formas: Object.fromEntries(Object.keys(CARAS).map((f) => [f, anclasDe(f)])),
  };
  fs.writeFileSync(FICHERO_CARA, JSON.stringify(cara));
  console.log(`anclas de la cara: ${Object.keys(CARAS).length} formas, ${(fs.statSync(FICHERO_CARA).size / 1024).toFixed(1)} KB`);
}

// ---------------------------------------------------------------- Vistas previas

if (carpetaPreview) {
  fs.mkdirSync(carpetaPreview, { recursive: true });
  const cache = new Map();
  const capa = (nombre) => {
    if (!cache.has(nombre)) cache.set(nombre, decodePng(fs.readFileSync(path.join(OUT, ficheroCapa(nombre)))));
    return cache.get(nombre);
  };
  const datosCara = leerDatosCara(JSON.parse(fs.readFileSync(FICHERO_CARA, "utf8")));
  const FONDO = [44, 110, 116]; // el suelo turquesa del club, para juzgar el contraste

  const L = (o) => sanitizeLook({ ...DEFAULT_LOOK, ...o });
  const LOOKS = [
    DEFAULT_LOOK,
    L({ piel: "p4", cara: "ovalada", ojos: "pestanas", ojosColor: "marron", cejas: "arqueadas", boca: "labios", pelo: "largo", peloColor: "negro", torso: "sudadera", torsoColor: "rojo", piernasColor: "negro", pies: "botas", piesColor: "marron" }),
    L({ piel: "p1", cara: "corazon", ojos: "grandes", ojosColor: "azul", nariz: "respingona", boca: "sonrisa", detalle: "pecasRubor", pelo: "coleta", peloColor: "rubio", torso: "tirantes", torsoColor: "menta", piernas: "falda", piernasColor: "marino", piesColor: "rosa" }),
    L({ piel: "p6", cara: "cuadrada", ojos: "almendrados", cejas: "gruesas", nariz: "ancha", boca: "amplia", barba: "barba", pelo: "afro", peloColor: "negro", torso: "chaqueta", torsoColor: "amarillo", piernas: "corto", piernasColor: "beige" }),
    L({ piel: "p3", cara: "mofletes", ojos: "felices", nariz: "boton", boca: "dientes", detalle: "rubor", pelo: "mono", peloColor: "pelirrojo", torso: "mangalarga", torsoColor: "azul", piernasColor: "gris", pies: "botas", piesColor: "negro" }),
    L({ piel: "p5", ojos: "finos", ojosColor: "avellana", cejas: "decididas", nariz: "larga", boca: "picara", barba: "candado", pelo: "rapado", peloColor: "castano_oscuro", torsoColor: "blanco", piesColor: "rojo" }),
  ].filter((l) => capasDe(l).every((c) => fs.existsSync(path.join(OUT, ficheroCapa(c)))));

  /** Pega un trozo de fotograma compuesto en una imagen grande */
  function pegar(img, ancho, look, anim, i, dir, rec, dx, dy) {
    const m = marco(anim, i, dir);
    const rgba = componer(capasDe(look).map(capa), look, datosCara, { x: m.x + rec.x, y: m.y + rec.y, w: rec.w, h: rec.h });
    for (let y = 0; y < rec.h; y++) {
      for (let x = 0; x < rec.w; x++) {
        const s = (y * rec.w + x) * 4;
        const d = ((dy + y) * ancho + dx + x) * 4;
        for (let c = 0; c < 4; c++) img[d + c] = rgba[s + c];
      }
    }
  }

  /** Rejilla: filas = aspectos, columnas = lo que diga `celdas`, recortado a `rec` */
  function rejilla(fichero, looks, celdas, escala, rec = { x: 0, y: 0, w: HOJA.frameW, h: HOJA.frameH }) {
    const ancho = celdas.length * rec.w;
    const alto = looks.length * rec.h;
    const img = new Uint8Array(ancho * alto * 4);
    looks.forEach((look, fila) => {
      celdas.forEach(([anim, i, dir], col) => pegar(img, ancho, look, anim, i, dir, rec, col * rec.w, fila * rec.h));
    });
    const big = upscale(ancho, alto, img, escala, FONDO);
    fs.writeFileSync(path.join(carpetaPreview, fichero), encodePng(ancho * escala, alto * escala, big));
  }

  const dirs = [0, 1, 2, 3, 4, 5, 6, 7];
  rejilla("direcciones.png", LOOKS, dirs.map((d) => ["idle", 0, d]), 3);
  rejilla("caminar-sureste.png", LOOKS, [...Array(8).keys()].map((i) => ["walk", i, 3]), 3);
  rejilla("caminar-sur.png", LOOKS, [...Array(8).keys()].map((i) => ["walk", i, 4]), 3);
  rejilla("poses.png", LOOKS, [["idle", 1, 4], ["sit", 0, 5], ["sit", 0, 3], ["wave", 0, 4], ["wave", 1, 4], ["walk", 2, 6]], 3);

  // La cara de cerca: la cabeza en las direcciones en que se ve la cara
  const CABEZA = { x: 8, y: 10, w: 32, h: 34 };
  const deCara = [["idle", 0, 2], ["idle", 0, 3], ["idle", 0, 4], ["idle", 0, 5], ["idle", 0, 6], ["idle", 1, 4]];
  rejilla("caras.png", LOOKS, deCara, 6, CABEZA);

  // El catálogo de la cara: cada opción, de frente y de tres cuartos
  const catalogo = [
    ["cara", CARAS],
    ["ojos", OJOS],
    ["ojosColor", COLORES_OJOS],
    ["cejas", CEJAS],
    ["nariz", NARICES],
    ["boca", BOCAS],
    ["detalle", DETALLES],
    ["barba", BARBAS],
    ["piel", PIELES],
  ];
  for (const [campo, opciones] of catalogo) {
    const looks = Object.keys(opciones).map((id) => L({ [campo]: id, pelo: campo === "barba" ? "rapado" : "corto" }));
    rejilla(`rasgos-${campo}.png`, looks, [["idle", 0, 4], ["idle", 0, 3], ["idle", 0, 5], ["idle", 1, 4]], 6, CABEZA);
  }

  // Los peinados, en las direcciones que enseñan cómo son por detrás y de lado
  const peinados = Object.keys(ESTILOS.pelo)
    .map((pelo, i) =>
      L({ pelo, peloColor: ["castano", "negro", "rubio", "pelirrojo", "castano_oscuro", "miel"][i % 6], piel: ["p2", "p5", "p1", "p4", "p6", "p3"][i % 6] }),
    )
    .filter((l) => capasDe(l).every((c) => fs.existsSync(path.join(OUT, ficheroCapa(c)))));
  rejilla("peinados.png", peinados, [0, 1, 2, 3, 4, 6].map((d) => ["idle", 0, d]), 3, { x: 4, y: 6, w: 40, h: 50 });
  console.log(`vistas previas en ${carpetaPreview}`);
}
