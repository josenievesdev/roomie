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
  const c = { sock, id: "", players: [], chats: [], identidad: null, authError: null };
  sock.on("welcome", (p) => {
    c.id = p.id;
    c.players = p.players;
  });
  sock.on("players", (p) => (c.players = p.players));
  sock.on("chat", (m) => c.chats.push(m));
  sock.on("authOk", (p) => {
    c.identidad = p;
    c.authError = null;
  });
  sock.on("authError", (e) => {
    c.authError = e;
  });
  return c;
}

// Cada ejecución crea sus propias cuentas, con un sufijo irrepetible: así el
// test no depende de lo que haya en la base ni deja a nadie fuera si se
// ejecuta dos veces seguidas.
const SUFIJO = Date.now().toString(36).slice(-5);
const CLAVE = "smoke-test-1234";
const cuentaDe = (nombre) => ({
  username: `sk${SUFIJO}${nombre}`.slice(0, 16),
  nickname: `${nombre}${SUFIJO}`.slice(0, 16),
});

/** Crea la cuenta y espera la confirmación del servidor */
const registrar = async (c, nombre) =>
  new Promise((resolve, reject) => {
    const { username, nickname } = cuentaDe(nombre);
    const alOk = (p) => {
      c.sock.off("authError", alError);
      resolve(p);
    };
    const alError = (e) => {
      c.sock.off("authOk", alOk);
      reject(new Error(`no se pudo registrar ${username}: ${e.code} ${e.message}`));
    };
    c.sock.once("authOk", alOk);
    c.sock.once("authError", alError);
    c.sock.emit("auth", {
      mode: "register",
      username,
      password: CLAVE,
      nickname,
      look: { shirt: 0x6c5ce7, hair: 0x4a3226 },
    });
  });
const view = (c, id = c.id) => c.players.find((p) => p.id === id);
const said = (c, text) => c.chats.some((m) => m.text.includes(text));
/** Celda que contiene los pies de un jugador */
const celda = (v) => ({ col: Math.round(v.col), row: Math.round(v.row) });
const en = (v, c) => !!v && Math.round(v.col) === c.col && Math.round(v.row) === c.row;
/** Distancia en pasos de 8 vecinos */
const pasos = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
/** Recoloca a un jugador en una celda de room1 (el `room` a la misma sala lo permite) */
const colocar = async (c, cell) => {
  c.sock.emit("room", { room: "room1", col: cell.col, row: cell.row, facing: "down" });
  return until(() => en(view(c), cell), 3000);
};
/** Espera a que arranque (si arranca) y luego a que se pare */
const hastaQueSePare = async (c, ms = 8000) => {
  await sleep(200);
  return until(() => view(c) && !view(c).moving, ms);
};

// El nombre ya NO viaja en `join`: sale de la cuenta autenticada.
const join = async (c, room, cell) =>
  new Promise((resolve) => {
    c.sock.once("welcome", (p) => {
      c.id = p.id;
      resolve(p);
    });
    c.sock.emit("join", { room, col: cell.col, row: cell.row, facing: "down" });
  });

const room1 = loadWorld("public/assets", "room1");
const room2 = loadWorld("public/assets", "room2");
const spawn = room1.freeCell();

// ---------- 1. Presencia ----------
const A = makeClient();
const B = makeClient();

// Identificarse ANTES de entrar: sin cuenta, el servidor rechaza el join.
await registrar(A, "Ana");
await registrar(B, "Beto");
check(A.identidad !== null && B.identidad !== null, "las dos cuentas se registran y entran");
check(A.identidad.saldo === 500, "la cuenta nueva arranca con 500 monedas", String(A.identidad?.saldo));
check(A.identidad.nickname !== B.identidad.nickname, "cada una con su nombre");
// Se registran con el aspecto ANTIGUO (dos colores sueltos): el servidor
// tiene que devolverlo ya convertido al catálogo nuevo, con el color de
// catálogo más parecido.
check(
  typeof A.identidad.look?.piel === "string" && A.identidad.look.torsoColor === "morado",
  `el aspecto antiguo {shirt, hair} llega convertido (${JSON.stringify(A.identidad.look)})`,
);
await until(() => A.sock.connected && B.sock.connected, 3000);
await join(A, "room1", spawn);
await join(B, "room1", spawn); // la MISMA celda, como dos que cruzan la misma puerta
check(A.id && B.id && A.id !== B.id, "dos clientes con id distintos (welcome)");
check(
  await until(() => view(A, B.id) && view(B, A.id)),
  "se ven mutuamente en el snapshot a 20 Hz",
);
check(
  en(view(A, A.id), spawn) && !en(view(A, B.id), spawn) && pasos(celda(view(A, B.id)), spawn) === 1,
  "B pidió la celda de A y aparece a su lado, no dentro de él",
);
check(said(B, "entró a la sala"), "B recibió el aviso de sistema de A");
check(
  [view(A), view(B)].every((v) => Number.isInteger(v.facing) && v.facing >= 0 && v.facing <= 7 && !("flip" in v)),
  "la dirección viaja como número 0..7 y sin espejo",
);

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
// El asiento se BUSCA en el mapa en vez de estar escrito aquí: así redecorar
// una sala no rompe el test (antes el sofá estaba fijado en (4,2) y al
// moverlo este bloque fallaba sin que hubiera ninguna regresión real).
const [sitCol, sitRow] = [...room1.sitCells][0].split(",").map(Number);
const sofa = { col: sitCol, row: sitRow };
const path = findPath(start, sofa, room1.cols, room1.rows, room1.isBlocked, true);
check(!!path && path.length > 0, `A* encontró un camino de ${path?.length ?? 0} celdas`);
if (path) {
  A.sock.emit("path", path);
  check(
    await until(() => view(A)?.sitting, 8000),
    `el servidor llega al asiento (${sofa.col},${sofa.row}) y se sienta`,
  );
  const asiento = room1.seats.get(`${sofa.col},${sofa.row}`);
  check(
    view(A).facing === asiento.dir,
    `sentado mira hacia donde mira el asiento (${view(A).facing} = ${asiento.dir})`,
  );
  A.sock.emit("stand");
  check(await until(() => !view(A)?.sitting, 3000), "`stand` lo levanta");
}

// ---------- 3b. Camino que llega con retraso ----------
// El cliente calcula el camino desde donde SE VE, y va por delante del
// servidor. Al cambiar de rumbo andando, el camino empieza a DOS celdas de
// donde el servidor lo tiene. Antes se tiraba sin avisar y el cliente acababa
// arrastrado hacia atrás.
const libre = (c, r, fuera = []) =>
  c >= 0 && r >= 0 && c < room1.cols && r < room1.rows && !room1.isBlocked(c, r) &&
  !fuera.some((f) => f.col === c && f.row === r);
let recta = null;
for (let row = 1; row < room1.rows - 1 && !recta; row++) {
  for (let col = 1; col < room1.cols - 4; col++) {
    const ocupadas = [celda(view(A, B.id))];
    if ([0, 1, 2, 3].every((i) => libre(col + i, row, ocupadas))) {
      recta = { col, row };
      break;
    }
  }
}
check(!!recta, "hay un tramo recto de 4 celdas libres en room1");
if (recta) {
  await colocar(A, recta);
  const meta = { col: recta.col + 3, row: recta.row };
  A.sock.emit("path", [{ col: recta.col + 2, row: recta.row }, meta]);
  check(
    (await hastaQueSePare(A, 4000)) && en(view(A), meta),
    `camino que empieza a 2 celdas del servidor: se acepta con un puente y llega a (${meta.col},${meta.row})`,
  );
}

// ---------- 3c. Cada uno en su baldosa ----------
// B se queda quieto; A camina justo hasta su celda. Tiene que pararse al
// lado, no encima.
{
  const deB = celda(view(A, B.id));
  const desde = celda(view(A));
  const hacia = findPath(desde, deB, room1.cols, room1.rows, room1.isBlocked);
  check(!!hacia && hacia.length >= 1, `A* de A hasta la celda de B (${deB.col},${deB.row})`);
  if (hacia) {
    A.sock.emit("path", hacia);
    await hastaQueSePare(A);
    const a = view(A);
    check(
      !en(a, deB) && pasos(celda(a), deB) === 1,
      `A se para al lado de B (${a.col.toFixed(2)},${a.row.toFixed(2)}) en vez de pisarlo`,
    );
  }
}

// Asiento ocupado: B se sienta en el sofá y A intenta el mismo
{
  const irAlSofa = (c) => {
    const p = findPath(celda(view(c)), sofa, room1.cols, room1.rows, room1.isBlocked, true);
    if (p) c.sock.emit("path", p);
    return !!p;
  };
  check(irAlSofa(B), "B tiene camino al sofá");
  check(await until(() => view(A, B.id)?.sitting, 8000), "B se sienta");
  check(irAlSofa(A), "A tiene camino al mismo sofá");
  await hastaQueSePare(A);
  const a = view(A);
  check(
    !a.sitting && !en(a, sofa),
    `con el sofá ocupado, A se queda de pie al lado (${a.col.toFixed(2)},${a.row.toFixed(2)})`,
  );
  B.sock.emit("stand");
  await until(() => !view(B)?.sitting, 3000);
  // Fuera del sofá (una celda bloqueada) para que B vuelva a ocupar sitio de verdad
  const suelto = room1.freeCell();
  await colocar(B, suelto);
}

// ---------- 3d. Aspecto ----------
// Un aspecto válido llega a los demás tal cual; uno con un estilo inventado
// se corrige CAMPO A CAMPO (lo inventado vuelve al valor por defecto, lo
// válido se respeta). Si el servidor se creyera cualquier cosa, un cliente
// podría pedir prendas que nadie sabe dibujar.
{
  const nuevo = {
    piel: "p5",
    pelo: "coleta",
    peloColor: "rosa",
    torso: "sudadera",
    torsoColor: "verde",
    piernas: "falda",
    piernasColor: "marino",
    pies: "botas",
    piesColor: "negro",
  };
  A.sock.emit("look", nuevo);
  check(
    await until(() => JSON.stringify(view(B, A.id)?.look) === JSON.stringify(nuevo)),
    "un aspecto válido llega a los demás tal cual",
  );
  A.sock.emit("look", { ...nuevo, torso: "armadura", pelo: 42 });
  check(
    await until(() => {
      const l = view(B, A.id)?.look;
      return l?.torso === "camiseta" && l?.pelo === "corto" && l?.torsoColor === "verde" && l?.pies === "botas";
    }),
    "un estilo inventado vuelve al de por defecto y el resto se respeta",
  );
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
// Un hueco de 2-3 celdas es retraso y se salva con un puente (3b); uno de 5
// ya es teletransportarse. El tramo se BUSCA lejos de A en vez de fijarlo:
// si A acabara cerca de (1,1), un camino fijo dejaría de ser trampa.
const posBefore = { ...view(A) };
let lejos = null;
for (let row = 0; row < room1.rows && !lejos; row++) {
  for (let col = 0; col < room1.cols - 2; col++) {
    if (pasos({ col, row }, celda(posBefore)) < 5) continue;
    if ([0, 1, 2].every((i) => libre(col + i, row))) {
      lejos = { col, row };
      break;
    }
  }
}
check(!!lejos, "hay un tramo libre a 5+ celdas de A");
if (lejos) {
  A.sock.emit("path", [0, 1, 2].map((i) => ({ col: lejos.col + i, row: lejos.row })));
  await sleep(300);
  const posAfter = view(A);
  check(
    Math.hypot(posAfter.col - posBefore.col, posAfter.row - posBefore.row) < 0.05,
    `camino que empieza a ${pasos(lejos, celda(posBefore))} celdas del avatar: rechazado`,
  );
}

// ---------- 5b. Colisión con mobiliario ----------
// Se BUSCA una celda libre que tenga un mueble justo al lado en +x de
// pantalla (col+1, row-1) y se empuja contra él: el servidor debe frenar al
// avatar igual que el cliente, sin atravesarlo. Antes esto dependía de que
// hubiera una mesa exactamente en (7,5).
let desde = null;
for (let row = 1; row < room1.rows - 1 && !desde; row++) {
  for (let col = 1; col < room1.cols - 1; col++) {
    const vecino = { col: col + 1, row: row - 1 };
    if (room1.isBlocked(col, row)) continue;
    if (vecino.row < 1 || !room1.isBlocked(vecino.col, vecino.row)) continue;
    desde = { col, row, obstaculo: vecino };
    break;
  }
}
check(!!desde, "hay mobiliario contra el que empujar en room1");
if (desde) {
  A.sock.emit("room", { room: "room1", col: desde.col, row: desde.row, facing: "down" });
  await until(
    () => Math.round(view(A).col) === desde.col && Math.round(view(A).row) === desde.row,
    3000,
  );
  const push = setInterval(() => A.sock.emit("move", 1, 0), 40);
  await sleep(700);
  A.sock.emit("move", 0, 0);
  clearInterval(push);
  const walled = view(A);
  // Se queda a menos de media celda del obstáculo, sin llegar a ocuparlo
  const dentro =
    Math.round(walled.col) !== desde.obstaculo.col ||
    Math.round(walled.row) !== desde.obstaculo.row;
  const avanzo = walled.col > desde.col + 0.2;
  check(
    dentro && avanzo,
    `el mueble (${desde.obstaculo.col},${desde.obstaculo.row}) frena al avatar en ` +
      `(${walled.col.toFixed(2)},${walled.row.toFixed(2)}) sin atravesarlo`,
  );
}

// ---------- 6. Desconexión ----------
const C = makeClient();
await registrar(C, "Carla");
await until(() => C.sock.connected, 3000);
await join(C, "room1", room1.freeCell());
const nickC = C.identidad.nickname;
check(await until(() => said(B, `${nickC} entró`)), "aviso de entrada de C");
C.sock.disconnect();
check(await until(() => said(B, `${nickC} salió`)), "aviso de salida por desconexión");

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
