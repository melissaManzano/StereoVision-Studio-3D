/**
 * Predistorsión de lente para visores tipo Cardboard.
 * Las lentes del visor amplían la imagen con distorsión de cojín (los bordes se estiran).
 * Para que se vea recta, cada vista se dibuja antes con la distorsión contraria, de barril,
 * con el modelo radial de Brown:  p_origen = p · (1 + k1·r² + k2·r⁴),
 * donde p es la posición respecto al centro de la lente y r su distancia normalizada
 * (r = 1 en el borde del lado mayor de la región del ojo). Los coeficientes de referencia
 * son los del Google Cardboard (k1 = 0,441; k2 = 0,156); la intensidad los escala.
 * La corrección cromática muestrea rojo y azul con un radio ligeramente distinto, porque
 * la lente desvía menos el rojo que el azul.
 */
export const CARDBOARD_K = Object.freeze([0.441, 0.156]);
const CHROMA = 0.006;

/** Coeficientes [k1, k2] para una intensidad en % (100 = Cardboard). */
export function lensCoefficients(strength) {
  const s = strength / 100;
  return [CARDBOARD_K[0] * s, CARDBOARD_K[1] * s];
}

/** Funciones GLSL compartidas por el visor (stage.js) y la exportación del editor (pipeline.js). */
export const LENS_GLSL = /* glsl */ `
  uniform vec2 lensK;
  uniform float lensChroma;

  vec2 lensDistort(vec2 uv, float aspect) {
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= aspect;
    float n = max(aspect, 1.0);
    p /= n;
    float r2 = dot(p, p);
    p *= 1.0 + lensK.x * r2 + lensK.y * r2 * r2;
    p *= n;
    p.x /= aspect;
    return p * 0.5 + 0.5;
  }

  vec3 lensTap(sampler2D tex, vec2 uv) {
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
    return texture2D(tex, uv).rgb;
  }

  vec3 lensSample(sampler2D tex, vec2 uv, float aspect) {
    vec2 g = lensDistort(uv, aspect);
    if (lensChroma < 0.5) return lensTap(tex, g);
    return vec3(
      lensTap(tex, 0.5 + (g - 0.5) * ${(1 - CHROMA).toFixed(3)}).r,
      lensTap(tex, g).g,
      lensTap(tex, 0.5 + (g - 0.5) * ${(1 + CHROMA).toFixed(3)}).b
    );
  }
`;
