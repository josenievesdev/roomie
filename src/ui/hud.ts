import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { boton, icono, pieza, texto, UI } from "./kit";

// HUD: lo que está siempre en pantalla. Arriba a la izquierda, dónde estás y
// cuánta gente hay; arriba a la derecha, tus monedas y los botones (chat,
// vestidor, perfil); abajo a la derecha, una chuleta de teclas que se va
// sola al rato.

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
};

const MARGEN = 8;
const ALTO_BOTON = 36;
/** Cuánto se queda la chuleta de teclas antes de irse */
const CHULETA_MS = 14000;

export class Hud {
  private scene: Phaser.Scene;
  private chipSala: Phaser.GameObjects.NineSlice;
  private nombreSala: Phaser.GameObjects.Text;
  private linea: Phaser.GameObjects.Text;
  private chipMonedas: Phaser.GameObjects.NineSlice;
  private monedas: Phaser.GameObjects.Text;
  private iconoMonedas: Phaser.GameObjects.Image;
  private botones: Phaser.GameObjects.GameObject[] = [];
  private chuleta: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, acciones: AccionesHud) {
    this.scene = scene;
    const fijo = <T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(
      o: T,
      capa = 0,
    ): T => o.setScrollFactor(0).setDepth(LAYER.UI_HUD + capa);

    // ---- Dónde estás
    this.chipSala = fijo(pieza(scene, "chip", MARGEN, MARGEN, 200, 44));
    fijo(icono(scene, "casa", MARGEN + 8, MARGEN + 8), 1);
    this.nombreSala = fijo(texto(scene, MARGEN + 36, MARGEN + 6, "", { tam: 2, color: UI.titulo }), 1);
    this.linea = fijo(texto(scene, MARGEN + 36, MARGEN + 26, "", { tam: 1, color: UI.exito }), 1);

    // ---- Botones (de derecha a izquierda)
    const ancho = 960;
    let x = ancho - MARGEN;
    const nuevo = (etiqueta: string, ico: string, anchoBoton: number, accion: () => void) => {
      x -= anchoBoton;
      const b = boton(scene, x, MARGEN, anchoBoton, ALTO_BOTON, etiqueta, accion, { icono: ico, capa: LAYER.UI_HUD });
      this.botones.push(...b.objetos);
      x -= 6;
    };
    nuevo("Perfil", "persona", 100, acciones.perfil);
    nuevo("Vestidor", "camiseta", 124, acciones.vestidor);
    nuevo("Chat", "chat", 88, acciones.chat);

    // ---- Monedas
    this.chipMonedas = fijo(pieza(scene, "chip", x - 90, MARGEN, 90, ALTO_BOTON));
    this.iconoMonedas = fijo(icono(scene, "moneda", x - 82, MARGEN + 9), 1);
    this.monedas = fijo(texto(scene, x - 58, MARGEN + 10, "", { tam: 2, color: UI.titulo }), 1);

    this.crearChuleta();
  }

  actualizar(d: DatosHud): void {
    this.nombreSala.setText(d.sala);
    if (!d.enLinea) {
      this.linea.setText("○ Sin conexión").setColor("#8a8aa8");
    } else {
      this.linea.setText(`● ${d.gente} ${d.gente === 1 ? "persona" : "personas"} aquí`).setColor(UI.exito);
    }
    const anchoSala = Math.max(this.nombreSala.width, this.linea.width) + 36 + 14;
    this.chipSala.setSize(Math.max(120, anchoSala), 44);

    const hay = d.saldo !== null;
    this.monedas.setText(hay ? String(d.saldo) : "");
    for (const o of [this.chipMonedas, this.monedas, this.iconoMonedas]) o.setVisible(hay);
  }

  /** Teclas con su marco, al pie; se desvanecen solas */
  private crearChuleta(): void {
    const s = this.scene;
    const partes: [string, string][] = [
      ["Clic", "caminar"],
      ["WASD", "mover"],
      ["Enter", "chat"],
      ["C", "vestidor"],
    ];
    // Se mide primero para alinearla a la derecha
    const trozos: { tecla: Phaser.GameObjects.Text; marco: Phaser.GameObjects.NineSlice; desc: Phaser.GameObjects.Text }[] = [];
    let ancho = 0;
    for (const [t, d] of partes) {
      const tecla = texto(s, 0, 0, t, { tam: 1, sombra: false });
      const marco = pieza(s, "tecla", 0, 0, tecla.width + 12, 22);
      const desc = texto(s, 0, 0, d, { tam: 1, color: UI.suave });
      trozos.push({ tecla, marco, desc });
      ancho += marco.width + 6 + desc.width + 14;
    }
    const y = 540 - MARGEN - 22;
    let x = 960 - MARGEN - ancho;
    for (const { tecla, marco, desc } of trozos) {
      marco.setPosition(x, y);
      tecla.setPosition(x + 6, y + 6);
      desc.setPosition(x + marco.width + 6, y + 7);
      x += marco.width + 6 + desc.width + 14;
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
