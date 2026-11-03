/**
 * Panel de calibración: construye los controles de cada módulo a partir de un esquema,
 * mantiene los valores vigentes y garantiza que cada indicador muestre el estado real.
 * Los valores solo transforman la vista; nunca se escriben en el archivo.
 */

const STEREO = [
  { key: 'offset', type: 'range', label: 'Desplazamiento horizontal', min: -40, max: 40, step: 1, unit: 'px', value: 0,
    help: 'Positivo separa las vistas (más lejos); negativo las acerca.' },
  { key: 'vertical', type: 'range', label: 'Alineación vertical', min: -30, max: 30, step: 1, unit: 'px', value: 0,
    help: 'Corrige un desnivel entre el ojo izquierdo y el derecho.' },
  { key: 'scale', type: 'range', label: 'Escala', min: 50, max: 200, step: 5, unit: '%', value: 100 },
  { key: 'swap', type: 'toggle', label: 'Intercambiar ojos', value: false },
  { key: 'layout', type: 'select', label: 'Disposición SBS', value: 'full',
    options: [['full', 'Completo (Full SBS)'], ['half', 'Comprimido (Half SBS)']],
    help: 'Se detecta al importar; Half SBS recupera la proporción de cada ojo.' },
];

export const SCHEMAS = Object.freeze({
  anaglyph: [
    { key: 'zoom', type: 'range', label: 'Zoom', min: 50, max: 300, step: 5, unit: '%', value: 100 },
    { key: 'brightness', type: 'range', label: 'Brillo', min: -50, max: 50, step: 1, unit: '%', value: 0 },
    { key: 'contrast', type: 'range', label: 'Contraste', min: 50, max: 150, step: 1, unit: '%', value: 100 },
  ],
  sbs: STEREO,
  video: STEREO,
});

function formatValue(field, value) {
  if (field.type === 'range') return `${value > 0 && field.min < 0 ? '+' : ''}${value} ${field.unit}`;
  return '';
}

export function createCalibration(container, { onChange }) {
  let schema = [];
  let defaults = {};
  let values = {};
  const inputs = new Map();

  function emit() { onChange({ ...values }); }

  function build(moduleId, overrides = {}) {
    container.replaceChildren();
    inputs.clear();
    schema = SCHEMAS[moduleId] ?? [];
    defaults = Object.fromEntries(schema.map((f) => [f.key, overrides[f.key] ?? f.value]));
    values = { ...defaults };

    for (const field of schema) {
      const id = `cal-${field.key}`;
      const row = document.createElement('div');
      row.className = `field field--${field.type}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = field.label;
      let input;

      if (field.type === 'range') {
        input = Object.assign(document.createElement('input'), { type: 'range', id, className: 'range', min: field.min, max: field.max, step: field.step });
        const output = document.createElement('output');
        output.htmlFor = id;
        row.append(label, output, input);
        input.addEventListener('input', () => { values[field.key] = Number(input.value); sync(field.key); emit(); });
      } else if (field.type === 'toggle') {
        input = Object.assign(document.createElement('input'), { type: 'checkbox', id, className: 'switch' });
        input.setAttribute('role', 'switch');
        row.append(input, label);
        input.addEventListener('change', () => { values[field.key] = input.checked; emit(); });
      } else {
        input = Object.assign(document.createElement('select'), { id, className: 'select' });
        for (const [value, text] of field.options) input.append(new Option(text, value));
        row.append(label, input);
        input.addEventListener('change', () => { values[field.key] = input.value; emit(); });
      }

      if (field.help) {
        const help = document.createElement('p');
        help.className = 'field__help';
        help.id = `${id}-help`;
        help.textContent = field.help;
        input.setAttribute('aria-describedby', help.id);
        row.append(help);
      }
      inputs.set(field.key, { field, input, output: row.querySelector('output') });
      container.append(row);
    }
    schema.forEach((f) => sync(f.key));
  }

  /** Lleva el valor vigente al control y a su indicador numérico. */
  function sync(key) {
    const entry = inputs.get(key);
    if (!entry) return;
    const { field, input, output } = entry;
    const value = values[key];
    if (field.type === 'toggle') input.checked = value;
    else input.value = String(value);
    if (output) output.textContent = formatValue(field, value);
    if (field.type === 'range') input.setAttribute('aria-valuetext', formatValue(field, value));
  }

  return {
    /** Construye los controles del módulo con sus valores iniciales (RN-08). */
    setModule(moduleId, overrides) { build(moduleId, overrides); },
    /** Vuelve a los valores iniciales del módulo y del archivo (RN-10). */
    reset() {
      values = { ...defaults };
      schema.forEach((f) => sync(f.key));
      emit();
    },
    setEnabled(enabled) { inputs.forEach(({ input }) => { input.disabled = !enabled; }); },
    values: () => ({ ...values }),
    describe() {
      return schema.map((f) => ({ control: f.label, valor: f.type === 'range' ? `${values[f.key]} ${f.unit}` : values[f.key] }));
    },
  };
}
