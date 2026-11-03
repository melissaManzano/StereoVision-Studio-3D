import * as THREE from 'three';
import { createStereoPair } from './sbs.js';

const SKIP_SECONDS = 10;

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = h ? String(m % 60).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Video SBS: un único <video> alimenta una VideoTexture compartida por los dos ojos,
 * por lo que ambas perspectivas avanzan, se pausan y se buscan juntas.
 * Los controles de transporte se enlazan aquí y se desenlazan al liberar el video.
 *
 * @param {object} ui  elementos del transporte: play, back, fwd, seek, current, total, mute, volume
 * @param {{ onStatus: Function, onError: Function }} hooks
 */
export function createVideoView(stage, media, ui, hooks) {
  const video = media.element;
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // VideoTexture solo sube fotogramas nuevos durante la reproducción; el primero se fuerza
  // para que el video listo (en pausa) ya muestre su imagen en ambos ojos.
  texture.needsUpdate = true;
  const pair = createStereoPair(stage, texture, media.width, media.height);

  const listeners = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: listeners.signal });
  let scrubbing = false;

  function syncTime() {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    ui.seek.max = String(duration);
    if (!scrubbing) ui.seek.value = String(video.currentTime);
    ui.current.textContent = formatTime(video.currentTime);
    ui.total.textContent = formatTime(duration);
    ui.seek.style.setProperty('--progress', duration ? `${(video.currentTime / duration) * 100}%` : '0%');
  }

  function syncPlaying() {
    const playing = !video.paused && !video.ended;
    ui.play.dataset.playing = String(playing);
    ui.play.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    stage.setAnimating(playing);
    hooks.onStatus(playing ? 'playing' : 'paused');
  }

  function syncVolume() {
    ui.mute.setAttribute('aria-pressed', String(video.muted));
    ui.mute.setAttribute('aria-label', video.muted ? 'Activar sonido' : 'Silenciar');
    ui.volume.value = String(Math.round(video.volume * 100));
  }

  async function play() {
    try {
      await video.play(); // siempre por acción explícita del usuario
    } catch (err) {
      if (err?.name === 'AbortError') return; // se sustituyó el archivo durante la petición
      hooks.onError(
        'El navegador no permitió reproducir',
        err?.name === 'NotAllowedError'
          ? 'Toca Reproducir de nuevo; los navegadores móviles exigen una interacción directa.'
          : 'El video no pudo iniciar. Prueba otra vez o importa otro MP4.',
      );
      syncPlaying();
    }
  }

  function toggle() {
    if (video.paused || video.ended) play();
    else video.pause();
  }

  function seekTo(t) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = Math.min(Math.max(0, t), duration);
    syncTime();
  }

  on(ui.play, 'click', toggle);
  on(ui.back, 'click', () => seekTo(video.currentTime - SKIP_SECONDS));
  on(ui.fwd, 'click', () => seekTo(video.currentTime + SKIP_SECONDS));
  on(ui.seek, 'pointerdown', () => { scrubbing = true; });
  on(ui.seek, 'input', () => { video.currentTime = Number(ui.seek.value); ui.current.textContent = formatTime(video.currentTime); });
  on(ui.seek, 'change', () => { scrubbing = false; syncTime(); });
  on(ui.mute, 'click', () => { video.muted = !video.muted; });
  on(ui.volume, 'input', () => {
    video.volume = Number(ui.volume.value) / 100;
    if (video.volume > 0 && video.muted) video.muted = false;
  });

  on(video, 'play', syncPlaying);
  on(video, 'pause', syncPlaying);
  on(video, 'ended', syncPlaying);
  on(video, 'timeupdate', syncTime);
  on(video, 'durationchange', syncTime);
  on(video, 'volumechange', syncVolume);
  // En pausa, una búsqueda debe redibujar el fotograma nuevo en ambos ojos.
  on(video, 'seeked', () => { texture.needsUpdate = true; stage.requestRender(); syncTime(); });
  on(video, 'error', () => {
    hooks.onError('Error durante la reproducción', 'El video se interrumpió. Puedes reintentar o importar otro archivo.');
    syncPlaying();
  });
  // No dejar el video sonando si la pestaña pasa a segundo plano.
  on(document, 'visibilitychange', () => { if (document.hidden) video.pause(); });

  [ui.play, ui.back, ui.fwd, ui.seek, ui.mute, ui.volume].forEach((el) => { el.disabled = false; });
  syncTime();
  syncVolume();
  ui.play.dataset.playing = 'false';
  stage.requestRender();

  return {
    update: pair.update,
    toggle,
    pause() { video.pause(); },
    dispose() {
      listeners.abort();
      video.pause();
      stage.setAnimating(false);
      pair.dispose();
      texture.dispose();
      [ui.play, ui.back, ui.fwd, ui.seek, ui.mute, ui.volume].forEach((el) => { el.disabled = true; });
      ui.play.dataset.playing = 'false';
      ui.seek.value = '0';
      ui.seek.max = '0';
      ui.current.textContent = '0:00';
      ui.total.textContent = '0:00';
    },
  };
}
