import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { boton, icono, pieza, texto, UI, UI_HEX, yCentrada, type Boton } from "./kit";
import { esEstrecha, medidas } from "./pantalla";

// HUD: lo que está siempre en pantalla, pequeño y en los bordes para que
// mande la sala.
//
// - Arriba a la izquierda, dónde estás y cuánta gente hay.
// - Arriba a la derecha, tus monedas (y tus créditos, si tienes).
// - Los botones (casa, tienda, mochila, chat, vestidor, perfil): en una
//   pantalla ancha, arriba a la derecha; en el móvil o en una ventana
//   estrecha, en una barra abajo, al alcance del pulgar y más grandes.
//   Estando en tu casa, el de la casa es el de decorarla.
// - Abajo a la derecha, el zoom (con el dedo se pellizca) y una chuleta de
//   controles que se va sola al rato.
//
// Todo se coloca con el tamaño de la pantalla de ese momento: al girar el
// móvil, `recolocar()` lo rehace.

export type DatosHud = {
  /** Nombre bonito de la sala ("Plaza de la Llave"), no su id */
  sala: string;
  enLinea: boolean;
  /** Gente en la sala contándote a ti */
  gente: number;
  saldo: number | null;
  creditos: number;
};

export type AccionesHud = {
  /** Ir a tu casa (o, si ya estás en ella, decorarla) */
  casa: () => void;
  tienda: () => void;
  mochila: () => void;
  chat: () => void;
  vestidor: () => void;
  perfil: () => void;
  /** +1 acerca, -1 aleja */
  zoom: (paso: number) => void;
};

/** Cuánto se queda la chuleta de controles antes de irse */
const CHULETA_MS = 14000;
/**
 * Hasta cuándo se ve la chuleta (hora de `Date.now()`; null = aún no se ha
 * entrado al mundo). Sale una vez por visita: la cuenta empieza al entrar y
 * sigue aunque se cruce una puerta (al entrar, el juego te lleva a casa en
 * un segundo, y si cada sala empezara de cero se vería cada vez o nunca).
 */
let chuletaHasta: number | null = null;

type Fijable = Phaser.GameObjects.GameObject & {
  setScrollFactor(v: number): Fijable;
  setDepth(v: number): Fijable;
};

export class Hud {
  private scene: Phaser.Scene;
  private acciones: AccionesHud;
  private objetos: Phaser.GameObjects.GameObject[] = [];
  private datos: DatosHud | null = null;
  private chipSala!: Phaser.GameObjects.NineSlice;
  private nombreSala!: Phaser.GameObjects.Text;
  private separador!: Phaser.GameObjects.Rectangle;
  private gente!: Phaser.GameObjects.Text;
  private chipMonedas!: Phaser.GameObjects.NineSlice;
  private iconoMonedas!: Phaser.GameObjects.Image;
  private monedas!: Phaser.GameObjects.Text;
  private chipCreditos!: Phaser.GameObjects.NineSlice;
  private textoCreditos!: Phaser.GameObjects.Text;
  /** Borde derecho de las pastillas de dinero (crecen hacia la izquierda) */
  private finDinero = 0;
  private altoArriba = 24;
  private zoomMas: Boton | null = null;
  private zoomMenos: Boton | null = null;
  private zoom = { nivel: 0, min: 0, max: 0 };
  /** Alto que ocupa la barra de botones de abajo (0 si van arriba) */
  private abajo = 0;
  private chuleta: Phaser.GameObjects.GameObject[] = [];
  private chuletaIda = false;

  private enCasa: boolean;
  /** Se fue la chuleta: lo que estaba encima (el chat) puede bajar */
  private alIrseChuleta?: () => void;

  constructor(scene: Phaser.Scene, acciones: AccionesHud, o: { enCasa: boolean; alIrseChuleta?: () => void }) {
    this.scene = scene;
    this.acciones = acciones;
    this.enCasa = o.enCasa;
    this.alIrseChuleta = o.alIrseChuleta;
    // La chuleta sólo al entrar al juego; al recolocar, si ya se fue, no vuelve
    this.chuletaIda = chuletaHasta !== null && Date.now() >= chuletaHasta;
    this.montar();
    if (chuletaHasta !== null && !this.chuletaIda) this.programarChuleta();
  }

  /** Ya se está en el mundo: empieza la cuenta de la chuleta (sólo la primera vez) */
  arrancarChuleta(): void {
    if (chuletaHasta !== null) return;
    chuletaHasta = Date.now() + CHULETA_MS;
    this.programarChuleta();
  }

  private programarChuleta(): void {
    const falta = Math.max(0, (chuletaHasta ?? 0) - Date.now());
    this.scene.time.delayedCall(falta, () => this.irseChuleta());
  }

  /** Lo que ocupa abajo la barra de botones: el chat y los menús se ponen encima */
  get altoInferior(): number {
    return this.abajo;
  }

  /** Lo que ocupa arriba el HUD (la pastilla de la sala) */
  get altoSuperior(): number {
    return 8 + this.altoArriba;
  }

  /** Lo que ocupa la chuleta encima de la barra de abajo mientras se ve (0 si no está ahí) */
  get altoChuleta(): number {
    return this.chuleta.length > 0 && this.abajo > 0 ? 16 + 8 : 0;
  }

  /** Rehace todo con el tamaño de pantalla de ahora (al girar el móvil) */
  recolocar(): void {
    this.quitar();
    this.montar();
    if (this.datos) this.actualizar(this.datos);
    this.nivelZoom(this.zoom.nivel, this.zoom.min, this.zoom.max);
  }

  destroy(): void {
    this.quitar();
  }

  private quitar(): void {
    for (const o of [...this.objetos, ...this.chuleta]) o.destroy();
    this.objetos = [];
    this.chuleta = [];
    this.zoomMas = null;
    this.zoomMenos = null;
  }

  private fijo<T extends Phaser.GameObjects.GameObject>(o: T, capa = 0): T {
    (o as unknown as Fijable).setScrollFactor(0).setDepth(LAYER.UI_HUD + capa);
    this.objetos.push(o);
    return o;
  }

  private montar(): void {
    const s = this.scene;
    const m = medidas();
    const W = s.scale.width;
    const H = s.scale.height;
    const abajo = m.tactil || esEstrecha(W);
    const M = m.margen;
    const alto = m.tactil ? 28 : 24;
    this.altoArriba = alto;
    const yTexto = yCentrada(M, alto);

    // ---- Dónde estás: casa, nombre de la sala | gente
    this.chipSala = this.fijo(pieza(s, "chip", M, M, 120, alto));
    this.fijo(icono(s, "casa", M + 7, M + Math.round((alto - 11) / 2)), 1);
    this.nombreSala = this.fijo(texto(s, M + 24, yTexto, "", { color: UI.titulo }), 1);
    this.separador = this.fijo(s.add.rectangle(0, M + 6, 1, alto - 12, UI_HEX.borde).setOrigin(0, 0), 1);
    this.gente = this.fijo(texto(s, 0, yTexto, ""), 1);

    // ---- Los botones
    const botones: [string, string, () => void][] = [
      this.enCasa ? ["decorar", "Decorar tu casa", this.acciones.casa] : ["casa", "Ir a tu casa", this.acciones.casa],
      ["bolsa", "Tienda · T", this.acciones.tienda],
      ["mochila", "Mochila · M", this.acciones.mochila],
      ["chat", "Chat · Enter", this.acciones.chat],
      ["camiseta", "Vestidor · C", this.acciones.vestidor],
      ["persona", "Perfil", this.acciones.perfil],
    ];
    const b = m.boton;
    const h = m.hueco;
    if (abajo) {
      // Una barra centrada abajo, al alcance del pulgar
      const pad = 5;
      const ancho = botones.length * b + (botones.length - 1) * h + pad * 2;
      const x0 = Math.round(W / 2 - ancho / 2);
      const y0 = H - M - b - pad * 2;
      this.fijo(pieza(s, "chip", x0, y0, ancho, b + pad * 2));
      botones.forEach(([ico, , accion], i) => {
        const bt = boton(s, x0 + pad + i * (b + h), y0 + pad, b, b, "", accion, { icono: ico, capa: LAYER.UI_HUD + 1 });
        this.objetos.push(...bt.objetos);
      });
      this.abajo = M + b + pad * 2;
      this.finDinero = W - M;
    } else {
      // Arriba a la derecha, de derecha a izquierda
      let x = W - M;
      for (const [ico, pista, accion] of [...botones].reverse()) {
        x -= b;
        const bt = boton(s, x, M, b, alto, "", accion, { icono: ico, capa: LAYER.UI_HUD, pista });
        this.objetos.push(...bt.objetos);
        x -= h;
      }
      this.abajo = 0;
      this.finDinero = x - h;
    }

    // ---- El dinero: monedas y (si tienes) créditos
    this.chipMonedas = this.fijo(pieza(s, "chip", 0, M, 40, alto));
    this.iconoMonedas = this.fijo(icono(s, "moneda", 0, M + Math.round((alto - 9) / 2)), 1);
    this.monedas = this.fijo(texto(s, 0, yTexto, "", { color: UI.titulo }), 1);
    this.chipCreditos = this.fijo(pieza(s, "chip", 0, M, 40, alto));
    this.textoCreditos = this.fijo(texto(s, 0, yTexto, "", { color: UI.acento }), 1);

    // ---- El zoom, abajo a la derecha (con el dedo se pellizca)
    if (!m.tactil) {
      const zx = W - M - b;
      const zy = H - this.abajo - M - b;
      this.zoomMenos = boton(s, zx, zy, b, b, "", () => this.acciones.zoom(-1), {
        icono: "menos",
        capa: LAYER.UI_HUD,
        pista: "Alejar · −",
        ladoPista: "izquierda",
      });
      this.zoomMas = boton(s, zx, zy - b - h, b, b, "", () => this.acciones.zoom(1), {
        icono: "mas",
        capa: LAYER.UI_HUD,
        pista: "Acercar · +",
        ladoPista: "izquierda",
      });
      this.objetos.push(...this.zoomMenos.objetos, ...this.zoomMas.objetos);
    }

    if (!this.chuletaIda) this.crearChuleta(m.tactil, abajo);
  }

  actualizar(d: DatosHud): void {
    this.datos = d;
    this.nombreSala.setText(d.sala);
    const xSeparador = this.nombreSala.x + this.nombreSala.width + 8;
    this.separador.setX(xSeparador);
    if (d.enLinea) this.gente.setText(`● ${d.gente} aquí`).setColor(UI.exito);
    else this.gente.setText("○ sin conexión").setColor(UI.tenue);
    this.gente.setX(xSeparador + 8);
    this.chipSala.setSize(this.gente.x + this.gente.width + 9 - 8, this.altoArriba);

    // Monedas, pegadas a la derecha; los créditos, a su izquierda si hay
    const hay = d.saldo !== null;
    this.monedas.setText(hay ? String(d.saldo) : "");
    const w = 7 + this.iconoMonedas.width + 5 + this.monedas.width + 8;
    const x0 = this.finDinero - w;
    this.chipMonedas.setX(x0).setSize(w, this.altoArriba);
    this.iconoMonedas.setX(x0 + 7);
    this.monedas.setX(x0 + 7 + this.iconoMonedas.width + 5);
    for (const o of [this.chipMonedas, this.monedas, this.iconoMonedas]) o.setVisible(hay);

    const conCreditos = hay && d.creditos > 0;
    this.textoCreditos.setText(`◆ ${d.creditos}`);
    const wc = this.textoCreditos.width + 16;
    const xc = x0 - 4 - wc;
    this.chipCreditos.setX(xc).setSize(wc, this.altoArriba);
    this.textoCreditos.setX(xc + 8);
    for (const o of [this.chipCreditos, this.textoCreditos]) o.setVisible(conCreditos);
  }

  /** Atenúa el botón de zoom que ya no puede ir más allá */
  nivelZoom(nivel: number, min: number, max: number): void {
    this.zoom = { nivel, min, max };
    const alfa = (b: Boton | null, v: number) => {
      for (const o of b?.objetos ?? []) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(v);
    };
    alfa(this.zoomMas, nivel >= max ? 0.35 : 1);
    alfa(this.zoomMenos, nivel <= min ? 0.35 : 1);
  }

  /** Controles con su marco, al pie; se desvanecen solos */
  private crearChuleta(tactil: boolean, abajo: boolean): void {
    const s = this.scene;
    const partes: [string, string][] = tactil
      ? [
          ["Toca", "andar"],
          ["Pellizca", "zoom"],
          ["Arrastra", "mirar"],
        ]
      : [
          ["Clic", "andar"],
          ["WASD", "mover"],
          ["Enter", "chat"],
          ["T", "tienda"],
          ["M", "mochila"],
          ["C", "vestidor"],
          ["Rueda", "zoom"],
        ];
    const ALTO_TECLA = 16;
    const W = s.scale.width;
    const y = s.scale.height - this.abajo - 8 - ALTO_TECLA - (abajo ? 4 : 0);
    const yTexto = yCentrada(y, ALTO_TECLA);
    const trozos = partes.map(([t, d]) => {
      const tecla = texto(s, 0, yTexto, t);
      const marco = pieza(s, "tecla", 0, y, tecla.width + 10, ALTO_TECLA);
      const desc = texto(s, 0, yTexto, d, { color: UI.suave, sombra: true });
      return { tecla, marco, desc };
    });
    const ancho = trozos.reduce((a, t) => a + t.marco.width + 5 + t.desc.width, 0) + (trozos.length - 1) * 12;
    // Con la barra abajo, centrada encima; si no, a la izquierda del zoom
    let x = abajo || ancho > W - 60 ? Math.round(W / 2 - ancho / 2) : W - 8 - 24 - 12 - ancho;
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
  }

  /** Quita ya la chuleta de controles (algo va a ocupar su sitio) */
  quitarChuleta(): void {
    chuletaHasta = Math.min(chuletaHasta ?? 0, Date.now());
    this.irseChuleta();
  }

  private irseChuleta(): void {
    if (this.chuletaIda && this.chuleta.length === 0) return;
    this.chuletaIda = true;
    const estos = this.chuleta;
    this.chuleta = [];
    this.alIrseChuleta?.();
    this.scene.tweens.add({
      targets: estos,
      alpha: 0,
      duration: 1200,
      onComplete: () => {
        for (const o of estos) o.destroy();
      },
    });
  }
}
