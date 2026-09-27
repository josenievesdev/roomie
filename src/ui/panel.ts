import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { boton, icono, pieza, texto, UI, UI_HEX, yCentrada } from "./kit";
import { medidas } from "./pantalla";

// Panel base: el velo, el panel centrado a la medida de la pantalla, su
// título y el botón de cerrar. Lo usan la tienda y la mochila. Tocar fuera
// del panel lo cierra (en el móvil es lo natural).
//
// Objetos sueltos con scrollFactor(0), nunca un Container (ver CLAUDE.md).

export type OpcionesPanel = {
  titulo: string;
  anchoMax: number;
  altoMax: number;
  alCerrar: () => void;
};

type Fijable = Phaser.GameObjects.GameObject & {
  setScrollFactor(v: number): Fijable;
  setDepth(v: number): Fijable;
};

export class Panel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Lo de dentro, sin la cabecera */
  readonly cuerpo: { x: number; y: number; w: number; h: number };
  /** Borde derecho libre de la cabecera (a la izquierda del botón de cerrar) */
  readonly finCabecera: number;
  private scene: Phaser.Scene;
  private fijos: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, o: OpcionesPanel) {
    this.scene = scene;
    const m = medidas();
    const W = scene.scale.width;
    const H = scene.scale.height;
    this.w = Math.min(o.anchoMax, W - 16);
    this.h = Math.min(o.altoMax, H - 16);
    this.x = Math.round((W - this.w) / 2);
    this.y = Math.round((H - this.h) / 2);

    // Velo: se come los toques (nada de andar detrás) y, tocado, cierra
    const velo = this.poner(scene.add.rectangle(W / 2, H / 2, W, H, UI_HEX.velo, 0.55).setInteractive(), 0);
    velo.on("pointerup", () => o.alCerrar());
    this.poner(pieza(scene, "panel", this.x, this.y, this.w, this.h).setInteractive(), 1);

    const cab = m.tactil ? 36 : 30;
    this.poner(icono(scene, "rombo", this.x + 12, this.y + Math.round(cab / 2) - 2), 2);
    this.poner(texto(scene, this.x + 26, yCentrada(this.y + 2, cab), o.titulo, { color: UI.titulo }), 2);
    const lado = m.tactil ? 28 : 20;
    const cerrar = boton(scene, this.x + this.w - 8 - lado, this.y + Math.round((cab - lado) / 2) + 1, lado, lado, "", () => o.alCerrar(), {
      icono: "cerrar",
      capa: LAYER.UI_PANEL + 3,
    });
    this.fijos.push(...cerrar.objetos);
    this.finCabecera = this.x + this.w - 8 - lado - 8;
    this.cuerpo = { x: this.x + 12, y: this.y + cab + 4, w: this.w - 24, h: this.h - cab - 4 - 12 };
  }

  /** Pone un objeto del panel (con su scrollFactor y su capa) y lo apunta para destruirlo */
  poner<T extends Phaser.GameObjects.GameObject>(o: T, capa = 2, lista: Phaser.GameObjects.GameObject[] = this.fijos): T {
    (o as unknown as Fijable).setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
    lista.push(o);
    return o;
  }

  destroy(): void {
    for (const o of this.fijos) o.destroy();
    this.fijos = [];
  }
}
