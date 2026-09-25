import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sql } from "./index.ts";

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

export type Account = { id: string; username: string };
export type Avatar = { id: string; nickname: string; look: Record<string, number> };

/** Saldo con el que empieza una cuenta nueva */
export const SALDO_INICIAL = 500;

export async function crearCuenta(
  username: string,
  clave: string,
  nickname: string,
  look: Record<string, number>,
): Promise<{ account: Account; avatar: Avatar; saldo: number }> {
  return sql.begin(async (tx) => {
    const [cuenta] = await tx<{ id: string; username: string }[]>`
      insert into accounts (username, password_hash)
      values (${username}, ${hashPassword(clave)})
      returning id, username
    `;
    const [avatar] = await tx<{ id: string; nickname: string; look: Record<string, number> }[]>`
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
  const [fila] = await sql<
    { id: string; username: string; password_hash: string }[]
  >`select id, username, password_hash from accounts where lower(username) = lower(${username})`;

  // Se verifica igual aunque la cuenta no exista, con un hash de pega: así el
  // tiempo de respuesta no delata qué usuarios están registrados.
  const guardado = fila?.password_hash ?? hashPassword("cuenta-inexistente");
  const vale = verifyPassword(clave, guardado);
  if (!fila || !vale) return null;

  await sql`update accounts set last_login_at = now() where id = ${fila.id}`;
  const [avatar] = await sql<{ id: string; nickname: string; look: Record<string, number> }[]>`
    select id, nickname, look from avatars where account_id = ${fila.id} order by created_at limit 1
  `;
  return {
    account: { id: fila.id, username: fila.username },
    avatar,
    saldo: await saldoDe(fila.id),
  };
}

export async function nombreLibre(username: string): Promise<boolean> {
  const [fila] = await sql`select 1 from accounts where lower(username) = lower(${username})`;
  return fila === undefined;
}

export async function nicknameLibre(nickname: string): Promise<boolean> {
  const [fila] = await sql`select 1 from avatars where lower(nickname) = lower(${nickname})`;
  return fila === undefined;
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
    const [art] = await tx<{ price: number }[]>`
      select price from catalog_items where code = ${code}
    `;
    if (!art) throw new Error(`el catálogo no tiene "${code}"`);

    await tx`select mover_saldo(${accountId}::uuid, ${-art.price}::bigint, 'compra', 'item', ${code})`;

    const [item] = await tx<Item[]>`
      insert into items (code, owner_id) values (${code}, ${accountId})
      returning id, code, room_id, col, "row", rot, stack
    `;
    return item;
  });
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
