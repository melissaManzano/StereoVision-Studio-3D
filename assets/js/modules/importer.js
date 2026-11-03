/**
 * Importación local: valida formato, comprueba que el archivo se pueda decodificar
 * y entrega un objeto "media" con su función release(). Ningún archivo sale del navegador.
 */

export const FORMATS = Object.freeze({
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], ext: /\.(jpe?g|png|webp)$/i, label: 'JPG, PNG o WebP', accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp' },
  video: { mimes: ['video/mp4'], ext: /\.(mp4|m4v)$/i, label: 'MP4 (H.264)', accept: '.mp4,.m4v,video/mp4' },
});

const VIDEO_TIMEOUT_MS = 20000;

/** Error con mensaje para el usuario: qué ocurrió y cómo continuar. */
export class ImportError extends Error {
  constructor(title, detail) {
    super(title);
    this.title = title;
    this.detail = detail;
  }
}

function kindOf(file) {
  for (const [kind, f] of Object.entries(FORMATS)) {
    if (f.mimes.includes(file.type) || f.ext.test(file.name)) return kind;
  }
  if (file.type.startsWith('image/')) return 'image-unsupported';
  if (file.type.startsWith('video/')) return 'video-unsupported';
  return 'unknown';
}

function formatName(file) {
  const ext = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : '';
  return file.type ? `${ext || '?'} (${file.type})` : ext || 'desconocido';
}

/**
 * @param {File} file
 * @param {{ id: string, label: string, kind: 'image'|'video' }} module
 */
export async function importFile(file, module) {
  const expected = FORMATS[module.kind];
  const kind = kindOf(file);

  if (kind === 'unknown' || kind.endsWith('-unsupported')) {
    throw new ImportError(
      `Formato no admitido: ${file.name}`,
      `${module.label} acepta ${expected.label}. Convierte el archivo o elige otro.`,
    );
  }
  if (kind !== module.kind) {
    const other = kind === 'video' ? 'Video SBS' : 'Anaglifo o Imagen SBS';
    throw new ImportError(
      `${file.name} no corresponde al módulo ${module.label}`,
      `Es ${kind === 'video' ? 'un video' : 'una imagen'}. Cámbiate a ${other} o elige un archivo ${expected.label}.`,
    );
  }
  if (file.size === 0) {
    throw new ImportError(`${file.name} está vacío`, 'El archivo tiene 0 bytes. Elige otro archivo.');
  }

  const base = { name: file.name, type: formatName(file), size: file.size };
  return kind === 'image' ? { ...base, ...(await decodeImage(file)) } : { ...base, ...(await decodeVideo(file)) };
}

async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImportError(
      `No se pudo decodificar ${file.name}`,
      'El archivo está dañado o su extensión no coincide con su contenido. Prueba con otra imagen.',
    );
  }
  if (image.naturalWidth < 2 || image.naturalHeight < 2) {
    URL.revokeObjectURL(url);
    throw new ImportError(`${file.name} es demasiado pequeña`, 'La imagen necesita al menos 2 × 2 píxeles.');
  }
  return {
    kind: 'image',
    element: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release() {
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    },
  };
}

async function decodeVideo(file) {
  const probe = document.createElement('video');
  if (!probe.canPlayType('video/mp4')) {
    throw new ImportError('Este navegador no reproduce MP4', 'Abre el Studio en Chrome, Edge, Safari o Firefox actualizados.');
  }

  const url = URL.createObjectURL(file);
  const video = probe;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.loop = false;
  video.volume = 0.8;
  // El elemento vive en el documento (fuera de vista) para que iOS lo reproduzca en línea.
  video.className = 'visually-hidden';
  video.setAttribute('aria-hidden', 'true');
  document.body.append(video);

  const release = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), VIDEO_TIMEOUT_MS);
      video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timer); reject(video.error); }, { once: true });
      video.src = url;
      video.load();
    });
  } catch (err) {
    release();
    const timeout = err?.message === 'timeout';
    throw new ImportError(
      timeout ? `${file.name} tardó demasiado en prepararse` : `No se pudo decodificar ${file.name}`,
      timeout
        ? 'El navegador no terminó de leer el video. Prueba con un MP4 más ligero.'
        : 'El navegador no admite el códec de este MP4 o el archivo está dañado. Usa MP4 con video H.264 y audio AAC.',
    );
  }

  if (!video.videoWidth || !video.videoHeight) {
    release();
    throw new ImportError(`${file.name} no tiene imagen`, 'El MP4 solo contiene audio. Elige un video SBS.');
  }

  return {
    kind: 'video',
    element: video,
    width: video.videoWidth,
    height: video.videoHeight,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    release,
  };
}

/** Descarga una muestra incluida en el sitio y la convierte en File, para que pase por la misma validación. */
export async function fetchSample(path) {
  const res = await fetch(path);
  if (!res.ok) throw new ImportError('No se encontró la muestra', `El servidor respondió ${res.status}. Importa un archivo propio.`);
  const blob = await res.blob();
  return new File([blob], decodeURIComponent(path.split('/').pop()), { type: blob.type });
}
