/** Linear-light finite pigment film, photo-derived shading, and finish-specific reflection. */
export const MAKEUP_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uBackdrop;
uniform sampler2D uDetail; // R: micro-texture / 2, G: broad linear luminance, B: source luminance
uniform sampler2D uCoverage;
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uIntensity;
uniform float uGloss;
uniform float uRoughness;
uniform float uDetailPower;
uniform float uCoverageScale;
uniform float uOpacity;
uniform float uMean;
uniform float uSparkle;
uniform float uPhotoMask;
uniform float uCaptureLighting;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// Kubelka–Munk finite layer. Exp form avoids overflowing sinh/cosh for dark pigments.
// RGB reflectance is an approximation: calibrated spectral absorption is not available.
vec3 pigmentFilm(vec3 substrate, vec3 pigment, float thickness) {
  vec3 r = clamp(pigment, 0.003, 0.97);
  vec3 a = (r + 1.0 / r) * 0.5;
  vec3 b = (1.0 / r - r) * 0.5;
  vec3 e = exp(-b * thickness);
  vec3 denominator = a * (1.0 - e * e) + b * (1.0 + e * e);
  vec3 reflectance = (1.0 - e * e) / denominator;
  vec3 transmission = 2.0 * b * e / denominator;
  return reflectance + transmission * transmission * substrate / max(vec3(0.001), 1.0 - reflectance * substrate);
}
float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 maskUV = mix(vUv, vec2(screenUv.x, 1.0 - screenUv.y), uPhotoMask);
  vec4 maskSample = texture2D(uCoverage, maskUV);
  float mask = mix(maskSample.r, maskSample.a, uPhotoMask);
  vec3 original = texture2D(uBackdrop, screenUv).rgb;
  float amount = clamp(uIntensity * uOpacity * uCoverageScale, 0.0, 0.999);
  if (mask < 0.001 || amount < 0.00001) { gl_FragColor = vec4(original, 1.0); return; }
  vec3 under = toLinear(original);
  vec3 bands = texture2D(uDetail, screenUv).rgb;
  float detail = clamp(bands.r * 2.0, 0.35, 1.95);
  float relative = bands.g / max(uMean, 0.015);
  // Keep form and lip creases. Matte softens peaks without erasing texture.
  float shade = pow(clamp(relative, 0.25, 2.3), mix(0.78, 1.0, uRoughness));
  shade *= pow(detail, mix(uDetailPower, 1.0, uCaptureLighting));
  // An absolute exposure anchor keeps a dark captured lip from becoming an
  // independently lit red patch. This is an appearance approximation, not
  // recovery of calibrated albedo or illumination from a single photograph.
  shade *= mix(1.0, clamp(sqrt(uMean / 0.18), 0.25, 1.1), uCaptureLighting);
  float thickness = -log(1.0 - amount) * mix(1.6, 0.65, uCaptureLighting);
  vec3 tinted = pigmentFilm(clamp(under / max(shade, 0.08), 0.0, 0.99), toLinear(uColor), thickness) * shade;
  float highlight = smoothstep(0.92, 1.65, bands.b / max(uMean, 0.015));
  highlight = pow(highlight, mix(1.15, 3.0, 1.0 - uRoughness));
  float grain = noise(floor(vUv * 1700.0));
  float sparkles = smoothstep(0.96, 1.0, grain) * smoothstep(0.85, 1.35, relative) * uSparkle;
  tinted += toLinear(uLight) * (highlight * uGloss + sparkles) * sqrt(amount);
  gl_FragColor = vec4(toSRGB(mix(under, tinted, mask)), 1.0);
}
`
