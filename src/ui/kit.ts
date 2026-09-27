import Phaser from "phaser";

// Kit de interfaz de Roomie: una fuente, unas piezas y unas reglas para que
// cada panel, botón y etiqueta del juego sea de la misma familia.
//
// El estilo: líneas de 1 píxel, esquinas redondeadas y paneles de cristal
// oscuro con un borde fino y un brillo tenue arriba; el panel principal lleva
// además una línea de color en el borde de arriba. Nada de biseles gordos ni
// letra duplicada: fino, pero pixel art.
//
// - Texto: la fuente pixel propia (`tools/genfuente.mjs`), trazo de 1 px, a
//   12 px (lo normal) o a 24 px (sólo el logo).
// - Piezas: paneles, botones, campos y pastillas de 9 porciones, dibujadas
//   píxel a píxel aquí mismo, a tamaño real.
// - Iconos: de línea (1 px, para los botones) o de color con contorno.

export const FUENTE = '"Roomie Pixel", monospace';

/** Colores de la interfaz (los mismos que en docs/guia-de-estilo.md) */
export const UI = {
  texto: "#f4f1ff",
  titulo: "#ffe9a8",
  suave: "#9a96c4",
  tenue: "#6c6890",
  acento: "#9d90ff",
  error: "#ff8a8a",
  exito: "#7bed9f",
  sombraTexto: "#07070d",
} as const;

/** Los mismos colores en número, para rectángulos y líneas de Phaser */
export const UI_HEX = {
  borde: 0x3d3860,
  velo: 0x07070d,
} as const;

// ---------------------------------------------------------------- Texto

/**
 * La fuente mide 15 px de alto a 12 px: 3 de aire para las tildes, 9 de
 * mayúscula y 3 de rabos. Para centrar a ojo se centran las mayúsculas.
 */
export const LETRA = { alto: 15, aire: 3, mayuscula: 9 } as const;

export type OpcionesTexto = {
  /** 1 = 12 px (lo normal), 2 = 24 px (el logo) */
  tam?: number;
  color?: string;
  /** Sombra de 1 px abajo a la derecha: se lee sobre la sala, sea cual sea el fondo */
  sombra?: boolean;
  ancho?: number;
  alinear?: "left" | "center" | "right";
  interlineado?: number;
};

export function estiloTexto(o: OpcionesTexto = {}): Phaser.Types.GameObjects.Text.TextStyle {
  const tam = o.tam ?? 1;
  return {
    fontFamily: FUENTE,
    fontSize: `${12 * tam}px`,
    color: o.color ?? UI.texto,
    align: o.alinear ?? "left",
    lineSpacing: o.interlineado ?? tam,
    ...(o.ancho ? { wordWrap: { width: o.ancho, useAdvancedWrap: true } } : {}),
    ...(o.sombra
      ? { shadow: { offsetX: tam, offsetY: tam, color: UI.sombraTexto, blur: 0, fill: true } }
      : {}),
  };
}

/** Texto en la fuente pixel. Las coordenadas se redondean: medio píxel lo emborrona. */
export function texto(
  scene: Phaser.Scene,
  x: number,
  y: number,
  contenido: string,
  o: OpcionesTexto = {},
): Phaser.GameObjects.Text {
  return scene.add.text(Math.round(x), Math.round(y), contenido, estiloTexto(o));
}

/** Y a la que poner un texto de una línea para que sus mayúsculas queden centradas en [y, y+alto] */
export function yCentrada(y: number, alto: number, tam = 1): number {
  return Math.round(y + (alto - LETRA.mayuscula * tam) / 2 - LETRA.aire * tam);
}

/**
 * Coloca un objeto con su esquina superior izquierda en píxeles enteros,
 * aunque se quiera centrado (el origen 0,5 con ancho impar cae a medio píxel).
 */
export function centrar<T extends Phaser.GameObjects.Components.Transform & { width: number; height: number }>(
  o: T & Phaser.GameObjects.Components.Origin,
  cx: number,
  cy: number,
): T {
  o.setOrigin(0, 0);
  o.setPosition(Math.round(cx - o.width / 2), Math.round(cy - o.height / 2));
  return o;
}

// ---------------------------------------------------------------- Piezas

/**
 * Rectángulo redondeado de 1 px (12×12, esquinas de 4 para el NineSlice):
 * t = borde de arriba, o = el resto del borde, h = brillo bajo el borde de
 * arriba, f = relleno.
 */
const MARCO = [
  "..tttttttt..",
  ".thhhhhhhht.",
  "offffffffffo",
  "offffffffffo",
  "offffffffffo",
  "offffffffffo",
  "offffffffffo",
  "offffffffffo",
  "offffffffffo",
  "offffffffffo",
  ".offffffffo.",
  "..oooooooo..",
];

type Colores = Record<string, string>;
/** Colores de una pieza; si no se da `t`, el borde de arriba es como el resto */
const col = (o: string, h: string, f: string, t = o): Colores => ({ o, h, f, t });

const PIEZAS: Record<string, Colores> = {
  // Paneles: cristal oscuro; el principal con su línea de color arriba
  panel: col("#3d3860", "#26233a", "#17151ff4", "#8577f2"),
  chip: col("#3d3860d8", "#26233ad8", "#14121cdc"),
  // Botones: planos; al pasar se enciende el borde, al pulsar se hunde
  boton: col("#3d3860", "#2c2940", "#211e30"),
  "boton-hover": col("#7a72b8", "#3a355a", "#2a2640"),
  "boton-pulsado": col("#7a72b8", "#131119", "#1a1826"),
  primario: col("#8b7cf6", "#8577f2", "#6c5ce7"),
  "primario-hover": col("#b3a8ff", "#9486f6", "#7a6bf0"),
  "primario-pulsado": col("#8b7cf6", "#4c3cc0", "#5a4ad4"),
  // Campos: más oscuros que el panel y con la sombra arriba (hundidos)
  campo: col("#3d3860", "#0b0a10", "#100e17"),
  "campo-activo": col("#9d90ff", "#0b0a10", "#131120"),
  burbuja: col("#2c2838", "#ffffff", "#ffffff"),
  nombre: col("#3d3860b0", "#1e1b2cb0", "#14121cc0"),
  tecla: col("#5a5584", "#2c2940", "#1c1a28e8"),
};

/** Cola de la burbuja de chat: se pone bajo el centro, pisando su borde */
const COLA = ["offfo", ".ofo.", "..o.."];

type Icono = { mapa: string[]; c: Colores; contorno?: boolean };

/** Trazo de los iconos de línea */
const LINEA = "#f4f1ff";

const ICONOS: Record<string, Icono> = {
  // ---- De línea: los botones del HUD
  chat: {
    mapa: [
      ".wwwwwwwww.",
      "w.........w",
      "w.........w",
      "w..a.a.a..w",
      "w.........w",
      "w.........w",
      ".ww.wwwwww.",
      "..w.w......",
      "..ww.......",
    ],
    c: { w: LINEA, a: "#9d90ff" },
  },
  camiseta: {
    mapa: [
      "..www.www..",
      ".w...w...w.",
      "w.........w",
      "w.w.....w.w",
      ".ww.....ww.",
      "..w..a..w..",
      "..w.....w..",
      "..w.....w..",
      "..wwwwwww..",
    ],
    c: { w: LINEA, a: "#62d6b4" },
  },
  persona: {
    mapa: [
      "....www....",
      "...w...w...",
      "...w...w...",
      "....www....",
      "...........",
      "...wwwww...",
      "..w.....w..",
      ".w.......w.",
      ".wwwwwwwww.",
    ],
    c: { w: LINEA },
  },
  mas: { mapa: ["...w...", "...w...", "...w...", "wwwwwww", "...w...", "...w...", "...w..."], c: { w: LINEA } },
  menos: { mapa: ["wwwwwww"], c: { w: LINEA } },
  cerrar: { mapa: ["w...w", ".w.w.", "..w..", ".w.w.", "w...w"], c: { w: LINEA } },
  // ---- De color, con contorno: se leen sobre cualquier fondo
  casa: {
    mapa: [
      "....r....",
      "...rRr...",
      "..rRrrr..",
      ".rRrrrrr.",
      "rrrrrrrrr",
      ".wwwwwww.",
      ".wbwwdww.",
      ".wwwwdww.",
      ".wwwwdww.",
    ],
    c: { r: "#e8896b", R: "#f4a888", w: "#f1e8d2", b: "#7ec8e3", d: "#8b5a2b" },
    contorno: true,
  },
  moneda: {
    mapa: ["..yyy..", ".yWWyy.", "yWyyyyD", "yWyyyyD", "yyyyyyD", ".yyyyD.", "..DDD.."],
    c: { y: "#f5c542", W: "#fff4b8", D: "#c98f1c" },
    contorno: true,
  },
  // Rombo isométrico: la baldosa del juego en pequeño, de viñeta en los títulos
  rombo: {
    mapa: ["...aa...", ".aaaaaa.", ".AAAAAA.", "...AA..."],
    c: { a: "#9d90ff", A: "#6c5ce7" },
  },
};

const CONTORNO_ICONO = "#0b0a10";

/** Dibuja un mapa de píxeles en una textura (con contorno de 1 px si se pide) */
function mapaATextura(scene: Phaser.Scene, key: string, mapa: string[], colores: Colores, contorno?: string): void {
  if (scene.textures.exists(key)) return;
  const borde = contorno ? 1 : 0;
  const w = mapa[0].length + borde * 2;
  const h = mapa.length + borde * 2;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const lleno = (x: number, y: number) => {
    const c = mapa[y - borde]?.[x - borde];
    return c !== undefined && c !== "." && colores[c] !== undefined;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let color: string | undefined;
      if (lleno(x, y)) color = colores[mapa[y - borde][x - borde]];
      else if (contorno && (lleno(x - 1, y) || lleno(x + 1, y) || lleno(x, y - 1) || lleno(x, y + 1))) color = contorno;
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Genera (una vez) todas las texturas de la interfaz */
export function crearTexturasUI(scene: Phaser.Scene): void {
  for (const [nombre, c] of Object.entries(PIEZAS)) mapaATextura(scene, `ui:${nombre}`, MARCO, c);
  mapaATextura(scene, "ui:cola", COLA, PIEZAS.burbuja);
  for (const [nombre, i] of Object.entries(ICONOS)) {
    mapaATextura(scene, `ui:icono:${nombre}`, i.mapa, i.c, i.contorno ? CONTORNO_ICONO : undefined);
  }
}

/** Esquina de las piezas: la curva del marco ocupa 4 píxeles */
const ESQUINA = 4;

/** Pieza de 9 porciones con su esquina superior izquierda en (x, y) */
export function pieza(
  scene: Phaser.Scene,
  nombre: keyof typeof PIEZAS | string,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.NineSlice {
  return scene.add
    .nineslice(Math.round(x), Math.round(y), `ui:${nombre}`, undefined, Math.round(w), Math.round(h), ESQUINA, ESQUINA, ESQUINA, ESQUINA)
    .setOrigin(0, 0);
}

export function icono(scene: Phaser.Scene, nombre: keyof typeof ICONOS | string, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(Math.round(x), Math.round(y), `ui:icono:${nombre}`).setOrigin(0, 0);
}

// ---------------------------------------------------------------- Botón

export type OpcionesBoton = {
  primario?: boolean;
  icono?: string;
  /** Profundidad del fondo; el texto e icono van justo encima */
  capa: number;
  scrollFactor?: number;
  /** Etiqueta que aparece al pasar por encima (para los botones de sólo icono) */
  pista?: string;
  /** Hacia dónde sale la pista: debajo (por defecto), encima o a la izquierda */
  ladoPista?: "abajo" | "arriba" | "izquierda";
};

export type Boton = {
  objetos: Phaser.GameObjects.GameObject[];
  fondo: Phaser.GameObjects.NineSlice;
  etiqueta: Phaser.GameObjects.Text | null;
};

/**
 * Botón con sus tres estados (normal, encima, pulsado); actúa al soltar.
 * Todo son objetos sueltos: con un Container fijo a la cámara el clic caía
 * en otro sitio.
 */
export function boton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  etiqueta: string,
  alPulsar: () => void,
  o: OpcionesBoton,
): Boton {
  const base = o.primario ? "primario" : "boton";
  const sf = o.scrollFactor ?? 0;
  const fondo = pieza(scene, base, x, y, w, h).setScrollFactor(sf).setDepth(o.capa);
  const objetos: Phaser.GameObjects.GameObject[] = [fondo];

  let etiquetaObj: Phaser.GameObjects.Text | null = null;
  let iconoObj: Phaser.GameObjects.Image | null = null;
  if (o.icono) {
    iconoObj = icono(scene, o.icono, 0, 0).setScrollFactor(sf).setDepth(o.capa + 1);
    objetos.push(iconoObj);
  }
  if (etiqueta) {
    etiquetaObj = texto(scene, 0, 0, etiqueta).setScrollFactor(sf).setDepth(o.capa + 1);
    objetos.push(etiquetaObj);
  }
  // Icono y texto centrados juntos; bajan 1 px al pulsar
  const colocar = (hundido: boolean) => {
    const d = hundido ? 1 : 0;
    const anchoIcono = iconoObj ? iconoObj.width : 0;
    const hueco = iconoObj && etiquetaObj ? 6 : 0;
    const anchoEtiqueta = etiquetaObj ? etiquetaObj.width : 0;
    let cx = Math.round(x + (w - anchoIcono - hueco - anchoEtiqueta) / 2);
    if (iconoObj) {
      iconoObj.setPosition(cx, Math.round(y + (h - iconoObj.height) / 2) + d);
      cx += anchoIcono + hueco;
    }
    if (etiquetaObj) etiquetaObj.setPosition(cx, yCentrada(y, h) + d);
  };
  colocar(false);

  // Pista: una etiqueta junto al botón, sólo mientras se pasa por encima
  let pista: Phaser.GameObjects.GameObject[] = [];
  const quitarPista = () => {
    for (const p of pista) p.destroy();
    pista = [];
  };
  const ponerPista = () => {
    if (!o.pista) return;
    quitarPista();
    const t = texto(scene, 0, 0, o.pista, { color: UI.texto });
    const pw = t.width + 12;
    const ph = 20;
    let px: number;
    let py: number;
    if (o.ladoPista === "izquierda") {
      px = x - pw - 4;
      py = y + Math.round((h - ph) / 2);
    } else {
      px = Phaser.Math.Clamp(x + w / 2 - pw / 2, 4, scene.scale.width - pw - 4);
      py = o.ladoPista === "arriba" ? y - ph - 4 : y + h + 4;
    }
    const f = pieza(scene, "chip", px, py, pw, ph).setScrollFactor(sf).setDepth(o.capa + 2);
    t.setPosition(Math.round(px + 6), yCentrada(py, ph)).setScrollFactor(sf).setDepth(o.capa + 3);
    pista = [f, t];
  };
  fondo.once("destroy", quitarPista);

  fondo
    .setInteractive({ useHandCursor: true })
    .on("pointerover", () => {
      fondo.setTexture(`ui:${base}-hover`);
      ponerPista();
    })
    .on("pointerout", () => {
      fondo.setTexture(`ui:${base}`);
      colocar(false);
      quitarPista();
    })
    .on("pointerdown", () => {
      fondo.setTexture(`ui:${base}-pulsado`);
      colocar(true);
    })
    .on("pointerup", () => {
      fondo.setTexture(`ui:${base}-hover`);
      colocar(false);
      alPulsar();
    });
  return { objetos, fondo, etiqueta: etiquetaObj };
}

// ---------------------------------------------------------------- Medir

let medidor: CanvasRenderingContext2D | null = null;

/** Ancho en píxeles de un texto en la fuente pixel (para partir líneas) */
export function anchoTexto(contenido: string, tam = 1): number {
  medidor ??= document.createElement("canvas").getContext("2d");
  if (!medidor) return contenido.length * 6 * tam;
  medidor.font = `${12 * tam}px ${FUENTE}`;
  return Math.ceil(medidor.measureText(contenido).width);
}

/** Parte un texto en líneas que quepan en `anchoMax` píxeles, por palabras */
export function partirTexto(contenido: string, anchoMax: number, tam = 1): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of contenido.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (anchoTexto(prueba, tam) <= anchoMax) {
      actual = prueba;
      continue;
    }
    if (actual) lineas.push(actual);
    // Una palabra que no cabe sola se corta a trozos
    let resto = palabra;
    while (anchoTexto(resto, tam) > anchoMax && resto.length > 1) {
      let n = resto.length - 1;
      while (n > 1 && anchoTexto(resto.slice(0, n), tam) > anchoMax) n--;
      lineas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    actual = resto;
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [""];
}
