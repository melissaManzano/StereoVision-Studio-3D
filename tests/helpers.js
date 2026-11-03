import { seededRandom } from '../assets/js/processing/image.js';

/** Imagen RGBA sintética con textura (manchas suavizadas y rectángulos) para probar la detección de rasgos. */
export function texturedImage(width, height, seed = 1) {
  const rand = seededRandom(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const base = new Float32Array(width * height).fill(110);
  for (let k = 0; k < 700; k++) {
    const x0 = Math.floor(rand() * width);
    const y0 = Math.floor(rand() * height);
    const w = 4 + Math.floor(rand() * 26);
    const h = 4 + Math.floor(rand() * 26);
    const v = rand() * 140 - 70;
    for (let y = y0; y < Math.min(height, y0 + h); y++) {
      for (let x = x0; x < Math.min(width, x0 + w); x++) base[y * width + x] += v;
    }
  }
  for (let i = 0; i < base.length; i++) {
    const v = Math.max(0, Math.min(255, base[i] + (rand() - 0.5) * 6));
    data.set([v, v * 0.9 + 10, v * 0.8 + 20, 255], i * 4);
  }
  return { data, width, height };
}

/** Remuestrea `src` con la transformación inversa dada (punto destino → punto origen), bilineal. */
export function warp(src, inverse) {
  const { width: w, height: h } = src;
  const out = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = inverse(x, y);
      const p = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) { out[p + 3] = 255; continue; }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const a = src.data[(y0 * w + x0) * 4 + c] * (1 - fx) + src.data[(y0 * w + x0 + 1) * 4 + c] * fx;
        const b = src.data[((y0 + 1) * w + x0) * 4 + c] * (1 - fx) + src.data[((y0 + 1) * w + x0 + 1) * 4 + c] * fx;
        out[p + c] = a * (1 - fy) + b * fy;
      }
      out[p + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

export function solid(width, height, rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < data.length; p += 4) data.set([...rgb, 255], p);
  return { data, width, height };
}
