#include <metal_stdlib>
using namespace metal;

struct MeshVertex {
    float2 position;  // clip space
    float2 uv;        // canonical face atlas
};

struct Varyings {
    float4 position [[position]];
    float2 uv;
};

struct BlendUniforms {
    float4 colorIntensity;
    float4 material; // gloss, roughness, detail, coverage
    float4 settings; // opacity, regional mean, sparkle, photo-space mask
    float4 light;
    float4 surface;
};

constant float3 LUMA = float3(0.2126, 0.7152, 0.0722);

// Full-screen triangle, generated from the vertex id so no buffer is needed.
vertex Varyings quad_vertex(uint id [[vertex_id]]) {
    float2 positions[3] = { float2(-1, -3), float2(-1, 1), float2(3, 1) };
    Varyings out;
    out.position = float4(positions[id], 0, 1);
    out.uv = positions[id] * float2(0.5, -0.5) + 0.5;
    return out;
}

fragment float4 copy_fragment(Varyings in [[stage_in]],
                              texture2d<float> source [[texture(0)]]) {
    constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
    return source.sample(linearSampler, in.uv);
}

vertex Varyings mesh_vertex(uint id [[vertex_id]],
                            constant MeshVertex *vertices [[buffer(0)]]) {
    Varyings out;
    out.position = float4(vertices[id].position, 0, 1);
    out.uv = vertices[id].uv;
    return out;
}

float3 toLinear(float3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, float3(2.4)), step(0.04045, c));
}
float3 toSRGB(float3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, float3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// Kubelka–Munk finite layer. Exp form avoids overflowing sinh/cosh for dark pigments.
// RGB reflectance is an approximation: calibrated spectral absorption is not available.
float3 pigmentFilm(float3 substrate, float3 pigment, float thickness) {
  float3 r = clamp(pigment, 0.003, 0.97);
  float3 a = (r + 1.0 / r) * 0.5;
  float3 b = (1.0 / r - r) * 0.5;
  float3 e = exp(-b * thickness);
  float3 denominator = a * (1.0 - e * e) + b * (1.0 + e * e);
  float3 reflectance = (1.0 - e * e) / denominator;
  float3 transmission = 2.0 * b * e / denominator;
  return reflectance + transmission * transmission * substrate / max(float3(0.001), 1.0 - reflectance * substrate);
}
float noise(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }
fragment float4 makeup_fragment(Varyings in [[stage_in]],
    texture2d<float> backdrop [[texture(0)]], texture2d<float> coverage [[texture(1)]],
    texture2d<float> detailMap [[texture(2)]], constant BlendUniforms &uniforms [[buffer(0)]]) {
    constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
  float2 screenUv = in.position.xy / float2(backdrop.get_width(), backdrop.get_height());
  float2 maskUV = mix(in.uv, screenUv, uniforms.settings.w);
  float mask = coverage.sample(linearSampler, maskUV).r;
  float3 original = backdrop.sample(linearSampler, screenUv).rgb;
  float amount = clamp(uniforms.colorIntensity.w * uniforms.settings.x * uniforms.material.w, 0.0, 0.999);
  if (mask < 0.001 || amount < 0.00001) { return float4(original, 1.0); }
  float3 under = toLinear(original);
  float3 bands = detailMap.sample(linearSampler, screenUv).rgb;
  float detail = clamp(bands.r * 2.0, 0.35, 1.95);
  float relative = bands.g / max(uniforms.settings.y, 0.015);
  // Keep form and lip creases. Matte softens peaks without erasing texture.
  float shade = pow(clamp(relative, 0.25, 2.3), mix(0.78, 1.0, uniforms.material.y));
  shade *= pow(detail, mix(uniforms.material.z, 1.0f, uniforms.surface.x));
  shade *= mix(1.0f, clamp(sqrt(uniforms.settings.y / 0.18f), 0.25f, 1.1f), uniforms.surface.x);
  float thickness = -log(1.0 - amount) * mix(1.6f, 0.65f, uniforms.surface.x);
  float3 tinted = pigmentFilm(clamp(under / max(shade, 0.08), 0.0, 0.99), toLinear(uniforms.colorIntensity.xyz), thickness) * shade;
  float highlight = smoothstep(0.92, 1.65, bands.b / max(uniforms.settings.y, 0.015));
  highlight = pow(highlight, mix(1.15, 3.0, 1.0 - uniforms.material.y));
  float grain = noise(floor(in.uv * 1700.0));
  float sparkles = smoothstep(0.96, 1.0, grain) * smoothstep(0.85, 1.35, relative) * uniforms.settings.z;
  tinted += toLinear(uniforms.light.xyz) * (highlight * uniforms.material.x + sparkles) * sqrt(amount);
  return float4(toSRGB(mix(under, tinted, mask)), 1.0);
}

float luminanceAt(texture2d<float> source, float2 uv) {
    constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
    return dot(toLinear(source.sample(linearSampler, uv).rgb), LUMA);
}
fragment float4 detail_fragment(Varyings in [[stage_in]], texture2d<float> source [[texture(0)]], constant float &radius [[buffer(0)]]) {
    float2 texel = radius / float2(source.get_width(), source.get_height());
    float2 offsets[9] = { float2(-4,-4), float2(4,-4), float2(-4,4), float2(4,4), float2(-6,0), float2(6,0), float2(0,-6), float2(0,6), float2(0,0) };
    float blurred = 0;
    for (uint i = 0; i < 9; ++i) blurred += luminanceAt(source, in.uv + offsets[i] * texel);
    blurred /= 9.0;
    float here = luminanceAt(source, in.uv);
    return float4(clamp(here / max(blurred, 0.001), 0.35, 1.95) * 0.5, blurred, here, 1.0);
}
