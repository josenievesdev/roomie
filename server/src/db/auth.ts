import { createHash, randomBytes } from "node:crypto";
import { sql } from "./index.ts";
import { autenticar, saldoDe, type Account, type Avatar } from "./repo.ts";

// Sesiones e intentos de entrada.
//
// El token que viaja al navegador es aleatorio de 32 bytes. En la base sólo se
// guarda su SHA-256: si la base se filtrara, los tokens guardados no sirven
// para entrar. Mismo criterio que con las contraseñas.
//
// (Aquí basta SHA-256 y no un KDF lento como en las contraseñas: un token de
// 32 bytes aleatorios no se puede adivinar por fuerza bruta, mientras que una
// contraseña humana sí.)

export const DURACION_SESION_DIAS = 30;

/** Cuántos fallos seguidos se toleran antes de cerrar la puerta un rato */
const MAX_FALLOS = 8;
const VENTANA_MINUTOS = 15;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export type Sesion = { account: Account; avatar: Avatar; saldo: number; token: string };

/** Abre sesión y devuelve el token EN CLARO (la única vez que existe) */
export async function abrirSesion(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into sessions (account_id, token_hash, expires_at)
    values (${accountId}, ${hashToken(token)}, now() + ${`${DURACION_SESION_DIAS} days`}::interval)
  `;
  return token;
}

/** Reanuda con el token guardado en el navegador. null si no vale o caducó. */
export async function reanudar(token: string): Promise<Omit<Sesion, "token"> | null> {
  if (typeof token !== "string" || token.length < 20) return null;

  const [fila] = await sql<{ id: string; account_id: string }[]>`
    select id, account_id from sessions
     where token_hash = ${hashToken(token)} and expires_at > now()
  `;
  if (!fila) return null;

  await sql`update sessions set last_seen_at = now() where id = ${fila.id}`;

  const [cuenta] = await sql<{ id: string; username: string }[]>`
    select id, username from accounts where id = ${fila.account_id}
  `;
  if (!cuenta) return null;

  const [avatar] = await sql<Avatar[]>`
    select id, nickname, look from avatars where account_id = ${cuenta.id}
     order by created_at limit 1
  `;
  return { account: cuenta, avatar, saldo: await saldoDe(cuenta.id) };
}

export async function cerrarSesion(token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}

// ------------------------------------------------------- Freno a la fuerza bruta

/**
 * ¿Hay demasiados fallos recientes contra este usuario?
 *
 * Se cuenta por nombre TECLEADO y no por cuenta, para que también frene los
 * intentos contra usuarios que no existen — que es precisamente lo que hace un
 * ataque de diccionario.
 */
export async function demasiadosFallos(username: string): Promise<boolean> {
  const [fila] = await sql<{ n: number }[]>`
    select count(*)::int as n from login_attempts
     where lower(username) = lower(${username})
       and ok = false
       and created_at > now() - ${`${VENTANA_MINUTOS} minutes`}::interval
  `;
  return fila.n >= MAX_FALLOS;
}

export async function anotarIntento(username: string, ok: boolean): Promise<void> {
  await sql`insert into login_attempts (username, ok) values (${username}, ${ok})`;
}

/**
 * Entrar con usuario y contraseña. Devuelve la sesión abierta, o el motivo.
 *
 * El freno se comprueba ANTES de verificar la contraseña, y el intento queda
 * anotado pase lo que pase.
 */
export async function entrar(
  username: string,
  clave: string,
): Promise<Sesion | { error: "BAD_CREDENTIALS" | "RATE_LIMITED" }> {
  if (await demasiadosFallos(username)) return { error: "RATE_LIMITED" };

  const datos = await autenticar(username, clave);
  await anotarIntento(username, datos !== null);
  if (!datos) return { error: "BAD_CREDENTIALS" };

  return { ...datos, token: await abrirSesion(datos.account.id) };
}

/** Tira sesiones e intentos caducados. Se llama de tarde en tarde. */
export async function purgar(): Promise<{ sesiones: number; intentos: number }> {
  const [fila] = await sql<{ sesiones: number; intentos: number }[]>`select * from purgar_caducado()`;
  return fila;
}
