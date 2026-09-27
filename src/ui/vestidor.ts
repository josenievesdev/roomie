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

/** Medidas del panel (lienzo de 960×540) */
const W = 520;
const H = 300;
const X0 = 480 - W / 2;
const Y0 = 270 - H / 2;
const PREVIEW = { x: X0 + 16, y: Y0 + 54, w: 160, h: 214 };
const DERECHA = X0 + 192;
const ANCHO_DER = W - 192 - 16;
/** Alto de pestañas y botones */
const ALTO = 22;

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

  constructor(scene: Phaser.Scene, o: OpcionesVestidor) {
    this.scene = scene;
    this.o = o;
    this.borrador = { ...o.look };
    this.construir();
  }

  /** Cierra y libera texturas. Idempotente. */
  destroy(): void {
    for (const obj of [...this.dinamicos, ...this.pestanas, ...this.fijos]) obj.destroy();
    this.dinamicos = [];
    this.pestanas = [];
    this.fijos = [];
    // Las texturas van DESPUÉS de destruir los sprites que las usaban
    destroyAvatarAssets(this.scene, TEX_PREVIEW);
    for (const parte of Object.keys(RECORTES) as Parte[]) {
      for (const estilo of Object.keys(ESTILOS[parte])) {
        const k = texMini(parte, estilo);
        if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
      }
    }
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
    // Velo: tapa el mundo y se come los clics (nada de caminar detrás)
    this.fijo(s.add.rectangle(480, 270, 960, 540, UI_HEX.velo, 0.6).setInteractive(), 0);
    this.fijo(pieza(s, "panel", X0, Y0, W, H).setInteractive());

    this.fijo(icono(s, "rombo", X0 + 16, Y0 + 18), 2);
    this.fijo(texto(s, X0 + 30, yCentrada(Y0 + 12, 16), this.o.titulo ?? "Vestidor", { color: UI.titulo }), 2);
    if (this.o.subtitulo) this.fijo(texto(s, X0 + 16, Y0 + 30, this.o.subtitulo, { color: UI.suave }), 2);

    // Vista previa: un hueco hundido, una baldosa y el avatar encima a 2×
    this.fijo(pieza(s, "campo", PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h));
    const suelo = this.fijo(s.add.graphics());
    const cx = PREVIEW.x + PREVIEW.w / 2;
    const cy = PREVIEW.y + PREVIEW.h - 46;
    const rombo = [
      { x: cx, y: cy - 20 },
      { x: cx + 40, y: cy },
      { x: cx, y: cy + 20 },
      { x: cx - 40, y: cy },
    ];
    suelo.fillStyle(0x2c6e74, 1);
    suelo.fillPoints(rombo, true);
    suelo.lineStyle(1, 0x3f8f96, 1);
    suelo.strokePoints(rombo, true);
    createAvatarTexture(s, this.borrador, TEX_PREVIEW);
    this.preview = this.fijo(
      s.add.sprite(cx, cy, TEX_PREVIEW, frameInicial(this.dir)).setOrigin(ORIGEN.x, ORIGEN.y).setScale(2),
      2,
    );
    this.preview.play(animKey(TEX_PREVIEW, `idle-${this.dir}`));
    const alto = PREVIEW.y + PREVIEW.h - ALTO - 6;
    for (const o of [
      ...boton(s, PREVIEW.x + 6, alto, 24, ALTO, "◀", () => this.girar(1), { capa: LAYER.UI_PANEL + 2 }).objetos,
      ...boton(s, PREVIEW.x + PREVIEW.w - 30, alto, 24, ALTO, "▶", () => this.girar(-1), { capa: LAYER.UI_PANEL + 2 }).objetos,
    ]) {
      this.fijos.push(o);
    }

    const yBotones = Y0 + H - 16 - 24;
    for (const o of [
      ...boton(s, X0 + W - 16 - 96, yBotones, 96, 24, "Guardar", () => this.o.onGuardar({ ...this.borrador }), {
        primario: true,
        capa: LAYER.UI_PANEL + 2,
      }).objetos,
      ...boton(s, X0 + W - 16 - 96 - 8 - 96, yBotones, 96, 24, "Cancelar", () => this.o.onCerrar(), {
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
    const hueco = 4;
    const anchoP = Math.floor((ANCHO_DER - hueco * 4) / 5);
    PESTANAS.forEach((t, i) => {
      const x = DERECHA + i * (anchoP + hueco);
      const activa = t.id === p;
      const fondo = this.poner(this.pestanas, pieza(s, activa ? "primario" : "boton", x, PREVIEW.y, anchoP, ALTO), 1);
      const etiqueta = this.poner(this.pestanas, texto(s, 0, 0, t.titulo), 2);
      etiqueta.setPosition(Math.round(x + (anchoP - etiqueta.width) / 2), yCentrada(PREVIEW.y, ALTO));
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
    let y = PREVIEW.y + ALTO + 10;

    if (this.pestana !== "piel") {
      const parte = this.pestana;
      const rc = RECORTES[parte];
      const estilos = Object.entries(ESTILOS[parte]) as [string, string][];
      const caja = { w: 46, h: 54 };
      estilos.forEach(([estilo, nombre], i) => {
        const x = DERECHA + i * (caja.w + 6);
        const elegido = this.borrador[parte] === estilo;
        const k = texMini(parte, estilo);
        crearMiniatura(s, k, { ...this.borrador, [parte]: estilo } as Look, rc.dir, rc);
        const fondo = this.dinamico(pieza(s, elegido ? "campo-activo" : "campo", x, y, caja.w, caja.h), 2);
        if (!elegido) {
          fondo
            .setInteractive({ useHandCursor: true })
            .on("pointerover", () => fondo.setTexture("ui:campo-activo"))
            .on("pointerout", () => fondo.setTexture("ui:campo"))
            .on("pointerup", () => this.elegir(parte, estilo));
        }
        this.dinamico(s.add.image(x + caja.w / 2, y + caja.h / 2, k).setOrigin(0.5), 3);
        if (elegido) this.dinamico(texto(s, DERECHA, y + caja.h + 4, nombre, { color: UI.titulo }), 3);
      });
      y += caja.h + 28;
    }

    // Colores
    const { campo, catalogo } = COLOR_DE[this.pestana];
    this.dinamico(texto(s, DERECHA, y, this.pestana === "piel" ? "Tono de piel" : "Color", { color: UI.suave }), 3);
    y += 18;
    const grande = this.pestana === "piel";
    const lado = grande ? 28 : 18;
    const hueco = grande ? 6 : 4;
    const porFila = Math.floor((ANCHO_DER + hueco) / (lado + hueco));
    Object.entries(catalogo).forEach(([id, color], i) => {
      const x = DERECHA + (i % porFila) * (lado + hueco);
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
