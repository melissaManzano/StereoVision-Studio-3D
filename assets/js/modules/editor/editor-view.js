import * as THREE from 'three';
import { fitHeight } from '../stage.js';
import { createPipeline } from './pipeline.js';
import { createEditorPanel } from './editor-panel.js';
import { defaultRecipe, createHistory, clone, orientedSize, outputLayout } from './recipe.js';
import { analyzePair, applyAlignment, applyAutoCrop, applyWindow, applyFloatingWindow, computeColorLUT } from './operations.js';
import { exportImage, exportWiggle } from './exporter.js';

const DISPLAY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
// La salida del pipeline ya está en sRGB: se muestra sin conversión de color.
const DISPLAY_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }
`;

function displayMesh() {
  const material = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: DISPLAY_VERTEX, fragmentShader: DISPLAY_FRAGMENT });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

const fmt = (v, d = 1) => Number(v).toFixed(d).replace('.', ',');

/**
 * Vista del editor estéreo dentro del Studio. Mantiene la receta, el historial y la vista previa
 * en vivo; conecta el panel, el arrastre con el ratón o el dedo y las flechas del teclado.
 * @param {object} ctx { ui, container, worker, library }
 */
export function createEditorView(stage, media, ctx) {
  const { ui, worker, library } = ctx;
  const host = stage.host;
  const pipeline = createPipeline(stage.renderer);
  pipeline.setSources(media.left, media.right);

  let recipe = defaultRecipe();
  let history = createHistory(recipe);
  let previewMode = 'output';
  let analysis = null;
  let lastReport = null;
  let vr = false;
  let dirty = true;
  let last = null;
  let wigglePhase = 0;
  let wiggleDelay = 140;
  let wiggleTimer = null;
  let keyTimer = null;
  let busy = false;

  const main = displayMesh();
  const eyes = [displayMesh(), displayMesh()];
  stage.scenes.left.add(main);
  stage.setMode('single');

  const listeners = new AbortController();
  const on = (t, type, fn, opts = {}) => t.addEventListener(type, fn, { signal: listeners.signal, ...opts });

  function sizeBounds() {
    const { width: W, height: H } = orientedSize(media.width, media.height, recipe.orientation);
    return {
      dy: Math.round(H * 0.1),
      parallax: Math.round(W * 0.1),
      cropX: Math.round(W * 0.4),
      cropY: Math.round(H * 0.4),
      window: Math.round(W * 0.08),
    };
  }

  function boundsByPath() {
    const b = sizeBounds();
    return {
      'align.dy': [-b.dy, b.dy], 'align.parallax': [-b.parallax, b.parallax],
      'crop.left': [0, b.cropX], 'crop.right': [0, b.cropX], 'crop.top': [0, b.cropY], 'crop.bottom': [0, b.cropY],
      'window.left': [0, b.window], 'window.right': [0, b.window],
    };
  }

  function exportSize() {
    const f = pipeline.frame(recipe);
    const w = Math.floor((f.crop.w * recipe.resize) / 100);
    const h = Math.floor((f.crop.h * recipe.resize) / 100);
    const layout = outputLayout(recipe.output);
    return { width: layout === 'sbs' ? w * 2 : w, height: layout === 'tb' ? h * 2 : h };
  }

  function currentMode() {
    if (previewMode !== 'output') return previewMode;
    if (recipe.output === 'wiggle') return wigglePhase ? 'right' : 'left';
    return recipe.output;
  }

  function layout() {
    if (!last) return;
    const { width, height } = stage.eyeSize();
    if (!width || !height) return;
    if (vr) {
      const a = last.eyeWidth / last.eyeHeight;
      const h = fitHeight(width / height, a);
      eyes.forEach((m) => m.scale.set(h * a, h, 1));
    } else {
      const a = last.width / last.height;
      const h = fitHeight(width / height, a);
      main.scale.set(h * a, h, 1);
    }
  }

  function invalidate() {
    dirty = true;
    stage.requestRender();
  }

  const offBefore = stage.onBeforeRender(() => {
    if (!dirty) return;
    dirty = false;
    last = pipeline.preview(recipe, currentMode());
    main.material.uniforms.map.value = last.texture;
    eyes[0].material.uniforms.map.value = last.eyes[0];
    eyes[1].material.uniforms.map.value = last.eyes[1];
    layout();
  });
  const offResize = stage.onResize(() => { layout(); stage.requestRender(); });

  function updateWiggle() {
    const want = !vr && previewMode === 'output' && recipe.output === 'wiggle';
    if (want && !wiggleTimer) {
      wiggleTimer = setInterval(() => { wigglePhase ^= 1; invalidate(); }, wiggleDelay);
    } else if (!want && wiggleTimer) {
      clearInterval(wiggleTimer);
      wiggleTimer = null;
      wigglePhase = 0;
    }
  }

  /** En VR, la salida Cardboard también aplica la lente al visor. */
  function updateLens() {
    stage.setLens(vr && recipe.output === 'cardboard' ? recipe.lens : null);
  }

  function sync() {
    panel.sync(recipe, { canUndo: history.canUndo(), canRedo: history.canRedo(), outputSize: exportSize() });
    updateWiggle();
    updateLens();
  }

  function commit(label) {
    if (history.commit(recipe) && label) ui.message(`${label}: aplicado. Ctrl+Z para deshacer.`);
    sync();
  }

  function setRecipe(next) {
    recipe = next;
    panel.setBounds(boundsByPath());
    sync();
    invalidate();
  }

  async function task(startMsg, fn) {
    if (busy) return;
    busy = true;
    panel.setBusy(true);
    ui.message(startMsg);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      ui.showError('La operación no se completó', `${err.message}. El par sigue abierto; puedes intentarlo de nuevo.`);
    } finally {
      busy = false;
      panel.setBusy(false);
      sync();
    }
  }

  async function ensureAnalysis() {
    if (analysis) return analysis;
    const res = await analyzePair(worker, media, recipe);
    if (!res.ok) throw new Error(res.reason);
    analysis = res;
    return res;
  }

  function showReport(res) {
    lastReport = res;
    panel.showReport([
      ['Puntos detectados', `${res.features[0]} / ${res.features[1]}`],
      ['Coincidencias', `${res.matches} (${res.inliers} coherentes)`],
      ['Desnivel corregido', `${fmt(res.dy)} px`],
      ['Rotación corregida', `${fmt(res.rotation, 2)}°`],
      ['Escala corregida', `${fmt(res.scale * 100, 2)} %`],
      ['Error vertical', `${fmt(res.rmsBefore, 2)} → ${fmt(res.rmsAfter, 2)} px`],
      ['Tiempo', `${res.ms} ms en segundo plano`],
    ]);
  }

  const actions = {
    undo() { const r = history.undo(); if (r) { setRecipe(r); ui.message('Deshecho.'); } },
    redo() { const r = history.redo(); if (r) { setRecipe(r); ui.message('Rehecho.'); } },
    swap() {
      recipe.swap = !recipe.swap;
      recipe.color.lut = null;
      analysis = null;
      invalidate();
      commit('Intercambio de vistas');
      ui.message(`Vistas ${recipe.swap ? 'intercambiadas' : 'en su orden original'}. Si ya estaba alineado, vuelve a alinear.`);
    },
    setPreview(mode) { previewMode = mode; updateWiggle(); invalidate(); },
    autoAlign: () => task('Buscando puntos característicos y emparejándolos…', async () => {
      const res = await analyzePair(worker, media, recipe);
      if (!res.ok) {
        ui.showError('No se pudo alinear automáticamente', `${res.reason} Usa la alineación manual con la vista Mezcla.`);
        return;
      }
      analysis = res;
      applyAlignment(recipe, res);
      showReport(res);
      invalidate();
      commit('Alineación automática');
      ui.message(`Alineado: desnivel ${fmt(res.dy)} px, rotación ${fmt(res.rotation, 2)}°, escala ${fmt(res.scale * 100, 2)} %, con ${res.inliers} coincidencias.`);
    }),
    resetAlign() {
      recipe.align = { ...defaultRecipe().align, parallax: recipe.align.parallax };
      invalidate();
      commit('Alineación restablecida');
    },
    autoCrop() {
      if (!applyAutoCrop(recipe, media)) {
        ui.showError('Recorte automático no aplicado', 'La corrección actual dejaría menos del 20 % de la imagen. Revisa la alineación.');
        return;
      }
      invalidate();
      commit('Recorte automático');
    },
    clearCrop() { recipe.crop = { left: 0, right: 0, top: 0, bottom: 0 }; invalidate(); commit('Recorte eliminado'); },
    autoWindow: () => task('Midiendo el paralaje de la escena…', async () => {
      const res = await ensureAnalysis();
      const p = applyWindow(recipe, res);
      invalidate();
      commit('Montaje en ventana');
      ui.message(`Montaje en ventana: paralaje ${fmt(p)} px; el punto más cercano queda en el plano de la pantalla.`);
    }),
    autoFloating: () => task('Buscando conflictos de borde…', async () => {
      const res = await ensureAnalysis();
      const w = applyFloatingWindow(recipe, res, media);
      invalidate();
      commit('Ventana flotante');
      ui.message(w.left || w.right ? `Ventana flotante: ${w.left} px a la izquierda, ${w.right} px a la derecha.` : 'No hay objetos delante de la pantalla junto a los bordes; no hace falta ventana flotante.');
    }),
    matchColor: () => task('Comparando histogramas de ambas vistas…', async () => {
      recipe.color.lut = recipe.color.lut ? null : await computeColorLUT(worker, pipeline, recipe);
      invalidate();
      commit(recipe.color.lut ? 'Igualación de color' : 'Igualación de color quitada');
    }),
    rotate90() {
      const def = defaultRecipe();
      recipe.orientation = (recipe.orientation + 90) % 360;
      recipe.align = def.align;
      recipe.crop = def.crop;
      recipe.window = def.window;
      recipe.color.lut = null;
      analysis = null;
      panel.setBounds(boundsByPath());
      invalidate();
      commit('Giro de 90°');
    },
    exportImage: (format) => task('Generando la imagen a resolución completa…', async () => {
      if (recipe.output === 'wiggle') {
        const r = await exportWiggle({ worker, pipeline, recipe, delay: wiggleDelay, name: media.exportName });
        ui.message(`Descargado ${r.file} (${r.width} × ${r.height}, ${Math.round(r.bytes / 1024)} KB).`);
        return;
      }
      const r = await exportImage({ worker, pipeline, recipe, format, name: media.exportName });
      ui.message(`Descargado ${r.file} (${r.width} × ${r.height}, ${Math.round(r.bytes / 1024)} KB).`);
    }),
    exportGif: (delay) => task('Codificando el wiggle GIF…', async () => {
      const r = await exportWiggle({ worker, pipeline, recipe, delay, name: media.exportName });
      ui.message(`Descargado ${r.file} (${r.width} × ${r.height}, ${Math.round(r.bytes / 1024)} KB).`);
    }),
    setWiggleDelay(ms) {
      wiggleDelay = ms;
      if (wiggleTimer) { clearInterval(wiggleTimer); wiggleTimer = null; updateWiggle(); }
    },
    runBatch: (options, format) => task('Procesando el lote…', async () => {
      const r = await library.runBatch({ template: clone(recipe), options, format, onProgress: (v) => panel.setProgress(v) });
      panel.setProgress(null);
      ui.message(`Lote terminado: ${r.done} de ${r.total} pares en ${r.file}.${r.failed ? ` ${r.failed} con avisos (ver informe.txt).` : ''}`);
    }),
  };

  const panel = createEditorPanel(ctx.container, {
    getRecipe: () => recipe,
    preview: () => { invalidate(); panel.sync(recipe, { canUndo: history.canUndo(), canRedo: history.canRedo(), outputSize: exportSize() }); },
    commit,
    actions,
    bounds: sizeBounds(),
  });
  panel.setBatch(library.count());
  const offLibrary = library.onChange((count) => panel.setBatch(count));
  sync();
  invalidate();

  // ---- Alineación manual: arrastre y teclado ----
  host.classList.add('is-editor');
  let drag = null;

  /** Píxeles de la imagen original por cada píxel CSS de la vista previa. */
  function sourcePerCss() {
    if (!last) return 1;
    const rect = host.getBoundingClientRect();
    const eyeCss = ((main.scale.y / 2) * rect.height) / (outputLayout(currentMode()) === 'tb' ? 2 : 1);
    return last.frame.crop.h / Math.max(1, eyeCss);
  }

  on(host, 'pointerdown', (e) => {
    if (vr || busy || e.button !== 0 || e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, parallax: recipe.align.parallax, dy: recipe.align.dy, k: sourcePerCss() };
    host.setPointerCapture(e.pointerId);
    host.classList.add('is-dragging');
  });
  on(host, 'pointermove', (e) => {
    if (!drag) return;
    recipe.align.parallax = Math.round((drag.parallax + (e.clientX - drag.x) * drag.k) * 2) / 2;
    recipe.align.dy = Math.round((drag.dy + (e.clientY - drag.y) * drag.k) * 2) / 2;
    invalidate();
    panel.sync(recipe, { canUndo: history.canUndo(), canRedo: history.canRedo(), outputSize: exportSize() });
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    host.classList.remove('is-dragging');
    commit('Alineación manual');
  };
  on(host, 'pointerup', endDrag);
  on(host, 'pointercancel', endDrag);

  on(window, 'keydown', (e) => {
    if (vr) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'button';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); (e.shiftKey ? actions.redo : actions.undo)(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); actions.redo(); return; }
    if (typing || mod || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const stepPx = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') recipe.align.parallax -= stepPx;
    if (e.key === 'ArrowRight') recipe.align.parallax += stepPx;
    if (e.key === 'ArrowUp') recipe.align.dy -= stepPx;
    if (e.key === 'ArrowDown') recipe.align.dy += stepPx;
    invalidate();
    panel.sync(recipe, { canUndo: history.canUndo(), canRedo: history.canRedo(), outputSize: exportSize() });
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => commit('Alineación con teclado'), 500);
  });

  return {
    update() {},
    reset() {
      setRecipe(defaultRecipe());
      analysis = null;
      panel.showReport([]);
      commit('Editor restablecido');
    },
    snapshot() { return { recipe: clone(recipe) }; },
    /** Restaura una receta del historial de cargas; deshacer empieza desde ella. */
    restore({ recipe: saved }) {
      if (!saved) return;
      const full = { ...defaultRecipe(), ...clone(saved) };
      history = createHistory(full);
      analysis = null;
      setRecipe(full);
    },
    describe() {
      const { color, ...rest } = recipe;
      return {
        receta: { ...rest, color: { ...color, lut: color.lut ? 'igualación por histogramas activa' : null } },
        alineacion_automatica: lastReport && {
          coincidencias: lastReport.matches, coherentes: lastReport.inliers,
          desnivel_px: lastReport.dy, rotacion_grados: lastReport.rotation, escala: lastReport.scale,
          error_vertical_antes_px: lastReport.rmsBefore, error_vertical_despues_px: lastReport.rmsAfter,
        },
      };
    },
    setVR(on) {
      vr = on;
      stage.scenes.left.remove(main);
      if (on) {
        stage.scenes.left.add(eyes[0]);
        stage.scenes.right.add(eyes[1]);
        stage.setMode('split');
      } else {
        stage.scenes.left.remove(eyes[0]);
        stage.scenes.right.remove(eyes[1]);
        stage.scenes.left.add(main);
        stage.setMode('single');
      }
      updateWiggle();
      updateLens();
      invalidate();
    },
    dispose() {
      stage.setLens(null);
      listeners.abort();
      clearInterval(wiggleTimer);
      clearTimeout(keyTimer);
      offBefore();
      offResize();
      offLibrary();
      host.classList.remove('is-editor', 'is-dragging');
      [main, ...eyes].forEach((m) => {
        m.parent?.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      });
      panel.dispose();
      pipeline.dispose();
    },
  };
}
