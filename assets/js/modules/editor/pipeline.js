import * as THREE from 'three';
import { ANAGLYPH_MODES } from '../../processing/anaglyph.js';
import { rightHomography, rotationAbout, invert3, multiply3 } from '../../processing/align.js';
import { orientedSize, outputLayout, defaultRecipe } from './recipe.js';
import { LENS_GLSL, lensCoefficients } from '../lens.js';

/**
 * Pipeline de GPU del editor estéreo. Dos pasadas por render:
 *  1. Pasada por ojo: para cada píxel de salida calcula, con matrices inversas, de qué punto
 *     de la imagen original procede (recorte → rotación del par → homografía de la vista
 *     derecha → giro de 90° → UV). Después aplica nitidez (máscara de enfoque), la LUT de
 *     igualación de color (solo vista derecha), brillo, contraste, gamma, saturación y la
 *     ventana flotante.
 *  2. Composición: combina ambos ojos en el modo de salida (anaglifos por matrices,
 *     lado a lado, arriba/abajo, entrelazado o vistas de ayuda para alinear).
 * Todo opera sobre valores sRGB sin conversión automática (NoColorSpace); los anaglifos
 * Dubois linealizan y vuelven a codificar dentro del shader.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const EYE_FRAGMENT = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 srcSize;
  uniform int orient;
  uniform vec2 cropOrigin;
  uniform vec2 cropSize;
  uniform mat3 frameToSource;
  uniform sampler2D lut;
  uniform float useLut;
  uniform float brightness;
  uniform float contrast;
  uniform float gamma;
  uniform float saturation;
  uniform float sharpness;
  uniform float winLeft;
  uniform float winRight;
  uniform float isRight;
  varying vec2 vUv;

  vec2 orientedToUv(vec2 o) {
    vec2 s;
    if (orient == 0) s = o;
    else if (orient == 1) s = vec2(o.y, srcSize.y - o.x);
    else if (orient == 2) s = srcSize - o;
    else s = vec2(srcSize.x - o.y, o.x);
    return s / srcSize;
  }

  void main() {
    vec2 local = vec2(vUv.x, 1.0 - vUv.y) * cropSize;
    if ((isRight < 0.5 && local.x < winLeft) || (isRight > 0.5 && cropSize.x - local.x < winRight)) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 h = frameToSource * vec3(cropOrigin + local, 1.0);
    vec2 uv = orientedToUv(h.xy / h.z);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 c = texture2D(src, uv).rgb;
    if (sharpness > 0.0) {
      vec2 t = 1.0 / srcSize;
      vec3 blur = 0.25 * (texture2D(src, uv + vec2(t.x, 0.0)).rgb + texture2D(src, uv - vec2(t.x, 0.0)).rgb
                        + texture2D(src, uv + vec2(0.0, t.y)).rgb + texture2D(src, uv - vec2(0.0, t.y)).rgb);
      c = clamp(c + sharpness * (c - blur), 0.0, 1.0);
    }
    if (useLut > 0.5) {
      vec3 i = (floor(c * 255.0 + 0.5) + 0.5) / 256.0;
      c = vec3(texture2D(lut, vec2(i.r, 0.5)).r, texture2D(lut, vec2(i.g, 0.5)).g, texture2D(lut, vec2(i.b, 0.5)).b);
    }
    c = (c - 0.5) * (1.0 + contrast) + 0.5 + brightness;
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / gamma));
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(y), c, 1.0 + saturation);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

const COMPOSE_FRAGMENT = /* glsl */ `
  ${LENS_GLSL}
  uniform sampler2D L;
  uniform sampler2D R;
  uniform int mode;
  uniform mat3 ML;
  uniform mat3 MR;
  uniform float linearize;
  uniform vec2 outSize;
  varying vec2 vUv;

  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

  void main() {
    vec2 uv = vUv;
    vec3 c;
    if (mode == 0) {
      vec3 l = texture2D(L, uv).rgb;
      vec3 r = texture2D(R, uv).rgb;
      if (linearize > 0.5) { l = toLinear(l); r = toLinear(r); }
      c = ML * l + MR * r;
      c = linearize > 0.5 ? toSrgb(c) : clamp(c, 0.0, 1.0);
    } else if (mode == 1 || mode == 2) {
      bool first = uv.x < 0.5;
      vec2 e = vec2(first ? uv.x * 2.0 : uv.x * 2.0 - 1.0, uv.y);
      bool showLeft = (mode == 1) == first;
      c = showLeft ? texture2D(L, e).rgb : texture2D(R, e).rgb;
    } else if (mode == 3) {
      c = uv.y >= 0.5 ? texture2D(L, vec2(uv.x, uv.y * 2.0 - 1.0)).rgb : texture2D(R, vec2(uv.x, uv.y * 2.0)).rgb;
    } else if (mode == 4) {
      float row = floor((1.0 - uv.y) * outSize.y);
      c = mod(row, 2.0) < 1.0 ? texture2D(L, uv).rgb : texture2D(R, uv).rgb;
    } else if (mode == 5) {
      float col = floor(uv.x * outSize.x);
      c = mod(col, 2.0) < 1.0 ? texture2D(L, uv).rgb : texture2D(R, uv).rgb;
    } else if (mode == 10) {
      // Cardboard: lado a lado con predistorsión de barril en cada mitad.
      bool first = uv.x < 0.5;
      vec2 e = vec2(first ? uv.x * 2.0 : uv.x * 2.0 - 1.0, uv.y);
      float a = (outSize.x * 0.5) / outSize.y;
      c = first ? lensSample(L, e, a) : lensSample(R, e, a);
    } else if (mode == 6) {
      c = texture2D(L, uv).rgb;
    } else if (mode == 7) {
      c = texture2D(R, uv).rgb;
    } else if (mode == 8) {
      c = mix(texture2D(L, uv).rgb, texture2D(R, uv).rgb, 0.5);
    } else {
      vec3 d = abs(texture2D(L, uv).rgb - texture2D(R, uv).rgb);
      c = vec3(clamp(dot(d, vec3(0.333)) * 3.0, 0.0, 1.0));
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

const MODE_CODES = { sbs: 1, cross: 2, tb: 3, rows: 4, cols: 5, left: 6, right: 7, overlay: 8, difference: 9, cardboard: 10 };
const matrix = (arr) => new THREE.Matrix3().set(...arr);

export function createPipeline(renderer) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);

  const lutTexture = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1, THREE.RGBAFormat);
  lutTexture.minFilter = THREE.NearestFilter;
  lutTexture.magFilter = THREE.NearestFilter;
  let lutKey = null;

  const eyeMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: EYE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      src: { value: null }, srcSize: { value: new THREE.Vector2() }, orient: { value: 0 },
      cropOrigin: { value: new THREE.Vector2() }, cropSize: { value: new THREE.Vector2() },
      frameToSource: { value: new THREE.Matrix3() }, lut: { value: lutTexture }, useLut: { value: 0 },
      brightness: { value: 0 }, contrast: { value: 0 }, gamma: { value: 1 }, saturation: { value: 0 }, sharpness: { value: 0 },
      winLeft: { value: 0 }, winRight: { value: 0 }, isRight: { value: 0 },
    },
  });
  const composeMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: COMPOSE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      L: { value: null }, R: { value: null }, mode: { value: 0 },
      ML: { value: new THREE.Matrix3() }, MR: { value: new THREE.Matrix3() }, linearize: { value: 0 },
      outSize: { value: new THREE.Vector2() },
      lensK: { value: new THREE.Vector2() }, lensChroma: { value: 1 },
    },
  });

  const targets = new Map();
  let sources = null;

  function target(name, w, h) {
    let rt = targets.get(name);
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      targets.set(name, rt);
    } else if (rt.width !== w || rt.height !== h) {
      rt.setSize(w, h);
    }
    return rt;
  }

  function makeTexture(bitmap) {
    const t = new THREE.Texture(bitmap);
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  function setLut(lut) {
    const key = lut ? lut : null;
    if (key === lutKey) return;
    lutKey = key;
    if (!lut) return;
    const d = lutTexture.image.data;
    for (let i = 0; i < 256; i++) {
      d[i * 4] = lut[i];
      d[i * 4 + 1] = lut[256 + i];
      d[i * 4 + 2] = lut[512 + i];
      d[i * 4 + 3] = 255;
    }
    lutTexture.needsUpdate = true;
  }

  /** Geometría del marco de salida para la receta actual. */
  function frame(recipe) {
    const { width: W, height: H } = orientedSize(sources.width, sources.height, recipe.orientation);
    const c = recipe.crop;
    const crop = { x: c.left, y: c.top, w: Math.max(16, W - c.left - c.right), h: Math.max(16, H - c.top - c.bottom) };
    const toFrame = rotationAbout(recipe.pairRotation, W / 2, H / 2);
    const toLeft = invert3(toFrame);
    const toRight = multiply3(invert3(rightHomography(recipe.align, W, H)), toLeft);
    return { W, H, crop, toLeft, toRight };
  }

  function renderEye(recipe, f, side, rt) {
    const u = eyeMaterial.uniforms;
    const right = side === 'right';
    const tex = right !== recipe.swap ? sources.right : sources.left;
    u.src.value = tex;
    u.srcSize.value.set(sources.width, sources.height);
    u.orient.value = recipe.orientation / 90;
    u.cropOrigin.value.set(f.crop.x, f.crop.y);
    u.cropSize.value.set(f.crop.w, f.crop.h);
    u.frameToSource.value.set(...(right ? f.toRight : f.toLeft));
    setLut(recipe.color.lut);
    u.useLut.value = right && recipe.color.lut ? 1 : 0;
    u.brightness.value = recipe.color.brightness / 100;
    u.contrast.value = recipe.color.contrast / 100;
    u.gamma.value = recipe.color.gamma;
    u.saturation.value = recipe.color.saturation / 100;
    u.sharpness.value = recipe.color.sharpness / 100;
    u.winLeft.value = recipe.window.left;
    u.winRight.value = recipe.window.right;
    u.isRight.value = right ? 1 : 0;
    quad.material = eyeMaterial;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  }

  function compose(modeId, rtL, rtR, rt, outW, outH, lens = defaultRecipe().lens) {
    const u = composeMaterial.uniforms;
    u.lensK.value.set(...lensCoefficients(lens.strength));
    u.lensChroma.value = lens.chroma ? 1 : 0;
    u.L.value = rtL.texture;
    u.R.value = rtR.texture;
    u.outSize.value.set(outW, outH);
    const ana = ANAGLYPH_MODES[modeId];
    if (ana) {
      u.mode.value = 0;
      u.ML.value = matrix(ana.left);
      u.MR.value = matrix(ana.right);
      u.linearize.value = ana.linear ? 1 : 0;
    } else {
      u.mode.value = MODE_CODES[modeId] ?? 6;
    }
    quad.material = composeMaterial;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
  }

  function outputSize(modeId, eyeW, eyeH) {
    const layout = outputLayout(modeId);
    return { width: layout === 'sbs' ? eyeW * 2 : eyeW, height: layout === 'tb' ? eyeH * 2 : eyeH };
  }

  function eyeSizeFor(f, maxW, maxH) {
    const k = Math.min(1, maxW / f.crop.w, maxH / f.crop.h);
    return { w: Math.max(2, Math.round(f.crop.w * k)), h: Math.max(2, Math.round(f.crop.h * k)) };
  }

  function readTarget(rt, w, h) {
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row); // WebGL lee de abajo arriba
    return { data: out, width: w, height: h };
  }

  return {
    setSources(left, right) {
      sources?.left.dispose();
      sources?.right.dispose();
      sources = { left: makeTexture(left), right: makeTexture(right), width: left.width, height: left.height };
    },
    frame,
    maxSize: () => renderer.capabilities.maxTextureSize,

    /** Vista previa: renderiza ambos ojos y la composición del modo pedido a tamaño reducido. */
    preview(recipe, modeId, maxEye = 1600) {
      const f = frame(recipe);
      const { w, h } = eyeSizeFor(f, maxEye, maxEye);
      const rtL = target('previewL', w, h);
      const rtR = target('previewR', w, h);
      renderEye(recipe, f, 'left', rtL);
      renderEye(recipe, f, 'right', rtR);
      const out = outputSize(modeId, w, h);
      const rt = target('previewOut', out.width, out.height);
      compose(modeId, rtL, rtR, rt, out.width, out.height, recipe.lens);
      renderer.setRenderTarget(null);
      return { texture: rt.texture, width: out.width, height: out.height, eyes: [rtL.texture, rtR.texture], eyeWidth: w, eyeHeight: h, frame: f };
    },

    /** Salida a resolución completa (× tamaño de exportación), leída a la CPU para codificar. */
    readOutput(recipe, modeId = recipe.output) {
      const f = frame(recipe);
      const max = renderer.capabilities.maxTextureSize;
      const layout = outputLayout(modeId);
      const k = recipe.resize / 100;
      const { w, h } = eyeSizeFor(f, Math.floor(f.crop.w * k), Math.floor(f.crop.h * k));
      const lim = Math.min(1, (layout === 'sbs' ? max / 2 : max) / w, (layout === 'tb' ? max / 2 : max) / h);
      const ew = Math.floor(w * lim);
      const eh = Math.floor(h * lim);
      const rtL = target('exportL', ew, eh);
      const rtR = target('exportR', ew, eh);
      renderEye(recipe, f, 'left', rtL);
      renderEye(recipe, f, 'right', rtR);
      const out = outputSize(modeId, ew, eh);
      const rt = target('exportOut', out.width, out.height);
      compose(modeId, rtL, rtR, rt, out.width, out.height, recipe.lens);
      const image = readTarget(rt, out.width, out.height);
      renderer.setRenderTarget(null);
      // Las texturas de exportación pueden ser enormes: se liberan enseguida.
      ['exportL', 'exportR', 'exportOut'].forEach((n) => { targets.get(n)?.dispose(); targets.delete(n); });
      return image;
    },

    /** Ambas vistas procesadas, reducidas a `maxWidth` (wiggle GIF e igualación de color). */
    readEyes(recipe, maxWidth) {
      const f = frame(recipe);
      const { w, h } = eyeSizeFor(f, maxWidth, maxWidth);
      const rtL = target('eyesL', w, h);
      const rtR = target('eyesR', w, h);
      renderEye(recipe, f, 'left', rtL);
      renderEye(recipe, f, 'right', rtR);
      const eyes = [readTarget(rtL, w, h), readTarget(rtR, w, h)];
      renderer.setRenderTarget(null);
      return eyes;
    },

    dispose() {
      sources?.left.dispose();
      sources?.right.dispose();
      sources = null;
      targets.forEach((rt) => rt.dispose());
      targets.clear();
      eyeMaterial.dispose();
      composeMaterial.dispose();
      quad.geometry.dispose();
      lutTexture.dispose();
    },
  };
}
