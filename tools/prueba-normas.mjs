// Prueba de las normas de edad y del filtro del chat, sin servidor ni base.
//
//   node tools/prueba-normas.mjs
//
// Los casos "bloquear" son los trucos de verdad para sacar a alguien del
// juego (teléfonos con espacios, apps escritas letra a letra, números que
// imitan letras); los casos "pasar" son frases inocentes que un filtro torpe
// se comería ("computadora" lleva dentro "puta", "pera" parece "perra").
import { filtrarChat } from "../src/state/filtroChat.ts";
import { edadEn, edadValida, franjaDe, modoChat, leeTextoLibre, parsearNacimiento, EDAD_MINIMA } from "../src/state/normas.ts";
import { frasePorId, CATEGORIAS, GESTOS } from "../src/state/frases.ts";
import { motivoNoCabe, pisoDe } from "../src/state/decorar.ts";

let fallos = 0;
const check = (ok, label) => {
  console.log(`${ok ? "  ok " : "FAIL "} ${label}`);
  if (!ok) fallos++;
};

// ---------------------------------------------------------------- Filtro
const nombres = ["Luna", "Beto Ruiz"];
const pasa = [
  "hola, ¿vamos a la plaza?",
  "mi computadora es vieja",
  "me gusta la pera",
  "un cono de helado",
  "tengo 3 perros y 2 gatos",
  "estoy en X 132 Y 48",
  "@Luna ¿vienes?",
  "@Beto Ruiz te espero en la Llave",
  "¡sígueme a la otra sala!",
  "voy en sexto grado",
  "nos vemos en la fuente",
  "holaaaa",
];
for (const t of pasa) {
  const r = filtrarChat(t, { nombres });
  check(r.tipo === "ok" && r.texto === t, `pasa tal cual: "${t}"${r.tipo !== "ok" ? ` (salió ${r.tipo})` : ""}`);
}

const bloquear = [
  ["mi numero es 312 345 6789", "datos"],
  ["3123456789", "datos"],
  ["+57 (312) 345-67-89", "datos"],
  ["escríbeme al whatsapp", "datos"],
  ["w h a t s a p p", "datos"],
  ["wh4ts4pp", "datos"],
  ["what's app?", "datos"],
  ["tienes insta?", "datos"],
  ["agrégame en tik tok", "datos"],
  ["mi correo es luna@gmail.com", "datos"],
  ["luna arroba gmail punto com", "datos"],
  ["entra a www.algo.net", "datos"],
  ["mira algo.com", "datos"],
  ["sígueme @luna_22", "datos"],
  ["¿dónde vives?", "datos"],
  ["¿en qué colegio estás?", "datos"],
  ["mándame una foto", "datos"],
  ["hablemos por privado", "datos"],
  ["pasa el pack", "sexual"],
  ["eres muy sexy", "sexual"],
  ["d3snud0", "sexual"],
];
for (const [t, motivo] of bloquear) {
  const r = filtrarChat(t, { nombres });
  check(r.tipo === "bloqueado" && r.motivo === motivo, `se bloquea (${motivo}): "${t}"${r.tipo !== "bloqueado" ? ` (salió ${r.tipo})` : r.motivo !== motivo ? ` (por ${r.motivo})` : ""}`);
}

const tapar = [
  ["eres un idiota", "eres un ★★★★★★"],
  ["qué mierda", "qué ★★★★★★"],
  ["p u t a", "★★★ ★★★ ★★★ ★★★"],
  ["puuuuta", "★★★★★★★"],
  ["hijueputa!", "★★★★★★★★"],
];
for (const [t, esperado] of tapar) {
  const r = filtrarChat(t, { nombres });
  check(r.tipo === "tapado" && r.texto === esperado, `se tapa: "${t}" → "${r.texto ?? r.tipo}"`);
}

// ---------------------------------------------------------------- Edades
const hoy = new Date(Date.UTC(2026, 8, 27)); // 27 sep 2026
check(edadEn("2016-09-27", hoy) === 10, "cumple 10 justo hoy");
check(edadEn("2016-09-28", hoy) === 9, "un día antes de cumplir, aún 9");
check(edadEn("2000-02-29", hoy) === 26, "nacido un 29 de febrero");
check(parsearNacimiento("2016-02-30") === null, "el 30 de febrero no existe");
check(parsearNacimiento("16-09-2016") === null, "sólo AAAA-MM-DD");
check(parsearNacimiento("2016-09-27") === "2016-09-27", "una fecha válida pasa");
check(!edadValida(EDAD_MINIMA - 1) && edadValida(EDAD_MINIMA), `edad mínima: ${EDAD_MINIMA}`);
check(!edadValida(150), "150 años no es una edad");
check(franjaDe(12) === "nino" && franjaDe(13) === "joven" && franjaDe(17) === "joven" && franjaDe(18) === "adulto", "franjas: 12 niño, 13-17 joven, 18 adulto");
check(modoChat("nino") === "frases" && modoChat("joven") === "libre", "los niños hablan con frases");
check(!leeTextoLibre("nino") && leeTextoLibre("adulto"), "los niños no leen texto libre");

// ---------------------------------------------------------------- Frases
const ids = [...CATEGORIAS.flatMap((c) => c.frases), ...GESTOS].map((f) => f.id);
check(new Set(ids).size === ids.length, `${ids.length} frases, sin ids repetidos`);
check(frasePorId("hola")?.texto === "¡Hola!" && frasePorId("inventada") === undefined, "sólo existen las del catálogo");
const todasLimpias = [...CATEGORIAS.flatMap((c) => c.frases), ...GESTOS].every((f) => filtrarChat(f.texto).tipo === "ok");
check(todasLimpias, "ninguna frase del catálogo la tacharía el filtro");

// ---------------------------------------------------------------- Decorar
// El piso de 8×8 con la puerta en (5,0): dónde cabe cada cosa
{
  const plano = { cols: 8, rows: 8, puertas: [{ col: 5, row: 0 }] };
  const puestos = [
    { id: "a", code: "cama", col: 1, row: 0 }, // ocupa (1,0) y (1,1)
    { id: "b", code: "cuadro", col: 3, row: 0 },
    { id: "c", code: "alfombra", col: 3, row: 3 },
  ];
  const cabe = (code, col, row, o) => motivoNoCabe(plano, puestos, code, col, row, o);
  check(cabe("sofa", 4, 4) === null, "un sofá cabe en medio del piso");
  check(cabe("sofa", 1, 1) !== null, "no cabe en los pies de la cama (la cama ocupa dos celdas)");
  check(cabe("cama", 2, 1) === null && cabe("cama", 2, 6) !== null, "la cama no se sale por delante (su huella entera cuenta)");
  check(cabe("mesa", 5, 1) !== null && cabe("mesa", 5, 0) !== null, "la puerta y su entrada quedan libres");
  check(cabe("sofa", 3, 3) === null, "un mueble puede ir encima de una alfombra");
  check(cabe("alfombra", 3, 3) !== null, "pero dos alfombras no se pisan");
  check(cabe("cuadro", 4, 0) === null && cabe("cuadro", 4, 4) !== null, "un cuadro va colgado en una pared, no en el suelo");
  check(cabe("cuadro", 3, 0) !== null && cabe("cuadro", 5, 0) !== null, "ni encima de otro cuadro ni en la puerta");
  check(cabe("sofa", 0, 0) !== null && cabe("sofa", 7, 3) !== null, "ni en la esquina ni en el borde de delante");
  check(cabe("sofa", 4, 4, { pisadas: [{ col: 4, row: 4 }] }) !== null, "ni encima de quien está de pie");
  check(cabe("cama", 1, 0, { excepto: "a" }) === null, "un mueble se puede dejar donde estaba al moverlo");
  check(cabe("llave", 4, 4) !== null && cabe("inventado", 4, 4) !== null, "lo de la ciudad y lo inventado no se ponen");
  check(pisoDe("alfombra") === 0 && pisoDe("sofa") === 1, "las alfombras van debajo, lo demás encima");
}

console.log(fallos === 0 ? "\nNORMAS OK" : `\n${fallos} comprobaciones fallidas`);
process.exit(fallos === 0 ? 0 : 1);
