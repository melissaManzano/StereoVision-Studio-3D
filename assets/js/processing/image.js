/**
 * Utilidades de píxeles sin DOM. Trabajan con objetos { data, width, height }
 * (ImageData o equivalentes), por lo que sirven en el hilo principal, en el
 * Web Worker y en las pruebas de Node.
 */

export const LUMA = Object.freeze([0.299, 0.587, 0.114]);

/** Escala de grises por luminancia Rec. 601: Y = 0.299 R + 0.587 G + 0.114 B. */
export function toGray(image) {
  const { data, width, height } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = LUMA[0] * data[p] + LUMA[1] * data[p + 1] + LUMA[2] * data[p + 2];
  }
  return { data: out, width, height };
}

/**
 * Desenfoque de caja separable (horizontal y luego vertical) con suma móvil:
 * O(n) por píxel, independiente del radio. Dos pasadas aproximan un gaussiano.
 */
export function boxBlur(gray, radius) {
  const { width: w, height: h } = gray;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const size = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -radius; x <= radius; x++) sum += gray.data[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / size;
      sum += gray.data[row + Math.min(w - 1, x + radius + 1)] - gray.data[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return { data: out, width: w, height: h };
}

/** Muestreo bilineal de una imagen de un canal; fuera de rango devuelve `fallback`. */
export function sampleBilinear(gray, x, y, fallback = 0) {
  const { data, width: w, height: h } = gray;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return fallback;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const b = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/** Generador pseudoaleatorio reproducible (mulberry32) para RANSAC y BRIEF. */
export function seededRandom(seed = 0x5eed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentil p (0..1) de una lista numérica, sin modificarla. */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}
