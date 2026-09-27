import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { ROOM_THEMES } from "../render/theme";
import { texturaMueble } from "../entities/furniture";
import { FURNITURE, isFurniture } from "../state/furniture-catalog";
import type { ArticuloTienda, CategoriaTienda, Saldos } from "../net/protocol";
import { anchoTexto, boton, icono, pieza, texto, UI, yCentrada } from "./kit";
import { medidas } from "./pantalla";
import { Panel } from "./panel";

// La tienda: secciones en pestañas y una rejilla de tarjetas (miniatura,
// nombre, precio y "Comprar"). Si hay más de las que caben, se pasa de
// página. Lo que se ve lo manda el servidor (`tienda`), y quien decide si
// se puede comprar también: aquí sólo se atenúa lo que no te llega.
//
// Comprar pide dos toques ("Comprar" y luego "¿Seguro?"): con el dedo es
// fácil tocar sin querer, y el dinero de un niño no se gasta por un roce.

export const SECCIONES: { id: CategoriaTienda; titulo: string }[] = [
  { id: "salon", titulo: "Salón" },
  { id: "dormitorio", titulo: "Dormitorio" },
  { id: "deco", titulo: "Decoración" },
  { id: "pared", titulo: "Pared" },
  { id: "fiesta", titulo: "Fiesta" },
];

export type OpcionesTienda = {
  articulos: ArticuloTienda[];
  saldos: Saldos;
  /** Sección con la que se abre (al rehacerla tras girar el móvil, la que estaba) */
  seccion?: CategoriaTienda;
  alComprar: (code: string) => void;
  alCerrar: () => void;
};

/** Cuánto espera "¿Seguro?" a que se confirme antes de volver a "Comprar" */
const CONFIRMAR_MS = 3000;

/** Alto del hueco de la miniatura en las tarjetas: cabe a tamaño real hasta el armario */
export const ALTO_MINI = 92;
/** Ancho mínimo de una tarjeta (la cama, que es lo más ancho, cabe a tamaño real) */
export const ANCHO_TARJETA = 100;

/**
 * Miniatura de un mueble dentro de una caja: a tamaño real si cabe y, si no,
 * a la mitad (el pixel art sólo se escala por números enteros). Con los
 * colores del piso, que es donde va a ir.
 */
export function miniatura(
  scene: Phaser.Scene,
  code: string,
  cx: number,
  cy: number,
  ancho: number,
  alto: number,
): Phaser.GameObjects.Image | null {
  const pared = isFurniture(code) && FURNITURE[code].pared;
  // Una alfombra suelta, con su cenefa entera
  const sufijo = pared ? "der" : isFurniture(code) && FURNITURE[code].plano ? 15 : undefined;
  const t = texturaMueble(scene, code, sufijo, ROOM_THEMES.piso);
  if (!t) return null;
  const escala = t.w <= ancho && t.h <= alto ? 1 : 0.5;
  return scene.add.image(Math.round(cx), Math.round(cy), t.key).setOrigin(0.5).setScale(escala);
}

export class Tienda {
  private scene: Phaser.Scene;
  private o: OpcionesTienda;
  private panel: Panel;
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private seccion: CategoriaTienda;
  private pagina = 0;
  private saldos: Saldos;
  /** El artículo que espera el segundo toque ("¿Seguro?") */
  private confirmando: string | null = null;
  private vivo = true;

  constructor(scene: Phaser.Scene, o: OpcionesTienda) {
    this.scene = scene;
    this.o = o;
    this.saldos = o.saldos;
    const hay = (id: CategoriaTienda) => o.articulos.some((a) => a.categoria === id);
    this.seccion = o.seccion && hay(o.seccion) ? o.seccion : (SECCIONES.find((s) => hay(s.id))?.id ?? "salon");
    this.panel = new Panel(scene, { titulo: "Tienda", anchoMax: 640, altoMax: 600, alCerrar: o.alCerrar });
    this.pintar();
  }

  /** La sección que se está viendo */
  get seccionActual(): CategoriaTienda {
    return this.seccion;
  }

  destroy(): void {
    this.vivo = false;
    for (const d of this.dinamicos) d.destroy();
    this.dinamicos = [];
    this.panel.destroy();
  }

  /** Cambió el dinero (una compra): se rehace para atenuar lo que ya no llega */
  actualizarSaldo(s: Saldos): void {
    this.saldos = s;
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

    // Tu dinero, en la cabecera
    const txt = texto(s, 0, 0, String(this.saldos.monedas), { color: UI.titulo });
    const wd = 7 + 9 + 5 + txt.width + 8;
    const xd = this.panel.finCabecera - wd;
    const yd = this.panel.y + (m.tactil ? 7 : 5);
    this.poner(pieza(s, "chip", xd, yd, wd, 22), 2);
    this.poner(icono(s, "moneda", xd + 7, yd + 7), 3);
    this.poner(txt.setPosition(xd + 7 + 9 + 5, yCentrada(yd, 22)), 3);

    // Pestañas de las secciones (saltan de fila si no caben)
    let x = c.x;
    let y = c.y;
    for (const sec of SECCIONES) {
      if (!this.o.articulos.some((a) => a.categoria === sec.id)) continue;
      const w = anchoTexto(sec.titulo) + 16;
      if (x + w > c.x + c.w) {
        x = c.x;
        y += m.fila + 4;
      }
      const b = boton(s, x, y, w, m.fila, sec.titulo, () => this.cambiar(sec.id), {
        primario: sec.id === this.seccion,
        capa: LAYER.UI_PANEL + 3,
      });
      this.dinamicos.push(...b.objetos);
      x += w + 4;
    }
    y += m.fila + 8;

    // La rejilla de tarjetas
    const lista = this.o.articulos.filter((a) => a.categoria === this.seccion);
    const gap = 8;
    // Tantas columnas como quepan de 100 px, y las tarjetas se estiran hasta
    // llenar el ancho (en un móvil no queda un hueco a la derecha)
    const cols = Math.max(1, Math.floor((c.w + gap) / (ANCHO_TARJETA + gap)));
    const cw = Math.floor((c.w - (cols - 1) * gap) / cols);
    const ch = 6 + ALTO_MINI + 2 + 16 + 16 + 4 + m.fila + 6;
    const altoPie = m.fila + 8;
    const filas = Math.max(1, Math.floor((c.y + c.h - y - altoPie + gap) / (ch + gap)));
    const porPagina = cols * filas;
    const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
    this.pagina = Math.min(this.pagina, paginas - 1);
    // Pegada a la izquierda, como las pestañas
    const x0 = c.x;
    lista.slice(this.pagina * porPagina, (this.pagina + 1) * porPagina).forEach((a, i) => {
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + gap);
      this.tarjeta(a, cx, cy, cw, ch);
    });

    // Páginas
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

  private tarjeta(a: ArticuloTienda, x: number, y: number, w: number, h: number): void {
    const s = this.scene;
    const m = medidas();
    this.poner(pieza(s, "campo", x, y, w, h), 2);
    const mini = miniatura(s, a.code, x + w / 2, y + 6 + ALTO_MINI / 2, w - 8, ALTO_MINI);
    if (mini) this.poner(mini, 3);
    // Nombre en una línea (si no cabe, se corta)
    let nombre = a.nombre;
    while (anchoTexto(nombre) > w - 10 && nombre.length > 3) nombre = nombre.slice(0, -2) + "…";
    const tn = texto(s, 0, y + 6 + ALTO_MINI + 2, nombre);
    this.poner(tn.setX(Math.round(x + (w - tn.width) / 2)), 3);
    // Precio
    const tp = texto(s, 0, 0, a.precio === 0 ? "Gratis" : String(a.precio), { color: UI.titulo });
    const wp = (a.moneda === "monedas" ? 9 + 4 : 0) + tp.width;
    const xp = Math.round(x + (w - wp) / 2);
    const yp = y + 6 + ALTO_MINI + 18;
    if (a.moneda === "monedas") this.poner(icono(s, "moneda", xp, yp + 3), 3);
    else tp.setText(`◆ ${a.precio}`).setColor(UI.acento);
    this.poner(tp.setPosition(a.moneda === "monedas" ? xp + 13 : xp, yp - 3 + 1), 3);
    // Comprar (atenuado si no llega; el servidor decide igualmente). El
    // primer toque pregunta; el segundo, compra.
    const llega = a.moneda === "monedas" ? this.saldos.monedas >= a.precio : this.saldos.creditos >= a.precio;
    const seguro = this.confirmando === a.code;
    const b = boton(s, x + 6, y + h - 6 - m.fila, w - 12, m.fila, seguro ? "¿Seguro?" : "Comprar", () => this.pulsarComprar(a.code), {
      primario: seguro || llega,
      capa: LAYER.UI_PANEL + 3,
      apagado: !llega,
    });
    this.dinamicos.push(...b.objetos);
  }

  private pulsarComprar(code: string): void {
    if (this.confirmando === code) {
      this.confirmando = null;
      this.o.alComprar(code);
      this.pintar();
      return;
    }
    this.confirmando = code;
    this.pintar();
    // Si no se confirma, vuelve a "Comprar" solo
    this.scene.time.delayedCall(CONFIRMAR_MS, () => {
      if (!this.vivo || this.confirmando !== code) return;
      this.confirmando = null;
      this.pintar();
    });
  }

  private cambiar(sec: CategoriaTienda): void {
    if (sec === this.seccion) return;
    this.seccion = sec;
    this.pagina = 0;
    this.confirmando = null;
    this.pintar();
  }

  private irPagina(paso: number): void {
    this.pagina = Math.max(0, this.pagina + paso);
    this.confirmando = null;
    this.pintar();
  }
}
