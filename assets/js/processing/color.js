/**
 * Igualación de color entre vistas por coincidencia de histogramas.
 * Para cada canal se calcula la función de distribución acumulada (CDF) de ambas vistas;
 * cada nivel v de la vista derecha se reasigna al menor nivel u de la izquierda con
 * CDF_izq(u) ≥ CDF_der(v). El resultado es una tabla (LUT) de 256 entradas por canal que
 * la GPU aplica a la vista derecha. Así se corrigen diferencias de exposición, contraste
 * y dominantes de color entre las dos cámaras.
 */

/** Histogramas R, G y B de una imagen RGBA, ignorando píxeles transparentes. */
export function histograms(image) {
  const h = [new Float64Array(256), new Float64Array(256), new Float64Array(256)];
  const d = image.data;
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] === 0) continue;
    h[0][d[p]]++;
    h[1][d[p + 1]]++;
    h[2][d[p + 2]]++;
  }
  return h;
}

function cdf(hist) {
  const out = new Float64Array(256);
  let sum = 0;
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 256; i++) {
    sum += hist[i];
    out[i] = sum / total;
  }
  return out;
}

/** LUT (Uint8Array de 768: 256 R, 256 G, 256 B) que lleva el histograma de `source` al de `reference`. */
export function matchHistogramsLUT(source, reference) {
  const hs = histograms(source);
  const hr = histograms(reference);
  const lut = new Uint8Array(768);
  for (let c = 0; c < 3; c++) {
    const cs = cdf(hs[c]);
    const cr = cdf(hr[c]);
    let u = 0;
    for (let v = 0; v < 256; v++) {
      while (u < 255 && cr[u] < cs[v] - 1e-9) u++;
      lut[c * 256 + v] = u;
    }
  }
  return lut;
}

/** Aplica una LUT RGB a una imagen RGBA (se usa en pruebas y como referencia de la GPU). */
export function applyLUT(image, lut) {
  const out = new Uint8ClampedArray(image.data);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = lut[out[p]];
    out[p + 1] = lut[256 + out[p + 1]];
    out[p + 2] = lut[512 + out[p + 2]];
  }
  return { data: out, width: image.width, height: image.height };
}
