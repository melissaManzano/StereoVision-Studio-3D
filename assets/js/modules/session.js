import { MODULES, STATUS } from './state.js';
import { importFile, fetchSample, ImportError } from './importer.js';
import { createAnaglyphView } from './anaglyph.js';
import { createSbsImageView, detectLayout } from './sbs.js';
import { createVideoView } from './video.js';
import { createEditorView } from './editor/editor-view.js';

/**
 * Sesión de contenido: un solo archivo activo a la vez (RN-05).
 * Coordina importación → vista → calibración, sustituye el archivo anterior
 * liberando texturas, geometrías, URLs temporales y reproducción.
 */
const PAIR_LAYOUT = { sbs: 'Lado a lado paralelo', cross: 'Lado a lado cruzado', tb: 'Arriba/abajo', par: 'Dos archivos', mpo: 'MPO' };

export function createSession({ store, stage, ui, calibration }) {
  let editor = null;  // { worker, library } del editor estéreo, conectado desde main.js
  let media = null;   // archivo decodificado activo
  let view = null;    // visor del módulo (anaglifo, SBS o video)
  let detected = null;
  let request = 0;    // descarta resultados de cargas que fueron reemplazadas

  stage.onRender(() => ui.renderGpu(stage.memory()));

  function release() {
    view?.dispose();
    media?.release();
    view = null;
    media = null;
    detected = null;
    stage.setMode('none');
  }

  function createView(module, m) {
    if (module.id === 'editor') return createEditorView(stage, m, { ui, container: ui.el.controls, ...editor });
    if (module.id === 'anaglyph') return createAnaglyphView(stage, m);
    if (module.id === 'sbs') return createSbsImageView(stage, m);
    return createVideoView(stage, m, ui.el.transportUI, {
      onStatus: (status) => { if (media === m) store.set({ status }); },
      onError: (title, detail) => { if (media === m) ui.showError(title, detail); },
    });
  }

  function emptyFor(moduleId) {
    calibration.setModule(moduleId);
    calibration.setEnabled(false);
    ui.renderMeta(null);
    ui.renderEyes(false);
  }

  /** Aplica la calibración vigente a la vista en tiempo real (RN-09). */
  function apply(values) {
    if (!view) return;
    view.update(values);
    ui.renderEyes(Boolean(values.swap));
    if (media?.kind === 'pair') ui.el.meta.layout.textContent = PAIR_LAYOUT[media.layout] ?? 'Par';
    else ui.renderLayout(detected ? values.layout : null, detected);
  }

  function selectModule(id) {
    const state = store.get();
    if (state.module === id || !MODULES[id]) return;
    const closed = media?.name;
    request++;
    release();
    ui.hideError();
    emptyFor(id);
    store.set({ module: id, media: null, status: STATUS.EMPTY, pendingName: null });
    ui.message(closed
      ? `Se cerró ${closed} y se liberaron sus recursos. Módulo ${MODULES[id].label} activo.`
      : `Módulo ${MODULES[id].label} activo. Importa un archivo.`);
  }

  function fail(err) {
    const title = err instanceof ImportError ? err.title : 'Ocurrió un error inesperado';
    const detail = err instanceof ImportError ? err.detail : 'Intenta de nuevo o importa otro archivo.';
    if (!(err instanceof ImportError)) console.error(err);
    ui.showError(title, detail);
    // Si había contenido, se conserva y el Studio sigue operativo (RN-04).
    const status = media ? (media.kind === 'video' ? STATUS.PAUSED : STATUS.READY) : STATUS.ERROR;
    store.set({ status, pendingName: null });
  }

  /**
   * Carga genérica: `loader` valida y decodifica (importer.js o las fuentes del editor)
   * y devuelve un objeto media con release(). Aquí se sustituye el contenido anterior.
   */
  async function load(loader, name) {
    const module = MODULES[store.get().module];
    if (!module) {
      ui.showError('Primero elige un módulo', 'Selecciona Anaglifo, Imagen SBS, Video SBS o Editor estéreo y después importa el archivo.');
      return;
    }
    const id = ++request;
    view?.pause?.();
    ui.hideError();
    store.set({ status: STATUS.LOADING, pendingName: name });
    ui.message(`Cargando ${name}…`);

    let next;
    try {
      next = await loader();
    } catch (err) {
      if (id === request) fail(err);
      return;
    }
    if (id !== request) { next.release(); return; }

    // Sustitución: se libera el archivo anterior antes de montar el nuevo.
    release();
    media = next;
    detected = module.render === 'split' ? detectLayout(media.width, media.height) : null;
    calibration.setModule(module.id, detected ? { layout: detected } : undefined); // RN-08
    try {
      view = createView(module, media);
    } catch (err) {
      release();
      emptyFor(module.id);
      store.set({ media: null });
      fail(new ImportError('No se pudo preparar la vista', 'WebGL no aceptó el archivo. Prueba con una resolución menor.'));
      console.error(err);
      return;
    }
    calibration.setEnabled(true);
    apply(calibration.values());
    ui.renderMeta(media);
    store.set({ media, status: STATUS.READY, pendingName: null });

    const aspect = media.width / media.height;
    if (module.render === 'split' && aspect < 1.3) {
      ui.message(`${media.name} está abierto, pero su proporción (${aspect.toFixed(2)}:1) no parece SBS. Comprueba que contenga dos vistas lado a lado.`);
    } else {
      const notes = media.notes?.length ? ` ${media.notes.join(' ')}` : '';
      ui.message(`${media.name} abierto en ${module.label}. Ajustes en valores iniciales.${notes}`);
    }
  }

  function open(file) {
    const module = MODULES[store.get().module];
    return load(() => importFile(file, module ?? MODULES.anaglyph), file.name);
  }

  /** Archivos soltados sobre el visor. En el editor, dos archivos forman un par. */
  function openFiles(files) {
    if (!files?.length) return;
    if (store.get().module === 'editor') editor.library.openDropped(files);
    else open(files[0]);
  }

  async function openSample() {
    const module = MODULES[store.get().module];
    if (!module) return;
    try {
      const file = await fetchSample(module.sample);
      if (module.id === 'editor') await editor.library.openSingle(file); // respeta la disposición elegida
      else await open(file);
    } catch (err) {
      fail(err);
    }
  }

  function close() {
    if (!media) return;
    const name = media.name;
    request++;
    release();
    emptyFor(store.get().module);
    store.set({ media: null, status: STATUS.EMPTY });
    ui.message(`Se cerró ${name} y se liberaron sus recursos.`);
  }

  function reset() {
    if (!view) return;
    if (view.reset) view.reset();
    else calibration.reset();
    ui.message('Ajustes restablecidos a sus valores iniciales.');
  }

  function togglePlayback() {
    view?.toggle?.();
  }

  /** Descarga los valores de calibración para registrar evidencias; no incluye el archivo. */
  function exportCalibration() {
    if (!media) return;
    const { width, height } = stage.eyeSize();
    const payload = {
      proyecto: 'StereoVision Studio 3D',
      fecha: new Date().toISOString(),
      modulo: MODULES[store.get().module].label,
      archivo: { nombre: media.name, formato: media.type, resolucion: `${media.width}x${media.height}`, disposicionDetectada: detected },
      ajustes: view.describe ? view.describe() : calibration.describe(),
      region_por_ojo_px: `${Math.round(width)}x${Math.round(height)}`,
      pantalla: { ancho: window.innerWidth, alto: window.innerHeight, dpr: window.devicePixelRatio },
      navegador: navigator.userAgent,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `calibracion-${store.get().module}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.message('Calibración exportada como JSON.');
  }

  return {
    selectModule, load, open, openFiles, openSample, close, reset, apply, togglePlayback, exportCalibration,
    setVR(on) { view?.setVR?.(on); },
    attachEditor(ctx) { editor = ctx; },
  };
}
