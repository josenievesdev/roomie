import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { FURNITURE, isFurniture } from "../state/furniture-catalog";
import type { ArticuloTienda, CosaMochila } from "../net/protocol";
import { anchoTexto, boton, pieza, texto, UI, yCentrada } from "./kit";
import { medidas } from "./pantalla";
import { Panel } from "./panel";
import { ALTO_MINI, ANCHO_TARJETA, miniatura } from "./tienda";

// La mochila: lo tuyo que no está puesto en ninguna parte. Agrupado por
// tipo ("Sofá ×2"), con "Poner" (en tu casa) y "Vender" (la tienda te lo
// recompra por la mitad). Vacía, te manda a la tienda.
//
// Vender pide dos toques, como comprar en la tienda: un roce no se lleva tu sofá.

/** Cuánto espera "¿Seguro?" a que se confirme antes de volver a "Vender" */
const CONFIRMAR_MS = 3000;

export type OpcionesMochila = {
  cosas: CosaMochila[];
  /** Estás en tu casa: se puede poner */
  enCasa: boolean;
  /** El catálogo, para saber cuánto te dan al vender */
  articulos: ArticuloTienda[];
  alPoner: (cosa: CosaMochila) => void;
  alVender: (cosa: CosaMochila) => void;
  alTienda: () => void;
  alCerrar: () => void;
};

type Grupo = { code: string; ids: string[] };

export class Mochila {
  private scene: Phaser.Scene;
  private o: OpcionesMochila;
  private panel: Panel;
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private pagina = 0;
  /** El tipo de cosa que espera el segundo toque para venderse */
  private confirmando: string | null = null;
  private vivo = true;

  constructor(scene: Phaser.Scene, o: OpcionesMochila) {
    this.scene = scene;
    this.o = o;
    this.panel = new Panel(scene, { titulo: "Mochila", anchoMax: 640, altoMax: 600, alCerrar: o.alCerrar });
    this.pintar();
  }

  destroy(): void {
    this.vivo = false;
    for (const d of this.dinamicos) d.destroy();
    this.dinamicos = [];
    this.panel.destroy();
  }

  /** Cambió lo que hay (una compra, una venta, algo puesto o guardado) */
  actualizar(cosas: CosaMochila[]): void {
    this.o = { ...this.o, cosas };
    this.confirmando = null;
    this.pintar();
  }

  private poner<T extends Phaser.GameObjects.GameObject>(o: T, capa = 2): T {
    return this.panel.poner(o, capa, this.dinamicos);
  }

  private pintar(): void {
    for (const d of this.dinamicos) d.destroy();
    this.dinamicos = [];
    const s = this.scene;
    const m = medidas();
    const c = this.panel.cuerpo;

    // Agrupado por tipo, en el orden en que llegaron
    const grupos: Grupo[] = [];
    for (const cosa of this.o.cosas) {
      const g = grupos.find((x) => x.code === cosa.code);
      if (g) g.ids.push(cosa.id);
      else grupos.push({ code: cosa.code, ids: [cosa.id] });
    }

    if (grupos.length === 0) {
      const t = texto(s, 0, c.y + 30, "Tu mochila está vacía.\nPasa por la tienda a por algo para tu casa.", {
        color: UI.suave,
        alinear: "center",
        interlineado: 3,
      });
      this.poner(t.setX(Math.round(c.x + (c.w - t.width) / 2)), 3);
      const bw = 150;
      const b = boton(s, c.x + (c.w - bw) / 2, c.y + 30 + t.height + 16, bw, m.fila + 4, "Ir a la tienda", () => this.o.alTienda(), {
        primario: true,
        icono: "bolsa",
        capa: LAYER.UI_PANEL + 3,
      });
      this.dinamicos.push(...b.objetos);
      return;
    }

    if (!this.o.enCasa) {
      const t = texto(s, c.x, c.y, "Para poner algo, ve a tu casa.", { color: UI.suave });
      this.poner(t, 3);
    }
    const y = c.y + (this.o.enCasa ? 0 : 20);

    const gap = 8;
    // Como en la tienda: columnas de 100 px como mínimo, estiradas hasta llenar el ancho
    const cols = Math.max(1, Math.floor((c.w + gap) / (ANCHO_TARJETA + gap)));
    const cw = Math.floor((c.w - (cols - 1) * gap) / cols);
    const ch = 6 + ALTO_MINI + 2 + 16 + 2 + m.fila * 2 + 4 + 6;
    const altoPie = m.fila + 8;
    const filas = Math.max(1, Math.floor((c.y + c.h - y - altoPie + gap) / (ch + gap)));
    const porPagina = cols * filas;
    const paginas = Math.max(1, Math.ceil(grupos.length / porPagina));
    this.pagina = Math.min(this.pagina, paginas - 1);
    const x0 = c.x;
    grupos.slice(this.pagina * porPagina, (this.pagina + 1) * porPagina).forEach((g, i) => {
      this.tarjeta(g, x0 + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + gap), cw, ch);
    });

    if (paginas > 1) {
      const yp = c.y + c.h - m.fila;
      const bw = m.fila + 12;
      const ant = boton(s, c.x + c.w / 2 - bw - 40, yp, bw, m.fila, "◀", () => this.irPagina(-1), {
        capa: LAYER.UI_PANEL + 3,
        apagado: this.pagina === 0,
      });
      const sig = boton(s, c.x + c.w / 2 + 40, yp, bw, m.fila, "▶", () => this.irPagina(1), {
        capa: LAYER.UI_PANEL + 3,
        apagado: this.pagina >= paginas - 1,
      });
      this.dinamicos.push(...ant.objetos, ...sig.objetos);
      const t = texto(s, 0, yCentrada(yp, m.fila), `${this.pagina + 1} / ${paginas}`, { color: UI.suave });
      this.poner(t.setX(Math.round(c.x + c.w / 2 - t.width / 2)), 3);
    }
  }

  private tarjeta(g: Grupo, x: number, y: number, w: number, h: number): void {
    const s = this.scene;
    const m = medidas();
    this.poner(pieza(s, "campo", x, y, w, h), 2);
    const mini = miniatura(s, g.code, x + w / 2, y + 6 + ALTO_MINI / 2, w - 8, ALTO_MINI);
    if (mini) this.poner(mini, 3);
    // El nombre de la tienda (el del catálogo, si no se vende) y cuántos hay
    const art = this.o.articulos.find((a) => a.code === g.code);
    let nombre = art?.nombre ?? (isFurniture(g.code) ? FURNITURE[g.code].nombre : g.code);
    const cuantos = g.ids.length > 1 ? ` ×${g.ids.length}` : "";
    while (anchoTexto(nombre + cuantos) > w - 10 && nombre.length > 3) nombre = nombre.slice(0, -2) + "…";
    const tn = texto(s, 0, y + 6 + ALTO_MINI + 2, nombre + cuantos);
    this.poner(tn.setX(Math.round(x + (w - tn.width) / 2)), 3);

    const cosa = { id: g.ids[0], code: g.code };
    const yb = y + 6 + ALTO_MINI + 20;
    const poner = boton(s, x + 6, yb, w - 12, m.fila, "Poner", () => this.o.alPoner(cosa), {
      primario: true,
      capa: LAYER.UI_PANEL + 3,
      apagado: !this.o.enCasa,
    });
    // Lo que te dan: la mitad de lo que cuesta en la tienda. Lo que no se
    // vende (las cajas de la mudanza) sólo se puede tirar. Sin catálogo aún,
    // no se promete ninguna cifra.
    const recibe = art ? Math.floor(art.precio / 2) : 0;
    const etiqueta = this.o.articulos.length === 0 ? "Vender" : recibe > 0 ? `Vender +${recibe}` : "Tirar";
    const seguro = this.confirmando === g.code;
    const vender = boton(s, x + 6, yb + m.fila + 4, w - 12, m.fila, seguro ? "¿Seguro?" : etiqueta, () => this.pulsarVender(cosa), {
      primario: seguro,
      capa: LAYER.UI_PANEL + 3,
    });
    this.dinamicos.push(...poner.objetos, ...vender.objetos);
  }

  private pulsarVender(cosa: CosaMochila): void {
    if (this.confirmando === cosa.code) {
      this.confirmando = null;
      this.o.alVender(cosa);
      this.pintar();
      return;
    }
    this.confirmando = cosa.code;
    this.pintar();
    this.scene.time.delayedCall(CONFIRMAR_MS, () => {
      if (!this.vivo || this.confirmando !== cosa.code) return;
      this.confirmando = null;
      this.pintar();
    });
  }

  private irPagina(paso: number): void {
    this.pagina = Math.max(0, this.pagina + paso);
    this.confirmando = null;
    this.pintar();
  }
}
