import * as THREE from 'three';
import { LENS_GLSL, lensCoefficients } from './lens.js';

/**
 * Un único WebGLRenderer para todo el Studio.
 *  - modo "single": una vista a pantalla completa (anaglifo).
 *  - modo "split": dos viewports, mitad izquierda = ojo izquierdo, mitad derecha = ojo derecho (SBS y VR).
 * Dibuja bajo demanda; solo mantiene un ciclo continuo mientras un video se reproduce.
 * Con la corrección de lente activa, cada ojo se dibuja primero en una textura y después
 * se copia a su región con predistorsión de barril (lens.js).
 * Todo el contenido de las escenas se dibuja en valores sRGB sin conversión, para que el
 * resultado sea idéntico con o sin esa pasada intermedia.
 */
export function createStage(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05091a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scenes = { left: new THREE.Scene(), right: new THREE.Scene() };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;

  let mode = 'none';
  let width = 0;
  let height = 0;
  let scheduled = false;
  let animating = false;
  const resizeListeners = new Set();
  const renderListeners = new Set();
  const beforeListeners = new Set();

  // Pasada de lente: un cuadro a pantalla completa que muestrea el ojo ya renderizado.
  let lens = null;
  const lensTargets = [];
  const lensCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lensScene = new THREE.Scene();
  const lensMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, aspect: { value: 1 }, lensK: { value: new THREE.Vector2() }, lensChroma: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${LENS_GLSL}
      uniform sampler2D map;
      uniform float aspect;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(lensSample(map, vUv, aspect), 1.0); }`,
    depthTest: false,
    depthWrite: false,
  });
  const lensQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMaterial);
  lensQuad.frustumCulled = false;
  lensScene.add(lensQuad);

  function lensTarget(i, w, h) {
    let rt = lensTargets[i];
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      lensTargets[i] = rt;
    } else if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    return rt;
  }

  function disposeLensTargets() {
    lensTargets.forEach((rt) => rt?.dispose());
    lensTargets.length = 0;
    lensQuad.geometry.dispose(); // se vuelve a subir sola si la lente se activa otra vez
  }

  /** Tamaño en px CSS de la región de un ojo (o de la vista completa en modo single). */
  function eyeSize() {
    return { width: mode === 'split' ? width / 2 : width, height };
  }

  function frameCamera(aspect) {
    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
  }

  function drawRegion(scene, x, w) {
    frameCamera(w / height);
    renderer.setViewport(x, 0, w, height);
    renderer.setScissor(x, 0, w, height);
    renderer.render(scene, camera);
  }

  /** Ojo con lente: escena → textura del tamaño de la región → región con predistorsión. */
  function drawLensRegion(scene, x, w, i) {
    const dpr = renderer.getPixelRatio();
    const rt = lensTarget(i, Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(height * dpr)));
    frameCamera(w / height);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1); // fondo negro como el exterior de la lente
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setClearColor(0x05091a, 1);
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.setViewport(x, 0, w, height);
    renderer.setScissor(x, 0, w, height);
    lensMaterial.uniforms.map.value = rt.texture;
    lensMaterial.uniforms.aspect.value = w / height;
    renderer.render(lensScene, lensCamera);
  }

  function render() {
    if (!width || !height) return;
    // Pasadas previas (p. ej. el pipeline del editor dibuja en texturas antes de la pantalla).
    beforeListeners.forEach((fn) => fn());
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    if (mode === 'split') {
      const leftWidth = Math.floor(width / 2);
      if (lens) {
        drawLensRegion(scenes.left, 0, leftWidth, 0);
        drawLensRegion(scenes.right, leftWidth, width - leftWidth, 1);
      } else {
        drawRegion(scenes.left, 0, leftWidth);
        drawRegion(scenes.right, leftWidth, width - leftWidth);
      }
    } else if (mode === 'single') {
      drawRegion(scenes.left, 0, width);
    }
    renderer.setScissorTest(false);
    renderListeners.forEach((fn) => fn());
  }

  function requestRender() {
    if (scheduled || animating) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }

  function resize() {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      renderer.setSize(width, height, false);
      resizeListeners.forEach((fn) => fn());
    }
    requestRender();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);
  window.addEventListener('orientationchange', resize);
  resize();

  return {
    host,
    renderer,
    scenes,
    eyeSize,
    requestRender,
    resize,
    setMode(next) {
      mode = next;
      if (next !== 'split') disposeLensTargets();
      host.dataset.render = next;
      resizeListeners.forEach((fn) => fn());
      requestRender();
    },
    /** Ciclo continuo (video en reproducción) o dibujo bajo demanda (imágenes, video en pausa). */
    setAnimating(on) {
      if (on === animating) return;
      animating = on;
      renderer.setAnimationLoop(on ? render : null);
      if (!on) requestRender();
    },
    onResize(fn) { resizeListeners.add(fn); return () => resizeListeners.delete(fn); },
    /** Corrección de lente Cardboard en la vista dividida: { strength (%), chroma } o null. */
    setLens(config) {
      lens = config && config.strength > 0 ? config : null;
      if (lens) {
        lensMaterial.uniforms.lensK.value.set(...lensCoefficients(lens.strength));
        lensMaterial.uniforms.lensChroma.value = lens.chroma ? 1 : 0;
      } else {
        disposeLensTargets();
      }
      requestRender();
    },
    onRender(fn) { renderListeners.add(fn); return () => renderListeners.delete(fn); },
    onBeforeRender(fn) { beforeListeners.add(fn); return () => beforeListeners.delete(fn); },
    memory: () => ({ ...renderer.info.memory }),
  };
}

/** Recorta la mitad izquierda o derecha de una textura SBS mediante coordenadas UV. */
export function halfGeometry(side, sourceWidth) {
  // Medio texel de margen para que el filtrado lineal no mezcle columnas del otro ojo.
  const border = 0.5 / sourceWidth;
  const minU = side === 'left' ? border : 0.5 + border;
  const maxU = side === 'left' ? 0.5 - border : 1 - border;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, minU + (maxU - minU) * uv.getX(i));
  uv.needsUpdate = true;
  return geometry;
}

/** Escala que hace caber un contenido de proporción `contentAspect` dentro de la región, sin deformarlo. */
export function fitHeight(regionAspect, contentAspect) {
  return 2 * Math.min(1, regionAspect / contentAspect);
}
