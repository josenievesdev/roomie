// Genera la fuente pixel de Roomie: public/assets/fuente/roomie.ttf.
//
// Un TrueType de verdad, construido a mano desde los glifos de
// `tools/fuente/glifos.mjs`: cada píxel de tinta es un cuadrado del contorno.
// Con 12 píxeles por em, a 12 px de tamaño cada píxel de la fuente es un
// píxel de pantalla, a 24 px son dos... siempre nítido. Y al ser una fuente
// del navegador, lo que no tiene (emojis, otros alfabetos) lo pone él con la
// fuente de reserva.
//
// Uso: node tools/genfuente.mjs
import fs from "node:fs";
import path from "node:path";
import { GLIFOS, METRICAS } from "./fuente/glifos.mjs";

const PX = 100; // unidades por píxel de la fuente
const EM = METRICAS.em * PX; // 1200: a 12 px, 1 píxel de letra = 1 de pantalla
const ASC = METRICAS.ascenso * PX; // hasta la tilde de las mayúsculas
const DESC = METRICAS.descenso * PX; // rabos de g, j, p, q, y
const OUT = path.join("public", "assets", "fuente");

// ---------------------------------------------------------------- Glifos → contornos

/** Rectángulos de tinta de un glifo, uniendo píxeles en tiras horizontales y verticales */
function rectangulos({ t, r }) {
  const tiras = [];
  r.forEach((fila, i) => {
    const y = t - i; // fila en píxeles desde la línea base (su borde inferior)
    let x = 0;
    while (x < fila.length) {
      if (fila[x] !== "#") {
        x++;
        continue;
      }
      let fin = x;
      while (fin < fila.length && fila[fin] === "#") fin++;
      tiras.push({ x0: x, x1: fin, y0: y, y1: y + 1 });
      x = fin;
    }
  });
  // Une tiras iguales en filas seguidas: menos contornos, mismo dibujo
  const unidas = [];
  for (const s of tiras.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1 || b.y0 - a.y0)) {
    const encima = unidas.find((u) => u.x0 === s.x0 && u.x1 === s.x1 && u.y0 === s.y1);
    if (encima) encima.y0 = s.y0;
    else unidas.push({ ...s });
  }
  return unidas;
}

const glifos = [];
// 0: .notdef, una caja hueca (sólo se ve si el navegador no encuentra reserva)
glifos.push({
  cp: null,
  avance: 6 * PX,
  contornos: [
    // Exterior en sentido horario, interior al revés: el hueco
    [[PX / 2, 0], [PX / 2, 9 * PX], [4.5 * PX, 9 * PX], [4.5 * PX, 0]],
    [[1.5 * PX, PX], [3.5 * PX, PX], [3.5 * PX, 8 * PX], [1.5 * PX, 8 * PX]],
  ],
});
for (const [ch, glifo] of Object.entries(GLIFOS)) {
  const ancho = glifo.r[0].length;
  const contornos = ch === " " ? [] : rectangulos(glifo).map(({ x0, x1, y0, y1 }) => [
    // Sentido horario con Y hacia arriba: abajo-izq, arriba-izq, arriba-der, abajo-der
    [x0 * PX, y0 * PX],
    [x0 * PX, y1 * PX],
    [x1 * PX, y1 * PX],
    [x1 * PX, y0 * PX],
  ]);
  glifos.push({ cp: ch.codePointAt(0), avance: (ancho + 1) * PX, contornos });
}
glifos.sort((a, b) => (a.cp ?? -1) - (b.cp ?? -1));

// ---------------------------------------------------------------- Escritura binaria

class Buf {
  constructor() {
    this.b = [];
  }
  u8(v) {
    this.b.push(v & 0xff);
    return this;
  }
  u16(v) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v) {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff);
  }
  tag(s) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  bytes(arr) {
    for (const v of arr) this.u8(v);
    return this;
  }
  pad4() {
    while (this.b.length % 4) this.u8(0);
    return this;
  }
  get length() {
    return this.b.length;
  }
  get data() {
    return Buffer.from(this.b);
  }
}

// ---------------------------------------------------------------- glyf + loca + hmtx

let bbox = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
let maxPuntos = 0;
let maxContornos = 0;
const glyf = new Buf();
const loca = [];
const hmtx = new Buf();
for (const gl of glifos) {
  loca.push(glyf.length);
  const puntos = gl.contornos.flat();
  if (puntos.length === 0) {
    hmtx.u16(gl.avance).i16(0);
    continue;
  }
  const xs = puntos.map((p) => p[0]);
  const ys = puntos.map((p) => p[1]);
  const [xMin, xMax, yMin, yMax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  bbox = {
    xMin: Math.min(bbox.xMin, xMin),
    yMin: Math.min(bbox.yMin, yMin),
    xMax: Math.max(bbox.xMax, xMax),
    yMax: Math.max(bbox.yMax, yMax),
  };
  maxPuntos = Math.max(maxPuntos, puntos.length);
  maxContornos = Math.max(maxContornos, gl.contornos.length);
  glyf.i16(gl.contornos.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  let fin = -1;
  for (const c of gl.contornos) {
    fin += c.length;
    glyf.u16(fin);
  }
  glyf.u16(0); // sin instrucciones
  for (let i = 0; i < puntos.length; i++) glyf.u8(0x01); // todos sobre la curva
  let px = 0;
  let py = 0;
  for (const [x] of puntos) {
    glyf.i16(x - px);
    px = x;
  }
  for (const [, y] of puntos) {
    glyf.i16(y - py);
    py = y;
  }
  glyf.pad4();
  hmtx.u16(gl.avance).i16(xMin);
}
loca.push(glyf.length);
const locaBuf = new Buf();
for (const off of loca) locaBuf.u32(off);

// ---------------------------------------------------------------- cmap (formato 4)

const mapeados = glifos.map((gl, gid) => ({ cp: gl.cp, gid })).filter((m) => m.cp !== null && m.cp <= 0xffff);
// Un segmento por cada tramo de códigos seguidos con glifos seguidos
const segmentos = [];
for (const m of mapeados) {
  const ult = segmentos[segmentos.length - 1];
  if (ult && m.cp === ult.fin + 1 && m.gid === ult.gid0 + (m.cp - ult.ini)) ult.fin = m.cp;
  else segmentos.push({ ini: m.cp, fin: m.cp, gid0: m.gid });
}
segmentos.push({ ini: 0xffff, fin: 0xffff, gid0: 0 }); // centinela obligatorio: 0xFFFF → glifo 0
const segX2 = segmentos.length * 2;
const busca = 2 ** Math.floor(Math.log2(segmentos.length)) * 2;
const sub = new Buf();
sub.u16(4).u16(16 + segmentos.length * 8).u16(0).u16(segX2).u16(busca).u16(Math.log2(busca / 2)).u16(segX2 - busca);
for (const s of segmentos) sub.u16(s.fin);
sub.u16(0);
for (const s of segmentos) sub.u16(s.ini);
// idDelta: (código + delta) mod 65536 = glifo, escrito en complemento a dos
for (const s of segmentos) sub.u16((((s.gid0 - s.ini) % 0x10000) + 0x10000) % 0x10000);
for (let i = 0; i < segmentos.length; i++) sub.u16(0);
const cmap = new Buf();
cmap.u16(0).u16(2); // versión, dos registros apuntando a la misma subtabla
cmap.u16(0).u16(3).u32(20); // Unicode BMP
cmap.u16(3).u16(1).u32(20); // Windows Unicode BMP
cmap.bytes(sub.b);

// ---------------------------------------------------------------- head, hhea, maxp, OS/2, post, name

const avanceMax = Math.max(...glifos.map((gl) => gl.avance));
const fecha = BigInt(Math.floor(Date.UTC(2026, 8, 26) / 1000) + 2082844800); // desde 1904
const head = new Buf();
head.u16(1).u16(0).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(EM);
for (let i = 0; i < 2; i++) head.u32(Number(fecha >> 32n)).u32(Number(fecha & 0xffffffffn));
head.i16(bbox.xMin).i16(bbox.yMin).i16(bbox.xMax).i16(bbox.yMax).u16(0).u16(METRICAS.em).i16(2).i16(1).i16(0);

const hhea = new Buf();
hhea.u16(1).u16(0).i16(ASC).i16(-DESC).i16(0).u16(avanceMax).i16(0).i16(0).i16(bbox.xMax);
hhea.i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glifos.length);

const maxp = new Buf();
maxp.u32(0x00010000).u16(glifos.length).u16(maxPuntos).u16(maxContornos).u16(0).u16(0);
maxp.u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

const cps = mapeados.map((m) => m.cp);
const avgAncho = Math.round(glifos.reduce((s, gl) => s + gl.avance, 0) / glifos.length);
const os2 = new Buf();
os2.u16(4).i16(avgAncho).u16(400).u16(5).u16(0);
os2.i16(5 * PX).i16(5 * PX).i16(0).i16(PX).i16(5 * PX).i16(5 * PX).i16(0).i16(3 * PX).i16(PX).i16(3 * PX);
os2.i16(0).bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
os2.u32(0b11).u32(0).u32(0).u32(0); // Latín básico y Latín-1
os2.tag("RMIE").u16(0x0040 | 0x0080).u16(Math.min(...cps)).u16(Math.min(Math.max(...cps), 0xffff));
os2.i16(ASC).i16(-DESC).i16(0).u16(ASC).u16(DESC).u32(1).u32(0);
os2.i16(METRICAS.minuscula * PX).i16(METRICAS.mayuscula * PX).u16(0).u16(32).u16(1);

const post = new Buf();
post.u32(0x00030000).u32(0).i16(-PX).i16(PX).u32(0).u32(0).u32(0).u32(0).u32(0);

const nombres = {
  0: "Roomie, 2026. Generada por tools/genfuente.mjs",
  1: "Roomie Pixel",
  2: "Regular",
  3: "Roomie Pixel Regular 1.0",
  4: "Roomie Pixel",
  5: "Version 1.0",
  6: "RoomiePixel-Regular",
};
const nameStr = new Buf();
const nameRecs = [];
for (const [id, texto] of Object.entries(nombres)) {
  const off = nameStr.length;
  for (const c of texto) nameStr.u16(c.charCodeAt(0));
  nameRecs.push({ id: Number(id), off, len: nameStr.length - off });
}
const name = new Buf();
name.u16(0).u16(nameRecs.length).u16(6 + nameRecs.length * 12);
for (const r of nameRecs) name.u16(3).u16(1).u16(0x0409).u16(r.id).u16(r.len).u16(r.off);
name.bytes(nameStr.b);

// ---------------------------------------------------------------- Ensamblado

const tablas = { "OS/2": os2, cmap, glyf, head, hhea, hmtx, loca: locaBuf, maxp, name, post };
const tags = Object.keys(tablas).sort();
const suma = (buf) => {
  const b = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s = (s + b.readUInt32BE(i)) >>> 0;
  return s;
};
const n = tags.length;
const busqueda = 2 ** Math.floor(Math.log2(n)) * 16;
const dir = new Buf();
dir.u32(0x00010000).u16(n).u16(busqueda).u16(Math.log2(busqueda / 16)).u16(n * 16 - busqueda);
let offset = 12 + n * 16;
const cuerpos = [];
for (const tag of tags) {
  const data = tablas[tag].data;
  dir.tag(tag).u32(suma(data)).u32(offset).u32(data.length);
  const relleno = Buffer.alloc((4 - (data.length % 4)) % 4);
  cuerpos.push(data, relleno);
  offset += data.length + relleno.length;
}
const fuente = Buffer.concat([dir.data, ...cuerpos]);
// checkSumAdjustment de head: la fuente entera tiene que sumar 0xB1B0AFBA
const offHead = dir.data.indexOf(Buffer.from("head")) + 8;
const posHead = dir.data.readUInt32BE(offHead);
fuente.writeUInt32BE((0xb1b0afba - suma(fuente)) >>> 0, posHead + 8);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "roomie.ttf"), fuente);
console.log(`roomie.ttf: ${glifos.length} glifos, ${fuente.length} bytes en ${OUT}`);
