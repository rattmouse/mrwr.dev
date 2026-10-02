/*
 * party.webp's Fluid surface: a TypeScript port of Pavel Dobryakov's WebGL
 * Fluid Simulation (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation),
 * cut down to what party.webp uses — no GUI, no dithering texture, no capture
 * — wrapped up as a class so a window can start one, stir it and throw it away
 * again, and taught to take a whole crowd's worth of little currents at once.
 *
 * MIT License
 *
 * Copyright (c) 2017 Pavel Dobryakov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { DESKTOP_COLOR } from "@/constants/desktop";

/** What party.webp's Palette sets. Everything else is fixed below. */
export type FluidOptions = {
  shading: boolean;
  colorful: boolean;
  bloom: boolean;
  sunrays: boolean;
  /** What the ink sits on, as #rrggbb. */
  background: string;
  /** How fast the color fades, a share of itself a second. 0 never fades. */
  fade: number;
  /** How hard the ink curls into eddies — the original's vorticity. */
  swirl: number;
  /** How big a stir, a tap or a Splash is. */
  splashSize: number;
  /** Frozen mid-swirl: stirring still lays color down, but nothing moves. */
  paused: boolean;
};

export const FLUID_DEFAULTS: FluidOptions = {
  shading: true,
  colorful: true,
  bloom: true,
  sunrays: true,
  // The original's own numbers, which is what it looked like before these
  // were knobs.
  fade: 1,
  swirl: 30,
  splashSize: 0.25,
  paused: false,
  // The same teal as the desktop, so let out across it as wallpaper it starts
  // out looking like nothing has changed until the first stir.
  background: DESKTOP_COLOR,
};

/**
 * Somebody walking through the ink, in CSS px from the canvas's top-left, and
 * how far they moved in the last 60th of a second. Most of a crowd only
 * nudges the ink along; one marked out stirs it hard and leaves a wake of
 * `color` (#rrggbb) behind them.
 */
export type Current = { x: number; y: number; vx: number; vy: number; marked?: boolean; color?: string };

const SIM_RESOLUTION = 128;
const VELOCITY_DISSIPATION = 0.2;
const PRESSURE = 0.8;
const PRESSURE_ITERATIONS = 20;
const SPLAT_FORCE = 6000;
const COLOR_UPDATE_SPEED = 10;
const BLOOM_ITERATIONS = 8;
const BLOOM_RESOLUTION = 256;
const BLOOM_INTENSITY = 0.8;
const BLOOM_THRESHOLD = 0.6;
const BLOOM_SOFT_KNEE = 0.7;
const SUNRAYS_RESOLUTION = 196;
const SUNRAYS_WEIGHT = 1.0;
// A retina phone would otherwise push four times the pixels for no visible gain.
const MAX_PIXEL_RATIO = 2;
// What a crowd does to the ink: the most of them one pass of the shader takes
// (fewer where the GPU allows fewer uniforms — a phone, typically); how wide
// and how hard the crowd at large nudges it compared with a pointer; the same
// for anyone marked out, who stirs it properly; and how much color a marked
// one lays down a second, as a share of their own.
const MAX_PER_PASS = 32;
const CROWD_RADIUS = 0.0006;
const CROWD_FORCE = 2500;
const MARKED_RADIUS = 0.0015;
const MARKED_FORCE = 4000;
const WAKE_PER_SECOND = 0.6;

type GL = WebGLRenderingContext;
type RGB = { r: number; g: number; b: number };
type Format = { internalFormat: number; format: number };

type FBO = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  attach: (id: number) => number;
};

type DoubleFBO = {
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  read: FBO;
  write: FBO;
  swap: () => void;
};

type Pointer = {
  id: number;
  texcoordX: number;
  texcoordY: number;
  prevTexcoordX: number;
  prevTexcoordY: number;
  deltaX: number;
  deltaY: number;
  down: boolean;
  moved: boolean;
  color: RGB;
};

type Uniforms = Record<string, WebGLUniformLocation | null>;

// --- shaders ---------------------------------------------------------------

const BASE_VERTEX = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const BLUR_VERTEX = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  float offset = 1.33333333;
  vL = vUv - texelSize * offset;
  vR = vUv + texelSize * offset;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const BLUR = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
uniform sampler2D uTexture;
void main () {
  vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
  sum += texture2D(uTexture, vL) * 0.35294117;
  sum += texture2D(uTexture, vR) * 0.35294117;
  gl_FragColor = sum;
}`;

const COPY = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
void main () {
  gl_FragColor = texture2D(uTexture, vUv);
}`;

const CLEAR = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () {
  gl_FragColor = value * texture2D(uTexture, vUv);
}`;

const COLOR = `
precision mediump float;
uniform vec4 color;
void main () {
  gl_FragColor = color;
}`;

// The original dithers the bloom with a blue-noise texture it loads off disk;
// a hash of the pixel position does the same job without the extra file.
const DISPLAY = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform sampler2D uBloom;
uniform sampler2D uSunrays;
uniform vec2 texelSize;

vec3 linearToGamma (vec3 color) {
  color = max(color, vec3(0));
  return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
}

void main () {
  vec3 c = texture2D(uTexture, vUv).rgb;
#ifdef SHADING
  vec3 lc = texture2D(uTexture, vL).rgb;
  vec3 rc = texture2D(uTexture, vR).rgb;
  vec3 tc = texture2D(uTexture, vT).rgb;
  vec3 bc = texture2D(uTexture, vB).rgb;
  float dx = length(rc) - length(lc);
  float dy = length(tc) - length(bc);
  vec3 n = normalize(vec3(dx, dy, length(texelSize)));
  vec3 l = vec3(0.0, 0.0, 1.0);
  float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
  c *= diffuse;
#endif
#ifdef BLOOM
  vec3 bloom = texture2D(uBloom, vUv).rgb;
#endif
#ifdef SUNRAYS
  float sunrays = texture2D(uSunrays, vUv).r;
  c *= sunrays;
#ifdef BLOOM
  bloom *= sunrays;
#endif
#endif
#ifdef BLOOM
  float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  noise = noise * 2.0 - 1.0;
  bloom += noise / 255.0;
  bloom = linearToGamma(bloom);
  c += bloom;
#endif
  float a = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c, a);
}`;

const BLOOM_PREFILTER = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform vec3 curve;
uniform float threshold;
void main () {
  vec3 c = texture2D(uTexture, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - curve.x, 0.0, curve.y);
  rq = curve.z * rq * rq;
  c *= max(rq, br - threshold) / max(br, 0.0001);
  gl_FragColor = vec4(c, 0.0);
}`;

const BLOOM_BLUR = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
void main () {
  vec4 sum = vec4(0.0);
  sum += texture2D(uTexture, vL);
  sum += texture2D(uTexture, vR);
  sum += texture2D(uTexture, vT);
  sum += texture2D(uTexture, vB);
  sum *= 0.25;
  gl_FragColor = sum;
}`;

const BLOOM_FINAL = `
precision mediump float;
precision mediump sampler2D;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform float intensity;
void main () {
  vec4 sum = vec4(0.0);
  sum += texture2D(uTexture, vL);
  sum += texture2D(uTexture, vR);
  sum += texture2D(uTexture, vT);
  sum += texture2D(uTexture, vB);
  sum *= 0.25;
  gl_FragColor = sum * intensity;
}`;

const SUNRAYS_MASK = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
void main () {
  vec4 c = texture2D(uTexture, vUv);
  float br = max(c.r, max(c.g, c.b));
  c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
  gl_FragColor = c;
}`;

const SUNRAYS = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float weight;
#define ITERATIONS 16
void main () {
  float Density = 0.3;
  float Decay = 0.95;
  float Exposure = 0.7;
  vec2 coord = vUv;
  vec2 dir = vUv - 0.5;
  dir *= 1.0 / float(ITERATIONS) * Density;
  float illuminationDecay = 1.0;
  float color = texture2D(uTexture, vUv).a;
  for (int i = 0; i < ITERATIONS; i++) {
    coord -= dir;
    float col = texture2D(uTexture, coord).a;
    color += col * illuminationDecay * weight;
    illuminationDecay *= Decay;
  }
  gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
}`;

const SPLAT = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
void main () {
  vec2 p = vUv - point.xy;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}`;

// SPLAT for a crowd: one pass adds a whole batch of small splats — a push to
// the velocity, or a wake of color to the dye — so a hundred guys cost a few
// passes rather than a hundred. PER_PASS is set when it's compiled.
const CURRENTS = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform float radius;
uniform int count;
uniform vec2 points[PER_PASS];
uniform vec3 values[PER_PASS];
void main () {
  vec3 v = texture2D(uTarget, vUv).xyz;
  for (int i = 0; i < PER_PASS; i++) {
    if (i >= count) break;
    vec2 p = vUv - points[i];
    p.x *= aspectRatio;
    v += exp(-dot(p, p) / radius) * values[i];
  }
  gl_FragColor = vec4(v, 1.0);
}`;

const ADVECTION = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main () {
#ifdef MANUAL_FILTERING
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
  vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  vec4 result = texture2D(uSource, coord);
#endif
  float decay = 1.0 + dissipation * dt;
  gl_FragColor = result / decay;
}`;

const DIVERGENCE = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}`;

const CURL_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`;

const VORTICITY = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity += force * dt;
  velocity = min(max(velocity, -1000.0), 1000.0);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const PRESSURE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const GRADIENT_SUBTRACT = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

// --- GL plumbing -----------------------------------------------------------

function compileShader(gl: GL, type: number, source: string, keywords: string[] = []): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("fluid: could not create a shader");
  gl.shaderSource(shader, keywords.map((k) => `#define ${k}\n`).join("") + source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`fluid: shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function linkProgram(gl: GL, vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("fluid: could not create a program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  // The one vertex buffer is wired to attribute 0, so every program has to
  // agree that that's where aPosition lives.
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`fluid: program failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function uniformsOf(gl: GL, program: WebGLProgram): Uniforms {
  const uniforms: Uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return uniforms;
}

class Program {
  readonly program: WebGLProgram;
  readonly uniforms: Uniforms;
  constructor(private gl: GL, vertex: WebGLShader, fragment: WebGLShader) {
    this.program = linkProgram(gl, vertex, fragment);
    this.uniforms = uniformsOf(gl, this.program);
  }
  bind() {
    this.gl.useProgram(this.program);
  }
}

/** The display shader, compiled once per mix of shading / bloom / sunrays. */
class Material {
  private programs = new Map<string, Program>();
  private active: Program | null = null;
  constructor(private gl: GL, private vertex: WebGLShader, private source: string) {}
  setKeywords(keywords: string[]) {
    const key = keywords.join(",");
    let program = this.programs.get(key);
    if (!program) {
      program = new Program(this.gl, this.vertex, compileShader(this.gl, this.gl.FRAGMENT_SHADER, this.source, keywords));
      this.programs.set(key, program);
    }
    this.active = program;
  }
  get uniforms(): Uniforms {
    return this.active!.uniforms;
  }
  bind() {
    this.active!.bind();
  }
}

function canRenderTo(gl: GL, internalFormat: number, format: number, type: number): boolean {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(texture);
  return ok;
}

// Not every GPU can render into a one- or two-channel float texture; fall
// back a channel at a time until one works.
function supportedFormat(gl: GL, internalFormat: number, format: number, type: number): Format | null {
  if (canRenderTo(gl, internalFormat, format, type)) return { internalFormat, format };
  const gl2 = gl as WebGL2RenderingContext;
  switch (internalFormat) {
    case gl2.R16F:
      return supportedFormat(gl, gl2.RG16F, gl2.RG, type);
    case gl2.RG16F:
      return supportedFormat(gl, gl2.RGBA16F, gl2.RGBA, type);
    default:
      return null;
  }
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

function randomColor(): RGB {
  const c = hsvToRgb(Math.random(), 1, 1);
  return { r: c.r * 0.15, g: c.g * 0.15, b: c.b * 0.15 };
}

function newPointer(id: number): Pointer {
  return {
    id,
    texcoordX: 0,
    texcoordY: 0,
    prevTexcoordX: 0,
    prevTexcoordY: 0,
    deltaX: 0,
    deltaY: 0,
    down: false,
    moved: false,
    color: randomColor(),
  };
}

// --- the simulation --------------------------------------------------------

/**
 * One fluid, living on one canvas. `FluidSim.create` returns null when the
 * browser has no WebGL (or none that can render to float textures), and the
 * window says so instead.
 *
 * Pointer positions come in as CSS px from the canvas's top-left. The canvas
 * sizes its own backing store to its CSS box every frame, so a window being
 * dragged bigger just resamples what's already swirling.
 */
export class FluidSim {
  private options: FluidOptions;
  private readonly halfFloat: number;
  private readonly rgba: Format;
  private readonly rg: Format;
  private readonly r: Format;
  private readonly linearFiltering: boolean;
  private readonly dyeResolution: number;

  private blurProgram!: Program;
  private copyProgram!: Program;
  private clearProgram!: Program;
  private colorProgram!: Program;
  private bloomPrefilterProgram!: Program;
  private bloomBlurProgram!: Program;
  private bloomFinalProgram!: Program;
  private sunraysMaskProgram!: Program;
  private sunraysProgram!: Program;
  private splatProgram!: Program;
  private currentsProgram!: Program;
  private perPass = MAX_PER_PASS;
  // Which of those marked out lays down color next, when there are more of
  // them than one pass of the dye takes.
  private wakeCursor = 0;
  private tints = new Map<string, RGB>();
  private advectionProgram!: Program;
  private divergenceProgram!: Program;
  private curlProgram!: Program;
  private vorticityProgram!: Program;
  private pressureProgram!: Program;
  private gradientSubtractProgram!: Program;
  private displayMaterial!: Material;

  private dye!: DoubleFBO;
  private velocity!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;
  private pressure!: DoubleFBO;
  private bloom!: FBO;
  private bloomFramebuffers: FBO[] = [];
  private sunrays!: FBO;
  private sunraysTemp!: FBO;

  /**
   * Called after every frame is drawn, while the picture is still in the
   * canvas — the one moment something else can copy it, since the buffer is
   * not preserved past the frame.
   */
  onFrame: (() => void) | null = null;

  private pointers: Pointer[] = [];
  private splatStack: number[] = [];
  private drops: { x: number; y: number }[] = [];
  private pendingCurrents: Current[] = [];
  private backColor: RGB = { r: 0, g: 0, b: 0 };
  private colorUpdateTimer = 0;
  private lastTime = 0;
  private raf = 0;
  private running = false;
  private lost = false;

  static create(canvas: HTMLCanvasElement, options: FluidOptions): FluidSim | null {
    const params: WebGLContextAttributes = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    const gl2 = canvas.getContext("webgl2", params);
    const gl = (gl2 ?? canvas.getContext("webgl", params)) as GL | null;
    if (!gl) return null;
    try {
      return new FluidSim(canvas, gl, !!gl2, options);
    } catch (error) {
      console.warn(error);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return null;
    }
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: GL,
    isWebGL2: boolean,
    options: FluidOptions,
  ) {
    this.options = { ...options };
    this.backColor = hexToRgb(options.background);
    let halfFloat: number;
    let linear: unknown;
    if (isWebGL2) {
      const g = gl as WebGL2RenderingContext;
      gl.getExtension("EXT_color_buffer_float");
      linear = gl.getExtension("OES_texture_float_linear");
      halfFloat = g.HALF_FLOAT;
      const rgba = supportedFormat(gl, g.RGBA16F, g.RGBA, halfFloat);
      const rg = supportedFormat(gl, g.RG16F, g.RG, halfFloat);
      const r = supportedFormat(gl, g.R16F, g.RED, halfFloat);
      if (!rgba || !rg || !r) throw new Error("fluid: no renderable half-float format");
      this.rgba = rgba;
      this.rg = rg;
      this.r = r;
    } else {
      const ext = gl.getExtension("OES_texture_half_float");
      if (!ext) throw new Error("fluid: no half-float textures");
      linear = gl.getExtension("OES_texture_half_float_linear");
      halfFloat = ext.HALF_FLOAT_OES;
      const rgba = supportedFormat(gl, gl.RGBA, gl.RGBA, halfFloat);
      if (!rgba) throw new Error("fluid: no renderable half-float format");
      this.rgba = this.rg = this.r = rgba;
    }
    this.halfFloat = halfFloat;
    this.linearFiltering = !!linear;

    const mobile = /Mobi|Android/i.test(navigator.userAgent);
    this.dyeResolution = mobile || !this.linearFiltering ? 512 : 1024;
    if (!this.linearFiltering) {
      // The effects lean on filtered reads; without them they only add noise.
      this.options.shading = false;
      this.options.bloom = false;
      this.options.sunrays = false;
    }

    this.buildPrograms();
    this.buildQuad();
    this.resizeCanvas();
    this.initFramebuffers();
    this.updateKeywords();
    this.multipleSplats(Math.floor(Math.random() * 20) + 5);

    canvas.addEventListener("webglcontextlost", this.onContextLost);
  }

  /** Whether this GPU can show shading, bloom and rays at all. Without it they stay off. */
  get hasEffects(): boolean {
    return this.linearFiltering;
  }

  setOptions(next: Partial<FluidOptions>) {
    this.options = { ...this.options, ...next };
    this.backColor = hexToRgb(this.options.background);
    if (!this.linearFiltering) {
      this.options.shading = false;
      this.options.bloom = false;
      this.options.sunrays = false;
    }
    this.updateKeywords();
  }

  start() {
    if (this.running || this.lost) return;
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    // Hand the GPU memory back now rather than whenever the canvas is collected
    // — opening and closing the window a few times would otherwise pile up
    // contexts until the browser starts dropping the oldest.
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Throw a handful of random colored splats in. */
  splash(count = Math.floor(Math.random() * 20) + 5) {
    this.splatStack.push(count);
  }

  /**
   * A tap: one splash of color where it landed, thrown off in a random
   * direction. A touch screen has no hover, and a tap that never moves would
   * otherwise leave nothing behind.
   */
  drop(x: number, y: number) {
    const { w, h } = this.cssSize();
    this.drops.push({ x: x / w, y: 1 - y / h });
  }

  /** Wipe the dye and stop everything moving. */
  clear() {
    const { gl } = this;
    for (const fbo of [this.dye.read, this.dye.write, this.velocity.read, this.velocity.write, this.pressure.read, this.pressure.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
      gl.viewport(0, 0, fbo.width, fbo.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /**
   * This frame's crowd. Each call replaces the last, so whoever is drawing
   * the crowd just hands over where everybody is now.
   */
  currents(list: Current[]) {
    this.pendingCurrents = list;
  }

  pointerDown(id: number, x: number, y: number) {
    let pointer = this.pointers.find((p) => p.id === id);
    if (!pointer) {
      pointer = newPointer(id);
      this.pointers.push(pointer);
    }
    const { w, h } = this.cssSize();
    pointer.down = true;
    pointer.moved = false;
    pointer.texcoordX = x / w;
    pointer.texcoordY = 1 - y / h;
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.deltaX = 0;
    pointer.deltaY = 0;
    pointer.color = randomColor();
  }

  pointerMove(id: number, x: number, y: number) {
    const pointer = this.pointers.find((p) => p.id === id);
    if (!pointer || !pointer.down) return;
    const { w, h } = this.cssSize();
    pointer.prevTexcoordX = pointer.texcoordX;
    pointer.prevTexcoordY = pointer.texcoordY;
    pointer.texcoordX = x / w;
    pointer.texcoordY = 1 - y / h;
    const aspect = this.canvas.width / this.canvas.height;
    let dx = pointer.texcoordX - pointer.prevTexcoordX;
    let dy = pointer.texcoordY - pointer.prevTexcoordY;
    if (aspect < 1) dx *= aspect;
    if (aspect > 1) dy /= aspect;
    pointer.deltaX = dx;
    pointer.deltaY = dy;
    pointer.moved = Math.abs(dx) > 0 || Math.abs(dy) > 0;
  }

  /** Stir with no button held — the wallpaper follows the bare pointer. */
  hover(id: number, x: number, y: number) {
    if (this.pointers.some((p) => p.id === id && p.down)) this.pointerMove(id, x, y);
    else this.pointerDown(id, x, y);
  }

  pointerUp(id: number) {
    const index = this.pointers.findIndex((p) => p.id === id);
    if (index >= 0) this.pointers.splice(index, 1);
  }

  /** Drop every pointer, as if all of them had let go. */
  letGo() {
    this.pointers = [];
  }

  // --- internals -----------------------------------------------------------

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.stop();
  };

  private cssSize() {
    return { w: Math.max(1, this.canvas.clientWidth), h: Math.max(1, this.canvas.clientHeight) };
  }

  private buildPrograms() {
    const { gl } = this;
    const v = compileShader(gl, gl.VERTEX_SHADER, BASE_VERTEX);
    const blurV = compileShader(gl, gl.VERTEX_SHADER, BLUR_VERTEX);
    const f = (source: string, keywords: string[] = []) => compileShader(gl, gl.FRAGMENT_SHADER, source, keywords);

    this.blurProgram = new Program(gl, blurV, f(BLUR));
    this.copyProgram = new Program(gl, v, f(COPY));
    this.clearProgram = new Program(gl, v, f(CLEAR));
    this.colorProgram = new Program(gl, v, f(COLOR));
    this.bloomPrefilterProgram = new Program(gl, v, f(BLOOM_PREFILTER));
    this.bloomBlurProgram = new Program(gl, v, f(BLOOM_BLUR));
    this.bloomFinalProgram = new Program(gl, v, f(BLOOM_FINAL));
    this.sunraysMaskProgram = new Program(gl, v, f(SUNRAYS_MASK));
    this.sunraysProgram = new Program(gl, v, f(SUNRAYS));
    this.splatProgram = new Program(gl, v, f(SPLAT));
    // Two uniforms a splat, plus a handful of the shader's own.
    const vectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    this.perPass = Math.max(4, Math.min(MAX_PER_PASS, Math.floor((vectors - 8) / 2)));
    this.currentsProgram = new Program(gl, v, f(CURRENTS.replaceAll("PER_PASS", String(this.perPass))));
    this.advectionProgram = new Program(gl, v, f(ADVECTION, this.linearFiltering ? [] : ["MANUAL_FILTERING"]));
    this.divergenceProgram = new Program(gl, v, f(DIVERGENCE));
    this.curlProgram = new Program(gl, v, f(CURL_SHADER));
    this.vorticityProgram = new Program(gl, v, f(VORTICITY));
    this.pressureProgram = new Program(gl, v, f(PRESSURE_SHADER));
    this.gradientSubtractProgram = new Program(gl, v, f(GRADIENT_SUBTRACT));
    this.displayMaterial = new Material(gl, v, DISPLAY);
  }

  private buildQuad() {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
  }

  private blit(target: FBO | null, clear = false) {
    const { gl } = this;
    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    if (clear) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  private updateKeywords() {
    const keywords: string[] = [];
    if (this.options.shading) keywords.push("SHADING");
    if (this.options.bloom) keywords.push("BLOOM");
    if (this.options.sunrays) keywords.push("SUNRAYS");
    this.displayMaterial.setKeywords(keywords);
  }

  private resolution(resolution: number) {
    const { gl } = this;
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(resolution);
    const max = Math.round(resolution * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max };
  }

  private createFBO(w: number, h: number, format: Format, param: number): FBO {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, w, h, 0, format.format, this.halfFloat, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  private deleteFBO(target: FBO | undefined) {
    if (!target) return;
    this.gl.deleteFramebuffer(target.fbo);
    this.gl.deleteTexture(target.texture);
  }

  private createDoubleFBO(w: number, h: number, format: Format, param: number): DoubleFBO {
    let fbo1 = this.createFBO(w, h, format, param);
    let fbo2 = this.createFBO(w, h, format, param);
    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() {
        return fbo1;
      },
      set read(value) {
        fbo1 = value;
      },
      get write() {
        return fbo2;
      },
      set write(value) {
        fbo2 = value;
      },
      swap() {
        const temp = fbo1;
        fbo1 = fbo2;
        fbo2 = temp;
      },
    };
  }

  // A new texture the new size, with the old one drawn into it — so resizing
  // the window stretches the ink rather than wiping it.
  private resizeFBO(target: FBO, w: number, h: number, format: Format, param: number): FBO {
    const next = this.createFBO(w, h, format, param);
    this.copyProgram.bind();
    this.gl.uniform1i(this.copyProgram.uniforms.uTexture, target.attach(0));
    this.blit(next);
    this.deleteFBO(target);
    return next;
  }

  private resizeDoubleFBO(target: DoubleFBO, w: number, h: number, format: Format, param: number): DoubleFBO {
    if (target.width === w && target.height === h) return target;
    target.read = this.resizeFBO(target.read, w, h, format, param);
    this.deleteFBO(target.write);
    target.write = this.createFBO(w, h, format, param);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1 / w;
    target.texelSizeY = 1 / h;
    return target;
  }

  private initFramebuffers() {
    const { gl } = this;
    const simRes = this.resolution(SIM_RESOLUTION);
    const dyeRes = this.resolution(this.dyeResolution);
    const filtering = this.linearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    this.dye = this.dye
      ? this.resizeDoubleFBO(this.dye, dyeRes.width, dyeRes.height, this.rgba, filtering)
      : this.createDoubleFBO(dyeRes.width, dyeRes.height, this.rgba, filtering);
    this.velocity = this.velocity
      ? this.resizeDoubleFBO(this.velocity, simRes.width, simRes.height, this.rg, filtering)
      : this.createDoubleFBO(simRes.width, simRes.height, this.rg, filtering);

    this.deleteFBO(this.divergence);
    this.deleteFBO(this.curl);
    if (this.pressure) {
      this.deleteFBO(this.pressure.read);
      this.deleteFBO(this.pressure.write);
    }
    this.divergence = this.createFBO(simRes.width, simRes.height, this.r, gl.NEAREST);
    this.curl = this.createFBO(simRes.width, simRes.height, this.r, gl.NEAREST);
    this.pressure = this.createDoubleFBO(simRes.width, simRes.height, this.r, gl.NEAREST);

    this.initBloomFramebuffers();
    this.initSunraysFramebuffers();
  }

  private initBloomFramebuffers() {
    const res = this.resolution(BLOOM_RESOLUTION);
    const filtering = this.linearFiltering ? this.gl.LINEAR : this.gl.NEAREST;
    this.deleteFBO(this.bloom);
    this.bloomFramebuffers.forEach((fbo) => this.deleteFBO(fbo));
    this.bloom = this.createFBO(res.width, res.height, this.rgba, filtering);
    this.bloomFramebuffers = [];
    for (let i = 0; i < BLOOM_ITERATIONS; i++) {
      const width = res.width >> (i + 1);
      const height = res.height >> (i + 1);
      if (width < 2 || height < 2) break;
      this.bloomFramebuffers.push(this.createFBO(width, height, this.rgba, filtering));
    }
  }

  private initSunraysFramebuffers() {
    const res = this.resolution(SUNRAYS_RESOLUTION);
    const filtering = this.linearFiltering ? this.gl.LINEAR : this.gl.NEAREST;
    this.deleteFBO(this.sunrays);
    this.deleteFBO(this.sunraysTemp);
    this.sunrays = this.createFBO(res.width, res.height, this.r, filtering);
    this.sunraysTemp = this.createFBO(res.width, res.height, this.r, filtering);
  }

  private resizeCanvas(): boolean {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const { w, h } = this.cssSize();
    const width = Math.floor(w * ratio);
    const height = Math.floor(h * ratio);
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.016666);
    this.lastTime = now;
    if (this.resizeCanvas()) this.initFramebuffers();
    this.updateColors(dt);
    this.applyInputs(dt);
    if (!this.options.paused) this.step(dt);
    this.render();
    this.onFrame?.();
    this.raf = requestAnimationFrame(this.frame);
  };

  private updateColors(dt: number) {
    if (!this.options.colorful) return;
    this.colorUpdateTimer += dt * COLOR_UPDATE_SPEED;
    if (this.colorUpdateTimer >= 1) {
      this.colorUpdateTimer %= 1;
      this.pointers.forEach((p) => {
        p.color = randomColor();
      });
    }
  }

  private applyInputs(dt: number) {
    const count = this.splatStack.pop();
    if (count != null) this.multipleSplats(count);
    for (const { x, y } of this.drops.splice(0)) {
      const color = randomColor();
      this.splat(x, y, 1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), {
        r: color.r * 10,
        g: color.g * 10,
        b: color.b * 10,
      });
    }
    for (const p of this.pointers) {
      if (!p.moved) continue;
      p.moved = false;
      this.splat(p.texcoordX, p.texcoordY, p.deltaX * SPLAT_FORCE, p.deltaY * SPLAT_FORCE, p.color);
    }
    this.applyCurrents(dt);
  }

  private step(dt: number) {
    const { gl, velocity } = this;
    gl.disable(gl.BLEND);

    this.curlProgram.bind();
    gl.uniform2f(this.curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    this.blit(this.curl);

    this.vorticityProgram.bind();
    gl.uniform2f(this.vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(this.vorticityProgram.uniforms.uCurl, this.curl.attach(1));
    gl.uniform1f(this.vorticityProgram.uniforms.curl, this.options.swirl);
    gl.uniform1f(this.vorticityProgram.uniforms.dt, dt);
    this.blit(velocity.write);
    velocity.swap();

    this.divergenceProgram.bind();
    gl.uniform2f(this.divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    this.blit(this.divergence);

    this.clearProgram.bind();
    gl.uniform1i(this.clearProgram.uniforms.uTexture, this.pressure.read.attach(0));
    gl.uniform1f(this.clearProgram.uniforms.value, PRESSURE);
    this.blit(this.pressure.write);
    this.pressure.swap();

    this.pressureProgram.bind();
    gl.uniform2f(this.pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.pressureProgram.uniforms.uDivergence, this.divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(this.pressureProgram.uniforms.uPressure, this.pressure.read.attach(1));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    this.gradientSubtractProgram.bind();
    gl.uniform2f(this.gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.gradientSubtractProgram.uniforms.uPressure, this.pressure.read.attach(0));
    gl.uniform1i(this.gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    this.blit(velocity.write);
    velocity.swap();

    const advection = this.advectionProgram;
    advection.bind();
    gl.uniform2f(advection.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!this.linearFiltering) {
      gl.uniform2f(advection.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    }
    const velocityId = velocity.read.attach(0);
    gl.uniform1i(advection.uniforms.uVelocity, velocityId);
    gl.uniform1i(advection.uniforms.uSource, velocityId);
    gl.uniform1f(advection.uniforms.dt, dt);
    gl.uniform1f(advection.uniforms.dissipation, VELOCITY_DISSIPATION);
    this.blit(velocity.write);
    velocity.swap();

    if (!this.linearFiltering) {
      gl.uniform2f(advection.uniforms.dyeTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
    }
    gl.uniform1i(advection.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advection.uniforms.uSource, this.dye.read.attach(1));
    gl.uniform1f(advection.uniforms.dissipation, this.options.fade);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  private render() {
    const { gl } = this;
    if (this.options.bloom) this.applyBloom(this.dye.read, this.bloom);
    if (this.options.sunrays) {
      this.applySunrays(this.dye.read, this.dye.write, this.sunrays);
      this.blur(this.sunrays, this.sunraysTemp, 1);
    }

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    this.colorProgram.bind();
    const bg = this.backColor;
    gl.uniform4f(this.colorProgram.uniforms.color, bg.r, bg.g, bg.b, 1);
    this.blit(null);

    const m = this.displayMaterial;
    m.bind();
    if (this.options.shading) gl.uniform2f(m.uniforms.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1i(m.uniforms.uTexture, this.dye.read.attach(0));
    if (this.options.bloom) gl.uniform1i(m.uniforms.uBloom, this.bloom.attach(1));
    if (this.options.sunrays) gl.uniform1i(m.uniforms.uSunrays, this.sunrays.attach(3));
    this.blit(null);
  }

  private applyBloom(source: FBO, destination: FBO) {
    if (this.bloomFramebuffers.length < 2) return;
    const { gl } = this;
    let last = destination;

    gl.disable(gl.BLEND);
    const prefilter = this.bloomPrefilterProgram;
    prefilter.bind();
    const knee = BLOOM_THRESHOLD * BLOOM_SOFT_KNEE + 0.0001;
    gl.uniform3f(prefilter.uniforms.curve, BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee);
    gl.uniform1f(prefilter.uniforms.threshold, BLOOM_THRESHOLD);
    gl.uniform1i(prefilter.uniforms.uTexture, source.attach(0));
    this.blit(last);

    const blur = this.bloomBlurProgram;
    blur.bind();
    for (const dest of this.bloomFramebuffers) {
      gl.uniform2f(blur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(blur.uniforms.uTexture, last.attach(0));
      this.blit(dest);
      last = dest;
    }

    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.BLEND);
    for (let i = this.bloomFramebuffers.length - 2; i >= 0; i--) {
      const base = this.bloomFramebuffers[i];
      gl.uniform2f(blur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(blur.uniforms.uTexture, last.attach(0));
      this.blit(base);
      last = base;
    }

    gl.disable(gl.BLEND);
    const final = this.bloomFinalProgram;
    final.bind();
    gl.uniform2f(final.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(final.uniforms.uTexture, last.attach(0));
    gl.uniform1f(final.uniforms.intensity, BLOOM_INTENSITY);
    this.blit(destination);
  }

  private applySunrays(source: FBO, mask: FBO, destination: FBO) {
    const { gl } = this;
    gl.disable(gl.BLEND);
    this.sunraysMaskProgram.bind();
    gl.uniform1i(this.sunraysMaskProgram.uniforms.uTexture, source.attach(0));
    this.blit(mask);

    this.sunraysProgram.bind();
    gl.uniform1f(this.sunraysProgram.uniforms.weight, SUNRAYS_WEIGHT);
    gl.uniform1i(this.sunraysProgram.uniforms.uTexture, mask.attach(0));
    this.blit(destination);
  }

  private blur(target: FBO, temp: FBO, iterations: number) {
    const { gl } = this;
    const p = this.blurProgram;
    p.bind();
    for (let i = 0; i < iterations; i++) {
      gl.uniform2f(p.uniforms.texelSize, target.texelSizeX, 0);
      gl.uniform1i(p.uniforms.uTexture, target.attach(0));
      this.blit(temp);
      gl.uniform2f(p.uniforms.texelSize, 0, target.texelSizeY);
      gl.uniform1i(p.uniforms.uTexture, temp.attach(0));
      this.blit(target);
    }
  }

  private applyCurrents(dt: number) {
    const list = this.pendingCurrents;
    this.pendingCurrents = [];
    // Paused, nothing moves — and a crowd's pushes left to pile up in the
    // velocity would all go off at once the moment it was let go.
    if (list.length === 0 || this.options.paused) return;
    const { gl } = this;
    const { w, h } = this.cssSize();
    const aspect = this.canvas.width / this.canvas.height;
    // The same corrections a pointer's stroke gets, so a guy walking sideways
    // pushes as hard as one walking up the screen whatever its shape.
    const sx = aspect < 1 ? aspect : 1;
    const sy = aspect > 1 ? 1 / aspect : 1;

    // Only those standing in the ink — let out of the frame while it is kept
    // in, they are walking on bare desktop.
    const crowd: { u: number; v: number; c: Current }[] = [];
    const marked: { u: number; v: number; c: Current }[] = [];
    for (const c of list) {
      const u = c.x / w;
      const v = 1 - c.y / h;
      if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) continue;
      (c.marked ? marked : crowd).push({ u, v, c });
    }

    const per = this.perPass;
    const points = new Float32Array(per * 2);
    const values = new Float32Array(per * 3);
    const p = this.currentsProgram;
    p.bind();
    gl.uniform1f(p.uniforms.aspectRatio, aspect);
    const pass = (target: DoubleFBO, n: number, radius: number) => {
      gl.uniform1f(p.uniforms.radius, aspect > 1 ? radius * aspect : radius);
      gl.uniform1i(p.uniforms.uTarget, target.read.attach(0));
      gl.uniform1i(p.uniforms.count, n);
      gl.uniform2fv(p.uniforms["points[0]"], points);
      gl.uniform3fv(p.uniforms["values[0]"], values);
      this.blit(target.write);
      target.swap();
    };
    const push = (group: { u: number; v: number; c: Current }[], radius: number, force: number) => {
      let n = 0;
      for (const { u, v, c } of group) {
        points[n * 2] = u;
        points[n * 2 + 1] = v;
        values[n * 3] = (c.vx / w) * sx * force;
        values[n * 3 + 1] = (-c.vy / h) * sy * force;
        values[n * 3 + 2] = 0;
        n += 1;
        if (n === per) {
          pass(this.velocity, n, radius);
          n = 0;
        }
      }
      if (n > 0) pass(this.velocity, n, radius);
    };
    push(crowd, CROWD_RADIUS, CROWD_FORCE);
    push(marked, MARKED_RADIUS, MARKED_FORCE);
    if (marked.length === 0) return;

    // The wake goes into the full-size dye, so it's one pass a frame. Should
    // more be marked out than a pass takes, they take turns, each laying down
    // color enough for every frame until their next.
    const take = Math.min(per, marked.length);
    const amount = WAKE_PER_SECOND * dt * (marked.length / take);
    for (let i = 0; i < take; i++) {
      const { u, v, c } = marked[(this.wakeCursor + i) % marked.length];
      const tint = this.tintOf(c.color ?? "#ffffff");
      points[i * 2] = u;
      points[i * 2 + 1] = v;
      values[i * 3] = tint.r * amount;
      values[i * 3 + 1] = tint.g * amount;
      values[i * 3 + 2] = tint.b * amount;
    }
    this.wakeCursor = (this.wakeCursor + take) % marked.length;
    pass(this.dye, take, MARKED_RADIUS);
  }

  private tintOf(hex: string): RGB {
    let tint = this.tints.get(hex);
    if (!tint) {
      tint = hexToRgb(hex);
      this.tints.set(hex, tint);
    }
    return tint;
  }

  private multipleSplats(amount: number) {
    for (let i = 0; i < amount; i++) {
      const color = randomColor();
      color.r *= 10;
      color.g *= 10;
      color.b *= 10;
      this.splat(Math.random(), Math.random(), 1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), color);
    }
  }

  private splat(x: number, y: number, dx: number, dy: number, color: RGB) {
    const { gl } = this;
    const p = this.splatProgram;
    const aspect = this.canvas.width / this.canvas.height;
    let radius = this.options.splashSize / 100;
    if (aspect > 1) radius *= aspect;

    p.bind();
    gl.uniform1i(p.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform1f(p.uniforms.aspectRatio, aspect);
    gl.uniform2f(p.uniforms.point, x, y);
    gl.uniform3f(p.uniforms.color, dx, dy, 0);
    gl.uniform1f(p.uniforms.radius, radius);
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(p.uniforms.uTarget, this.dye.read.attach(0));
    gl.uniform3f(p.uniforms.color, color.r, color.g, color.b);
    this.blit(this.dye.write);
    this.dye.swap();
  }
}
