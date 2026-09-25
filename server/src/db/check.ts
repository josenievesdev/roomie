import { sql, conexion, cerrar } from "./index.ts";
import { FURNITURE } from "../../../src/state/furniture-catalog.ts";
import {
  autenticar,
  comprar,
  crearCuenta,
  inventarioDe,
  moverSaldo,
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
  for (const t of ["accounts", "avatars", "rooms", "catalog_items", "items", "ledger", "balances"]) {
    ok(tablas.includes(t), `existe la tabla ${t}`);
  }

  // El catálogo de la tienda tiene que casar con lo que el cliente sabe dibujar
  console.log("\n=== Catálogo ===");
  const enBd = (await sql<{ code: string }[]>`select code from catalog_items`).map((r) => r.code);
  const enCodigo = Object.keys(FURNITURE);
  const faltan = enCodigo.filter((c) => !enBd.includes(c));
  const sobran = enBd.filter((c) => !enCodigo.includes(c));
  ok(faltan.length === 0, "todo lo que el cliente dibuja se puede comprar", faltan.join(", "));
  ok(sobran.length === 0, "nada del catálogo es indibujable", sobran.join(", "));

  // ------------------------------------------------------ reglas
  console.log("\n=== Reglas que deben ser imposibles de romper ===");
  const sufijo = Date.now().toString(36).slice(-6);
  const user = `chk${sufijo}`;
  const nueva = await crearCuenta(user, "clave-de-prueba", `Chk${sufijo}`, { shirt: 1, hair: 2 });
  ok(nueva.saldo === 500, "la cuenta nueva arranca con 500", String(nueva.saldo));

  const login = await autenticar(user, "clave-de-prueba");
  ok(login !== null, "entra con la contraseña correcta");
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

  // ------------------------------------------------------ limpieza
  await sql`delete from rooms where id = ${sala.id}`;
  await sql`delete from accounts where id = ${id}`;
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
