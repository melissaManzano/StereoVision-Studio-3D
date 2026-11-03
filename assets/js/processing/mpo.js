/**
 * Lectura de archivos MPO (Multi Picture Object, CIPA DC-007), el formato de las cámaras 3D:
 * varias imágenes JPEG concatenadas. La primera lleva un segmento APP2 "MPF" con un índice
 * (etiqueta 0xB002, MP Entry) que da tamaño y desplazamiento de cada imagen. Los
 * desplazamientos son relativos al inicio de la cabecera TIFF dentro de ese segmento.
 * Si el índice falta o está dañado, se buscan los marcadores de inicio de JPEG (FF D8 FF).
 *
 * @param {ArrayBuffer} buffer
 * @returns {Array<{ offset: number, length: number }>}
 */
export function extractMpoImages(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('No es un archivo JPEG/MPO');

  const fromIndex = readMpIndex(bytes, view);
  if (fromIndex && fromIndex.length >= 2) return fromIndex;
  return scanJpegStarts(bytes);
}

function readMpIndex(bytes, view) {
  let p = 2;
  while (p + 4 < bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1];
    const size = view.getUint16(p + 2);
    if (marker === 0xda) break; // inicio de datos de imagen: ya no hay más segmentos de cabecera
    const isMpf = marker === 0xe2 && bytes[p + 4] === 0x4d && bytes[p + 5] === 0x50 && bytes[p + 6] === 0x46 && bytes[p + 7] === 0;
    if (isMpf) {
      const tiff = p + 8;
      const little = bytes[tiff] === 0x49;
      const u16 = (o) => view.getUint16(o, little);
      const u32 = (o) => view.getUint32(o, little);
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      let entriesOffset = -1;
      let images = 0;
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12;
        const tag = u16(e);
        if (tag === 0xb001) images = u32(e + 8);
        if (tag === 0xb002) entriesOffset = tiff + u32(e + 8);
      }
      if (entriesOffset < 0 || images < 2) return null;
      const list = [];
      for (let i = 0; i < images; i++) {
        const e = entriesOffset + i * 16;
        const length = u32(e + 4);
        const rel = u32(e + 8);
        const offset = i === 0 ? 0 : tiff + rel;
        if (offset + length > bytes.length) return null;
        list.push({ offset, length });
      }
      return list;
    }
    p += 2 + size;
  }
  return null;
}

function scanJpegStarts(bytes) {
  const starts = [0];
  for (let i = 4; i < bytes.length - 3; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff && bytes[i - 2] === 0xff && bytes[i - 1] === 0xd9) starts.push(i);
  }
  if (starts.length < 2) throw new Error('El MPO no contiene dos imágenes');
  return starts.map((s, i) => ({ offset: s, length: (starts[i + 1] ?? bytes.length) - s }));
}
