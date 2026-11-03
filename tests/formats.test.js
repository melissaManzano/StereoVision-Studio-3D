import test from 'node:test';
import assert from 'node:assert/strict';
import { solid, texturedImage } from './helpers.js';
import { encodeTIFF, encodeGIF, createZip, crc32 } from '../assets/js/processing/encoders.js';
import { matchHistogramsLUT, applyLUT, histograms } from '../assets/js/processing/color.js';
import { detectStereoLayout, splitRects } from '../assets/js/processing/split.js';
import { pairFiles } from '../assets/js/processing/pairing.js';
import { extractMpoImages } from '../assets/js/processing/mpo.js';

test('TIFF: cabecera, dimensiones y píxeles RGB', () => {
  const tif = encodeTIFF(solid(3, 2, [10, 20, 30]));
  assert.deepEqual([...tif.slice(0, 4)], [0x49, 0x49, 0x2a, 0]);
  const v = new DataView(tif.buffer);
  assert.equal(v.getUint16(8 + 2 + 8, true), 3); // ImageWidth (valor corto en little-endian)
  assert.deepEqual([...tif.slice(tif.length - 3)], [10, 20, 30]);
  assert.equal(v.getUint32(8 + 2 + 8 * 12 + 8, true), 3 * 2 * 3); // StripByteCounts = ancho × alto × 3
});

test('GIF: firma, dimensiones, bucle y dos fotogramas', () => {
  const gif = encodeGIF([texturedImage(40, 30, 2), texturedImage(40, 30, 3)], { delay: 120 });
  assert.equal(String.fromCharCode(...gif.slice(0, 6)), 'GIF89a');
  assert.equal(gif[6] | (gif[7] << 8), 40);
  assert.equal(gif[8] | (gif[9] << 8), 30);
  assert.equal(gif[gif.length - 1], 0x3b);
  const text = String.fromCharCode(...gif);
  assert.ok(text.includes('NETSCAPE2.0'));
  assert.equal(text.split('\x2c\x00\x00\x00\x00').length - 1, 2);
});

test('CRC-32 y ZIP', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = createZip([{ name: 'a.txt', data: new TextEncoder().encode('hola') }, { name: 'ñ.png', data: new Uint8Array([1, 2, 3]) }]);
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(v.getUint16(zip.length - 22 + 10, true), 2);
});

test('igualación de histogramas lleva la vista derecha al tono de la izquierda', () => {
  const left = texturedImage(64, 48, 9);
  const darker = applyLUT(left, Uint8Array.from({ length: 768 }, (_, i) => Math.round((i % 256) * 0.7)));
  const lut = matchHistogramsLUT(darker, left);
  const fixed = applyLUT(darker, lut);
  const mean = (img) => histograms(img)[0].reduce((s, n, v) => s + n * v, 0) / (img.width * img.height);
  assert.ok(Math.abs(mean(fixed) - mean(left)) < 2, `${mean(fixed)} vs ${mean(left)}`);
});

test('detección de disposición: lado a lado frente a arriba/abajo', () => {
  const view = texturedImage(80, 60, 4);
  const sbs = { width: 160, height: 60, data: new Uint8ClampedArray(160 * 60 * 4) };
  const tb = { width: 80, height: 120, data: new Uint8ClampedArray(80 * 120 * 4) };
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 80; x++) {
      const px = view.data.slice((y * 80 + x) * 4, (y * 80 + x) * 4 + 4);
      sbs.data.set(px, (y * 160 + x) * 4);
      sbs.data.set(px, (y * 160 + x + 80) * 4);
      tb.data.set(px, (y * 80 + x) * 4);
      tb.data.set(px, ((y + 60) * 80 + x) * 4);
    }
  }
  assert.equal(detectStereoLayout(sbs).layout, 'sbs');
  assert.equal(detectStereoLayout(tb).layout, 'tb');
  assert.deepEqual(splitRects('cross', 200, 50), { left: [100, 0, 100, 50], right: [0, 0, 100, 50] });
});

test('emparejado por nombre', () => {
  const names = ['playa_L.jpg', 'playa_R.jpg', 'IMG_0101.JPG', 'IMG_0102.JPG', 'castillo.mpo', 'suelto.png', 'arbol-izq.png', 'arbol-der.png'];
  const { pairs, unpaired } = pairFiles(names);
  const byName = Object.fromEntries(pairs.map((p) => [p.name, p]));
  assert.deepEqual([byName.playa.left, byName.playa.right], [0, 1]);
  assert.deepEqual([byName.arbol.left, byName.arbol.right], [6, 7]);
  assert.equal(byName.castillo.single, 4);
  assert.ok(pairs.some((p) => p.left === 2 && p.right === 3));
  assert.deepEqual(unpaired, [5]);
});

test('MPO: extrae dos JPEG concatenados aunque falte el índice MPF', () => {
  const jpeg = (n) => [0xff, 0xd8, 0xff, 0xe0, 0, 4, n, n, 0xff, 0xd9];
  const buf = Uint8Array.from([...jpeg(1), ...jpeg(2)]).buffer;
  assert.deepEqual(extractMpoImages(buf), [{ offset: 0, length: 10 }, { offset: 10, length: 10 }]);
});
