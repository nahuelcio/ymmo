import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Settings } from '../settings';

/** Saturation / contrast / vignette in one cheap full-screen pass. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    vignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.75, dot(d, d) * 2.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

const PIPE_KEYS: (keyof Settings)[] = ['antialias', 'bloom', 'ao', 'fxaa', 'colorGrade'];

/**
 * Optional post-processing. When every effect (and MSAA) is off the scene renders
 * straight to the canvas, costing nothing.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private fxaa: ShaderPass | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  static needsRebuild(changed: (keyof Settings)[]) {
    return changed.some((k) => PIPE_KEYS.includes(k));
  }

  rebuild(s: Settings) {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = this.grade = this.fxaa = null;
    if (!s.antialias && !s.bloom && !s.ao && !s.fxaa && !s.colorGrade) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: s.antialias ? 4 : 0 });
    const c = new EffectComposer(this.renderer, target);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (s.ao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.blendIntensity = 0.8;
      c.addPass(ao);
    }
    if (s.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), s.bloomStrength, 0.4, 0.82);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    if (s.colorGrade) {
      this.grade = new ShaderPass(GradeShader);
      c.addPass(this.grade);
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
    }
  }

  resize() {
    if (!this.composer) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    if (this.fxaa) {
      const pr = this.renderer.getPixelRatio();
      this.fxaa.uniforms.resolution.value.set(1 / (size.x * pr), 1 / (size.y * pr));
    }
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
