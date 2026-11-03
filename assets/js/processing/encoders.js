/**
 * Codificadores de archivo sin dependencias: TIFF, GIF animado (wiggle) y ZIP (lotes).
 * PNG y JPEG los codifica el navegador (OffscreenCanvas / canvas.toBlob).
 */

/**
 * TIFF baseline RGB de 8 bits sin compresión (sin pérdida), little-endian, una sola tira.
 * Estructura: cabecera "II*\0" → IFD con las etiquetas obligatorias → datos auxiliares → píxeles.
 */
export function encodeTIFF(image) {
  const { width: w, height: h, data } = image;
  const pixelBytes = w * h * 3;
  const entries = 13;
  const ifdOffset = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const bpsOffset = ifdOffset + ifdSize;   // 3 × SHORT
  const xresOffset = bpsOffset + 6;        // RATIONAL
  const yresOffset = xresOffset + 8;
  const pixelOffset = yresOffset + 8;
  const buf = new ArrayBuffer(pixelOffset + pixelBytes);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, ifdOffset, true);
  v.setUint16(ifdOffset, entries, true);
  let e = ifdOffset + 2;
  const tag = (id, type, count, value) => {
    v.setUint16(e, id, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(e + 8, value, true);
    else v.setUint32(e + 8, value, true);
    e += 12;
  };
  // Las etiquetas deben ir en orden ascendente.
  tag(256, 4, 1, w);               // ImageWidth
  tag(257, 4, 1, h);               // ImageLength
  tag(258, 3, 3, bpsOffset);       // BitsPerSample → 8,8,8
  tag(259, 3, 1, 1);               // Compression: ninguna
  tag(262, 3, 1, 2);               // Photometric: RGB
  tag(273, 4, 1, pixelOffset);     // StripOffsets
  tag(277, 3, 1, 3);               // SamplesPerPixel
  tag(278, 4, 1, h);               // RowsPerStrip
  tag(279, 4, 1, pixelBytes);      // StripByteCounts
  tag(282, 5, 1, xresOffset);      // XResolution
  tag(283, 5, 1, yresOffset);      // YResolution
  tag(284, 3, 1, 1);               // PlanarConfiguration: intercalado
  tag(296, 3, 1, 2);               // ResolutionUnit: pulgada
  v.setUint32(e, 0, true);         // no hay más IFD
  [8, 8, 8].forEach((b, i) => v.setUint16(bpsOffset + i * 2, b, true));
  v.setUint32(xresOffset, 72, true); v.setUint32(xresOffset + 4, 1, true);
  v.setUint32(yresOffset, 72, true); v.setUint32(yresOffset + 4, 1, true);
  for (let s = 0, d = pixelOffset; s < data.length; s += 4, d += 3) {
    u8[d] = data[s];
    u8[d + 1] = data[s + 1];
    u8[d + 2] = data[s + 2];
  }
  return u8;
}

/**
 * Paleta de hasta 256 colores por corte de mediana (median cut): se parte del cubo de color
 * que contiene una muestra de píxeles de todos los fotogramas y se divide repetidamente la caja
 * con mayor rango por la mediana de su canal más largo. Cada caja aporta su color promedio.
 */
function medianCutPalette(frames, maxColors = 256) {
  const sample = [];
  for (const f of frames) {
    const step = Math.max(1, Math.floor((f.width * f.height) / 40000));
    for (let p = 0; p < f.data.length; p += 4 * step) sample.push([f.data[p], f.data[p + 1], f.data[p + 2]]);
  }
  const boxes = [sample];
  const range = (box, c) => {
    let lo = 255;
    let hi = 0;
    for (const px of box) { if (px[c] < lo) lo = px[c]; if (px[c] > hi) hi = px[c]; }
    return hi - lo;
  };
  while (boxes.length < maxColors) {
    let bi = -1;
    let bestRange = 0;
    let bestC = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        const r = range(box, c);
        if (r > bestRange) { bestRange = r; bi = i; bestC = c; }
      }
    });
    if (bi < 0 || bestRange === 0) break;
    const box = boxes[bi].sort((a, b) => a[bestC] - b[bestC]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    const s = [0, 0, 0];
    for (const px of box) { s[0] += px[0]; s[1] += px[1]; s[2] += px[2]; }
    return s.map((v) => Math.round(v / Math.max(1, box.length)));
  });
}

function indexFrame(frame, palette) {
  const cache = new Int16Array(32768).fill(-1); // color reducido a 15 bits → índice de paleta
  const out = new Uint8Array(frame.width * frame.height);
  const d = frame.data;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const key = ((d[p] >> 3) << 10) | ((d[p + 1] >> 3) << 5) | (d[p + 2] >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let best = Infinity;
      for (let k = 0; k < palette.length; k++) {
        const dr = palette[k][0] - d[p];
        const dg = palette[k][1] - d[p + 1];
        const db = palette[k][2] - d[p + 2];
        const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (dist < best) { best = dist; idx = k; }
      }
      cache[key] = idx;
    }
    out[i] = idx;
  }
  return out;
}

/** Compresión LZW de GIF con códigos de longitud variable (9 a 12 bits) y reinicio de tabla. */
function lzw(indices, minCodeSize = 8) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();
  const out = [];
  let acc = 0;
  let bits = 0;
  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(acc & 0xff); acc >>>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      codeSize = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(acc & 0xff);
  return out;
}

/**
 * GIF89a animado en bucle infinito. Todos los fotogramas comparten una paleta global
 * para que el parpadeo del wiggle no cambie de color entre vistas.
 * @param {Array<{data, width, height}>} frames del mismo tamaño
 * @param {{ delay: number }} options retardo por fotograma en milisegundos
 */
export function encodeGIF(frames, { delay = 150 } = {}) {
  const { width: w, height: h } = frames[0];
  const palette = medianCutPalette(frames);
  while (palette.length < 256) palette.push([0, 0, 0]);
  const bytes = [];
  const u16 = (n) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  bytes.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  u16(w); u16(h);
  bytes.push(0xf7, 0, 0); // tabla global de 256 colores
  palette.forEach((c) => bytes.push(c[0], c[1], c[2]));
  bytes.push(0x21, 0xff, 0x0b, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0);
  const cs = Math.max(2, Math.round(delay / 10));
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x04); u16(cs); bytes.push(0, 0); // control gráfico: no desechar
    bytes.push(0x2c); u16(0); u16(0); u16(w); u16(h); bytes.push(0);
    bytes.push(8);
    const data = lzw(indexFrame(frame, palette));
    for (let p = 0; p < data.length; p += 255) {
      const chunk = data.slice(p, p + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (polinomio 0xEDB88320), el que exigen ZIP y PNG. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * ZIP sin compresión (método "store"): las imágenes ya están comprimidas, así que solo se
 * empaquetan. Cabecera local + datos por archivo, directorio central y registro final.
 * @param {Array<{ name: string, data: Uint8Array }>} files
 */
export function createZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
