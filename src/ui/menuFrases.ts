import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { CATEGORIAS, GESTOS, type Frase } from "../state/frases";
import { anchoTexto, boton, icono, pieza, texto, UI, yCentrada } from "./kit";
import { medidas } from "./pantalla";

// Menú de frases: el chat seguro. Los niños sólo hablan con él (ver
// `src/state/normas.ts`); los demás lo tienen a mano desde la barra del chat.
// Pestañas por tema y, dentro, una frase por botón: al pulsar, se dice y el
// menú se cierra. Se coloca con la pantalla de ese momento: en una ancha, a
// la derecha del chat; en un móvil, a lo ancho y encima de la barra de botones.
//
// Objetos sueltos con scrollFactor(0), nunca un Container (ver CLAUDE.md).

export type OpcionesMenuFrases = {
  alElegir: (id: string) => void;
  alCerrar: () => void;
  /** Lo que ocupa abajo la interfaz (la barra de botones del móvil): el menú va encima */
  abajo?: number;
};

type Pestana = { id: string; titulo: string; frases: Frase[] };
const PESTANAS: Pestana[] = [...CATEGORIAS, { id: "gestos", titulo: "Gestos", frases: GESTOS }];

const ANCHO_MAX = 440;
/** En una pantalla ancha, a la derecha de la columna del chat, para no tapar el historial */
const X_JUNTO_AL_CHAT = 376;
const PAD = 8;
const HUECO = 4;
const ALTO_CABECERA = 22;

type Hueco = { x: number; y: number; w: number };

/** Coloca botones de izquierda a derecha, saltando de fila cuando no caben */
function fluir(anchos: number[], anchoMax: number, alto: number): { huecos: Hueco[]; filas: number } {
  const huecos: Hueco[] = [];
  let x = 0;
  let fila = 0;
  for (const w of anchos) {
    if (x > 0 && x + w > anchoMax) {
      x = 0;
      fila++;
    }
    huecos.push({ x, y: fila * (alto + HUECO), w });
    x += w + HUECO;
  }
  return { huecos, filas: anchos.length ? fila + 1 : 0 };
}

export class MenuFrases {
  private scene: Phaser.Scene;
  private o: OpcionesMenuFrases;
  private fijos: Phaser.GameObjects.GameObject[] = [];
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private pestana = PESTANAS[0].id;
  private x0: number;
  private y0: number;
  private w: number;
  private alto: number;
  /** Alto de cada botón: con el dedo, más grandes */
  private altoBoton: number;
  /** Ancho de los botones de gesto (un emoji) */
  private anchoGesto: number;

  constructor(scene: Phaser.Scene, o: OpcionesMenuFrases) {
    this.scene = scene;
    this.o = o;
    const m = medidas();
    const SW = scene.scale.width;
    this.altoBoton = m.fila;
    this.anchoGesto = m.fila + 8;
    this.w = Math.min(ANCHO_MAX, SW - 16);
    this.x0 = SW >= X_JUNTO_AL_CHAT + ANCHO_MAX + 8 ? X_JUNTO_AL_CHAT : Math.round((SW - this.w) / 2);
    const ancho = this.w - PAD * 2;
    // El alto es el de la pestaña con más filas: así el panel no salta al
    // cambiar de pestaña
    const filas = Math.max(
      ...PESTANAS.map((p) => fluir(p.frases.map((f) => this.anchoFrase(f, p.id === "gestos")), ancho, this.altoBoton).filas),
    );
    const filasPestanas = fluir(this.anchosPestanas(), ancho, this.altoBoton).filas;
    this.alto =
      PAD + ALTO_CABECERA + 6 + filasPestanas * (this.altoBoton + HUECO) - HUECO + 10 + filas * (this.altoBoton + HUECO) - HUECO + PAD;
    this.y0 = Math.max(8, scene.scale.height - (o.abajo ?? 0) - 8 - this.alto);
    this.construir();
  }

  private anchoFrase(f: Frase, gestos: boolean): number {
    return gestos ? this.anchoGesto : anchoTexto(f.texto) + 14;
  }

  private anchosPestanas(): number[] {
    return PESTANAS.map((p) => anchoTexto(p.titulo) + 12);
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
    const X0 = this.x0;
    const W = this.w;
    const lado = medidas().tactil ? 26 : 20;
    // El fondo se come los toques: pulsar dentro del menú no hace andar
    this.poner(this.fijos, pieza(s, "panel", X0, this.y0, W, this.alto).setInteractive(), 0);
    this.poner(this.fijos, icono(s, "rombo", X0 + PAD, this.y0 + PAD + 9), 2);
    this.poner(this.fijos, texto(s, X0 + PAD + 14, yCentrada(this.y0 + PAD, ALTO_CABECERA), "Frases", { color: UI.titulo }), 2);
    this.fijos.push(
      ...boton(s, X0 + W - PAD - lado, this.y0 + PAD + 1 - (lado - 20) / 2, lado, lado, "", () => this.o.alCerrar(), {
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
    const X0 = this.x0;
    const ALTO_BOTON = this.altoBoton;
    const ancho = this.w - PAD * 2;

    // Pestañas (en un móvil estrecho, en dos filas)
    const yPestanas = this.y0 + PAD + ALTO_CABECERA + 6;
    const pestanas = fluir(this.anchosPestanas(), ancho, ALTO_BOTON);
    PESTANAS.forEach((p, i) => {
      const h = pestanas.huecos[i];
      const activa = p.id === this.pestana;
      const b = boton(s, X0 + PAD + h.x, yPestanas + h.y, h.w, ALTO_BOTON, p.titulo, () => this.cambiar(p.id), {
        primario: activa,
        capa: LAYER.UI_PANEL + 2,
      });
      this.dinamicos.push(...b.objetos);
    });

    const actual = PESTANAS.find((p) => p.id === this.pestana) ?? PESTANAS[0];
    const gestos = actual.id === "gestos";
    const { huecos } = fluir(actual.frases.map((f) => this.anchoFrase(f, gestos)), ancho, ALTO_BOTON);
    const yFrases = yPestanas + pestanas.filas * (ALTO_BOTON + HUECO) - HUECO + 10;
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
