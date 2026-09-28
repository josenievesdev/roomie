// Smoke test del multijugador: levanta dos (o tres) clientes de socket.io
// reales contra el servidor en :3001 y comprueba presencia, movimiento
// autoritativo, caminos A*, sentarse, chat y cambios de sala.
//
// Uso (con el servidor ya corriendo: `npm run dev:server`):
//   node tools/smoke-multiplayer.mjs
import { io } from "socket.io-client";
import { loadWorld, mundoDesdeMapa } from "../server/src/world.ts";
import { findPath } from "../src/utils/pathfinding.ts";
import { decodificarLook, mismoLook } from "../src/state/look.ts";

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

/** "AAAA-MM-DD" de alguien que cumplió `n` años ayer */
const fechaConEdad = (n) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const ADULTO = fechaConEdad(30);

/** Crea la cuenta y espera la confirmación del servidor */
const registrar = async (c, nombre, nacimiento = ADULTO) =>
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
      nacimiento,
    });
  });

/** Intenta registrarse y devuelve el error (o null si entró) */
const intentarRegistro = (c, nombre, nacimiento) =>
  new Promise((resolve) => {
    const { username, nickname } = cuentaDe(nombre);
    const listo = (r) => {
      c.sock.off("authOk", alOk);
      c.sock.off("authError", alError);
      resolve(r);
    };
    const alOk = () => listo(null);
    const alError = (e) => listo(e);
    c.sock.once("authOk", alOk);
    c.sock.once("authError", alError);
    c.sock.emit("auth", { mode: "register", username, password: CLAVE, nickname, nacimiento });
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
check(
  A.identidad.look?.cara === "redonda" && A.identidad.look?.ojos === "redondos",
  "y con la cara de siempre, que no tenía",
);
check(/^\d{4}-\d{2}$/.test(A.identidad.desde ?? ""), `al entrar se sabe desde cuándo tienes la cuenta (${A.identidad.desde})`);
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
    piel: "p9",
    cara: "corazon",
    ojos: "grandes",
    ojosColor: "verde",
    cejas: "arqueadas",
    nariz: "boton",
    boca: "sonrisa",
    detalle: "pecas",
    barba: "ninguna",
    pelo: "trenzas",
    peloColor: "caoba",
    torso: "sudadera",
    torsoColor: "verde",
    piernas: "falda",
    piernasColor: "marino",
    pies: "botas",
    piesColor: "negro",
  };
  // En la instantánea el aspecto viaja en código compacto: se descodifica
  const suyo = () => decodificarLook(view(B, A.id)?.look);
  A.sock.emit("look", nuevo);
  check(await until(() => mismoLook(suyo(), nuevo)), "un aspecto válido (cara incluida) llega a los demás tal cual");
  const codigo = view(B, A.id)?.look;
  check(typeof codigo === "string" && codigo.length <= 20, `y viaja en código compacto (${JSON.stringify(codigo)})`);
  A.sock.emit("look", { ...nuevo, torso: "armadura", pelo: 42, ojos: "laser", cara: "triangular" });
  check(
    await until(() => {
      const l = suyo();
      return l.torso === "camiseta" && l.pelo === "corto" && l.ojos === "redondos" && l.cara === "redonda" && l.torsoColor === "verde" && l.cejas === "arqueadas";
    }),
    "un estilo o un rasgo inventado vuelve al de por defecto y el resto se respeta",
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

// ---------- 4b. Chat seguro ----------
// La regla que más protege: un niño habla con frases del menú y nunca lee el
// texto libre de nadie. Y para todos: datos personales fuera, groserías
// tapadas, y bloquear funciona.
{
  const X = makeClient();
  await until(() => X.sock.connected, 3000);
  const sinFecha = await intentarRegistro(X, "Nofecha", undefined);
  check(sinFecha?.code === "INVALID", "sin fecha de nacimiento no se crea la cuenta");
  const peque = await intentarRegistro(X, "Peque", fechaConEdad(5));
  check(peque?.code === "UNDER_AGE", "por debajo de la edad mínima no se crea la cuenta");
  X.sock.disconnect();

  const K = makeClient();
  await registrar(K, "Kiki", fechaConEdad(10));
  check(K.identidad.modoChat === "frases" && A.identidad.modoChat === "libre", "un niño habla con frases; un adulto escribe");
  await until(() => K.sock.connected, 3000);
  await join(K, "room1", room1.freeCell());
  await until(() => view(A, K.id) && view(K, A.id), 3000);
  const vk = view(A, K.id);
  check(vk && !("nacimiento" in vk) && !("franja" in vk) && !("modoChat" in vk), "la edad de nadie viaja a los demás");

  const recibio = (c, texto, desde = 0) => c.chats.slice(desde).some((m) => m.text === texto);
  const espera = () => sleep(450); // el freno anti-spam es de 400 ms por jugador

  let marca = A.chats.length;
  K.sock.emit("chat", "hola, esto es texto libre");
  await sleep(500);
  check(!recibio(A, "hola, esto es texto libre", marca), "el texto libre de un niño no se envía");

  K.sock.emit("frase", "hola");
  check(
    await until(() => A.chats.slice(marca).some((m) => m.text === "¡Hola!" && m.frase === "hola" && m.from === K.id)),
    "la frase de un niño le llega a los demás, con el texto que pone el servidor",
  );
  K.sock.emit("frase", "frase-inventada");
  await sleep(300);

  await espera();
  let mk = K.chats.length;
  let mb = B.chats.length;
  A.sock.emit("chat", "¿qué tal todos?");
  check(await until(() => recibio(B, "¿qué tal todos?", mb)), "el texto libre de un adulto le llega a otro adulto");
  await sleep(300);
  check(!recibio(K, "¿qué tal todos?", mk), "pero a un niño no le llega nunca");

  await espera();
  A.sock.emit("frase", "que-tal");
  check(await until(() => recibio(K, "¿Qué tal?", mk)), "las frases sí le llegan a un niño");

  await espera();
  mb = B.chats.length;
  marca = A.chats.length;
  A.sock.emit("chat", "escríbeme al 312 345 6789");
  check(
    await until(() => A.chats.slice(marca).some((m) => m.system && m.text.includes("no compartas"))),
    "un teléfono no se envía, y a quien lo escribió se le explica por qué",
  );
  check(!B.chats.slice(mb).some((m) => m.text.includes("345")), "y a nadie le llega");

  await espera();
  A.sock.emit("chat", "eres un idiota");
  check(await until(() => recibio(B, "eres un ★★★★★★", mb)), "las groserías llegan tapadas");

  // Perfiles: el de quien tienes delante se ve, sin nada privado
  await espera();
  const pedirPerfil = (c, id, ms = 1500) =>
    new Promise((r) => {
      const f = (p) => {
        clearTimeout(t);
        r(p);
      };
      const t = setTimeout(() => {
        c.sock.off("perfil", f);
        r(null);
      }, ms);
      c.sock.once("perfil", f);
      c.sock.emit("perfil", id);
    });
  const perfilB = await pedirPerfil(A, B.id);
  check(
    perfilB?.id === B.id && perfilB.nombre === B.identidad.nickname && /^\d{4}-\d{2}$/.test(perfilB.desde ?? "") && typeof perfilB.look?.cara === "string",
    `se ve el perfil de quien tienes delante: nombre, aspecto y desde cuándo juega (${perfilB?.desde})`,
  );
  check(
    perfilB && Object.keys(perfilB).sort().join() === "desde,id,look,nombre",
    "y nada más: ni la edad, ni dónde vive, ni su cuenta",
  );

  // B bloquea a A: ya no le llega nada suyo, ni texto ni frases
  B.sock.emit("bloquear", A.id);
  const bloqueado = await new Promise((r) => {
    B.sock.once("bloqueos", (p) => r(p.bloqueados));
    setTimeout(() => r(null), 3000);
  });
  check(Array.isArray(bloqueado) && bloqueado.includes(A.identidad.nickname), "B bloquea a A y su lista lo dice");
  await espera();
  mb = B.chats.length;
  A.sock.emit("frase", "hola");
  await sleep(500);
  check(!B.chats.slice(mb).some((m) => m.from === A.id), "a quien bloqueó no le llega nada del bloqueado");
  check((await pedirPerfil(A, B.id, 900)) === null, "y el bloqueado no puede ver el perfil de quien le bloqueó");
  B.sock.emit("desbloquear", A.id);
  await until(() => B.chats.slice(mb).some((m) => m.system && m.text.includes("desbloqueado")), 3000);
  await espera();
  A.sock.emit("frase", "adios");
  check(await until(() => recibio(B, "¡Adiós!", mb)), "al desbloquear vuelve a llegar");

  // Un niño puede reportar
  mk = K.chats.length;
  K.sock.emit("reportar", { jugador: A.id, motivo: "lenguaje" });
  check(
    await until(() => K.chats.slice(mk).some((m) => m.system && m.text.startsWith("Gracias por avisar"))),
    "un niño puede reportar a alguien, y se le da las gracias",
  );
  K.sock.emit("reportar", { jugador: A.id, motivo: "lenguaje" });
  check(
    await until(() => K.chats.slice(mk).some((m) => m.system && m.text.startsWith("Ya nos avisaste"))),
    "reportar dos veces seguidas a la misma persona no duplica el reporte",
  );
  K.sock.disconnect();
  await until(() => !view(A, K.id), 3000);
}

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
// hubiera una mesa exactamente en (7,5). Asientos y puertas no valen: en
// ellos el teclado SÍ entra (5c y 5d).
const especial = (w, c, r) => w.seats.has(`${c},${r}`) || w.doorCells.has(`${c},${r}`);
let desde = null;
for (let row = 1; row < room1.rows - 1 && !desde; row++) {
  for (let col = 1; col < room1.cols - 1; col++) {
    const vecino = { col: col + 1, row: row - 1 };
    if (room1.isBlocked(col, row)) continue;
    if (vecino.row < 1 || !room1.isBlocked(vecino.col, vecino.row)) continue;
    // Un mueble de verdad: ni el anillo de muros del borde ni un asiento
    if (vecino.col > room1.cols - 2 || especial(room1, vecino.col, vecino.row)) continue;
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

/** Mantiene una dirección de teclado pulsada (como el cliente, cada 40 ms) */
const pulsar = (c, mx, my) => {
  const t = setInterval(() => c.sock.emit("move", mx, my), 40);
  c.sock.emit("move", mx, my);
  return () => {
    clearInterval(t);
    c.sock.emit("move", 0, 0);
  };
};

// ---------- 5c. El teclado sienta ----------
// Se busca un asiento con una celda libre al lado en uno de los cuatro ejes
// de pantalla, y se empuja desde ahí: al entrar, se sienta mirando hacia
// donde mira el asiento. Y sigue sentado con la tecla aún pulsada; si no, la
// misma tecla lo levantaría al instante.
{
  const EJES = [
    { mx: 1, my: 0, dc: -1, dr: 1 },
    { mx: -1, my: 0, dc: 1, dr: -1 },
    { mx: 0, my: 1, dc: -1, dr: -1 },
    { mx: 0, my: -1, dc: 1, dr: 1 },
  ];
  let prueba = null;
  for (const [key, seat] of room1.seats) {
    for (const e of EJES) {
      const from = { col: seat.col + e.dc, row: seat.row + e.dr };
      if (!libre(from.col, from.row, [celda(view(A, B.id))])) continue;
      prueba = { seat, from, e, key };
      break;
    }
    if (prueba) break;
  }
  check(!!prueba, "hay un asiento al que llegar con el teclado en room1");
  if (prueba) {
    const { seat, from, e } = prueba;
    await colocar(A, from);
    const soltar = pulsar(A, e.mx, e.my);
    const sento = await until(() => view(A)?.sitting, 3000);
    check(
      sento && en(view(A), seat) && view(A).facing === seat.dir,
      `con el teclado, A entra en el asiento (${seat.col},${seat.row}) y se sienta mirando a ${seat.dir}`,
    );
    await sleep(500);
    check(view(A)?.sitting, "con la tecla aún pulsada sigue sentado");
    soltar();
    await sleep(200);
    const levantar = pulsar(A, -e.mx, -e.my);
    check(
      await until(() => !view(A)?.sitting && !en(view(A), seat), 3000),
      "otra tecla lo levanta y lo saca del asiento",
    );
    levantar();
    await hastaQueSePare(A, 2000);
  }
}

// ---------- 5d. El teclado entra en las puertas ----------
// Delante de la puerta y hacia ella (las puertas están en los muros del
// fondo: fila 0 o columna 0). El servidor tiene que dejarle pisarla; cruzar
// a la otra sala ya es cosa del cliente, que conoce el destino.
{
  const [pc, pr] = [...room1.doorCells][0].split(",").map(Number);
  const puerta = { col: pc, row: pr };
  const delante = pr === 0 ? { col: pc, row: 1 } : { col: 1, row: pr };
  const [mx, my] = pr === 0 ? [Math.SQRT1_2, -Math.SQRT1_2] : [-Math.SQRT1_2, -Math.SQRT1_2];
  await colocar(A, delante);
  const soltar = pulsar(A, mx, my);
  check(
    await until(() => en(view(A), puerta), 3000),
    `con el teclado, A entra en la puerta (${pc},${pr})`,
  );
  soltar();
  await hastaQueSePare(A, 2000);
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

// ---------- 7b. La Plaza de la Llave ----------
// La entrada del juego: quien pide una sala que no existe entra en la plaza.
// Sus puertas llevan a las dos salas, y el banco girado (el del oeste del
// monumento) sienta mirando al sureste, igual que lo dibuja el cliente.
{
  const plaza = loadWorld("public/assets", "plaza");
  check(plaza.cols === 20 && plaza.rows === 20 && plaza.doorCells.size === 3, "la plaza (20×20) tiene sus tres puertas: Salón, Club y la portería");
  const P = makeClient();
  await registrar(P, "Paseo");
  await until(() => P.sock.connected, 3000);
  await join(P, "no-existe", { col: 5, row: 9 });
  check(await until(() => view(P)?.room === "plaza"), "quien pide una sala que no existe entra en la plaza");
  const girado = [...plaza.seats.values()].find((s) => s.dir === 3);
  check(!!girado, "en la plaza hay un banco girado");
  if (girado) {
    const camino = findPath(celda(view(P)), girado, plaza.cols, plaza.rows, plaza.isBlocked, true);
    if (camino) P.sock.emit("path", camino);
    check(
      !!camino && (await until(() => view(P)?.sitting, 8000)) && view(P).facing === 3,
      `sentado en el banco girado (${girado.col},${girado.row}) mira al sureste`,
    );
  }
  P.sock.disconnect();
}

// ---------- 7c. Tu casa ----------
// La portería da las llaves una sola vez, el piso recién mudado trae su cama
// (que ocupa dos celdas), su armario y sus cajas, y nadie más puede entrar.
{
  const once = (c, evento, ms = 4000) =>
    new Promise((r) => {
      const t = setTimeout(() => r(null), ms);
      c.sock.once(evento, (p) => {
        clearTimeout(t);
        r(p);
      });
    });
  const Q = makeClient();
  await registrar(Q, "Casita");
  check(Q.identidad.casa === null, "una cuenta nueva todavía no tiene casa");
  await until(() => Q.sock.connected, 3000);
  await join(Q, "plaza", { col: 11, row: 1 });
  Q.sock.emit("llaves");
  const casa = await once(Q, "casa");
  check(!!casa && /^casa:[0-9a-f-]{36}$/.test(casa.id), "la portera da las llaves: la casa es una sala nueva");
  Q.sock.emit("llaves");
  const otraVez = await once(Q, "casa");
  check(otraVez?.id === casa?.id, "pedir las llaves otra vez no crea otra casa");

  Q.sock.emit("irACasa");
  const datos = await once(Q, "salaDatos");
  const codigos = (datos?.muebles ?? []).map((m) => m.code).sort().join(",");
  check(datos?.id === casa?.id && codigos === "armario,cajas,cajas,cama", `el piso recién mudado trae cama, armario y cajas (${codigos})`);
  Q.sock.emit("room", { room: casa.id, col: 5, row: 1, facing: 4 });
  check(await until(() => view(Q)?.room === casa.id), "entra en su casa");

  // La cama ocupa dos celdas: las dos bloquean, en el servidor y en el mundo compartido
  const cama = datos.muebles.find((m) => m.code === "cama");
  const mundo = mundoDesdeMapa(datos.mapa, datos.muebles);
  check(mundo.isBlocked(cama.col, cama.row) && mundo.isBlocked(cama.col, cama.row + 1), "la cama bloquea sus dos celdas");
  const antes = { ...view(Q) };
  Q.sock.emit("path", [{ col: 4, row: 1 }, { col: 3, row: 1 }, { col: 2, row: 1 }, { col: cama.col, row: cama.row + 1 }]);
  await sleep(600);
  check(Math.hypot(view(Q).col - antes.col, view(Q).row - antes.row) < 0.05, "un camino que acaba en los pies de la cama se rechaza");

  // Nadie más entra (hasta que haya amigos, la norma es ésa)
  const salaB = view(B)?.room;
  B.sock.emit("room", { room: casa.id, col: 5, row: 1, facing: 4 });
  await sleep(600);
  check(view(B)?.room === salaB && view(B)?.room !== casa.id, "nadie más puede entrar en tu casa");
  check(!view(B, Q.id), "y quien está fuera no ve a nadie de dentro");

  // Al volver a entrar, el servidor recuerda la casa
  Q.sock.disconnect();
  const Q2 = makeClient();
  await until(() => Q2.sock.connected, 3000);
  const { username } = cuentaDe("Casita");
  Q2.sock.emit("auth", { mode: "login", username, password: CLAVE });
  const ok = await once(Q2, "authOk");
  check(ok?.casa?.id === casa.id, "al volver a entrar, el servidor dice cuál es tu casa");
  Q2.sock.disconnect();
}

// ---------- 7d. La tienda y decorar ----------
{
  const once = (c, evento, ms = 4000) =>
    new Promise((r) => {
      const t = setTimeout(() => r(null), ms);
      c.sock.once(evento, (p) => {
        clearTimeout(t);
        r(p);
      });
    });
  const espera = () => sleep(300); // el freno de las acciones es de 250 ms
  const D = makeClient();
  await registrar(D, "Deco");
  await until(() => D.sock.connected, 3000);
  await join(D, "plaza", { col: 11, row: 1 });
  D.sock.emit("llaves");
  const casa = await once(D, "casa");
  D.sock.emit("irACasa");
  const datos = await once(D, "salaDatos");
  D.sock.emit("room", { room: casa.id, col: 5, row: 1, facing: 4 });
  await until(() => view(D)?.room === casa.id);

  D.sock.emit("tienda");
  const tienda = await once(D, "tienda");
  const sofa = tienda?.articulos.find((a) => a.code === "sofa");
  check(
    !!sofa && sofa.precio === 60 && sofa.moneda === "monedas" && !tienda.articulos.some((a) => a.code === "cajas"),
    "la tienda vende el sofá (60 monedas) y no las cajas de regalo",
  );

  D.sock.emit("comprar", "sofa");
  const [compra, saldo, mochila] = await Promise.all([once(D, "resultado"), once(D, "saldo"), once(D, "mochila")]);
  const miSofa = mochila?.cosas.find((c) => c.code === "sofa");
  check(compra?.ok && saldo?.monedas === 440 && !!miSofa, `comprar el sofá: -60 monedas y a la mochila (${saldo?.monedas})`);
  await espera();
  D.sock.emit("comprar", "cajas");
  check((await once(D, "resultado"))?.ok === false, "lo regalado no se puede comprar");

  // Colocar: en su sitio sí; en la entrada de la puerta o en los pies de la cama, no
  await espera();
  D.sock.emit("colocar", { item: miSofa.id, col: 4, row: 5, rot: 0 });
  const [puesto, muebles] = await Promise.all([once(D, "resultado"), once(D, "muebles")]);
  check(puesto?.ok && muebles?.muebles.some((m) => m.id === miSofa.id && m.col === 4 && m.row === 5), "el sofá se pone en la casa y a quien está dentro le llegan los muebles nuevos");
  await espera();
  D.sock.emit("colocar", { item: miSofa.id, col: 5, row: 1, rot: 0 });
  check((await once(D, "resultado"))?.ok === false, "no se puede tapar la entrada de la puerta");
  await espera();
  D.sock.emit("colocar", { item: miSofa.id, col: 1, row: 1, rot: 0 });
  check((await once(D, "resultado"))?.ok === false, "ni ponerlo en los pies de la cama");

  // El servidor respeta el sofá nuevo: no se puede terminar un camino encima
  await espera();
  const antes = { ...view(D) };
  const conSofa = mundoDesdeMapa(datos.mapa, muebles.muebles);
  const alSofa = findPath(celda(view(D)), { col: 4, row: 5 }, conSofa.cols, conSofa.rows, conSofa.isBlocked, true);
  if (alSofa) D.sock.emit("path", alSofa);
  await until(() => view(D)?.sitting, 5000);
  const v = view(D);
  check(v.sitting && en(v, { col: 4, row: 5 }), `el servidor ya conoce el sofá nuevo: el camino acaba sentándote en él (${alSofa?.length ?? "sin"} celdas; ${v.col.toFixed(2)},${v.row.toFixed(2)} ${v.sitting ? "sentado" : "de pie"})`);

  // Guardar y vender
  D.sock.emit("stand");
  await espera();
  D.sock.emit("recoger", miSofa.id);
  const [guardado, mueblesSin] = await Promise.all([once(D, "resultado"), once(D, "muebles")]);
  check(guardado?.ok && !mueblesSin?.muebles.some((m) => m.id === miSofa.id), "guardar el sofá lo quita de la casa");
  await espera();
  D.sock.emit("vender", miSofa.id);
  const [venta, saldoVenta] = await Promise.all([once(D, "resultado"), once(D, "saldo")]);
  check(venta?.ok && saldoVenta?.monedas === 470, `venderlo devuelve la mitad (+30: ${saldoVenta?.monedas})`);

  // Girar: lo de dos caras (el armario) se gira sin moverlo de su sitio
  const armario = datos.muebles.find((m) => m.code === "armario");
  await espera();
  D.sock.emit("colocar", { item: armario.id, col: armario.col, row: armario.row, rot: armario.rot === 1 ? 0 : 1 });
  const [giro, mueblesGiro] = await Promise.all([once(D, "resultado"), once(D, "muebles")]);
  const girado = mueblesGiro?.muebles.find((m) => m.id === armario.id);
  check(
    giro?.texto === "¡Girado!" && girado?.rot !== armario.rot && girado?.col === armario.col && girado?.row === armario.row,
    `girar el armario lo gira en su sitio (${giro?.texto})`,
  );

  // Fuera de casa no se decora
  D.sock.emit("room", { room: "plaza", col: 11, row: 1, facing: 4 });
  await until(() => view(D)?.room === "plaza");
  await espera();
  D.sock.emit("colocar", { item: datos.muebles[0].id, col: 3, row: 3, rot: 0 });
  check((await once(D, "resultado"))?.ok === false, "fuera de tu casa no se puede decorar");
  D.sock.disconnect();
}

// ---------- 8. Las salas no se mezclan ----------
check(
  view(A, B.id) === undefined,
  "B (room1) no aparece en el snapshot de A (room2)",
);

A.sock.disconnect();
B.sock.disconnect();
console.log(failures === 0 ? "\nTODO OK" : `\n${failures} comprobaciones fallidas`);
process.exit(failures === 0 ? 0 : 1);
