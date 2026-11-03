import test from 'node:test';
import assert from 'node:assert/strict';
import { solid } from './helpers.js';
import { anaglyphPixel, composeAnaglyph, ANAGLYPH_MODES, srgbToLinear, linearToSrgb } from '../assets/js/processing/anaglyph.js';

test('anaglifo a color: rojo de la izquierda, verde y azul de la derecha', () => {
  assert.deepEqual(anaglyphPixel('color', [200, 10, 20], [30, 140, 250]), [200, 140, 250]);
  assert.deepEqual(anaglyphPixel('color', [255, 255, 255], [0, 0, 0]), [255, 0, 0]);
  assert.deepEqual(anaglyphPixel('color', [0, 0, 0], [255, 255, 255]), [0, 255, 255]);
});

test('anaglifo en grises usa la luminancia de cada vista', () => {
  const [r, g, b] = anaglyphPixel('gray', [255, 0, 0], [0, 255, 0]);
  assert.equal(r, Math.round(0.299 * 255));
  assert.equal(g, Math.round(0.587 * 255));
  assert.equal(b, g);
});

test('medio color: luminancia izquierda en rojo, color derecho en verde y azul', () => {
  assert.deepEqual(anaglyphPixel('half', [0, 255, 0], [9, 80, 160]), [Math.round(0.587 * 255), 80, 160]);
});

test('Dubois rojo/cian: blanco en ambas vistas se mantiene cercano al blanco y negro a negro', () => {
  const white = anaglyphPixel('dubois', [255, 255, 255], [255, 255, 255]);
  white.forEach((c) => assert.ok(c > 200, `canal ${c}`));
  assert.deepEqual(anaglyphPixel('dubois', [0, 0, 0], [0, 0, 0]), [0, 0, 0]);
  // La vista izquierda alimenta casi solo el rojo; la derecha, verde y azul.
  const leftOnly = anaglyphPixel('dubois', [255, 255, 255], [0, 0, 0]);
  assert.ok(leftOnly[0] > 200 && leftOnly[1] === 0 && leftOnly[2] === 0, `${leftOnly}`);
});

test('ámbar/azul y verde/magenta reparten los canales hacia el filtro correcto', () => {
  const ab = anaglyphPixel('amberBlue', [0, 0, 0], [255, 255, 255]);
  assert.ok(ab[2] > 200 && ab[0] < 40, `${ab}`); // la derecha llega por el filtro azul
  const gm = anaglyphPixel('greenMagenta', [255, 255, 255], [0, 0, 0]);
  assert.ok(gm[1] > 200 && gm[0] === 0, `${gm}`); // la izquierda llega por el filtro verde
});

test('todas las matrices tienen 9 coeficientes', () => {
  for (const [id, m] of Object.entries(ANAGLYPH_MODES)) {
    assert.equal(m.left.length, 9, id);
    assert.equal(m.right.length, 9, id);
  }
});

test('conversión sRGB ↔ lineal es reversible', () => {
  for (const v of [0, 0.02, 0.2, 0.5, 0.9, 1]) assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-9);
});

test('composeAnaglyph genera una imagen del mismo tamaño', () => {
  const out = composeAnaglyph(solid(4, 3, [255, 0, 0]), solid(4, 3, [0, 0, 255]), 'color');
  assert.equal(out.width, 4);
  assert.equal(out.height, 3);
  assert.deepEqual([...out.data.slice(0, 4)], [255, 0, 255, 255]);
  assert.throws(() => composeAnaglyph(solid(4, 3, [0, 0, 0]), solid(2, 3, [0, 0, 0]), 'color'));
});
