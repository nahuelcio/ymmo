import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GodRaysShader, TiltShader } from './atmos';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Settings } from '../settings';
import { VolumetricPass } from './volumetric';

/** Sharpen, white balance, saturation, contrast and vignette in one cheap full-screen pass. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    saturation: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0.3 },
    warmth: { value: 0 },
    sharpen: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float saturation, contrast, vignette, warmth, sharpen;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (sharpen > 0.0) {
        vec3 n = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        c.rgb += (c.rgb * 4.0 - n) * sharpen * 0.5;
      }
      c.rgb *= vec3(1.0 + warmth * 0.12, 1.0 + warmth * 0.03, 1.0 - warmth * 0.12);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.75, dot(d, d) * 2.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

const PIPE_KEYS: (keyof Settings)[] = ['antialias', 'bloom', 'ao', 'fxaa', 'colorGrade', 'godRays', 'tiltShift', 'volumetric', 'shadows'];

/**
 * Optional post-processing. When every effect (and MSAA) is off the scene renders
 * straight to the canvas, costing nothing.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private fxaa: ShaderPass | null = null;
  private rays: ShaderPass | null = null;
  private tilt: ShaderPass | null = null;

  /** the sun, for volumetric light (it marches the sun's shadow map) */
  sun: THREE.DirectionalLight | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  static needsRebuild(changed: (keyof Settings)[]) {
    return changed.some((k) => PIPE_KEYS.includes(k));
  }

  rebuild(s: Settings) {
    // EffectComposer.dispose() only frees its own two buffers: each pass (bloom, AO, volumetric) holds full-screen
    // render targets of its own, which leaked on every graphics change
    for (const p of this.composer?.passes ?? []) p.dispose();
    this.composer?.dispose(); // its render targets take their depth textures with them
    this.composer = null;
    this.bloom = this.grade = this.fxaa = this.rays = this.tilt = null;
    const vol = s.volumetric && s.shadows !== 'off' && !!this.sun && this.camera instanceof THREE.PerspectiveCamera;
    if (!s.antialias && !s.bloom && !s.ao && !s.fxaa && !s.colorGrade && !s.godRays && !s.tiltShift && !vol) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: s.antialias ? 4 : 0 });
    // volumetric light reads the scene's depth: keep it in a texture
    if (vol) target.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
    const c = new EffectComposer(this.renderer, target);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (vol) c.addPass(new VolumetricPass(this.camera as THREE.PerspectiveCamera, this.sun!));
    if (s.ao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.blendIntensity = 0.8;
      c.addPass(ao);
    }
    if (s.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), s.bloomStrength, 0.4, 0.82);
      c.addPass(this.bloom);
    }
    if (s.godRays) {
      // on the HDR image, before tone mapping, so only what is truly bright streaks
      this.rays = new ShaderPass(GodRaysShader);
      c.addPass(this.rays);
    }
    c.addPass(new OutputPass());
    if (s.colorGrade) {
      this.grade = new ShaderPass(GradeShader);
      c.addPass(this.grade);
    }
    if (s.tiltShift) {
      this.tilt = new ShaderPass(TiltShader);
      c.addPass(this.tilt);
    }
    if (s.fxaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      c.addPass(this.fxaa);
    }
    this.composer = c;
    this.resize();
    this.tune(s);
  }

  /** Live-adjustable values (no pipeline rebuild needed). */
  tune(s: Settings) {
    if (this.bloom) this.bloom.strength = s.bloomStrength;
    if (this.grade) {
      this.grade.uniforms.saturation.value = s.saturation;
      this.grade.uniforms.contrast.value = s.contrast;
      this.grade.uniforms.vignette.value = s.vignette;
      this.grade.uniforms.warmth.value = s.warmth;
      this.grade.uniforms.sharpen.value = s.sharpen;
    }
  }

  resize() {
    if (!this.composer) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    const pr = this.renderer.getPixelRatio();
    this.grade?.uniforms.texel.value.set(1 / (size.x * pr), 1 / (size.y * pr));
    this.tilt?.uniforms.texel.value.set(1 / (size.x * pr), 1 / (size.y * pr));
    if (this.fxaa) {
      this.fxaa.uniforms.resolution.value.set(1 / (size.x * pr), 1 / (size.y * pr));
    }
  }

  /** Where the sun is on screen (uv, may be off screen) and how strong its shafts are this frame. */
  setSun(u: number, v: number, strength: number) {
    if (!this.rays) return;
    // sun out of view or down: skip the whole full-screen pass, not just its taps
    this.rays.enabled = strength > 0.001;
    this.rays.uniforms.sunPos.value.set(u, v);
    this.rays.uniforms.strength.value = strength;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Compile `o`'s shaders in the background for the pass that will really draw it: with effects on,
   * the scene renders into the composer's buffer (linear output, its own program variants).
   */
  compileAsync(o: THREE.Object3D): Promise<unknown> {
    const r = this.renderer, prev = r.getRenderTarget();
    if (this.composer) r.setRenderTarget(this.composer.readBuffer);
    const p = r.compileAsync(o, this.camera, this.scene);
    r.setRenderTarget(prev);
    return p;
  }
}
