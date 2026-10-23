import type { NationId } from '../../../shared/types';
import { MAP_VERTEX, mapFragment } from './shaders';
import type { TerrainLook } from './terrainLook';

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
const UNIT = { coast: 0, shade: 1, biome: 2 } as const;

/**
 * Draws the map with the graphics chip (WebGL2) on its own canvas, under the 2D canvas that holds everything else.
 * The terrain look is uploaded once; each frame is one full-screen pass.
 */
export class GlMap {
  private contextLost = false;
  private readonly pixel = new Uint8Array(4);

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

  /** A map drawer on `canvas` for `look`, or null when WebGL2 isn't available or the shaders don't build. */
  static create(canvas: HTMLCanvasElement, look: TerrainLook, colors: Map<NationId, number>): GlMap | null {
    void colors;
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
    gl.uniform1i(gl.getUniformLocation(program, 'uCoast'), UNIT.coast);
    gl.uniform1i(gl.getUniformLocation(program, 'uShade'), UNIT.shade);
    gl.uniform1i(gl.getUniformLocation(program, 'uBiome'), UNIT.biome);
    const uniforms = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)])) as Record<UniformName, WebGLUniformLocation | null>;
    return new GlMap(canvas, gl, program, uniforms, width, height);
  }

  /** Whether the graphics context is gone, so the flat look must take over. */
  get lost(): boolean {
    return this.contextLost || this.gl.isContextLost();
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
