// Formas 3D como campos de distancia con signo (SDF): cada forma dice a qué
// distancia está un punto de su superficie (negativo = dentro). Es lo que
// permite modelar el avatar con pocas piezas redondeadas y fundirlas entre sí
// sin aristas, como un muñeco de plastilina.
//
// Convenciones del espacio del MODELO (el avatar mirando a +Z):
//   +X = izquierda del avatar, +Y = arriba, +Z = delante. Triedro a derechas,
//   así que rotarlo nunca lo refleja (el reloj seguiría en su muñeca).
// Unidades: 1 unidad ≈ 1 píxel de pantalla a lo ancho.
//
// Fórmulas de Inigo Quilez (iquilezles.org/articles/distfunctions).

const { sqrt, max, min, abs } = Math;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export const v3 = (x, y, z) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, k) => v3(a.x * k, a.y * k, a.z * k);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => sqrt(dot(a, a));
export const norm = (a) => mul(a, 1 / (len(a) || 1));
export const cross = (a, b) =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Unión suave: funde dos distancias con un radio de transición k */
export function smin(a, b, k) {
  if (k <= 0) return min(a, b);
  const h = max(k - abs(a - b), 0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// ---------- Primitivas ----------
// Cada una devuelve { d(x,y,z), bounds: {c, r} }. `bounds` es una esfera que
// la contiene, para que el trazador descarte rayos que ni se acercan.

export function sphere(c, r) {
  return {
    d: (x, y, z) => sqrt((x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2) - r,
    bounds: { c, r },
  };
}

/** Elipsoide alineado con los ejes del modelo */
export function ellipsoid(c, rx, ry, rz) {
  const rmin = min(rx, ry, rz);
  return {
    d: (x, y, z) => {
      const px = x - c.x;
      const py = y - c.y;
      const pz = z - c.z;
      const k0 = sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
      const k1 = sqrt((px / (rx * rx)) ** 2 + (py / (ry * ry)) ** 2 + (pz / (rz * rz)) ** 2);
      if (k1 < 1e-9) return -rmin;
      return (k0 * (k0 - 1)) / k1;
    },
    bounds: { c, r: max(rx, ry, rz) },
  };
}

/**
 * Elipsoide orientado: `ax`, `ay`, `az` son sus ejes (unitarios y
 * perpendiculares) y `r` sus tres radios. Para pies que siguen a la pierna.
 */
export function ellipsoidAxes(c, ax, ay, az, r) {
  const e = ellipsoid(v3(0, 0, 0), r.x, r.y, r.z);
  return {
    d: (x, y, z) => {
      const p = v3(x - c.x, y - c.y, z - c.z);
      return e.d(dot(p, ax), dot(p, ay), dot(p, az));
    },
    bounds: { c, r: max(r.x, r.y, r.z) },
  };
}

/** Cápsula: segmento a-b con radio r */
export function capsule(a, b, r) {
  const ba = sub(b, a);
  const bb = dot(ba, ba) || 1e-9;
  return {
    d: (x, y, z) => {
      const pax = x - a.x;
      const pay = y - a.y;
      const paz = z - a.z;
      const h = clamp((pax * ba.x + pay * ba.y + paz * ba.z) / bb, 0, 1);
      return sqrt((pax - ba.x * h) ** 2 + (pay - ba.y * h) ** 2 + (paz - ba.z * h) ** 2) - r;
    },
    bounds: { c: mul(add(a, b), 0.5), r: len(ba) / 2 + r },
  };
}

/** Cono redondeado: esfera r1 en a, esfera r2 en b, y la piel que las une */
export function roundCone(a, b, r1, r2) {
  const ba = sub(b, a);
  const l2 = dot(ba, ba) || 1e-9;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const s = Math.sign(rr);
  return {
    d: (x, y, z) => {
      const pax = x - a.x;
      const pay = y - a.y;
      const paz = z - a.z;
      const yy = pax * ba.x + pay * ba.y + paz * ba.z;
      const zz = yy - l2;
      const qx = pax * l2 - ba.x * yy;
      const qy = pay * l2 - ba.y * yy;
      const qz = paz * l2 - ba.z * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = s * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
      return (sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    },
    bounds: { c: mul(add(a, b), 0.5), r: len(ba) / 2 + max(r1, r2) },
  };
}

/**
 * Tronco de cono redondeado vertical (faldas, cuellos): de radio `r1` en
 * `ya` a radio `r2` en `yb` (ya > yb), con bordes suavizados `rb`.
 */
export function cappedCone(c, ya, yb, r1, r2, rb = 0.8) {
  // sdCappedCone de iq en 2D (radio, altura) con el eje vertical en c
  const h = (ya - yb) / 2;
  const cy = (ya + yb) / 2;
  const k1x = r1;
  const k1y = h;
  const k2x = r1 - r2;
  const k2y = 2 * h;
  const k2l = k2x * k2x + k2y * k2y;
  return {
    d: (x, y, z) => {
      const qx = sqrt((x - c.x) ** 2 + (z - c.z) ** 2);
      const qy = y - cy; // +h arriba (radio r1), -h abajo (radio r2)
      const cax = qx - min(qx, qy < 0 ? r2 : r1);
      const cay = abs(qy) - h;
      const t = clamp(((k1x - qx) * k2x + (k1y - qy) * k2y) / k2l, 0, 1);
      const cbx = qx - k1x + k2x * t;
      const cby = qy - k1y + k2y * t;
      const sgn = cbx < 0 && cay < 0 ? -1 : 1;
      return sgn * sqrt(min(cax * cax + cay * cay, cbx * cbx + cby * cby)) - rb;
    },
    bounds: { c: v3(c.x, cy, c.z), r: sqrt(h * h + max(r1, r2) ** 2) + rb },
  };
}

/** Semiespacio: negativo del lado contrario a la normal n (dot(p,n) < k) */
export function halfspace(n, k) {
  const u = norm(n);
  return (x, y, z) => x * u.x + y * u.y + z * u.z - k;
}

// ---------- Piezas para muebles ----------

/** Caja con esquinas redondeadas `r`, de semiejes hx·hy·hz (alineada con los ejes) */
export function roundBox(c, hx, hy, hz, r = 0) {
  return {
    d: (x, y, z) => {
      const qx = abs(x - c.x) - hx + r;
      const qy = abs(y - c.y) - hy + r;
      const qz = abs(z - c.z) - hz + r;
      const ox = max(qx, 0);
      const oy = max(qy, 0);
      const oz = max(qz, 0);
      return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, max(qy, qz)), 0) - r;
    },
    bounds: { c, r: sqrt(hx * hx + hy * hy + hz * hz) },
  };
}

/** Cilindro vertical de radio `r` y semialtura `h`, con cantos redondeados `rr` */
export function cylinder(c, r, h, rr = 0) {
  return {
    d: (x, y, z) => {
      const dx = sqrt((x - c.x) ** 2 + (z - c.z) ** 2) - (r - rr);
      const dy = abs(y - c.y) - (h - rr);
      const ox = max(dx, 0);
      const oy = max(dy, 0);
      return min(max(dx, dy), 0) + sqrt(ox * ox + oy * oy) - rr;
    },
    bounds: { c, r: sqrt(r * r + h * h) },
  };
}

/** Cilindro entre dos puntos cualesquiera (discos de altavoz, esferas de reloj) */
export function cylinderAB(a, b, r) {
  const ba = sub(b, a);
  const baba = dot(ba, ba) || 1e-9;
  return {
    d: (x, y, z) => {
      const pax = x - a.x;
      const pay = y - a.y;
      const paz = z - a.z;
      const paba = pax * ba.x + pay * ba.y + paz * ba.z;
      const qx = pax * baba - ba.x * paba;
      const qy = pay * baba - ba.y * paba;
      const qz = paz * baba - ba.z * paba;
      const xx = sqrt(qx * qx + qy * qy + qz * qz) - r * baba;
      const yy = abs(paba - baba * 0.5) - baba * 0.5;
      const x2 = xx * xx;
      const y2 = yy * yy * baba;
      const d = max(xx, yy) < 0 ? -min(x2, y2) : (xx > 0 ? x2 : 0) + (yy > 0 ? y2 : 0);
      return (Math.sign(d) * sqrt(abs(d))) / baba;
    },
    bounds: { c: mul(add(a, b), 0.5), r: len(ba) / 2 + r },
  };
}

/** Aro horizontal (en el plano XZ) de radio mayor R y grosor r */
export function torus(c, R, r) {
  return {
    d: (x, y, z) => {
      const qx = sqrt((x - c.x) ** 2 + (z - c.z) ** 2) - R;
      const qy = y - c.y;
      return sqrt(qx * qx + qy * qy) - r;
    },
    bounds: { c, r: R + r },
  };
}

/** Caja orientada: ejes unitarios `ax, ay, az` y semiejes `h` (v3) */
export function boxAxes(c, ax, ay, az, h, r = 0) {
  const b = roundBox(v3(0, 0, 0), h.x, h.y, h.z, r);
  return {
    d: (x, y, z) => {
      const p = v3(x - c.x, y - c.y, z - c.z);
      return b.d(dot(p, ax), dot(p, ay), dot(p, az));
    },
    bounds: { c, r: sqrt(h.x * h.x + h.y * h.y + h.z * h.z) },
  };
}
