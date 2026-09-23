import Phaser from "phaser";
import { DEFAULT_PALETTE, type Palette } from "../state/palette.ts";

// Avatar placeholder generado por código: spritesheet 4 frames × 3 direcciones
// + pose sentada. Los colores de ropa y pelo vienen de la paleta, así que se
// puede regenerar en caliente (botón C en el juego).
// La dirección "side" está dibujada mirando a la izquierda; usar flipX para
// la derecha.
export const FRAME_W = 16;
export const FRAME_H = 24;

const DIRS = ["down", "up", "side"] as const;
type Dir = (typeof DIRS)[number];

type Colors = {
  skin: number;
  hair: number;
  shirt: number;
  shirtDark: number;
  pants: number;
  pantsDark: number;
  shoes: number;
  eye: number;
};

function darken(hex: number, f = 0.75): number {
  const r = Math.floor(((hex >> 16) & 0xff) * f);
  const g = Math.floor(((hex >> 8) & 0xff) * f);
  const b = Math.floor((hex & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

function colorsFrom(palette: Palette): Colors {
  return {
    skin: 0xf2c9a5,
    hair: palette.hair,
    shirt: palette.shirt,
    shirtDark: darken(palette.shirt),
    pants: 0x2e3a59,
    pantsDark: 0x242c44,
    shoes: 0x14141c,
    eye: 0x1a1a24,
  };
}

function rect(
  g: Phaser.GameObjects.Graphics,
  ox: number,
  oy: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  g.fillStyle(color, 1);
  g.fillRect(ox + x, oy + y, w, h);
}

/** Pierna de 3px: pantalón + zapato. Si lifted, la pierna queda 1px más corta. */
function leg(
  g: Phaser.GameObjects.Graphics,
  C: Colors,
  ox: number,
  oy: number,
  x: number,
  lifted: boolean,
  color: number,
): void {
  const top = 18;
  if (lifted) {
    rect(g, ox, oy, x, top, 3, 3, color); // pantalón
    rect(g, ox, oy, x, top + 3, 3, 2, C.shoes); // zapato subido (hueco 1px abajo)
  } else {
    rect(g, ox, oy, x, top, 3, 4, color);
    rect(g, ox, oy, x, top + 4, 3, 2, C.shoes);
  }
}

function drawFrame(
  g: Phaser.GameObjects.Graphics,
  C: Colors,
  dir: Dir,
  frame: number,
  ox: number,
  oy: number,
): void {
  // Piernas: zancada alterna en frames 1 (derecha) y 3 (izquierda)
  const liftR = frame === 1;
  const liftL = frame === 3;

  if (dir === "side") {
    // Perfil: patas separadas horizontalmente (tijera)
    if (frame === 0 || frame === 2) {
      leg(g, C, ox, oy, 6, false, C.pants);
    } else {
      leg(g, C, ox, oy, 3, false, C.pantsDark); // pierna trasera
      leg(g, C, ox, oy, 9, false, C.pants); // pierna delantera
    }
  } else {
    leg(g, C, ox, oy, 5, liftL, C.pants);
    leg(g, C, ox, oy, 9, liftR, C.pants);
  }

  // Torso
  if (dir === "side") {
    rect(g, ox, oy, 4, 10, 7, 8, C.shirt);
    rect(g, ox, oy, 5, 10, 2, 6, C.shirtDark); // brazo
    rect(g, ox, oy, 5, 16, 2, 2, C.skin); // mano
  } else {
    rect(g, ox, oy, 3, 10, 10, 8, C.shirt);
    rect(g, ox, oy, 3, 10, 2, 6, C.shirtDark); // brazo izq.
    rect(g, ox, oy, 11, 10, 2, 6, C.shirtDark); // brazo der.
    rect(g, ox, oy, 3, 16, 2, 2, C.skin);
    rect(g, ox, oy, 11, 16, 2, 2, C.skin);
  }

  // Cabeza
  if (dir === "down") {
    rect(g, ox, oy, 4, 1, 8, 4, C.hair);
    rect(g, ox, oy, 4, 5, 8, 5, C.skin);
    rect(g, ox, oy, 6, 6, 1, 2, C.eye);
    rect(g, ox, oy, 9, 6, 1, 2, C.eye);
  } else if (dir === "up") {
    rect(g, ox, oy, 4, 1, 8, 9, C.hair); // pelo visto desde atrás
  } else {
    rect(g, ox, oy, 4, 1, 8, 3, C.hair);
    rect(g, ox, oy, 4, 4, 5, 6, C.skin);
    rect(g, ox, oy, 9, 4, 3, 6, C.hair);
    rect(g, ox, oy, 5, 6, 1, 2, C.eye);
  }
}

/** Pose sentada (de perfil, mirando a la izquierda): para el sofá */
function drawSit(g: Phaser.GameObjects.Graphics, C: Colors, ox: number, oy: number): void {
  // Piernas: muslo horizontal, espinilla colgando y pie
  rect(g, ox, oy, 4, 17, 7, 4, C.pants); // muslo + cadera
  rect(g, ox, oy, 4, 20, 3, 4, C.pants); // espinilla
  rect(g, ox, oy, 1, 21, 3, 3, C.shoes); // pie
  // Torso
  rect(g, ox, oy, 6, 10, 6, 7, C.shirt);
  rect(g, ox, oy, 7, 10, 2, 5, C.shirtDark); // brazo
  rect(g, ox, oy, 7, 15, 2, 2, C.skin); // mano
  // Cabeza de perfil
  rect(g, ox, oy, 5, 1, 8, 3, C.hair);
  rect(g, ox, oy, 5, 4, 5, 6, C.skin);
  rect(g, ox, oy, 10, 4, 3, 6, C.hair);
  rect(g, ox, oy, 6, 6, 1, 2, C.eye);
}

/**
 * (Re)genera la textura del avatar con la paleta dada y sus animaciones.
 * Si la textura ya existía se destruye (así se aplican los cambios de color
 * en caliente); los sprites que la usen deben volver a llamarse setTexture.
 */
export function createAvatarTexture(
  scene: Phaser.Scene,
  palette: Palette = DEFAULT_PALETTE,
): void {
  // Las animaciones guardan referencias DIRECTAS a los Frame de la textura.
  // Si solo se destruye la textura, esas referencias quedan con texture/source
  // a null y el primer play() tras reiniciar la escena rompe el render
  // (pantalla negra al cruzar una puerta). Se destruyen y recrean SIEMPRE
  // junto con la textura, para que apunten a los frames vigentes.
  const animKeys: string[] = DIRS.flatMap((d) => [`idle-${d}`, `walk-${d}`]);
  animKeys.push("idle-sit");
  for (const key of animKeys) {
    if (scene.anims.exists(key)) scene.anims.remove(key);
  }

  if (scene.textures.exists("avatar")) scene.textures.remove("avatar");
  const C = colorsFrom(palette);

  const g = scene.make.graphics({}, false);
  DIRS.forEach((dir, row) => {
    for (let frame = 0; frame < 4; frame++) {
      drawFrame(g, C, dir, frame, frame * FRAME_W, row * FRAME_H);
    }
  });
  drawSit(g, C, 0, DIRS.length * FRAME_H); // fila extra: sentado
  g.generateTexture("avatar", FRAME_W * 4, FRAME_H * (DIRS.length + 1));
  g.destroy();

  const tex = scene.textures.get("avatar");
  // Vecino más cercano: sin esto, al escalar el sprite ×2 los colores se
  // mezclan (muestreo lineal) y el muñeco se ve borroso.
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  DIRS.forEach((dir, row) => {
    for (let frame = 0; frame < 4; frame++) {
      tex.add(`${dir}-${frame}`, 0, frame * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
    }
  });
  tex.add("sit-0", 0, 0, DIRS.length * FRAME_H, FRAME_W, FRAME_H);

  for (const dir of DIRS) {
    scene.anims.create({
      key: `idle-${dir}`,
      frames: [{ key: "avatar", frame: `${dir}-0` }],
      frameRate: 1,
    });
    // 4 frames por ciclo y 3 celdas/s -> 12 fps sincroniza las patas con el
    // movimiento (a 8 deslizaban y se veía raro al caminar)
    scene.anims.create({
      key: `walk-${dir}`,
      frames: [0, 1, 2, 3].map((f) => ({ key: "avatar", frame: `${dir}-${f}` })),
      frameRate: 12,
      repeat: -1,
    });
  }

  scene.anims.create({
    key: "idle-sit",
    frames: [{ key: "avatar", frame: "sit-0" }],
    frameRate: 1,
  });
}
