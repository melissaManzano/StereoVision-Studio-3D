import * as THREE from 'three';
import { fitHeight } from './stage.js';

/**
 * Visor anaglifo rojo-cian: la imagen ya contiene los dos canales,
 * así que se muestra completa en una sola vista. Zoom, brillo y contraste
 * se resuelven en un shader: el archivo original nunca se modifica.
 */
const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// La textura se lee sin conversión de espacio de color (NoColorSpace): el ajuste
// opera sobre los valores sRGB tal como los ve el usuario y se escribe sin reconvertir.
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float brightness;
  uniform float contrast;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    vec3 rgb = (c.rgb - 0.5) * contrast + 0.5 + brightness;
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
  }
`;

export function createAnaglyphView(stage, media) {
  const texture = new THREE.Texture(media.element);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, brightness: { value: 0 }, contrast: { value: 1 } },
    vertexShader,
    fragmentShader,
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  stage.scenes.left.add(mesh);
  stage.setMode('single');

  const imageAspect = media.width / media.height;
  let params = { zoom: 100, brightness: 0, contrast: 100 };

  function layout() {
    const { width, height } = stage.eyeSize();
    if (!width || !height) return;
    const h = fitHeight(width / height, imageAspect) * (params.zoom / 100);
    mesh.scale.set(h * imageAspect, h, 1);
    stage.requestRender();
  }

  const offResize = stage.onResize(layout);

  return {
    update(next) {
      params = next;
      material.uniforms.brightness.value = params.brightness / 100;
      material.uniforms.contrast.value = params.contrast / 100;
      layout();
    },
    dispose() {
      offResize();
      stage.scenes.left.remove(mesh);
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
