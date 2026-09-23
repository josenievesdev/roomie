// Genera los assets base de Roomie:
//  - public/assets/tileset.png  → tileset isométrico 64×32 (2 variantes de suelo)
//  - public/assets/room1.json  → sala 12×12 en formato Tiled (editable con Tiled)
//  - public/assets/room2.json  → sala 14×10 en formato Tiled
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

// ---------- Tileset: rombos 64×32 ----------
const TILE_W = 64;
const TILE_H = 32;

function drawDiamond(buf, offset, base, edge) {
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const nx = (x + 0.5 - TILE_W / 2) / (TILE_W / 2);
      const ny = (y + 0.5 - TILE_H / 2) / (TILE_H / 2);
      const d = Math.abs(nx) + Math.abs(ny);
      if (d > 1) continue;
      const [r, g, b] = d > 0.86 ? edge : base;
      const i = (y * (TILE_W * 2) + offset + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
}

const tilesetW = TILE_W * 2;
const tileset = Buffer.alloc(tilesetW * TILE_H * 4);
drawDiamond(tileset, 0, [58, 58, 82], [34, 34, 50]); // suelo claro
drawDiamond(tileset, TILE_W, [49, 49, 74], [29, 29, 44]); // suelo oscuro

// ---------- Salas en formato Tiled ----------
const outDir = path.resolve(process.cwd(), "public", "assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "tileset.png"), encodePng(tilesetW, TILE_H, tileset));

const TILESET_DEF = {
  columns: 2,
  firstgid: 1,
  image: "tileset.png",
  imageheight: TILE_H,
  imagewidth: tilesetW,
  margin: 0,
  name: "floor",
  spacing: 0,
  tilecount: 2,
  tileheight: TILE_H,
  tilewidth: TILE_W,
};

function buildRoom({ id, width: W, height: H, objects }) {
  const floor = [];
  const collisions = [];
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      floor.push((row + col) % 2 === 0 ? 1 : 2);
      const ring = row === 0 || col === 0 || row === H - 1 || col === W - 1;
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
  console.log(`${id}.json (${W}x${H}, ${objects.length} objetos) generado`);
}

const rooms = [
  {
    id: "room1",
    width: 12,
    height: 12,
    objects: [
      { type: "sofa", col: 4, row: 2 },
      { type: "mesa", col: 7, row: 5 },
      {
        type: "puerta",
        col: 8,
        row: 0,
        props: { target: "room2", targetCol: 1, targetRow: 1 },
      },
    ],
  },
  {
    id: "room2",
    width: 14,
    height: 10,
    objects: [
      { type: "sofa", col: 5, row: 2 },
      { type: "mesa", col: 9, row: 6 },
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
console.log(`tileset.png (${tilesetW}x${TILE_H}) generado en ${outDir}`);
