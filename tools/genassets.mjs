// Genera los assets base de Roomie:
//  - public/assets/tileset.png → suelos isométricos 64×32, 3 por tema
//  - public/assets/walls.png   → caras de pared 32×64, 2 por tema (izq. y der.)
//  - public/assets/room1.json  → sala 12×12 en formato Tiled (editable con Tiled)
//  - public/assets/room2.json  → sala 14×10 en formato Tiled
//
// Todo se dibuja PÍXEL A PÍXEL, no con formas vectoriales: es lo que separa
// "rombos planos de colores" de pixel art de verdad. Cada superficie lleva
// biselado (la luz entra por arriba), tramado para romper el color plano,
// junta oscura entre baldosas y zócalo en las paredes.
//
// Uso: node tools/genassets.mjs
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
const WALL_H = 48; // alto de la cara de pared
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
];

/** Tramado ordenado 4×4: rompe el color plano sin ensuciar */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const dither = (x, y, fuerza) => (BAYER[y & 3][x & 3] / 15 - 0.5) * fuerza;

// ---------- Suelo: rombo 64×32 ----------
// variante 0 = baldosa A, 1 = baldosa B, 2 = cenefa decorativa
function drawFloorTile(cv, ox, tema, variante) {
  const base = variante === 1 ? tema.floorB : tema.floorA;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const nx = (x + 0.5 - TILE_W / 2) / (TILE_W / 2);
      const ny = (y + 0.5 - TILE_H / 2) / (TILE_H / 2);
      const d = Math.abs(nx) + Math.abs(ny);
      if (d > 1) continue;

      let c = base;

      // Relieve: la luz entra por arriba, así que el canto superior brilla
      // y el inferior queda en sombra. Es lo que da volumen a la baldosa.
      if (d > 0.93) c = tema.floorJoint; // junta
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

// ---------- Pared: pieza 32×64 ----------
// lado "der" = fila 0 (sube hacia la derecha), "izq" = columna 0 (hacia la izq.)
function drawWallTile(cv, ox, tema, lado) {
  // El muro que mira al noroeste recibe menos luz: dos tonos como en todo
  // isométrico decente.
  const luz = lado === "der" ? 0 : -0.1;

  for (let u = 0; u < WALL_W; u++) {
    const top = lado === "der" ? Math.floor(u / 2) : Math.floor((WALL_W - 1 - u) / 2);
    for (let v = 0; v < WALL_H; v++) {
      let c;
      if (v < 2) c = shade(tema.wall, 0.34); // remate superior
      else if (v < 5) c = shade(tema.wall, 0.16);
      else if (v >= 29 && v <= 31) c = tema.wallRail; // moldura a media altura
      else if (v >= WALL_H - 7) {
        c = v === WALL_H - 7 ? shade(tema.wallBase, 0.22) : tema.wallBase; // zócalo
      } else if (v < 29) c = tema.wall;
      else c = shade(tema.wall, -0.06); // bajo la moldura, algo más oscuro

      // Juntas verticales de los paneles
      if (u % 8 === 0 && v > 4 && v < WALL_H - 7) c = shade(c, -0.1);
      // Tramado suave
      c = shade(c, dither(u, v, 0.05) + luz);
      // Cantos
      if (u === 0 || u === WALL_W - 1) c = shade(c, -0.12);
      if (v === WALL_H - 1) c = shade(c, -0.25);

      px(cv, ox + u, top + v, c);
    }
  }
}

// ---------- Montaje de las hojas ----------
const outDir = path.resolve(process.cwd(), "public", "assets");
fs.mkdirSync(outDir, { recursive: true });

const FLOORS_POR_TEMA = 3;
const tileset = canvas(TILE_W * FLOORS_POR_TEMA * THEMES.length, TILE_H);
THEMES.forEach((tema, t) => {
  for (let v = 0; v < FLOORS_POR_TEMA; v++) {
    drawFloorTile(tileset, (t * FLOORS_POR_TEMA + v) * TILE_W, tema, v);
  }
});
fs.writeFileSync(path.join(outDir, "tileset.png"), encodePng(tileset.w, tileset.h, tileset.buf));

const WALLS_POR_TEMA = 2;
const walls = canvas(WALL_W * WALLS_POR_TEMA * THEMES.length, WALL_TILE_H);
THEMES.forEach((tema, t) => {
  drawWallTile(walls, (t * WALLS_POR_TEMA + 0) * WALL_W, tema, "der");
  drawWallTile(walls, (t * WALLS_POR_TEMA + 1) * WALL_W, tema, "izq");
});
fs.writeFileSync(path.join(outDir, "walls.png"), encodePng(walls.w, walls.h, walls.buf));

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

function buildRoom({ id, width: W, height: H, theme, objects }) {
  // gid = índice de frame + 1. Cada sala usa los suyos, así que el mapa se
  // sigue viendo bien en Tiled sin que el cliente tenga que desplazar nada.
  const primero = theme * FLOORS_POR_TEMA + 1;
  const [A, B, CENEFA] = [primero, primero + 1, primero + 2];

  const floor = [];
  const collisions = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const ring = row === 0 || col === 0 || row === H - 1 || col === W - 1;
      const cenefa = row === 1 || col === 1 || row === H - 2 || col === W - 2;
      if (ring) floor.push(A); // queda detrás de las paredes
      else if (cenefa) floor.push(CENEFA); // marco decorativo interior
      else floor.push((row + col) % 2 === 0 ? A : B);
      collisions.push(ring ? 1 : 0); // anillo exterior = muros
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
      {
        type: "puerta",
        col: 8,
        row: 0,
        props: { target: "room2", targetCol: 1, targetRow: 1 },
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
      {
        type: "puerta",
        col: 3,
        row: 0,
        props: { target: "room1", targetCol: 9, targetRow: 1 },
      },
    ],
  },
];

for (const room of rooms) buildRoom(room);
console.log(`tileset.png (${tileset.w}x${tileset.h}) y walls.png (${walls.w}x${walls.h}) generados en ${outDir}`);
