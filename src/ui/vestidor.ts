import Phaser from "phaser";
import { LAYER } from "../render/layers";
import {
  COLORES_PELO,
  COLORES_ROPA,
  ESTILOS,
  PIELES,
  type Look,
  type Parte,
} from "../state/look";
import type { Facing } from "../state/avatarState";
import {
  animKey,
  createAvatarTexture,
  crearMiniatura,
  destroyAvatarAssets,
  frameInicial,
  ORIGEN,
} from "../entities/avatar";
import { boton, icono, pieza, texto, UI, UI_HEX, yCentrada } from "./kit";
import { medidas } from "./pantalla";

// Vestidor: donde se elige el aspecto. Trabaja sobre un BORRADOR: nada llega
// al avatar ni al servidor hasta pulsar Guardar, y Cancelar lo tira.
//
// Todo son objetos sueltos con scrollFactor(0), nunca un Container: con el
// contenedor fijo a la cámara sus hijos se dibujan en un sitio y reciben el
// clic en otro (ver CLAUDE.md).

type Pestana = Parte | "piel";

const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: "pelo", titulo: "Pelo" },
  { id: "torso", titulo: "Torso" },
  { id: "piernas", titulo: "Piernas" },
  { id: "pies", titulo: "Pies" },
  { id: "piel", titulo: "Piel" },
];

/**
 * Qué trozo del fotograma enseña la miniatura de cada parte, y desde dónde
 * se mira: el pelo de tres cuartos (se ve la coleta), la ropa de frente.
 */
const RECORTES: Record<Parte, { x: number; y: number; w: number; h: number; dir: Facing }> = {
  pelo: { x: 4, y: 4, w: 40, h: 44, dir: 3 },
  torso: { x: 6, y: 32, w: 36, h: 36, dir: 4 },
  piernas: { x: 8, y: 50, w: 32, h: 32, dir: 4 },
  pies: { x: 8, y: 60, w: 32, h: 22, dir: 4 },
};

/** Campo de color de cada pestaña y su catálogo */
const COLOR_DE: Record<Pestana, { campo: keyof Look; catalogo: Record<string, number> }> = {
  pelo: { campo: "peloColor", catalogo: COLORES_PELO },
  torso: { campo: "torsoColor", catalogo: COLORES_ROPA },
  piernas: { campo: "piernasColor", catalogo: COLORES_ROPA },
  pies: { campo: "piesColor", catalogo: COLORES_ROPA },
  piel: { campo: "piel", catalogo: PIELES },
};

const TEX_PREVIEW = "avatar:vestidor";
const texMini = (parte: Parte, estilo: string): string => `vestidor:${parte}:${estilo}`;

export type OpcionesVestidor = {
  look: Look;
  titulo?: string;
  subtitulo?: string;
  onGuardar: (look: Look) => void;
  onCerrar: () => void;
};

/**
 * Dónde va cada cosa, según la pantalla. Ancha: la vista previa a la
 * izquierda y las opciones a la derecha. Estrecha (un móvil en vertical):
 * todo en una columna, la vista previa arriba.
 */
type Disposicion = {
  x0: number;
  y0: number;
  w: number;
  h: number;
  preview: { x: number; y: number; w: number; h: number };
  /** El avatar de la vista previa, a ×2 si cabe */
  escala: number;
  /** Columna de las opciones: pestañas, estilos y colores */
  der: number;
  anchoDer: number;
  yPestanas: number;
  /** Alto de pestañas y botones */
  alto: number;
  /** Lado de las muestras de color (las de piel, más grandes) */
  lado: number;
  ladoPiel: number;
  /** Guardar y Cancelar: dónde y cuánto miden */
  botones: { x: number; y: number; w: number };
};

function disponer(W: number, H: number, tactil: boolean, subtitulo: boolean): Disposicion {
  const alto = tactil ? 28 : 22;
  const lado = tactil ? 26 : 18;
  const ladoPiel = tactil ? 32 : 28;
  const cab = subtitulo ? 54 : 40;
  if (W >= 540) {
    const w = 520;
    const h = Math.min(H - 16, tactil ? 320 : 300);
    const x0 = Math.round((W - w) / 2);
    const y0 = Math.round((H - h) / 2);
    const preview = { x: x0 + 16, y: y0 + cab, w: 160, h: h - cab - 32 };
    return {
      x0, y0, w, h, preview, escala: preview.h >= 190 ? 2 : 1,
      der: x0 + 192, anchoDer: w - 192 - 16, yPestanas: preview.y, alto, lado, ladoPiel,
      botones: { x: x0 + w - 16 - 200, y: y0 + h - 16 - alto - 2, w: 96 },
    };
  }
  // Estrecha: una columna. Las opciones ocupan unas 320 px; la vista previa, lo que sobre
  const w = Math.min(W - 16, 420);
  const x0 = Math.round((W - w) / 2);
  const hPrev = Math.max(110, Math.min(214, H - 16 - cab - 340));
  const h = Math.min(H - 16, cab + hPrev + 10 + 330);
  const y0 = Math.round((H - h) / 2);
  const preview = { x: x0 + 16, y: y0 + cab, w: w - 32, h: hPrev };
  const anchoBoton = Math.floor((w - 32 - 8) / 2);
  return {
    x0, y0, w, h, preview, escala: hPrev >= 190 ? 2 : 1,
    der: x0 + 16, anchoDer: w - 32, yPestanas: preview.y + hPrev + 10, alto, lado, ladoPiel,
    botones: { x: x0 + 16, y: y0 + h - 16 - alto - 2, w: anchoBoton },
  };
}

type Objeto = Phaser.GameObjects.GameObject & { setScrollFactor(v: number): Objeto; setDepth(v: number): Objeto };

export class Vestidor {
  private fijos: Phaser.GameObjects.GameObject[] = [];
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private pestanas: Phaser.GameObjects.GameObject[] = [];
  private borrador: Look;
  private pestana: Pestana = "pelo";
  private dir: Facing = 4;
  private preview!: Phaser.GameObjects.Sprite;
  private scene: Phaser.Scene;
  private o: OpcionesVestidor;
  private d!: Disposicion;

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
    for (const parte of Object.keys(RECORTES) as Parte[]) {
      for (const estilo of Object.keys(ESTILOS[parte])) {
        const k = texMini(parte, estilo);
        if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
      }
    }
  }

  /** La pantalla cambió de tamaño: se rehace a la medida nueva, con el borrador y la pestaña de antes */
  recolocar(): void {
    this.quitar();
    this.construir();
  }

  private quitar(): void {
    for (const obj of [...this.dinamicos, ...this.pestanas, ...this.fijos]) obj.destroy();
    this.dinamicos = [];
    this.pestanas = [];
    this.fijos = [];
  }

  /** Gira la vista previa (también con las flechas del teclado) */
  girar(paso: number): void {
    this.dir = ((((this.dir + paso) % 8) + 8) % 8) as Facing;
    this.repintarPreview();
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

    // Vista previa: un hueco hundido, una baldosa y el avatar encima (a 2× si cabe)
    const p = d.preview;
    const e = d.escala;
    this.fijo(pieza(s, "campo", p.x, p.y, p.w, p.h));
    const suelo = this.fijo(s.add.graphics());
    const cx = Math.round(p.x + p.w / 2);
    const cy = p.y + p.h - (e === 2 ? 46 : 30);
    const rombo = [
      { x: cx, y: cy - 10 * e },
      { x: cx + 20 * e, y: cy },
      { x: cx, y: cy + 10 * e },
      { x: cx - 20 * e, y: cy },
    ];
    suelo.fillStyle(0x2c6e74, 1);
    suelo.fillPoints(rombo, true);
    suelo.lineStyle(1, 0x3f8f96, 1);
    suelo.strokePoints(rombo, true);
    createAvatarTexture(s, this.borrador, TEX_PREVIEW);
    this.preview = this.fijo(
      s.add.sprite(cx, cy, TEX_PREVIEW, frameInicial(this.dir)).setOrigin(ORIGEN.x, ORIGEN.y).setScale(e),
      2,
    );
    this.preview.play(animKey(TEX_PREVIEW, `idle-${this.dir}`));
    const yGirar = p.y + p.h - d.alto - 6;
    const anchoGirar = d.alto + 4;
    for (const o of [
      ...boton(s, p.x + 6, yGirar, anchoGirar, d.alto, "◀", () => this.girar(1), { capa: LAYER.UI_PANEL + 2 }).objetos,
      ...boton(s, p.x + p.w - 6 - anchoGirar, yGirar, anchoGirar, d.alto, "▶", () => this.girar(-1), { capa: LAYER.UI_PANEL + 2 }).objetos,
    ]) {
      this.fijos.push(o);
    }

    const b = d.botones;
    for (const o of [
      ...boton(s, b.x + b.w + 8, b.y, b.w, d.alto + 2, "Guardar", () => this.o.onGuardar({ ...this.borrador }), {
        primario: true,
        capa: LAYER.UI_PANEL + 2,
      }).objetos,
      ...boton(s, b.x, b.y, b.w, d.alto + 2, "Cancelar", () => this.o.onCerrar(), {
        capa: LAYER.UI_PANEL + 2,
      }).objetos,
    ]) {
      this.fijos.push(o);
    }

    this.cambiarPestana(this.pestana);
  }

  /** Las pestañas se rehacen al cambiar: la elegida va en el estilo principal */
  private cambiarPestana(p: Pestana): void {
    this.pestana = p;
    for (const o of this.pestanas) o.destroy();
    this.pestanas = [];
    const s = this.scene;
    const d = this.d;
    const hueco = 4;
    const anchoP = Math.floor((d.anchoDer - hueco * 4) / 5);
    PESTANAS.forEach((t, i) => {
      const x = d.der + i * (anchoP + hueco);
      const activa = t.id === p;
      const fondo = this.poner(this.pestanas, pieza(s, activa ? "primario" : "boton", x, d.yPestanas, anchoP, d.alto), 1);
      const etiqueta = this.poner(this.pestanas, texto(s, 0, 0, t.titulo), 2);
      etiqueta.setPosition(Math.round(x + (anchoP - etiqueta.width) / 2), yCentrada(d.yPestanas, d.alto));
      if (!activa) {
        fondo
          .setInteractive({ useHandCursor: true })
          .on("pointerover", () => fondo.setTexture("ui:boton-hover"))
          .on("pointerout", () => fondo.setTexture("ui:boton"))
          .on("pointerup", () => this.cambiarPestana(t.id));
      }
    });
    this.pintarOpciones();
  }

  // ---------------------------------------------------------------- Opciones

  /** Rehace estilos y colores de la pestaña actual con el borrador vigente */
  private pintarOpciones(): void {
    for (const o of this.dinamicos) o.destroy();
    this.dinamicos = [];
    const s = this.scene;
    const d = this.d;
    let y = d.yPestanas + d.alto + 10;

    if (this.pestana !== "piel") {
      const parte = this.pestana;
      const rc = RECORTES[parte];
      const estilos = Object.entries(ESTILOS[parte]) as [string, string][];
      const caja = { w: 46, h: 54 };
      // Si no caben en una fila (un móvil estrecho), saltan a la siguiente
      const porFila = Math.max(1, Math.floor((d.anchoDer + 6) / (caja.w + 6)));
      let nombreElegido = "";
      estilos.forEach(([estilo, nombre], i) => {
        const x = d.der + (i % porFila) * (caja.w + 6);
        const yy = y + Math.floor(i / porFila) * (caja.h + 6);
        const elegido = this.borrador[parte] === estilo;
        const k = texMini(parte, estilo);
        crearMiniatura(s, k, { ...this.borrador, [parte]: estilo } as Look, rc.dir, rc);
        const fondo = this.dinamico(pieza(s, elegido ? "campo-activo" : "campo", x, yy, caja.w, caja.h), 2);
        if (!elegido) {
          fondo
            .setInteractive({ useHandCursor: true })
            .on("pointerover", () => fondo.setTexture("ui:campo-activo"))
            .on("pointerout", () => fondo.setTexture("ui:campo"))
            .on("pointerup", () => this.elegir(parte, estilo));
        }
        this.dinamico(s.add.image(x + caja.w / 2, yy + caja.h / 2, k).setOrigin(0.5), 3);
        if (elegido) nombreElegido = nombre;
      });
      const filas = Math.ceil(estilos.length / porFila);
      y += filas * (caja.h + 6) - 6;
      if (nombreElegido) this.dinamico(texto(s, d.der, y + 4, nombreElegido, { color: UI.titulo }), 3);
      y += 28;
    }

    // Colores
    const { campo, catalogo } = COLOR_DE[this.pestana];
    this.dinamico(texto(s, d.der, y, this.pestana === "piel" ? "Tono de piel" : "Color", { color: UI.suave }), 3);
    y += 18;
    const grande = this.pestana === "piel";
    const lado = grande ? d.ladoPiel : d.lado;
    const hueco = grande ? 6 : 4;
    const porFila = Math.max(1, Math.floor((d.anchoDer + hueco) / (lado + hueco)));
    Object.entries(catalogo).forEach(([id, color], i) => {
      const x = d.der + (i % porFila) * (lado + hueco);
      const yy = y + Math.floor(i / porFila) * (lado + hueco);
      const elegido = this.borrador[campo] === id;
      // Muestra: marco hundido (iluminado si es la elegida) y el color dentro
      const marco = this.dinamico(pieza(s, elegido ? "campo-activo" : "campo", x, yy, lado, lado), 3);
      this.dinamico(s.add.rectangle(x + 3, yy + 3, lado - 6, lado - 6, color).setOrigin(0, 0), 4);
      if (!elegido) {
        marco
          .setInteractive({ useHandCursor: true })
          .on("pointerover", () => marco.setTexture("ui:campo-activo"))
          .on("pointerout", () => marco.setTexture("ui:campo"))
          .on("pointerup", () => this.elegirColor(campo, id));
      }
    });
  }

  private elegir(parte: Parte, estilo: string): void {
    this.borrador = { ...this.borrador, [parte]: estilo } as Look;
    this.repintarPreview(true);
    this.pintarOpciones();
  }

  private elegirColor(campo: keyof Look, id: string): void {
    this.borrador = { ...this.borrador, [campo]: id } as Look;
    this.repintarPreview(true);
    this.pintarOpciones();
  }

  /** Vista previa con el borrador (y, si cambió, textura nueva) */
  private repintarPreview(rehacer = false): void {
    if (rehacer) createAvatarTexture(this.scene, this.borrador, TEX_PREVIEW);
    this.preview.setTexture(TEX_PREVIEW, frameInicial(this.dir));
    this.preview.play(animKey(TEX_PREVIEW, `idle-${this.dir}`), !rehacer);
  }
}
