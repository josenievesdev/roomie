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
import { MAT } from "../../src/state/look.ts";

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

// ---------------------------------------------------------------- Cuerpo

function cuerpo(J) {
  const h = P.head;
  const cabeza = grupo(
    MAT.PIEL,
    3.0,
    [
      elipCabeza(J, 0, 0, 0, h.rx, h.ry, h.rz),
      // Mofletes: la cara se ensancha abajo, como en los muñecos
      elipCabeza(J, 0, -3.2, 1.4, h.rx - 1.4, h.ry - 4.2, h.rz - 1.6),
      // Orejas
      elipCabeza(J, h.rx - 0.6, -0.9, -0.5, 1.5, 2.3, 1.6),
      elipCabeza(J, -(h.rx - 0.6), -0.9, -0.5, 1.5, 2.3, 1.6),
    ],
    { suave: true },
  );
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
  return [cabeza, tronco, brazoGrupo(J.armL), brazoGrupo(J.armR), piernaGrupo(J.legL), piernaGrupo(J.legR)];
}

/**
 * Rasgos de la cara: se pintan DESPUÉS de trazar, como calcomanías en puntos
 * de la superficie de la cabeza. A este tamaño un ojo son 2×3 píxeles, y
 * trazarlo como geometría lo haría parpadear entre 1 y 3 según caiga.
 */
export function rasgos(J) {
  const h = P.head;
  const sobreCabeza = (yaw, pitch) => {
    const d = v3(sin(yaw * RAD) * cos(pitch * RAD), sin(pitch * RAD), cos(yaw * RAD) * cos(pitch * RAD));
    const k = 1 / Math.hypot(d.x / h.rx, d.y / h.ry, d.z / h.rz);
    const pl = mul(d, k); // en coordenadas de la cabeza
    const nl = norm(v3(pl.x / (h.rx * h.rx), pl.y / (h.ry * h.ry), pl.z / (h.rz * h.rz)));
    const aModelo = (q) => add(add(mul(J.hax, q.x), mul(J.hay, q.y)), mul(J.haz, q.z));
    return { p: add(J.head, aModelo(pl)), n: norm(aModelo(nl)) };
  };
  return {
    ojoL: sobreCabeza(25, -2),
    ojoR: sobreCabeza(-25, -2),
    cejaL: sobreCabeza(26, 15),
    cejaR: sobreCabeza(-26, 15),
    boca: sobreCabeza(0, -24),
    parpado: J.pose.blink,
  };
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
    grupo(
      MAT.PELO,
      2.0,
      [
        peloBase(J),
        ...flequillo(J),
        sphere(enCabeza(J, 0, 2.6, -11.2), 2.4),
        roundCone(enCabeza(J, 0, 1.4, -12.2), enCabeza(J, 0, -12.2, -13.6), 3.3, 1.6),
      ],
      { clips: [lineaPelo(J, 1.2, 0.7)], hair: true },
    ),
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
  ...Object.fromEntries(Object.entries(PELO).map(([k, f]) => [`pelo/${k}`, f])),
  ...Object.fromEntries(Object.entries(TORSO).map(([k, f]) => [`torso/${k}`, f])),
  ...Object.fromEntries(Object.entries(PIERNAS).map(([k, f]) => [`piernas/${k}`, f])),
  ...Object.fromEntries(Object.entries(PIES).map(([k, f]) => [`pies/${k}`, f])),
};
