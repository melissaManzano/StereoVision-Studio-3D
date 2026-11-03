import * as THREE from 'three';

/**
 * Un único WebGLRenderer para todo el Studio.
 *  - modo "single": una vista a pantalla completa (anaglifo).
 *  - modo "split": dos viewports, mitad izquierda = ojo izquierdo, mitad derecha = ojo derecho (SBS y VR).
 * Dibuja bajo demanda; solo mantiene un ciclo continuo mientras un video se reproduce.
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

  /** Tamaño en px CSS de la región de un ojo (o de la vista completa en modo single). */
  function eyeSize() {
    return { width: mode === 'split' ? width / 2 : width, height };
  }

  function drawRegion(scene, x, w) {
    const aspect = w / height;
    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
    renderer.setViewport(x, 0, w, height);
    renderer.setScissor(x, 0, w, height);
    renderer.render(scene, camera);
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
      drawRegion(scenes.left, 0, leftWidth);
      drawRegion(scenes.right, leftWidth, width - leftWidth);
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
