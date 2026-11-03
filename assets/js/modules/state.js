/**
 * Estado central del Studio: módulo elegido, estado del sistema y archivo activo.
 * Los demás módulos leen el estado y se suscriben a sus cambios; nadie guarda copias.
 */

export const STATUS = Object.freeze({
  EMPTY: 'empty',       // sin archivo
  LOADING: 'loading',   // validando o decodificando
  READY: 'ready',       // imagen lista / video listo sin reproducir
  PLAYING: 'playing',
  PAUSED: 'paused',
  ERROR: 'error',       // la última importación falló y no hay contenido activo
});

export const STATUS_LABEL = Object.freeze({
  empty: 'Sin archivo',
  loading: 'Cargando',
  ready: 'Listo',
  playing: 'Reproduciendo',
  paused: 'En pausa',
  error: 'Error',
});

/** Cada módulo declara qué tipo de archivo admite, cómo se dibuja y si admite VR. */
export const MODULES = Object.freeze({
  anaglyph: { id: 'anaglyph', label: 'Anaglifo', kind: 'image', render: 'single', vr: false, sample: './assets/media/muestra-anaglifo.jpg' },
  sbs: { id: 'sbs', label: 'Imagen SBS', kind: 'image', render: 'split', vr: true, sample: './assets/media/muestra-sbs.jpg' },
  video: { id: 'video', label: 'Video SBS', kind: 'video', render: 'split', vr: true, sample: './assets/media/muestra-video-sbs.mp4' },
  editor: { id: 'editor', label: 'Editor estéreo', kind: 'pair', render: 'single', vr: true, sample: './assets/media/muestra-sbs.jpg' },
});

export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
