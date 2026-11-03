/**
 * Modo Viewer/VR para gafas tipo Cardboard.
 * Oculta el editor y deja el stage a pantalla completa con dos regiones, una por ojo.
 * El contenido y la calibración no se tocan: solo cambia la presentación.
 * Si el navegador niega pantalla completa u orientación, el modo sigue funcionando dentro de la página.
 */
export function createVR({ app, stage, exitButton, onChange, onTap, notify }) {
  const portrait = window.matchMedia('(orientation: portrait)');
  let active = false;
  let usedFullscreen = false;
  let wakeLock = null;

  function syncOrientation() {
    app.classList.toggle('is-portrait', active && portrait.matches);
  }

  async function enter() {
    if (active) return;
    active = true;
    usedFullscreen = false;
    app.classList.add('is-vr');
    syncOrientation();
    onChange(true);

    const root = document.documentElement;
    try {
      if (root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: 'hide' });
        usedFullscreen = true;
      }
    } catch {
      notify('Pantalla completa no disponible: el visor ocupa la página. Gira el teléfono a horizontal.');
    }
    try {
      if (usedFullscreen && screen.orientation?.lock) await screen.orientation.lock('landscape');
    } catch {
      // El bloqueo de orientación es opcional; el aviso en pantalla cubre el caso vertical.
    }
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
    exitButton.focus({ preventScroll: true });
  }

  async function exit() {
    if (!active) return;
    active = false;
    app.classList.remove('is-vr', 'is-portrait');
    try { screen.orientation?.unlock?.(); } catch { /* opcional */ }
    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { /* ya salió */ }
    }
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    onChange(false);
  }

  exitButton.addEventListener('click', (event) => { event.stopPropagation(); exit(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && active) exit(); });
  // Si el usuario sale de pantalla completa con el gesto del sistema, también sale de VR.
  document.addEventListener('fullscreenchange', () => {
    if (active && usedFullscreen && !document.fullscreenElement) exit();
  });
  portrait.addEventListener('change', syncOrientation);
  // Tocar el visor (fuera del botón Salir) se delega: en video alterna reproducción.
  stage.addEventListener('click', (event) => {
    if (active && event.target !== exitButton) onTap();
  });

  return { enter, exit, isActive: () => active };
}
