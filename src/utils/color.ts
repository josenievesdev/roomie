// Rampas de color. Módulo PURO (sin Phaser): lo usan el generador de
// avatares, el navegador y cualquier dibujo que quiera seguir la guía de
// estilo (`docs/guia-de-estilo.md`).
//
// Una rampa son 5 tonos de un mismo color, de la luz al contorno:
//   0 brillo · 1 luz (el color "de catálogo") · 2 media · 3 sombra · 4 contorno
//
// La regla que hace que todo parezca del mismo juego: las luces tiran hacia
// el amarillo y las sombras hacia el azul (en la piel, hacia el rojo). Se
// calcula en OKLCH, un espacio donde "un 10% más oscuro" se VE un 10% más
// oscuro para cualquier color. En HSL, girar el tono de un morado oscuro lo
// convertía en un azul eléctrico; aquí el croma se conserva.

export type Rampa = readonly [number, number, number, number, number];

type Lch = { l: number; c: number; h: number };

// ---------- sRGB <-> OKLab (Björn Ottosson) ----------

const aLineal = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const aSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toLch(hex: number): Lch {
  const r = aLineal(((hex >> 16) & 0xff) / 255);
  const g = aLineal(((hex >> 8) & 0xff) / 255);
  const b = aLineal((hex & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** OKLCH -> RGB lineal (puede salirse de [0,1] si el color no existe en sRGB) */
function lchALineal({ l, c, h }: Lch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** OKLCH -> hex, bajando el croma hasta que el color exista en sRGB */
function fromLch(x: Lch): number {
  let c = x.c;
  let rgb = lchALineal({ ...x, c });
  for (let i = 0; i < 24 && rgb.some((v) => v < -1e-4 || v > 1 + 1e-4); i++) {
    c *= 0.9;
    rgb = lchALineal({ ...x, c });
  }
  const ch = (v: number) => Math.round(Math.min(Math.max(aSrgb(Math.min(Math.max(v, 0), 1)), 0), 1) * 255);
  return (ch(rgb[0]) << 16) | (ch(rgb[1]) << 8) | ch(rgb[2]);
}

/** Gira el tono `h` hacia `hacia` como mucho `grados` (por el camino corto) */
function girar(h: number, hacia: number, grados: number): number {
  const delta = ((hacia - h + 540) % 360) - 180;
  return h + Math.sign(delta) * Math.min(Math.abs(delta), grados);
}

export type OpcionesRampa = {
  /** Tono OKLCH al que tienden las sombras (265 = azul; la piel usa ~35, rojizo) */
  sombraHacia?: number;
  /** Tono OKLCH al que tienden las luces (95 = amarillo) */
  luzHacia?: number;
  /** Separación de los tonos en luminosidad (1 = normal) */
  contraste?: number;
  /** Cuánto gira el tono en la sombra más profunda, en grados */
  giro?: number;
};

/**
 * Rampa de 5 tonos a partir del color de catálogo (el tono 1, "luz").
 * Los colores muy oscuros o muy claros no se salen de rango: el negro sigue
 * teniendo brillo y el blanco sombra.
 */
export function rampa(base: number, o: OpcionesRampa = {}): Rampa {
  const sombraHacia = o.sombraHacia ?? 265;
  const luzHacia = o.luzHacia ?? 95;
  const k = o.contraste ?? 1;
  const giro = o.giro ?? 14;
  const b = toLch(base);
  // Los grises no tienen tono: se les presta el de la sombra con un croma
  // mínimo, para que su sombra sea un gris frío y no un gris sucio.
  const gris = b.c < 0.02;
  const h = gris ? sombraHacia : b.h;
  const c = gris ? 0.012 : b.c;
  // Muy claros: las sombras bajan más; muy oscuros: el brillo sube más
  const paso = 0.085 * k * (b.l > 0.85 ? 1.15 : 1);
  const tono = (dl: number, fc: number, hacia: number, grados: number, cMin = 0): number =>
    fromLch({ l: Math.min(Math.max(b.l + dl, 0.12), 0.98), c: Math.max(c * fc, cMin), h: girar(h, hacia, grados) });

  return [
    tono(paso * (b.l < 0.35 ? 1.3 : 0.95), 0.9, luzHacia, giro * 0.4),
    base,
    tono(-paso, 1.04, sombraHacia, giro * 0.5, gris ? 0.014 : 0),
    tono(-paso * 2, 1.02, sombraHacia, giro, gris ? 0.018 : 0),
    fromLch({ l: Math.max(0.2, Math.min(b.l * 0.45, 0.34)), c: c * 0.75 + 0.01, h: girar(h, sombraHacia, giro * 1.3) }),
  ];
}

/** Mezcla lineal de dos colores (t=0 → a, t=1 → b) */
export function mezcla(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Distancia perceptual entre dos colores (para migrar paletas viejas) */
export function distanciaColor(a: number, b: number): number {
  const x = toLch(a);
  const y = toLch(b);
  const ax = x.c * Math.cos((x.h * Math.PI) / 180);
  const ay = x.c * Math.sin((x.h * Math.PI) / 180);
  const bx = y.c * Math.cos((y.h * Math.PI) / 180);
  const by = y.c * Math.sin((y.h * Math.PI) / 180);
  return Math.hypot(x.l - y.l, ax - bx, ay - by);
}
