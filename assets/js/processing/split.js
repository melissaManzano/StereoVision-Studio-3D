import { toGray } from './image.js';

/**
 * Separación de una imagen única en dos vistas.
 * Detección automática: se comparan las dos mitades horizontales (lado a lado) y las dos
 * mitades verticales (arriba/abajo) con correlación cruzada normalizada (NCC) sobre la
 * imagen en grises. Las dos vistas de un par estéreo son casi idénticas, así que la partición
 * correcta es la de mayor correlación. Se tolera un pequeño desplazamiento probando varios
 * corrimientos horizontales (la disparidad hace que las mitades no coincidan exactamente).
 */

function ncc(gray, ax, ay, bx, by, w, h) {
  const { data: d, width } = gray;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = d[(ay + y) * width + ax + x];
      const b = d[(by + y) * width + bx + x];
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
    }
  }
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : 0;
}

function bestShiftNCC(gray, ax, ay, bx, by, w, h) {
  const maxShift = Math.max(1, Math.round(w * 0.06));
  let best = -1;
  for (let s = -maxShift; s <= maxShift; s += Math.max(1, Math.round(maxShift / 6))) {
    const x0 = Math.max(0, -s);
    const ww = w - Math.abs(s);
    best = Math.max(best, ncc(gray, ax + x0, ay, bx + x0 + s, by, ww, h));
  }
  return best;
}

/**
 * @param {{data, width, height}} rgba imagen reducida (p. ej. 256 px de ancho)
 * @returns {{ layout: 'sbs'|'tb', sbs: number, tb: number }}
 */
export function detectStereoLayout(rgba) {
  const g = toGray(rgba);
  const hw = Math.floor(g.width / 2);
  const hh = Math.floor(g.height / 2);
  const sbs = bestShiftNCC(g, 0, 0, hw, 0, hw, g.height);
  const tb = bestShiftNCC(g, 0, 0, 0, hh, g.width, hh);
  return { layout: tb > sbs ? 'tb' : 'sbs', sbs, tb };
}

/** Rectángulos de cada vista para la disposición indicada. 'cross' = cruzado (derecha a la izquierda). */
export function splitRects(layout, width, height) {
  const hw = Math.floor(width / 2);
  const hh = Math.floor(height / 2);
  switch (layout) {
    case 'sbs': return { left: [0, 0, hw, height], right: [hw, 0, hw, height] };
    case 'cross': return { left: [hw, 0, hw, height], right: [0, 0, hw, height] };
    case 'tb': return { left: [0, 0, width, hh], right: [0, hh, width, hh] };
    default: throw new Error(`Disposición desconocida: ${layout}`);
  }
}
