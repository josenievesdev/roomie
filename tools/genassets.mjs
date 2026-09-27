// Genera los assets base de Roomie:
//  - public/assets/tileset.png  → suelos isométricos 64×32, 5 por tema
//    (A, B, cenefa, césped y asfalto)
//  - public/assets/walls.png    → caras de pared 32×112, 2 por tema (izq. y der.)
//  - public/assets/fachadas.png → fachadas de edificio 32×168 para la calle
//  - public/assets/plaza.json   → la Plaza de la Llave, 20×20, al aire libre
//  - public/assets/room1.json   → sala 12×12 en formato Tiled (editable con Tiled)
//  - public/assets/room2.json   → sala 14×10 en formato Tiled
//
// Todo se dibuja PÍXEL A PÍXEL, no con formas vectoriales: es lo que separa
// "rombos planos de colores" de pixel art de verdad. Cada superficie lleva
// biselado (la luz entra por arriba), tramado para romper el color plano,
// junta oscura entre baldosas y zócalo en las paredes.
//
// Uso: node tools/genassets.mjs                  todo (¡pisa los mapas!)
//      node tools/genassets.mjs --solo=paredes    sólo walls.png
//      node tools/genassets.mjs --solo=suelos,paredes
// Con --solo los mapas NO se tocan: así se puede retocar el arte sin perder
// una sala editada a mano en Tiled.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ---------- PNG mínimo (RGBA, sin dependencias) ----------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1);
    raw[rowStart] = 0; // filtro None
    rgba.copy(raw, rowStart + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Color ----------
const hex = (s) => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
/** t>0 aclara, t<0 oscurece */
const shade = (c, t) => (t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [0, 0, 0], -t));

// ---------- Lienzo ----------
const canvas = (w, h) => ({ w, h, buf: Buffer.alloc(w * h * 4) });

function px(cv, x, y, c) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  cv.buf[i] = c[0];
  cv.buf[i + 1] = c[1];
  cv.buf[i + 2] = c[2];
  cv.buf[i + 3] = 255;
}

const TILE_W = 64;
const TILE_H = 32;
// Alto de la cara de pared: 1,5 veces el avatar (64 px). Con 48 el avatar
// nuevo quedaba más alto que la pared y la sala parecía una caja de zapatos.
const WALL_H = 96;
const WALL_W = 32; // ancho de cada pieza
const WALL_TILE_H = WALL_H + 16; // + el sesgo isométrico

// ---------- Temas ----------
// Cada sala tiene el suyo, y por eso se distinguen de un vistazo.
const THEMES = [
  {
    key: "salon",
    nombre: "Salón cálido",
    floorA: hex("#c07a55"), // terracota
    floorB: hex("#ad6b49"),
    floorJoint: hex("#7d4630"), // junta entre baldosas
    floorAccent: hex("#f0c987"), // cenefa dorada
    wall: hex("#e3cfae"), // crema
    wallRail: hex("#a9633f"), // moldura a media altura
    wallBase: hex("#8c5334"), // zócalo
  },
  {
    key: "club",
    nombre: "Sala fría",
    floorA: hex("#2f7f8c"), // turquesa
    floorB: hex("#266d79"),
    floorJoint: hex("#143c45"),
    floorAccent: hex("#7fe3d1"), // menta
    wall: hex("#2b3a63"), // índigo
    wallRail: hex("#5b7fd4"),
    wallBase: hex("#1b2540"),
  },
  {
    // La calle: adoquín de piedra clara con juntas, y mosaico dorado
    key: "plaza",
    nombre: "Plaza (exterior)",
    floorA: hex("#c4bcae"),
    floorB: hex("#a9a193"),
    floorJoint: hex("#7c766c"),
    floorAccent: hex("#e3b54f"),
    wall: hex("#c9b89a"),
    wallRail: hex("#8a7a5e"),
    wallBase: hex("#5e5446"),
    adoquin: true,
  },
];

/** Césped y asfalto: iguales en cualquier tema (son de la calle) */
const CESPED = { a: hex("#6aa84f"), b: hex("#57913f"), brizna: hex("#8cc86a"), sombra: hex("#46783a") };
const ASFALTO = { a: hex("#4a4d57"), b: hex("#40434c"), grano: hex("#5b5f6a"), junta: hex("#34363e") };

/** Tramado ordenado 4×4: rompe el color plano sin ensuciar */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const dither = (x, y, fuerza) => (BAYER[y & 3][x & 3] / 15 - 0.5) * fuerza;

// ---------- Suelo: rombo 64×32 ----------
// variante 0 = baldosa A, 1 = baldosa B, 2 = cenefa decorativa,
// 3 = césped, 4 = asfalto (estos dos, iguales en todos los temas)
const SUELO = { A: 0, B: 1, CENEFA: 2, CESPED: 3, ASFALTO: 4 };

/** Césped: verde tramado con briznas sueltas; sin juntas, para que las celdas se fundan */
function drawCesped(cv, ox) {
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const nx = (x + 0.5 - TILE_W / 2) / (TILE_W / 2);
      const ny = (y + 0.5 - TILE_H / 2) / (TILE_H / 2);
      if (Math.abs(nx) + Math.abs(ny) > 1) continue;
      let c = shade(BAYER[y & 3][x & 3] > 7 ? CESPED.a : CESPED.b, dither(x, y, 0.06));
      // Briznas: puntos claros con su sombra debajo, repartidos sin patrón visible
      const h = (x * 73856093) ^ (y * 19349663);
      if ((h & 31) === 0) c = CESPED.brizna;
      else if (((h >> 5) & 63) === 1) c = CESPED.sombra;
      px(cv, ox + x, y, c);
    }
  }
}

/** Asfalto: gris oscuro con grano, junta suave en el borde */
function drawAsfalto(cv, ox) {
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const nx = (x + 0.5 - TILE_W / 2) / (TILE_W / 2);
      const ny = (y + 0.5 - TILE_H / 2) / (TILE_H / 2);
      const d = Math.abs(nx) + Math.abs(ny);
      if (d > 1) continue;
      let c = shade(ASFALTO.a, dither(x, y, 0.08));
      const h = (x * 83492791) ^ (y * 2654435761);
      if ((h & 15) === 0) c = ASFALTO.grano;
      if (d > 0.95) c = ASFALTO.junta;
      px(cv, ox + x, y, c);
    }
  }
}

function drawFloorTile(cv, ox, tema, variante) {
  if (variante === SUELO.CESPED) return drawCesped(cv, ox);
  if (variante === SUELO.ASFALTO) return drawAsfalto(cv, ox);
  const base = variante === 1 ? tema.floorB : tema.floorA;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const nx = (x + 0.5 - TILE_W / 2) / (TILE_W / 2);
      const ny = (y + 0.5 - TILE_H / 2) / (TILE_H / 2);
      const d = Math.abs(nx) + Math.abs(ny);
      if (d > 1) continue;

      let c = base;
      // Adoquín: cada baldosa son cuatro piedras (juntas por el centro, en
      // la dirección de los ejes de la rejilla)
      const juntaAdoquin = tema.adoquin && variante !== 2 && (Math.abs(nx - ny) < 0.07 || Math.abs(nx + ny) < 0.07);

      // Relieve: la luz entra por arriba, así que el canto superior brilla
      // y el inferior queda en sombra. Es lo que da volumen a la baldosa.
      if (d > 0.93 || juntaAdoquin) c = tema.floorJoint; // junta
      else if (d > 0.80) c = shade(base, ny < 0 ? 0.18 : -0.14);
      else c = shade(base, dither(x, y, 0.07));

      // Cenefa: un rombo interior en color de acento
      if (variante === 2 && d > 0.48 && d < 0.6) {
        c = shade(tema.floorAccent, dither(x, y, 0.05));
      }
      // Baldosa B: motivo central, para que el damero no sea sólo dos tonos
      if (variante === 1 && d < 0.14) c = shade(base, 0.22);

      px(cv, ox + x, y, c);
    }
  }
}

// ---------- Pared: pieza 32×112 (96 de cara + 16 de sesgo) ----------
// lado "der" = fila 0 (sube hacia la derecha), "izq" = columna 0 (hacia la izq.)
function drawWallTile(cv, ox, tema, lado) {
  // La luz del juego viene de arriba y del lado del eje col (ver
  // docs/guia-de-estilo.md): la pared de la columna 0, que mira hacia +col,
  // recibe más luz que la de la fila 0. Antes estaba al revés que en los
  // muebles.
  const luz = lado === "izq" ? 0 : -0.1;
  // Proporciones a partir del alto: moldura a un tercio desde el suelo,
  // zócalo de 9 px, remate arriba.
  const RAIL = WALL_H - Math.round(WALL_H * 0.36);
  const ZOCALO = 9;

  for (let u = 0; u < WALL_W; u++) {
    const top = lado === "der" ? Math.floor(u / 2) : Math.floor((WALL_W - 1 - u) / 2);
    for (let v = 0; v < WALL_H; v++) {
      let c;
      if (v < 2) c = shade(tema.wall, 0.34); // remate superior
      else if (v < 5) c = shade(tema.wall, 0.16);
      else if (v < 7) c = shade(tema.wall, -0.12); // sombra bajo el remate
      else if (v >= RAIL && v <= RAIL + 2) c = v === RAIL ? shade(tema.wallRail, 0.25) : tema.wallRail; // moldura
      else if (v >= WALL_H - ZOCALO) {
        c = v === WALL_H - ZOCALO ? shade(tema.wallBase, 0.22) : tema.wallBase; // zócalo
      } else if (v < RAIL) c = tema.wall;
      else c = shade(tema.wall, -0.06); // bajo la moldura, algo más oscuro

      // Juntas verticales de los paneles (sólo bajo la moldura: arriba, liso)
      if (u % 8 === 0 && v > RAIL + 2 && v < WALL_H - ZOCALO) c = shade(c, -0.1);
      // Tramado suave
      c = shade(c, dither(u, v, 0.05) + luz);
      // Cantos
      if (u === 0 || u === WALL_W - 1) c = shade(c, -0.12);
      if (v === WALL_H - 1) c = shade(c, -0.25);

      px(cv, ox + u, top + v, c);
    }
  }
}

// ---------- Fachadas: pieza 32×168 (152 de cara + 16 de sesgo) ----------
// Lo que en una sala es la pared, en la calle es la fachada de un edificio:
// dos plantas, con cornisa, ventanas y un escaparate con toldo abajo. Se
// colocan igual que las paredes (una pieza por celda en la fila 0 y en la
// columna 0), así que se ordenan con los avatares igual de bien.
const FACHADA_H = 152;
const FACHADA_TILE_H = FACHADA_H + 16;

/** Estilos de edificio: el muro, sus juntas, los remates y el toldo */
const ESTILOS_FACHADA = [
  { nombre: "ladrillo", muro: hex("#a8553a"), junta: hex("#7a3a28"), remate: hex("#e8dcc4"), toldo: hex("#2f8f6a") },
  { nombre: "piedra", muro: hex("#cdbb98"), junta: hex("#a8956f"), remate: hex("#f1e9d6"), toldo: hex("#b5484a") },
  { nombre: "moderno", muro: hex("#4e5d73"), junta: hex("#3b4658"), remate: hex("#aab7c9"), toldo: hex("#5fd3c0") },
  { nombre: "pastel", muro: hex("#7cbfb0"), junta: hex("#5e9d8f"), remate: hex("#f4eee2"), toldo: hex("#e8896b") },
];
/** Tipo de pieza: 0 con escaparate; 1 lisa abajo (donde va una puerta) */
const TIPOS_FACHADA = 2;

/** Cristal que refleja el cielo: claro arriba, más hondo abajo, con un reflejo en diagonal */
function cristal(u, v, alto) {
  const t = v / alto;
  let c = shade(hex("#a9dcf0"), -t * 0.45);
  if ((u + v) % 11 < 2 && t < 0.7) c = shade(c, 0.25);
  return c;
}

function drawFacadeTile(cv, ox, e, lado, tipo) {
  const luz = lado === "izq" ? 0.02 : -0.08;
  for (let u = 0; u < WALL_W; u++) {
    const top = lado === "der" ? Math.floor(u / 2) : Math.floor((WALL_W - 1 - u) / 2);
    for (let v = 0; v < FACHADA_H; v++) {
      // El muro, con la textura de su estilo
      let c = e.muro;
      if (e.nombre === "ladrillo") {
        const hilada = Math.floor(v / 6);
        if (v % 6 === 0 || (u + (hilada % 2) * 4) % 8 === 0) c = e.junta;
      } else if (e.nombre === "piedra") {
        const hilada = Math.floor(v / 12);
        if (v % 12 === 0 || (u + (hilada % 2) * 8) % 16 === 0) c = e.junta;
      } else if (e.nombre === "moderno") {
        if (u % 8 === 0) c = e.junta;
      }
      c = shade(c, dither(u, v, 0.05));

      // Cornisa arriba, y su sombra
      if (v < 2) c = shade(e.remate, 0.3);
      else if (v < 8) c = e.remate;
      else if (v < 10) c = shade(e.muro, -0.22);
      // Ventana de la planta de arriba, centrada en la pieza
      else if (u >= 8 && u <= 23 && v >= 22 && v <= 61) {
        if (v >= 59) c = v === 59 ? shade(e.remate, 0.15) : e.remate; // alféizar
        else if (u === 8 || u === 23 || v === 22 || v === 58) c = shade(e.remate, -0.1); // marco
        else if (u === 15 || u === 16) c = shade(e.remate, -0.2); // parteluz
        else c = cristal(u, v - 22, 36);
      }
      // Imposta entre las dos plantas
      else if (v >= 74 && v <= 78) c = v === 74 ? shade(e.remate, 0.2) : e.remate;
      // Planta baja: toldo y escaparate (o muro liso, donde va la puerta)
      else if (tipo === 0 && v >= 84 && v <= 93 && u >= 2 && u <= 29) {
        const franja = Math.floor((u - 2) / 4) % 2 === 0;
        c = franja ? e.toldo : shade(e.toldo, 0.45);
        if (v === 93) c = shade(e.toldo, -0.3); // borde del toldo
        if (v >= 91 && (u - 2) % 4 === 3) c = shade(e.toldo, -0.35); // festón
      } else if (tipo === 0 && v >= 96 && v <= 139 && u >= 4 && u <= 27) {
        if (u === 4 || u === 27 || v === 96 || v === 139) c = shade(e.remate, -0.25);
        else c = shade(cristal(u, v - 96, 70), -0.12);
      }
      // Zócalo
      if (v >= FACHADA_H - 8) c = v === FACHADA_H - 8 ? shade(e.junta, 0.1) : shade(e.junta, -0.15);

      c = shade(c, luz);
      if (v === FACHADA_H - 1) c = shade(c, -0.25);
      px(cv, ox + u, top + v, c);
    }
  }
}

// ---------- Montaje de las hojas ----------
const outDir = path.resolve(process.cwd(), "public", "assets");
const soloArg = process.argv.find((a) => a.startsWith("--solo="));
const solo = soloArg ? soloArg.slice(7).split(",") : null;
const toca = (que) => !solo || solo.includes(que);
fs.mkdirSync(outDir, { recursive: true });

const FLOORS_POR_TEMA = 5;
const tileset = canvas(TILE_W * FLOORS_POR_TEMA * THEMES.length, TILE_H);
THEMES.forEach((tema, t) => {
  for (let v = 0; v < FLOORS_POR_TEMA; v++) {
    drawFloorTile(tileset, (t * FLOORS_POR_TEMA + v) * TILE_W, tema, v);
  }
});
if (toca("suelos")) fs.writeFileSync(path.join(outDir, "tileset.png"), encodePng(tileset.w, tileset.h, tileset.buf));

const WALLS_POR_TEMA = 2;
const walls = canvas(WALL_W * WALLS_POR_TEMA * THEMES.length, WALL_TILE_H);
THEMES.forEach((tema, t) => {
  drawWallTile(walls, (t * WALLS_POR_TEMA + 0) * WALL_W, tema, "der");
  drawWallTile(walls, (t * WALLS_POR_TEMA + 1) * WALL_W, tema, "izq");
});
if (toca("paredes")) fs.writeFileSync(path.join(outDir, "walls.png"), encodePng(walls.w, walls.h, walls.buf));

// Fachadas: frame = (estilo × 2 + tipo) × 2 + lado (0 = der, 1 = izq)
const fachadaFrame = (estilo, tipo, lado) => (estilo * TIPOS_FACHADA + tipo) * 2 + (lado === "izq" ? 1 : 0);
const fachadas = canvas(WALL_W * ESTILOS_FACHADA.length * TIPOS_FACHADA * 2, FACHADA_TILE_H);
ESTILOS_FACHADA.forEach((e, estilo) => {
  for (let tipo = 0; tipo < TIPOS_FACHADA; tipo++) {
    for (const lado of ["der", "izq"]) drawFacadeTile(fachadas, fachadaFrame(estilo, tipo, lado) * WALL_W, e, lado, tipo);
  }
});
if (toca("paredes")) fs.writeFileSync(path.join(outDir, "fachadas.png"), encodePng(fachadas.w, fachadas.h, fachadas.buf));

// ---------- Salas en formato Tiled ----------
const TILESET_DEF = {
  columns: FLOORS_POR_TEMA * THEMES.length,
  firstgid: 1,
  image: "tileset.png",
  imageheight: TILE_H,
  imagewidth: tileset.w,
  margin: 0,
  name: "floor",
  spacing: 0,
  tilecount: FLOORS_POR_TEMA * THEMES.length,
  tileheight: TILE_H,
  tilewidth: TILE_W,
};

/**
 * Suelo de una sala interior: anillo detrás de las paredes, cenefa por dentro
 * y damero en el centro.
 */
function sueloSala(W, H) {
  return (col, row) => {
    const ring = row === 0 || col === 0 || row === H - 1 || col === W - 1;
    const cenefa = row === 1 || col === 1 || row === H - 2 || col === W - 2;
    if (ring) return SUELO.A; // queda detrás de las paredes
    if (cenefa) return SUELO.CENEFA; // marco decorativo interior
    return (row + col) % 2 === 0 ? SUELO.A : SUELO.B;
  };
}

/** El anillo exterior está bloqueado: paredes (o fachadas) y el borde */
const anillo = (W, H) => (col, row) => row === 0 || col === 0 || row === H - 1 || col === W - 1;

function buildRoom({ id, width: W, height: H, theme, objects, suelo = sueloSala(W, H), bloqueado = anillo(W, H), propiedades = [] }) {
  // gid = índice de frame + 1. Cada sala usa los suyos, así que el mapa se
  // sigue viendo bien en Tiled sin que el cliente tenga que desplazar nada.
  const primero = theme * FLOORS_POR_TEMA + 1;

  const floor = [];
  const collisions = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      floor.push(primero + suelo(col, row));
      collisions.push(bloqueado(col, row) ? 1 : 0);
    }
  }

  const tiledObjects = objects.map((o, i) => ({
    id: i + 1,
    name: `${o.type}-${i + 1}`,
    type: o.type,
    class: o.type,
    x: (o.col - o.row) * (TILE_W / 2) + H * (TILE_W / 2),
    y: (o.col + o.row) * (TILE_H / 2) + TILE_H / 2,
    width: TILE_W,
    height: TILE_H,
    rotation: 0,
    visible: true,
    properties: [
      { name: "col", type: "int", value: o.col },
      { name: "row", type: "int", value: o.row },
      ...Object.entries(o.props ?? {}).map(([name, value]) => ({
        name,
        type: typeof value === "number" ? "int" : "string",
        value,
      })),
    ],
  }));

  const map = {
    compressionlevel: -1,
    height: H,
    width: W,
    infinite: false,
    layers: [
      { data: floor, height: H, width: W, id: 1, name: "suelo", opacity: 1, type: "tilelayer", visible: true, x: 0, y: 0 },
      { data: collisions, height: H, width: W, id: 2, name: "colisiones", opacity: 1, type: "tilelayer", visible: false, x: 0, y: 0 },
      { draworder: "topdown", id: 3, name: "objetos", objects: tiledObjects, opacity: 1, type: "objectgroup", visible: true, x: 0, y: 0 },
    ],
    nextlayerid: 4,
    nextobjectid: objects.length + 1,
    // Propiedades de la sala (Tiled las edita en "Map Properties")
    properties: propiedades,
    orientation: "isometric",
    renderorder: "right-down",
    tiledversion: "1.11.2",
    tileheight: TILE_H,
    tilewidth: TILE_W,
    tilesets: [TILESET_DEF],
    version: "1.10",
  };

  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(map, null, 2));
  console.log(`${id}.json (${W}x${H}, tema "${THEMES[theme].nombre}", ${objects.length} objetos)`);
}

// Una alfombra ocupa una celda; varias seguidas forman una zona.
const zona = (type, c0, r0, ancho, alto) => {
  const out = [];
  for (let r = r0; r < r0 + alto; r++) {
    for (let c = c0; c < c0 + ancho; c++) out.push({ type, col: c, row: r });
  }
  return out;
};

const rooms = [
  {
    // PLAZA CENTRAL: recibidor con mostrador, zona de estar y plantas
    id: "room1",
    width: 12,
    height: 12,
    theme: 0,
    objects: [
      // Zona de estar sobre la alfombra
      ...zona("alfombra", 3, 5, 3, 3),
      { type: "sofa", col: 4, row: 5 },
      { type: "mesa", col: 4, row: 6 }, // centrada en la alfombra, frente al sofá
      // Mostrador de recepción, pegado a la pared derecha
      { type: "barra", col: 9, row: 3 },
      { type: "barra", col: 9, row: 4 },
      { type: "taburete", col: 8, row: 3 },
      { type: "taburete", col: 8, row: 4 },
      // Verde y luz
      { type: "planta", col: 2, row: 2 },
      { type: "planta", col: 9, row: 9 },
      { type: "planta", col: 2, row: 9 },
      { type: "lampara", col: 6, row: 2 },
      // Paredes vivas: ventanas con luz, cuadros, reloj, apliques y libros.
      // Lo de pared va en la fila 0 (pared derecha) o en la columna 0
      // (izquierda): el anillo de celdas junto al muro.
      { type: "ventana", col: 2, row: 0 },
      { type: "cuadro", col: 4, row: 0 },
      { type: "ventana", col: 6, row: 0 },
      { type: "aplique", col: 7, row: 0 },
      { type: "estante", col: 10, row: 0 },
      { type: "aplique", col: 0, row: 2 },
      { type: "estanteria", col: 0, row: 4 },
      { type: "cuadro", col: 0, row: 6 },
      { type: "ventana", col: 0, row: 8 },
      { type: "reloj", col: 0, row: 10 },
      // Sale a la Plaza de la Llave: la sala es un edificio de la plaza
      {
        type: "puerta",
        col: 8,
        row: 0,
        props: { target: "plaza", targetCol: 6, targetRow: 1 },
      },
    ],
  },
  {
    // CLUB NEÓN: pista de baile, barra con taburetes y altavoces
    id: "room2",
    width: 14,
    height: 10,
    theme: 1,
    objects: [
      // Pista de baile en el centro
      ...zona("alfombra", 5, 3, 4, 4),
      // Barra a la derecha
      { type: "barra", col: 11, row: 3 },
      { type: "barra", col: 11, row: 4 },
      { type: "barra", col: 11, row: 5 },
      { type: "taburete", col: 10, row: 3 },
      { type: "taburete", col: 10, row: 4 },
      { type: "taburete", col: 10, row: 5 },
      // Altavoces en las esquinas de la pista
      { type: "altavoz", col: 2, row: 2 },
      { type: "altavoz", col: 2, row: 7 },
      // Reservado
      { type: "sofa", col: 7, row: 1 },
      { type: "mesa", col: 12, row: 8 },
      { type: "lampara", col: 5, row: 8 },
      // Neones y pósters: el club no tiene ventanas, tiene luz propia
      { type: "aplique", col: 1, row: 0 },
      { type: "poster", col: 5, row: 0 },
      { type: "neon", col: 7, row: 0 },
      { type: "poster", col: 9, row: 0 },
      { type: "neon", col: 11, row: 0 },
      { type: "aplique", col: 13, row: 0 },
      { type: "poster", col: 0, row: 3 },
      { type: "aplique", col: 0, row: 5 },
      { type: "poster", col: 0, row: 8 },
      // También da a la plaza
      {
        type: "puerta",
        col: 3,
        row: 0,
        props: { target: "plaza", targetCol: 1, targetRow: 12 },
      },
    ],
  },
  plaza(),
];

/**
 * PLAZA DE LA LLAVE: la primera zona de La Manzana y la entrada del juego.
 * Al aire libre: fachadas de edificios al fondo (sus puertas llevan a las
 * salas), una calzada que la rodea por delante, adoquín con dos caminos en
 * cruz hacia el monumento, cuatro parterres con árbol, farolas y bancos.
 */
function plaza() {
  const W = 20;
  const H = 20;
  const C = 10; // el centro: la Llave
  const PUERTA_SALON = 6; // en la fachada de la fila 0
  const PUERTA_CLUB = 12; // en la fachada de la columna 0
  const parterre = (col, row) =>
    [3, 13].some((c0) => col >= c0 && col <= c0 + 3) && [3, 13].some((r0) => row >= r0 && row <= r0 + 3);
  const suelo = (col, row) => {
    if (row === H - 1 || col === W - 1) return SUELO.ASFALTO; // la calle de delante
    if (row === 0 || col === 0) return SUELO.A; // bajo las fachadas
    if (row === 1 || col === 1 || row === H - 2 || col === W - 2) return SUELO.B; // aceras
    const dist = Math.max(Math.abs(col - C), Math.abs(row - C));
    if (dist === 2) return SUELO.CENEFA; // mosaico dorado alrededor del monumento
    if (dist < 2) return SUELO.A;
    if (parterre(col, row)) return SUELO.CESPED;
    if (col === row || col + row === W) return SUELO.B; // caminos en cruz
    return SUELO.A;
  };

  // Qué edificio hay en cada celda de cada fachada (estilos de ESTILOS_FACHADA)
  const tramo = (tramos, i) => tramos.find(([desde, hasta]) => i >= desde && i <= hasta)[2];
  const der = Array.from({ length: W }, (_, col) =>
    fachadaFrame(tramo([[0, 3, 0], [4, 8, 1], [9, 13, 3], [14, W - 1, 0]], col), col === PUERTA_SALON ? 1 : 0, "der"),
  );
  const izq = Array.from({ length: H }, (_, row) =>
    fachadaFrame(tramo([[0, 4, 3], [5, 8, 1], [9, 14, 2], [15, H - 1, 0]], row), row === PUERTA_CLUB ? 1 : 0, "izq"),
  );

  return {
    id: "plaza",
    width: W,
    height: H,
    theme: 2,
    suelo,
    propiedades: [
      { name: "exterior", type: "bool", value: true },
      { name: "fachadaDer", type: "string", value: der.join(",") },
      { name: "fachadaIzq", type: "string", value: izq.join(",") },
    ],
    objects: [
      { type: "llave", col: C, row: C },
      ...[[C - 2, C - 2], [C + 2, C - 2], [C - 2, C + 2], [C + 2, C + 2]].map(([col, row]) => ({ type: "jardinera", col, row })),
      // Bancos mirando al monumento: los del norte al suroeste, los del oeste
      // (girados) al sureste
      { type: "banco", col: C - 1, row: C - 3 },
      { type: "banco", col: C + 1, row: C - 3 },
      { type: "banco", col: C - 3, row: C - 1, props: { girado: 1 } },
      { type: "banco", col: C - 3, row: C + 1, props: { girado: 1 } },
      // Farolas en las esquinas del monumento y junto a las fachadas
      ...[[C - 3, C - 3], [C + 3, C - 3], [C - 3, C + 3], [C + 3, C + 3], [3, 2], [16, 2], [2, 9], [2, 16]].map(([col, row]) => ({
        type: "farola",
        col,
        row,
      })),
      // Un árbol en cada parterre
      ...[[4, 4], [15, 4], [4, 15], [15, 15]].map(([col, row]) => ({ type: "arbol", col, row })),
      // Puertas a los edificios, con un aplique a cada lado
      { type: "puerta", col: PUERTA_SALON, row: 0, props: { target: "room1", targetCol: 8, targetRow: 1 } },
      { type: "aplique", col: PUERTA_SALON - 1, row: 0 },
      { type: "aplique", col: PUERTA_SALON + 1, row: 0 },
      { type: "puerta", col: 0, row: PUERTA_CLUB, props: { target: "room2", targetCol: 3, targetRow: 1 } },
      { type: "neon", col: 0, row: PUERTA_CLUB - 1 },
      { type: "neon", col: 0, row: PUERTA_CLUB + 1 },
    ],
  };
}

if (toca("salas")) for (const room of rooms) buildRoom(room);
const hechos = [
  toca("suelos") && `tileset.png (${tileset.w}x${tileset.h})`,
  toca("paredes") && `walls.png (${walls.w}x${walls.h}) y fachadas.png (${fachadas.w}x${fachadas.h})`,
].filter(Boolean);
if (toca("salas")) hechos.push(rooms.map((r) => `${r.id}.json`).join(", "));
console.log(`${hechos.join(", ")} en ${outDir}${toca("salas") ? "" : " (mapas sin tocar)"}`);
