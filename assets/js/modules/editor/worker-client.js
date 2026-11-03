/**
 * Cliente del Web Worker de procesamiento: cada llamada devuelve una promesa.
 * Los búferes grandes se transfieren (no se copian) para no duplicar memoria.
 */
export function createWorkerClient() {
  const worker = new Worker(new URL('../../workers/stereo-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;

  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.result);
  };
  worker.onerror = (event) => {
    pending.forEach((job) => job.reject(new Error(event.message || 'Error en el worker')));
    pending.clear();
  };

  return {
    run(type, payload, transfer = []) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, payload }, transfer);
      });
    },
  };
}
