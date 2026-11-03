import { autoCropMargins, windowParallax, floatingWindow } from '../../processing/align.js';
import { orientedSize } from './recipe.js';

/**
 * Operaciones automáticas del editor, compartidas por la vista interactiva y el lote.
 * Preparan datos reducidos en el hilo principal (dibujar en un canvas pequeño es inmediato)
 * y delegan el cálculo pesado al Web Worker.
 */

/** Píxeles de una vista con el giro de 90° aplicado, reducida a `maxDim` en su lado mayor. */
export function orientedImageData(bitmap, orientation, maxDim) {
  const { width: ow, height: oh } = orientedSize(bitmap.width, bitmap.height, orientation);
  const k = Math.min(1, maxDim / Math.max(ow, oh));
  const w = Math.max(1, Math.round(ow * k));
  const h = Math.max(1, Math.round(oh * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.translate(w / 2, h / 2);
  ctx.rotate((orientation * Math.PI) / 180);
  const dw = orientation % 180 ? h : w;
  const dh = orientation % 180 ? w : h;
  ctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
  return { image: ctx.getImageData(0, 0, w, h), scaleToFull: ow / w };
}

/** Rasgos + emparejado + RANSAC en el worker. Devuelve el informe de alineación. */
export async function analyzePair(worker, media, recipe) {
  const [first, second] = recipe.swap ? [media.right, media.left] : [media.left, media.right];
  const L = orientedImageData(first, recipe.orientation, 1000);
  const R = orientedImageData(second, recipe.orientation, 1000);
  const payload = {
    left: { data: L.image.data, width: L.image.width, height: L.image.height },
    right: { data: R.image.data, width: R.image.width, height: R.image.height },
    scaleToFull: L.scaleToFull,
  };
  const t0 = performance.now();
  const res = await worker.run('align', payload, [payload.left.data.buffer, payload.right.data.buffer]);
  res.ms = Math.round(performance.now() - t0);
  return res;
}

/** Aplica el resultado de la alineación a la receta (conserva el paralaje elegido). */
export function applyAlignment(recipe, res) {
  recipe.align = { ...recipe.align, dy: res.dy, rotation: res.rotation, scale: res.scale, keyH: 0, keyV: 0 };
  return recipe;
}

export function applyAutoCrop(recipe, media) {
  const { width, height } = orientedSize(media.width, media.height, recipe.orientation);
  const margins = autoCropMargins(recipe.align, width, height, recipe.pairRotation);
  if (margins) recipe.crop = margins;
  return Boolean(margins);
}

export function applyWindow(recipe, analysis) {
  recipe.align = { ...recipe.align, parallax: Math.round(windowParallax(analysis.parallax) * 10) / 10 };
  return recipe.align.parallax;
}

export function applyFloatingWindow(recipe, analysis, media) {
  const { width } = orientedSize(media.width, media.height, recipe.orientation);
  recipe.window = floatingWindow(analysis.parallax, analysis.xs, width, recipe.align.parallax);
  return recipe.window;
}

/**
 * LUT de igualación de color calculada sobre las vistas ya alineadas y recortadas
 * (sin ajustes de color), para comparar exactamente la zona que se verá.
 */
export async function computeColorLUT(worker, pipeline, recipe) {
  const neutral = structuredClone(recipe);
  neutral.color = { lut: null, brightness: 0, contrast: 0, gamma: 1, saturation: 0, sharpness: 0 };
  neutral.window = { left: 0, right: 0 };
  const [left, right] = pipeline.readEyes(neutral, 512);
  return worker.run('colorLUT', { source: right, reference: left }, [right.data.buffer, left.data.buffer]);
}
