import Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";

function arrancar(): void {
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
      // Tamaño CSS entero: con tamaños fraccionarios el navegador suaviza los
      // bordes del canvas y el píxel de art sale borroso.
      autoRound: true,
    },
    scene: [MainScene],
  });

  // Acceso en consola durante el desarrollo (depuración)
  if (import.meta.env.DEV) {
    (window as unknown as { __roomie: Phaser.Game }).__roomie = game;
  }
}

// La fuente pixel tiene que estar cargada ANTES de crear el juego: Phaser mide
// cada fuente la primera vez que la usa y se queda con esa medida, así que si
// midiera la de reserva todos los textos saldrían descolocados. Si la fuente
// fallara, el juego arranca igual con la monoespaciada del sistema.
document.fonts
  .load('16px "Roomie Pixel"')
  .catch(() => undefined)
  .then(arrancar);
