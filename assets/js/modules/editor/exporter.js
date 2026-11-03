/**
 * Exportación del editor: imagen final (PNG, TIFF o JPEG), wiggle GIF y lotes en ZIP.
 * La GPU genera los píxeles; la codificación ocurre en el Web Worker.
 */

export const FORMATS = Object.freeze({
  png: { label: 'PNG (sin pérdida)', ext: 'png', mime: 'image/png' },
  tiff: { label: 'TIFF (sin pérdida)', ext: 'tif', mime: 'image/tiff' },
  jpeg: { label: 'JPEG (con pérdida)', ext: 'jpg', mime: 'image/jpeg' },
});

const workerCanEncode = typeof OffscreenCanvas !== 'undefined' && 'convertToBlob' in OffscreenCanvas.prototype;

/** Codifica una imagen RGBA en el worker; si el navegador no tiene OffscreenCanvas, PNG/JPEG se hacen aquí. */
export async function encodeImage(worker, image, format) {
  if (format === 'tiff' || workerCanEncode) {
    return worker.run('encode', { image, format, quality: 0.95 }, [image.data.buffer]);
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, FORMATS[format].mime, 0.95));
  return new Uint8Array(await blob.arrayBuffer());
}

export function download(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const baseName = (name) => name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'par';

export async function exportImage({ worker, pipeline, recipe, format, name }) {
  const image = pipeline.readOutput(recipe);
  const bytes = await encodeImage(worker, image, format);
  const file = `${baseName(name)}_${recipe.output}.${FORMATS[format].ext}`;
  download(bytes, file, FORMATS[format].mime);
  return { file, width: image.width, height: image.height, bytes: bytes.length };
}

export async function exportWiggle({ worker, pipeline, recipe, delay, name, maxWidth = 800 }) {
  const frames = pipeline.readEyes(recipe, maxWidth);
  const bytes = await worker.run('gif', { frames, delay }, frames.map((f) => f.data.buffer));
  const file = `${baseName(name)}_wiggle.gif`;
  download(bytes, file, 'image/gif');
  return { file, width: frames[0].width, height: frames[0].height, bytes: bytes.length };
}
