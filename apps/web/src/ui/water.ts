// WebGL water reflection for the scene (UI_SPEC §0; product-owner request
// 2026-11-27: "3D ripple distorted reflection", continuous motion — the
// Canvas-2D band version looked flat (per-row strips only) and its
// `t % loop` phase restarted abruptly whenever wave speeds weren't
// integer multiples of the loop.
//
// The whole scene is one fullscreen quad: above the waterline the shader
// samples the backdrop directly; below it, per-pixel displacement from
// four directional wave trains (2D distortion, not per-row strips),
// perspective compression of the mirrored source, depth-scaled amplitude,
// fake-normal specular glints, and a depth opacity fade. Time is
// continuous (no modulo) so the motion never seams.
import { tokens } from "../../../../contracts/design-tokens/tokens";

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uCards;      // album cards composited above the waterline
uniform float uW, uH, uWaterY, uT;
uniform vec4 uWaves[6];        // kx, ky, speed, amp (amps sum to 1)
uniform float uAmpNear, uAmpFar;
uniform float uCompress, uFreqGrow;
uniform float uOpacNear, uOpacFar;
uniform float uNormalNear, uNormalFar;
uniform float uSpecPow, uSpecAmp;
uniform float uBlurNear, uBlurFar;

// Card reflection layer: each card's copy is pre-flipped about its OWN
// bottom edge (where it touches the water) and squashed by
// water.cardReflect in renderCardLayer, then sampled DIRECTLY at the
// displaced water pixel - the PSP mirrors cards about their base, not
// about the global waterline (product-owner note 2026-11-27: "the
// reflection is reflecting the top of the album, not the bottom" and
// "refraction stretch the image so it is very short/distorted").
vec4 cardAt(vec2 uv) { return texture2D(uCards, uv); }

float waveH(vec2 p) {
  float s = 0.0;
  for (int i = 0; i < 6; i++) {
    s += uWaves[i].w * sin(dot(uWaves[i].xy, p) - uWaves[i].z * uT);
  }
  return s;
}

// Wave coordinates warp with depth: ripples get denser toward the viewer
// (bottom of the water region), like the reference photo.
vec2 wcoord(vec2 p, float d) {
  return vec2(p.x * (1.0 + 0.5 * d), p.y * (1.0 + uFreqGrow * d));
}

float waveAt(vec2 p, float d) {
  // No domain warp: its gradient showed up as dash artifacts under the
  // crest shading. Wavefront curvature comes from the kx terms instead.
  return waveH(wcoord(p, d));
}

void main() {
  float sy = uH - gl_FragCoord.y;             // px from top edge
  if (sy < uWaterY) {                        // above the waterline: photo
    gl_FragColor = texture2D(uTex, vec2(gl_FragCoord.x / uW, sy / uH));
    return;
  }
  float y = sy - uWaterY;
  float wh = uH - uWaterY;
  float d = y / wh;                          // 0 at waterline, 1 at bottom
  vec2 p = vec2(gl_FragCoord.x, y);
  // Refraction/reflection displacement is proportional to surface SLOPE
  // (a facet tilted by theta deflects the ray by 2*theta, so the apparent
  // offset is ~2*theta*distance), NOT wave height. Height-based shifts
  // just slide the image; slope-based breaks it at crests/troughs like
  // the PSP original (IMG_7532.MOV, product-owner note 2026-11-27).
  float e = 1.0;
  vec2 grad = vec2(
    waveAt(p + vec2(e, 0.0), d) - waveAt(p - vec2(e, 0.0), d),
    waveAt(p + vec2(0.0, e), d) - waveAt(p - vec2(0.0, e), d)
  ) / (2.0 * e);
  float slope = mix(uAmpNear, uAmpFar, d);   // px of image offset per unit slope

  // Distorted mirror: displaced in x AND y by the surface gradient,
  // source row compressed by perspective.
  float srcY = clamp(uWaterY - (y * uCompress + grad.y * slope * 0.6), 1.0, uWaterY - 1.0);
  float srcX = clamp(gl_FragCoord.x + grad.x * slope, 0.0, uW);
  vec2 base = vec2(srcX / uW, srcY / uH);

  // Reflection blur: 5-tap kernel, widening with depth (distant water is
  // blurrier); also hides source-pixel aliasing under the displacement.
  float blx = mix(uBlurNear, uBlurFar, d) / uW;
  float bly = mix(uBlurNear, uBlurFar, d) / uH;
  vec3 c = texture2D(uTex, base).rgb * 0.4;
  c += texture2D(uTex, base + vec2(blx, 0.0)).rgb * 0.15;
  c += texture2D(uTex, base - vec2(blx, 0.0)).rgb * 0.15;
  c += texture2D(uTex, base + vec2(0.0, bly)).rgb * 0.15;
  c += texture2D(uTex, base - vec2(0.0, bly)).rgb * 0.15;

  // Card reflections: sampled at the water pixel itself (the layer is
  // pre-flipped about each card's base), sharing the same wave
  // displacement and blur, composited over the backdrop mirror.
  vec2 q = vec2((gl_FragCoord.x + grad.x * slope) / uW, (sy + grad.y * slope * 0.6) / uH);
  vec4 cd = cardAt(q) * 0.4;
  cd += cardAt(q + vec2(blx, 0.0)) * 0.15;
  cd += cardAt(q - vec2(blx, 0.0)) * 0.15;
  cd += cardAt(q + vec2(0.0, bly)) * 0.15;
  cd += cardAt(q - vec2(0.0, bly)) * 0.15;
  c = cd.a * cd.rgb + (1.0 - cd.a) * c;

  // Specular glints from the wave normal (light from above/behind viewer).
  float ns = mix(uNormalNear, uNormalFar, d);
  vec3 n = normalize(vec3(-grad.x * ns, -grad.y * ns, 1.0));
  vec3 hv = normalize(normalize(vec3(0.15, -0.5, 0.85)) + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, hv), 0.0), uSpecPow) * uSpecAmp * (1.0 - 0.6 * d);
  c *= 0.90 + 0.16 * n.z;                    // gentle crest/trough shading

  float alpha = mix(uOpacNear, uOpacFar, d);
  c += vec3(0.06) * pow(1.0 - d, 2.5);       // faint sheen near the waterline
  c *= 1.0 - 0.08 * d * d;                   // barely deepen toward the bottom
  c += vec3(spec);
  gl_FragColor = vec4(c * alpha, alpha);     // premultiplied
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("water shader compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/** Renders the scene (photo + water) via WebGL. Returns null when WebGL
 * is unavailable — callers should fall back to the Canvas-2D renderer. */
export class WaterRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private texCards: WebGLTexture;
  private u = {} as Record<
    | "uTex" | "uCards" | "uW" | "uH" | "uWaterY" | "uT" | "uWaves"
    | "uAmpNear" | "uAmpFar" | "uCompress" | "uFreqGrow" | "uOpacNear" | "uOpacFar"
    | "uNormalNear" | "uNormalFar" | "uSpecPow" | "uSpecAmp" | "uBlurNear" | "uBlurFar",
    WebGLUniformLocation | null
  >;
  private lastSource: HTMLCanvasElement | null = null;

  private constructor(gl: WebGLRenderingContext, prog: WebGLProgram, tex: WebGLTexture, texCards: WebGLTexture) {
    this.gl = gl;
    this.prog = prog;
    this.tex = tex;
    this.texCards = texCards;
    const names = [
      "uTex", "uCards", "uW", "uH", "uWaterY", "uT", "uWaves",
      "uAmpNear", "uAmpFar", "uCompress", "uFreqGrow", "uOpacNear", "uOpacFar",
      "uNormalNear", "uNormalFar", "uSpecPow", "uSpecAmp", "uBlurNear", "uBlurFar",
    ] as const;
    for (const name of names) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
  }

  static create(canvas: HTMLCanvasElement): WaterRenderer | null {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    });
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("water shader link failed:", gl.getProgramInfoLog(prog));
      return null;
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Backdrops are NPOT-safe: LINEAR + CLAMP, no mipmaps.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Card layer texture (unit 1): starts fully transparent so the mirror
    // is backdrop-only until the first card layer upload.
    const texCards = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texCards);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    return new WaterRenderer(gl, prog, tex, texCards);
  }

  /** Draw one frame. `dirty` re-uploads the backdrop texture (only needed
   * when it changed — e.g. during a crossfade — to keep uploads cheap);
   * `cards` + `cardsDirty` carry the album-card layer mirrored by the
   * water (see sceneAt in the shader). */
  draw(backdrop: HTMLCanvasElement, cards: HTMLCanvasElement | null, w: number, h: number, t: number, dirty: boolean, cardsDirty: boolean): void {
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    if (dirty || backdrop !== this.lastSource || backdrop.width !== w || backdrop.height !== h) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backdrop);
      this.lastSource = backdrop;
    }
    if (cards && cardsDirty) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.texCards);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cards);
    }
    const W = tokens.water;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texCards);
    gl.uniform1i(this.u.uCards, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this.u.uW, w);
    gl.uniform1f(this.u.uH, h);
    gl.uniform1f(this.u.uWaterY, h * tokens.layout.waterlineY);
    gl.uniform1f(this.u.uT, t);
    gl.uniform4fv(
      this.u.uWaves,
      new Float32Array(W.waves.flatMap((wv) => [wv.kx, wv.ky, wv.speed, wv.amp])),
    );
    gl.uniform1f(this.u.uAmpNear, W.ampNear);
    gl.uniform1f(this.u.uAmpFar, W.ampFar);
    gl.uniform1f(this.u.uCompress, W.compress);
    gl.uniform1f(this.u.uFreqGrow, W.freqGrow);
    gl.uniform1f(this.u.uOpacNear, W.opacityNear);
    gl.uniform1f(this.u.uOpacFar, W.opacityFar);
    gl.uniform1f(this.u.uNormalNear, W.normalNear);
    gl.uniform1f(this.u.uNormalFar, W.normalFar);
    gl.uniform1f(this.u.uSpecPow, W.specPow);
    gl.uniform1f(this.u.uSpecAmp, W.specAmp);
    gl.uniform1f(this.u.uBlurNear, W.blurNear);
    gl.uniform1f(this.u.uBlurFar, W.blurFar);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
