// Prueba del avatar: que todo lo que el catálogo del aspecto ofrece se pueda
// dibujar, y que el aspecto viaje por la red sin perderse. Sin servidor ni
// navegador: lee los mismos ficheros que el juego.
//
//   node tools/prueba-avatar.mjs
//
// Falla si un estilo no tiene su capa generada, si un rasgo de la cara no
// tiene sello, si falta la forma de una cara en las anclas, o si el código
// compacto del aspecto no va y vuelve igual.

import fs from "node:fs";
import path from "node:path";
import { ALTO_HOJA, ANCHO_HOJA, HOJA, TODAS_LAS_CAPAS, capasDe, componer, ficheroCapa } from "../src/render/avatarSheet.ts";
import { ANCLAS, SELLOS, leerDatosCara } from "../src/render/cara.ts";
import {
  BARBAS,
  BOCAS,
  CAMPOS_LOOK,
  CARAS,
  CEJAS,
  DEFAULT_LOOK,
  DETALLES,
  NARICES,
  OJOS,
  codificarLook,
  decodificarLook,
  lookAlAzar,
  lookKey,
  mismoLook,
  opcionesDe,
  sanitizeLook,
} from "../src/state/look.ts";
import { decodePng } from "./avatar/png.mjs";

const AVATAR = path.join("public", "assets", "avatar");
let fallos = 0;
const ok = (cond, texto) => {
  console.log(`${cond ? "  ok " : "FALLA"}  ${texto}`);
  if (!cond) fallos++;
};

// ---------------------------------------------------------------- Capas
console.log("\n=== Capas ===");
const faltan = TODAS_LAS_CAPAS.filter((c) => !fs.existsSync(path.join(AVATAR, ficheroCapa(c))));
ok(faltan.length === 0, `cada estilo del catálogo tiene su capa generada (${TODAS_LAS_CAPAS.length})`, faltan.join(", "));
if (faltan.length) console.log("       faltan:", faltan.join(", "), "→ node tools/genavatar.mjs");
const tamanos = TODAS_LAS_CAPAS.filter((c) => !faltan.includes(c)).map((c) => {
  const png = decodePng(fs.readFileSync(path.join(AVATAR, ficheroCapa(c))));
  return png.width === ANCHO_HOJA && png.height === ALTO_HOJA;
});
ok(tamanos.every(Boolean), "todas las capas miden lo que la hoja");

// ---------------------------------------------------------------- Cara
console.log("\n=== Cara ===");
const bruto = JSON.parse(fs.readFileSync(path.join(AVATAR, "cara.json"), "utf8"));
const datos = leerDatosCara(bruto);
ok(datos !== null, "cara.json se entiende");
if (datos) {
  const esperado = HOJA.dirs * HOJA.columnas * ANCLAS.length * 4;
  const formas = Object.keys(CARAS);
  ok(formas.every((f) => datos.formas[f]?.length === esperado), `cada forma de cara tiene sus anclas (${formas.join(", ")})`);
  const fuera = [];
  for (const [forma, bytes] of Object.entries(datos.formas)) {
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i] >= HOJA.frameW || bytes[i + 1] >= HOJA.frameH) fuera.push(forma);
    }
  }
  ok(fuera.length === 0, "todas las anclas caen dentro de su fotograma");
  // De frente (dirección 4, quieto), los dos ojos se ven y a la misma altura
  const b = datos.formas.redonda;
  const base = (4 * HOJA.columnas + 0) * ANCLAS.length * 4;
  const ojo = (n) => ({ y: b[base + n * 4 + 1], frente: b[base + n * 4 + 3] / 100 - 1 });
  ok(ojo(0).frente > 0.62 && ojo(1).frente > 0.62 && ojo(0).y === ojo(1).y, "de frente, los dos ojos miran a la cámara y están a la misma altura");
  // De espaldas no se ve la cara
  const atras = (0 * HOJA.columnas + 0) * ANCLAS.length * 4;
  ok(b[atras + 3] / 100 - 1 < 0 && b[atras + 5 * 4 + 3] / 100 - 1 < 0, "de espaldas, ni ojos ni boca miran a la cámara");
}
const conSello = (catalogo, sellos) => Object.keys(catalogo).every((id) => id in sellos);
ok(conSello(OJOS, SELLOS.ojos), "cada estilo de ojos tiene su sello");
ok(conSello(CEJAS, SELLOS.cejas), "cada estilo de cejas tiene su sello");
ok(conSello(NARICES, SELLOS.nariz), "cada nariz tiene su sello");
ok(conSello(BOCAS, SELLOS.boca), "cada boca tiene su sello");
ok(conSello(DETALLES, SELLOS.detalle), "cada detalle tiene su sello");
ok(conSello(BARBAS, SELLOS.barba), "cada barba tiene sus zonas");

// Pintar de verdad: cada rasgo cambia la cara (si un sello no pinta nada, no sirve de nada)
const capas = new Map();
const capa = (n) => {
  if (!capas.has(n)) capas.set(n, decodePng(fs.readFileSync(path.join(AVATAR, ficheroCapa(n)))));
  return capas.get(n);
};
const CARA_DE_FRENTE = { x: 4 * 0 + 8, y: 4 * HOJA.frameH + 10, w: 32, h: 34 };
const pintar = (look) => Buffer.from(componer(capasDe(look).map(capa), look, datos, CARA_DE_FRENTE)).toString("base64");
if (datos && faltan.length === 0) {
  const base = pintar({ ...DEFAULT_LOOK, pelo: "rapado" });
  const sinEfecto = [];
  for (const [campo, catalogo] of [
    ["ojos", OJOS],
    ["cejas", CEJAS],
    ["nariz", NARICES],
    ["boca", BOCAS],
    ["detalle", DETALLES],
    ["barba", BARBAS],
    ["cara", CARAS],
  ]) {
    for (const id of Object.keys(catalogo)) {
      if (id === DEFAULT_LOOK[campo]) continue;
      if (pintar({ ...DEFAULT_LOOK, pelo: "rapado", [campo]: id }) === base) sinEfecto.push(`${campo}/${id}`);
    }
  }
  ok(sinEfecto.length === 0, "cada opción de la cara se nota de frente", sinEfecto.join(", "));
  if (sinEfecto.length) console.log("       sin efecto:", sinEfecto.join(", "));
  ok(pintar({ ...DEFAULT_LOOK, pelo: "rapado", ojosColor: "azul" }) !== base, "el color de los ojos se nota");
}

// ---------------------------------------------------------------- Aspecto
console.log("\n=== Aspecto ===");
ok(CAMPOS_LOOK.every((c) => opcionesDe(c).length > 0 && opcionesDe(c).length <= 36), "cada campo tiene entre 1 y 36 opciones");
ok(CAMPOS_LOOK.every((c) => opcionesDe(c).includes(DEFAULT_LOOK[c])), "el aspecto por defecto sale del catálogo");

let azar = 12345;
const aleatorio = () => ((azar = (azar * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
let idaYVuelta = true;
for (let i = 0; i < 500; i++) {
  const l = lookAlAzar(DEFAULT_LOOK, CAMPOS_LOOK, aleatorio);
  if (!mismoLook(decodificarLook(codificarLook(l)), l)) idaYVuelta = false;
}
ok(idaYVuelta, "500 aspectos al azar van y vuelven igual por el código compacto");
const codigo = codificarLook(DEFAULT_LOOK);
ok(codigo.length === CAMPOS_LOOK.length + 1 && codigo.length <= 20, `el código es corto (${codigo.length} caracteres: "${codigo}")`);
ok(
  JSON.stringify(sanitizeLook({ ...DEFAULT_LOOK, cara: "triangular", ojos: 7 })) === JSON.stringify({ ...DEFAULT_LOOK }),
  "un rasgo inventado vuelve al de por defecto",
);
ok(mismoLook(decodificarLook("basura"), DEFAULT_LOOK) && mismoLook(decodificarLook(null), DEFAULT_LOOK), "un código que no se entiende da el aspecto por defecto");
ok(mismoLook(decodificarLook("1" + "z".repeat(CAMPOS_LOOK.length)), DEFAULT_LOOK), "un índice fuera del catálogo da el valor por defecto");
const antiguo = { piel: "p4", pelo: "coleta", peloColor: "rubio", torso: "sudadera", torsoColor: "rojo", piernas: "falda", piernasColor: "marino", pies: "botas", piesColor: "negro" };
const convertido = sanitizeLook(antiguo);
ok(
  convertido.pelo === "coleta" && convertido.torsoColor === "rojo" && convertido.cara === "redonda" && convertido.ojos === "redondos",
  "un aspecto de antes de las caras conserva lo suyo y gana la cara de siempre",
);
ok(lookKey(convertido).split(".").length === CAMPOS_LOOK.length, "la clave del aspecto tiene un trozo por campo");

console.log(fallos === 0 ? "\nAVATAR OK" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
