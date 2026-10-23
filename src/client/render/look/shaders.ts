import { LOOK } from './palette';
import { COAST_RANGE } from './terrainLook';
import { EDGE_MAX, WATER_OWNER } from './territoryField';

/** `color` (0xRRGGBB) as a GLSL vec3 literal. */
export function glslColor(color: number): string {
  const ch = (shift: number): string => (((color >> shift) & 0xff) / 255).toFixed(3);
  return `vec3(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** One triangle that covers the whole screen, drawn from gl_VertexID alone. */
export const MAP_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * The map pass, with the palette and limits written in: terrain and water, then each nation's land as tinted glass with
 * a glow inside its borders, a bright line where land changes owner (thicker and pulsing on a front), the shimmer of
 * fresh captures, and the grey fade.
 */
export function mapFragment(): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

uniform vec2 uMap;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uViewH;
uniform float uTime;
uniform float uGrey;
uniform sampler2D uCoast;
uniform sampler2D uShade;
uniform sampler2D uBiome;
uniform usampler2D uOwner;
uniform sampler2D uEdge;
uniform sampler2D uCaptured;
uniform sampler2D uPalette;
uniform usampler2D uFronts;

out vec4 outColor;

const float COAST_RANGE = ${COAST_RANGE.toFixed(1)};
const float EDGE_MAX = ${EDGE_MAX.toFixed(1)};
const uint WATER_OWNER = ${WATER_OWNER}u;
const vec3 DEEP = ${glslColor(LOOK.deepWater)};
const vec3 SHALLOW = ${glslColor(LOOK.shallowWater)};
const vec3 WATER = ${glslColor(LOOK.water)};
const vec3 SAND = ${glslColor(LOOK.sand)};
const vec3 PLAINS = ${glslColor(LOOK.plains)};
const vec3 HILLS = ${glslColor(LOOK.hills)};
const vec3 MOUNTAINS = ${glslColor(LOOK.mountains)};
const vec3 FOREST = ${glslColor(LOOK.forest)};
const vec3 DRY = ${glslColor(LOOK.dry)};
const vec3 SNOW = ${glslColor(LOOK.snow)};

// Water: deep far out, shallow near the shore, with a slow broad swell everywhere and fine ripples once zoomed in.
vec3 water(vec2 p, float s) {
  float depth = clamp(-s / 6.0, 0.0, 1.0);
  vec3 col = mix(SHALLOW, DEEP, depth);
  float swell = sin(dot(p, vec2(0.11, 0.05)) + uTime * 0.35) * sin(dot(p, vec2(-0.04, 0.14)) - uTime * 0.28);
  float ripple = 0.5 * (sin(dot(p, vec2(0.7, 0.4)) + uTime * 0.9) + sin(dot(p, vec2(-0.3, 0.8)) - uTime * 0.7));
  float fine = smoothstep(4.0, 10.0, uZoom);
  return col + (0.025 * swell + 0.03 * ripple * fine) * (0.4 + 0.6 * depth);
}

// A crisp, smooth-edged patch where v crosses the level at, anti-aliased to about a pixel at any zoom.
float crisp(float v, float at) {
  float aa = max(fwidth(v), 0.01);
  return smoothstep(at - aa, at + aa, v);
}

// Land: rock and dryness blended smoothly between tiles, forest and snow as crisp patches, lit by the hill shade,
// sand along the shore.
vec3 ground(vec2 uv, float s) {
  vec4 b = texture(uBiome, uv);
  vec3 col = mix(PLAINS, HILLS, smoothstep(0.0, 0.5, b.a));
  col = mix(col, MOUNTAINS, smoothstep(0.5, 1.0, b.a));
  col = mix(col, DRY, b.g * (1.0 - 0.6 * b.a));
  col = mix(col, mix(FOREST, FOREST * 0.82, smoothstep(0.6, 1.0, b.r)), crisp(b.r, 0.3));
  col = mix(col, SNOW, crisp(b.b, 0.5));
  col *= 0.75 + 0.5 * texture(uShade, uv).r;
  float beach = 1.0 - smoothstep(0.3, 0.55, s);
  return mix(col, SAND, 0.85 * beach * (1.0 - b.b));
}

uint ownerAt(ivec2 c) {
  return texelFetch(uOwner, clamp(c, ivec2(0), ivec2(uMap) - 1), 0).r;
}

bool isNation(uint o) {
  return o != 0u && o != WATER_OWNER;
}

vec3 nationColor(uint o) {
  return texelFetch(uPalette, ivec2(int(o), 0), 0).rgb;
}

// How brightly tile c still shimmers from its last change of owner: 1 just after, 0 from a second on.
float captureGlow(ivec2 c) {
  float age = uTime - texelFetch(uCaptured, clamp(c, ivec2(0), ivec2(uMap) - 1), 0).r;
  return age >= 0.0 && age < 1.0 ? 1.0 - age : 0.0;
}

// Whether either of the two nations is attacking the other right now.
bool atWar(uint a, uint b) {
  if (!isNation(a) || !isNation(b) || a >= 64u || b >= 64u) return false;
  return texelFetch(uFronts, ivec2(int(b), int(a)), 0).r + texelFetch(uFronts, ivec2(int(a), int(b)), 0).r > 0u;
}

void main() {
  vec2 p = uCamera + vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y) / uZoom;
  vec2 uv = p / uMap;
  float s = texture(uCoast, uv).r * (2.0 * COAST_RANGE) - COAST_RANGE;
  float aa = max(fwidth(s) * 0.75, 0.02);
  float land = smoothstep(-aa, aa, s);
  vec3 col = mix(water(p, s), ground(uv, s), land);

  // the owner here: of the four tiles around p, the one whose bilinear weights add up to the most; the gap to the
  // runner-up is 0 on the boundary between them, which gives smooth borders at any zoom
  vec2 q = p - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = q - vec2(i0);
  uint o0 = ownerAt(i0);
  uint o1 = ownerAt(i0 + ivec2(1, 0));
  uint o2 = ownerAt(i0 + ivec2(0, 1));
  uint o3 = ownerAt(i0 + ivec2(1, 1));
  float w0 = (1.0 - f.x) * (1.0 - f.y);
  float w1 = f.x * (1.0 - f.y);
  float w2 = (1.0 - f.x) * f.y;
  float w3 = f.x * f.y;
  float s0 = w0 + (o1 == o0 ? w1 : 0.0) + (o2 == o0 ? w2 : 0.0) + (o3 == o0 ? w3 : 0.0);
  float s1 = w1 + (o0 == o1 ? w0 : 0.0) + (o2 == o1 ? w2 : 0.0) + (o3 == o1 ? w3 : 0.0);
  float s2 = w2 + (o0 == o2 ? w0 : 0.0) + (o1 == o2 ? w1 : 0.0) + (o3 == o2 ? w3 : 0.0);
  float s3 = w3 + (o0 == o3 ? w0 : 0.0) + (o1 == o3 ? w1 : 0.0) + (o2 == o3 ? w2 : 0.0);
  uint a = o0;
  float wa = s0;
  if (s1 > wa) { a = o1; wa = s1; }
  if (s2 > wa) { a = o2; wa = s2; }
  if (s3 > wa) { a = o3; wa = s3; }
  uint b = a;
  float wb = 0.0;
  if (o0 != a && s0 > wb) { b = o0; wb = s0; }
  if (o1 != a && s1 > wb) { b = o1; wb = s1; }
  if (o2 != a && s2 > wb) { b = o2; wb = s2; }
  if (o3 != a && s3 > wb) { b = o3; wb = s3; }
  float gap = wa - wb;
  float px = gap / max(fwidth(gap), 1e-4);
  uint owner = a == WATER_OWNER ? b : a;

  if (isNation(owner)) {
    // a light, soft version of the nation colour, so the land stays land (a blue nation over forest is not sea)
    vec3 nc = mix(nationColor(owner), vec3(1.0), 0.2);
    col = mix(col, nc, 0.5 * land);
    float g = 1.0 - texture(uEdge, uv).r;
    col = mix(col, mix(nc, vec3(1.0), 0.35), 0.25 * g * g * land);
  }
  // fresh captures shimmer, blended across the four tiles so a moving front does not flicker in stripes
  float shimmer = 0.0;
  shimmer += w0 * captureGlow(i0);
  shimmer += w1 * captureGlow(i0 + ivec2(1, 0));
  shimmer += w2 * captureGlow(i0 + ivec2(0, 1));
  shimmer += w3 * captureGlow(i0 + ivec2(1, 1));
  col = mix(col, vec3(1.0), 0.35 * shimmer * land);
  if (b != a && a != WATER_OWNER && b != WATER_OWNER && (isNation(a) || isNation(b))) {
    bool war = atWar(a, b);
    vec3 lineColor = mix(nationColor(isNation(a) ? a : b), vec3(1.0), 0.35);
    if (war) {
      float pulse = 0.5 + 0.5 * sin(9.424778 * uTime);
      col = mix(col, vec3(1.0, 0.82, 0.5), (0.3 + 0.25 * pulse) * (1.0 - smoothstep(0.0, 12.0, px)) * land);
      lineColor = mix(lineColor, vec3(1.0, 0.95, 0.85), 0.55 + 0.35 * pulse);
    }
    float halfWidth = war ? 2.0 : 0.75;
    float lineMix = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, px);
    col = mix(col, lineColor, lineMix * land);
  }

  bool inside = p.x >= 0.0 && p.y >= 0.0 && p.x < uMap.x && p.y < uMap.y;
  if (!inside) col = water(p, -COAST_RANGE);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  outColor = vec4(mix(col, vec3(luma), uGrey), 1.0);
}
`;
}
