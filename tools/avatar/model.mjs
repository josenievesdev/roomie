// Modelo 3D del avatar: esqueleto, poses y la forma de cada prenda.
//
// Todo se construye con piezas redondeadas (`sdf.mjs`) colgadas de un
// esqueleto. La ropa NO se dibuja encima: es una segunda piel un poco más
// gruesa que el cuerpo, colgada de los mismos huesos. Por eso la manga sigue
// al brazo al caminar sin que nadie la anime a mano, y por eso cualquier
// camiseta combina con cualquier pantalón.
//
// Espacio del modelo: +X izquierda del avatar, +Y arriba, +Z delante; el
// origen es el suelo, entre los pies. Unidades ≈ píxeles.

import {
  add,
  boxAxes,
  capsule,
  cappedCone,
  clamp,
  cross,
  dot,
  ellipsoidAxes,
  mul,
  norm,
  roundCone,
  sphere,
  sub,
  v3,
} from "./sdf.mjs";
import { MAT, ZONA } from "../../src/state/look.ts";

const RAD = Math.PI / 180;
const { sin, cos } = Math;

// ---------------------------------------------------------------- Proporciones
//
// Cabeza grande (algo menos de un tercio de la altura), piernas cortas:
// proporción "chibi", la de Habbo. De pie mide ~64 px en pantalla.

export const P = {
  hip: 24.2, // altura de la articulación de la cadera, de pie
  hipX: 3.9,
  thigh: 10.2,
  shin: 9.9,
  upper: 9.4,
  fore: 8.4,
  shoulderX: 8.2,
  torso: 11.6, // de la pelvis al centro del pecho
  head: { rx: 10.9, ry: 10.8, rz: 10.2 },
  /** La cabeza mira un poco hacia arriba: con la cámara a 30° sobre el
   *  suelo, una cabeza recta enseña más coronilla que cara. Es la trampa que
   *  hace Habbo: cuerpo en isométrica, cara casi de frente. */
  tilt: 11,
};

// ---------------------------------------------------------------- Poses

const NEUTRA = {
  bob: 0,
  lean: 0,
  thighL: 0,
  thighR: 0,
  kneeL: 4,
  kneeR: 4,
  armL: 3,
  armR: 3,
  elbowL: 9,
  elbowR: 9,
  outL: 9,
  outR: 9,
  sit: false,
  wave: -1,
  blink: false,
};

/**
 * Pose de un fotograma. `anim` es una de las animaciones de la hoja
 * (`src/render/avatarSheet.ts`) e `i` el fotograma dentro de ella.
 */
export function pose(anim, i) {
  if (anim === "idle") return { ...NEUTRA, blink: i === 1 };

  if (anim === "walk") {
    // Ciclo de 8 fotogramas. La pierna izquierda pasa por delante en la
    // primera mitad; brazos al revés que las piernas. El cuerpo baja cuando
    // las piernas están abiertas: si no, el pie de apoyo flotaría.
    const f = (i / 8) * Math.PI * 2;
    const s = sin(f);
    const c = cos(f);
    const swing = 30;
    const knee = 48;
    return {
      ...NEUTRA,
      bob: -1.1 + 1.1 * cos(2 * f),
      lean: 4,
      thighL: swing * s,
      thighR: -swing * s,
      kneeL: 4 + knee * Math.max(0, c) ** 1.3,
      kneeR: 4 + knee * Math.max(0, -c) ** 1.3,
      armL: -24 * s,
      armR: 24 * s,
      elbowL: 14 + 14 * Math.max(0, -s),
      elbowR: 14 + 14 * Math.max(0, s),
      outL: 8,
      outR: 8,
    };
  }

  if (anim === "sit") {
    return {
      ...NEUTRA,
      sit: true,
      thighL: 84,
      thighR: 84,
      kneeL: 86,
      kneeR: 86,
      // Manos sobre los muslos: brazo algo adelantado y antebrazo tendido
      armL: 18,
      armR: 18,
      elbowL: 58,
      elbowR: 58,
      outL: 3,
      outR: 3,
      blink: i === 1,
    };
  }

  if (anim === "wave") return { ...NEUTRA, wave: i };

  throw new Error(`animación desconocida: ${anim}`);
}

// ---------------------------------------------------------------- Esqueleto

/** Dirección de un miembro que cuelga, girado `a` hacia delante y `o` hacia fuera */
function colgando(a, o, lado) {
  return norm(v3(lado * sin(o), -cos(a) * cos(o), sin(a) * cos(o)));
}

function pierna(cadera, muslo, rodilla, lado) {
  const a = muslo * RAD;
  const b = (muslo - rodilla) * RAD; // ángulo de la espinilla
  const knee = add(cadera, mul(colgando(a, 1.5 * RAD, lado), P.thigh));
  const dEsp = colgando(b, 0.8 * RAD, lado);
  const ankle = add(knee, mul(dEsp, P.shin));
  // El pie acompaña a la espinilla a medias: puntera abajo al despegar,
  // arriba al apoyar el talón.
  const cabeceo = clamp(b * 0.5, -32 * RAD, 22 * RAD);
  const fwd = norm(v3(0, sin(cabeceo), cos(cabeceo)));
  const ax = v3(1, 0, 0);
  const ay = norm(cross(fwd, ax));
  const foot = add(add(ankle, v3(0, -1.5, 0)), mul(fwd, 2.1));
  return { hip: cadera, knee, ankle, foot, fwd, ax, ay, dEsp };
}

function brazo(hombro, balanceo, codo, abre, lado) {
  const s = balanceo * RAD;
  const o = abre * RAD;
  const dUp = colgando(s, o, lado);
  const elbow = add(hombro, mul(dUp, P.upper));
  const dFo = colgando(s + codo * RAD, o * 0.55, lado);
  const wrist = add(elbow, mul(dFo, P.fore));
  const hand = add(wrist, mul(dFo, 1.9));
  return { shoulder: hombro, elbow, wrist, hand, dUp, dFo };
}

/** Saludo: brazo derecho arriba, la mano oscila entre dos fotogramas */
function brazoSaludo(hombro, fotograma) {
  const dUp = norm(v3(-0.86, 0.44, 0.26));
  const elbow = add(hombro, mul(dUp, P.upper));
  const oscila = fotograma === 0 ? -0.34 : 0.1;
  const dFo = norm(v3(oscila, 0.95, 0.24));
  const wrist = add(elbow, mul(dFo, P.fore));
  const hand = add(wrist, mul(dFo, 1.9));
  return { shoulder: hombro, elbow, wrist, hand, dUp, dFo };
}

/** Articulaciones de una pose, en espacio del modelo */
export function skeleton(p) {
  const hipY = (p.sit ? 19.4 : P.hip) + p.bob;
  const lean = p.lean * RAD;
  const pelvis = v3(0, hipY + 2.6, p.sit ? -2.6 : 0);
  const eje = (largo, inclina) => v3(0, largo * cos(inclina), largo * sin(inclina));
  const chest = add(pelvis, eje(P.torso, lean));
  const neck = add(chest, eje(6.2, lean));
  const head = add(add(neck, eje(10.6, lean * 0.5)), v3(0, 0, 0.8));
  const hombro = (lado) => add(chest, v3(lado * P.shoulderX, 3.4 * cos(lean), 3.4 * sin(lean)));
  const cadera = (lado) => add(pelvis, v3(lado * P.hipX, -2.6, 0));

  // Marco de la cabeza: inclinada hacia atrás `tilt` grados
  const t = (P.tilt - p.lean * 0.5) * RAD;
  const hax = v3(1, 0, 0);
  const hay = v3(0, cos(t), -sin(t));
  const haz = v3(0, sin(t), cos(t));

  const armL = brazo(hombro(1), p.armL, p.elbowL, p.outL, 1);
  const armR = p.wave >= 0 ? brazoSaludo(hombro(-1), p.wave) : brazo(hombro(-1), p.armR, p.elbowR, p.outR, -1);
  return {
    pose: p,
    pelvis,
    chest,
    neck,
    head,
    hax,
    hay,
    haz,
    hipY,
    armL,
    armR,
    legL: pierna(cadera(1), p.thighL, p.kneeL, 1),
    legR: pierna(cadera(-1), p.thighR, p.kneeR, -1),
  };
}

// ---------------------------------------------------------------- Cabeza

/** Punto en coordenadas de la cabeza (que está inclinada) */
const enCabeza = (J, x, y, z) => add(J.head, add(add(mul(J.hax, x), mul(J.hay, y)), mul(J.haz, z)));

/** Elipsoide alineado con la cabeza */
const elipCabeza = (J, x, y, z, rx, ry, rz) => ellipsoidAxes(enCabeza(J, x, y, z), J.hax, J.hay, J.haz, v3(rx, ry, rz));

/** Punto del modelo → coordenadas de la cabeza */
function local(J, x, y, z) {
  const d = v3(x - J.head.x, y - J.head.y, z - J.head.z);
  return v3(dot(d, J.hax), dot(d, J.hay), dot(d, J.haz));
}

/**
 * Recorte "por encima de una línea inclinada" en coordenadas de la cabeza:
 * se conserva y > y0 + pendiente·z. Delante (z>0) la línea sube: frente
 * despejada; detrás baja: nuca cubierta.
 */
function porEncima(J, y0, pendiente) {
  const n = Math.hypot(1, pendiente);
  return (x, y, z) => {
    const q = local(J, x, y, z);
    return (y0 + pendiente * q.z - q.y) / n;
  };
}

const grupo = (mat, k, shapes, extra = {}) => ({ mat, k, shapes, ...extra });

// ---------------------------------------------------------------- Cabeza y cara
//
// La cabeza va en su propia capa, una por forma de cara. El CRÁNEO es el
// mismo en todas (el elipsoide de `P.head`): de él se cuelgan los peinados,
// y mañana las gorras, así que cualquier peinado vale para cualquier cara.
// Lo que cambia es lo de abajo: mofletes, mandíbula y barbilla.

/** El cráneo: igual en todas las caras */
const craneo = (J) => elipCabeza(J, 0, 0, 0, P.head.rx, P.head.ry, P.head.rz);

const orejas = (J) => [
  elipCabeza(J, P.head.rx - 0.6, -0.9, -0.5, 1.5, 2.3, 1.6),
  elipCabeza(J, -(P.head.rx - 0.6), -0.9, -0.5, 1.5, 2.3, 1.6),
];

/**
 * Lo de abajo de cada forma de cara, en coordenadas de la cabeza. Las
 * diferencias son de uno o dos píxeles, como en Habbo: a este tamaño, más
 * sería otra cabeza (y el pelo dejaría de encajar).
 */
const CARAS = {
  // Mofletes: la cara se ensancha abajo, como en los muñecos
  redonda: (J) => [elipCabeza(J, 0, -3.2, 1.4, 9.5, 6.6, 8.6)],
  // Más larga y más estrecha: la barbilla baja dos píxeles
  ovalada: (J) => [elipCabeza(J, 0, -5.2, 1.0, 8.0, 8.4, 7.9)],
  // Mandíbula ancha y barbilla plana: la caja manda abajo
  cuadrada: (J) => [
    elipCabeza(J, 0, -2.8, 1.4, 10.0, 5.6, 8.6),
    boxAxes(enCabeza(J, 0, -6.4, 1.8), J.hax, J.hay, J.haz, v3(8.6, 2.2, 6.6), 1.8),
  ],
  // Pómulos anchos y altos, y barbilla fina, en pico
  corazon: (J) => [elipCabeza(J, 0, -2.0, 1.4, 10.1, 5.0, 8.4), elipCabeza(J, 0, -7.6, 3.6, 2.4, 3.4, 4.2)],
  // Carrillos llenos: más anchos abajo que el propio cráneo
  mofletes: (J) => [elipCabeza(J, 0, -4.2, 2.2, 11.6, 7.4, 9.6)],
};

/**
 * Zona de la cara de cada punto de la superficie (coordenadas de la cabeza:
 * +x izquierda, +y arriba, +z delante). El navegador pinta la barba, el
 * bigote y la perilla en su zona: así la barba se adapta a cada forma de
 * cara y conserva la luz del modelo.
 */
const zonaCara = (J) => (x, y, z) => {
  const q = local(J, x, y, z);
  if (q.z < -3.6) return ZONA.NINGUNA; // la nuca
  const ax = Math.abs(q.x);
  if (ax > 9.4 && q.y > -3.4) return ZONA.NINGUNA; // las orejas
  if (q.y > -3.0) {
    // Patillas: delante de las orejas, a la altura de los ojos para abajo
    return ax > 7.3 && q.y < 1.4 && q.z < 5.8 ? ZONA.PATILLA : ZONA.NINGUNA;
  }
  if (q.y > -4.3 && ax < 3.9 && q.z > 5.5) return ZONA.BIGOTE;
  if (q.y < -5.5 && ax < 3.2 && q.z > 4.2) return ZONA.PERILLA;
  return ZONA.MANDIBULA;
};

/** Constructor de la capa de cabeza de una forma de cara */
const cabeza = (forma) => (J) => [
  grupo(MAT.PIEL, 3.0, [craneo(J), ...CARAS[forma](J), ...orejas(J)], { suave: true, zonaFn: zonaCara(J) }),
];

export const CABEZAS = Object.fromEntries(Object.keys(CARAS).map((f) => [f, cabeza(f)]));

/**
 * Dónde van los rasgos de la cara, como [giro, altura] en grados sobre la
 * cabeza (0, 0 = el centro de la cara). El generador busca el punto de la
 * piel en esa dirección, lo fotografía y apunta dónde cae en cada
 * fotograma: son las anclas en las que el navegador pinta ojos, cejas, nariz
 * y boca (`src/render/cara.ts`).
 */
export const RASGOS = {
  ojoL: [25, -2],
  ojoR: [-25, -2],
  cejaL: [26, 15],
  cejaR: [-26, 15],
  nariz: [0, -13],
  boca: [0, -26],
  mejillaL: [42, -15],
  mejillaR: [-42, -15],
};

/** Dirección (en el modelo) de un rasgo, desde el centro de la cabeza */
export function direccionRasgo(J, giro, altura) {
  const d = v3(sin(giro * RAD) * cos(altura * RAD), sin(altura * RAD), cos(giro * RAD) * cos(altura * RAD));
  return norm(add(add(mul(J.hax, d.x), mul(J.hay, d.y)), mul(J.haz, d.z)));
}

// ---------------------------------------------------------------- Cuerpo

function cuerpo(J) {
  const tronco = grupo(
    MAT.PIEL,
    3.0,
    [
      ellipsoidAxes(J.chest, v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), v3(7.5, 7.6, 5.2)),
      ellipsoidAxes(J.pelvis, v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), v3(7.0, 5.8, 5.0)),
      capsule(sub(J.neck, v3(0, 2.5, 0)), add(J.neck, v3(0, 3.6, 0)), 2.7),
      sphere(J.armL.shoulder, 2.8),
      sphere(J.armR.shoulder, 2.8),
    ],
    { suave: true },
  );
  const brazoGrupo = (a) =>
    grupo(
      MAT.PIEL,
      1.1,
      [
        roundCone(a.shoulder, a.elbow, 2.7, 2.3),
        roundCone(a.elbow, a.wrist, 2.3, 1.95),
        ellipsoidAxes(a.hand, v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), v3(2.2, 2.6, 2.2)),
      ],
      { suave: true },
    );
  const piernaGrupo = (l) =>
    grupo(
      MAT.PIEL,
      1.0,
      [
        roundCone(l.hip, l.knee, 3.6, 2.8),
        roundCone(l.knee, l.ankle, 2.8, 2.15),
        ellipsoidAxes(l.foot, l.ax, l.ay, l.fwd, v3(2.2, 1.6, 3.8)),
      ],
      { suave: true },
    );
  return [tronco, brazoGrupo(J.armL), brazoGrupo(J.armR), piernaGrupo(J.legL), piernaGrupo(J.legR)];
}

// ---------------------------------------------------------------- Pelo

const peloBase = (J, extra = 0) =>
  elipCabeza(J, 0, 0.9, -0.3, P.head.rx + 1.6 + extra, P.head.ry + 1.8 + extra, P.head.rz + 1.7 + extra);

/**
 * Flequillo ladeado: da carácter y rompe la simetría de casco. Dos mechones
 * que bajan sobre la frente, uno más largo, para que la línea del pelo no sea
 * una regla recta de oreja a oreja.
 */
const flequillo = (J) => [
  elipCabeza(J, 1.4, 6.4, 8.0, 6.6, 3.2, 3.0),
  elipCabeza(J, 4.6, 4.9, 7.4, 3.2, 3.4, 2.6),
];

/** Línea del pelo: la frente queda despejada, la nuca cubierta */
const lineaPelo = (J, y0 = 1.8, pend = 0.62) => porEncima(J, y0, pend);

/** Dirección (giro, altura) en grados, en coordenadas de la cabeza */
const dirCabeza = (giro, altura) =>
  v3(sin(giro * RAD) * cos(altura * RAD), sin(altura * RAD), cos(giro * RAD) * cos(altura * RAD));

/** Punto sobre el pelo base (el elipsoide algo mayor que el cráneo), `fuera` más o menos */
function sobrePelo(giro, altura, fuera = 0) {
  const d = dirCabeza(giro, altura);
  const rx = P.head.rx + 1.6 + fuera;
  const ry = P.head.ry + 1.8 + fuera;
  const rz = P.head.rz + 1.7 + fuera;
  const k = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
  return v3(d.x * k, d.y * k + 0.9, d.z * k - 0.3);
}

/**
 * Bultos del pelo rizado: esferas pequeñas repartidas en anillos por el pelo
 * base. Fundidas con poca suavidad, el contorno queda ondulado de píxel en
 * píxel: a este tamaño, eso es un rizo.
 */
function bultos(J, anillos, r, fuera = -0.5) {
  const piezas = [];
  anillos.forEach(([altura, n, desfase = 0]) => {
    for (let i = 0; i < n; i++) {
      const q = sobrePelo((360 / n) * i + desfase, altura, fuera);
      piezas.push(sphere(enCabeza(J, q.x, q.y, q.z), r));
    }
  });
  return piezas;
}

/** Nada por delante de la cara (lo de los lados puede adelantarse, enmarcándola) */
const detrasDeLaCara = (J, z0 = 3.2, abre = 0) => (x, y, z) => {
  const q = local(J, x, y, z);
  return q.z - (z0 + abre * Math.abs(q.x));
};

/** Hasta dónde baja una melena, medido desde el centro de la cabeza */
const hastaAltura = (J, dy) => (x, y, z) => J.head.y + dy - y;

/** Un mechón que cuelga: cadena de esferas de `desde` a `hasta` (coordenadas de la cabeza) */
function cadena(J, desde, hasta, n, r0, r1) {
  const piezas = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const q = v3(desde.x + (hasta.x - desde.x) * t, desde.y + (hasta.y - desde.y) * t, desde.z + (hasta.z - desde.z) * t);
    piezas.push(sphere(enCabeza(J, q.x, q.y, q.z), r0 + (r1 - r0) * t));
  }
  return piezas;
}

const PELO = {
  corto: (J) => [grupo(MAT.PELO, 2.2, [peloBase(J), ...flequillo(J)], { clips: [lineaPelo(J)], hair: true })],
  rapado: (J) => [
    grupo(MAT.PELO, 1, [elipCabeza(J, 0, 0.4, -0.2, P.head.rx + 0.8, P.head.ry + 0.9, P.head.rz + 0.8)], {
      clips: [lineaPelo(J, 2.8, 0.45)],
      hair: true,
    }),
  ],
  largo: (J) => [
    grupo(MAT.PELO, 2.2, [peloBase(J), ...flequillo(J)], { clips: [lineaPelo(J)], hair: true }),
    grupo(
      MAT.PELO,
      2.6,
      [
        elipCabeza(J, 0, -5.2, -3.4, 11.9, 12.8, 8.2),
        capsule(enCabeza(J, 9.9, 2.0, 3.0), enCabeza(J, 9.3, -12.0, 1.8), 2.5),
        capsule(enCabeza(J, -9.9, 2.0, 3.0), enCabeza(J, -9.3, -12.0, 1.8), 2.5),
      ],
      {
        clips: [
          (x, y, z) => local(J, x, y, z).z - 3.2, // nada por delante de la cara
          (x, y, z) => J.head.y - 16 - y, // acaba en los hombros
        ],
        hair: true,
      },
    ),
  ],
  coleta: (J) => [
    grupo(MAT.PELO, 2.0, [peloBase(J), ...flequillo(J), sphere(enCabeza(J, 0, 2.6, -11.2), 2.4)], {
      clips: [lineaPelo(J, 1.2, 0.7)],
      hair: true,
    }),
    // La cola, aparte: la línea del pelo la cortaba a la altura de la nuca
    grupo(MAT.PELO, 1.0, [roundCone(enCabeza(J, 0, 1.4, -12.2), enCabeza(J, 0, -12.8, -13.8), 3.3, 1.6)], { hair: true }),
  ],
  mono: (J) => [
    // El moño va atrás y algo bajo: arriba del todo, de frente, parecía un
    // gorro puntiagudo.
    grupo(MAT.PELO, 1.6, [peloBase(J), ...flequillo(J), sphere(enCabeza(J, 0, 8.2, -8.6), 4.6)], {
      clips: [lineaPelo(J)],
      hair: true,
    }),
  ],
  afro: (J) => [
    // Volumen desplazado hacia atrás para que la cara quede a ras, no
    // hundida en un hueco en sombra.
    // El hueco de la cara llega por encima de las cejas: la cámara mira desde
    // arriba y cualquier pelo delante de la frente hace de visera.
    grupo(MAT.PELO, 2.0, [elipCabeza(J, 0, 3.8, -4.6, 14.2, 13.4, 12.6)], {
      subs: [elipCabeza(J, 0, -2.6, 11.2, 9.6, 11.4, 8.8)],
      clips: [(x, y, z) => -8.6 - local(J, x, y, z).y],
      hair: true,
    }),
  ],

  // Sin pelo: la capa existe, pero vacía (las cejas siguen siendo del color del pelo)
  calvo: () => [],

  // Corto y rizado: el pelo base cubierto de bultos pequeños
  rizado: (J) => [
    grupo(
      MAT.PELO,
      0.7,
      [
        peloBase(J, -0.4),
        ...bultos(
          J,
          [
            [6, 12, 0],
            [26, 11, 15],
            [48, 9, 5],
            [70, 5, 30],
            [88, 1],
          ],
          2.4,
          -0.3,
        ),
      ],
      { clips: [lineaPelo(J, 2.6, 0.62)], hair: true, mate: true },
    ),
  ],

  // Tupé: los lados cortos y un volumen hacia delante y arriba sobre la frente
  tupe: (J) => [
    grupo(
      MAT.PELO,
      2.2,
      [
        elipCabeza(J, 0, 0.5, -0.4, P.head.rx + 1.0, P.head.ry + 1.2, P.head.rz + 1.0),
        elipCabeza(J, 0.8, 9.6, 5.0, 7.4, 4.6, 6.6),
        elipCabeza(J, 1.2, 11.2, 2.0, 6.2, 3.4, 5.2),
      ],
      { clips: [lineaPelo(J, 3.2, 0.5)], hair: true },
    ),
  ],

  // Peinado hacia atrás: liso, sin flequillo, la frente despejada
  atras: (J) => [
    grupo(
      MAT.PELO,
      2.0,
      [peloBase(J, -0.2), elipCabeza(J, 0, 5.2, -7.4, 8.8, 7.0, 5.0)],
      { clips: [lineaPelo(J, 3.8, 0.52)], hair: true },
    ),
  ],

  // Cresta: los lados rapados (la piel oscurecida por el pelo cortito, como
  // la barba de tres días) y una fila de pelo de la frente a la nuca
  cresta: (J) => [
    grupo(MAT.SOMBRA_BARBA, 1, [elipCabeza(J, 0, 0.3, -0.2, P.head.rx + 0.4, P.head.ry + 0.5, P.head.rz + 0.4)], {
      clips: [lineaPelo(J, 2.8, 0.45)],
      suave: true,
    }),
    grupo(
      MAT.PELO,
      1.6,
      [
        ...cadena(J, v3(0, 10.2, 6.2), v3(0, 13.4, -1.6), 5, 2.5, 3.0),
        ...cadena(J, v3(0, 13.0, -3.2), v3(0, 7.2, -10.8), 4, 2.9, 2.4),
      ],
      { hair: true },
    ),
  ],

  // Melena lisa con flequillo recto que llega a las cejas
  flequillo: (J) => [
    grupo(
      MAT.PELO,
      1.6,
      [peloBase(J), elipCabeza(J, 0, 6.4, 8.2, 9.8, 4.4, 3.6)],
      { clips: [lineaPelo(J, 0.6, 0.3), (x, y, z) => 3.4 - local(J, x, y, z).y], hair: true },
    ),
    grupo(
      MAT.PELO,
      2.6,
      [
        elipCabeza(J, 0, -5.2, -3.4, 11.9, 12.8, 8.2),
        capsule(enCabeza(J, 9.9, 2.0, 3.0), enCabeza(J, 9.3, -12.0, 1.8), 2.5),
        capsule(enCabeza(J, -9.9, 2.0, 3.0), enCabeza(J, -9.3, -12.0, 1.8), 2.5),
      ],
      { clips: [detrasDeLaCara(J, 3.2), hastaAltura(J, -16)], hair: true },
    ),
  ],

  // Bob: liso hasta la mandíbula, con la cara enmarcada y el borde recto
  bob: (J) => [
    grupo(MAT.PELO, 2.2, [peloBase(J), ...flequillo(J)], { clips: [lineaPelo(J)], hair: true }),
    grupo(MAT.PELO, 2.4, [elipCabeza(J, 0, -1.6, -1.4, 12.4, 12.0, 11.6)], {
      clips: [detrasDeLaCara(J, 2.0, 0.3), (x, y, z) => -7.0 - local(J, x, y, z).y],
      hair: true,
    }),
  ],

  // Rizos largos: mucho volumen por detrás y a los lados, hasta los hombros
  rizos: (J) => [
    grupo(
      MAT.PELO,
      0.8,
      [
        peloBase(J, -0.2),
        ...bultos(
          J,
          [
            [8, 12, 0],
            [30, 10, 18],
            [54, 8, 0],
            [76, 4, 45],
          ],
          2.5,
          -0.2,
        ),
      ],
      { clips: [lineaPelo(J, 1.8, 0.62)], hair: true, mate: true },
    ),
    grupo(
      MAT.PELO,
      1.2,
      [
        elipCabeza(J, 0, -5.4, -3.6, 12.4, 11.6, 8.4),
        ...[-4, -9, -14].flatMap((y, fila) =>
          [60, 95, 130, 165, 195, 230, 265, 300].map((giro) => {
            const a = (giro + fila * 17) * RAD;
            return sphere(enCabeza(J, sin(a) * 11.8, y, cos(a) * 8.0 - 3.4), 3.1);
          }),
        ),
      ],
      { clips: [detrasDeLaCara(J, 3.0, 0.1), hastaAltura(J, -18.5)], hair: true, mate: true },
    ),
  ],

  // Dos coletas a los lados, atadas por detrás de las orejas. Lo que cuelga
  // va en su propio grupo: la línea del pelo lo cortaría a la altura de la nuca
  coletas: (J) => [
    grupo(
      MAT.PELO,
      2.0,
      [peloBase(J), ...flequillo(J), ...[1, -1].map((l) => sphere(enCabeza(J, l * 10.0, 1.6, -5.2), 2.6))],
      { clips: [lineaPelo(J, 1.2, 0.7)], hair: true },
    ),
    grupo(
      MAT.PELO,
      0.8,
      [1, -1].map((l) => roundCone(enCabeza(J, l * 11.2, 0.8, -5.6), enCabeza(J, l * 12.6, -13.4, -6.2), 2.8, 1.5)),
      { hair: true },
    ),
  ],

  // Moño alto, arriba y un poco atrás
  monoAlto: (J) => [
    grupo(
      MAT.PELO,
      1.6,
      [peloBase(J, -0.2), sphere(enCabeza(J, 0, 12.4, -4.2), 4.1), sphere(enCabeza(J, 0, 10.6, -3.4), 2.6)],
      { clips: [lineaPelo(J, 2.6, 0.55)], hair: true },
    ),
  ],

  // Dos moños arriba, uno a cada lado: separados del pelo, para que se lean
  // como dos bolas y no como un gorro
  monos: (J) => [
    grupo(MAT.PELO, 1.8, [peloBase(J), ...flequillo(J)], { clips: [lineaPelo(J)], hair: true }),
    grupo(MAT.PELO, 0.6, [sphere(enCabeza(J, 7.8, 10.6, -1.8), 4.2), sphere(enCabeza(J, -7.8, 10.6, -1.8), 4.2)], {
      hair: true,
    }),
  ],

  // Dos trenzas que caen por delante de los hombros (en su propio grupo: la
  // línea del pelo las cortaría)
  trenzas: (J) => [
    grupo(MAT.PELO, 1.8, [peloBase(J), ...flequillo(J)], { clips: [lineaPelo(J, 1.2, 0.68)], hair: true }),
    grupo(
      MAT.PELO,
      0.5,
      [1, -1].flatMap((l) => cadena(J, v3(l * 9.8, -1.0, -1.8), v3(l * 10.2, -17.2, 1.2), 7, 2.3, 1.7)),
      { hair: true },
    ),
  ],

  // Rastas: mechones gruesos que cuelgan alrededor, hasta los hombros
  rastas: (J) => [
    grupo(MAT.PELO, 1.6, [peloBase(J, 0.3)], { clips: [lineaPelo(J, 2.2, 0.62)], hair: true }),
    grupo(
      MAT.PELO,
      0.4,
      // Alrededor de la cabeza menos por delante de la cara: de 60° a 300°
      [...Array(11).keys()].map((i) => 60 + i * 24).map((giro) => {
        const arriba = sobrePelo(giro, -6, 0.2);
        const a = giro * RAD;
        return roundCone(
          enCabeza(J, arriba.x, arriba.y, arriba.z),
          enCabeza(J, sin(a) * 12.4, -14.2, cos(a) * 9.2 - 1.6),
          1.9,
          1.5,
        );
      }),
      { clips: [detrasDeLaCara(J, 2.6, 0.3)], hair: true },
    ),
  ],
};

// ---------------------------------------------------------------- Torso

const EJES = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];
const elip = (c, rx, ry, rz) => ellipsoidAxes(c, ...EJES, v3(rx, ry, rz));

function camisaCuerpo(J, holgura, extra = []) {
  return [
    elip(J.chest, 7.5 + holgura, 7.6 + holgura, 5.2 + holgura),
    elip(add(J.pelvis, v3(0, 0.6, 0)), 7.0 + holgura + 0.6, 5.4 + holgura, 5.0 + holgura + 0.5),
    sphere(J.armL.shoulder, 2.8 + holgura),
    sphere(J.armR.shoulder, 2.8 + holgura),
    ...extra,
  ];
}

/** El dobladillo de la camiseta queda por debajo de la cintura del pantalón */
const dobladillo = (J) => (x, y, z) => J.hipY - 1.4 - y;
/** Hueco del cuello */
const cuello = (J, r = 3.3) => capsule(sub(J.neck, v3(0, 1.0, -0.4)), add(J.neck, v3(0, 7, 0.6)), r);

/** Manga que cubre `hasta` del brazo (0.5 = hasta el codo, 1 = hasta la muñeca) */
function manga(a, hasta, grosor) {
  const codo = Math.min(hasta * 2, 1);
  const piezas = [roundCone(a.shoulder, add(a.shoulder, mul(sub(a.elbow, a.shoulder), codo)), 2.7 + grosor, 2.35 + grosor)];
  if (hasta > 0.5) {
    const t = (hasta - 0.5) * 2;
    piezas.push(roundCone(a.elbow, add(a.elbow, mul(sub(a.wrist, a.elbow), t)), 2.35 + grosor, 2.05 + grosor));
  }
  return piezas;
}

const TORSO = {
  camiseta: (J) => [
    grupo(MAT.TORSO, 2.4, camisaCuerpo(J, 1.25, [...manga(J.armL, 0.28, 1.1), ...manga(J.armR, 0.28, 1.1)]), {
      clips: [dobladillo(J)],
      subs: [cuello(J)],
    }),
  ],
  mangalarga: (J) => [
    grupo(MAT.TORSO, 2.4, camisaCuerpo(J, 1.3, [...manga(J.armL, 1, 0.95), ...manga(J.armR, 1, 0.95)]), {
      clips: [dobladillo(J)],
      subs: [cuello(J, 3.1)],
    }),
  ],
  tirantes: (J) => [
    grupo(MAT.TORSO, 2.2, camisaCuerpo(J, 1.2), {
      clips: [dobladillo(J)],
      subs: [
        cuello(J, 4.3),
        sphere(add(J.armL.shoulder, v3(0.9, -0.6, 0)), 4.2),
        sphere(add(J.armR.shoulder, v3(-0.9, -0.6, 0)), 4.2),
      ],
    }),
  ],
  sudadera: (J) => [
    grupo(
      MAT.TORSO,
      2.8,
      camisaCuerpo(J, 1.7, [
        ...manga(J.armL, 1, 1.4),
        ...manga(J.armR, 1, 1.4),
        // Capucha caída sobre la espalda
        elip(add(J.neck, v3(0, 1.0, -5.2)), 7.0, 4.4, 4.0),
      ]),
      { clips: [dobladillo(J)], subs: [cuello(J, 3.1)] },
    ),
  ],
  chaqueta: (J) => [
    grupo(MAT.TORSO, 2.4, camisaCuerpo(J, 1.55, [...manga(J.armL, 1, 1.25), ...manga(J.armR, 1, 1.25)]), {
      clips: [dobladillo(J)],
      subs: [cuello(J, 3.2)],
      // Abierta por delante: asoma la camiseta de debajo
      matFn: (x, y, z) =>
        z - J.chest.z > 2.2 && Math.abs(x) < 2.2 && y > J.hipY - 1.4 ? MAT.TORSO_B : MAT.TORSO,
    }),
  ],
};

// ---------------------------------------------------------------- Piernas

const cintura = (J) => (x, y, z) => y - (J.hipY + 4.4);

function perneras(l, hasta, grosor) {
  const rodilla = Math.min(hasta * 2, 1);
  const piezas = [roundCone(l.hip, add(l.hip, mul(sub(l.knee, l.hip), rodilla)), 3.6 + grosor, 2.8 + grosor)];
  if (hasta > 0.5) {
    const t = (hasta - 0.5) * 2;
    piezas.push(roundCone(l.knee, add(l.knee, mul(sub(l.ankle, l.knee), t)), 2.8 + grosor, 2.2 + grosor));
  }
  return piezas;
}

const cadera = (J, g) => elip(J.pelvis, 7.0 + g, 5.8 + g, 5.0 + g);

const PIERNAS = {
  pantalon: (J) => [
    grupo(MAT.PIERNAS, 1.8, [cadera(J, 0.9), ...perneras(J.legL, 1, 0.85), ...perneras(J.legR, 1, 0.85)], {
      clips: [cintura(J)],
    }),
  ],
  corto: (J) => [
    grupo(MAT.PIERNAS, 1.8, [cadera(J, 0.9), ...perneras(J.legL, 0.32, 1.0), ...perneras(J.legR, 0.32, 1.0)], {
      clips: [cintura(J)],
    }),
  ],
  falda: (J) => [
    grupo(
      MAT.PIERNAS,
      2.0,
      [
        cadera(J, 0.9),
        J.pose.sit
          ? // Sentada, la falda cae sobre los muslos
            roundCone(add(J.pelvis, v3(0, -1, 0)), add(J.pelvis, v3(0, -2.5, 9)), 7.8, 6.2)
          : cappedCone(v3(J.pelvis.x, 0, J.pelvis.z), J.hipY + 3, J.hipY - 9.6, 8.2, 11.0, 0.8),
      ],
      { clips: [cintura(J)] },
    ),
  ],
};

// ---------------------------------------------------------------- Pies

function zapato(l, extra) {
  const forma = ellipsoidAxes(l.foot, l.ax, l.ay, l.fwd, v3(2.8 + extra, 2.1 + extra * 0.6, 4.6 + extra));
  const suela = (x, y, z) => {
    const q = v3(x - l.foot.x, y - l.foot.y, z - l.foot.z);
    return dot(q, l.ay) < -0.9 ? MAT.SUELA : MAT.PIES;
  };
  return { forma, suela };
}

const PIES = {
  zapatillas: (J) =>
    [J.legL, J.legR].map((l) => {
      const z = zapato(l, 0.4);
      return grupo(MAT.PIES, 1, [z.forma], { matFn: z.suela });
    }),
  botas: (J) =>
    [J.legL, J.legR].map((l) => {
      const z = zapato(l, 0.5);
      const cania = roundCone(sub(l.ankle, v3(0, 1, 0)), add(l.ankle, mul(l.dEsp, -5.0)), 3.2, 3.1);
      return grupo(MAT.PIES, 1.4, [z.forma, cania]);
    }),
};

// ---------------------------------------------------------------- Catálogo

/**
 * Todas las capas que genera el script: nombre de capa → constructor de
 * grupos a partir del esqueleto. El nombre es `parte/estilo`.
 */
export const CAPAS = {
  cuerpo: cuerpo,
  ...Object.fromEntries(Object.entries(CABEZAS).map(([k, f]) => [`cabeza/${k}`, f])),
  ...Object.fromEntries(Object.entries(PELO).map(([k, f]) => [`pelo/${k}`, f])),
  ...Object.fromEntries(Object.entries(TORSO).map(([k, f]) => [`torso/${k}`, f])),
  ...Object.fromEntries(Object.entries(PIERNAS).map(([k, f]) => [`piernas/${k}`, f])),
  ...Object.fromEntries(Object.entries(PIES).map(([k, f]) => [`pies/${k}`, f])),
};
