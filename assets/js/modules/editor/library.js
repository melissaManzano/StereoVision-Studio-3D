import { pairFiles } from '../../processing/pairing.js';
import { loadPair, loadSingle, isMpo, EDITOR_ACCEPT, SINGLE_ACCEPT } from './sources.js';
import { createPipeline } from './pipeline.js';
import { defaultRecipe } from './recipe.js';
import { analyzePair, applyAlignment, applyAutoCrop, applyWindow, computeColorLUT } from './operations.js';
import { encodeImage, download, baseName, FORMATS } from './exporter.js';

const IMAGE_OR_MPO = /\.(jpe?g|png|webp|mpo)$/i;

/**
 * Entrada de contenido del editor estéreo (panel izquierdo):
 * par izquierdo/derecho, imagen única o MPO, y carpeta con emparejado automático.
 * También ejecuta el procesamiento por lotes sobre los pares de la carpeta.
 */
export function createLibrary({ el, load, worker, renderer, ui }) {
  let pendingLeft = null;
  let pendingRight = null;
  let entries = [];
  let activeIndex = -1;
  const listeners = new Set();
  const maxSize = () => renderer.capabilities.maxTextureSize;

  el.pairLeftInput.accept = EDITOR_ACCEPT;
  el.pairRightInput.accept = EDITOR_ACCEPT;
  el.singleInput.accept = SINGLE_ACCEPT;
  el.multiInput.accept = SINGLE_ACCEPT;

  function showPending() {
    el.pairLeftName.textContent = pendingLeft ? pendingLeft.name : 'Sin elegir';
    el.pairRightName.textContent = pendingRight ? pendingRight.name : 'Sin elegir';
  }

  function openPair(left, right) {
    activeIndex = -1;
    renderList();
    return load(() => loadPair(left, right, { maxSize: maxSize() }), `${left.name} + ${right.name}`);
  }

  function openSingle(file) {
    activeIndex = -1;
    renderList();
    return load(() => loadSingle(file, el.singleLayout.value, { worker, maxSize: maxSize() }), file.name);
  }

  function tryPair() {
    showPending();
    if (!pendingLeft || !pendingRight) {
      ui.message(pendingLeft ? 'Vista izquierda elegida. Ahora elige la vista derecha.' : 'Vista derecha elegida. Ahora elige la vista izquierda.');
      return;
    }
    const [l, r] = [pendingLeft, pendingRight];
    pendingLeft = null;
    pendingRight = null;
    showPending();
    openPair(l, r);
  }

  function entryLoader(entry) {
    if (entry.single) return () => loadSingle(entry.single, el.singleLayout.value, { worker, maxSize: maxSize() });
    return () => loadPair(entry.left, entry.right, { maxSize: maxSize() });
  }

  function renderList() {
    el.pairList.replaceChildren(...entries.map((entry, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pair-item';
      btn.textContent = entry.name;
      if (i === activeIndex) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => {
        activeIndex = i;
        renderList();
        load(entryLoader(entry), entry.name);
      });
      const li = document.createElement('li');
      const kind = document.createElement('span');
      kind.className = 'pair-kind';
      kind.textContent = entry.single ? (isMpo(entry.single) ? 'MPO' : 'Imagen única') : 'Par';
      li.append(btn, kind);
      return li;
    }));
    el.pairList.hidden = entries.length === 0;
  }

  function setFolder(fileList) {
    const files = [...fileList].filter((f) => IMAGE_OR_MPO.test(f.name));
    const { pairs, unpaired } = pairFiles(files.map((f) => f.name));
    entries = pairs.map((p) => (p.single !== undefined
      ? { name: p.name, single: files[p.single] }
      : { name: p.name, left: files[p.left], right: files[p.right] }));
    activeIndex = -1;
    renderList();
    listeners.forEach((fn) => fn(entries.length));
    if (!entries.length) {
      ui.showError('No se encontraron pares', `Se revisaron ${files.length} imágenes. Nombra los pares con _L/_R, -izq/-der, numeración consecutiva o usa imágenes SBS/MPO.`);
      return;
    }
    ui.message(`${entries.length} ${entries.length === 1 ? 'par detectado' : 'pares detectados'}${unpaired.length ? `; ${unpaired.length} sin pareja: ${unpaired.map((i) => files[i].name).slice(0, 3).join(', ')}${unpaired.length > 3 ? '…' : ''}` : ''}. Elige uno para abrirlo.`);
  }

  const pick = (input, fn) => input.addEventListener('change', () => {
    const files = input.files;
    if (files?.length) fn(files);
    input.value = '';
  });
  el.pairLeftBtn.addEventListener('click', () => el.pairLeftInput.click());
  el.pairRightBtn.addEventListener('click', () => el.pairRightInput.click());
  el.singleBtn.addEventListener('click', () => el.singleInput.click());
  el.folderBtn.addEventListener('click', () => el.folderInput.click());
  el.multiBtn.addEventListener('click', () => el.multiInput.click());
  pick(el.pairLeftInput, (f) => { pendingLeft = f[0]; tryPair(); });
  pick(el.pairRightInput, (f) => { pendingRight = f[0]; tryPair(); });
  pick(el.singleInput, (f) => openSingle(f[0]));
  pick(el.folderInput, setFolder);
  pick(el.multiInput, setFolder);
  if (!('webkitdirectory' in el.folderInput)) el.folderBtn.hidden = true;

  /**
   * Procesamiento por lotes: para cada par aplica las operaciones elegidas sobre una copia
   * de la receta actual, exporta y empaqueta todo en un ZIP junto con un informe.
   * Cada par se libera antes de cargar el siguiente.
   */
  async function runBatch({ template, options, format, onProgress }) {
    if (!entries.length) throw new Error('No hay pares de carpeta para procesar');
    const pipeline = createPipeline(renderer);
    const files = [];
    const lines = [`StereoVision Studio 3D, lote del ${new Date().toLocaleString('es')}`, `Salida: ${template.output}; formato ${format}`, ''];
    let failed = 0;
    const def = defaultRecipe();
    try {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        onProgress(i / entries.length);
        ui.message(`Lote: ${i + 1} de ${entries.length}, ${entry.name}…`);
        let media;
        try {
          media = await entryLoader(entry)();
          const r = structuredClone(template);
          r.color.lut = null;
          r.window = def.window;
          if (options.align) r.align = { ...def.align };
          if (options.crop) r.crop = { ...def.crop };
          pipeline.setSources(media.left, media.right);
          let note = 'sin alineación automática';
          if (options.align || options.window) {
            const res = await analyzePair(worker, media, r);
            if (res.ok) {
              if (options.align) applyAlignment(r, res);
              if (options.window) applyWindow(r, res);
              note = `desnivel ${res.dy.toFixed(1)} px, rotación ${res.rotation.toFixed(2)}°, escala ${(res.scale * 100).toFixed(2)} %, ${res.inliers} coincidencias`;
            } else {
              failed++;
              note = `alineación no aplicada: ${res.reason}`;
            }
          }
          if (options.crop) applyAutoCrop(r, media);
          if (options.color) r.color.lut = await computeColorLUT(worker, pipeline, r);
          const mode = r.output === 'wiggle' ? 'sbs' : r.output;
          const image = pipeline.readOutput(r, mode);
          const data = await encodeImage(worker, image, format);
          const name = `${baseName(entry.name)}_${mode}.${FORMATS[format].ext}`;
          files.push({ name, data });
          lines.push(`${name}: ${image.width}×${image.height}; ${note}`);
        } catch (err) {
          failed++;
          lines.push(`${entry.name}: error, ${err.title ?? err.message}`);
        } finally {
          media?.release();
        }
        await new Promise((r) => setTimeout(r)); // cede el hilo para que la interfaz respire
      }
      onProgress(1);
      files.push({ name: 'informe.txt', data: new TextEncoder().encode(lines.join('\n')) });
      const zip = await worker.run('zip', { files }, files.map((f) => f.data.buffer));
      const file = `lote_${template.output}_${files.length - 1}.zip`;
      download(zip, file, 'application/zip');
      return { done: files.length - 1, total: entries.length, failed, file };
    } finally {
      pipeline.dispose();
    }
  }

  return {
    openPair,
    openSingle,
    /** Archivos soltados sobre el visor: dos forman un par; uno se abre como imagen única. */
    openDropped(fileList) {
      const files = [...fileList];
      if (files.length >= 3) return setFolder(files);
      if (files.length === 2) {
        const { pairs } = pairFiles(files.map((f) => f.name));
        const p = pairs.find((x) => x.left !== undefined);
        return p ? openPair(files[p.left], files[p.right]) : openPair(files[0], files[1]);
      }
      return openSingle(files[0]);
    },
    count: () => entries.length,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    runBatch,
    reset() { pendingLeft = null; pendingRight = null; showPending(); },
  };
}
