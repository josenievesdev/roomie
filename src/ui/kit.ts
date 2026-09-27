import Phaser from "phaser";

// Kit de interfaz pixel art: una fuente, unas piezas y unas reglas para que
// cada panel, botón y etiqueta del juego sea de la misma familia.
//
// - Texto: la fuente pixel propia (`tools/genfuente.mjs`) a tamaños de 8 px
//   (1×, junto al mundo: nombres, burbujas) o 16 px (2×, la interfaz).
// - Piezas: paneles, botones, campos y chips de 9 porciones (NineSlice),
//   dibujadas píxel a píxel aquí mismo: contorno casi negro, bisel claro
//   arriba e izquierda, sombra abajo y derecha, esquinas redondeadas a
//   píxel. En la interfaz cada píxel de la pieza son 2 del lienzo, igual que
//   la letra a 16 px.
// - Iconos: mapas de píxeles con el contorno puesto solo.

export const FUENTE = '"Roomie Pixel", monospace';

/** Colores de la interfaz (los mismos que en docs/guia-de-estilo.md) */
export const UI = {
  texto: "#ffffff",
  titulo: "#ffe9a8",
  suave: "#9a9ad0",
  error: "#ff7a7a",
  exito: "#7bed9f",
  sombraTexto: "#07070d",
} as const;

// ---------------------------------------------------------------- Texto

export type OpcionesTexto = {
  /** 1 = 8 px (junto al mundo), 2 = 16 px (interfaz), 3, 4... */
  tam?: number;
  color?: string;
  /** Sombra de 1 píxel de letra abajo a la derecha: se lee sobre cualquier fondo */
  sombra?: boolean;
  ancho?: number;
  alinear?: "left" | "center" | "right";
  interlineado?: number;
};

export function estiloTexto(o: OpcionesTexto = {}): Phaser.Types.GameObjects.Text.TextStyle {
  const tam = o.tam ?? 2;
  return {
    fontFamily: FUENTE,
    fontSize: `${8 * tam}px`,
    color: o.color ?? UI.texto,
    align: o.alinear ?? "left",
    lineSpacing: o.interlineado ?? tam * 2,
    ...(o.ancho ? { wordWrap: { width: o.ancho, useAdvancedWrap: true } } : {}),
    ...(o.sombra !== false
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

/** Mapas de píxeles de las piezas de 9 porciones (16×16, esquinas de 4) */
const MARCO = [
  "..oooooooooooo..",
  ".ohhhhhhhhhhhhs.",
  "ohhffffffffffffs",
  "ohffffffffffffss",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohffffffffffffso",
  "ohfffffffffffsso",
  ".ossssssssssssso",
  "..oooooooooooo..",
];

/** Hundido (campos de texto): la luz entra por abajo a la derecha */
const HUNDIDO = MARCO.map((f) => f.replace(/h/g, "X").replace(/s/g, "h").replace(/X/g, "s"));

type Colores = Record<string, string>;
const PIEZAS: Record<string, { mapa: string[]; c: Colores }> = {
  panel: { mapa: MARCO, c: { o: "#07070d", h: "#3a3a5e", f: "#1b1b2d", s: "#101019" } },
  chip: { mapa: MARCO, c: { o: "#07070dd9", h: "#2c2c46d9", f: "#12121ad0", s: "#0b0b12d9" } },
  boton: { mapa: MARCO, c: { o: "#07070d", h: "#4c4c7a", f: "#2a2a46", s: "#17172a" } },
  "boton-hover": { mapa: MARCO, c: { o: "#07070d", h: "#6060a0", f: "#36365c", s: "#1c1c32" } },
  "boton-pulsado": { mapa: HUNDIDO, c: { o: "#07070d", h: "#3a3a5e", f: "#202036", s: "#101019" } },
  primario: { mapa: MARCO, c: { o: "#1b1240", h: "#a597ff", f: "#6c5ce7", s: "#4636b0" } },
  "primario-hover": { mapa: MARCO, c: { o: "#1b1240", h: "#bdb2ff", f: "#7e6ff2", s: "#5242c4" } },
  "primario-pulsado": { mapa: HUNDIDO, c: { o: "#1b1240", h: "#a597ff", f: "#5a4ad4", s: "#3a2c98" } },
  campo: { mapa: HUNDIDO, c: { o: "#07070d", h: "#34345a", f: "#12121e", s: "#08080e" } },
  "campo-activo": { mapa: HUNDIDO, c: { o: "#8c7ce7", h: "#34345a", f: "#16162a", s: "#08080e" } },
  burbuja: { mapa: MARCO, c: { o: "#1a1a24", h: "#ffffff", f: "#ffffff", s: "#d6d6e4" } },
  nombre: { mapa: MARCO, c: { o: "#07070dcc", h: "#2a2a44cc", f: "#12121acc", s: "#0b0b12cc" } },
  tecla: { mapa: MARCO, c: { o: "#07070d", h: "#6a6a9a", f: "#3a3a5c", s: "#1e1e32" } },
};

/** Cola de la burbuja de chat, se pone debajo del centro */
const COLA = ["offfffo", ".offfo.", "..ofo..", "...o..."];

/** Iconos: sólo el relleno; el contorno se añade al generarlos */
const ICONOS: Record<string, { mapa: string[]; c: Colores }> = {
  casa: {
    mapa: ["....r....", "...rrr...", "..rrrrr..", ".rrrrrrr.", "rrrrrrrrr", ".wwwwwww.", ".wwwddww.", ".wwwddww.", ".wwwddww."],
    c: { r: "#e8896b", w: "#f1e8d2", d: "#8b5a2b" },
  },
  moneda: {
    mapa: [".yyyyy.", "yyWyyyy", "yWyyyyy", "yyyyyyy", "yyyyyyD", "yyyyyDD", ".yDDDD."],
    c: { y: "#f5c542", W: "#fff4b8", D: "#c98f1c" },
  },
  persona: {
    mapa: ["..sss..", ".sssss.", ".sssss.", "..sss..", ".......", ".bbbbb.", "bbbbbbb", "bbbbbbb", "bbbbbbb"],
    c: { s: "#f6c9a2", b: "#7f62e6" },
  },
  chat: {
    mapa: ["wwwwwwwww", "wkwwkwwkw", "wwwwwwwww", "wwwwwwwww", "..ww.....", "..w......"],
    c: { w: "#ffffff", k: "#3a3342" },
  },
  camiseta: {
    mapa: ["ttt...ttt", "ttttttttt", "ttttttttt", "..ttttt..", "..ttttt..", "..ttttt..", "..ttttt.."],
    c: { t: "#62d6b4" },
  },
  gente: {
    mapa: ["..ss..ss..", ".ssss.ss..", ".ssss.....", "..ss...bb.", ".bbbb.bbbb", "bbbbbbbbbb", "bbbbbbbbbb"],
    c: { s: "#f6c9a2", b: "#44ad62" },
  },
};

const CONTORNO_ICONO = "#07070d";

/** Dibuja un mapa de píxeles en una textura, con cada píxel de `escala` × `escala` */
function mapaATextura(
  scene: Phaser.Scene,
  key: string,
  mapa: string[],
  colores: Colores,
  escala: number,
  contorno?: string,
): void {
  if (scene.textures.exists(key)) return;
  const borde = contorno ? 1 : 0;
  const w = mapa[0].length + borde * 2;
  const h = mapa.length + borde * 2;
  const tex = scene.textures.createCanvas(key, w * escala, h * escala);
  if (!tex) return;
  const ctx = tex.getContext();
  const lleno = (x: number, y: number) => {
    const fila = mapa[y - borde];
    const c = fila?.[x - borde];
    return c !== undefined && c !== "." && colores[c] !== undefined;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let color: string | undefined;
      if (lleno(x, y)) color = colores[mapa[y - borde][x - borde]];
      else if (contorno && (lleno(x - 1, y) || lleno(x + 1, y) || lleno(x, y - 1) || lleno(x, y + 1))) color = contorno;
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * escala, y * escala, escala, escala);
    }
  }
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** Genera (una vez) todas las texturas de la interfaz */
export function crearTexturasUI(scene: Phaser.Scene): void {
  for (const [nombre, p] of Object.entries(PIEZAS)) {
    // A 2× para la interfaz y las burbujas; los nombres, discretos, a 1×
    const escala = nombre === "nombre" ? 1 : 2;
    mapaATextura(scene, `ui:${nombre}`, p.mapa, p.c, escala);
  }
  mapaATextura(scene, "ui:cola", COLA, PIEZAS.burbuja.c, 2);
  for (const [nombre, i] of Object.entries(ICONOS)) {
    mapaATextura(scene, `ui:icono:${nombre}`, i.mapa, i.c, 2, CONTORNO_ICONO);
  }
}

/** Esquina de las piezas en píxeles de lienzo (4 del mapa, a su escala) */
const esquina = (nombre: string) => (nombre === "nombre" ? 4 : 8);

/** Pieza de 9 porciones fija a la cámara, con su esquina superior izquierda en (x, y) */
export function pieza(
  scene: Phaser.Scene,
  nombre: keyof typeof PIEZAS | string,
  x: number,
  y: number,
  w: number,
  h: number,
): Phaser.GameObjects.NineSlice {
  const e = esquina(nombre);
  return scene.add
    .nineslice(Math.round(x), Math.round(y), `ui:${nombre}`, undefined, Math.round(w), Math.round(h), e, e, e, e)
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
  tam?: number;
};

export type Boton = {
  objetos: Phaser.GameObjects.GameObject[];
  fondo: Phaser.GameObjects.NineSlice;
  etiqueta: Phaser.GameObjects.Text | null;
};

/**
 * Botón con sus tres estados (normal, encima, pulsado). Todo son objetos
 * sueltos: con un Container fijo a la cámara el clic caía en otro sitio.
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
  const tam = o.tam ?? 2;

  let etiquetaObj: Phaser.GameObjects.Text | null = null;
  let iconoObj: Phaser.GameObjects.Image | null = null;
  if (o.icono) {
    iconoObj = icono(scene, o.icono, 0, 0).setScrollFactor(sf).setDepth(o.capa + 1);
    objetos.push(iconoObj);
  }
  if (etiqueta) {
    etiquetaObj = texto(scene, 0, 0, etiqueta, { tam }).setScrollFactor(sf).setDepth(o.capa + 1);
    objetos.push(etiquetaObj);
  }
  // Icono y texto centrados juntos; se hunden 2 px al pulsar
  const colocar = (hundido: boolean) => {
    const d = hundido ? 2 : 0;
    const anchoIcono = iconoObj ? iconoObj.width : 0;
    const hueco = iconoObj && etiquetaObj ? 6 : 0;
    const anchoEtiqueta = etiquetaObj ? etiquetaObj.width - tam : 0; // sin la sombra
    let cx = Math.round(x + (w - anchoIcono - hueco - anchoEtiqueta) / 2) + d;
    if (iconoObj) {
      iconoObj.setPosition(cx, Math.round(y + (h - iconoObj.height) / 2) + d);
      cx += anchoIcono + hueco;
    }
    if (etiquetaObj) etiquetaObj.setPosition(cx, Math.round(y + (h - etiquetaObj.height + tam) / 2) + d);
  };
  colocar(false);

  fondo
    .setInteractive({ useHandCursor: true })
    .on("pointerover", () => fondo.setTexture(`ui:${base}-hover`))
    .on("pointerout", () => {
      fondo.setTexture(`ui:${base}`);
      colocar(false);
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
export function anchoTexto(contenido: string, tam = 2): number {
  medidor ??= document.createElement("canvas").getContext("2d");
  if (!medidor) return contenido.length * 6 * tam;
  medidor.font = `${8 * tam}px ${FUENTE}`;
  return Math.ceil(medidor.measureText(contenido).width);
}

/** Parte un texto en líneas que quepan en `anchoMax` píxeles, por palabras */
export function partirTexto(contenido: string, anchoMax: number, tam = 2): string[] {
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
