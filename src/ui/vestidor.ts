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

const C = {
  fondo: 0x12121a,
  caja: 0x1a1a2e,
  cajaHover: 0x2a2a4e,
  borde: 0x6d6d94,
  bordeSuave: 0x3a3a55,
  seleccion: 0xffe9a8,
  primario: 0x6c5ce7,
  primarioHover: 0x8c7ce7,
  texto: "#ffffff",
  titulo: "#ffe9a8",
  suave: "#9a9ad0",
} as const;

export type OpcionesVestidor = {
  look: Look;
  titulo?: string;
  subtitulo?: string;
  onGuardar: (look: Look) => void;
  onCerrar: () => void;
};

/** Medidas del panel (lienzo de 960×540) */
const W = 560;
const H = 344;
const X0 = 480 - W / 2;
const Y0 = 270 - H / 2;
const PREVIEW = { x: X0 + 20, y: Y0 + 56, w: 180, h: 228 };
const DERECHA = X0 + 218;
const ANCHO_DER = W - 238;

export class Vestidor {
  private fijos: Phaser.GameObjects.GameObject[] = [];
  private dinamicos: Phaser.GameObjects.GameObject[] = [];
  private botonesPestana = new Map<Pestana, Phaser.GameObjects.Rectangle>();
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
    for (const obj of [...this.dinamicos, ...this.fijos]) obj.destroy();
    this.dinamicos = [];
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
    this.dir = (((this.dir + paso) % 8) + 8) % 8 as Facing;
    this.repintarPreview();
  }

  // ---------------------------------------------------------------- Construcción

  private fijo<T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(
    o: T,
    capa = 1,
  ): T {
    o.setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
    this.fijos.push(o);
    return o;
  }

  private dinamico<T extends Phaser.GameObjects.GameObject & { setScrollFactor(v: number): T; setDepth(v: number): T }>(
    o: T,
    capa = 2,
  ): T {
    o.setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
    this.dinamicos.push(o);
    return o;
  }

  private texto(x: number, y: number, t: string, tam = 12, color: string = C.texto): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, t, { fontFamily: "monospace", fontSize: `${tam}px`, color });
  }

  private boton(
    x: number,
    y: number,
    w: number,
    h: number,
    etiqueta: string,
    alPulsar: () => void,
    primario = false,
  ): void {
    const relleno = primario ? C.primario : C.caja;
    const hover = primario ? C.primarioHover : C.cajaHover;
    const r = this.fijo(
      this.scene.add
        .rectangle(x + w / 2, y + h / 2, w, h, relleno, 1)
        .setStrokeStyle(1, primario ? C.primarioHover : C.borde, 1)
        .setInteractive({ useHandCursor: true })
        .on("pointerover", () => r.setFillStyle(hover, 1))
        .on("pointerout", () => r.setFillStyle(relleno, 1))
        .on("pointerdown", alPulsar),
    );
    this.fijo(this.texto(x + w / 2, y + h / 2, etiqueta).setOrigin(0.5), 2);
  }

  private construir(): void {
    const s = this.scene;
    // Velo: tapa el mundo y se come los clics (nada de caminar detrás)
    this.fijo(s.add.rectangle(480, 270, 960, 540, 0x000000, 0.5).setInteractive(), 0);
    this.fijo(s.add.rectangle(480, 270, W, H, C.fondo, 0.98).setStrokeStyle(2, C.borde, 1).setInteractive());

    this.fijo(this.texto(X0 + 20, Y0 + 16, this.o.titulo ?? "Vestidor", 16, C.titulo), 2);
    if (this.o.subtitulo) this.fijo(this.texto(X0 + 20, Y0 + 36, this.o.subtitulo, 11, C.suave), 2);

    // Vista previa: una baldosa y el avatar encima, a doble tamaño
    this.fijo(
      s.add
        .rectangle(PREVIEW.x + PREVIEW.w / 2, PREVIEW.y + PREVIEW.h / 2, PREVIEW.w, PREVIEW.h, 0x0d0d14, 1)
        .setStrokeStyle(1, C.bordeSuave, 1),
    );
    const suelo = this.fijo(s.add.graphics());
    const cx = PREVIEW.x + PREVIEW.w / 2;
    const cy = PREVIEW.y + PREVIEW.h - 44;
    suelo.fillStyle(0x2c6e74, 1);
    suelo.fillPoints(
      [
        { x: cx, y: cy - 22 },
        { x: cx + 44, y: cy },
        { x: cx, y: cy + 22 },
        { x: cx - 44, y: cy },
      ],
      true,
    );
    suelo.lineStyle(1, 0x3f8f96, 1);
    suelo.strokePoints(
      [
        { x: cx, y: cy - 22 },
        { x: cx + 44, y: cy },
        { x: cx, y: cy + 22 },
        { x: cx - 44, y: cy },
      ],
      true,
    );
    createAvatarTexture(s, this.borrador, TEX_PREVIEW);
    this.preview = this.fijo(
      s.add.sprite(cx, cy, TEX_PREVIEW, frameInicial(this.dir)).setOrigin(ORIGEN.x, ORIGEN.y).setScale(2),
      2,
    );
    this.preview.play(animKey(TEX_PREVIEW, `idle-${this.dir}`));
    this.boton(PREVIEW.x + 8, PREVIEW.y + PREVIEW.h - 30, 34, 24, "◀", () => this.girar(1));
    this.boton(PREVIEW.x + PREVIEW.w - 42, PREVIEW.y + PREVIEW.h - 30, 34, 24, "▶", () => this.girar(-1));

    // Pestañas
    const anchoP = (ANCHO_DER - 4 * 4) / 5;
    PESTANAS.forEach((p, i) => {
      const x = DERECHA + i * (anchoP + 4);
      const r = this.fijo(
        s.add
          .rectangle(x + anchoP / 2, Y0 + 68, anchoP, 24, C.caja, 1)
          .setStrokeStyle(1, C.bordeSuave, 1)
          .setInteractive({ useHandCursor: true })
          .on("pointerdown", () => this.cambiarPestana(p.id)),
      );
      this.botonesPestana.set(p.id, r);
      this.fijo(this.texto(x + anchoP / 2, Y0 + 68, p.titulo, 11).setOrigin(0.5), 2);
    });

    this.boton(X0 + W - 132, Y0 + H - 40, 112, 28, "Guardar", () => this.o.onGuardar({ ...this.borrador }), true);
    this.boton(X0 + W - 254, Y0 + H - 40, 112, 28, "Cancelar", () => this.o.onCerrar());

    this.cambiarPestana(this.pestana);
  }

  private cambiarPestana(p: Pestana): void {
    this.pestana = p;
    for (const [id, r] of this.botonesPestana) {
      const activa = id === p;
      r.setFillStyle(activa ? C.cajaHover : C.caja, 1).setStrokeStyle(activa ? 2 : 1, activa ? C.seleccion : C.bordeSuave, 1);
    }
    this.pintarOpciones();
  }

  // ---------------------------------------------------------------- Opciones

  /** Rehace estilos y colores de la pestaña actual con el borrador vigente */
  private pintarOpciones(): void {
    for (const o of this.dinamicos) o.destroy();
    this.dinamicos = [];
    const s = this.scene;
    let y = Y0 + 94;

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
        const fondo = this.dinamico(
          s.add
            .rectangle(x + caja.w / 2, y + caja.h / 2, caja.w, caja.h, elegido ? C.cajaHover : C.caja, 1)
            .setStrokeStyle(elegido ? 2 : 1, elegido ? C.seleccion : C.bordeSuave, 1)
            .setInteractive({ useHandCursor: true })
            .on("pointerover", () => !elegido && fondo.setFillStyle(C.cajaHover, 1))
            .on("pointerout", () => !elegido && fondo.setFillStyle(C.caja, 1))
            .on("pointerdown", () => this.elegir(parte, estilo)),
        );
        this.dinamico(s.add.image(x + caja.w / 2, y + caja.h / 2, k).setOrigin(0.5), 3);
        if (elegido) {
          this.dinamico(this.texto(DERECHA, y + caja.h + 6, nombre, 11, C.titulo), 3);
        }
      });
      y += caja.h + 30;
    }

    // Colores
    const { campo, catalogo } = COLOR_DE[this.pestana];
    this.dinamico(this.texto(DERECHA, y, this.pestana === "piel" ? "Tono de piel" : "Color", 11, C.suave), 3);
    y += 18;
    const grande = this.pestana === "piel";
    const lado = grande ? 30 : 20;
    const hueco = grande ? 8 : 4;
    const porFila = Math.floor((ANCHO_DER + hueco) / (lado + hueco));
    Object.entries(catalogo).forEach(([id, color], i) => {
      const x = DERECHA + (i % porFila) * (lado + hueco);
      const yy = y + Math.floor(i / porFila) * (lado + hueco);
      const elegido = this.borrador[campo] === id;
      this.dinamico(
        s.add
          .rectangle(x + lado / 2, yy + lado / 2, lado, lado, color, 1)
          .setStrokeStyle(elegido ? 2 : 1, elegido ? 0xffffff : 0x000000, 1)
          .setInteractive({ useHandCursor: true })
          .on("pointerdown", () => this.elegirColor(campo, id)),
        3,
      );
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
