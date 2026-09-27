// La pantalla: si se toca con el dedo o con el ratón, y las medidas de la
// interfaz que dependen de eso. Todo lo que se coloca en pantalla pregunta
// aquí, nunca a un 960×540 escrito a mano: el lienzo mide lo que mida la
// ventana (ver `src/main.ts`), en vertical o en horizontal.

/** ¿Se usa con el dedo? (móvil o tableta) */
export function esTactil(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Una pantalla estrecha (un móvil en vertical): los botones van abajo, al alcance del pulgar */
export const esEstrecha = (ancho: number): boolean => ancho < 640;

export type Medidas = {
  tactil: boolean;
  /** Lado de los botones del HUD */
  boton: number;
  /** Hueco entre botones */
  hueco: number;
  /** Alto de las filas de botones de paneles y listas (pestañas, frases, tienda) */
  fila: number;
  /** Alto de la barra de escritura del chat */
  barra: number;
  /** Margen con el borde de la pantalla */
  margen: number;
  /**
   * Cuánto crece la zona que se puede tocar alrededor de cada botón, por
   * cada lado. Con el dedo, un botón de 34 px se acierta; uno de 24, no
   * siempre: la zona de toque es mayor que el dibujo.
   */
  toque: number;
};

/** Las medidas de la interfaz: con el dedo, todo lo que se toca es más grande */
export function medidas(tactil = esTactil()): Medidas {
  return tactil
    ? { tactil, boton: 34, hueco: 6, fila: 30, barra: 32, margen: 8, toque: 5 }
    : { tactil, boton: 24, hueco: 4, fila: 22, barra: 24, margen: 8, toque: 0 };
}
