/**
 * Matte pigment. Keeps the photograph's own shading (its luminance structure)
 * and replaces the colour underneath it, which is what an opaque matte product
 * actually does — a flat colour fill reads as a sticker instead.
 *
 * Because the photo already records the real light and the real shape of the
 * face, preserving its luminance is what makes the colour sit *on* the face
 * rather than float above it. No synthetic lighting is involved.
 *
 * Every finish shader shares this signature so the compositor can swap them per
 * layer: uBackdrop is everything rendered below, uCoverage is a canonical
 * UV-space mask (a region fill, or the user's brush strokes).
 */
export const MATTE_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uBackdrop;
uniform sampler2D uCoverage;
// Straight 0..1 sRGB components, matching the product's hex code.
uniform vec3 uColor;
uniform float uIntensity;
uniform vec2 uResolution;

varying vec2 vUv;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  // The mesh covers only the face, so the backdrop is sampled by screen
  // position rather than by the mesh's own texture coordinates.
  vec2 screen = gl_FragCoord.xy / uResolution;
  vec4 backdrop = texture2D(uBackdrop, screen);

  float coverage = texture2D(uCoverage, vUv).a * uIntensity;

  // Transfer the photo's shading onto the product colour by the *ratio* of their
  // luminances. Where the skin or lip is exactly as bright as the pigment the
  // result is the pigment itself; folds and highlights scale it up and down from
  // there, so texture survives without the colour drifting dark.
  float luminance = dot(backdrop.rgb, LUMA);
  float pigmentLuma = max(dot(uColor, LUMA), 0.04);
  float shading = clamp(luminance / pigmentLuma, 0.65, 1.5);
  vec3 pigment = clamp(uColor * shading, 0.0, 1.0);

  gl_FragColor = vec4(mix(backdrop.rgb, pigment, coverage), 1.0);
}
`

/** Draws the face mesh in clip space; positions already arrive as NDC. */
export const MESH_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Presents a full-screen texture, used for the base photo and the final copy.
 *
 * uFlipY exists because three cannot apply `flipY` to an ImageBitmap — it is
 * silently ignored — so the photo arrives upside down while render targets do
 * not. Flipping here keeps one shader for both.
 */
export const COPY_FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uSource;
uniform float uFlipY;
varying vec2 vUv;

void main() {
  vec2 uv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, uFlipY));
  gl_FragColor = texture2D(uSource, uv);
}
`

export const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
