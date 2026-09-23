// Genera los assets base de Roomie:
//  - public/assets/tileset.png  → tileset isométrico 64×32 (2 variantes de suelo)
//  - public/assets/room1.json   → sala 12×12 en formato Tiled (editable con Tiled)
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

// ---------- Mapa en formato Tiled ----------
const ROOM = 12;
const floor = [];
const collisions = [];
for (let row = 0; row < ROOM; row++) {
  for (let col = 0; col < ROOM; col++) {
    floor.push((row + col) % 2 === 0 ? 1 : 2);
    const ring = row === 0 || col === 0 || row === ROOM - 1 || col === ROOM - 1;
    collisions.push(ring ? 1 : 0); // anillo exterior bloqueado (muros llegan en Fase 3)
  }
}

const map = {
  compressionlevel: -1,
  height: ROOM,
  width: ROOM,
  infinite: false,
  layers: [
    {
      data: floor,
      height: ROOM,
      width: ROOM,
      id: 1,
      name: "suelo",
      opacity: 1,
      type: "tilelayer",
      visible: true,
      x: 0,
      y: 0,
    },
    {
      data: collisions,
      height: ROOM,
      width: ROOM,
      id: 2,
      name: "colisiones",
      opacity: 1,
      type: "tilelayer",
      visible: false,
      x: 0,
      y: 0,
    },
    {
      draworder: "topdown",
      id: 3,
      name: "objetos",
      objects: [
        {
          id: 1,
          name: "sofa-1",
          type: "sofa",
          class: "sofa",
          x: 448,
          y: 112,
          width: 64,
          height: 32,
          rotation: 0,
          visible: true,
          properties: [
            { name: "col", type: "int", value: 4 },
            { name: "row", type: "int", value: 2 },
          ],
        },
        {
          id: 2,
          name: "mesa-1",
          type: "mesa",
          class: "mesa",
          x: 448,
          y: 208,
          width: 64,
          height: 32,
          rotation: 0,
          visible: true,
          properties: [
            { name: "col", type: "int", value: 7 },
            { name: "row", type: "int", value: 5 },
          ],
        },
      ],
      opacity: 1,
      type: "objectgroup",
      visible: true,
      x: 0,
      y: 0,
    },
  ],
  nextlayerid: 4,
  nextobjectid: 3,
  orientation: "isometric",
  renderorder: "right-down",
  tiledversion: "1.11.2",
  tileheight: TILE_H,
  tilewidth: TILE_W,
  tilesets: [
    {
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
    },
  ],
  version: "1.10",
};

const outDir = path.resolve(process.cwd(), "public", "assets");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "tileset.png"), encodePng(tilesetW, TILE_H, tileset));
fs.writeFileSync(path.join(outDir, "room1.json"), JSON.stringify(map, null, 2));

console.log(`tileset.png (${tilesetW}x${TILE_H}) y room1.json (${ROOM}x${ROOM}) generados en ${outDir}`);
