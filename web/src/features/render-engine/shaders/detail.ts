/**
 * Extracts the photo's micro-texture as a ratio against its own blurred self.
 *
 * Stored once per photo and reapplied multiplicatively by every makeup layer,
 * which is what lets pigment sit on skin without erasing pores and lip lines —
 * the ratio form from Petschnigg et al., SIGGRAPH 2004. A ratio rather than a
 * difference so it survives being multiplied into a recoloured base of any
 * brightness.
 */
export const DETAIL_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uSource;
uniform vec2 uTexel;
// The photo arrives as an ImageBitmap, which three cannot flip, so this pass
// has to apply the same correction the presentation pass does — otherwise the
// detail layer is upside down and the lips borrow the forehead's texture.
uniform float uFlipY;
uniform float uDetailRadius;
varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luminanceAt(vec2 offset) {
  vec2 uv = vUv + offset * uTexel * uDetailRadius;
  uv.y = mix(uv.y, 1.0 - uv.y, uFlipY);
  vec3 c = texture2D(uSource, uv).rgb;
  vec3 linear = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  return dot(linear, LUMA);
}

void main() {
  // Separable-ish 9-tap blur, wide enough to separate texture from shading
  // without a second pass.
  float blurred = 0.0;
  blurred += luminanceAt(vec2(-4.0, -4.0)) + luminanceAt(vec2(4.0, -4.0));
  blurred += luminanceAt(vec2(-4.0, 4.0)) + luminanceAt(vec2(4.0, 4.0));
  blurred += luminanceAt(vec2(-6.0, 0.0)) + luminanceAt(vec2(6.0, 0.0));
  blurred += luminanceAt(vec2(0.0, -6.0)) + luminanceAt(vec2(0.0, 6.0));
  blurred += luminanceAt(vec2(0.0, 0.0));
  blurred /= 9.0;

  float here = luminanceAt(vec2(0.0));
  // R: ratio encoded at half scale so ratios > 1 survive RGBA8. A dark pixel beside a bright one
  // cannot blow it up. G: the broad shading it was divided out of, which a
  // later pass downsamples into a local average.
  gl_FragColor = vec4(clamp(here / max(blurred, 0.001), 0.35, 1.95) * 0.5, blurred, here, 1.0);
}
`
