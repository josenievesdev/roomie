import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { CATEGORIAS, GESTOS, type Frase } from "../state/frases";
import { anchoTexto, boton, icono, pieza, texto, UI, yCentrada } from "./kit";

// Menú de frases: el chat seguro. Los niños sólo hablan con él (ver
// `src/state/normas.ts`); los demás lo tienen a mano desde la barra del chat.
// Pestañas por tema y, dentro, una frase por botón: al pulsar, se dice y el
// menú se cierra.
//
// Objetos sueltos con scrollFactor(0), nunca un Container (ver CLAUDE.md).

export type OpcionesMenuFrases = {
  alElegir: (id: string) => void;
  alCerrar: () => void;
};

type Pestana = { id: string; titulo: string; frases: Frase[] };
const PESTANAS: Pestana[] = [...CATEGORIAS, { id: "gestos", titulo: "Gestos", frases: GESTOS }];

const W = 440;
/** A la derecha de la columna del chat, para no tapar el historial */
const X0 = 376;
const PAD = 8;
const ALTO_BOTON = 22;
const HUECO = 4;
const ALTO_CABECERA = 22;
/** Ancho fijo de los botones de gesto (un emoji) */
const ANCHO_GESTO = 30;

type Hueco = { x: number; y: number; w: number };

/** Coloca botones de izquierda a derecha, saltando de fila cuando no caben */
function fluir(anchos: number[], anchoMax: number): { huecos: Hueco[]; filas: number } {
  const huecos: Hueco[] = [];
  let x = 0;
  let fila = 0;
  for (const w of anchos) {
    if (x > 0 && x + w > anchoMax) {
      x = 0;
      fila++;
    }
    huecos.push({ x, y: fila * (ALTO_BOTON + HUECO), w });
    x += w + HUECO;
  }
  return { huecos, filas: anchos.length ? fila + 1 : 0 };
}

const anchoFrase = (f: Frase, gestos: boolean): number => (gestos ? ANCHO_GESTO : anchoTexto(f.texto) + 14);

export class MenuFrases {
  private scene: Phaser.Scene;
  private o: OpcionesMenuFrases;
  private fijos: Phaser.GameObjects.GameObject[] = [];
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private pestana = PESTANAS[0].id;
  private y0: number;
  private alto: number;

  constructor(scene: Phaser.Scene, o: OpcionesMenuFrases) {
    this.scene = scene;
    this.o = o;
    // El alto es el de la pestaña con más filas: así el panel no salta al
    // cambiar de pestaña
    const filas = Math.max(
      ...PESTANAS.map((p) => fluir(p.frases.map((f) => anchoFrase(f, p.id === "gestos")), W - PAD * 2).filas),
    );
    this.alto = PAD + ALTO_CABECERA + 6 + ALTO_BOTON + 10 + filas * (ALTO_BOTON + HUECO) - HUECO + PAD;
    this.y0 = scene.scale.height - 8 - this.alto;
    this.construir();
  }

  destroy(): void {
    for (const obj of [...this.dinamicos, ...this.fijos]) obj.destroy();
    this.dinamicos = [];
    this.fijos = [];
  }

  private poner<T extends Phaser.GameObjects.GameObject>(lista: Phaser.GameObjects.GameObject[], o: T, capa = 1): T {
    (o as unknown as Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth)
      .setScrollFactor(0)
      .setDepth(LAYER.UI_PANEL + capa);
    lista.push(o);
    return o;
  }

  private construir(): void {
    const s = this.scene;
    // El fondo se come los toques: pulsar dentro del menú no hace andar
    this.poner(this.fijos, pieza(s, "panel", X0, this.y0, W, this.alto).setInteractive(), 0);
    this.poner(this.fijos, icono(s, "rombo", X0 + PAD, this.y0 + PAD + 9), 2);
    this.poner(this.fijos, texto(s, X0 + PAD + 14, yCentrada(this.y0 + PAD, ALTO_CABECERA), "Frases", { color: UI.titulo }), 2);
    this.fijos.push(
      ...boton(s, X0 + W - PAD - 20, this.y0 + PAD + 1, 20, 20, "", () => this.o.alCerrar(), {
        icono: "cerrar",
        capa: LAYER.UI_PANEL + 2,
        pista: "Cerrar · Esc",
      }).objetos,
    );
    this.pintar();
  }

  /** Pestañas y frases de la pestaña actual (se rehacen al cambiar) */
  private pintar(): void {
    for (const obj of this.dinamicos) obj.destroy();
    this.dinamicos = [];
    const s = this.scene;

    const yPestanas = this.y0 + PAD + ALTO_CABECERA + 6;
    const anchos = PESTANAS.map((p) => anchoTexto(p.titulo) + 12);
    let x = X0 + PAD;
    PESTANAS.forEach((p, i) => {
      const activa = p.id === this.pestana;
      const b = boton(s, x, yPestanas, anchos[i], ALTO_BOTON, p.titulo, () => this.cambiar(p.id), {
        primario: activa,
        capa: LAYER.UI_PANEL + 2,
      });
      this.dinamicos.push(...b.objetos);
      x += anchos[i] + HUECO;
    });

    const actual = PESTANAS.find((p) => p.id === this.pestana) ?? PESTANAS[0];
    const gestos = actual.id === "gestos";
    const { huecos } = fluir(actual.frases.map((f) => anchoFrase(f, gestos)), W - PAD * 2);
    const yFrases = yPestanas + ALTO_BOTON + 10;
    actual.frases.forEach((f, i) => {
      const h = huecos[i];
      if (gestos) {
        // El emoji lo pinta la fuente del sistema: no está en la fuente pixel
        const b = boton(s, X0 + PAD + h.x, yFrases + h.y, h.w, ALTO_BOTON, "", () => this.o.alElegir(f.id), {
          capa: LAYER.UI_PANEL + 2,
        });
        this.dinamicos.push(...b.objetos);
        const emoji = s.add
          .text(Math.round(X0 + PAD + h.x + h.w / 2), Math.round(yFrases + h.y + ALTO_BOTON / 2), f.texto, { fontSize: "13px" })
          .setOrigin(0.5);
        this.poner(this.dinamicos, emoji, 3);
        return;
      }
      const b = boton(s, X0 + PAD + h.x, yFrases + h.y, h.w, ALTO_BOTON, f.texto, () => this.o.alElegir(f.id), {
        capa: LAYER.UI_PANEL + 2,
      });
      this.dinamicos.push(...b.objetos);
    });
  }

  private cambiar(id: string): void {
    if (id === this.pestana) return;
    this.pestana = id;
    this.pintar();
  }
}
