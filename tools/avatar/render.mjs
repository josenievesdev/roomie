// Trazador de rayos para las capas del avatar.
//
// Cámara ortográfica con la MISMA proyección que el suelo del juego (2:1,
// ver `src/utils/iso.ts`): el eje col va a (32,16) px y el eje row a (-32,16).
// Eso es una cámara a 30° de elevación girada 45°. Si el avatar se dibujara
// con otra cámara, sus pies patinarían sobre las baldosas al caminar.
//
// Por cada píxel se guarda QUÉ material es, con qué banda de luz (0 brillo …
// 3 sombra) y a qué PROFUNDIDAD. La profundidad es lo que permite combinar
// capas en el navegador: si la manga está más cerca que el torso, se ve la
// manga, sin reglas de "qué va encima de qué" por prenda.

import { add, dot, mul, norm, smin, v3 } from "./sdf.mjs";
import { MAT } from "../../src/state/look.ts";

const ELEV = (30 * Math.PI) / 180;
const S2 = Math.SQRT1_2;

/** Ejes de la cámara en el MUNDO (X = col, Y = arriba, Z = row) */
export const CAM = {
  right: v3(S2, 0, -S2),
  up: v3(-Math.sin(ELEV) * S2, Math.cos(ELEV), -Math.sin(ELEV) * S2),
  view: v3(Math.cos(ELEV) * S2, Math.sin(ELEV), Math.cos(ELEV) * S2), // hacia la cámara
};

/**
 * La luz de TODO el juego: desde arriba y del lado del eje col (derecha de la
 * pantalla). Es la que ya usan los muebles: tapa clara, cara sureste media,
 * cara suroeste en sombra (ver `docs/guia-de-estilo.md`).
 */
export const LUZ = norm(v3(0.5, 1.0, 0.16));

/** Rumbo de la dirección d (0 = N … 7 = NO, en sentido horario en pantalla) */
export const rumbo = (d) => ((225 - 45 * d) * Math.PI) / 180;

/** Profundidad → byte: 0 queda libre para "vacío" */
export const PROF = { cero: 170, escala: 3 };
export const profByte = (t) => Math.max(1, Math.min(255, Math.round(PROF.cero + t * PROF.escala)));

// Mundo → modelo (rotación inversa del rumbo) y al revés
const aModelo = (v, c, s) => v3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);

function distGrupo(g, x, y, z) {
  const sh = g.shapes;
  let d = sh[0].d(x, y, z);
  for (let i = 1; i < sh.length; i++) d = smin(d, sh[i].d(x, y, z), g.k);
  if (g.subs) for (const s of g.subs) d = Math.max(d, -s.d(x, y, z));
  if (g.clips) for (const c of g.clips) d = Math.max(d, c(x, y, z));
  return d;
}

let ultimoGrupo = -1;
function distEscena(grupos, x, y, z) {
  let best = Infinity;
  for (let i = 0; i < grupos.length; i++) {
    const d = distGrupo(grupos[i], x, y, z);
    if (d < best) {
      best = d;
      ultimoGrupo = i;
    }
  }
  return best;
}

/** Esfera que envuelve todas las piezas (para no trazar rayos al vacío) */
function envolvente(grupos) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (const g of grupos) {
    for (const s of g.shapes) {
      const { c, r } = s.bounds;
      mnx = Math.min(mnx, c.x - r); mxx = Math.max(mxx, c.x + r);
      mny = Math.min(mny, c.y - r); mxy = Math.max(mxy, c.y + r);
      mnz = Math.min(mnz, c.z - r); mxz = Math.max(mxz, c.z + r);
    }
  }
  const c = v3((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
  const r = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2 + 0.5;
  return { c, r };
}

/**
 * Banda de luz (0 brillo … 3 sombra) de un punto con normal n.
 * Media Lambert + oclusión barata: si justo por fuera de la superficie hay
 * otra pieza cerca (bajo la barbilla, en la axila), el punto se oscurece.
 */
function banda(n, L, H, ocl, g) {
  const nl = dot(n, L);
  // Umbrales puestos LEJOS de las orientaciones típicas: la cara que mira a
  // la cámara da nl≈0.4 y cae holgada en la banda 1. Con el umbral encima
  // (como al principio), medio cuerpo bailaba entre dos bandas y salía a
  // manchas.
  let b = nl > 0.74 ? 0 : nl > 0.22 ? 1 : nl > -0.2 ? 2 : 3;
  if (g.hair) {
    // Brillo del pelo: una franja especular, el "halo" típico del pixel art
    const spec = Math.max(0, dot(n, H)) ** 30;
    if (spec > 0.62) b = 0;
    else if (b === 0) b = 1;
  }
  // La piel va casi plana: ni brillo (un parche claro en la frente parece
  // una mancha) ni sombra dura por orientación (una barbilla en sombra
  // profunda se lee como barba). Sólo luz y media, más la oclusión.
  if (g.suave) b = Math.min(Math.max(b, 1), 2);
  if (ocl < 0.42) b = Math.min(3, b + 1);
  return b;
}

/**
 * Traza un fotograma de una capa.
 * @returns {{mat: Uint8Array, shade: Uint8Array, depth: Float32Array}}
 */
export function trazar(grupos, dir, W, H, ax, ay) {
  const th = rumbo(dir);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const R = aModelo(CAM.right, c, s);
  const U = aModelo(CAM.up, c, s);
  const V = aModelo(CAM.view, c, s);
  const L = aModelo(LUZ, c, s);
  const Hh = norm(add(L, V));
  const D = 200;

  const mat = new Uint8Array(W * H);
  const shade = new Uint8Array(W * H);
  const depth = new Float32Array(W * H).fill(Infinity);
  if (grupos.length === 0) return { mat, shade, depth };
  const env = envolvente(grupos);

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const sx = i + 0.5 - ax;
      const sy = j + 0.5 - ay;
      // Origen del rayo en el plano de la cámara, lejos, y dirección -V
      const ox = R.x * sx - U.x * sy + V.x * D;
      const oy = R.y * sx - U.y * sy + V.y * D;
      const oz = R.z * sx - U.z * sy + V.z * D;
      // Intersección con la envolvente: |l - V·t|² = r², con l = origen - centro
      const lx = ox - env.c.x, ly = oy - env.c.y, lz = oz - env.c.z;
      const b = lx * V.x + ly * V.y + lz * V.z;
      const cc = lx * lx + ly * ly + lz * lz - env.r * env.r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = Math.max(0, b - sq);
      const tMax = b + sq;

      let hit = false;
      for (let it = 0; it < 200 && t < tMax; it++) {
        const px = ox - V.x * t, py = oy - V.y * t, pz = oz - V.z * t;
        const d = distEscena(grupos, px, py, pz);
        if (d < 0.01) {
          hit = true;
          break;
        }
        t += Math.max(d * 0.8, 0.01);
      }
      if (!hit) continue;

      const gi = ultimoGrupo;
      const g = grupos[gi];
      const px = ox - V.x * t, py = oy - V.y * t, pz = oz - V.z * t;
      const e = 0.04;
      const n = norm(
        v3(
          distGrupo(g, px + e, py, pz) - distGrupo(g, px - e, py, pz),
          distGrupo(g, px, py + e, pz) - distGrupo(g, px, py - e, pz),
          distGrupo(g, px, py, pz + e) - distGrupo(g, px, py, pz - e),
        ),
      );
      const q = add(v3(px, py, pz), mul(n, 1.6));
      const ocl = distEscena(grupos, q.x, q.y, q.z) / 1.6;
      const k = j * W + i;
      mat[k] = g.matFn ? g.matFn(px, py, pz) : g.mat;
      shade[k] = banda(n, L, Hh, ocl, g);
      depth[k] = t - D;
    }
  }
  return { mat, shade, depth };
}

/** Proyecta un punto del modelo a píxel del fotograma (+ su profundidad) */
export function proyectar(p, dir, ax, ay) {
  const th = rumbo(dir);
  const c = Math.cos(th);
  const s = Math.sin(th);
  // Modelo → mundo
  const w = v3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  return {
    x: ax + dot(w, CAM.right),
    y: ay - dot(w, CAM.up),
    t: -dot(w, CAM.view),
  };
}

/** Normal del modelo → producto con la dirección de la cámara (1 = de frente) */
export function deFrente(n, dir) {
  const th = rumbo(dir);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const w = v3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  return dot(w, CAM.view);
}

/**
 * Pinta los rasgos de la cara sobre el fotograma ya trazado del cuerpo.
 * Cada rasgo sólo aparece si mira a la cámara y no lo tapa nada (pelo, mano).
 */
export function pintarCara(f, rasgos, dir, W, H, ax, ay) {
  const put = (x, y, m, sh = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = y * W + x;
    if (f.mat[k] !== MAT.PIEL) return; // sólo sobre piel visible
    f.mat[k] = m;
    f.shade[k] = sh;
  };
  const visible = (r, umbral) => {
    const frente = deFrente(r.n, dir);
    if (frente < umbral) return null;
    const pr = proyectar(r.p, dir, ax, ay);
    const x = Math.floor(pr.x);
    const y = Math.floor(pr.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    // Oculto si lo que se ve en ese píxel está bastante más cerca (una mano
    // delante de la cara). El pelo no hace falta mirarlo: `put` sólo pinta
    // sobre piel. Holgura de 3: los mofletes abultan sobre el elipsoide.
    if (Math.abs(f.depth[y * W + x] - pr.t) > 3) return null;
    return { x, y, frente };
  };

  for (const [ojo, lado] of [[rasgos.ojoL, 1], [rasgos.ojoR, -1]]) {
    const v = visible(ojo, 0.18);
    if (!v) continue;
    const ancho = v.frente > 0.62 ? 2 : 1;
    const x0 = ancho === 2 ? v.x - (lado > 0 ? 0 : 1) : v.x;
    if (rasgos.parpado) {
      for (let dx = 0; dx < ancho; dx++) put(x0 + dx, v.y + 1, MAT.OJO);
      continue;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = 0; dx < ancho; dx++) put(x0 + dx, v.y + dy, MAT.OJO);
    }
    // Brillo arriba, del lado de la luz
    if (ancho === 2) put(x0 + 1, v.y - 1, MAT.BRILLO_OJO, 0);
  }

  for (const [ceja, lado] of [[rasgos.cejaL, 1], [rasgos.cejaR, -1]]) {
    const v = visible(ceja, 0.3);
    if (!v) continue;
    const ancho = v.frente > 0.62 ? 2 : 1;
    const x0 = ancho === 2 ? v.x - (lado > 0 ? 0 : 1) : v.x;
    for (let dx = 0; dx < ancho; dx++) put(x0 + dx, v.y, MAT.CEJA);
  }

  const b = visible(rasgos.boca, 0.35);
  if (b) {
    const ancho = b.frente > 0.7 ? 2 : 1;
    for (let dx = 0; dx < ancho; dx++) put(b.x - (ancho === 2 ? 1 : 0) + dx, b.y, MAT.BOCA);
  }
}
