import test from 'node:test';
import assert from 'node:assert/strict';
import { texturedImage, warp } from './helpers.js';
import {
  autoAlign, estimateStereoAlignment, rightHomography, invert3, applyH, autoCropMargins, windowParallax, floatingWindow,
} from '../assets/js/processing/align.js';
import { toGray } from '../assets/js/processing/image.js';
import { detectFeatures, describeFeatures, matchFeatures } from '../assets/js/processing/features.js';

const W = 480;
const H = 320;

test('la homografía y su inversa son consistentes', () => {
  const m = rightHomography({ dy: 4, rotation: 1.2, scale: 1.02, keyH: 0.03, keyV: -0.02, parallax: 7 }, W, H);
  const inv = invert3(m);
  for (const [x, y] of [[0, 0], [100, 50], [W, H], [W / 2, H / 2]]) {
    const [u, v] = applyH(m, x, y);
    const [x2, y2] = applyH(inv, u, v);
    assert.ok(Math.abs(x - x2) < 1e-6 && Math.abs(y - y2) < 1e-6);
  }
});

test('RANSAC recupera rotación, escala y desnivel ignorando la disparidad horizontal', () => {
  // Puntos sintéticos: la vista derecha tiene disparidad variable en x (profundidad) y una
  // corrección conocida en y; además se añade un 25 % de coincidencias erróneas.
  const truth = { rotation: -0.8, scale: 1.015, dy: 5.5 };
  const m = rightHomography({ ...truth }, W, H);
  const inv = invert3(m); // de referencia a derecha
  const L = [];
  const R = [];
  let s = 3;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 200; i++) {
    const x = 20 + rnd() * (W - 40);
    const y = 20 + rnd() * (H - 40);
    const disparity = rnd() * 30 - 10;
    L.push([x, y]);
    const [rx, ry] = applyH(inv, x + disparity, y);
    R.push(i % 4 === 0 ? [rnd() * W, rnd() * H] : [rx, ry + (rnd() - 0.5) * 0.4]);
  }
  const res = estimateStereoAlignment(L, R, { width: W, height: H });
  assert.ok(res.ok);
  assert.ok(Math.abs(res.rotation - truth.rotation) < 0.05, `rotación ${res.rotation}`);
  assert.ok(Math.abs(res.scale - truth.scale) < 0.002, `escala ${res.scale}`);
  assert.ok(Math.abs(res.dy - truth.dy) < 0.3, `dy ${res.dy}`);
  assert.ok(res.inliers >= 140 && res.inliers <= 160, `inliers ${res.inliers}`);
  assert.ok(res.rmsAfter < res.rmsBefore);
});

test('FAST + BRIEF encuentran coincidencias entre una imagen y su versión desplazada', () => {
  const left = texturedImage(W, H, 11);
  const right = warp(left, (x, y) => [x + 6, y - 3]); // contenido desplazado (-6, +3)
  const gl = toGray(left);
  const gr = toGray(right);
  const fl = detectFeatures(gl);
  const fr = detectFeatures(gr);
  assert.ok(fl.count > 100, `rasgos ${fl.count}`);
  const matches = matchFeatures(fl, describeFeatures(gl, fl), fr, describeFeatures(gr, fr));
  const good = matches.filter(([i, j]) => Math.abs(fl.x[i] - fr.x[j] - 6) < 1.5 && Math.abs(fl.y[i] - fr.y[j] + 3) < 1.5);
  assert.ok(matches.length > 50, `coincidencias ${matches.length}`);
  assert.ok(good.length / matches.length > 0.9, `precisión ${good.length}/${matches.length}`);
});

test('la alineación automática corrige un par desalineado de extremo a extremo', () => {
  const left = texturedImage(W, H, 5);
  const truth = { rotation: 1.0, scale: 1.0, dy: -6, parallax: 0 };
  const m = rightHomography(truth, W, H); // derecha → referencia
  // La vista derecha es la izquierda vista con la corrección inversa más una disparidad de 8 px.
  const right = warp(left, (x, y) => { const [u, v] = applyH(m, x, y); return [u + 8, v]; });
  const res = autoAlign(left, right);
  assert.ok(res.ok, res.reason);
  assert.ok(Math.abs(res.rotation - truth.rotation) < 0.15, `rotación ${res.rotation}`);
  assert.ok(Math.abs(res.dy - truth.dy) < 0.8, `dy ${res.dy}`);
  assert.ok(res.rmsAfter < 1, `rms después ${res.rmsAfter}`);
});

test('recorte automático elimina los bordes vacíos de la corrección', () => {
  const none = autoCropMargins({ dy: 0, rotation: 0, scale: 1 }, W, H);
  assert.deepEqual(none, { left: 0, top: 0, right: 0, bottom: 0 });
  const crop = autoCropMargins({ dy: 10, rotation: 0, scale: 1, parallax: -12 }, W, H);
  assert.equal(crop.top, 10);
  assert.equal(crop.right, 12);
  assert.equal(crop.left, 0);
  const rotated = autoCropMargins({ rotation: 2 }, W, H);
  assert.ok(rotated.left > 0 && rotated.top > 0);
});

test('montaje en ventana y ventana flotante', () => {
  const p = [-12, -3, 0, 4, 10, 25];
  assert.equal(windowParallax(p, 0), 12);
  const fw = floatingWindow([-8, 5, -6], [10, 240, 470], W, 0);
  assert.deepEqual(fw, { left: 8, right: 6 });
  assert.deepEqual(floatingWindow([-8, 5, -6], [10, 240, 470], W, 10), { left: 0, right: 0 });
});
