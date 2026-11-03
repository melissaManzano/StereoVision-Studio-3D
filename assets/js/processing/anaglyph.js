import { LUMA } from './image.js';

/**
 * Anaglifos como combinación lineal de las dos vistas:  salida = ML · izquierda + MR · derecha,
 * con ML y MR matrices 3×3 por filas (fila = canal de salida R, G, B).
 * Las mismas matrices se usan en el shader de la vista previa y en esta referencia en CPU,
 * que es la que validan las pruebas.
 *
 *  - Color: rojo de la izquierda, verde y azul de la derecha. Máximo color, más rivalidad retiniana.
 *  - Grises: la luminancia de cada vista va a su canal. Sin color, mínimo efecto fantasma.
 *  - Medio color: luminancia izquierda en rojo, color derecho en verde y azul. Compromiso habitual.
 *  - Dubois (rojo/cian, ámbar/azul, verde/magenta): matrices de Eric Dubois (2001), obtenidas por
 *    mínimos cuadrados a partir de la respuesta espectral de filtros y pantallas. Se aplican sobre
 *    RGB lineal (se elimina la gamma sRGB antes y se vuelve a aplicar después) y reducen el efecto fantasma.
 */
const Z = [0, 0, 0];
const rows = (r, g, b) => [...r, ...g, ...b];

export const ANAGLYPH_MODES = Object.freeze({
  color: { label: 'Anaglifo a color (rojo/cian)', left: rows([1, 0, 0], Z, Z), right: rows(Z, [0, 1, 0], [0, 0, 1]), linear: false },
  gray: { label: 'Anaglifo en grises (rojo/cian)', left: rows(LUMA, Z, Z), right: rows(Z, LUMA, LUMA), linear: false },
  half: { label: 'Anaglifo medio color (rojo/cian)', left: rows(LUMA, Z, Z), right: rows(Z, [0, 1, 0], [0, 0, 1]), linear: false },
  dubois: {
    label: 'Anaglifo optimizado Dubois (rojo/cian)',
    left: [0.456, 0.5, 0.176, -0.04, -0.038, -0.016, -0.015, -0.021, -0.005],
    right: [-0.043, -0.088, -0.002, 0.378, 0.734, -0.018, -0.072, -0.113, 1.226],
    linear: true,
  },
  amberBlue: {
    label: 'Anaglifo ámbar/azul (Dubois)',
    left: [1.062, -0.205, 0.299, -0.026, 0.908, 0.068, -0.038, -0.173, 0.022],
    right: [-0.016, -0.123, -0.017, 0.006, 0.062, -0.017, 0.094, 0.185, 0.911],
    linear: true,
  },
  greenMagenta: {
    label: 'Anaglifo verde/magenta (Dubois)',
    left: [-0.062, -0.158, -0.039, 0.284, 0.668, 0.143, -0.015, -0.027, 0.021],
    right: [0.529, 0.705, 0.024, -0.016, -0.015, -0.065, 0.009, 0.075, 0.937],
    linear: true,
  },
});

/** sRGB (0..1) → lineal, según IEC 61966-2-1. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Lineal (0..1) → sRGB. */
export function linearToSrgb(c) {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * Calcula un píxel anaglifo. `l` y `r` son [R, G, B] en 0..255.
 * @returns {[number, number, number]} en 0..255, redondeado y acotado
 */
export function anaglyphPixel(modeId, l, r) {
  const m = ANAGLYPH_MODES[modeId];
  if (!m) throw new Error(`Modo de anaglifo desconocido: ${modeId}`);
  const conv = m.linear ? (v) => srgbToLinear(v / 255) : (v) => v / 255;
  const L = l.map(conv);
  const R = r.map(conv);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let v = 0;
    for (let j = 0; j < 3; j++) v += m.left[k * 3 + j] * L[j] + m.right[k * 3 + j] * R[j];
    out[k] = Math.round(255 * (m.linear ? linearToSrgb(v) : Math.min(1, Math.max(0, v))));
  }
  return out;
}

/** Compone un anaglifo completo en CPU a partir de dos imágenes RGBA del mismo tamaño. */
export function composeAnaglyph(left, right, modeId) {
  if (left.width !== right.width || left.height !== right.height) throw new Error('Las vistas deben tener el mismo tamaño');
  const out = new Uint8ClampedArray(left.data.length);
  for (let p = 0; p < out.length; p += 4) {
    const px = anaglyphPixel(modeId, [left.data[p], left.data[p + 1], left.data[p + 2]], [right.data[p], right.data[p + 1], right.data[p + 2]]);
    out[p] = px[0];
    out[p + 1] = px[1];
    out[p + 2] = px[2];
    out[p + 3] = 255;
  }
  return { data: out, width: left.width, height: left.height };
}
