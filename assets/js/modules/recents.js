import { OUTPUT_MODES } from './editor/recipe.js';
import { formatTime } from './video.js';

/**
 * Historial de cargas: las últimas cargas de cada módulo con los ajustes que tenían.
 * No guarda contenido decodificado ni recursos de GPU: solo la referencia al archivo
 * (una función que lo vuelve a abrir) y los ajustes. Así se respeta RN-05: al restaurar,
 * el archivo se vuelve a abrir y el anterior se libera como en cualquier carga.
 * Vive en memoria: se pierde al recargar la página.
 */

const LIMIT = 5;
const signed = (v, unit) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} ${unit}`;

/** Resumen legible de los ajustes guardados de una entrada. */
export function summarize(moduleId, settings) {
  if (!settings) return 'Valores iniciales';
  const parts = [];
  if (moduleId === 'anaglyph') {
    const { zoom, brightness, contrast } = settings.values;
    if (zoom !== 100) parts.push(`zoom ${zoom} %`);
    if (brightness) parts.push(`brillo ${signed(brightness, '%')}`);
    if (contrast !== 100) parts.push(`contraste ${contrast} %`);
  } else if (moduleId === 'sbs' || moduleId === 'video') {
    const { offset, vertical, scale, swap, layout } = settings.values;
    if (offset) parts.push(`horizontal ${signed(offset, 'px')}`);
    if (vertical) parts.push(`vertical ${signed(vertical, 'px')}`);
    if (scale !== 100) parts.push(`escala ${scale} %`);
    if (swap) parts.push('ojos intercambiados');
    parts.push(layout === 'half' ? 'Half SBS' : 'Full SBS');
    if (settings.values.lens) parts.push(`lente Cardboard ${settings.values.lensStrength} %`);
    if (settings.time > 0.5) parts.push(`en ${formatTime(settings.time)}`);
  } else if (moduleId === 'editor') {
    const r = settings.recipe;
    const a = r.align;
    if (a.dy || a.rotation || a.scale !== 1 || a.keyH || a.keyV) parts.push('alineado');
    if (a.parallax) parts.push(`horizontal ${signed(Math.round(a.parallax * 10) / 10, 'px')}`);
    if (Object.values(r.crop).some(Boolean)) parts.push('recortado');
    if (r.window.left || r.window.right) parts.push('ventana flotante');
    if (r.color.lut) parts.push('color igualado');
    if (r.swap) parts.push('vistas intercambiadas');
    if (r.output === 'cardboard' && r.lens) parts.push(`lente ${r.lens.strength} %`);
    parts.push(OUTPUT_MODES.find((m) => m.id === r.output)?.label ?? r.output);
  }
  return parts.length ? parts.join(', ') : 'Valores iniciales';
}

export function createRecents() {
  let entries = [];
  let seq = 0;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  return {
    /**
     * Registra una carga. Si el mismo archivo ya estaba en el historial del módulo,
     * se reemplaza (sube al principio con los ajustes nuevos).
     * @param {{ module: string, name: string, key: string, reopen: () => Promise<object> }} item
     */
    add(item) {
      entries = entries.filter((e) => !(e.module === item.module && e.key === item.key));
      const entry = { ...item, id: ++seq, time: new Date(), settings: null };
      entries.unshift(entry);
      const ofModule = entries.filter((e) => e.module === item.module);
      if (ofModule.length > LIMIT) entries = entries.filter((e) => e !== ofModule[ofModule.length - 1]);
      notify();
      return entry;
    },
    /** Sube una entrada al principio al restaurarla. */
    touch(entry) {
      entries = [entry, ...entries.filter((e) => e !== entry)];
      entry.time = new Date();
      notify();
    },
    update(entry, settings) {
      if (!entries.includes(entry)) return;
      entry.settings = settings;
      notify();
    },
    list: (moduleId) => entries.filter((e) => e.module === moduleId),
    clear(moduleId) {
      entries = entries.filter((e) => e.module !== moduleId);
      notify();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
