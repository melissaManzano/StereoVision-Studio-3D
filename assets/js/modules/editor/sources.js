import { ImportError } from '../importer.js';
import { splitRects } from '../../processing/split.js';

/**
 * Carga de pares para el editor estéreo. Produce un objeto "media" con dos ImageBitmap
 * (vista izquierda y derecha) del mismo tamaño y su función release().
 *  - Par izquierdo/derecho: dos archivos independientes.
 *  - Imagen única: lado a lado (paralelo o cruzado) o arriba/abajo, detectado o elegido.
 *  - MPO: las dos primeras imágenes JPEG del contenedor.
 */

const IMAGE = /\.(jpe?g|png|webp)$/i;
const MPO = /\.mpo$/i;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const EDITOR_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
export const SINGLE_ACCEPT = `${EDITOR_ACCEPT},.mpo`;

export const isMpo = (file) => MPO.test(file.name) || file.type === 'image/mpo';
const isImage = (file) => IMAGE_TYPES.includes(file.type) || IMAGE.test(file.name);

function check(file, allowMpo = false) {
  if (isImage(file) || (allowMpo && isMpo(file))) return;
  throw new ImportError(
    `Formato no admitido: ${file.name}`,
    `El editor acepta JPG, PNG o WebP${allowMpo ? ' y MPO' : ''}. Elige otro archivo.`,
  );
}

async function decode(blob, name) {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new ImportError(`No se pudo decodificar ${name}`, 'El archivo está dañado o no es una imagen válida. Prueba con otro.');
  }
}

/** Reduce una vista si supera el tamaño máximo de textura de la GPU. */
async function fitToGpu(bitmap, maxSize, notes) {
  const k = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  if (k === 1) return bitmap;
  const out = await createImageBitmap(bitmap, { resizeWidth: Math.floor(bitmap.width * k), resizeHeight: Math.floor(bitmap.height * k), resizeQuality: 'high' });
  notes.push(`Se redujo a ${out.width} × ${out.height} px por el límite de la GPU (${maxSize} px).`);
  bitmap.close();
  return out;
}

const stem = (n) => n.replace(/\.[^.]+$/, '');
const sideless = (n) => stem(n).replace(/[\s._-]*(l|left|izq|izquierda)$/i, '') || stem(n);

function pairMedia({ left, right, name, exportName, type, size, notes, layout }) {
  return {
    kind: 'pair',
    name,
    exportName: exportName ?? stem(name),
    type,
    size,
    width: left.width,
    height: left.height,
    left,
    right,
    layout,
    notes,
    release() {
      left.close();
      right.close();
    },
  };
}

export async function loadPair(fileLeft, fileRight, { maxSize }) {
  check(fileLeft);
  check(fileRight);
  const notes = [];
  let left = await fitToGpu(await decode(fileLeft, fileLeft.name), maxSize, notes);
  let right = await decode(fileRight, fileRight.name);
  if (right.width !== left.width || right.height !== left.height) {
    const resized = await createImageBitmap(right, { resizeWidth: left.width, resizeHeight: left.height, resizeQuality: 'high' });
    notes.push(`La vista derecha (${right.width} × ${right.height}) se ajustó al tamaño de la izquierda.`);
    right.close();
    right = resized;
  }
  return pairMedia({
    left,
    right,
    name: `${fileLeft.name} + ${fileRight.name}`,
    exportName: sideless(fileLeft.name),
    type: 'Par izquierdo/derecho',
    size: fileLeft.size + fileRight.size,
    notes,
    layout: 'par',
  });
}

async function loadMpo(file, worker, maxSize) {
  const buffer = await file.arrayBuffer();
  let parts;
  try {
    parts = await worker.run('mpo', { buffer: buffer.slice(0) });
  } catch (err) {
    throw new ImportError(`No se pudo leer el MPO ${file.name}`, `${err.message}. Prueba a exportarlo como JPEG lado a lado.`);
  }
  const notes = [];
  const [a, b] = parts;
  const left = await fitToGpu(await decode(new Blob([buffer.slice(a.offset, a.offset + a.length)], { type: 'image/jpeg' }), file.name), maxSize, notes);
  let right = await decode(new Blob([buffer.slice(b.offset, b.offset + b.length)], { type: 'image/jpeg' }), file.name);
  if (right.width !== left.width || right.height !== left.height) {
    const resized = await createImageBitmap(right, { resizeWidth: left.width, resizeHeight: left.height });
    right.close();
    right = resized;
  }
  return pairMedia({ left, right, name: file.name, type: 'MPO (cámara 3D)', size: file.size, notes, layout: 'mpo' });
}

const LAYOUT_LABEL = { sbs: 'lado a lado paralelo', cross: 'lado a lado cruzado', tb: 'arriba/abajo' };

/**
 * @param {'auto'|'sbs'|'cross'|'tb'} layout
 */
export async function loadSingle(file, layout, { worker, maxSize }) {
  check(file, true);
  if (isMpo(file)) return loadMpo(file, worker, maxSize);
  const whole = await decode(file, file.name);
  const notes = [];
  let chosen = layout;
  try {
    if (layout === 'auto') {
      const small = document.createElement('canvas');
      small.width = 256;
      small.height = Math.max(2, Math.round((256 * whole.height) / whole.width));
      const ctx = small.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(whole, 0, 0, small.width, small.height);
      const img = ctx.getImageData(0, 0, small.width, small.height);
      const res = await worker.run('detectLayout', { image: { data: img.data, width: img.width, height: img.height } }, [img.data.buffer]);
      chosen = res.layout;
      notes.push(`Disposición detectada: ${LAYOUT_LABEL[chosen]} (correlación ${res[chosen].toFixed(2)}). Si la profundidad se ve invertida, usa Intercambiar.`);
    }
    const rects = splitRects(chosen, whole.width, whole.height);
    let left = await createImageBitmap(whole, ...rects.left);
    let right = await createImageBitmap(whole, ...rects.right);
    left = await fitToGpu(left, maxSize, notes);
    if (right.width !== left.width) {
      const r2 = await createImageBitmap(right, { resizeWidth: left.width, resizeHeight: left.height });
      right.close();
      right = r2;
    }
    return pairMedia({ left, right, name: file.name, type: `Imagen única, ${LAYOUT_LABEL[chosen]}`, size: file.size, notes, layout: chosen });
  } finally {
    whole.close();
  }
}
