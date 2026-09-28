import Phaser from "phaser";
import { LAYER } from "../render/layers";
import { RAMPAS, type Look } from "../state/look";
import { animKey, createAvatarTexture, destroyAvatarAssets, frameInicial, ORIGEN, RECORTE } from "../entities/avatar";
import { anchoTexto, boton, icono, pieza, texto, UI, UI_HEX, yCentrada } from "./kit";
import { medidas } from "./pantalla";

// La ficha de un perfil: la tuya (con tu dinero, tu casa y los botones para
// cambiar de aspecto o cerrar sesión) o la de otro jugador de la sala (sólo lo
// de `PerfilPublico`: su nombre, su aspecto y desde cuándo juega).
//
// El retrato es tu avatar de verdad, de medio cuerpo y al doble, parpadeando,
// sobre un fondo del color de tu ropa: la ficha se parece a quien la lleva.
//
// Objetos sueltos con scrollFactor(0), nunca un Container (ver CLAUDE.md).

export type DatosPerfil = {
  nombre: string;
  look: Look;
  /** "AAAA-MM": desde cuándo tiene la cuenta */
  desde: string | null;
  /** Sólo en el tuyo */
  propio?: { usuario: string; monedas: number; creditos: number; tieneCasa: boolean };
};

export type OpcionesPerfil = {
  datos: DatosPerfil;
  alCerrar: () => void;
  /** Sólo en el tuyo */
  alVestidor?: () => void;
  alCerrarSesion?: () => void;
};

const TEX_RETRATO = "avatar:retrato";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-09" → "septiembre de 2026" (null si no se entiende) */
export function mesYAnio(desde: string | null): string | null {
  const m = desde ? /^(\d{4})-(\d{2})$/.exec(desde) : null;
  if (!m) return null;
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${mes} de ${m[1]}` : null;
}

type Fijable = Phaser.GameObjects.GameObject & { setScrollFactor(v: number): Fijable; setDepth(v: number): Fijable };

export class FichaPerfil {
  private scene: Phaser.Scene;
  private objetos: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, o: OpcionesPerfil) {
    this.scene = scene;
    this.construir(o);
  }

  destroy(): void {
    for (const obj of this.objetos) obj.destroy();
    this.objetos = [];
    destroyAvatarAssets(this.scene, TEX_RETRATO);
  }

  private poner<T extends Phaser.GameObjects.GameObject>(o: T, capa = 1): T {
    (o as unknown as Fijable).setScrollFactor(0).setDepth(LAYER.UI_PANEL + capa);
    this.objetos.push(o);
    return o;
  }

  private construir(o: OpcionesPerfil): void {
    const s = this.scene;
    const m = medidas();
    const W = s.scale.width;
    const H = s.scale.height;
    const d = o.datos;
    const propio = d.propio;

    // ---- Medidas: el retrato a la izquierda y los datos a su lado
    const PAD = 14;
    const cab = m.tactil ? 36 : 30;
    const r = RECORTE.busto;
    const escalaRetrato = 2;
    const retratoW = r.w * escalaRetrato + 8;
    const retratoH = r.h * escalaRetrato + 8;
    // La tuya lleva tu dinero y dos botones; la de otro, sólo su retrato y su nombre
    const w = Math.min(propio ? 360 : 300, W - 16);
    const altoBoton = m.fila + 4;
    const ALTO_STAT = 44;
    // Tu dinero va bajo el retrato, y los botones debajo; en el de otro, sólo el retrato
    const yStats = cab + retratoH + PAD - 4;
    const h = propio ? yStats + ALTO_STAT + 12 + altoBoton + PAD : cab + retratoH + PAD;
    const x0 = Math.round((W - w) / 2);
    const y0 = Math.round(Math.max(8, (H - h) / 2));

    // ---- Velo (tocar fuera cierra) y panel
    const velo = this.poner(s.add.rectangle(W / 2, H / 2, W, H, UI_HEX.velo, 0.55).setInteractive(), 0);
    velo.on("pointerup", () => o.alCerrar());
    this.poner(pieza(s, "panel", x0, y0, w, h).setInteractive(), 1);
    this.poner(icono(s, "rombo", x0 + 12, y0 + Math.round(cab / 2) - 2), 2);
    this.poner(texto(s, x0 + 26, yCentrada(y0 + 2, cab), propio ? "Tu perfil" : "Perfil", { color: UI.titulo }), 2);
    const lado = m.tactil ? 28 : 20;
    this.objetos.push(
      ...boton(s, x0 + w - 8 - lado, y0 + Math.round((cab - lado) / 2) + 1, lado, lado, "", () => o.alCerrar(), {
        icono: "cerrar",
        capa: LAYER.UI_PANEL + 3,
      }).objetos,
    );

    // ---- El retrato: un marco hundido con el color de su ropa de fondo y
    // una franja de suelo, y el avatar de medio cuerpo, parpadeando
    const rx = x0 + PAD;
    const ry = y0 + cab;
    const tono = RAMPAS.ropa[d.look.torsoColor];
    this.poner(pieza(s, "campo", rx, ry, retratoW, retratoH), 2);
    this.poner(s.add.rectangle(rx + 2, ry + 2, retratoW - 4, retratoH - 4, tono[4], 0.9).setOrigin(0, 0), 3);
    this.poner(s.add.rectangle(rx + 2, ry + retratoH - 20, retratoW - 4, 18, tono[3], 0.9).setOrigin(0, 0), 3);
    this.poner(s.add.rectangle(rx + 2, ry + retratoH - 21, retratoW - 4, 1, tono[2], 0.9).setOrigin(0, 0), 3);
    createAvatarTexture(s, d.look, TEX_RETRATO);
    const retrato = this.poner(s.add.sprite(0, 0, TEX_RETRATO, frameInicial(4)).setOrigin(ORIGEN.x, ORIGEN.y), 4);
    retrato.setCrop(r.x, r.y, r.w, r.h).setScale(escalaRetrato);
    // El trozo recortado, centrado en el marco (el origen del sprite está en los pies)
    const cx = r.x + r.w / 2 - ORIGEN.x * 48;
    const cy = r.y + r.h / 2 - ORIGEN.y * 84;
    retrato.setPosition(Math.round(rx + retratoW / 2 - cx * escalaRetrato), Math.round(ry + retratoH / 2 - cy * escalaRetrato));
    retrato.play(animKey(TEX_RETRATO, "idle-4"));

    // ---- Los datos, a la derecha del retrato
    const tx = rx + retratoW + 12;
    const anchoTexto0 = x0 + w - PAD - tx;
    const recortar = (t: string): string => {
      let r0 = t;
      while (anchoTexto(r0) > anchoTexto0 && r0.length > 3) r0 = r0.slice(0, -2) + "…";
      return r0;
    };
    let y = ry + 4;
    this.poner(texto(s, tx, y, recortar(d.nombre), { color: UI.titulo }), 3);
    y += 16;
    if (propio) {
      this.poner(texto(s, tx, y, recortar(`@${propio.usuario}`), { color: UI.suave }), 3);
      y += 16;
    }
    y += 6;
    this.poner(s.add.rectangle(tx, y, anchoTexto0, 1, UI_HEX.borde).setOrigin(0, 0), 3);
    y += 9;

    const linea = (nombreIcono: string, contenido: string, color: string = UI.texto): void => {
      this.poner(icono(s, nombreIcono, tx, y + 2), 3);
      const t = this.poner(texto(s, tx + 16, y, "", { color }), 3);
      // Hasta dos líneas: se parte por palabras
      const palabras = contenido.split(" ");
      const lineas: string[] = [];
      let actual = "";
      for (const p of palabras) {
        const prueba = actual ? `${actual} ${p}` : p;
        if (anchoTexto(prueba) > anchoTexto0 - 16 && actual) {
          lineas.push(actual);
          actual = p;
        } else actual = prueba;
      }
      if (actual) lineas.push(actual);
      t.setText(lineas.slice(0, 2).join("\n"));
      y += 16 * Math.min(2, lineas.length) + 4;
    };
    const desde = mesYAnio(d.desde);
    if (desde) linea("rombo", `En Roomie desde ${desde}`);
    if (propio) linea("casa", propio.tieneCasa ? "Vive en el Edificio Roomie" : "Todavía sin casa", propio.tieneCasa ? UI.texto : UI.suave);

    if (!propio) return;

    // ---- Tu dinero: dos pastillas, monedas y créditos
    const ys = y0 + yStats;
    const anchoStat = Math.floor((w - PAD * 2 - 8) / 2);
    const stat = (x: number, valor: string, etiqueta: string, nombreIcono: string | null, color: string) => {
      this.poner(pieza(s, "chip", x, ys, anchoStat, ALTO_STAT), 2);
      const ix = x + 12;
      if (nombreIcono) this.poner(icono(s, nombreIcono, ix, ys + 11), 3);
      const vt = this.poner(texto(s, nombreIcono ? ix + 14 : ix, ys + 6, valor, { color }), 3);
      this.poner(texto(s, vt.x, ys + 22, etiqueta, { color: UI.suave }), 3);
    };
    stat(x0 + PAD, String(propio.monedas), "monedas", "moneda", UI.titulo);
    stat(x0 + PAD + anchoStat + 8, `◆ ${propio.creditos}`, "créditos", null, UI.acento);

    // ---- Botones
    const yb = ys + ALTO_STAT + 12;
    const anchoB = Math.floor((w - PAD * 2 - 8) / 2);
    this.objetos.push(
      ...boton(s, x0 + PAD, yb, anchoB, altoBoton, "Cambiar aspecto", () => o.alVestidor?.(), {
        primario: true,
        icono: "camiseta",
        capa: LAYER.UI_PANEL + 3,
      }).objetos,
      ...boton(s, x0 + PAD + anchoB + 8, yb, anchoB, altoBoton, "Cerrar sesión", () => o.alCerrarSesion?.(), {
        capa: LAYER.UI_PANEL + 3,
      }).objetos,
    );
  }
}
