import { sql, conexion, cerrar } from "./index.ts";
import { FURNITURE } from "../../../src/state/furniture-catalog.ts";
import {
  autenticar,
  bloquear,
  bloqueadosDe,
  casaDe,
  comprar,
  darLlaves,
  crearCuenta,
  desbloquear,
  guardarNacimiento,
  guardarReporte,
  inventarioDe,
  moverSaldo,
  premioDiario,
  saldosDe,
  vender,
  PREMIO_DIARIO,
  purgarChat,
  registrarChat,
  saldoDe,
  colocar,
  recoger,
} from "./repo.ts";

// Comprobación de la base de datos. No se limita a "¿conecta?": ejerce las
// reglas que tienen que ser imposibles de romper, con datos reales, y lo borra
// todo al terminar.
//
//   npm run db:check

let fallos = 0;
const ok = (cond: boolean, msg: string, extra = ""): void => {
  console.log(`  ${cond ? "ok   " : "FALLA"} ${msg}${extra ? "  — " + extra : ""}`);
  if (!cond) fallos++;
};

async function falla(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

console.log(`Comprobando ${conexion.host}${conexion.pooler ? " (pooler)" : ""}\n`);

try {
  // ------------------------------------------------------ esquema
  console.log("=== Esquema ===");
  const tablas = (
    await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public'
    `
  ).map((r) => r.table_name);
  for (const t of ["accounts", "avatars", "rooms", "catalog_items", "items", "ledger", "balances", "blocks", "reports", "chat_log"]) {
    ok(tablas.includes(t), `existe la tabla ${t}`);
  }

  // El catálogo de la tienda tiene que casar con lo que el cliente sabe dibujar
  console.log("\n=== Catálogo ===");
  const enBd = (await sql<{ code: string }[]>`select code from catalog_items`).map((r) => r.code);
  // Lo que pone la ciudad (farolas, el monumento) no se vende
  const enCodigo = Object.keys(FURNITURE).filter((c) => !FURNITURE[c].mundo);
  const faltan = enCodigo.filter((c) => !enBd.includes(c));
  const sobran = enBd.filter((c) => !enCodigo.includes(c));
  ok(faltan.length === 0, "todo lo que el cliente dibuja se puede comprar", faltan.join(", "));
  ok(sobran.length === 0, "nada del catálogo es indibujable", sobran.join(", "));
  // Los avisos del servidor ("Sofá: ¡puesto!") usan el nombre del código; la
  // tienda, el de la base. Tienen que ser el mismo.
  const nombres = await sql<{ code: string; name: string }[]>`select code, name from catalog_items`;
  const distintos = nombres.filter((r) => FURNITURE[r.code] && FURNITURE[r.code].nombre !== r.name);
  ok(
    distintos.length === 0,
    "cada cosa se llama igual en la tienda que en los avisos",
    distintos.map((r) => `${r.code}: "${r.name}" / "${FURNITURE[r.code].nombre}"`).join(", "),
  );

  // ------------------------------------------------------ reglas
  console.log("\n=== Reglas que deben ser imposibles de romper ===");
  const sufijo = Date.now().toString(36).slice(-6);
  const user = `chk${sufijo}`;
  const nueva = await crearCuenta(user, "clave-de-prueba", `Chk${sufijo}`, { shirt: 1, hair: 2 }, "1990-05-10", "no_necesita");
  ok(nueva.saldo === 500, "la cuenta nueva arranca con 500", String(nueva.saldo));

  const login = await autenticar(user, "clave-de-prueba");
  ok(login !== null, "entra con la contraseña correcta");
  ok(login?.account.nacimiento === "1990-05-10", "guarda la fecha de nacimiento tal cual", String(login?.account.nacimiento));
  ok((await autenticar(user, "clave-equivocada")) === null, "rechaza la contraseña incorrecta");
  ok((await autenticar("no-existe-" + sufijo, "x")) === null, "rechaza una cuenta inexistente");

  const id = nueva.account.id;

  const sinFondos = await falla(() => moverSaldo(id, -999999, "prueba"));
  ok(sinFondos !== null, "no se puede quedar en números rojos");
  ok((await saldoDe(id)) === 500, "y el saldo no se movió", String(await saldoDe(id)));

  const item = await comprar(id, "sofa");
  ok((await saldoDe(id)) === 440, "comprar un sofá (60) deja 440", String(await saldoDe(id)));
  ok((await inventarioDe(id)).length === 1, "el sofá está en el inventario");

  const caro = await falla(() => comprar(id, "no-existe"));
  ok(caro !== null, "no se puede comprar algo fuera del catálogo");

  // Cada compra es una fila distinta: no hay "cantidad" que duplicar
  await comprar(id, "sofa");
  const inv = await inventarioDe(id);
  ok(inv.length === 2 && inv[0].id !== inv[1].id, "dos sofás son dos filas con id distinto");

  // El libro mayor y el saldo tienen que cuadrar
  const [desc] = await sql`select count(*)::int as n from saldos_descuadrados`;
  ok(desc.n === 0, "ningún saldo discrepa de su libro mayor", `${desc.n} descuadrados`);

  const apuntes = await sql<{ n: string }[]>`select count(*) as n from ledger where account_id = ${id}`;
  ok(Number(apuntes[0].n) === 3, "quedan 3 apuntes: alta y dos compras", apuntes[0].n);

  // Colocar y recoger
  const [sala] = await sql<{ id: string }[]>`
    insert into rooms (slug, name, kind, cols, rows, layout)
    values (${"chk-" + sufijo}, 'Sala de prueba', 'public', 8, 8, '{}'::jsonb)
    returning id
  `;
  await colocar(item.id, id, sala.id, 3, 4, 0);
  const colocado = (await inventarioDe(id)).length;
  ok(colocado === 1, "al colocarlo sale del inventario", `quedan ${colocado}`);

  const ajeno = await falla(() => colocar(item.id, nueva.avatar.id, sala.id, 1, 1));
  ok(ajeno !== null, "no puedes colocar un objeto que no es tuyo");

  const chocar = await falla(async () => {
    const otro = (await inventarioDe(id))[0];
    await colocar(otro.id, id, sala.id, 3, 4, 0); // misma celda y misma altura
  });
  ok(chocar !== null, "dos muebles no caben en la misma celda a la misma altura");

  const apilar = await falla(async () => {
    const otro = (await inventarioDe(id))[0];
    await colocar(otro.id, id, sala.id, 3, 4, 1); // misma celda, encima
  });
  ok(apilar === null, "pero sí se puede apilar (alfombra debajo, mueble encima)");

  await recoger(item.id, id);
  ok((await inventarioDe(id)).length === 1, "recogerlo lo devuelve al inventario");

  // Borrar la sala devuelve sus muebles al inventario, no los destruye ni
  // deja filas medio colocadas. Esto es lo que destapó que `on delete set
  // null` vaciaba room_id pero no col/row.
  const suelto = (await inventarioDe(id))[0];
  await colocar(suelto.id, id, sala.id, 6, 6, 0);
  const [{ n: enTotal }] = await sql<{ n: number }[]>`
    select count(*)::int as n from items where owner_id = ${id}
  `;
  await sql`delete from rooms where id = ${sala.id}`;
  const despues = await inventarioDe(id);
  // La propiedad que importa: no se destruye nada. Todo lo que tenía sigue
  // siendo suyo, y ahora está en el inventario.
  ok(
    despues.length === enTotal,
    "borrar la sala devuelve sus muebles al inventario, sin perder ninguno",
    `${enTotal} en total -> ${despues.length} en inventario`,
  );
  ok(
    despues.every((i) => i.room_id === null && i.col === null && i.row === null),
    "y ninguno queda medio colocado",
  );

  // ------------------------------------------------------ seguridad
  console.log("\n=== Seguridad (edad, bloqueos, reportes, chat) ===");
  const otra = await crearCuenta(`chq${sufijo}`, "clave-de-prueba", `Chq${sufijo}`, {}, "2015-03-01", "pendiente");
  const id2 = otra.account.id;
  ok(otra.account.consentimiento === "pendiente", "una cuenta de menor de 13 queda pendiente del permiso de su tutor");

  ok(
    (await guardarNacimiento(id, "2001-01-01", "no_necesita")) === false,
    "una fecha de nacimiento ya dicha no se cambia desde el juego",
  );
  await sql`update accounts set birth_date = null where id = ${id}`;
  ok((await guardarNacimiento(id, "1990-05-10", "no_necesita")) === true, "una cuenta de antes, sin fecha, sí puede decirla");

  ok(
    (await falla(() => sql`update accounts set birth_date = '1800-01-01' where id = ${id}`)) !== null,
    "no se guarda una fecha de nacimiento absurda",
  );
  ok(
    (await falla(() => sql`update accounts set consent = 'porque-si' where id = ${id}`)) !== null,
    "el permiso del tutor sólo puede ser no_necesita, pendiente o aprobado",
  );

  ok((await falla(() => bloquear(id, id))) !== null, "nadie se puede bloquear a sí mismo");
  await bloquear(id, id2);
  ok((await falla(() => bloquear(id, id2))) === null, "bloquear dos veces no falla");
  ok((await bloqueadosDe(id)).has(id2), "el bloqueo queda guardado");
  await desbloquear(id, id2);
  ok(!(await bloqueadosDe(id)).has(id2), "y se puede deshacer");

  ok(
    (await falla(() => sql`insert into reports (reporter_id, reported_id, reason) values (${id}, ${id2}, 'me-cae-mal')`)) !== null,
    "un reporte sólo lleva un motivo de la lista",
  );
  await guardarReporte({ de: id2, sobre: id, motivo: "datos", sala: "room1", contexto: [{ texto: "prueba" }] });
  const [rep1] = await sql<{ id: string }[]>`select id from reports where reporter_id = ${id2} and reported_id = ${id}`;
  ok(rep1 !== undefined, "el reporte se guarda con su contexto");

  await registrarChat(id, "room1", "hola", null);
  await registrarChat(id, "room1", "mi numero es 3123456789", "datos");
  ok(
    (await falla(() => sql`insert into chat_log (account_id, room, text, blocked) values (${id}, 'room1', 'x', 'otro')`)) !== null,
    "el registro del chat sólo marca 'datos' o 'sexual' como parado",
  );
  await sql`insert into chat_log (account_id, room, text, created_at) values (${id}, 'room1', 'viejo', now() - interval '31 days')`;
  const purgadas = await purgarChat(30);
  const [{ n: quedan }] = await sql<{ n: number }[]>`select count(*)::int as n from chat_log where account_id = ${id}`;
  ok(purgadas >= 1 && quedan === 2, "el chat de más de 30 días se borra solo, y el reciente se queda", `${purgadas} borrada(s), quedan ${quedan}`);

  // Borrar una cuenta no borra lo que se reportó de ella: es un registro
  await sql`delete from accounts where id = ${id2}`;
  const [sigue] = await sql<{ reporter_id: string | null }[]>`select reporter_id from reports where id = ${rep1.id}`;
  ok(sigue !== undefined && sigue.reporter_id === null, "el reporte sobrevive a que se borre quien lo hizo");

  // ------------------------------------------------------ casas
  console.log("\n=== Casas ===");
  const plantilla = { width: 8, height: 8, layers: [] };
  const regalo = [{ code: "cama", col: 1, row: 0 }, { code: "cajas", col: 4, row: 3 }];
  const primera = await darLlaves(id, "Tu casa", plantilla, regalo);
  ok(primera.nueva, "la portería da las llaves de una casa nueva");
  const segunda = await darLlaves(id, "Tu casa", plantilla, regalo);
  ok(!segunda.nueva && segunda.casa.id === primera.casa.id, "pedirlas otra vez devuelve la MISMA casa");
  ok(
    (await falla(() => sql`
      insert into rooms (slug, name, kind, owner_id, cols, rows, layout)
      values (${"otra-" + sufijo}, 'Otra', 'personal', ${id}, 8, 8, '{}'::jsonb)
    `)) !== null,
    "una cuenta no puede tener dos casas (ni saltándose al servidor)",
  );
  const [{ n: enCasa }] = await sql<{ n: number }[]>`select count(*)::int as n from items where room_id = ${primera.casa.id}`;
  ok(enCasa === regalo.length, "los muebles de regalo están colocados en la casa", `${enCasa} colocados`);
  ok((await falla(() => comprar(id, "cajas"))) !== null, "las cajas de la mudanza se regalan: no se pueden comprar");
  ok((await casaDe(id))?.id === primera.casa.id, "la casa queda apuntada a su dueño");

  // ------------------------------------------------------ economía
  console.log("\n=== Economía ===");
  const saldoAntes = (await saldosDe(id)).monedas;
  ok((await premioDiario(id)) === null, "el día que te registras, el premio diario ya es el de bienvenida");
  await sql`delete from premios_diarios where account_id = ${id}`; // como si fuera otro día
  const conPremio = await premioDiario(id);
  ok(conPremio === saldoAntes + PREMIO_DIARIO, `al día siguiente llega el premio diario (+${PREMIO_DIARIO})`, String(conPremio));
  ok((await premioDiario(id)) === null, "y sólo una vez al día");

  ok(
    (await falla(() => sql`select mover_saldo(${id}::uuid, -1::bigint, 'prueba', null, null, 'creditos')`)) !== null,
    "los créditos tampoco pueden quedar en negativo",
  );
  ok(
    (await falla(() => sql`select mover_saldo(${id}::uuid, 5::bigint, 'prueba', null, null, 'doblones')`)) !== null,
    "no existe otra moneda que monedas y créditos",
  );

  // Un artículo de prueba que se paga en créditos
  await sql`
    insert into catalog_items (code, name, kind, price, tradable, for_sale, currency)
    values (${"chk-" + sufijo}, 'Prueba en créditos', 'floor', 3, true, true, 'creditos')
  `;
  const sinCreditos = await falla(() => comprar(id, "chk-" + sufijo));
  ok(sinCreditos !== null, "sin créditos no se compra lo que se paga en créditos");
  await sql`select mover_saldo(${id}::uuid, 5::bigint, 'prueba', null, null, 'creditos')`;
  const monedasAntes = (await saldosDe(id)).monedas;
  await comprar(id, "chk-" + sufijo);
  const tras = await saldosDe(id);
  ok(tras.creditos === 2 && tras.monedas === monedasAntes, "cada cosa se paga en su moneda (3 créditos, ni una moneda)", JSON.stringify(tras));

  // Vender: la mitad, y el objeto desaparece
  const sofaNuevo = await comprar(id, "sofa");
  const antesVenta = (await saldosDe(id)).monedas;
  const venta = await vender(id, sofaNuevo.id);
  ok(venta.recibe === 30 && (await saldosDe(id)).monedas === antesVenta + 30, "vender un sofá (60) da la mitad: 30");
  ok((await inventarioDe(id)).every((i) => i.id !== sofaNuevo.id), "y el sofá ya no está");
  ok((await falla(() => vender(id, sofaNuevo.id))) !== null, "no se puede vender dos veces");
  const [puesto] = await sql<{ id: string }[]>`select id from items where room_id = ${primera.casa.id} limit 1`;
  ok((await falla(() => vender(id, puesto.id))) !== null, "ni vender lo que está puesto en tu casa (primero se guarda)");
  const [{ n: descuadres }] = await sql<{ n: number }[]>`select count(*)::int as n from saldos_descuadrados`;
  ok(descuadres === 0, "el libro y los saldos cuadran, moneda a moneda");
  await sql`delete from items where code = ${"chk-" + sufijo}`;
  await sql`delete from catalog_items where code = ${"chk-" + sufijo}`;

  // ------------------------------------------------------ limpieza
  await sql`delete from accounts where id = ${id}`;
  const [sinCasa] = await sql`select count(*)::int as n from rooms where id = ${primera.casa.id}`;
  ok(sinCasa.n === 0, "borrar la cuenta se lleva su casa (cascade)");
  await sql`delete from reports where id = ${rep1.id}`;
  const [queda] = await sql`select count(*)::int as n from ledger where account_id = ${id}`;
  ok(queda.n === 0, "borrar la cuenta se lleva sus apuntes (cascade)");

  console.log(fallos === 0 ? "\n=== BASE DE DATOS CORRECTA ===" : `\n=== ${fallos} FALLO(S) ===`);
} catch (e) {
  console.error(`\nERROR: ${e instanceof Error ? e.message : String(e)}`);
  fallos++;
} finally {
  await cerrar();
}

process.exitCode = fallos === 0 ? 0 : 1;
