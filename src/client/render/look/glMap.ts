import type { NationId } from '../../../shared/types';
import { MAP_VERTEX, mapFragment } from './shaders';
import type { TerrainLook } from './terrainLook';
import type { TerritoryField } from './territoryField';

/** Front lines are kept in a FRONT_IDS×FRONT_IDS table of attacker→target pairs. */
const FRONT_IDS = 64;

/** The table of running attacks: 1 at `attacker * 64 + target`; pairs with an id of 64 or more are left out. */
export function frontTable(fronts: readonly (readonly [NationId, NationId])[]): Uint8Array {
  const table = new Uint8Array(FRONT_IDS * FRONT_IDS);
  for (const [a, b] of fronts) if (a < FRONT_IDS && b < FRONT_IDS) table[a * FRONT_IDS + b] = 1;
  return table;
}

/** What to draw: the camera (top-left map position in tiles, CSS px per tile), the clock in seconds, the grey fade. */
export interface GlView {
  x: number;
  y: number;
  zoom: number;
  time: number;
  grey: number;
}

const UNIFORMS = ['uMap', 'uCamera', 'uZoom', 'uViewH', 'uTime', 'uGrey'] as const;
type UniformName = (typeof UNIFORMS)[number];
/** Texture units, fixed for the life of the context. */
const UNIT = { coast: 0, shade: 1, biome: 2, owner: 3, edge: 4, captured: 5, palette: 6, fronts: 7 } as const;
const SAMPLERS: Record<keyof typeof UNIT, string> = {
  coast: 'uCoast', shade: 'uShade', biome: 'uBiome', owner: 'uOwner', edge: 'uEdge', captured: 'uCaptured',
  palette: 'uPalette', fronts: 'uFronts',
};

/**
 * Draws the map with the graphics chip (WebGL2) on its own canvas, under the 2D canvas that holds everything else.
 * The terrain look is uploaded once, the territory as it changes; each frame is one full-screen pass.
 */
export class GlMap {
  private contextLost = false;
  private readonly pixel = new Uint8Array(4);
  /** Whether the territory textures still need their first full upload. */
  private fresh = true;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
    private readonly uniforms: Record<UniformName, WebGLUniformLocation | null>,
    private readonly width: number,
    private readonly height: number,
  ) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
  }

  /**
   * A map drawer on `canvas` for `look`, with nations in `colors`, or null when WebGL2 isn't available or the shaders
   * don't build.
   */
  static create(canvas: HTMLCanvasElement, look: TerrainLook, colors: Map<NationId, number>): GlMap | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false,
      });
    } catch {
      return null;
    }
    if (!gl) return null;
    const program = buildProgram(gl, MAP_VERTEX, mapFragment());
    if (!program) return null;
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const { width, height } = look;
    upload(gl, UNIT.coast, gl.R8, gl.RED, gl.UNSIGNED_BYTE, width, height, look.coast, gl.LINEAR);
    upload(gl, UNIT.shade, gl.R8, gl.RED, gl.UNSIGNED_BYTE, width, height, look.shade, gl.LINEAR);
    upload(gl, UNIT.biome, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, width, height, look.biome, gl.LINEAR);
    upload(gl, UNIT.owner, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, width, height, new Uint8Array(width * height), gl.NEAREST);
    upload(gl, UNIT.edge, gl.R8, gl.RED, gl.UNSIGNED_BYTE, width, height, new Uint8Array(width * height).fill(255), gl.LINEAR);
    upload(gl, UNIT.captured, gl.R32F, gl.RED, gl.FLOAT, width, height, new Float32Array(width * height).fill(-1e9), gl.NEAREST);
    const palette = new Uint8Array(256 * 4);
    for (const [id, c] of colors) {
      if (id < 1 || id > 254) continue;
      palette.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255], id * 4);
    }
    upload(gl, UNIT.palette, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 256, 1, palette, gl.NEAREST);
    upload(gl, UNIT.fronts, gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, FRONT_IDS, FRONT_IDS, frontTable([]), gl.NEAREST);
    for (const [unit, name] of Object.entries(SAMPLERS)) {
      gl.uniform1i(gl.getUniformLocation(program, name), UNIT[unit as keyof typeof UNIT]);
    }
    const uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<UniformName, WebGLUniformLocation | null>;
    return new GlMap(canvas, gl, program, uniforms, width, height);
  }

  /** Whether the graphics context is gone, so the flat look must take over. */
  get lost(): boolean {
    return this.contextLost || this.gl.isContextLost();
  }

  /** Uploads what changed in `field` since the last call (everything, the first time). */
  syncTerritory(field: TerritoryField): void {
    const dirty = field.takeDirty();
    if (this.lost) return;
    const { gl } = this;
    const rects = this.fresh ? [{ x: 0, y: 0, w: this.width, h: this.height }] : dirty;
    this.fresh = false;
    if (rects.length === 0) return;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, this.width);
    for (const r of rects) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y);
      gl.activeTexture(gl.TEXTURE0 + UNIT.owner);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, field.owner);
      gl.activeTexture(gl.TEXTURE0 + UNIT.edge);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RED, gl.UNSIGNED_BYTE, field.edge);
      gl.activeTexture(gl.TEXTURE0 + UNIT.captured);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RED, gl.FLOAT, field.captured);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }

  /** Replaces the table of running attacks (see `frontTable`). */
  setFronts(table: Uint8Array): void {
    if (this.lost) return;
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + UNIT.fronts);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FRONT_IDS, FRONT_IDS, gl.RED_INTEGER, gl.UNSIGNED_BYTE, table);
  }

  draw(view: GlView): void {
    if (this.lost) return;
    const { gl, uniforms: u } = this;
    const { width: w, height: h } = this.canvas;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.uniform2f(u.uMap, this.width, this.height);
    gl.uniform2f(u.uCamera, view.x, view.y);
    gl.uniform1f(u.uZoom, view.zoom);
    gl.uniform1f(u.uViewH, h);
    gl.uniform1f(u.uTime, view.time);
    gl.uniform1f(u.uGrey, view.grey);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draws `view` and reads back the colour of canvas pixel (sx, sy), counted from the top-left. */
  sample(view: GlView, sx: number, sy: number): [number, number, number] {
    this.draw(view);
    const { gl } = this;
    gl.readPixels(Math.floor(sx), this.canvas.height - 1 - Math.floor(sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel);
    return [this.pixel[0], this.pixel[1], this.pixel[2]];
  }

  /** Throws the context away, as a lost graphics chip would (for tests). */
  debugLoseContext(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function buildProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn(`Map shader failed to compile, using the flat look: ${gl.getShaderInfoLog(shader)}`);
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn(`Map shader failed to link, using the flat look: ${gl.getProgramInfoLog(program)}`);
  return null;
}

/** Creates a texture on `unit` with `data`, clamped at the edges and filtered with `filter`. */
function upload(
  gl: WebGL2RenderingContext, unit: number, internal: number, format: number, type: number,
  width: number, height: number, data: ArrayBufferView, filter: number,
): WebGLTexture | null {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  return texture;
}
