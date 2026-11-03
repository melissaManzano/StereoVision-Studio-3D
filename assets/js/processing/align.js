import { seededRandom, percentile, toGray } from './image.js';
import { detectFeatures, describeFeatures, matchFeatures } from './features.js';

/**
 * Geometría del par estéreo. Convenciones:
 *  - Todas las coordenadas están en píxeles de la imagen orientada, con y hacia abajo.
 *  - La vista izquierda es la referencia; las correcciones se aplican a la vista derecha.
 *  - La matriz H de la vista derecha lleva un punto de la imagen derecha al marco de referencia:
 *      H = T(c) · T(paralaje, dy) · R(θ) · S(escala) · K(keystone) · T(−c),  c = centro de la imagen.
 *  - La rotación fina del par entero (ambas vistas) es R_par alrededor del centro.
 */

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function multiply3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error('Matriz no invertible');
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

export function applyH(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

const translate = (tx, ty) => [1, 0, tx, 0, 1, ty, 0, 0, 1];
function rotate(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotación de `deg` grados alrededor de (cx, cy). */
export function rotationAbout(deg, cx, cy) {
  return multiply3(translate(cx, cy), multiply3(rotate(deg), translate(-cx, -cy)));
}

/**
 * Homografía de la vista derecha. El keystone es una perspectiva pura:
 * en el borde derecho (x = W/2 desde el centro) la escala cambia en 1/(1 + keyH).
 */
export function rightHomography(align, width, height) {
  const { dy = 0, rotation = 0, scale = 1, keyH = 0, keyV = 0, parallax = 0 } = align;
  const cx = width / 2;
  const cy = height / 2;
  const K = [1, 0, 0, 0, 1, 0, (2 * keyH) / width, (2 * keyV) / height, 1];
  const S = [scale, 0, 0, 0, scale, 0, 0, 0, 1];
  let m = translate(-cx, -cy);
  m = multiply3(K, m);
  m = multiply3(S, m);
  m = multiply3(rotate(rotation), m);
  m = multiply3(translate(parallax, dy), m);
  return multiply3(translate(cx, cy), m);
}

function solve3(M, v) {
  const inv = invert3(M);
  return [
    inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2],
    inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2],
    inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2],
  ];
}

/** Mínimos cuadrados de yL = a·xR + b·yR + t sobre los índices dados (ecuaciones normales 3×3). */
function fitVertical(L, R, idx) {
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const v = [0, 0, 0];
  for (const i of idx) {
    const row = [R[i][0], R[i][1], 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) M[r * 3 + c] += row[r] * row[c];
      v[r] += row[r] * L[i][1];
    }
  }
  return solve3(M, v);
}

/**
 * Alineación vertical robusta para pares estéreo (RANSAC).
 * En un par bien alineado los puntos homólogos solo difieren en x (la disparidad, que
 * depende de la profundidad). Por eso no se ajusta x: se busca la rotación θ, la escala s
 * y el desplazamiento vertical t de la vista derecha que igualan las coordenadas y:
 *      yL ≈ s·sinθ·xR + s·cosθ·yR + t   (coordenadas relativas al centro)
 * que es lineal en a = s·sinθ, b = s·cosθ y t. RANSAC toma muestras mínimas de 3 coincidencias,
 * cuenta inliers con residuo vertical < umbral y reajusta por mínimos cuadrados con los inliers.
 *
 * @param {Array<[number, number]>} ptsL  puntos de la vista izquierda
 * @param {Array<[number, number]>} ptsR  puntos homólogos de la vista derecha
 */
export function estimateStereoAlignment(ptsL, ptsR, { width, height, iterations = 800, threshold = 1.5, seed = 7 } = {}) {
  const n = ptsL.length;
  if (n < 8) return { ok: false, reason: `Solo ${n} coincidencias; se necesitan al menos 8.`, matches: n };
  const cx = width / 2;
  const cy = height / 2;
  const L = ptsL.map(([x, y]) => [x - cx, y - cy]);
  const R = ptsR.map(([x, y]) => [x - cx, y - cy]);
  const rand = seededRandom(seed);
  let bestInliers = [];

  for (let it = 0; it < iterations; it++) {
    const s = new Set();
    while (s.size < 3) s.add(Math.floor(rand() * n));
    let model;
    try { model = fitVertical(L, R, [...s]); } catch { continue; } // muestra degenerada
    const [a, b, t] = model;
    if (b <= 0.8 || b >= 1.25 || Math.abs(a) > 0.2) continue; // rotación o escala inverosímiles
    const inliers = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(a * R[i][0] + b * R[i][1] + t - L[i][1]) < threshold) inliers.push(i);
    }
    if (inliers.length > bestInliers.length) bestInliers = inliers;
  }
  if (bestInliers.length < 6) return { ok: false, reason: 'No hay suficientes coincidencias coherentes entre las vistas.', matches: n };

  const [a, b, t] = fitVertical(L, R, bestInliers);
  const rotation = (Math.atan2(a, b) * 180) / Math.PI;
  const scale = Math.hypot(a, b);
  let before = 0;
  let after = 0;
  const parallax = [];
  const xs = [];
  for (const i of bestInliers) {
    before += (L[i][1] - R[i][1]) ** 2;
    after += (a * R[i][0] + b * R[i][1] + t - L[i][1]) ** 2;
    // Paralaje en pantalla tras corregir: P = x'R − xL  (P > 0 detrás de la pantalla).
    parallax.push(b * R[i][0] - a * R[i][1] - L[i][0]);
    xs.push(L[i][0] + cx);
  }
  return {
    ok: true,
    matches: n,
    inliers: bestInliers.length,
    rotation,
    scale,
    dy: t,
    rmsBefore: Math.sqrt(before / bestInliers.length),
    rmsAfter: Math.sqrt(after / bestInliers.length),
    parallax,   // por inlier, sin desplazamiento horizontal aplicado
    xs,         // posición x (marco de referencia) de cada inlier, para la ventana flotante
  };
}

/**
 * Proceso completo de alineación automática sobre imágenes reducidas (RGBA):
 * gris → FAST/Harris → BRIEF → emparejado → RANSAC. Los resultados se devuelven
 * en píxeles de la imagen completa multiplicando por `scaleToFull`.
 */
export function autoAlign(leftRGBA, rightRGBA, { scaleToFull = 1 } = {}) {
  const gl = toGray(leftRGBA);
  const gr = toGray(rightRGBA);
  // Escenas con poca textura: si hay pocas esquinas se repite la detección con un umbral más bajo.
  const detect = (g) => {
    let f = detectFeatures(g);
    if (f.count < 300) f = detectFeatures(g, { threshold: 8 });
    return f;
  };
  const fl = detect(gl);
  const fr = detect(gr);
  const matches = matchFeatures(fl, describeFeatures(gl, fl), fr, describeFeatures(gr, fr), { maxDy: gl.height * 0.1 });
  const pl = matches.map(([i]) => [fl.x[i], fl.y[i]]);
  const pr = matches.map(([, j]) => [fr.x[j], fr.y[j]]);
  const res = estimateStereoAlignment(pl, pr, { width: gl.width, height: gl.height });
  res.features = [fl.count, fr.count];
  if (!res.ok) return res;
  res.dy *= scaleToFull;
  res.rmsBefore *= scaleToFull;
  res.rmsAfter *= scaleToFull;
  res.parallax = res.parallax.map((p) => p * scaleToFull);
  res.xs = res.xs.map((x) => x * scaleToFull);
  return res;
}

/**
 * Montaje en ventana: desplaza la vista derecha para que el punto más cercano
 * (percentil 2 del paralaje, robusto a errores aislados) quede en el plano de la pantalla
 * y el resto de la escena detrás del marco.
 */
export function windowParallax(parallaxValues, p = 0.02) {
  return -percentile(parallaxValues, p);
}

/**
 * Ventana flotante automática: si junto a un borde lateral hay objetos delante de la pantalla
 * (paralaje negativo), se enmascara ese borde con una franja negra de ese ancho:
 * borde izquierdo de la vista izquierda y borde derecho de la vista derecha.
 */
export function floatingWindow(parallaxValues, xs, width, shift, edge = 0.15) {
  let left = 0;
  let right = 0;
  parallaxValues.forEach((p, i) => {
    const P = p + shift;
    if (P >= 0) return;
    if (xs[i] < width * edge) left = Math.max(left, -P);
    if (xs[i] > width * (1 - edge)) right = Math.max(right, -P);
  });
  return { left: Math.ceil(left), right: Math.ceil(right) };
}

/** Rectángulo interior aproximado de un cuadrilátero casi rectangular (TL, TR, BR, BL). */
function innerBox(q) {
  return {
    x0: Math.max(q[0][0], q[3][0]),
    x1: Math.min(q[1][0], q[2][0]),
    y0: Math.max(q[0][1], q[1][1]),
    y1: Math.min(q[2][1], q[3][1]),
  };
}

/**
 * Recorte automático: proyecta las esquinas de ambas vistas al marco final
 * (rotación del par y, para la derecha, su homografía), toma el rectángulo interior de
 * cada cuadrilátero y su intersección. Devuelve márgenes enteros que eliminan los bordes vacíos.
 */
export function autoCropMargins(align, width, height, pairRotation = 0) {
  const R = rotationAbout(pairRotation, width / 2, height / 2);
  const corners = [[0, 0], [width, 0], [width, height], [0, height]];
  const left = innerBox(corners.map(([x, y]) => applyH(R, x, y)));
  const RH = multiply3(R, rightHomography(align, width, height));
  const right = innerBox(corners.map(([x, y]) => applyH(RH, x, y)));
  const x0 = Math.max(0, left.x0, right.x0);
  const y0 = Math.max(0, left.y0, right.y0);
  const x1 = Math.min(width, left.x1, right.x1);
  const y1 = Math.min(height, left.y1, right.y1);
  if (x1 - x0 < width * 0.2 || y1 - y0 < height * 0.2) return null; // corrección excesiva
  return {
    left: Math.ceil(x0),
    top: Math.ceil(y0),
    right: Math.ceil(width - x1),
    bottom: Math.ceil(height - y1),
  };
}
