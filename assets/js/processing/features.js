import { boxBlur, seededRandom } from './image.js';

/**
 * Detección y descripción de puntos característicos al estilo ORB, sin dependencias:
 *  1. FAST-9: un píxel es esquina si 9 píxeles contiguos del círculo de radio 3
 *     son todos más claros o todos más oscuros que él por más de un umbral.
 *  2. Puntuación de Harris en una ventana 7×7 para quedarse con las esquinas más estables,
 *     repartidas en una cuadrícula para cubrir toda la imagen.
 *  3. Descriptor BRIEF de 256 bits: comparaciones de intensidad entre pares de puntos
 *     fijos (semilla reproducible) dentro de un parche suavizado de 31×31.
 * No se calcula orientación: en un par estéreo la rotación entre vistas es de pocos grados,
 * y BRIEF sin rotar es más discriminante en ese caso.
 */

const CIRCLE = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];
const PATCH_RADIUS = 15;
const DESCRIPTOR_WORDS = 8; // 8 × 32 bits = 256 comparaciones

const BRIEF_PAIRS = (() => {
  const rand = seededRandom(0xb41ef);
  const gauss = () => {
    const u = Math.max(1e-9, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (v) => Math.max(-PATCH_RADIUS, Math.min(PATCH_RADIUS, Math.round(v)));
  const pairs = new Int8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    for (let k = 0; k < 4; k++) pairs[i * 4 + k] = clamp(gauss() * (31 / 5));
  }
  return pairs;
})();

function isFastCorner(d, w, x, y, t) {
  const c = d[y * w + x];
  const hi = c + t;
  const lo = c - t;
  // Prueba rápida: entre los puntos 1, 5, 9 y 13 al menos tres deben superar el umbral.
  let brighter = 0;
  let darker = 0;
  for (const k of [0, 4, 8, 12]) {
    const v = d[(y + CIRCLE[k][1]) * w + x + CIRCLE[k][0]];
    if (v > hi) brighter++;
    else if (v < lo) darker++;
  }
  if (brighter < 3 && darker < 3) return false;
  let runB = 0;
  let runD = 0;
  for (let i = 0; i < 16 + 9; i++) {
    const [dx, dy] = CIRCLE[i % 16];
    const v = d[(y + dy) * w + x + dx];
    runB = v > hi ? runB + 1 : 0;
    runD = v < lo ? runD + 1 : 0;
    if (runB >= 9 || runD >= 9) return true;
  }
  return false;
}

function harrisScore(d, w, x, y) {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      const p = (y + j) * w + x + i;
      const gx = (d[p + 1] - d[p - 1]) * 0.5;
      const gy = (d[p + w] - d[p - w]) * 0.5;
      sxx += gx * gx;
      syy += gy * gy;
      sxy += gx * gy;
    }
  }
  return sxx * syy - sxy * sxy - 0.04 * (sxx + syy) ** 2;
}

/**
 * @param {{data: Float32Array, width: number, height: number}} gray
 * @returns {{ x: Float32Array, y: Float32Array, score: Float32Array, count: number }}
 */
export function detectFeatures(gray, { threshold = 18, maxFeatures = 1500, grid = 12 } = {}) {
  const { data: d, width: w, height: h } = gray;
  const border = PATCH_RADIUS + 2;
  const cellW = Math.max(1, Math.ceil((w - 2 * border) / grid));
  const cellH = Math.max(1, Math.ceil((h - 2 * border) / grid));
  const cells = Array.from({ length: grid * grid }, () => []);

  for (let y = border; y < h - border; y++) {
    for (let x = border; x < w - border; x++) {
      if (!isFastCorner(d, w, x, y, threshold)) continue;
      const score = harrisScore(d, w, x, y);
      if (score <= 0) continue;
      const cell = Math.min(grid - 1, Math.floor((y - border) / cellH)) * grid + Math.min(grid - 1, Math.floor((x - border) / cellW));
      cells[cell].push([x, y, score]);
    }
  }

  // Supresión de no máximos (radio 3) y reparto uniforme: hasta `perCell` esquinas por celda.
  const perCell = Math.ceil(maxFeatures / (grid * grid));
  const chosen = [];
  for (const cell of cells) {
    cell.sort((a, b) => b[2] - a[2]);
    const kept = [];
    for (const c of cell) {
      if (kept.length >= perCell) break;
      if (kept.every((k) => Math.abs(k[0] - c[0]) > 3 || Math.abs(k[1] - c[1]) > 3)) kept.push(c);
    }
    chosen.push(...kept);
  }
  const n = chosen.length;
  const out = { x: new Float32Array(n), y: new Float32Array(n), score: new Float32Array(n), count: n };
  chosen.forEach(([x, y, s], i) => { out.x[i] = x; out.y[i] = y; out.score[i] = s; });
  return out;
}

/** Calcula los descriptores BRIEF (8 palabras de 32 bits por punto) sobre la imagen suavizada. */
export function describeFeatures(gray, features) {
  const smooth = boxBlur(boxBlur(gray, 2), 2);
  const { data: d, width: w } = smooth;
  const desc = new Uint32Array(features.count * DESCRIPTOR_WORDS);
  for (let f = 0; f < features.count; f++) {
    const cx = Math.round(features.x[f]);
    const cy = Math.round(features.y[f]);
    for (let b = 0; b < 256; b++) {
      const q = b * 4;
      const a = d[(cy + BRIEF_PAIRS[q + 1]) * w + cx + BRIEF_PAIRS[q]];
      const c = d[(cy + BRIEF_PAIRS[q + 3]) * w + cx + BRIEF_PAIRS[q + 2]];
      if (a < c) desc[f * DESCRIPTOR_WORDS + (b >>> 5)] |= 1 << (b & 31);
    }
  }
  return desc;
}

function popcount(v) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hamming(a, ia, b, ib) {
  let d = 0;
  for (let k = 0; k < DESCRIPTOR_WORDS; k++) d += popcount(a[ia + k] ^ b[ib + k]);
  return d;
}

function bestMatches(fa, da, fb, db, maxDy) {
  const best = new Int32Array(fa.count).fill(-1);
  const dist1 = new Int32Array(fa.count);
  const dist2 = new Int32Array(fa.count);
  for (let i = 0; i < fa.count; i++) {
    let b1 = 257;
    let b2 = 257;
    let bi = -1;
    for (let j = 0; j < fb.count; j++) {
      if (Math.abs(fa.y[i] - fb.y[j]) > maxDy) continue; // restricción epipolar aproximada
      const dist = hamming(da, i * DESCRIPTOR_WORDS, db, j * DESCRIPTOR_WORDS);
      if (dist < b1) { b2 = b1; b1 = dist; bi = j; } else if (dist < b2) b2 = dist;
    }
    best[i] = bi;
    dist1[i] = b1;
    dist2[i] = b2;
  }
  return { best, dist1, dist2 };
}

/**
 * Emparejamiento por fuerza bruta con distancia de Hamming, prueba de razón de Lowe
 * (mejor < ratio × segundo mejor) y verificación cruzada (A→B y B→A coinciden).
 * `maxDy` limita la búsqueda a puntos con desplazamiento vertical plausible en un par estéreo.
 * @returns {Array<[number, number, number]>} [índice en A, índice en B, distancia]
 */
export function matchFeatures(fa, da, fb, db, { ratio = 0.8, maxDistance = 70, maxDy = Infinity } = {}) {
  const ab = bestMatches(fa, da, fb, db, maxDy);
  const ba = bestMatches(fb, db, fa, da, maxDy);
  const matches = [];
  for (let i = 0; i < fa.count; i++) {
    const j = ab.best[i];
    if (j < 0 || ab.dist1[i] > maxDistance) continue;
    if (ab.dist1[i] >= ratio * ab.dist2[i]) continue;
    if (ba.best[j] !== i) continue;
    matches.push([i, j, ab.dist1[i]]);
  }
  return matches;
}
