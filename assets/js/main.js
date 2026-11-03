import { createStore, STATUS } from './modules/state.js';
import { createStage } from './modules/stage.js';
import { createUI } from './modules/ui.js';
import { createCalibration } from './modules/calibration.js';
import { createSession } from './modules/session.js';
import { createVR } from './modules/vr.js';
import { createWorkerClient } from './modules/editor/worker-client.js';
import { createLibrary } from './modules/editor/library.js';

/** Inicialización: crea los módulos y conecta los eventos de la interfaz. */
function init() {
  const ui = createUI();
  const { el } = ui;

  let stage;
  try {
    stage = createStage(el.stage);
  } catch (err) {
    console.error(err);
    el.emptyTitle.textContent = 'WebGL no está disponible';
    el.emptyText.textContent = 'Abre el Studio en Chrome, Edge, Safari o Firefox actualizados con la aceleración gráfica activa.';
    el.modes.forEach((b) => { b.disabled = true; });
    ui.message('No se pudo iniciar WebGL.');
    return;
  }

  const store = createStore({ module: null, status: STATUS.EMPTY, media: null, vr: false, pendingName: null });
  store.subscribe(ui.render);

  let session;
  const calibration = createCalibration(el.controls, { onChange: (values) => session.apply(values) });
  session = createSession({ store, stage, ui, calibration });

  // Editor estéreo: un Web Worker para el procesamiento pesado y la entrada de pares.
  const worker = createWorkerClient();
  const library = createLibrary({ el: el.editor, load: session.load, worker, renderer: stage.renderer, ui });
  session.attachEditor({ worker, library });

  const vr = createVR({
    app: el.app,
    stage: el.stage,
    exitButton: el.vrExit,
    onChange: (active) => {
      store.set({ vr: active });
      session.setVR(active);
      ui.message(active ? 'Modo VR activo. Mismo archivo y mismos ajustes.' : 'De vuelta en el Studio. El archivo y los ajustes se conservaron.');
      if (!active) el.vrBtn.focus({ preventScroll: true });
    },
    onTap: () => session.togglePlayback(),
    notify: ui.message,
  });

  el.modes.forEach((button) => button.addEventListener('click', () => session.selectModule(button.dataset.module)));
  el.importBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    el.fileInput.value = ''; // permite volver a elegir el mismo archivo
    if (file) session.open(file);
  });
  el.sampleBtn.addEventListener('click', () => session.openSample());
  el.closeBtn.addEventListener('click', () => session.close());
  el.resetBtn.addEventListener('click', () => session.reset());
  el.exportBtn.addEventListener('click', () => session.exportCalibration());
  el.vrBtn.addEventListener('click', () => vr.enter());

  // Arrastrar y soltar sobre el visor (escritorio).
  el.stage.addEventListener('dragover', (event) => { event.preventDefault(); el.stage.classList.add('is-dragover'); });
  el.stage.addEventListener('dragleave', () => el.stage.classList.remove('is-dragover'));
  el.stage.addEventListener('drop', (event) => {
    event.preventDefault();
    el.stage.classList.remove('is-dragover');
    const files = event.dataTransfer?.files;
    if (files?.length && store.get().status !== STATUS.LOADING) session.openFiles(files);
  });

  ui.render(store.get());
}

init();
