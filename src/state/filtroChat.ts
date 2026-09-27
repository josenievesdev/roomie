// Filtro del chat libre. Módulo PURO compartido: lo aplica el servidor a todo
// el texto que escribe la gente (mensajes y nombres); el cliente puede usarlo
// para avisar antes de enviar, pero quien decide es el servidor.
//
// Tres salidas:
// - "bloqueado" por DATOS: teléfonos, correos, enlaces, redes y apps de
//   mensajería, preguntar dónde vive alguien o pedir fotos. Es lo que usa
//   quien quiere sacar a un niño del juego, así que el mensaje no se entrega
//   a nadie (y a quien lo escribió se le explica por qué).
// - "bloqueado" por contenido SEXUAL: tampoco se entrega.
// - "tapado": las groserías se cambian por ★★★ y el resto se entrega.
//
// Se compara con el texto NORMALIZADO: minúsculas, sin tildes y con los
// números que imitan letras cambiados por letras ("wh4ts4pp"). También se
// juntan las letras sueltas ("w h a t s") y, si alguien estira una palabra
// para esquivar ("puuuta"), se compara sin las letras repetidas. Sólo en ese
// caso: si no, "pera" sería "perra". La ñ se conserva: "coño" no es "cono".
//
// No es perfecto (ningún filtro lo es): por eso además están las frases para
// los niños, el botón de reportar y los moderadores.

export type MotivoBloqueo = "datos" | "sexual";

export type ResultadoFiltro =
  | { tipo: "ok"; texto: string }
  | { tipo: "tapado"; texto: string }
  | { tipo: "bloqueado"; motivo: MotivoBloqueo };

export type OpcionesFiltro = {
  /** Nombres de quienes están en la sala: "@Luna hola" es una mención, no una red social */
  nombres?: string[];
};

// ---------------------------------------------------------------- Listas
//
// Una entrada que acaba en * vale también como principio de palabra
// ("pendej*" cubre pendejo, pendeja, pendejadas).

const GROSERIAS = [
  "puta", "putas", "puto", "putos", "putita", "putazo", "hijueputa", "hijoputa", "hijodeputa",
  "hdp", "ptm", "ctm", "mierda*", "joder", "jodete", "jodido", "jodida", "coño", "gilipollas",
  "pendej*", "cabron*", "verga*", "chinga*", "culero*", "culera*", "culo", "culos", "marica",
  "maricas", "maricon*", "malparid*", "gonorrea*", "perra", "perras", "zorra", "zorras",
  "imbecil*", "estupid*", "idiota*", "mamaguevo*", "mamahuevo*", "pajero*", "pajera*",
  "retrasad*", "mongolo*", "sudaca*", "travelo*", "trolo*",
  "fuck*", "shit*", "bitch*", "dick", "asshole*", "cunt", "whore*", "wtf", "stfu", "nigg*",
];

const SEXUAL = [
  "sexo", "sexy", "sexi", "sexual", "sexuales", "porno", "porn", "xxx", "nude", "nudes",
  "desnud*", "teta", "tetas", "pene", "vagina", "pack", "packs", "follar", "culear", "mamada",
  "cachond*", "calenton*", "pedofil*", "onlyfans",
];

/** Palabras enteras que sólo sirven para dar un contacto fuera del juego */
const CONTACTO = [
  "whatsapp", "wasap", "guasap", "wsp", "wpp", "whats", "telegram", "discord", "instagram",
  "insta", "ig", "snapchat", "snap", "tiktok", "facebook", "fb", "messenger", "skype", "twitter",
  "twitch", "kik", "gmail", "hotmail", "outlook", "yahoo", "icloud", "arroba", "celular", "cel",
  "celu", "telefono", "tlf",
];

/**
 * Las mismas, buscadas DENTRO del texto con todo junto: así se pillan
 * "what's app", "tik tok" o "i n s t a g r a m". Sólo las largas: una corta
 * aparecería por casualidad dentro de palabras inocentes.
 */
const CONTACTO_JUNTO = ["whatsapp", "telegram", "discord", "instagram", "snapchat", "tiktok", "facebook", "hotmail", "onlyfans"];

/** Frases que piden datos personales o sacar la conversación del juego */
const FRASES_CONTACTO = [
  "mi numero", "tu numero", "su numero", "pasame tu", "dame tu", "pasa tu", "mandame tu",
  "donde vives", "en que ciudad vives", "en que pais vives", "tu direccion", "mi direccion",
  "tu colegio", "mi colegio", "tu escuela", "mi escuela", "que colegio", "sigueme en",
  "manda foto", "mandame foto", "mandame una foto", "pasame foto", "pasa foto", "envia foto",
  "enviame foto", "fotos tuyas", "foto tuya", "tu foto", "en persona", "por privado",
  "al privado", "por dm", "al dm", "punto com",
];

/** Dominios: "algo.com" es un enlace aunque no lleve www */
const DOMINIOS =
  /\b[\p{L}\p{N}-]+\s*\.\s*(com|net|org|co|es|mx|io|gg|me|ly|tv|app|link|xyz|site|info|us|ar|cl|pe|ve|ec|uy|bo|py|gt|hn|sv|ni|cr|pa|do|cu|pr)\b/iu;

// ---------------------------------------------------------------- Normalizar

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "€": "e" };

/** Minúsculas, sin tildes (salvo la ñ) y con los números-letra cambiados */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .replace(/ñ/g, "\u0001")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "ñ")
    .replace(/[0134578@$€]/g, (c) => LEET[c] ?? c);
}

/** Tres o más letras iguales seguidas, una sola: "holaaaa" → "hola" */
const colapsar3 = (s: string): string => s.replace(/(.)\1{2,}/g, "$1");
/** Todas las repetidas, una sola: "whatsapp" → "whatsap" */
const colapsarTodo = (s: string): string => s.replace(/(.)\1+/g, "$1");
const estirada = (s: string): boolean => /(.)\1{2,}/.test(s);

/** Sólo las letras de un trozo, normalizadas */
const letras = (s: string): string => normalizar(s).replace(/[^a-zñ]/g, "");

/** Una palabra del mensaje, y si venía estirada para esquivar el filtro */
type Palabra = { palabra: string; estirada: boolean };
const palabra = (crudo: string): Palabra => ({ palabra: colapsar3(crudo), estirada: estirada(crudo) });

type Lista = { exactas: Set<string>; prefijos: string[]; exactasTodo: Set<string>; prefijosTodo: string[] };

function preparar(entradas: string[]): Lista {
  const l: Lista = { exactas: new Set(), prefijos: [], exactasTodo: new Set(), prefijosTodo: [] };
  for (const e of entradas) {
    const prefijo = e.endsWith("*");
    const w = letras(prefijo ? e.slice(0, -1) : e);
    if (prefijo) {
      l.prefijos.push(w);
      l.prefijosTodo.push(colapsarTodo(w));
    } else {
      l.exactas.add(w);
      l.exactasTodo.add(colapsarTodo(w));
    }
  }
  return l;
}

const L_GROSERIAS = preparar(GROSERIAS);
const L_SEXUAL = preparar(SEXUAL);
const L_CONTACTO = preparar(CONTACTO);
const L_JUNTO = CONTACTO_JUNTO.map(letras);
const L_FRASES = FRASES_CONTACTO.map((f) => f.split(" ").map(letras).join(" "));

function esta(p: Palabra, l: Lista): boolean {
  const w = p.palabra;
  if (!w) return false;
  if (l.exactas.has(w) || l.prefijos.some((x) => w.startsWith(x))) return true;
  if (!p.estirada) return false;
  const t = colapsarTodo(w);
  return l.exactasTodo.has(t) || l.prefijosTodo.some((x) => t.startsWith(x));
}

// ---------------------------------------------------------------- Filtro

/** Trozos del texto separados por espacios, con los espacios guardados aparte */
function trocear(texto: string): { trozos: string[]; seps: string[] } {
  const partes = texto.split(/(\s+)/);
  const trozos: string[] = [];
  const seps: string[] = [];
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 0) trozos.push(partes[i]);
    else seps.push(partes[i]);
  }
  return { trozos, seps };
}

/**
 * Palabras del texto y, para cada una, los trozos originales de los que sale.
 * Las letras sueltas seguidas ("p u t a") se juntan en una palabra.
 */
function palabras(trozos: string[]): (Palabra & { de: number[] })[] {
  const crudos = trozos.map(letras);
  const out: (Palabra & { de: number[] })[] = [];
  let i = 0;
  while (i < crudos.length) {
    if (crudos[i].length === 1) {
      let j = i;
      while (j < crudos.length && crudos[j].length === 1) j++;
      if (j - i >= 3) {
        out.push({ ...palabra(crudos.slice(i, j).join("")), de: range(i, j) });
        i = j;
        continue;
      }
    }
    if (crudos[i]) out.push({ ...palabra(crudos[i]), de: [i] });
    i++;
  }
  return out;
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, k) => a + k);

/** ¿Pide o da un contacto de fuera del juego? (se mira sobre el texto original) */
function daContacto(texto: string, ps: Palabra[], nombres: string[]): boolean {
  // Un teléfono: siete cifras o más en el mensaje, con o sin separadores
  if ((texto.match(/\d/g) ?? []).length >= 7) return true;
  if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(texto)) return true;
  if (/(https?:\/\/|www\.)/i.test(texto) || DOMINIOS.test(texto)) return true;
  // "@algo" es una red social, salvo que sea el nombre ENTERO de alguien de la
  // sala ("@luna_22" no es "@Luna" aunque empiece igual)
  const bajos = nombres.map((n) => n.toLowerCase());
  for (let i = texto.indexOf("@"); i >= 0; i = texto.indexOf("@", i + 1)) {
    const resto = texto.slice(i + 1).toLowerCase();
    const esNombre = (n: string) => n.length > 0 && resto.startsWith(n) && !/^[\p{L}\p{N}_.-]/u.test(resto.slice(n.length));
    if (!bajos.some(esNombre)) return true;
  }
  if (ps.some((p) => esta(p, L_CONTACTO))) return true;
  const junto = colapsar3(ps.map((p) => p.palabra).join(""));
  if (L_JUNTO.some((t) => junto.includes(t))) return true;
  const frase = ` ${ps.map((p) => p.palabra).join(" ")} `;
  return L_FRASES.some((f) => frase.includes(` ${f} `));
}

/** Pasa un texto por el filtro */
export function filtrarChat(texto: string, o: OpcionesFiltro = {}): ResultadoFiltro {
  const { trozos, seps } = trocear(texto);
  const ps = palabras(trozos);

  if (ps.some((p) => esta(p, L_SEXUAL))) return { tipo: "bloqueado", motivo: "sexual" };
  if (daContacto(texto, ps, o.nombres ?? [])) return { tipo: "bloqueado", motivo: "datos" };

  // Groserías: se tapan en su sitio, con tantas estrellas como letras
  const tapar = new Set<number>();
  for (const p of ps) if (esta(p, L_GROSERIAS)) for (const k of p.de) tapar.add(k);
  if (tapar.size === 0) return { tipo: "ok", texto };

  const tapados = trozos.map((t, k) => (tapar.has(k) ? "★".repeat(Math.min(Math.max(t.length, 3), 8)) : t));
  let salida = "";
  tapados.forEach((t, k) => {
    salida += t + (seps[k] ?? "");
  });
  return { tipo: "tapado", texto: salida };
}
