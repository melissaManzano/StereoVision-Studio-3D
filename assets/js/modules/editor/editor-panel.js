import { OUTPUT_MODES, PREVIEW_MODES } from './recipe.js';
import { FORMATS } from './exporter.js';

/**
 * Interfaz del editor estéreo, organizada según el flujo de trabajo:
 * 1 Alineación · 2 Recorte · 3 Profundidad y ventana · 4 Color · 5 Imagen · 6 Salida · 7 Exportar.
 * Cada control está enlazado a una ruta de la receta ("align.dy"). Mover un control
 * actualiza la vista previa al instante; soltarlo confirma el cambio en el historial.
 */

const get = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
function set(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

const button = (text, cls = 'btn btn--secondary', extra = {}) => el('button', { type: 'button', className: cls, textContent: text, ...extra });

/**
 * @param {HTMLElement} container
 * @param {object} ctx  { getRecipe, preview, commit, actions, bounds }
 */
export function createEditorPanel(container, ctx) {
  const bindings = [];
  let uid = 0;

  function range({ path, label, min, max, step, unit = '', toUI = (v) => v, fromUI = (v) => v, digits = 0, help }) {
    const id = `ed-${++uid}`;
    const input = el('input', { type: 'range', id, className: 'range', min, max, step });
    const output = el('output', { htmlFor: id });
    const row = el('div', { className: 'field' }, el('label', { htmlFor: id, textContent: label }), output, input);
    if (help) {
      const p = el('p', { className: 'field__help', id: `${id}-help`, textContent: help });
      input.setAttribute('aria-describedby', p.id);
      row.append(p);
    }
    const show = (v) => {
      const text = `${v > 0 && min < 0 ? '+' : ''}${Number(v).toFixed(digits)} ${unit}`.trim();
      output.textContent = text;
      input.setAttribute('aria-valuetext', text);
    };
    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(ctx.getRecipe(), path, fromUI(v));
      show(v);
      ctx.preview();
    });
    input.addEventListener('change', () => ctx.commit(label));
    bindings.push({
      sync(recipe) { const v = toUI(get(recipe, path)); input.value = String(v); show(Number(input.value)); },
      setBounds(b) { if (b[path]) { input.min = b[path][0]; input.max = b[path][1]; } },
    });
    return row;
  }

  function select({ path, label, options, onChange }) {
    const id = `ed-${++uid}`;
    const node = el('select', { id, className: 'select' });
    let group = null;
    for (const o of options) {
      const opt = new Option(o.label, o.id);
      if (o.group) {
        if (!group || group.label !== o.group) { group = el('optgroup', { label: o.group }); node.append(group); }
        group.append(opt);
      } else node.append(opt);
    }
    node.addEventListener('change', () => {
      if (path) { set(ctx.getRecipe(), path, node.value); ctx.preview(); ctx.commit(label); }
      onChange?.(node.value);
    });
    if (path) bindings.push({ sync(recipe) { node.value = get(recipe, path); } });
    return { row: el('div', { className: 'field' }, el('label', { htmlFor: id, textContent: label }), node), node };
  }

  function step(n, title, open, ...content) {
    return el('details', { className: 'step', open }, el('summary', { textContent: `${n}. ${title}` }), el('div', { className: 'step__body' }, ...content));
  }

  const help = (text) => el('p', { className: 'field__help', textContent: text });
  const row = (...nodes) => el('div', { className: 'btn-row' }, ...nodes);

  // ---- Barra superior: historial, intercambio y vista previa ----
  const undoBtn = button('Deshacer', 'btn btn--secondary', { title: 'Ctrl+Z' });
  const redoBtn = button('Rehacer', 'btn btn--secondary', { title: 'Ctrl+Y' });
  const swapBtn = button('Intercambiar L/R', 'btn btn--secondary');
  swapBtn.setAttribute('aria-pressed', 'false');
  undoBtn.addEventListener('click', ctx.actions.undo);
  redoBtn.addEventListener('click', ctx.actions.redo);
  swapBtn.addEventListener('click', ctx.actions.swap);
  const previewSel = select({ label: 'Vista previa', options: PREVIEW_MODES.map(([id, label]) => ({ id, label })), onChange: ctx.actions.setPreview });

  // ---- 1. Alineación ----
  const alignBtn = button('Alinear automáticamente', 'btn btn--secondary');
  alignBtn.addEventListener('click', ctx.actions.autoAlign);
  const alignReset = button('Restablecer alineación', 'btn btn--quiet');
  alignReset.addEventListener('click', ctx.actions.resetAlign);
  const report = el('dl', { className: 'meta report', hidden: true });

  // ---- 2. Recorte ----
  const cropAuto = button('Recorte automático', 'btn btn--secondary');
  cropAuto.addEventListener('click', ctx.actions.autoCrop);
  const cropClear = button('Quitar recorte', 'btn btn--quiet');
  cropClear.addEventListener('click', ctx.actions.clearCrop);

  // ---- 3. Profundidad ----
  const windowBtn = button('Montaje en ventana', 'btn btn--secondary');
  windowBtn.addEventListener('click', ctx.actions.autoWindow);
  const floatBtn = button('Ventana flotante automática', 'btn btn--quiet');
  floatBtn.addEventListener('click', ctx.actions.autoFloating);

  // ---- 4. Color ----
  const matchBtn = button('Igualar color entre vistas', 'btn btn--secondary');
  matchBtn.setAttribute('aria-pressed', 'false');
  matchBtn.addEventListener('click', ctx.actions.matchColor);

  // ---- 5. Imagen ----
  const rotate90 = button('Girar el par 90°', 'btn btn--secondary');
  rotate90.addEventListener('click', ctx.actions.rotate90);
  const sizeInfo = el('p', { className: 'field__help' });

  // ---- 7. Exportar ----
  const formatSel = select({ label: 'Formato', options: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label })), onChange: () => syncFormat() });
  const jpegWarn = el('p', { className: 'warning', textContent: 'JPEG comprime con pérdida y genera artefactos distintos en cada vista, lo que degrada el efecto 3D. Usa PNG o TIFF salvo que necesites un archivo pequeño.', hidden: true });
  const exportBtn = button('Exportar imagen', 'btn btn--secondary');
  exportBtn.addEventListener('click', () => ctx.actions.exportImage(formatSel.node.value));
  let wiggleDelay = 140;
  const delayId = `ed-${++uid}`;
  const delayInput = el('input', { type: 'range', id: delayId, className: 'range', min: 60, max: 400, step: 10, value: wiggleDelay });
  const delayOut = el('output', { htmlFor: delayId, textContent: `${wiggleDelay} ms` });
  delayInput.addEventListener('input', () => { wiggleDelay = Number(delayInput.value); delayOut.textContent = `${wiggleDelay} ms`; ctx.actions.setWiggleDelay(wiggleDelay); });
  const gifBtn = button('Exportar wiggle GIF', 'btn btn--secondary');
  gifBtn.addEventListener('click', () => ctx.actions.exportGif(wiggleDelay));

  const batchBox = el('div', { className: 'batch', hidden: true });
  const opt = (key, text, checked) => {
    const id = `ed-${++uid}`;
    const input = el('input', { type: 'checkbox', id, className: 'check', checked });
    input.dataset.key = key;
    return el('div', { className: 'check-row' }, input, el('label', { htmlFor: id, textContent: text }));
  };
  const batchOpts = [opt('align', 'Alinear automáticamente cada par', true), opt('crop', 'Recorte automático', true), opt('window', 'Montaje en ventana', false), opt('color', 'Igualar color', true)];
  const batchBtn = button('Procesar lote', 'btn btn--secondary');
  const progress = el('progress', { className: 'progress', max: 1, value: 0, hidden: true });
  batchBtn.addEventListener('click', () => {
    const options = Object.fromEntries(batchOpts.map((r) => { const i = r.querySelector('input'); return [i.dataset.key, i.checked]; }));
    ctx.actions.runBatch(options, formatSel.node.value);
  });
  batchBox.append(el('h3', { className: 'batch__title', textContent: 'Lote' }), el('p', { className: 'field__help', id: 'batchInfo' }), ...batchOpts, batchBtn, progress);

  function syncFormat() {
    jpegWarn.hidden = formatSel.node.value !== 'jpeg';
  }

  const b = ctx.bounds;
  container.append(
    el('div', { className: 'editor' },
      row(undoBtn, redoBtn),
      swapBtn,
      previewSel.row,
      step(1, 'Alineación', true,
        row(alignBtn, alignReset),
        report,
        range({ path: 'align.dy', label: 'Desnivel vertical', min: -b.dy, max: b.dy, step: 0.5, unit: 'px', digits: 1, help: 'Principal causa de fatiga visual: debe quedar en 0 entre puntos homólogos.' }),
        range({ path: 'align.rotation', label: 'Rotación de la vista derecha', min: -5, max: 5, step: 0.05, unit: '°', digits: 2 }),
        range({ path: 'align.scale', label: 'Escala de la vista derecha', min: 95, max: 105, step: 0.05, unit: '%', digits: 2, toUI: (v) => v * 100, fromUI: (v) => v / 100 }),
        range({ path: 'align.keyH', label: 'Keystone horizontal', min: -10, max: 10, step: 0.1, unit: '%', digits: 1, toUI: (v) => v * 100, fromUI: (v) => v / 100 }),
        range({ path: 'align.keyV', label: 'Keystone vertical', min: -10, max: 10, step: 0.1, unit: '%', digits: 1, toUI: (v) => v * 100, fromUI: (v) => v / 100 }),
        help('Ajuste manual: arrastra sobre la vista o usa las flechas para mover la vista derecha (Shift: 10 px). Usa la vista previa Mezcla o Diferencia.'),
      ),
      step(2, 'Recorte sincronizado', false,
        row(cropAuto, cropClear),
        range({ path: 'crop.left', label: 'Izquierda', min: 0, max: b.cropX, step: 1, unit: 'px' }),
        range({ path: 'crop.right', label: 'Derecha', min: 0, max: b.cropX, step: 1, unit: 'px' }),
        range({ path: 'crop.top', label: 'Arriba', min: 0, max: b.cropY, step: 1, unit: 'px' }),
        range({ path: 'crop.bottom', label: 'Abajo', min: 0, max: b.cropY, step: 1, unit: 'px' }),
        help('El mismo rectángulo se aplica a ambas vistas.'),
      ),
      step(3, 'Profundidad y ventana', false,
        range({ path: 'align.parallax', label: 'Paralaje horizontal', min: -b.parallax, max: b.parallax, step: 0.5, unit: 'px', digits: 1, help: 'Define qué parte de la escena queda en el plano de la pantalla.' }),
        windowBtn,
        range({ path: 'window.left', label: 'Ventana flotante, borde izquierdo', min: 0, max: b.window, step: 1, unit: 'px' }),
        range({ path: 'window.right', label: 'Ventana flotante, borde derecho', min: 0, max: b.window, step: 1, unit: 'px' }),
        floatBtn,
      ),
      step(4, 'Color', false,
        matchBtn,
        range({ path: 'color.brightness', label: 'Brillo', min: -50, max: 50, step: 1, unit: '%' }),
        range({ path: 'color.contrast', label: 'Contraste', min: -50, max: 50, step: 1, unit: '%' }),
        range({ path: 'color.gamma', label: 'Gamma', min: 0.5, max: 2, step: 0.01, digits: 2 }),
        range({ path: 'color.saturation', label: 'Saturación', min: -100, max: 100, step: 1, unit: '%' }),
        range({ path: 'color.sharpness', label: 'Nitidez', min: 0, max: 200, step: 5, unit: '%' }),
        help('Los ajustes se aplican por igual a ambas vistas.'),
      ),
      step(5, 'Imagen', false,
        range({ path: 'pairRotation', label: 'Rotación del par', min: -10, max: 10, step: 0.1, unit: '°', digits: 1 }),
        rotate90,
        range({ path: 'resize', label: 'Tamaño de exportación', min: 10, max: 100, step: 5, unit: '%' }),
        sizeInfo,
      ),
      step(6, 'Salida', true,
        select({ path: 'output', label: 'Modo de salida', options: OUTPUT_MODES }).row,
        help('La vista previa muestra el modo elegido en vivo.'),
      ),
      step(7, 'Exportar', true, formatSel.row, jpegWarn, exportBtn, el('div', { className: 'field' }, el('label', { htmlFor: delayId, textContent: 'Velocidad del wiggle' }), delayOut, delayInput), gifBtn, batchBox),
    ),
  );

  const busyButtons = [alignBtn, cropAuto, windowBtn, floatBtn, matchBtn, exportBtn, gifBtn, batchBtn, rotate90];

  return {
    /** Refleja la receta en todos los controles (tras deshacer, rehacer u operaciones automáticas). */
    sync(recipe, { canUndo, canRedo, outputSize }) {
      bindings.forEach((bd) => bd.sync(recipe));
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
      swapBtn.setAttribute('aria-pressed', String(recipe.swap));
      matchBtn.setAttribute('aria-pressed', String(Boolean(recipe.color.lut)));
      matchBtn.textContent = recipe.color.lut ? 'Quitar igualación de color' : 'Igualar color entre vistas';
      sizeInfo.textContent = `Salida: ${outputSize.width} × ${outputSize.height} px.`;
    },
    setBounds(bounds) { bindings.forEach((bd) => bd.setBounds?.(bounds)); },
    showReport(items) {
      report.replaceChildren(...items.map(([k, v]) => el('div', {}, el('dt', { textContent: k }), el('dd', { textContent: v }))));
      report.hidden = !items.length;
    },
    setBusy(busy) {
      busyButtons.forEach((btn) => { btn.disabled = busy; btn.setAttribute('aria-busy', String(busy)); });
    },
    setBatch(count) {
      batchBox.hidden = count === 0;
      const info = batchBox.querySelector('#batchInfo');
      if (info) info.textContent = `${count} ${count === 1 ? 'par detectado' : 'pares detectados'} en la carpeta. Se aplican el modo de salida, el color y el tamaño actuales, y se descarga un ZIP.`;
      batchBtn.textContent = `Procesar ${count} ${count === 1 ? 'par' : 'pares'}`;
    },
    setProgress(value) {
      progress.hidden = value === null;
      if (value !== null) progress.value = value;
    },
    dispose() { container.replaceChildren(); },
  };
}
