// Catálogo de mobiliario. Módulo PURO (sin Phaser): lo importan el cliente
// para dibujar y el SERVIDOR para las colisiones.
//
// Que sea uno solo es lo que impide el peor bug posible de este juego: que el
// cliente crea que una celda está libre y el servidor no. Antes cada lado
// tenía su propia lista de `if (kind === "sofa")`, y añadir un mueble obligaba
// a tocar los dos y acordarse de los dos.
//
// Para añadir mobiliario nuevo: una entrada aquí + su modelo 3D en
// `tools/muebles/modelos.mjs` + `node tools/genmuebles.mjs`. Nada más.

import type { Facing, SitTarget } from "./avatarState.ts";

export type FurnitureDef = {
  /** ¿Ocupa la celda? (el A* no podrá atravesarla) */
  blocks: boolean;
  /**
   * Si es un asiento: a qué altura (px de pantalla) está la superficie donde
   * se apoya el trasero, y hacia dónde mira quien se sienta. Lo usan el
   * servidor (hacia dónde mira) y el cliente (a qué altura dibujarlo).
   */
  sit?: {
    alto: number;
    dir: Facing;
    /** Hacia dónde se mira si el mueble está girado (variante "se") */
    dirGirado?: Facing;
  };
  /**
   * Plano, sin altura (alfombras): se dibuja pegado al suelo, por debajo de
   * cualquier mueble o avatar, y cada celda elige su variante según qué
   * vecinas son también alfombra (la cenefa sólo va por fuera).
   */
  plano?: true;
  /**
   * Cuelga de la pared: va en la fila 0 (pared derecha) o en la columna 0
   * (pared izquierda), el anillo de celdas junto al muro. No ocupa sitio.
   */
  pared?: true;
  /**
   * Se pega a la pared de la columna 0 girado (mirando a +col) si está en
   * esa columna; si no, mira a +row como todos.
   */
  orientable?: true;
  /**
   * Del mundo: lo pone la ciudad (farolas, árboles, el monumento) y no se
   * vende. `db:check` no exige que esté en la tienda.
   */
  mundo?: true;
  /**
   * Cuántas celdas ocupa, desde la suya hacia +col y +row (por defecto 1×1).
   * La cama mide 1×2: su celda y la de delante (+row).
   */
  huella?: { col: number; row: number };
  /** Sólo para leer el código: qué es */
  nombre: string;
};

export const FURNITURE: Record<string, FurnitureDef> = {
  // --- Asientos ---
  // El sofá tiene el respaldo en el borde noreste: se mira al suroeste (5)
  sofa: { nombre: "Sofá", blocks: true, sit: { alto: 14, dir: 5 } },
  // Los taburetes están delante de la barra, que queda al este de la
  // rejilla (+col): se mira al sureste (3), de cara al mostrador
  taburete: { nombre: "Taburete", blocks: true, sit: { alto: 30, dir: 3 } },

  // --- Superficies ---
  mesa: { nombre: "Mesa auxiliar", blocks: true },
  barra: { nombre: "Barra / mostrador", blocks: true },

  // --- Decoración que estorba ---
  planta: { nombre: "Planta", blocks: true },
  lampara: { nombre: "Lámpara de pie", blocks: true },
  altavoz: { nombre: "Altavoz", blocks: true },
  estanteria: { nombre: "Estantería", blocks: true, orientable: true },

  // --- Decoración que NO estorba (se pisa) ---
  alfombra: { nombre: "Alfombra / pista", blocks: false, plano: true },

  // --- De pared ---
  ventana: { nombre: "Ventana", blocks: false, pared: true },
  cuadro: { nombre: "Cuadro", blocks: false, pared: true },
  reloj: { nombre: "Reloj", blocks: false, pared: true },
  aplique: { nombre: "Aplique", blocks: false, pared: true },
  estante: { nombre: "Balda con libros", blocks: false, pared: true },
  neon: { nombre: "Neón", blocks: false, pared: true },
  poster: { nombre: "Póster", blocks: false, pared: true },

  // --- El piso recién mudado ---
  // La cama ocupa dos celdas: la del cabecero y la de los pies (+row)
  cama: { nombre: "Cama", blocks: true, huella: { col: 1, row: 2 } },
  // Pegado a la pared de la columna 0 se gira para mirar a +col, como la estantería
  armario: { nombre: "Armario", blocks: true, orientable: true },
  cajas: { nombre: "Cajas de mudanza", blocks: true },

  // --- La ciudad (del mundo, no se venden) ---
  llave: { nombre: "La Llave (monumento)", blocks: true, mundo: true },
  farola: { nombre: "Farola", blocks: true, mundo: true },
  arbol: { nombre: "Árbol", blocks: true, mundo: true },
  jardinera: { nombre: "Jardinera", blocks: true, mundo: true },
  // El banco se mira al suroeste (5); girado ("se"), al sureste (3)
  banco: { nombre: "Banco", blocks: true, orientable: true, mundo: true, sit: { alto: 13, dir: 5, dirGirado: 3 } },
};

export type FurnitureKind = keyof typeof FURNITURE;

export function isFurniture(kind: string | undefined): kind is FurnitureKind {
  return kind !== undefined && kind in FURNITURE;
}

/** ¿Es un asiento? (lo usan el A* del cliente y la validación del servidor) */
export function isSeat(kind: string | undefined): boolean {
  return isFurniture(kind) && FURNITURE[kind].sit !== undefined;
}

/**
 * Las celdas que ocupa un mueble puesto en (col, row). Cliente y servidor
 * bloquean exactamente éstas: si cada lado lo calculara a su manera,
 * discreparían sobre qué celdas están libres.
 */
export function celdasDe(kind: string | undefined, col: number, row: number): { col: number; row: number }[] {
  const h = isFurniture(kind) ? FURNITURE[kind].huella : undefined;
  const w = h?.col ?? 1;
  const l = h?.row ?? 1;
  const out: { col: number; row: number }[] = [];
  for (let r = 0; r < l; r++) for (let c = 0; c < w; c++) out.push({ col: col + c, row: row + r });
  return out;
}

/**
 * ¿Va girado? Lo orientable se gira pegado a la pared de la columna 0, o si
 * el mapa lo pide (propiedad `girado`). Cliente y servidor usan esta misma
 * regla, así que los dos saben hacia dónde mira quien se sienta.
 */
export function vaGirado(kind: string | undefined, col: number, girado: boolean): boolean {
  return isFurniture(kind) && FURNITURE[kind].orientable === true && (col === 0 || girado);
}

/** El asiento de un mueble en una celda, listo para `AvatarState` (o null) */
export function seatAt(kind: string | undefined, col: number, row: number, girado = false): SitTarget | null {
  if (!isFurniture(kind)) return null;
  const s = FURNITURE[kind].sit;
  if (!s) return null;
  const dir = vaGirado(kind, col, girado) && s.dirGirado !== undefined ? s.dirGirado : s.dir;
  return { col, row, alto: s.alto, dir };
}
