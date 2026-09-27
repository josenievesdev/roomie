import Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";

/**
 * El tamaño del juego sale de la ventana, no de un 960×540 fijo: así llena
 * la pantalla de un móvil en vertical, en horizontal o de un monitor.
 *
 * Cada píxel del juego se pinta como `escala` píxeles de pantalla, y la
 * escala es ENTERA: con ×1,5 unos píxeles del arte saldrían dobles y otros
 * sencillos, y el pixel art se deforma. Se busca que el juego mida unos 540
 * de alto (un monitor de 1080 → ×2, como siempre), sin bajar de 420 de ancho
 * (en un móvil en vertical, ×1).
 */
function medir(): { ancho: number; alto: number; escala: number } {
  const vw = Math.max(1, Math.floor(window.innerWidth));
  const vh = Math.max(1, Math.floor(window.innerHeight));
  const escala = Math.max(1, Math.min(Math.round(vh / 540), Math.floor(vw / 420)));
  return { ancho: Math.floor(vw / escala), alto: Math.floor(vh / escala), escala };
}

function arrancar(): void {
  const m = medir();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: m.ancho,
    height: m.alto,
    pixelArt: true,
    backgroundColor: "#12121a",
    // El tamaño lo lleva este fichero (ver `medir`): Phaser sólo lo aplica
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: m.escala,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    // Dos dedos a la vez: para pellizcar y hacer zoom
    input: { activePointers: 3 },
    scene: [MainScene],
  });

  // Al girar el móvil o cambiar la ventana, el juego se ajusta. Pero NO con el
  // teclado del móvil abierto: al escribir en el chat, el teclado encoge la
  // ventana y la interfaz entera se movería mientras escribes. Al cerrarlo
  // (se suelta el campo de texto) se ajusta.
  let pendiente = 0;
  const ajustar = (): void => {
    window.clearTimeout(pendiente);
    pendiente = window.setTimeout(() => {
      if (document.activeElement instanceof HTMLInputElement) return;
      const n = medir();
      if (n.ancho === game.scale.width && n.alto === game.scale.height && n.escala === game.scale.zoom) return;
      // En el modo NONE, Phaser sólo pone el tamaño CSS del lienzo al cambiar
      // el zoom (`setZoom`), no al cambiar el tamaño: con `setZoom` y luego
      // `resize`, el lienzo se quedaba con la medida de antes de girar el
      // móvil. Así, zoom y tamaño CSS van primero y `resize` los recoge (y
      // avisa una sola vez a la escena).
      game.scale.zoom = n.escala;
      game.canvas.style.width = `${n.ancho * n.escala}px`;
      game.canvas.style.height = `${n.alto * n.escala}px`;
      game.scale.resize(n.ancho, n.alto);
    }, 150);
  };
  window.addEventListener("resize", ajustar);
  window.addEventListener("orientationchange", ajustar);
  document.addEventListener("focusout", ajustar);

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
  .load('12px "Roomie Pixel"')
  .catch(() => undefined)
  .then(arrancar);
