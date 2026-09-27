import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { boton, icono, pieza, texto, UI, UI_HEX, yCentrada, type Boton } from "./kit";

// HUD: lo que está siempre en pantalla, pequeño y en las esquinas para que
// mande la sala. Arriba a la izquierda, dónde estás y cuánta gente hay;
// arriba a la derecha, tus monedas y tres botones de sólo icono (chat,
// vestidor, perfil) con su pista al pasar; abajo a la derecha, el zoom y una
// chuleta de teclas que se va sola al rato.

export type DatosHud = {
  /** Nombre bonito de la sala ("Plaza Central"), no su id */
  sala: string;
  enLinea: boolean;
  /** Gente en la sala contándote a ti */
  gente: number;
  saldo: number | null;
};

export type AccionesHud = {
  chat: () => void;
  vestidor: () => void;
  perfil: () => void;
  /** +1 acerca, -1 aleja */
  zoom: (paso: number) => void;
};

const MARGEN = 8;
/** Alto de todo lo del HUD: pastillas y botones */
const ALTO = 24;
const HUECO = 4;
/** Cuánto se queda la chuleta de teclas antes de irse */
const CHULETA_MS = 14000;

type Fijable = Phaser.GameObjects.GameObject & {
  setScrollFactor(v: number): Fijable;
  setDepth(v: number): Fijable;
};

export class Hud {
  private scene: Phaser.Scene;
  private chipSala: Phaser.GameObjects.NineSlice;
  private nombreSala: Phaser.GameObjects.Text;
  private separador: Phaser.GameObjects.Rectangle;
  private gente: Phaser.GameObjects.Text;
  private chipMonedas: Phaser.GameObjects.NineSlice;
  private monedas: Phaser.GameObjects.Text;
  private iconoMonedas: Phaser.GameObjects.Image;
  /** Borde derecho de la pastilla de monedas (crece hacia la izquierda) */
  private finMonedas: number;
  private zoomMas: Boton;
  private zoomMenos: Boton;
  private chuleta: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, acciones: AccionesHud) {
    this.scene = scene;
    const ancho = scene.scale.width;
    const alto = scene.scale.height;
    const fijo = <T extends Phaser.GameObjects.GameObject>(o: T, capa = 0): T => {
      (o as unknown as Fijable).setScrollFactor(0).setDepth(LAYER.UI_HUD + capa);
      return o;
    };
    const yTexto = yCentrada(MARGEN, ALTO);

    // ---- Dónde estás: casa, nombre de la sala | gente
    this.chipSala = fijo(pieza(scene, "chip", MARGEN, MARGEN, 120, ALTO));
    fijo(icono(scene, "casa", MARGEN + 7, MARGEN + 7), 1);
    this.nombreSala = fijo(texto(scene, MARGEN + 24, yTexto, "", { color: UI.titulo }), 1);
    this.separador = fijo(scene.add.rectangle(0, MARGEN + 6, 1, ALTO - 12, UI_HEX.borde).setOrigin(0, 0), 1);
    this.gente = fijo(texto(scene, 0, yTexto, ""), 1);

    // ---- Botones de sólo icono, de derecha a izquierda
    let x = ancho - MARGEN;
    const nuevo = (ico: string, pista: string, accion: () => void) => {
      x -= ALTO;
      boton(scene, x, MARGEN, ALTO, ALTO, "", accion, { icono: ico, capa: LAYER.UI_HUD, pista });
      x -= HUECO;
    };
    nuevo("persona", "Perfil", acciones.perfil);
    nuevo("camiseta", "Vestidor · C", acciones.vestidor);
    nuevo("chat", "Chat · Enter", acciones.chat);

    // ---- Monedas, a la izquierda de los botones
    this.finMonedas = x - HUECO;
    this.chipMonedas = fijo(pieza(scene, "chip", 0, MARGEN, 40, ALTO));
    this.iconoMonedas = fijo(icono(scene, "moneda", 0, MARGEN + 8), 1);
    this.monedas = fijo(texto(scene, 0, yTexto, "", { color: UI.titulo }), 1);

    // ---- Zoom, abajo a la derecha
    const zx = ancho - MARGEN - ALTO;
    const zy = alto - MARGEN - ALTO;
    this.zoomMenos = boton(scene, zx, zy, ALTO, ALTO, "", () => acciones.zoom(-1), {
      icono: "menos",
      capa: LAYER.UI_HUD,
      pista: "Alejar · −",
      ladoPista: "izquierda",
    });
    this.zoomMas = boton(scene, zx, zy - ALTO - HUECO, ALTO, ALTO, "", () => acciones.zoom(1), {
      icono: "mas",
      capa: LAYER.UI_HUD,
      pista: "Acercar · +",
      ladoPista: "izquierda",
    });

    this.crearChuleta(zx - 12, alto - MARGEN);
  }

  actualizar(d: DatosHud): void {
    this.nombreSala.setText(d.sala);
    const xSeparador = this.nombreSala.x + this.nombreSala.width + 8;
    this.separador.setX(xSeparador);
    if (d.enLinea) this.gente.setText(`● ${d.gente} aquí`).setColor(UI.exito);
    else this.gente.setText("○ sin conexión").setColor(UI.tenue);
    this.gente.setX(xSeparador + 8);
    this.chipSala.setSize(this.gente.x + this.gente.width + 9 - MARGEN, ALTO);

    const hay = d.saldo !== null;
    this.monedas.setText(hay ? String(d.saldo) : "");
    const w = 7 + this.iconoMonedas.width + 5 + this.monedas.width + 8;
    const x0 = this.finMonedas - w;
    this.chipMonedas.setX(x0).setSize(w, ALTO);
    this.iconoMonedas.setX(x0 + 7);
    this.monedas.setX(x0 + 7 + this.iconoMonedas.width + 5);
    for (const o of [this.chipMonedas, this.monedas, this.iconoMonedas]) o.setVisible(hay);
  }

  /** Atenúa el botón de zoom que ya no puede ir más allá */
  nivelZoom(nivel: number, min: number, max: number): void {
    for (const o of this.zoomMas.objetos) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(nivel >= max ? 0.35 : 1);
    for (const o of this.zoomMenos.objetos) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(nivel <= min ? 0.35 : 1);
  }

  /** Teclas con su marco, alineadas a la derecha hasta `derecha`; se desvanecen solas */
  private crearChuleta(derecha: number, abajo: number): void {
    const s = this.scene;
    const partes: [string, string][] = [
      ["Clic", "andar"],
      ["WASD", "mover"],
      ["Enter", "chat"],
      ["C", "vestidor"],
      ["Rueda", "zoom"],
    ];
    const ALTO_TECLA = 16;
    const y = abajo - ALTO_TECLA;
    const yTexto = yCentrada(y, ALTO_TECLA);
    // Se mide primero para alinearla a la derecha
    const trozos = partes.map(([t, d]) => {
      const tecla = texto(s, 0, yTexto, t);
      const marco = pieza(s, "tecla", 0, y, tecla.width + 10, ALTO_TECLA);
      const desc = texto(s, 0, yTexto, d, { color: UI.suave, sombra: true });
      return { tecla, marco, desc };
    });
    const ancho = trozos.reduce((a, t) => a + t.marco.width + 5 + t.desc.width, 0) + (trozos.length - 1) * 12;
    let x = derecha - ancho;
    for (const { tecla, marco, desc } of trozos) {
      marco.setX(x);
      tecla.setX(x + 5);
      desc.setX(x + marco.width + 5);
      x += marco.width + 5 + desc.width + 12;
      for (const o of [marco, tecla, desc]) {
        o.setScrollFactor(0).setDepth(LAYER.UI_HUD + (o === marco ? 0 : 1));
        this.chuleta.push(o);
      }
    }
    s.tweens.add({
      targets: this.chuleta,
      alpha: 0,
      delay: CHULETA_MS,
      duration: 1200,
      onComplete: () => {
        for (const o of this.chuleta) o.destroy();
        this.chuleta = [];
      },
    });
  }
}
