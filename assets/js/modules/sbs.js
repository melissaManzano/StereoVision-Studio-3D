import * as THREE from 'three';
import { fitHeight, halfGeometry } from './stage.js';

/** Proporción a partir de la cual un SBS se considera completo (dos imágenes de ancho real). */
const FULL_SBS_MIN_ASPECT = 2.4;

/** Full-SBS (p. ej. 3840×1080) o Half-SBS (p. ej. 1920×1080, cada mitad comprimida). */
export function detectLayout(width, height) {
  return width / height >= FULL_SBS_MIN_ASPECT ? 'full' : 'half';
}

/**
 * Par estereoscópico: dos planos que comparten UNA textura y recortan su mitad por UV.
 * Se dibujan en las escenas izquierda y derecha del stage. Compartir la textura
 * garantiza que en video ambos ojos muestran exactamente el mismo fotograma.
 */
export function createStereoPair(stage, texture, sourceWidth, sourceHeight) {
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometries = { left: halfGeometry('left', sourceWidth), right: halfGeometry('right', sourceWidth) };
  const meshLeft = new THREE.Mesh(geometries.left, material);
  const meshRight = new THREE.Mesh(geometries.right, material);
  stage.scenes.left.add(meshLeft);
  stage.scenes.right.add(meshRight);
  stage.setMode('split');

  let params = { offset: 0, vertical: 0, scale: 100, swap: false, layout: detectLayout(sourceWidth, sourceHeight) };

  function layout() {
    const { width, height } = stage.eyeSize();
    if (!width || !height) return;
    // Proporción de UNA vista: en Half-SBS cada mitad se estira al doble de ancho.
    const eyeAspect = params.layout === 'half' ? sourceWidth / sourceHeight : sourceWidth / 2 / sourceHeight;
    const h = fitHeight(width / height, eyeAspect) * (params.scale / 100);
    const px = 2 / height; // 1 px CSS en unidades de la cámara ortográfica

    meshLeft.scale.set(h * eyeAspect, h, 1);
    meshRight.scale.set(h * eyeAspect, h, 1);
    // Desplazamiento relativo: cada ojo se mueve la mitad en sentidos opuestos.
    meshLeft.position.set((-params.offset / 2) * px, (params.vertical / 2) * px, 0);
    meshRight.position.set((params.offset / 2) * px, (-params.vertical / 2) * px, 0);
    // Intercambiar ojos reasigna las perspectivas, no solo la etiqueta.
    meshLeft.geometry = params.swap ? geometries.right : geometries.left;
    meshRight.geometry = params.swap ? geometries.left : geometries.right;
    stage.requestRender();
  }

  const offResize = stage.onResize(layout);
  layout();

  return {
    update(next) { params = next; layout(); },
    dispose() {
      offResize();
      stage.scenes.left.remove(meshLeft);
      stage.scenes.right.remove(meshRight);
      geometries.left.dispose();
      geometries.right.dispose();
      material.dispose();
    },
  };
}

/** Imagen SBS: textura estática + par estereoscópico. */
export function createSbsImageView(stage, media) {
  const texture = new THREE.Texture(media.element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const pair = createStereoPair(stage, texture, media.width, media.height);

  return {
    update: pair.update,
    dispose() {
      pair.dispose();
      texture.dispose();
    },
  };
}
