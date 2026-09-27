import Phaser from "phaser";
import {
  ALTO_HOJA,
  ANCHO_HOJA,
  ANIMS,
  HOJA,
  capasDe,
  componer,
  ficheroCapa,
  marco,
  type Anim,
  type Capa,
} from "../render/avatarSheet";
import type { Facing } from "../state/avatarState";
import { DEFAULT_LOOK, ESTILOS, PARTES, type Look } from "../state/look";

// Avatar: capas generadas por `tools/genavatar.mjs` (cuerpo, peinados,
// prendas), combinadas y coloreadas en el navegador según el aspecto de cada
// jugador. Una textura por avatar: "avatar" para el propio y `avatar:<id>`
// para cada remoto. Las animaciones se registran con prefijo `${key}:`.

/** Todas las capas que existen: el cuerpo y cada estilo de cada parte */
export const TODAS_LAS_CAPAS: readonly string[] = [
  "cuerpo",
  ...PARTES.flatMap((p) => Object.keys(ESTILOS[p]).map((e) => `${p}/${e}`)),
];

/** Origen del sprite: los pies (el punto del suelo sobre el que está) */
export const ORIGEN = { x: HOJA.anclaX / HOJA.frameW, y: HOJA.anclaY / HOJA.frameH };

/** Altura del avatar de pie en píxeles (para colocar nombres y burbujas) */
export const ALTO_AVATAR = 64;

/**
 * Fotogramas por segundo al caminar. A 3 celdas/s (≈136 px/s) y con zancadas
 * de ±30° cada ciclo avanza ~40 px: 8 fotogramas a 26 fps dejan el pie de
 * apoyo casi quieto sobre el suelo. Más lento, los pies patinan.
 */
const FPS_CAMINAR = 26;
/** Ojos abiertos y parpadeo (ms) */
const ABIERTOS_MS = 3300;
const PARPADEO_MS = 130;

const texCapa = (nombre: string): string => `capa:${nombre}`;
const nombreFrame = (anim: Anim, dir: number, i: number): string => `${anim}-${dir}-${i}`;

/** Fotograma de reposo en una dirección (para `add.sprite` y `setTexture`) */
export const frameInicial = (dir: Facing): string => nombreFrame("idle", dir, 0);

/** Encola la descarga de las capas (una vez: sobreviven al reinicio de escena) */
export function preloadAvatar(scene: Phaser.Scene): void {
  for (const nombre of TODAS_LAS_CAPAS) {
    if (!scene.textures.exists(texCapa(nombre))) {
      scene.load.image(texCapa(nombre), `assets/avatar/${ficheroCapa(nombre)}`);
    }
  }
}

/**
 * Píxeles de una capa, leídos UNA vez y guardados. Las capas no son colores:
 * cada píxel lleva material, banda de luz y profundidad (ver avatarSheet.ts).
 * Los PNG no llevan perfil de color, así que el navegador no los retoca al
 * dibujarlos y los valores llegan intactos.
 */
const pixeles = new Map<string, Capa>();

function capa(scene: Phaser.Scene, nombre: string): Capa {
  const hecha = pixeles.get(nombre);
  if (hecha) return hecha;
  const img = scene.textures.get(texCapa(nombre)).getSourceImage() as HTMLImageElement;
  const lienzo = document.createElement("canvas");
  lienzo.width = img.width;
  lienzo.height = img.height;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("sin contexto 2D");
  ctx.drawImage(img, 0, 0);
  const c: Capa = { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
  pixeles.set(nombre, c);
  return c;
}

/** Vuelca RGBA en una textura de lienzo nueva (sustituye a la que hubiera) */
function texturaDesde(scene: Phaser.Scene, key: string, rgba: Uint8ClampedArray, w: number, h: number) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`no se pudo crear la textura ${key}`);
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  // Vecino más cercano: con muestreo lineal el pixel art se emborrona
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return tex;
}

/**
 * (Re)genera la textura de un avatar con su aspecto y sus animaciones.
 * Si ya existía se sustituye (así se aplican los cambios del vestidor en
 * caliente); los sprites que la usen deben volver a llamar a `setTexture`.
 */
export function createAvatarTexture(scene: Phaser.Scene, look: Look = DEFAULT_LOOK, key = "avatar"): void {
  // Las animaciones guardan referencias DIRECTAS a los Frame de la textura.
  // Si solo se destruye la textura, esas referencias quedan con texture/source
  // a null y el primer play() tras reiniciar la escena rompe el render
  // (pantalla negra al cruzar una puerta). Se destruyen y recrean SIEMPRE
  // junto con la textura, para que apunten a los frames vigentes.
  for (const k of avatarAnimKeys(key)) {
    if (scene.anims.exists(k)) scene.anims.remove(k);
  }

  const rgba = componer(
    capasDe(look).map((n) => capa(scene, n)),
    look,
  );
  const tex = texturaDesde(scene, key, rgba, ANCHO_HOJA, ALTO_HOJA);

  for (let dir = 0; dir < HOJA.dirs; dir++) {
    for (const anim of ANIMS) {
      for (let i = 0; i < HOJA.anims[anim].n; i++) {
        const m = marco(anim, i, dir);
        tex.add(nombreFrame(anim, dir, i), 0, m.x, m.y, HOJA.frameW, HOJA.frameH);
      }
    }

    const f = (anim: Anim, i: number, duration = 0) => ({ key, frame: nombreFrame(anim, dir, i), duration });
    // Quieto y sentado: ojos abiertos un buen rato y un parpadeo corto
    scene.anims.create({
      key: animKey(key, `idle-${dir}`),
      frames: [f("idle", 0, ABIERTOS_MS), f("idle", 1, PARPADEO_MS)],
      frameRate: 1000,
      repeat: -1,
    });
    scene.anims.create({
      key: animKey(key, `sit-${dir}`),
      frames: [f("sit", 0, ABIERTOS_MS), f("sit", 1, PARPADEO_MS)],
      frameRate: 1000,
      repeat: -1,
    });
    scene.anims.create({
      key: animKey(key, `walk-${dir}`),
      frames: Array.from({ length: HOJA.anims.walk.n }, (_, i) => f("walk", i)),
      frameRate: FPS_CAMINAR,
      repeat: -1,
    });
    scene.anims.create({
      key: animKey(key, `wave-${dir}`),
      frames: [f("wave", 0), f("wave", 1)],
      frameRate: 5,
      repeat: -1,
    });
  }
}

/** Nombre de animación para una textura de avatar dada (`avatar:walk-3`) */
export function animKey(textureKey: string, name: string): string {
  return `${textureKey}:${name}`;
}

/** Todas las animaciones que genera `createAvatarTexture` para una textura */
export function avatarAnimKeys(textureKey: string): string[] {
  const keys: string[] = [];
  for (let d = 0; d < HOJA.dirs; d++) {
    for (const a of ["idle", "sit", "walk", "wave"]) keys.push(animKey(textureKey, `${a}-${d}`));
  }
  return keys;
}

/** Borra la textura y las animaciones de un avatar (p. ej. al desconectarse) */
export function destroyAvatarAssets(scene: Phaser.Scene, textureKey: string): void {
  for (const k of avatarAnimKeys(textureKey)) {
    if (scene.anims.exists(k)) scene.anims.remove(k);
  }
  if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
}

/**
 * Miniatura: un trozo de un fotograma quieto, para los botones del vestidor.
 * Sólo se combina ese trozo, así que cuesta poco rehacerla a cada cambio.
 */
export function crearMiniatura(
  scene: Phaser.Scene,
  key: string,
  look: Look,
  dir: Facing,
  recorte: { x: number; y: number; w: number; h: number },
): void {
  const m = marco("idle", 0, dir);
  const region = { x: m.x + recorte.x, y: m.y + recorte.y, w: recorte.w, h: recorte.h };
  const rgba = componer(
    capasDe(look).map((n) => capa(scene, n)),
    look,
    region,
  );
  texturaDesde(scene, key, rgba, recorte.w, recorte.h);
}
