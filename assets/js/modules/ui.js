import { MODULES, STATUS_LABEL } from './state.js';
import { FORMATS } from './importer.js';
import { SINGLE_ACCEPT } from './editor/sources.js';
import { formatTime } from './video.js';

/**
 * Presentación: refleja el estado del Studio en la interfaz.
 * Habilita o deshabilita controles según haya módulo y contenido (RN-06)
 * y muestra mensajes de estado y de error.
 */

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const LAYOUT_LABEL = { full: 'Full SBS', half: 'Half SBS' };

export function createUI(doc = document) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    app: $('app'),
    modes: [...doc.querySelectorAll('.mode')],
    vrBtn: $('vrBtn'),
    importBtn: $('importBtn'),
    sampleBtn: $('sampleBtn'),
    closeBtn: $('closeBtn'),
    fileInput: $('fileInput'),
    importHint: $('importHint'),
    formats: $('formats'),
    meta: Object.fromEntries([...doc.querySelectorAll('[data-meta]')].map((n) => [n.dataset.meta, n])),
    stage: $('stage'),
    emptyTitle: $('emptyTitle'),
    emptyText: $('emptyText'),
    emptyState: $('emptyState'),
    eyeLeft: $('eyeLabelLeft'),
    eyeRight: $('eyeLabelRight'),
    alert: $('alert'),
    alertTitle: $('alertTitle'),
    alertDetail: $('alertDetail'),
    alertClose: $('alertClose'),
    transport: $('transport'),
    statusState: $('statusState'),
    statusMsg: $('statusMsg'),
    controls: $('controls'),
    toolsHint: $('toolsHint'),
    toolsNote: $('toolsNote'),
    resetBtn: $('resetBtn'),
    exportBtn: $('exportBtn'),
    vrExit: $('vrExit'),
    editorImport: $('editorImport'),
    editor: {
      pairLeftBtn: $('pairLeftBtn'), pairRightBtn: $('pairRightBtn'), pairLeftName: $('pairLeftName'), pairRightName: $('pairRightName'),
      pairLeftInput: $('pairLeftInput'), pairRightInput: $('pairRightInput'), singleLayout: $('singleLayout'), singleBtn: $('singleBtn'),
      singleInput: $('singleInput'), folderBtn: $('folderBtn'), multiBtn: $('multiBtn'), folderInput: $('folderInput'),
      multiInput: $('multiInput'), pairList: $('pairList'),
    },
    transportUI: {
      play: $('playBtn'), back: $('backBtn'), fwd: $('fwdBtn'), seek: $('seek'),
      current: $('timeCurrent'), total: $('timeTotal'), mute: $('muteBtn'), volume: $('volume'),
    },
  };

  el.alertClose.addEventListener('click', () => hideError());

  function message(text) {
    el.statusMsg.textContent = text;
  }

  function showError(title, detail) {
    el.alertTitle.textContent = title;
    el.alertDetail.textContent = detail;
    el.alert.hidden = false;
    message(`${title}. ${detail}`);
  }

  function hideError() {
    el.alert.hidden = true;
  }

  function renderMeta(media) {
    el.meta.name.textContent = media ? media.name : 'Sin archivo';
    el.meta.type.textContent = media ? media.type : 'Sin datos';
    el.meta.size.textContent = media ? formatBytes(media.size) : 'Sin datos';
    el.meta.resolution.textContent = media ? `${media.width} × ${media.height} px` : 'Sin datos';
    el.meta.duration.textContent = media?.kind === 'video' ? formatTime(media.duration) : 'Sin datos';
    if (!media) el.meta.layout.textContent = 'Sin datos';
  }

  /** Disposición SBS vigente y si coincide con la detectada al importar. */
  function renderLayout(layout, detected) {
    el.meta.layout.textContent = layout
      ? `${LAYOUT_LABEL[layout]} (${layout === detected ? 'detectada' : 'manual'})`
      : 'No aplica';
  }

  function renderGpu({ textures, geometries }) {
    const text = `${textures} ${textures === 1 ? 'textura' : 'texturas'}, ${geometries} ${geometries === 1 ? 'geometría' : 'geometrías'}`;
    if (el.meta.gpu.textContent !== text) el.meta.gpu.textContent = text;
  }

  function renderEyes(swap) {
    el.eyeLeft.textContent = swap ? 'Ojo izquierdo: mitad derecha' : 'Ojo izquierdo';
    el.eyeRight.textContent = swap ? 'Ojo derecho: mitad izquierda' : 'Ojo derecho';
  }

  /** Sincroniza toda la interfaz con el estado. */
  function render(state) {
    const module = state.module ? MODULES[state.module] : null;
    const hasContent = Boolean(state.media);
    const busy = state.status === 'loading';

    el.app.dataset.status = state.status;
    el.app.classList.toggle('has-content', hasContent);
    el.app.classList.toggle('has-video', hasContent && state.media.kind === 'video');

    el.modes.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.module === state.module));
      b.disabled = busy;
    });

    el.importBtn.disabled = !module || busy;
    el.sampleBtn.disabled = !module || busy;
    el.importBtn.setAttribute('aria-busy', String(busy));
    el.closeBtn.disabled = !hasContent || busy;
    el.vrBtn.disabled = !hasContent || !module?.vr;
    el.vrBtn.title = module && !module.vr ? 'El modo VR se usa con Imagen SBS y Video SBS' : '';
    el.resetBtn.disabled = !hasContent;
    el.exportBtn.disabled = !hasContent;

    const isEditor = state.module === 'editor';
    el.editorImport.hidden = !isEditor;
    el.editorImport.querySelectorAll('button, select').forEach((n) => { n.disabled = busy; });
    // En el editor, Importar acepta una imagen (SBS, arriba/abajo o MPO) o dos (par izquierda/derecha).
    el.fileInput.multiple = isEditor;

    if (isEditor) {
      el.fileInput.accept = SINGLE_ACCEPT;
      el.formats.textContent = 'Formatos: JPG, PNG o WebP; imagen única también en MPO.';
      el.importHint.textContent = hasContent
        ? 'Importar otra imagen sustituye el par actual y restablece la receta.'
        : 'Importa tu imagen lado a lado o MPO, o selecciona dos imágenes a la vez (izquierda y derecha).';
    } else if (module) {
      const f = FORMATS[module.kind];
      el.fileInput.accept = f.accept;
      el.formats.textContent = `Formatos: ${f.label}.`;
      el.importHint.textContent = hasContent
        ? 'Importar otro archivo sustituye al actual y restablece sus ajustes.'
        : `Importa ${module.kind === 'video' ? 'un video' : 'una imagen'} para ${module.label}, o abre la muestra incluida.`;
    } else {
      el.formats.textContent = 'Formatos: elige un módulo.';
      el.importHint.textContent = 'Elige un módulo para habilitar la importación.';
    }

    el.toolsHint.hidden = hasContent;
    el.toolsHint.textContent = module ? 'Los ajustes se activan cuando hay un archivo abierto.' : 'Elige un módulo para ver sus ajustes.';
    el.toolsNote.textContent = state.module === 'anaglyph'
      ? 'Observa el anaglifo con lentes rojo-cian (rojo en el ojo izquierdo). Los ajustes cambian solo la vista.'
      : isEditor
        ? 'El editor nunca modifica los originales: exporta archivos nuevos.'
        : 'Los ajustes cambian solo la vista; el archivo original no se modifica.';
    el.app.classList.toggle('is-editor', isEditor);

    el.transport.hidden = state.module !== 'video';

    // Mensaje central del visor cuando no hay contenido.
    el.emptyState.hidden = hasContent;
    if (!hasContent) {
      if (busy) {
        el.emptyTitle.textContent = 'Preparando archivo';
        el.emptyText.textContent = `Validando y decodificando ${state.pendingName ?? 'el archivo'}.`;
      } else if (state.status === 'error') {
        el.emptyTitle.textContent = 'No se pudo abrir el archivo';
        el.emptyText.textContent = 'Revisa el aviso de arriba e importa otro archivo; el Studio sigue disponible.';
      } else if (isEditor) {
        el.emptyTitle.textContent = 'Abre un par estéreo';
        el.emptyText.textContent = 'Dos imágenes (izquierda y derecha), una imagen lado a lado o arriba/abajo, un MPO o una carpeta. También puedes arrastrarlas aquí.';
      } else if (module) {
        el.emptyTitle.textContent = `Importa ${module.kind === 'video' ? 'un video SBS' : module.id === 'sbs' ? 'una imagen SBS' : 'un anaglifo'}`;
        el.emptyText.textContent = `${FORMATS[module.kind].label}. Usa Importar archivo o arrástralo aquí.`;
      } else {
        el.emptyTitle.textContent = 'Elige un módulo';
        el.emptyText.textContent = 'Anaglifo, Imagen SBS, Video SBS o Editor estéreo. Después importa un archivo desde tu equipo o arrástralo aquí.';
      }
    }

    el.statusState.textContent = state.vr ? `${STATUS_LABEL[state.status]} en VR` : STATUS_LABEL[state.status];
  }

  return { el, render, renderMeta, renderLayout, renderGpu, renderEyes, message, showError, hideError };
}
