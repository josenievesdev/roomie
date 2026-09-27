import Phaser from "phaser";
import { LAYER, worldDepth } from "../render/layers";
import { componerMueble, rampasDeTema, variante, MAT_MUEBLE, type ManifiestoMuebles } from "../render/muebleSheet";
import type { RoomTheme } from "../render/theme";
import { pixelesDe, texturaDesde } from "../render/texturas";
import { FURNITURE } from "../state/furniture-catalog";
import { toScreen } from "../utils/iso";

// Mobiliario: modelos 3D generados por `tools/genmuebles.mjs`
// (public/assets/muebles/), coloreados con el tema de cada sala. Una textura
// por variante y tema: el mismo sofá es coral en la plaza y violeta en el
// club, sin dibujarlo dos veces.

const MANIFIESTO = "muebles:manifiesto";
const texCapa = (v: string): string => `mueble-capa:${v}`;

/** Encola el manifiesto y, al llegar, las imágenes que lista (una sola vez) */
export function preloadMuebles(scene: Phaser.Scene): void {
  if (scene.cache.json.exists(MANIFIESTO)) return; // reinicio de escena: ya está todo
  scene.load.json(MANIFIESTO, "assets/muebles/muebles.json");
  scene.load.once(`filecomplete-json-${MANIFIESTO}`, (_key: string, _tipo: string, datos: ManifiestoMuebles) => {
    for (const [v, e] of Object.entries(datos)) {
      if (!scene.textures.exists(texCapa(v))) scene.load.image(texCapa(v), `assets/muebles/${e.fichero}`);
    }
  });
}

/** De qué pared cuelga lo que está en una celda del anillo (null = no es pared) */
export function ladoPared(col: number, row: number): "der" | "izq" | null {
  if (row === 0) return "der"; // la pared de la fila 0 sube hacia la derecha
  if (col === 0) return "izq";
  return null;
}

/**
 * Variante de una celda de alfombra según sus vecinas: bit a bit, qué lados
 * son borde (1 = col-1, 2 = row-1, 4 = col+1, 8 = row+1). Así la cenefa sólo
 * rodea la alfombra entera y no cada baldosa.
 */
export function mascaraAlfombra(col: number, row: number, esAlfombra: (c: number, r: number) => boolean): number {
  return (
    (esAlfombra(col - 1, row) ? 0 : 1) |
    (esAlfombra(col, row - 1) ? 0 : 2) |
    (esAlfombra(col + 1, row) ? 0 : 4) |
    (esAlfombra(col, row + 1) ? 0 : 8)
  );
}

/**
 * Crea un mueble en su celda. `sufijo` elige la variante (pared, alfombra,
 * orientación): ver `variante()` en muebleSheet.ts.
 */
export function crearMueble(
  scene: Phaser.Scene,
  tipo: string,
  sufijo: string | number | undefined,
  col: number,
  row: number,
  tema: RoomTheme,
): Phaser.GameObjects.Image | null {
  const v = variante(tipo, sufijo);
  const e = (scene.cache.json.get(MANIFIESTO) as ManifiestoMuebles | undefined)?.[v];
  if (!e || !scene.textures.exists(texCapa(v))) return null;
  const key = `mueble:${v}:${tema.nombre}`;
  if (!scene.textures.exists(key)) {
    texturaDesde(scene, key, componerMueble(pixelesDe(scene, texCapa(v)), e, tema), e.w, e.h);
  }
  const pos = toScreen(col, row);
  const def = FURNITURE[tipo];
  // Lo plano va pegado al suelo; lo de pared, justo encima de su trozo de
  // muro (que está en la Y de su celda); lo demás, en la Y de su celda.
  const z = def?.plano ? LAYER.ALFOMBRA : def?.pared || tipo === "puerta" ? worldDepth(pos.y) + 0.1 : worldDepth(pos.y);
  return scene.add.image(pos.x, pos.y, key).setOrigin(e.ax / e.w, e.ay / e.h).setDepth(z);
}

// ---------------------------------------------------------------- Ambiente

/** Tramado ordenado 4×4: degradados en escalones de píxel, no borrosos */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * Halo de luz tramado: una elipse que se apaga hacia fuera en escalones de
 * píxel (tres niveles de opacidad), para que la luz también sea pixel art.
 */
function halo(scene: Phaser.Scene, key: string, rx: number, ry: number, color: number): string {
  if (scene.textures.exists(key)) return key;
  const w = rx * 2;
  const h = ry * 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x + 0.5 - rx) / rx, (y + 0.5 - ry) / ry);
      if (d >= 1) continue;
      const intensidad = (1 - d) ** 1.4 + (BAYER[y & 3][x & 3] / 16 - 0.5) * 0.12;
      const nivel = intensidad > 0.62 ? 3 : intensidad > 0.36 ? 2 : intensidad > 0.14 ? 1 : 0;
      if (nivel === 0) continue;
      const k = (y * w + x) * 4;
      rgba[k] = (color >> 16) & 0xff;
      rgba[k + 1] = (color >> 8) & 0xff;
      rgba[k + 2] = color & 0xff;
      rgba[k + 3] = nivel * 34;
    }
  }
  texturaDesde(scene, key, rgba, w, h);
  return key;
}

/** Color de la luz de una sala: el tono de brillo del material LUZ de su tema */
const colorLuz = (tema: RoomTheme): number => rampasDeTema(tema)(MAT_MUEBLE.LUZ)[1];

/**
 * Luz de ambiente de un mueble: charco en el suelo bajo la lámpara, halo en
 * el muro alrededor de apliques y neones, y el rectángulo de sol que entra
 * por la ventana. Se suma (blend ADD) a lo que hay debajo, así que nunca
 * oscurece.
 */
export function crearLuz(scene: Phaser.Scene, tipo: string, col: number, row: number, tema: RoomTheme): void {
  const pos = toScreen(col, row);
  const luz = colorLuz(tema);
  const lado = ladoPared(col, row);
  const signo = lado === "izq" ? -1 : 1;

  if (tipo === "lampara") {
    scene.add
      .image(pos.x, pos.y, halo(scene, `halo:suelo:${tema.nombre}`, 46, 23, luz))
      .setDepth(LAYER.ALFOMBRA + 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    return;
  }
  if (tipo === "aplique" || tipo === "neon") {
    // La luz queda alrededor de la pieza, sobre el muro (a ~63 px del suelo)
    const alto = tipo === "neon" ? 57 : 63;
    const r = tipo === "neon" ? 22 : 16;
    scene.add
      .image(pos.x + signo * 12, pos.y - alto, halo(scene, `halo:muro:${tipo}:${tema.nombre}`, r, Math.round(r * 1.1), luz))
      .setDepth(worldDepth(pos.y) + 0.05)
      .setBlendMode(Phaser.BlendModes.ADD);
    return;
  }
  if (tipo === "ventana" && lado) {
    // El sol entra inclinado: el hueco de la ventana se proyecta en el suelo
    // desde el pie del muro hacia dentro de la sala.
    const g = scene.add.graphics().setDepth(LAYER.ALFOMBRA + 0.5).setBlendMode(Phaser.BlendModes.ADD);
    // Esquinas en unidades del modelo (X = col, Z = row, desde el centro de la celda)
    const esquinas: [number, number][] =
      lado === "der"
        ? [[-13, -4], [13, -4], [13, 17], [-13, 17]]
        : [[-4, -13], [-4, 13], [17, 13], [17, -13]];
    const aPantalla = ([X, Z]: [number, number]) => ({ x: pos.x + (X - Z) * 0.7071, y: pos.y + (X + Z) * 0.3536 });
    g.fillStyle(0xfff1c4, 0.13);
    g.fillPoints(esquinas.map(aPantalla), true);
  }
}

/**
 * Sombra de contacto al pie de los muros: una franja oscura que ancla las
 * paredes al suelo. Sin ella, la pared parece pegada encima del suelo.
 */
export function crearSombraMuros(scene: Phaser.Scene, cols: number, rows: number): void {
  const g = scene.add.graphics().setDepth(LAYER.ALFOMBRA - 1);
  const pasos = [
    { ancho: 6, alfa: 0.16 },
    { ancho: 3, alfa: 0.14 },
  ];
  for (const { ancho, alfa } of pasos) {
    g.fillStyle(0x0c0a14, alfa);
    // Pared de la fila 0: borde noreste de esas celdas; la franja entra hacia +row
    const n = toScreen(-0.5, -0.5);
    const e = toScreen(cols - 0.5, -0.5);
    const d = { x: -ancho * 0.894, y: ancho * 0.447 };
    g.fillPoints([n, e, { x: e.x + d.x, y: e.y + d.y }, { x: n.x + d.x, y: n.y + d.y }], true);
    // Pared de la columna 0: borde noroeste; la franja entra hacia +col
    const o = toScreen(-0.5, rows - 0.5);
    const d2 = { x: ancho * 0.894, y: ancho * 0.447 };
    g.fillPoints([n, o, { x: o.x + d2.x, y: o.y + d2.y }, { x: n.x + d2.x, y: n.y + d2.y }], true);
  }
}
