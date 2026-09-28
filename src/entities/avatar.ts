import Phaser from "phaser";
import {
  ALTO_HOJA,
  ANCHO_HOJA,
  ANIMS,
  HOJA,
  TODAS_LAS_CAPAS,
  capasDe,
  componer,
  ficheroCapa,
  marco,
  type Anim,
  type Capa,
} from "../render/avatarSheet";
import { pixelesDe, texturaDesde } from "../render/texturas";
import { leerDatosCara, type DatosCara } from "../render/cara";
import type { Facing } from "../state/avatarState";
import { DEFAULT_LOOK, type Look } from "../state/look";

// Avatar: capas generadas por `tools/genavatar.mjs` (cuerpo, cabezas,
// peinados, prendas), combinadas y coloreadas en el navegador según el
// aspecto de cada jugador, con la cara pintada encima (`src/render/cara.ts`).
// Una textura por avatar: "avatar" para el propio y `avatar:<id>` para cada
// remoto. Las animaciones se registran con prefijo `${key}:`.

/** Las anclas de la cara (dónde cae cada rasgo en cada fotograma), en la caché de JSON */
const CLAVE_CARA = "avatar:cara";
let datosCara: DatosCara | null = null;

/** Las anclas de la cara, leídas una vez (null si aún no han llegado: se dibuja sin cara) */
function cara(scene: Phaser.Scene): DatosCara | null {
  if (!datosCara && scene.cache.json.exists(CLAVE_CARA)) datosCara = leerDatosCara(scene.cache.json.get(CLAVE_CARA));
  return datosCara;
}

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

/** Encola la descarga de las capas y las anclas de la cara (una vez: sobreviven al reinicio de escena) */
export function preloadAvatar(scene: Phaser.Scene): void {
  for (const nombre of TODAS_LAS_CAPAS) {
    if (!scene.textures.exists(texCapa(nombre))) {
      scene.load.image(texCapa(nombre), `assets/avatar/${ficheroCapa(nombre)}`);
    }
  }
  if (!scene.cache.json.exists(CLAVE_CARA)) scene.load.json(CLAVE_CARA, "assets/avatar/cara.json");
}

/** Píxeles de una capa del avatar (material, luz y profundidad) */
const capa = (scene: Phaser.Scene, nombre: string): Capa => pixelesDe(scene, texCapa(nombre));

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
    cara(scene),
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
 * Miniatura: un trozo de un fotograma quieto, para los botones del vestidor
 * y el retrato del perfil. Sólo se combina ese trozo, así que cuesta poco
 * rehacerla a cada cambio.
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
    cara(scene),
    region,
  );
  texturaDesde(scene, key, rgba, recorte.w, recorte.h);
}

/** Recortes de un fotograma de pie (48×84, los pies en 24,77) para miniaturas y retratos */
export const RECORTE = {
  /** La cabeza entera, con la barbilla y algo de hombros */
  cabeza: { x: 8, y: 10, w: 32, h: 34 },
  /** La cara de cerca */
  cara: { x: 11, y: 18, w: 26, h: 24 },
  /** Busto: cabeza y hombros (el retrato del perfil) */
  busto: { x: 4, y: 6, w: 40, h: 46 },
} as const;
