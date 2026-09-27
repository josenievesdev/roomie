// Reglas para decorar una casa. Módulo PURO compartido: el cliente las usa
// para enseñar en verde o en rojo dónde cabe un mueble mientras lo colocas;
// el servidor, para decidir. Si cada lado tuviera las suyas, un mueble que
// el cliente enseña en verde podría rechazarse (o al revés).

import { FURNITURE, celdasDe, isFurniture } from "./furniture-catalog.ts";

export type Celda = { col: number; row: number };

/** Lo que hay que saber de una sala para decorarla */
export type Plano = { cols: number; rows: number; puertas: Celda[] };

/** Un mueble ya puesto en la sala */
export type Puesto = { id: string; code: string; col: number; row: number };

type ObjetoMapa = { type?: string; class?: string; properties?: { name: string; value: unknown }[] };
type MapaMinimo = { width: number; height: number; layers: { name: string; objects?: ObjetoMapa[] }[] };

/** El plano de una sala a partir de su mapa de Tiled: tamaño y puertas */
export function planoDesdeMapa(mapa: MapaMinimo): Plano {
  const objetos = mapa.layers.find((l) => l.name === "objetos")?.objects ?? [];
  const num = (o: ObjetoMapa, n: string) => {
    const v = o.properties?.find((p) => p.name === n)?.value;
    return typeof v === "number" ? v : undefined;
  };
  const puertas: Celda[] = [];
  for (const o of objetos) {
    if ((o.type || o.class) !== "puerta") continue;
    const col = num(o, "col");
    const row = num(o, "row");
    if (col !== undefined && row !== undefined) puertas.push({ col, row });
  }
  return { cols: mapa.width, rows: mapa.height, puertas };
}

/**
 * Por qué no se puede poner `code` en (col, row), o null si se puede.
 * `excepto` es el propio mueble cuando se está moviendo; `pisadas`, las
 * celdas donde hay alguien de pie (no se le pone un armario encima).
 */
export function motivoNoCabe(
  plano: Plano,
  puestos: Puesto[],
  code: string,
  col: number,
  row: number,
  o: { excepto?: string; pisadas?: Celda[] } = {},
): string | null {
  if (!isFurniture(code) || FURNITURE[code].mundo) return "Eso no se puede poner aquí.";
  if (!Number.isInteger(col) || !Number.isInteger(row)) return "Ahí no cabe.";
  const def = FURNITURE[code];
  const es = (a: Celda, b: Celda) => a.col === b.col && a.row === b.row;
  const esPuerta = (c: Celda) => plano.puertas.some((p) => es(p, c));
  // La celda de delante de cada puerta se deja libre: si no, no se podría entrar
  const esEntrada = (c: Celda) =>
    plano.puertas.some((p) => (p.row === 0 && es(c, { col: p.col, row: 1 })) || (p.col === 0 && es(c, { col: 1, row: p.row })));
  const otros = puestos.filter((p) => p.id !== o.excepto && isFurniture(p.code));

  // Lo de pared: colgado de la pared de la fila 0 o de la columna 0
  if (def.pared) {
    const enPared = (row === 0 && col >= 1 && col <= plano.cols - 2) || (col === 0 && row >= 1 && row <= plano.rows - 2);
    if (!enPared) return "Eso va colgado en una pared.";
    if (esPuerta({ col, row })) return "Ahí está la puerta.";
    if (otros.some((p) => FURNITURE[p.code].pared && p.col === col && p.row === row)) return "Ahí ya hay algo colgado.";
    return null;
  }

  // Lo de suelo: dentro de la casa (las filas del fondo valen: es arrimarlo a
  // la pared; las de delante son el borde y no se ven), sin tapar puertas
  const celdas = celdasDe(code, col, row);
  for (const c of celdas) {
    if (c.col < 0 || c.row < 0 || c.col > plano.cols - 2 || c.row > plano.rows - 2) return "Ahí no cabe.";
    if (c.col === 0 && c.row === 0) return "Ahí no cabe.";
    if (esPuerta(c) || esEntrada(c)) return "Deja libre la puerta.";
    if (o.pisadas?.some((p) => es(p, c))) return "Apártate un poco para ponerlo ahí.";
  }
  // Una alfombra sólo choca con otra alfombra; un mueble, con otro mueble (y
  // puede ir encima de una alfombra)
  const plano_ = def.plano === true;
  for (const p of otros) {
    const d = FURNITURE[p.code];
    if (d.pared || (d.plano === true) !== plano_) continue;
    if (celdasDe(p.code, p.col, p.row).some((s) => celdas.some((c) => es(c, s)))) return "Ahí ya hay otro mueble.";
  }
  return null;
}

/** El piso en el que va un mueble: las alfombras en el suelo, lo demás encima */
export const pisoDe = (code: string): number => (isFurniture(code) && FURNITURE[code].plano ? 0 : 1);
