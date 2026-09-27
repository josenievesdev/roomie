import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "./index.ts";
import type { MotivoReporte } from "../../../src/net/protocol.ts";

// Capa de datos. Todo lo que toca la base de datos pasa por aquí; el resto del
// servidor no escribe SQL.

// ---------------------------------------------------------------- Contraseñas
//
// scrypt del propio Node: es un KDF serio (lento a propósito, con sal y con
// coste de memoria) y no arrastra una dependencia nativa, que en Windows es
// una fuente garantizada de dolores al instalar.
//
// Formato guardado: scrypt$N$sal_hex$hash_hex

const COSTE = 16384; // 2^14

export function hashPassword(clave: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(clave.normalize("NFKC"), sal, 64, { N: COSTE });
  return `scrypt$${COSTE}$${sal.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(clave: string, guardado: string): boolean {
  const [algo, n, salHex, hashHex] = guardado.split("$");
  if (algo !== "scrypt" || !n || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const calculado = scryptSync(clave.normalize("NFKC"), Buffer.from(salHex, "hex"), esperado.length, {
    N: Number(n),
  });
  // Comparación de tiempo constante: comparar con === filtra información
  // sobre cuántos bytes coinciden.
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

// ------------------------------------------------------------------- Cuentas

export type Consentimiento = "no_necesita" | "pendiente" | "aprobado";

/**
 * La cuenta, con lo que las normas necesitan saber. `nacimiento` es null en
 * las cuentas de antes de pedirlo: el servidor no las deja jugar hasta que
 * lo dicen. NUNCA se envía a otros jugadores.
 */
export type Account = {
  id: string;
  username: string;
  nacimiento: string | null;
  consentimiento: Consentimiento;
};

/** Columnas de `accounts` que forman una `Account` (la fecha, como texto: sin zonas horarias) */
const columnasCuenta = () => sql`id, username, birth_date::text as nacimiento, consent as consentimiento`;
export type Avatar = { id: string; nickname: string; look: Record<string, string | number> };

/** Saldo con el que empieza una cuenta nueva */
export const SALDO_INICIAL = 500;

export async function crearCuenta(
  username: string,
  clave: string,
  nickname: string,
  look: Record<string, string | number>,
  nacimiento: string,
  consentimiento: Consentimiento,
): Promise<{ account: Account; avatar: Avatar; saldo: number }> {
  return sql.begin(async (tx) => {
    const [cuenta] = await tx<Account[]>`
      insert into accounts (username, password_hash, birth_date, consent)
      values (${username}, ${hashPassword(clave)}, ${nacimiento}::date, ${consentimiento})
      returning ${columnasCuenta()}
    `;
    const [avatar] = await tx<{ id: string; nickname: string; look: Record<string, string | number> }[]>`
      insert into avatars (account_id, nickname, look)
      values (${cuenta.id}, ${nickname}, ${tx.json(look)})
      returning id, nickname, look
    `;
    // El regalo de bienvenida pasa por el libro mayor como todo lo demás: no
    // hay forma de que aparezca dinero sin dejar rastro.
    const [{ mover_saldo: saldo }] = await tx<{ mover_saldo: string }[]>`
      select mover_saldo(${cuenta.id}::uuid, ${SALDO_INICIAL}::bigint, 'alta')
    `;
    return { account: cuenta, avatar, saldo: Number(saldo) };
  });
}

export async function autenticar(
  username: string,
  clave: string,
): Promise<{ account: Account; avatar: Avatar; saldo: number } | null> {
  const [fila] = await sql<(Account & { password_hash: string })[]>`
    select ${columnasCuenta()}, password_hash from accounts where lower(username) = lower(${username})
  `;

  // Se verifica igual aunque la cuenta no exista, con un hash de pega: así el
  // tiempo de respuesta no delata qué usuarios están registrados.
  const guardado = fila?.password_hash ?? hashPassword("cuenta-inexistente");
  const vale = verifyPassword(clave, guardado);
  if (!fila || !vale) return null;

  await sql`update accounts set last_login_at = now() where id = ${fila.id}`;
  const [avatar] = await sql<{ id: string; nickname: string; look: Record<string, string | number> }[]>`
    select id, nickname, look from avatars where account_id = ${fila.id} order by created_at limit 1
  `;
  return {
    account: { id: fila.id, username: fila.username, nacimiento: fila.nacimiento, consentimiento: fila.consentimiento },
    avatar,
    saldo: await saldoDe(fila.id),
  };
}

/** La cuenta por id (para reanudar una sesión) */
export async function cuentaPorId(id: string): Promise<Account | null> {
  const [fila] = await sql<Account[]>`select ${columnasCuenta()} from accounts where id = ${id}`;
  return fila ?? null;
}

/**
 * Apunta la fecha de nacimiento de una cuenta de antes. Sólo si no tenía:
 * una vez dicha no se cambia desde el juego (si no, bastaría con cambiarla
 * para saltarse las normas). Devuelve false si ya la tenía.
 */
export async function guardarNacimiento(
  accountId: string,
  nacimiento: string,
  consentimiento: Consentimiento,
): Promise<boolean> {
  const filas = await sql`
    update accounts set birth_date = ${nacimiento}::date, consent = ${consentimiento}
     where id = ${accountId} and birth_date is null
  `;
  return filas.count === 1;
}

export async function nombreLibre(username: string): Promise<boolean> {
  const [fila] = await sql`select 1 from accounts where lower(username) = lower(${username})`;
  return fila === undefined;
}

export async function nicknameLibre(nickname: string): Promise<boolean> {
  const [fila] = await sql`select 1 from avatars where lower(nickname) = lower(${nickname})`;
  return fila === undefined;
}

/** Guarda el aspecto en la cuenta, para que sobreviva al cierre de sesión */
export async function guardarLook(accountId: string, look: Record<string, string | number>): Promise<void> {
  await sql`
    update avatars set look = ${sql.json(look)}
     where account_id = ${accountId}
  `;
}

// ---------------------------------------------------------------- Seguridad

/** A quién ha bloqueado una cuenta */
export async function bloqueadosDe(accountId: string): Promise<Set<string>> {
  const filas = await sql<{ blocked_id: string }[]>`
    select blocked_id from blocks where account_id = ${accountId}
  `;
  return new Set(filas.map((f) => f.blocked_id));
}

/** Los nombres en el juego de unas cuentas (para decirle a alguien a quién tiene bloqueado) */
export async function nicknamesDe(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const filas = await sql<{ nickname: string }[]>`
    select nickname from avatars where account_id in ${sql(ids)} order by nickname
  `;
  return filas.map((f) => f.nickname);
}

export async function bloquear(accountId: string, bloqueado: string): Promise<void> {
  await sql`
    insert into blocks (account_id, blocked_id) values (${accountId}, ${bloqueado})
    on conflict do nothing
  `;
}

export async function desbloquear(accountId: string, bloqueado: string): Promise<void> {
  await sql`delete from blocks where account_id = ${accountId} and blocked_id = ${bloqueado}`;
}

export async function guardarReporte(r: {
  de: string;
  sobre: string;
  motivo: MotivoReporte;
  sala: string;
  contexto: unknown[];
}): Promise<void> {
  await sql`
    insert into reports (reporter_id, reported_id, reason, room, context)
    values (${r.de}, ${r.sobre}, ${r.motivo}, ${r.sala}, ${sql.json(r.contexto as never)})
  `;
}

/** Apunta una línea del chat (también las que el filtro paró) */
export async function registrarChat(
  accountId: string,
  sala: string,
  texto: string,
  bloqueado: "datos" | "sexual" | null,
): Promise<void> {
  await sql`
    insert into chat_log (account_id, room, text, blocked)
    values (${accountId}, ${sala}, ${texto}, ${bloqueado})
  `;
}

/** Borra el chat de más de `dias` días */
export async function purgarChat(dias = 30): Promise<number> {
  const [fila] = await sql<{ purgar_chat: number }[]>`select purgar_chat(${dias}::int)`;
  return fila.purgar_chat;
}

// -------------------------------------------------------------------- Dinero

export async function saldoDe(accountId: string): Promise<number> {
  const [fila] = await sql<{ amount: string }[]>`
    select amount from balances where account_id = ${accountId}
  `;
  return Number(fila?.amount ?? 0);
}

/**
 * Único camino para mover dinero. Si no hay fondos, Postgres aborta la
 * transacción por el check de la tabla y esto lanza: no hace falta acordarse
 * de comprobar el saldo antes.
 */
export async function moverSaldo(
  accountId: string,
  delta: number,
  motivo: string,
  ref?: { tipo: string; id: string },
): Promise<number> {
  const [fila] = await sql<{ mover_saldo: string }[]>`
    select mover_saldo(
      ${accountId}::uuid, ${delta}::bigint, ${motivo},
      ${ref?.tipo ?? null}, ${ref?.id ?? null}
    )
  `;
  return Number(fila.mover_saldo);
}

// ------------------------------------------------------------------ Objetos

export type Item = {
  id: string;
  code: string;
  room_id: string | null;
  col: number | null;
  row: number | null;
  rot: number;
  stack: number;
};

export async function inventarioDe(accountId: string): Promise<Item[]> {
  return sql<Item[]>`
    select id, code, room_id, col, "row", rot, stack
      from items
     where owner_id = ${accountId} and room_id is null
     order by created_at
  `;
}

export async function mueblesDeSala(roomId: string): Promise<Item[]> {
  return sql<Item[]>`
    select id, code, room_id, col, "row", rot, stack
      from items
     where room_id = ${roomId}
     order by stack
  `;
}

/**
 * Compra: cobra y crea el objeto en la MISMA transacción. O pasan las dos
 * cosas o ninguna; no existe el caso de cobrar sin entregar.
 */
export async function comprar(accountId: string, code: string): Promise<Item> {
  return sql.begin(async (tx) => {
    // Sólo lo que está a la venta: las cajas de la mudanza se regalan, no se compran
    const [art] = await tx<{ price: number }[]>`
      select price from catalog_items where code = ${code} and for_sale
    `;
    if (!art) throw new Error(`el catálogo no vende "${code}"`);

    await tx`select mover_saldo(${accountId}::uuid, ${-art.price}::bigint, 'compra', 'item', ${code})`;

    const [item] = await tx<Item[]>`
      insert into items (code, owner_id) values (${code}, ${accountId})
      returning id, code, room_id, col, "row", rot, stack
    `;
    return item;
  });
}

// ------------------------------------------------------------------- Casas

/** La casa de una cuenta: el id de su fila en `rooms` y su nombre */
export type Casa = { id: string; nombre: string };

export async function casaDe(accountId: string): Promise<Casa | null> {
  const [fila] = await sql<Casa[]>`
    select id, name as nombre from rooms where owner_id = ${accountId} and kind = 'personal'
  `;
  return fila ?? null;
}

/** Lo que regala la portería al mudarse: un mueble y dónde va */
export type MuebleInicial = { code: string; col: number; row: number };

/**
 * La portería da las llaves: crea la casa (copiando la plantilla del piso) y
 * los muebles de regalo, colocados, en UNA transacción. Si ya tenía casa,
 * devuelve la que tenía: las llaves se dan una sola vez (y el índice
 * `rooms_una_casa_por_cuenta` lo garantiza aunque lleguen dos peticiones a la
 * vez).
 */
export async function darLlaves(
  accountId: string,
  nombre: string,
  plantilla: { width: number; height: number },
  iniciales: MuebleInicial[],
): Promise<{ casa: Casa; nueva: boolean }> {
  const ya = await casaDe(accountId);
  if (ya) return { casa: ya, nueva: false };
  try {
    const casa = await sql.begin(async (tx) => {
      const [c] = await tx<Casa[]>`
        insert into rooms (slug, name, kind, owner_id, theme, cols, rows, layout)
        values (${`casa-${accountId}`}, ${nombre}, 'personal', ${accountId}, 'piso',
                ${plantilla.width}, ${plantilla.height}, ${tx.json(plantilla as never)})
        returning id, name as nombre
      `;
      for (const m of iniciales) {
        await tx`
          insert into items (code, owner_id, room_id, col, "row")
          values (${m.code}, ${accountId}, ${c.id}, ${m.col}, ${m.row})
        `;
      }
      return c;
    });
    return { casa, nueva: true };
  } catch (e) {
    // Dos peticiones a la vez: la otra ganó. La casa es la suya.
    const otra = await casaDe(accountId);
    if (otra) return { casa: otra, nueva: false };
    throw e;
  }
}

/** Lo que hace falta para montar una casa: de quién es, su mapa y sus muebles */
export async function datosDeCasa(roomId: string): Promise<{ dueno: string; mapa: unknown; muebles: Item[] } | null> {
  const [sala] = await sql<{ owner_id: string; layout: unknown }[]>`
    select owner_id, layout from rooms where id = ${roomId} and kind = 'personal'
  `;
  if (!sala) return null;
  return { dueno: sala.owner_id, mapa: sala.layout, muebles: await mueblesDeSala(roomId) };
}

/** Coloca un objeto del inventario en una sala */
export async function colocar(
  itemId: string,
  accountId: string,
  roomId: string,
  col: number,
  row: number,
  stack = 0,
  rot = 0,
): Promise<void> {
  const filas = await sql`
    update items
       set room_id = ${roomId}, col = ${col}, "row" = ${row}, stack = ${stack}, rot = ${rot}
     where id = ${itemId} and owner_id = ${accountId}
  `;
  if (filas.count === 0) throw new Error("ese objeto no es tuyo o no existe");
}

/** Lo devuelve al inventario */
export async function recoger(itemId: string, accountId: string): Promise<void> {
  const filas = await sql`
    update items
       set room_id = null, col = null, "row" = null, stack = 0
     where id = ${itemId} and owner_id = ${accountId}
  `;
  if (filas.count === 0) throw new Error("ese objeto no es tuyo o no existe");
}
