import Phaser from "phaser";

// Avatar placeholder generado por código: spritesheet 4 frames × 3 direcciones.
// Dirección "side" dibujada mirando a la izquierda; usar flipX para la derecha.
// Se reemplazará por arte definitivo sin tocar el resto del juego.
export const FRAME_W = 16;
export const FRAME_H = 24;

const C = {
  skin: 0xf2c9a5,
  hair: 0x4a3226,
  shirt: 0x6c5ce7,
  shirtDark: 0x5a4bd0,
  pants: 0x2e3a59,
  pantsDark: 0x242c44,
  shoes: 0x14141c,
  eye: 0x1a1a24,
};

const DIRS = ["down", "up", "side"] as const;
type Dir = (typeof DIRS)[number];

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
      leg(g, ox, oy, 6, false, C.pants);
    } else {
      leg(g, ox, oy, 3, false, C.pantsDark); // pierna trasera
      leg(g, ox, oy, 9, false, C.pants); // pierna delantera
    }
  } else {
    leg(g, ox, oy, 5, liftL, C.pants);
    leg(g, ox, oy, 9, liftR, C.pants);
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
function drawSit(g: Phaser.GameObjects.Graphics, ox: number, oy: number): void {
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

/** Crea la textura del avatar y sus animaciones (idle/walk por dirección). */
export function createAvatarTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists("avatar")) return;

  const g = scene.make.graphics({}, false);
  DIRS.forEach((dir, row) => {
    for (let frame = 0; frame < 4; frame++) {
      drawFrame(g, dir, frame, frame * FRAME_W, row * FRAME_H);
    }
  });
  drawSit(g, 0, DIRS.length * FRAME_H); // fila extra: sentado
  g.generateTexture("avatar", FRAME_W * 4, FRAME_H * (DIRS.length + 1));
  g.destroy();

  const tex = scene.textures.get("avatar");
  DIRS.forEach((dir, row) => {
    for (let frame = 0; frame < 4; frame++) {
      tex.add(`${dir}-${frame}`, 0, frame * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
    }
  });
  tex.add("sit-0", 0, 0, DIRS.length * FRAME_H, FRAME_W, FRAME_H);

  for (const dir of DIRS) {
    if (!scene.anims.exists(`idle-${dir}`)) {
      scene.anims.create({
        key: `idle-${dir}`,
        frames: [{ key: "avatar", frame: `${dir}-0` }],
        frameRate: 1,
      });
    }
    if (!scene.anims.exists(`walk-${dir}`)) {
      scene.anims.create({
        key: `walk-${dir}`,
        frames: [0, 1, 2, 3].map((f) => ({ key: "avatar", frame: `${dir}-${f}` })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  if (!scene.anims.exists("idle-sit")) {
    scene.anims.create({
      key: "idle-sit",
      frames: [{ key: "avatar", frame: "sit-0" }],
      frameRate: 1,
    });
  }
}
