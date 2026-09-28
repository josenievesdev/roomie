// Normas de convivencia por edad. Módulo PURO compartido: el servidor DECIDE
// con él; el cliente sólo lo usa para enseñar la interfaz que toca.
//
// Roomie es para niños y niñas también, y eso es lo más serio del proyecto.
// La idea que lo sostiene: todo el mundo comparte los espacios públicos (así
// hay vida y gente), pero lo que puede llegarle a cada uno depende de su
// edad. Un niño habla con frases del menú y NUNCA lee texto libre de nadie.
// Así, aunque un adulto mienta con su edad para pasar por niño, sólo puede
// usar esas frases: no puede pedir datos, ni un teléfono, ni sacarlo del
// juego. La edad de cada uno es privada: nadie ve la de los demás.
//
// Cada sistema nuevo que ponga en contacto a dos jugadores (mensajes
// privados, amistades, regalos, comercio, visitas, ubicación) añade AQUÍ su
// regla, y el servidor la consulta. Nunca una regla de edad suelta por ahí.

export type Franja = "nino" | "joven" | "adulto";

/** Edad mínima para crear una cuenta */
export const EDAD_MINIMA = 8;
/**
 * Por debajo de esta edad, la cuenta necesita el permiso de un padre, madre o
 * tutor (así lo piden, por ejemplo, la ley COPPA de EE. UU. y el RGPD). Hasta
 * que exista ese permiso por correo, la cuenta queda "pendiente".
 */
export const EDAD_CONSENTIMIENTO = 13;
/** Desde aquí, adulto */
export const EDAD_ADULTO = 18;
/** Más de esto no es una fecha de verdad */
const EDAD_MAXIMA = 120;

/** "AAAA-MM-DD" si es una fecha real y pasada; si no, null */
export function parsearNacimiento(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  // Date "arregla" el 30 de febrero pasándolo al 2 de marzo: si no coincide
  // lo que sale con lo que entró, la fecha no existe
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Años cumplidos en `hoy` */
export function edadEn(nacimiento: string, hoy: Date = new Date()): number {
  const [a, m, d] = nacimiento.split("-").map(Number);
  let edad = hoy.getUTCFullYear() - a;
  const mes = hoy.getUTCMonth() + 1;
  if (mes < m || (mes === m && hoy.getUTCDate() < d)) edad--;
  return edad;
}

/** ¿Es una edad con la que se puede tener cuenta? */
export function edadValida(edad: number): boolean {
  return edad >= EDAD_MINIMA && edad <= EDAD_MAXIMA;
}

export function franjaDe(edad: number): Franja {
  if (edad < EDAD_CONSENTIMIENTO) return "nino";
  if (edad < EDAD_ADULTO) return "joven";
  return "adulto";
}

/** ¿Necesita esta edad el permiso de un tutor? */
export function necesitaConsentimiento(edad: number): boolean {
  return edad < EDAD_CONSENTIMIENTO;
}

// ---------------------------------------------------------------- El chat

/**
 * Cómo habla cada uno:
 * - "frases": sólo frases y gestos del menú (`src/state/frases.ts`).
 * - "libre": texto propio, pasado por el filtro (`src/state/filtroChat.ts`).
 */
export type ModoChat = "frases" | "libre";

export function modoChat(f: Franja): ModoChat {
  return f === "nino" ? "frases" : "libre";
}

/**
 * ¿Puede recibir texto libre de otros? Los niños no: ven las frases y los
 * gestos de todo el mundo, y del resto nada. Es la regla que más protege.
 */
export function leeTextoLibre(f: Franja): boolean {
  return f !== "nino";
}

// ---------------------------------------------------------------- Las casas

/**
 * ¿Puede alguien entrar en una casa? De momento, sólo su dueño: todavía no
 * hay amigos. Cuando los haya, entrarán también ellos (y la casa de un niño
 * seguirá siendo sólo para sus amigos, nunca para cualquiera).
 */
export function puedeEntrarEnCasa(esDueno: boolean): boolean {
  return esDueno;
}

// ---------------------------------------------------------------- Los perfiles

/**
 * ¿Puede alguien ver el perfil de otro? Sólo de quien tiene delante (en su
 * misma sala): el perfil no sirve para buscar a nadie. Y nunca el de quien le
 * ha bloqueado: si alguien no quiere saber nada de ti, tampoco le curioseas.
 * Lo que se ve está en `PerfilPublico` (src/net/protocol.ts): nunca la edad
 * ni dónde vive.
 */
export function puedeVerPerfil(mismaSala: boolean, meTieneBloqueado: boolean): boolean {
  return mismaSala && !meTieneBloqueado;
}
