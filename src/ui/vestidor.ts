import Phaser from "phaser";
import { LAYER } from "../render/layers";
import {
  BARBAS,
  BOCAS,
  CARAS,
  CEJAS,
  COLORES_OJOS,
  COLORES_PELO,
  COLORES_ROPA,
  DETALLES,
  ESTILOS,
  NARICES,
  OJOS,
  PIELES,
  lookAlAzar,
  type CampoLook,
  type Look,
} from "../state/look";
import type { Facing } from "../state/avatarState";
import {
  animKey,
  createAvatarTexture,
  crearMiniatura,
  destroyAvatarAssets,
  frameInicial,
  ORIGEN,
  RECORTE,
} from "../entities/avatar";
import { anchoTexto, boton, pieza, texto, icono, UI, UI_HEX, yCentrada } from "./kit";
import { medidas } from "./pantalla";

// Vestidor: donde se elige el aspecto. Trabaja sobre un BORRADOR: nada llega
// al avatar ni al servidor hasta pulsar Guardar, y Cancelar lo tira.
//
// Tres secciones (Cara, Pelo y Ropa) y, dentro, sus partes: la forma de la
// cara, la piel, los ojos, las cejas... Cada opción se enseña sobre TU
// propio avatar (una miniatura de tu cara con esos ojos, de tu cabeza con
// ese peinado). En la sección Cara, la vista previa se acerca a la cara.
//
// Todo son objetos sueltos con scrollFactor(0), nunca un Container: con el
// contenedor fijo a la cámara sus hijos se dibujan en un sitio y reciben el
// clic en otro (ver CLAUDE.md).

type Seccion = "cara" | "pelo" | "ropa";
type Sub = "forma" | "piel" | "ojos" | "cejas" | "nariz" | "boca" | "detalle" | "barba" | "pelo" | "torso" | "piernas" | "pies";

/** Cómo se ve la miniatura de una opción: qué trozo del fotograma, desde dónde y a qué escala */
type Miniatura = { recorte: { x: number; y: number; w: number; h: number }; dir: Facing; escala: 1 | 2 };

type DefSub = {
  titulo: string;
  /** El estilo que se elige (sin él, la parte sólo tiene color: la piel) */
  campo?: CampoLook;
  opciones?: Record<string, string>;
  mini?: Miniatura;
  color?: { campo: CampoLook; catalogo: Record<string, number>; titulo: string; grande?: boolean };
};

/** Los rasgos se juzgan de cerca: la cara de frente, al doble */
const MINI_CARA: Miniatura = { recorte: RECORTE.cara, dir: 4, escala: 2 };
/** Los peinados, de tres cuartos (se ve cómo son por detrás), con sitio para moños y crestas */
const MINI_PELO: Miniatura = { recorte: { x: 6, y: 4, w: 36, h: 42 }, dir: 3, escala: 1 };

const SUBS: Record<Sub, DefSub> = {
  forma: { titulo: "Forma", campo: "cara", opciones: CARAS, mini: { recorte: RECORTE.cabeza, dir: 4, escala: 2 } },
  piel: { titulo: "Piel", color: { campo: "piel", catalogo: PIELES, titulo: "Tono de piel", grande: true } },
  ojos: {
    titulo: "Ojos",
    campo: "ojos",
    opciones: OJOS,
    mini: MINI_CARA,
    color: { campo: "ojosColor", catalogo: COLORES_OJOS, titulo: "Color de ojos" },
  },
  cejas: { titulo: "Cejas", campo: "cejas", opciones: CEJAS, mini: MINI_CARA },
  nariz: { titulo: "Nariz", campo: "nariz", opciones: NARICES, mini: MINI_CARA },
  boca: { titulo: "Boca", campo: "boca", opciones: BOCAS, mini: MINI_CARA },
  detalle: { titulo: "Detalles", campo: "detalle", opciones: DETALLES, mini: MINI_CARA },
  barba: { titulo: "Barba", campo: "barba", opciones: BARBAS, mini: MINI_CARA },
  pelo: {
    titulo: "Peinado",
    campo: "pelo",
    opciones: ESTILOS.pelo,
    mini: MINI_PELO,
    color: { campo: "peloColor", catalogo: COLORES_PELO, titulo: "Color del pelo" },
  },
  torso: {
    titulo: "Arriba",
    campo: "torso",
    opciones: ESTILOS.torso,
    mini: { recorte: { x: 6, y: 32, w: 36, h: 36 }, dir: 4, escala: 1 },
    color: { campo: "torsoColor", catalogo: COLORES_ROPA, titulo: "Color" },
  },
  piernas: {
    titulo: "Abajo",
    campo: "piernas",
    opciones: ESTILOS.piernas,
    mini: { recorte: { x: 8, y: 50, w: 32, h: 32 }, dir: 4, escala: 1 },
    color: { campo: "piernasColor", catalogo: COLORES_ROPA, titulo: "Color" },
  },
  pies: {
    titulo: "Pies",
    campo: "pies",
    opciones: ESTILOS.pies,
    mini: { recorte: { x: 8, y: 60, w: 32, h: 22 }, dir: 4, escala: 1 },
    color: { campo: "piesColor", catalogo: COLORES_ROPA, titulo: "Color" },
  },
};

const SECCIONES: { id: Seccion; titulo: string; subs: Sub[]; campos: CampoLook[] }[] = [
  {
    id: "cara",
    titulo: "Cara",
    subs: ["forma", "piel", "ojos", "cejas", "nariz", "boca", "detalle", "barba"],
    campos: ["cara", "piel", "ojos", "ojosColor", "cejas", "nariz", "boca", "detalle", "barba"],
  },
  { id: "pelo", titulo: "Pelo", subs: ["pelo"], campos: ["pelo", "peloColor"] },
  {
    id: "ropa",
    titulo: "Ropa",
    subs: ["torso", "piernas", "pies"],
    campos: ["torso", "torsoColor", "piernas", "piernasColor", "pies", "piesColor"],
  },
];

const TEX_PREVIEW = "avatar:vestidor";
const texMini = (sub: Sub, id: string): string => `vestidor:${sub}:${id}`;

export type OpcionesVestidor = {
  look: Look;
  titulo?: string;
  subtitulo?: string;
  onGuardar: (look: Look) => void;
  onCerrar: () => void;
};

/**
 * Dónde va cada cosa, según la pantalla. Ancha: a la izquierda las
 * secciones y la vista previa, a la derecha las partes y sus opciones.
 * Estrecha (un móvil en vertical): todo en una columna, la vista previa
 * arriba.
 */
type Disposicion = {
  x0: number;
  y0: number;
  w: number;
  h: number;
  ancha: boolean;
  /** Las pestañas de las secciones */
  secciones: { x: number; y: number; w: number };
  preview: { x: number; y: number; w: number; h: number };
  /** La columna de las partes y sus opciones, y hasta dónde puede bajar */
  der: number;
  anchoDer: number;
  yContenido: number;
  finContenido: number;
  /** Alto de pestañas y botones */
  alto: number;
  /** Lado de las muestras de color */
  lado: number;
  ladoGrande: number;
  /** La fila de botones de abajo */
  botones: { y: number; sorpresa: { x: number; w: number }; cancelar: { x: number; w: number }; guardar: { x: number; w: number } };
};

function disponer(W: number, H: number, tactil: boolean, subtitulo: boolean): Disposicion {
  const alto = tactil ? 28 : 22;
  const lado = tactil ? 26 : 18;
  const ladoGrande = tactil ? 34 : 28;
  const cab = subtitulo ? 54 : 40;
  const altoBoton = alto + 2;
  if (W >= 580) {
    const w = 560;
    const h = Math.min(H - 16, tactil ? 430 : 400);
    const x0 = Math.round((W - w) / 2);
    const y0 = Math.round((H - h) / 2);
    const colIzq = 172;
    const yBotones = y0 + h - 16 - altoBoton;
    const yPrev = y0 + cab + alto + 8;
    const der = x0 + 16 + colIzq + 16;
    const anchoDer = x0 + w - 16 - der;
    return {
      x0, y0, w, h, ancha: true, alto, lado, ladoGrande,
      secciones: { x: x0 + 16, y: y0 + cab, w: colIzq },
      preview: { x: x0 + 16, y: yPrev, w: colIzq, h: yBotones - 8 - yPrev },
      der, anchoDer, yContenido: y0 + cab, finContenido: yBotones - 10,
      botones: {
        y: yBotones,
        sorpresa: { x: x0 + 16, w: colIzq },
        cancelar: { x: x0 + w - 16 - 100 - 8 - 100, w: 100 },
        guardar: { x: x0 + w - 16 - 100, w: 100 },
      },
    };
  }
  // Estrecha: una columna. Las opciones piden unas 330 px; la vista previa, lo que sobre
  const w = Math.min(W - 16, 440);
  const x0 = Math.round((W - w) / 2);
  const hPrev = Math.max(96, Math.min(200, H - 16 - cab - alto - 8 - 350 - altoBoton - 16));
  const h = Math.min(H - 16, cab + alto + 8 + hPrev + 10 + 350 + altoBoton + 16);
  const y0 = Math.round((H - h) / 2);
  const yPrev = y0 + cab + alto + 8;
  const yBotones = y0 + h - 16 - altoBoton;
  const ancho = w - 32;
  const tercio = Math.floor((ancho - 16) / 3);
  return {
    x0, y0, w, h, ancha: false, alto, lado, ladoGrande,
    secciones: { x: x0 + 16, y: y0 + cab, w: ancho },
    preview: { x: x0 + 16, y: yPrev, w: ancho, h: hPrev },
    der: x0 + 16, anchoDer: ancho, yContenido: yPrev + hPrev + 10, finContenido: yBotones - 10,
    botones: {
      y: yBotones,
      sorpresa: { x: x0 + 16, w: ancho - 16 - tercio * 2 },
      cancelar: { x: x0 + 16 + ancho - tercio * 2 - 8, w: tercio },
      guardar: { x: x0 + 16 + ancho - tercio, w: tercio },
    },
  };
}

type Objeto = Phaser.GameObjects.GameObject & { setScrollFactor(v: number): Objeto; setDepth(v: number): Objeto };

export class Vestidor {
  private fijos: Phaser.GameObjects.GameObject[] = [];
  private navegacion: Phaser.GameObjects.GameObject[] = [];
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private borrador: Look;
  private seccion: Seccion = "cara";
  private sub: Sub = "forma";
  private pagina = 0;
  private dir: Facing = 4;
  private preview!: Phaser.GameObjects.Sprite;
  private suelo!: Phaser.GameObjects.Graphics;
  private scene: Phaser.Scene;
  private o: OpcionesVestidor;
  private d!: Disposicion;
  /** Texturas de miniaturas creadas (para borrarlas al cerrar) */
  private minis = new Set<string>();

  constructor(scene: Phaser.Scene, o: OpcionesVestidor) {
    this.scene = scene;
    this.o = o;
    this.borrador = { ...o.look };
    this.construir();
  }

  /** Cierra y libera texturas. Idempotente. */
  destroy(): void {
    this.quitar();
    // Las texturas van DESPUÉS de destruir los sprites que las usaban
    destroyAvatarAssets(this.scene, TEX_PREVIEW);
    for (const k of this.minis) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    this.minis.clear();
  }

  /** La pantalla cambió de tamaño: se rehace a la medida nueva, con el borrador, la sección y la parte de antes */
  recolocar(): void {
    this.quitar();
    this.construir();
  }

  /** Gira la vista previa (también con las flechas del teclado) */
  girar(paso: number): void {
    this.dir = ((((this.dir + paso) % 8) + 8) % 8) as Facing;
    this.repintarPreview();
  }

  private quitar(): void {
    for (const obj of [...this.dinamicos, ...this.navegacion, ...this.fijos]) obj.destroy();
    this.dinamicos = [];
    this.navegacion = [];
    this.fijos = [];
  }

  // ---------------------------------------------------------------- Construcción

  private poner<T extends Phaser.GameObjects.GameObject>(lista: Phaser.GameObjects.GameObject[], o: T, capa: number): T {
    (o as unknown as Objeto).setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
    lista.push(o);
    return o;
  }
  private fijo<T extends Phaser.GameObjects.GameObject>(o: T, capa = 1): T {
    return this.poner(this.fijos, o, capa);
  }
  private dinamico<T extends Phaser.GameObjects.GameObject>(o: T, capa = 2): T {
    return this.poner(this.dinamicos, o, capa);
  }

  private construir(): void {
    const s = this.scene;
    const W = s.scale.width;
    const H = s.scale.height;
    const d = (this.d = disponer(W, H, medidas().tactil, Boolean(this.o.subtitulo)));
    // Velo: tapa el mundo y se come los clics (nada de caminar detrás)
    this.fijo(s.add.rectangle(W / 2, H / 2, W, H, UI_HEX.velo, 0.6).setInteractive(), 0);
    this.fijo(pieza(s, "panel", d.x0, d.y0, d.w, d.h).setInteractive());

    this.fijo(icono(s, "rombo", d.x0 + 16, d.y0 + 18), 2);
    this.fijo(texto(s, d.x0 + 30, yCentrada(d.y0 + 12, 16), this.o.titulo ?? "Vestidor", { color: UI.titulo }), 2);
    if (this.o.subtitulo) this.fijo(texto(s, d.x0 + 16, d.y0 + 30, this.o.subtitulo, { color: UI.suave }), 2);

    // Vista previa: un hueco hundido y el avatar dentro (animado: parpadea)
    const p = d.preview;
    this.fijo(pieza(s, "campo", p.x, p.y, p.w, p.h));
    this.suelo = this.fijo(s.add.graphics(), 2);
    createAvatarTexture(s, this.borrador, TEX_PREVIEW);
    this.preview = this.fijo(s.add.sprite(0, 0, TEX_PREVIEW, frameInicial(this.dir)).setOrigin(ORIGEN.x, ORIGEN.y), 3);
    const yGirar = p.y + p.h - d.alto - 6;
    const anchoGirar = d.alto + 4;
    this.fijos.push(
      ...boton(s, p.x + 6, yGirar, anchoGirar, d.alto, "◀", () => this.girar(1), { capa: LAYER.UI_PANEL + 4, pista: "Girar · ←" }).objetos,
      ...boton(s, p.x + p.w - 6 - anchoGirar, yGirar, anchoGirar, d.alto, "▶", () => this.girar(-1), {
        capa: LAYER.UI_PANEL + 4,
        pista: "Girar · →",
      }).objetos,
    );

    // Abajo: sorprenderse, cancelar y guardar
    const b = d.botones;
    const altoBoton = d.alto + 2;
    this.fijos.push(
      ...boton(s, b.sorpresa.x, b.y, b.sorpresa.w, altoBoton, "Sorpréndeme", () => this.sorprender(), {
        capa: LAYER.UI_PANEL + 2,
        pista: "Al azar, en esta sección",
        ladoPista: "arriba",
      }).objetos,
      ...boton(s, b.cancelar.x, b.y, b.cancelar.w, altoBoton, "Cancelar", () => this.o.onCerrar(), { capa: LAYER.UI_PANEL + 2 }).objetos,
      ...boton(s, b.guardar.x, b.y, b.guardar.w, altoBoton, "Guardar", () => this.o.onGuardar({ ...this.borrador }), {
        primario: true,
        capa: LAYER.UI_PANEL + 2,
      }).objetos,
    );

    this.pintarSecciones();
    this.pintarOpciones();
    this.repintarPreview();
  }

  /** Las pestañas de las secciones: la elegida, en el estilo principal */
  private pintarSecciones(): void {
    for (const o of this.navegacion) o.destroy();
    this.navegacion = [];
    const s = this.scene;
    const d = this.d;
    const hueco = 4;
    const ancho = Math.floor((d.secciones.w - hueco * (SECCIONES.length - 1)) / SECCIONES.length);
    SECCIONES.forEach((sec, i) => {
      const b = boton(s, d.secciones.x + i * (ancho + hueco), d.secciones.y, ancho, d.alto, sec.titulo, () => this.cambiarSeccion(sec.id), {
        primario: sec.id === this.seccion,
        capa: LAYER.UI_PANEL + 2,
      });
      this.navegacion.push(...b.objetos);
    });
  }

  private cambiarSeccion(sec: Seccion): void {
    if (sec === this.seccion) return;
    this.seccion = sec;
    this.sub = SECCIONES.find((x) => x.id === sec)?.subs[0] ?? "forma";
    this.pagina = 0;
    this.pintarSecciones();
    this.pintarOpciones();
    this.repintarPreview();
  }

  private cambiarSub(sub: Sub): void {
    if (sub === this.sub) return;
    this.sub = sub;
    this.pagina = 0;
    this.pintarOpciones();
  }

  // ---------------------------------------------------------------- Opciones

  /** Rehace las partes de la sección, las opciones de la parte y sus colores, con el borrador vigente */
  private pintarOpciones(): void {
    for (const o of this.dinamicos) o.destroy();
    this.dinamicos = [];
    const s = this.scene;
    const d = this.d;
    const sec = SECCIONES.find((x) => x.id === this.seccion) ?? SECCIONES[0];
    let y = d.yContenido;

    // Las partes de la sección (saltan de fila si no caben; con una sola, no hay fila)
    if (sec.subs.length > 1) {
      let x = d.der;
      const altoChip = d.alto - 2;
      for (const sub of sec.subs) {
        const titulo = SUBS[sub].titulo;
        const w = anchoTexto(titulo) + 14;
        if (x + w > d.der + d.anchoDer) {
          x = d.der;
          y += altoChip + 4;
        }
        const b = boton(s, x, y, w, altoChip, titulo, () => this.cambiarSub(sub), {
          primario: sub === this.sub,
          capa: LAYER.UI_PANEL + 3,
        });
        this.dinamicos.push(...b.objetos);
        x += w + 4;
      }
      y += altoChip + 10;
    }

    const def = SUBS[this.sub];
    // Lo que ocupan los colores al final (se reserva antes de repartir las opciones)
    const color = def.color;
    const ladoColor = color?.grande ? d.ladoGrande : d.lado;
    const huecoColor = color?.grande ? 6 : 4;
    const porFilaColor = Math.max(1, Math.floor((d.anchoDer + huecoColor) / (ladoColor + huecoColor)));
    const filasColor = color ? Math.ceil(Object.keys(color.catalogo).length / porFilaColor) : 0;
    const altoColores = color ? 18 + filasColor * (ladoColor + huecoColor) - huecoColor : 0;

    if (def.campo && def.opciones && def.mini) {
      y = this.pintarRejilla(def, y, d.finContenido - altoColores - (color ? 10 : 0));
    }
    if (color) this.pintarColores(color, def.campo ? y + 10 : y, ladoColor, huecoColor, porFilaColor);
  }

  /** Las opciones de la parte, como miniaturas sobre tu propio avatar. Devuelve dónde acaba. */
  private pintarRejilla(def: DefSub, y0: number, fin: number): number {
    const s = this.scene;
    const d = this.d;
    const campo = def.campo as CampoLook;
    const mini = def.mini as Miniatura;
    const ids = Object.keys(def.opciones ?? {});
    const cw = mini.recorte.w * mini.escala + 6;
    const ch = mini.recorte.h * mini.escala + 6;
    const hueco = 6;
    const altoNombre = 18;
    const porFila = Math.max(1, Math.floor((d.anchoDer + hueco) / (cw + hueco)));
    const filasQueCaben = Math.max(1, Math.floor((fin - y0 - altoNombre + hueco) / (ch + hueco)));
    const porPagina = porFila * filasQueCaben;
    const paginas = Math.max(1, Math.ceil(ids.length / porPagina));
    this.pagina = Math.min(this.pagina, paginas - 1);
    const visibles = ids.slice(this.pagina * porPagina, (this.pagina + 1) * porPagina);

    visibles.forEach((id, i) => {
      const x = d.der + (i % porFila) * (cw + hueco);
      const yy = y0 + Math.floor(i / porFila) * (ch + hueco);
      const elegido = this.borrador[campo] === id;
      const k = texMini(this.sub, id);
      crearMiniatura(s, k, { ...this.borrador, [campo]: id } as Look, mini.dir, mini.recorte);
      this.minis.add(k);
      const fondo = this.dinamico(pieza(s, elegido ? "campo-activo" : "campo", x, yy, cw, ch), 2);
      if (!elegido) {
        fondo
          .setInteractive({ useHandCursor: true })
          .on("pointerover", () => fondo.setTexture("ui:campo-activo"))
          .on("pointerout", () => fondo.setTexture("ui:campo"))
          .on("pointerup", () => this.elegir(campo, id));
      }
      this.dinamico(s.add.image(Math.round(x + cw / 2), Math.round(yy + ch / 2), k).setOrigin(0.5).setScale(mini.escala), 3);
    });

    const filas = Math.ceil(visibles.length / porFila);
    let y = y0 + filas * (ch + hueco) - hueco + 4;
    // El nombre de lo elegido y, si no cabe todo, las páginas
    const nombre = def.opciones?.[this.borrador[campo] as string] ?? "";
    this.dinamico(texto(s, d.der, y, `${def.titulo}: ${nombre}`, { color: UI.titulo }), 3);
    if (paginas > 1) {
      const bw = d.alto + 4;
      const xSig = d.der + d.anchoDer - bw;
      const xAnt = xSig - 4 - bw - 40;
      const ant = boton(s, xAnt, y - 3, bw, d.alto - 2, "◀", () => this.irPagina(-1), {
        capa: LAYER.UI_PANEL + 3,
        apagado: this.pagina === 0,
      });
      const sig = boton(s, xSig, y - 3, bw, d.alto - 2, "▶", () => this.irPagina(1), {
        capa: LAYER.UI_PANEL + 3,
        apagado: this.pagina >= paginas - 1,
      });
      this.dinamicos.push(...ant.objetos, ...sig.objetos);
      const t = texto(s, 0, y, `${this.pagina + 1} / ${paginas}`, { color: UI.suave });
      this.dinamico(t.setX(Math.round(xAnt + bw + (xSig - xAnt - bw - t.width) / 2)), 3);
    }
    return y + altoNombre - 4;
  }

  /** Las muestras de color de la parte */
  private pintarColores(
    color: NonNullable<DefSub["color"]>,
    y0: number,
    lado: number,
    hueco: number,
    porFila: number,
  ): void {
    const s = this.scene;
    const d = this.d;
    this.dinamico(texto(s, d.der, y0, color.titulo, { color: UI.suave }), 3);
    const y = y0 + 18;
    Object.entries(color.catalogo).forEach(([id, valor], i) => {
      const x = d.der + (i % porFila) * (lado + hueco);
      const yy = y + Math.floor(i / porFila) * (lado + hueco);
      const elegido = this.borrador[color.campo] === id;
      // Muestra: marco hundido (iluminado si es la elegida) y el color dentro
      const marco = this.dinamico(pieza(s, elegido ? "campo-activo" : "campo", x, yy, lado, lado), 3);
      this.dinamico(s.add.rectangle(x + 3, yy + 3, lado - 6, lado - 6, valor).setOrigin(0, 0), 4);
      if (!elegido) {
        marco
          .setInteractive({ useHandCursor: true })
          .on("pointerover", () => marco.setTexture("ui:campo-activo"))
          .on("pointerout", () => marco.setTexture("ui:campo"))
          .on("pointerup", () => this.elegir(color.campo, id));
      }
    });
  }

  private irPagina(paso: number): void {
    this.pagina = Math.max(0, this.pagina + paso);
    this.pintarOpciones();
  }

  private elegir(campo: CampoLook, id: string): void {
    this.borrador = { ...this.borrador, [campo]: id } as Look;
    this.repintarPreview(true);
    this.pintarOpciones();
  }

  /** Un aspecto al azar, sólo en la sección que se está viendo */
  private sorprender(): void {
    const sec = SECCIONES.find((x) => x.id === this.seccion) ?? SECCIONES[0];
    this.borrador = lookAlAzar(this.borrador, sec.campos);
    this.repintarPreview(true);
    this.pintarOpciones();
  }

  // ---------------------------------------------------------------- Vista previa

  /**
   * La vista previa con el borrador (y, si cambió, textura nueva). En la
   * sección Cara se acerca a la cabeza (recortada y ampliada, parpadeando);
   * en las demás, el cuerpo entero sobre una baldosa.
   */
  private repintarPreview(rehacer = false): void {
    if (rehacer) createAvatarTexture(this.scene, this.borrador, TEX_PREVIEW);
    const p = this.d.preview;
    const cerca = this.seccion === "cara";
    this.preview.setTexture(TEX_PREVIEW, frameInicial(this.dir));
    this.preview.play(animKey(TEX_PREVIEW, `idle-${this.dir}`), !rehacer);
    this.suelo.clear();
    if (cerca) {
      const r = RECORTE.cabeza;
      const e = Math.max(1, Math.min(4, Math.floor((p.h - 12) / r.h), Math.floor((p.w - 12) / r.w)));
      this.preview.setCrop(r.x, r.y, r.w, r.h).setScale(e);
      // El centro del recorte, en el centro del hueco (el origen del sprite está en los pies)
      const cx = r.x + r.w / 2 - ORIGEN.x * 48;
      const cy = r.y + r.h / 2 - ORIGEN.y * 84;
      this.preview.setPosition(Math.round(p.x + p.w / 2 - cx * e), Math.round(p.y + (p.h - this.d.alto - 6) / 2 - cy * e));
      return;
    }
    this.preview.setCrop();
    const e = p.h >= 190 ? 2 : 1;
    this.preview.setScale(e);
    const cx = Math.round(p.x + p.w / 2);
    const cy = p.y + p.h - (e === 2 ? 46 : 30);
    this.preview.setPosition(cx, cy);
    const rombo = [
      { x: cx, y: cy - 10 * e },
      { x: cx + 20 * e, y: cy },
      { x: cx, y: cy + 10 * e },
      { x: cx - 20 * e, y: cy },
    ];
    this.suelo.fillStyle(0x2c6e74, 1);
    this.suelo.fillPoints(rombo, true);
    this.suelo.lineStyle(1, 0x3f8f96, 1);
    this.suelo.strokePoints(rombo, true);
  }
}
