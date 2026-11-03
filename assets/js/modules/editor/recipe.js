/**
 * "Receta" del editor: todos los parámetros que transforman el par original en la salida.
 * El archivo original nunca se modifica; la receta se aplica en GPU para la vista previa
 * y para exportar. El historial guarda copias de la receta para deshacer y rehacer.
 */

export const OUTPUT_MODES = Object.freeze([
  { id: 'color', label: 'Anaglifo a color (rojo/cian)', group: 'Anaglifo' },
  { id: 'gray', label: 'Anaglifo en grises', group: 'Anaglifo' },
  { id: 'half', label: 'Anaglifo medio color', group: 'Anaglifo' },
  { id: 'dubois', label: 'Anaglifo optimizado (Dubois)', group: 'Anaglifo' },
  { id: 'amberBlue', label: 'Ámbar/azul (Dubois)', group: 'Anaglifo' },
  { id: 'greenMagenta', label: 'Verde/magenta (Dubois)', group: 'Anaglifo' },
  { id: 'sbs', label: 'Lado a lado paralelo', group: 'Pares', layout: 'sbs' },
  { id: 'cross', label: 'Lado a lado cruzado', group: 'Pares', layout: 'sbs' },
  { id: 'tb', label: 'Arriba/abajo', group: 'Pares', layout: 'tb' },
  { id: 'rows', label: 'Entrelazado por filas', group: 'Entrelazado' },
  { id: 'cols', label: 'Entrelazado por columnas', group: 'Entrelazado' },
  { id: 'wiggle', label: 'Wiggle (alternar vistas)', group: 'Animado' },
]);

export const PREVIEW_MODES = Object.freeze([
  ['output', 'Salida elegida'],
  ['overlay', 'Mezcla 50 % (alinear)'],
  ['difference', 'Diferencia (alinear)'],
  ['left', 'Solo izquierda'],
  ['right', 'Solo derecha'],
]);

export function outputLayout(modeId) {
  return OUTPUT_MODES.find((m) => m.id === modeId)?.layout ?? 'single';
}

export function defaultRecipe() {
  return {
    orientation: 0,       // giro del par en pasos de 90° (sentido horario)
    swap: false,
    align: { dy: 0, rotation: 0, scale: 1, keyH: 0, keyV: 0, parallax: 0 },
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    window: { left: 0, right: 0 },
    color: { lut: null, brightness: 0, contrast: 0, gamma: 1, saturation: 0, sharpness: 0 },
    pairRotation: 0,      // rotación fina de ambas vistas, en grados
    resize: 100,          // tamaño de exportación, en %
    output: 'dubois',
  };
}

export const clone = (r) => structuredClone(r);

/** Tamaño de la vista una vez aplicado el giro de 90°/270°. */
export function orientedSize(width, height, orientation) {
  return orientation % 180 === 0 ? { width, height } : { width: height, height: width };
}

/** Historial lineal: cada confirmación guarda el estado anterior; deshacer/rehacer navegan por él. */
export function createHistory(initial, limit = 100) {
  const past = [];
  const future = [];
  let present = clone(initial);
  return {
    get: () => clone(present),
    commit(next) {
      if (JSON.stringify(next) === JSON.stringify(present)) return false;
      past.push(present);
      if (past.length > limit) past.shift();
      present = clone(next);
      future.length = 0;
      return true;
    },
    undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      return clone(present);
    },
    redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      return clone(present);
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  };
}
