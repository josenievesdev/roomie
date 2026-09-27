// Modelos 3D del mobiliario: la misma técnica que el avatar (piezas
// redondeadas de `tools/avatar/sdf.mjs`, fotografiadas con la cámara del
// juego), así que muebles y avatares comparten volumen, luz y contorno.
//
// Espacio del modelo: el origen es el CENTRO de la celda, en el suelo.
// +X hacia la derecha-abajo de la pantalla (eje col), +Z hacia la
// izquierda-abajo (eje row), +Y arriba. La celda va de -H a +H en X y en Z.
// Unidades ≈ píxeles: en vertical, 1 unidad son 0,87 px de pantalla.
//
// Los muebles miran a +Z (su frente, hacia abajo a la izquierda). Los de
// pared están pegados al plano z = -H (el borde trasero de la celda, donde se
// levanta el muro) y miran a +Z; el generador los gira para la otra pared.
//
// Los colores NO están aquí: cada pieza dice su material (`MAT_MUEBLE`) y la
// sala pone el tono con su tema (`src/render/muebleSheet.ts`).

import {
  add,
  boxAxes,
  capsule,
  cappedCone,
  cylinder,
  cylinderAB,
  ellipsoidAxes,
  mul,
  norm,
  roundBox,
  sphere,
  torus,
  cross,
  v3,
} from "../avatar/sdf.mjs";
import { MAT_MUEBLE as M } from "../../src/render/muebleSheet.ts";

/** Media celda en unidades del modelo (el eje col de 1 celda mide 45,25) */
export const H = 22.6;
/** Plano de la pared para los muebles que cuelgan de ella */
const P = -H;

const grupo = (mat, k, shapes, extra = {}) => ({ mat, k, shapes, ...extra });
const frac = (v) => v - Math.floor(v);

/** Azar con semilla: los libros salen iguales cada vez que se genera */
function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIBROS = [M.LIBRO_1, M.LIBRO_2, M.LIBRO_3, M.LIBRO_4];

// ================================================================= Suelo

/** Sillón mirando al suroeste: respaldo en el borde noreste, como el de antes */
function sofa() {
  const patas = [[15.5, 16], [-15.5, 16], [15.5, -15], [-15.5, -15]].map(([x, z]) =>
    cylinder(v3(x, 1, z), 1.6, 1, 0.4),
  );
  // Capitoné: botones hundidos en el cojín del respaldo
  const botones = [-5.5, 5.5].flatMap((x) => [21, 29.5].map((y) => sphere(v3(x, y, -5.9), 0.95)));
  return {
    grupos: [
      grupo(M.TAPIZADO, 1.6, [
        roundBox(v3(0, 7.5, 1.5), 19.5, 5.5, 17.5, 2.5), // base
        roundBox(v3(0, 25, -13.8), 19.5, 15.5, 4.4, 3.5), // respaldo
        roundBox(v3(16.3, 19.5, 1.5), 3.9, 7.5, 17.5, 3.2), // brazos
        roundBox(v3(-16.3, 19.5, 1.5), 3.9, 7.5, 17.5, 3.2),
      ]),
      // Los cojines van aparte: así el contorno los separa del armazón
      grupo(M.TAPIZADO, 0.5, [roundBox(v3(0, 15.4, 4.2), 12.2, 3.2, 13.2, 2.8)]),
      grupo(M.TAPIZADO, 0.5, [roundBox(v3(0, 25.5, -8.8), 12.2, 10.5, 2.8, 2.6)]),
      grupo(M.TAPIZADO_B, 0.1, botones),
      grupo(M.MADERA_OSC, 0.3, patas),
    ],
    sombra: { rx: 27, ry: 12 },
  };
}

/** Mesa baja con balda, un jarrón con flor y un par de revistas */
function mesa() {
  // Tablones en la tapa
  const vetas = (x, y, z) => (y > 17.6 && frac((z + 13) / 5.2) < 0.13 ? M.MADERA_OSC : M.MADERA);
  const patas = [[13.6, 9.6], [-13.6, 9.6], [13.6, -9.6], [-13.6, -9.6]].map(([x, z]) =>
    roundBox(v3(x, 8.2, z), 1.3, 8.2, 1.3, 0.5),
  );
  const ladeada = norm(v3(1, 0, 0.32));
  return {
    grupos: [
      grupo(M.MADERA, 0.4, [roundBox(v3(0, 18.6, 0), 17, 1.6, 13, 0.7), roundBox(v3(0, 16.3, 0), 15.6, 1.1, 11.6, 0.4)], {
        matFn: vetas,
      }),
      grupo(M.MADERA_OSC, 0.3, [...patas, roundBox(v3(0, 5.2, 0), 13.6, 0.7, 9.6, 0.3)]),
      grupo(M.ACENTO, 0.5, [cylinder(v3(7, 22.8, -3.5), 2.1, 2.5, 0.9)]),
      grupo(M.PLANTA, 0.1, [capsule(v3(7, 24.8, -3.5), v3(7.6, 30.6, -3.8), 0.4)]),
      grupo(M.LIBRO_1, 0.1, [sphere(v3(7.7, 31.4, -3.8), 1.8)]),
      grupo(M.PAPEL, 0.1, [roundBox(v3(-5.5, 20.7, 3), 5, 0.45, 3.6, 0.2)]),
      grupo(M.LIBRO_2, 0.1, [boxAxes(v3(-6.3, 21.5, 2.4), ladeada, v3(0, 1, 0), norm(cross(ladeada, v3(0, 1, 0))), v3(4.6, 0.4, 3.3), 0.2)]),
    ],
    sombra: { rx: 24, ry: 11 },
  };
}

/** Tramo de barra: los tramos seguidos se tocan (ocupa toda la celda en Z) */
function barra() {
  // Paneles verticales en la cara que se ve (+X)
  const paneles = (x, y, z) => (x > 14.6 && frac((z + H) / ((2 * H) / 3)) < 0.06 ? M.MADERA_OSC : M.MADERA);
  return {
    grupos: [
      grupo(M.MADERA, 0.2, [roundBox(v3(-1, 20.5, 0), 16, 19.5, H, 1.0)], { matFn: paneles }),
      grupo(M.MADERA_OSC, 0.2, [roundBox(v3(0, 42.2, 0), 18.6, 2.2, H, 0.9), roundBox(v3(-0.5, 2.2, 0), 15.2, 2.2, H, 0.5)]),
      // Franja de luz: latón en la plaza, neón en el club
      grupo(M.ACENTO, 0.1, [roundBox(v3(15.2, 31.5, 0), 0.5, 1.3, H - 0.6, 0.2)], { emisivo: true }),
      grupo(M.METAL, 0.3, [
        capsule(v3(18.6, 7.5, -H), v3(18.6, 7.5, H), 1.1),
        capsule(v3(14.8, 7.5, -12), v3(18.6, 7.5, -12), 0.7),
        capsule(v3(14.8, 7.5, 12), v3(18.6, 7.5, 12), 0.7),
      ]),
    ],
    sombra: null,
  };
}

/** Taburete de barra: cojín, poste, aro para los pies y peana */
function taburete() {
  const radios = [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    return capsule(v3(0, 12, 0), v3(Math.cos(a) * 6.8, 12, Math.sin(a) * 6.8), 0.45);
  });
  return {
    grupos: [
      grupo(M.TAPIZADO, 1.5, [cylinder(v3(0, 33.2, 0), 9.4, 2.3, 1.9)]),
      grupo(M.METAL, 0.6, [
        cylinder(v3(0, 30.3, 0), 7.2, 0.8, 0.3),
        cylinder(v3(0, 16, 0), 1.6, 14.2, 0.4),
        torus(v3(0, 12, 0), 6.8, 0.8),
        ...radios,
        cylinder(v3(0, 1, 0), 8.2, 1, 0.7),
      ]),
    ],
    sombra: { rx: 13, ry: 6 },
  };
}

/** Planta en maceta: hojas largas en espiral, de dos verdes */
function planta() {
  const r = azar(7);
  const hojas = [];
  const claras = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996 + r() * 0.3; // ángulo áureo: sin huecos ni filas
    const inclina = (0.12 + 0.78 * (i / (N - 1))) * (Math.PI / 2) * 0.95;
    const largo = 21 - 8 * (i / (N - 1)) + r() * 2.5;
    const dir = norm(v3(Math.sin(inclina) * Math.cos(a), Math.cos(inclina), Math.sin(inclina) * Math.sin(a)));
    const ancho = v3(-Math.sin(a), 0, Math.cos(a)); // tangente: perpendicular a la hoja
    const grosor = norm(cross(ancho, dir));
    const base = v3(Math.cos(a) * 1.4, 15.6, Math.sin(a) * 1.4);
    const hoja = ellipsoidAxes(add(base, mul(dir, largo * 0.55)), ancho, grosor, dir, v3(4.3, 1.2, largo * 0.55));
    (i % 3 === 1 ? claras : hojas).push(hoja);
  }
  return {
    grupos: [
      grupo(M.MACETA, 0.8, [cappedCone(v3(0, 0, 0), 15, 0.6, 8.6, 6.4, 0.8), torus(v3(0, 15, 0), 8.2, 1.4)]),
      grupo(M.TIERRA, 0.2, [cylinder(v3(0, 14.8, 0), 7.4, 0.6, 0)]),
      grupo(M.PLANTA, 0.7, hojas),
      grupo(M.PLANTA_B, 0.7, claras),
    ],
    sombra: { rx: 14, ry: 6 },
  };
}

/** Lámpara de pie con la pantalla encendida */
function lampara() {
  return {
    grupos: [
      grupo(M.METAL, 0.8, [cylinder(v3(0, 1.1, 0), 7, 1.1, 0.8), sphere(v3(0, 2.8, 0), 2), cylinder(v3(0, 30, 0), 0.95, 28, 0.3)]),
      grupo(M.LUZ, 0.5, [cappedCone(v3(0, 0, 0), 72, 57.5, 7.4, 11.6, 0.7)], { emisivo: true }),
    ],
    sombra: { rx: 11, ry: 5 },
  };
}

/** Bafle con dos conos; los aros brillan con el acento de la sala */
function altavoz() {
  const f = 10; // cara frontal
  const cono = (y, rAro, rCono) => [
    cylinderAB(v3(0, y, f - 0.5), v3(0, y, f + 0.9), rAro),
    cylinderAB(v3(0, y, f), v3(0, y, f + 1.6), rCono),
  ];
  const [aroGrande, conoGrande] = cono(18, 7.2, 5.6);
  const [aroChico, conoChico] = cono(38, 4.2, 2.9);
  return {
    grupos: [
      grupo(M.OSCURO, 0.4, [roundBox(v3(0, 26.5, 0), 11.5, 24.5, 10, 1.6)]),
      grupo(M.ACENTO, 0.2, [aroGrande, aroChico], { emisivo: true }),
      grupo(M.OSCURO, 0.2, [conoGrande, conoChico]),
      grupo(M.METAL, 0.2, [sphere(v3(0, 18, f + 1.9), 1.8), sphere(v3(0, 38, f + 1.8), 1.1)]),
      grupo(M.METAL, 0.2, [[9, 7.5], [-9, 7.5], [9, -7.5], [-9, -7.5]].map(([x, z]) => cylinder(v3(x, 0.9, z), 1.3, 0.9, 0.3))),
    ],
    sombra: { rx: 16, ry: 7 },
  };
}

/**
 * Estantería alta con libros. Va pegada a la pared: en la fila 0 o en la
 * columna 0 (el anillo de celdas junto al muro, que ya está bloqueado).
 */
function estanteria() {
  const r = azar(21);
  const fondo = 7;
  const cz = -H + fondo + 0.4; // la trasera toca el muro
  const baldas = 4;
  const alto = 18;
  const huecos = [];
  const libros = LIBROS.map(() => []);
  for (let k = 0; k < baldas; k++) {
    const suelo = 2.2 + k * alto;
    huecos.push(roundBox(v3(0, suelo + 7.9, cz + 2.2), 17, 7.9, fondo, 0.5));
    let x = -16.2;
    while (x < 15) {
      const w = 1.7 + r() * 1.5;
      if (r() < 0.12) {
        x += w + 1.5; // un hueco de vez en cuando
        continue;
      }
      const h = 9.5 + r() * 4.5;
      libros[Math.floor(r() * 4)].push(roundBox(v3(x + w / 2, suelo + h / 2, cz + 1.2), w / 2 - 0.12, h / 2, fondo - 1.6, 0.25));
      x += w + 0.25;
    }
  }
  return {
    grupos: [
      grupo(M.MADERA, 0.2, [roundBox(v3(0, (baldas * alto + 3) / 2, cz), 19, (baldas * alto + 3) / 2, fondo, 0.9)], {
        subs: huecos,
      }),
      ...libros.map((ls, i) => grupo(LIBROS[i], 0.05, ls)).filter((g) => g.shapes.length > 0),
    ],
    sombra: null,
  };
}

/**
 * Celda de alfombra. `bordes` dice qué lados son el borde de la alfombra
 * (1 = col-1, 2 = row-1, 4 = col+1, 8 = row+1): la cenefa sólo va por fuera,
 * y varias celdas seguidas se leen como UNA alfombra, no como baldosas.
 */
function alfombra(bordes) {
  const dibujo = (x, y, z) => {
    const d = Math.min(
      bordes & 1 ? x + H : 99,
      bordes & 2 ? z + H : 99,
      bordes & 4 ? H - x : 99,
      bordes & 8 ? H - z : 99,
    );
    if (d < 1.3) return M.ALFOMBRA_OSC;
    if (d < 4.4 || (d > 5.6 && d < 6.6)) return M.ALFOMBRA_B;
    // Motivo en cada celda: un rombo (en pantalla) con punto en el centro
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m < 2.3 || (m > 9.2 && m < 10.8)) return M.ALFOMBRA_B;
    return M.ALFOMBRA;
  };
  return {
    grupos: [grupo(M.ALFOMBRA, 0, [roundBox(v3(0, 0.7, 0), H, 0.7, H, 0.15)], { matFn: dibujo })],
    sombra: null,
    contorno: false,
  };
}

// ================================================================= Pared

/** Puerta con marco, dos cuarterones y pomo */
function puerta() {
  const zc = P + 1.6;
  return {
    grupos: [
      grupo(M.PUERTA_MARCO, 0.3, [
        roundBox(v3(-17, 42.5, zc), 2.3, 42.5, 1.9, 0.6),
        roundBox(v3(17, 42.5, zc), 2.3, 42.5, 1.9, 0.6),
        roundBox(v3(0, 85, zc), 19.3, 2.4, 1.9, 0.6),
      ]),
      grupo(M.PUERTA_HOJA, 0.2, [roundBox(v3(0, 41.3, P + 0.9), 14.7, 41.3, 1.0, 0.3)]),
      grupo(M.PUERTA_HOJA, 0.4, [roundBox(v3(0, 60, P + 2.0), 10.4, 14, 0.5, 0.6), roundBox(v3(0, 23, P + 2.0), 10.4, 16, 0.5, 0.6)]),
      grupo(M.PUERTA_POMO, 0.2, [sphere(v3(10.8, 42, P + 3.0), 1.5), cylinderAB(v3(10.8, 42, P + 1.8), v3(10.8, 42, P + 2.6), 0.6)]),
    ],
    sombra: null,
  };
}

/** Ventana con cristal, cruz, alféizar y cortinas recogidas */
function ventana() {
  const y0 = 40;
  const y1 = 86;
  const x0 = 13;
  const cy = (y0 + y1) / 2;
  const hy = (y1 - y0) / 2;
  // Reflejos en diagonal sobre el cristal
  const brillo = (x, y) => {
    const t = frac((x * 0.55 + y * 0.35) / 14);
    return t < 0.1 || (t > 0.18 && t < 0.22) ? M.VIDRIO_BRILLO : M.VIDRIO;
  };
  const pliegues = [-1, 1].flatMap((s) =>
    [0, 1, 2].map((i) =>
      capsule(v3(s * (x0 + 3 + i * 1.5), y1 + 2.5, P + 2.6 + (i % 2) * 0.7), v3(s * (x0 + 1.8 + i * 1.7), y0 - 4, P + 3 + (i % 2) * 0.7), 1.4),
    ),
  );
  return {
    grupos: [
      grupo(M.VIDRIO, 0, [roundBox(v3(0, cy, P + 0.4), x0, hy, 0.3, 0)], { matFn: brillo }),
      grupo(M.MADERA, 0.3, [
        roundBox(v3(-x0 - 1.4, cy, P + 1.4), 1.6, hy + 1.6, 1.4, 0.4),
        roundBox(v3(x0 + 1.4, cy, P + 1.4), 1.6, hy + 1.6, 1.4, 0.4),
        roundBox(v3(0, y1 + 1.4, P + 1.4), x0 + 3, 1.6, 1.4, 0.4),
        roundBox(v3(0, cy, P + 1.1), 0.8, hy, 0.9, 0.2),
        roundBox(v3(0, cy + 4, P + 1.1), x0, 0.8, 0.9, 0.2),
      ]),
      grupo(M.MADERA_OSC, 0.3, [roundBox(v3(0, y0 - 1, P + 3.2), x0 + 3.5, 1.3, 3.2, 0.5)]),
      grupo(M.TAPIZADO, 1.3, pliegues),
      grupo(M.METAL, 0.2, [capsule(v3(-x0 - 7.5, y1 + 4.5, P + 3), v3(x0 + 7.5, y1 + 4.5, P + 3), 0.7)]),
    ],
    sombra: null,
  };
}

/** Cuadro con marco del color de acento y un paisaje: cielo, sol y colinas */
function cuadro() {
  const cy = 64;
  const w = 10;
  const h = 7.5;
  const paisaje = (x, y) => {
    const u = x / w;
    const v = (y - cy) / h;
    if (v < -0.5 + 0.22 * Math.sin(u * 3.1 - 1.2)) return M.HIERBA_B;
    if (v < -0.12 + 0.32 * Math.sin(u * 2.2 + 0.6)) return M.HIERBA;
    if ((u - 0.45) ** 2 + (v - 0.45) ** 2 < 0.07) return M.SOL;
    return M.CIELO;
  };
  return {
    grupos: [
      // Marco: una caja con el centro vaciado por delante (el lienzo queda hundido)
      grupo(M.ACENTO, 0.3, [roundBox(v3(0, cy, P + 1.3), w + 2.2, h + 2.2, 1.3, 0.5)], {
        subs: [roundBox(v3(0, cy, P + 2.6), w, h, 1.3, 0)],
      }),
      // El lienzo asoma 0,3 por delante del fondo vaciado del marco: en el
      // mismo plano, el marco ganaba el empate y el cuadro salía liso
      grupo(M.CIELO, 0, [roundBox(v3(0, cy, P + 1.1), w, h, 0.5, 0)], { matFn: paisaje }),
    ],
    sombra: null,
  };
}

/** Reloj de pared: aro, esfera con marcas y agujas */
function reloj() {
  const cy = 72;
  const R = 7;
  const esfera = (x, y) => {
    const u = x;
    const v = y - cy;
    const aguja = (ang, largo, grosor) => {
      const ax = Math.cos(ang) * largo;
      const ay = Math.sin(ang) * largo;
      const t = Math.max(0, Math.min(1, (u * ax + v * ay) / (ax * ax + ay * ay)));
      return Math.hypot(u - ax * t, v - ay * t) < grosor;
    };
    if (aguja(2.6, 3.3, 0.62) || aguja(1.15, 5.0, 0.45)) return M.OSCURO;
    const r = Math.hypot(u, v);
    if (r > 4.9 && r < 5.8) {
      const k = frac(Math.atan2(v, u) / (Math.PI / 6) + 0.5);
      if (Math.abs(k - 0.5) < 0.13) return M.OSCURO;
    }
    return M.BLANCO;
  };
  return {
    grupos: [
      grupo(M.MADERA_OSC, 0.3, [cylinderAB(v3(0, cy, P), v3(0, cy, P + 2.2), R + 1.3)]),
      grupo(M.BLANCO, 0, [cylinderAB(v3(0, cy, P + 1), v3(0, cy, P + 2.6), R)], { matFn: esfera }),
      grupo(M.ACENTO, 0.1, [sphere(v3(0, cy, P + 2.8), 0.7)]),
    ],
    sombra: null,
  };
}

/** Aplique: placa, brazo y tulipa encendida */
function aplique() {
  return {
    grupos: [
      grupo(M.METAL, 0.3, [roundBox(v3(0, 60, P + 0.6), 2.4, 3.8, 0.6, 0.5), capsule(v3(0, 60, P + 1), v3(0, 62.5, P + 5.2), 0.6)]),
      grupo(M.LUZ, 0.4, [cappedCone(v3(0, 0, P + 5.4), 69.5, 62.5, 2.4, 4.6, 0.4)], { emisivo: true }),
    ],
    sombra: null,
  };
}

/** Balda de pared con libros, una planta pequeña y un jarrón */
function estante() {
  const r = azar(33);
  const yb = 56;
  const libros = LIBROS.map(() => []);
  let x = -14.5;
  for (let i = 0; i < 5; i++) {
    const w = 1.6 + r() * 1.1;
    const h = 6.5 + r() * 3.2;
    libros[i % 4].push(roundBox(v3(x + w / 2, yb + h / 2, P + 3.8), w / 2 - 0.1, h / 2, 3, 0.2));
    x += w + 0.2;
  }
  // Uno tumbado encima de los demás
  libros[2].push(roundBox(v3(x + 3, yb + 1, P + 3.8), 3.4, 1, 2.8, 0.2));
  return {
    grupos: [
      grupo(M.MADERA, 0.2, [roundBox(v3(0, yb - 1, P + 4.6), 16, 1.0, 4.6, 0.3)]),
      grupo(M.MADERA_OSC, 0.2, [-11, 11].map((xx) => roundBox(v3(xx, yb - 4.5, P + 1.5), 0.8, 3, 1.5, 0.3))),
      ...libros.map((ls, i) => grupo(LIBROS[i], 0.05, ls)),
      grupo(M.MACETA, 0.4, [cylinder(v3(9.5, yb + 2.2, P + 4.2), 2.6, 2.2, 0.8)]),
      grupo(M.PLANTA, 0.9, [sphere(v3(9.5, yb + 6, P + 4.2), 3), sphere(v3(7.8, yb + 5, P + 5), 2.2), sphere(v3(11.2, yb + 5.2, P + 3.6), 2.2)]),
      grupo(M.ACENTO, 0.4, [cylinder(v3(3.5, yb + 1.8, P + 4), 1.3, 1.8, 0.5), sphere(v3(3.5, yb + 4.3, P + 4), 1.5)]),
    ],
    sombra: null,
  };
}

/** Neón con forma de cóctel, directamente sobre el muro */
function neon() {
  const z = P + 1.4;
  const cy = 66;
  const t = 0.8;
  const p = (x, y) => v3(x, cy + y, z);
  return {
    grupos: [
      grupo(
        M.LUZ,
        0.3,
        [
          capsule(p(-8, 8), p(8, 8), t),
          capsule(p(-8, 8), p(0, -1), t),
          capsule(p(8, 8), p(0, -1), t),
          capsule(p(0, -1), p(0, -9), t),
          capsule(p(-5, -9.6), p(5, -9.6), t),
          capsule(p(2.6, 5), p(8.5, 12), t * 0.8),
        ],
        { emisivo: true },
      ),
      grupo(M.NEON_ROSA, 0.2, [sphere(p(2.6, 5), 1.7)], { emisivo: true }),
    ],
    sombra: null,
  };
}

/** Póster retro: sol a franjas sobre una rejilla, con margen blanco */
function poster() {
  const cy = 60;
  const w = 8.5;
  const h = 11.5;
  const arte = (x, y) => {
    const u = x / w;
    const v = (y - cy) / h;
    if (Math.abs(u) > 0.84 || Math.abs(v) > 0.88) return M.BLANCO;
    const r = Math.hypot(u, (v - 0.2) * 1.1);
    if (r < 0.55 && v > -0.1) {
      if (v < 0.25 && frac((v + 1) * 6) < 0.35) return M.NOCHE;
      return v > 0.42 ? M.SOL : M.NEON_ROSA;
    }
    if (v < -0.1) return frac(v * 5) < 0.18 || frac((u * 3) / (0.25 - v)) < 0.12 ? M.ACENTO : M.NOCHE;
    return M.NOCHE;
  };
  return {
    grupos: [grupo(M.NOCHE, 0, [roundBox(v3(0, cy, P + 0.5), w, h, 0.4, 0.2)], { matFn: arte })],
    sombra: null,
  };
}

// ================================================================= La ciudad
//
// Lo que amuebla La Manzana: el monumento, farolas, árboles, bancos y
// jardineras. Son "del mundo" (ver `mundo` en el catálogo): la ciudad los
// pone, no se venden. Todo mide una celda, como el resto del mobiliario.

/** Dirección horizontal de la pantalla en el espacio del modelo (derecha) */
const PANTALLA_X = norm(v3(1, 0, -1));

/**
 * La Llave: el monumento de la Plaza. Una llave dorada gigante clavada en un
 * pedestal de piedra con forma de cerradura: todo el que llega a la ciudad
 * viene a por las llaves de su casa. En el ojo de la llave, el rombo de
 * Roomie, que brilla.
 */
function llave() {
  const u = PANTALLA_X;
  const Y = v3(0, 1, 0);
  /** Normal del plano de la llave (hacia la cámara) */
  const n = v3(-u.z, 0, u.x);
  // Un punto de la llave: `a` a lo ancho de la pantalla, `y` hacia arriba
  const en = (a, y, z = 0) => add(add(mul(u, a), v3(0, y, 0)), v3(0, 0, z));
  /** Caja alineada con la llave (y no con la rejilla) */
  const pieza = (a, y, hx, hy, hz) => boxAxes(en(a, y), u, Y, n, v3(hx, hy, hz), 0.9);
  // El ojo: un aro vertical, de cara a la cámara, hecho de cápsulas
  const aro = (cy, R, r, n = 18) =>
    Array.from({ length: n }, (_, i) => {
      const t0 = (i / n) * Math.PI * 2;
      const t1 = ((i + 1) / n) * Math.PI * 2;
      const p = (t) => add(mul(u, Math.cos(t) * R), add(v3(0, cy, 0), mul(Y, Math.sin(t) * R)));
      return capsule(p(t0), p(t1), r);
    });
  const TOPE = 27; // altura de la cara de arriba del pedestal
  const OJO = 118; // centro del ojo
  return {
    grupos: [
      // Pedestal en tres cuerpos, cada vez más estrecho
      grupo(M.PIEDRA, 1.2, [roundBox(v3(0, 4, 0), 20, 4, 20, 1.4)]),
      grupo(M.PIEDRA, 1.2, [roundBox(v3(0, 13, 0), 16, 5, 16, 1.2)]),
      grupo(M.PIEDRA_OSC, 0.8, [roundBox(v3(0, 22.5, 0), 12.5, 4.5, 12.5, 1)]),
      // La cerradura del pedestal, en su cara de delante: donde entra la llave
      grupo(M.OSCURO, 0.3, [roundBox(en(0, 21, 12.2), 2.2, 3, 0.6, 0.5), roundBox(en(0, 16.5, 12.2), 1.1, 2.5, 0.6, 0.4)]),
      // La llave: paletón junto al pedestal, caña hacia arriba y el ojo arriba
      grupo(M.ACENTO, 0.9, [
        cylinder(v3(0, (TOPE + OJO - 18) / 2, 0), 3.2, (OJO - 18 - TOPE) / 2, 0.8),
        roundBox(en(0, TOPE + 2, 0), 5.5, 2.2, 5.5, 1), // collarín sobre el pedestal
        pieza(7, 44, 4.5, 4, 2.4), // dientes del paletón
        pieza(6, 56, 3.5, 3.2, 2.4),
        pieza(0, OJO - 22, 6, 2, 3), // anillo bajo el ojo
        ...aro(OJO, 15, 3.3),
      ]),
      // El rombo de Roomie en el ojo, encendido
      grupo(M.LUZ, 0.6, [boxAxes(v3(0, OJO, 0), norm(add(u, Y)), norm(add(mul(u, -1), Y)), n, v3(5.5, 5.5, 1.2), 0.6)], {
        emisivo: true,
      }),
    ],
    sombra: { rx: 26, ry: 12 },
  };
}

/** Farola de hierro con farol, como las de las plazas de siempre */
function farola() {
  return {
    grupos: [
      grupo(M.METAL, 0.8, [
        cylinder(v3(0, 3, 0), 3.6, 3, 0.6),
        cylinder(v3(0, 8, 0), 2.2, 2.2, 0.5),
        cylinder(v3(0, 48, 0), 1.3, 42, 0.3),
        cylinder(v3(0, 89, 0), 2.6, 1.2, 0.4), // soporte del farol
      ]),
      grupo(M.LUZ, 0.5, [cappedCone(v3(0, 0, 0), 101, 90.5, 5.2, 3.6, 0.6)], { emisivo: true }),
      grupo(M.METAL, 0.5, [cappedCone(v3(0, 0, 0), 106, 101, 1.4, 6.6, 0.5), sphere(v3(0, 107.5, 0), 1.4)]),
    ],
    sombra: { rx: 9, ry: 4 },
  };
}

/** Árbol de plaza: tronco y copa de varias bolas, con alcorque de tierra */
function arbol() {
  const r = azar(21);
  const copa = [];
  const claras = [];
  const bolas = [
    [0, 74, 0, 19],
    [11, 66, 5, 13],
    [-11, 67, -4, 13],
    [5, 86, -7, 13],
    [-7, 82, 9, 12],
    [2, 62, 12, 11],
    [-3, 92, 2, 10],
  ];
  bolas.forEach(([x, y, z, radio], i) => {
    const s = sphere(v3(x + r() * 2 - 1, y + r() * 2 - 1, z + r() * 2 - 1), radio);
    (i % 3 === 1 ? claras : copa).push(s);
  });
  return {
    grupos: [
      grupo(M.TIERRA, 0.2, [cylinder(v3(0, 0.4, 0), 10, 0.4, 0)]),
      grupo(M.MADERA_OSC, 1, [
        cappedCone(v3(0, 0, 0), 64, 0.5, 2.4, 4.4, 0.8),
        capsule(v3(0, 50, 0), v3(7, 62, 3), 1.6), // rama
      ]),
      grupo(M.PLANTA, 2.5, copa),
      grupo(M.PLANTA_B, 2.5, claras),
    ],
    sombra: { rx: 28, ry: 13 },
  };
}

/** Banco de listones de madera con patas de hierro; se mira a +Z */
function banco() {
  const listones = [5.5, 0.5, -4.5].map((z) => roundBox(v3(0, 13.4, z), 19, 1.2, 2.2, 0.6));
  const respaldo = [19.5, 26].map((y) => roundBox(v3(0, y, -9.8), 19, 2.2, 1.1, 0.6));
  const patas = [-15.5, 15.5].flatMap((x) => [
    roundBox(v3(x, 6.4, 3.5), 1.1, 6.4, 1.1, 0.4),
    roundBox(v3(x, 12, -9.8), 1.1, 12, 1.1, 0.4),
    roundBox(v3(x, 12.2, -2), 1.1, 0.9, 8.8, 0.3), // travesaño
  ]);
  return {
    grupos: [
      grupo(M.MADERA, 0.4, listones),
      grupo(M.MADERA, 0.4, respaldo),
      grupo(M.METAL, 0.3, patas),
    ],
    sombra: { rx: 24, ry: 10 },
  };
}

/** Jardinera de piedra con flores */
function jardinera() {
  const r = azar(33);
  const flores = { rosa: [], sol: [] };
  const hojas = [];
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996;
    const d = 3 + (i % 5) * 2.3;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    hojas.push(sphere(v3(x, 16 + r() * 2, z), 3.2 + r()));
    if (i % 2 === 0) (i % 4 === 0 ? flores.rosa : flores.sol).push(sphere(v3(x + 0.5, 19.5 + r() * 2, z + 0.5), 1.6));
  }
  return {
    grupos: [
      grupo(M.PIEDRA, 1, [roundBox(v3(0, 7, 0), 16, 7, 16, 1.6)]),
      grupo(M.PIEDRA_OSC, 0.5, [roundBox(v3(0, 14.2, 0), 16.6, 0.9, 16.6, 0.6)]),
      grupo(M.TIERRA, 0.2, [roundBox(v3(0, 14.6, 0), 14, 0.6, 14, 0.2)]),
      grupo(M.PLANTA, 1.4, hojas),
      grupo(M.NEON_ROSA, 0.3, flores.rosa),
      grupo(M.SOL, 0.3, flores.sol),
    ],
    sombra: { rx: 21, ry: 9 },
  };
}

// ================================================================= Catálogo

/**
 * Qué variantes genera el script. `dir` es la dirección de la cámara
 * (`rumbo()` en render.mjs): 5 fotografía el modelo tal cual (mirando a
 * +row); 3 lo gira 90° para que mire a +col.
 */
export const VARIANTES = [
  ...["sofa", "mesa", "barra", "taburete", "planta", "lampara", "altavoz"].map((t) => ({ nombre: t, dir: 5, modelo: MODELOS_SUELO()[t] })),
  { nombre: "estanteria", dir: 5, modelo: estanteria },
  { nombre: "estanteria-se", dir: 3, modelo: estanteria },
  // La ciudad
  ...Object.entries({ llave, farola, arbol, jardinera }).map(([nombre, modelo]) => ({ nombre, dir: 5, modelo })),
  { nombre: "banco", dir: 5, modelo: banco },
  { nombre: "banco-se", dir: 3, modelo: banco },
  ...Array.from({ length: 16 }, (_, m) => ({ nombre: `alfombra-${m}`, dir: 5, modelo: () => alfombra(m) })),
  // De pared: "der" cuelga de la pared de la fila 0; "izq", de la columna 0
  ...Object.entries({ puerta, ventana, cuadro, reloj, aplique, estante, neon, poster }).flatMap(([t, modelo]) => [
    { nombre: `${t}-der`, dir: 5, modelo },
    { nombre: `${t}-izq`, dir: 3, modelo },
  ]),
];

function MODELOS_SUELO() {
  return { sofa, mesa, barra, taburete, planta, lampara, altavoz };
}
