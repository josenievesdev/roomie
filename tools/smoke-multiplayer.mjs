// Smoke test del multijugador: levanta dos (o tres) clientes de socket.io
// reales contra el servidor en :3001 y comprueba presencia, movimiento
// autoritativo, caminos A*, sentarse, chat y cambios de sala.
//
// Uso (con el servidor ya corriendo: `npm run dev:server`):
//   node tools/smoke-multiplayer.mjs
import { io } from "socket.io-client";
import { loadWorld } from "../server/src/world.ts";
import { findPath } from "../src/utils/pathfinding.ts";

const URL = process.env.SERVER ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}`);
  if (!ok) failures++;
};
const until = async (fn, ms = 4000, step = 50) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(step);
  }
  return fn();
};

function makeClient() {
  const sock = io(URL, { transports: ["websocket"], forceNew: true });
  const c = { sock, id: "", players: [], chats: [] };
  sock.on("welcome", (p) => {
    c.id = p.id;
    c.players = p.players;
  });
  sock.on("players", (p) => (c.players = p.players));
  sock.on("chat", (m) => c.chats.push(m));
  return c;
}
const view = (c, id = c.id) => c.players.find((p) => p.id === id);
const said = (c, text) => c.chats.some((m) => m.text.includes(text));

const join = async (c, room, cell) =>
  new Promise((resolve) => {
    c.sock.once("welcome", (p) => {
      c.id = p.id;
      resolve(p);
    });
    c.sock.emit("join", {
      name: cell.name,
      room,
      col: cell.col,
      row: cell.row,
      facing: "down",
      look: { shirt: 0x6c5ce7, hair: 0x4a3226 },
    });
  });

const room1 = loadWorld("public/assets", "room1");
const room2 = loadWorld("public/assets", "room2");
const spawn = { ...room1.freeCell(), name: "Ana" };

// ---------- 1. Presencia ----------
const A = makeClient();
const B = makeClient();
await until(() => A.sock.connected && B.sock.connected, 3000);
await join(A, "room1", spawn);
await join(B, "room1", { ...room1.freeCell(), name: "Beto" });
check(A.id && B.id && A.id !== B.id, "dos clientes con id distintos (welcome)");
check(
  await until(() => view(A, B.id) && view(B, A.id)),
  "se ven mutuamente en el snapshot a 20 Hz",
);
check(said(B, "entró a la sala"), "B recibió el aviso de sistema de A");

// ---------- 2. Movimiento autoritativo (teclado) ----------
// Dirección (-1,0): hacia la izquierda de pantalla hay 4 celdas libres;
// hacia la derecha está la mesa (7,5) y el avatar chocaría (eso también
// es correcto, pero no sirve para medir avance).
const before = { ...view(A) };
const pump = setInterval(() => A.sock.emit("move", -1, 0), 40);
await sleep(700);
A.sock.emit("move", 0, 0);
clearInterval(pump);
const after = view(A);
check(
  after.col < before.col - 0.5 && after.row > before.row + 0.5,
  `el servidor simula el teclado (${before.col.toFixed(1)},${before.row.toFixed(1)}) -> (${after.col.toFixed(1)},${after.row.toFixed(1)})`,
);
check(await until(() => !view(A).moving), "al soltar teclas, el servidor se para");

// ---------- 3. Camino A* + sentarse en el sofá ----------
const me = view(A);
const start = { col: Math.round(me.col), row: Math.round(me.row) };
const sofa = { col: 4, row: 2 };
const path = findPath(start, sofa, room1.cols, room1.rows, room1.isBlocked, true);
check(!!path && path.length > 0, `A* encontró un camino de ${path?.length ?? 0} celdas`);
if (path) {
  A.sock.emit("path", path);
  check(await until(() => view(A)?.sitting, 8000), "el servidor llega al sofá y se sienta");
  A.sock.emit("stand");
  check(await until(() => !view(A)?.sitting, 3000), "`stand` lo levanta");
}

// ---------- 4. Chat + anti-spam ----------
B.sock.emit("chat", "¡hola sala!");
check(await until(() => said(A, "¡hola sala!")), "el chat de B llega a A");
check(
  A.chats.some((m) => m.from === B.id && m.text === "¡hola sala!"),
  "el mensaje lleva el id de quien habla",
);
B.sock.emit("chat", "spam");
await sleep(300);
check(!said(A, "spam"), "segundo mensaje <400 ms descartado (anti-spam)");

// ---------- 5. Camino trampa rechazado ----------
const posBefore = { ...view(A) };
A.sock.emit("path", [{ col: 1, row: 1 }, { col: 2, row: 1 }, { col: 3, row: 1 }]);
await sleep(300);
const posAfter = view(A);
check(
  Math.hypot(posAfter.col - posBefore.col, posAfter.row - posBefore.row) < 0.05,
  "camino que empieza lejos del avatar: rechazado",
);

// ---------- 5b. Colisión con la mesa (7,5) ----------
// Desde (6,6) avanzando en +x de pantalla el avatar acabaría EN la celda de
// la mesa: el servidor debe frenarlo igual que el cliente (sin atravesarla).
A.sock.emit("room", { room: "room1", ...room1.freeCell(), facing: "down" });
await until(() => Math.round(view(A).col) === 6 && Math.round(view(A).row) === 6, 3000);
const push = setInterval(() => A.sock.emit("move", 1, 0), 40);
await sleep(700);
A.sock.emit("move", 0, 0);
clearInterval(push);
const walled = view(A);
check(
  walled.col > 6.4 && walled.col < 6.6 && walled.row > 5.4 && walled.row < 5.6,
  `la mesa (7,5) frena al avatar en (${walled.col.toFixed(2)},${walled.row.toFixed(2)}) sin atravesarla`,
);

// ---------- 6. Desconexión ----------
const C = makeClient();
await until(() => C.sock.connected, 3000);
await join(C, "room1", { ...room1.freeCell(), name: "Carla" });
check(await until(() => said(B, "Carla entró")), "aviso de entrada de C");
C.sock.disconnect();
check(await until(() => said(B, "Carla salió")), "aviso de salida por desconexión");

// ---------- 7. Cambio de sala ----------
A.sock.emit("room", { room: "room2", ...room2.freeCell(), facing: "up" });
check(await until(() => view(A)?.room === "room2"), "A aparece en room2 (snapshot propio)");
check(await until(() => said(B, "salió de la sala")), "B ve que A salió de room1");
check(!view(B, A.id), "A ya no aparece en el snapshot de room1");
check(
  await until(() => view(A, A.id) && view(A, A.id).room === "room2"),
  "A se recibe a sí mismo en room2",
);

// ---------- 8. Las salas no se mezclan ----------
check(
  view(A, B.id) === undefined,
  "B (room1) no aparece en el snapshot de A (room2)",
);

A.sock.disconnect();
B.sock.disconnect();
console.log(failures === 0 ? "\nTODO OK" : `\n${failures} comprobaciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
