import Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 540,
  pixelArt: true,
  backgroundColor: "#12121a",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MainScene],
});

// Acceso en consola durante el desarrollo (depuración)
if (import.meta.env.DEV) {
  (window as unknown as { __roomie: Phaser.Game }).__roomie = game;
}
