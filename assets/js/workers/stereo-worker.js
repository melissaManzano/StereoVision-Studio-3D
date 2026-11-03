/**
 * Web Worker de procesamiento: ejecuta fuera del hilo de la interfaz las operaciones
 * costosas (rasgos + RANSAC, histogramas, detección de disposición, MPO y codificación),
 * para que el Studio siga respondiendo mientras tanto.
 * Protocolo: { id, type, payload } → { id, result } o { id, error }.
 */
import { autoAlign } from '../processing/align.js';
import { matchHistogramsLUT } from '../processing/color.js';
import { detectStereoLayout } from '../processing/split.js';
import { extractMpoImages } from '../processing/mpo.js';
import { encodeTIFF, encodeGIF, createZip } from '../processing/encoders.js';

async function encodeWithCanvas(image, mime, quality) {
  if (typeof OffscreenCanvas === 'undefined') throw new Error('no-offscreen');
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: mime, quality });
  return new Uint8Array(await blob.arrayBuffer());
}

const handlers = {
  align: ({ left, right, scaleToFull }) => autoAlign(left, right, { scaleToFull }),
  colorLUT: ({ source, reference }) => matchHistogramsLUT(source, reference),
  detectLayout: ({ image }) => detectStereoLayout(image),
  mpo: ({ buffer }) => extractMpoImages(buffer),
  encode: ({ image, format, quality }) => {
    if (format === 'tiff') return encodeTIFF(image);
    return encodeWithCanvas(image, format === 'jpeg' ? 'image/jpeg' : 'image/png', quality);
  },
  gif: ({ frames, delay }) => encodeGIF(frames, { delay }),
  zip: ({ files }) => createZip(files),
};

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;
  try {
    const result = await handlers[type](payload);
    const transfer = result instanceof Uint8Array ? [result.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
};
