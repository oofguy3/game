import { describe, expect, it } from 'vitest';
import { LOOK } from './palette';
import { glslColor, MAP_VERTEX, mapFragment } from './shaders';

describe('map shaders', () => {
  it('writes a colour as a GLSL vec3 with three decimals', () => {
    expect(glslColor(0xff8000)).toBe('vec3(1.000, 0.502, 0.000)');
  });

  it('builds a GLSL ES 3.00 fragment shader with the palette and limits written in', () => {
    const src = mapFragment();
    expect(src.startsWith('#version 300 es')).toBe(true);
    expect(src).toContain('const float COAST_RANGE = 8.0;');
    expect(src).toContain('const float EDGE_MAX = 4.0;');
    expect(src).toContain('const uint WATER_OWNER = 255u;');
    for (const color of Object.values(LOOK)) expect(src).toContain(glslColor(color));
  });

  it('uses only characters GLSL ES accepts, even in comments', () => {
    for (const src of [MAP_VERTEX, mapFragment()]) {
      expect(src).toMatch(/^[\x20-\x7e\n]*$/);
      expect(src).not.toMatch(/[`$@'"\\]/);
    }
  });

  it('draws one full-screen triangle without vertex buffers', () => {
    expect(MAP_VERTEX.startsWith('#version 300 es')).toBe(true);
    expect(MAP_VERTEX).toContain('gl_VertexID');
  });
});
