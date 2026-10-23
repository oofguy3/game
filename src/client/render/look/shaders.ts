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

/** The map pass: terrain, water and the grey fade, with the palette and limits written in. */
export function mapFragment(): string {
  return `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uMap;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uViewH;
uniform float uTime;
uniform float uGrey;
uniform sampler2D uCoast;
uniform sampler2D uShade;
uniform sampler2D uBiome;

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

void main() {
  vec2 p = uCamera + vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y) / uZoom;
  vec3 col;
  if (p.x < 0.0 || p.y < 0.0 || p.x >= uMap.x || p.y >= uMap.y) {
    col = DEEP;
  } else {
    vec2 uv = p / uMap;
    float s = texture(uCoast, uv).r * (2.0 * COAST_RANGE) - COAST_RANGE;
    float aa = max(fwidth(s) * 0.75, 0.02);
    float land = smoothstep(-aa, aa, s);
    col = mix(water(p, s), ground(uv, s), land);
  }
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  outColor = vec4(mix(col, vec3(luma), uGrey), 1.0);
}
`;
}
