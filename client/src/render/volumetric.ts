// Volumetric sunlight: light scattered by the air, shadowed by the world. For every pixel the ray from
// the camera to what it sees is marched through the sun's shadow map, so beams appear between trees,
// houses and rocks, brighter when looking towards the sun. Runs on the HDR image right after the scene
// render (before AO, bloom and tone mapping), reading that render's depth.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ATMOS } from './atmos';

const STEPS = 24;

const shader = (compare: boolean) => ({
  defines: { STEPS, SHADOW_COMPARE: compare ? 1 : 0 },
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tShadow: { value: null as THREE.Texture | null },
    projInv: { value: new THREE.Matrix4() },
    camWorld: { value: new THREE.Matrix4() },
    shadowMatrix: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    lightDir: { value: new THREE.Vector3() },
    lightColor: { value: new THREE.Color() },
    maxDist: { value: 80 },
    density: { value: 0.006 },
    frame: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #if SHADOW_COMPARE
      uniform sampler2DShadow tShadow;
    #else
      uniform sampler2D tShadow;
    #endif
    uniform sampler2D tDiffuse, tDepth;
    uniform mat4 projInv, camWorld, shadowMatrix;
    uniform vec3 camPos, lightDir, lightColor;
    uniform float maxDist, density, frame;
    varying vec2 vUv;

    float lit(vec3 p) {
      vec4 sc = shadowMatrix * vec4(p, 1.0);
      sc.xyz /= sc.w;
      if (any(lessThan(sc.xyz, vec3(0.0))) || any(greaterThan(sc.xyz, vec3(1.0)))) return 1.0; // outside the map: open sky
      #if SHADOW_COMPARE
        return texture(tShadow, vec3(sc.xy, sc.z - 0.002));
      #else
        return step(sc.z - 0.002, texture2D(tShadow, sc.xy).r);
      #endif
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float d = texture2D(tDepth, vUv).r;
      vec4 v = projInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 world = (camWorld * vec4(v.xyz / v.w, 1.0)).xyz;
      vec3 ray = world - camPos;
      float len = length(ray);
      vec3 dir = ray / len;
      len = d >= 1.0 ? maxDist : min(len, maxDist); // the sky: march the whole range
      // a different offset per pixel and per frame hides the steps; MSAA/TAA-free, so keep it subtle
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy + frame * 5.588238, vec2(0.06711056, 0.00583715))));
      float stepLen = len / float(STEPS);
      float acc = 0.0;
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) * stepLen;
        vec3 p = camPos + dir * t;
        // thicker near the ground, thins out with height
        float h = exp(-max(p.y, 0.0) * 0.035);
        acc += lit(p) * h * exp(-density * t);
      }
      acc *= stepLen * density;
      // Henyey-Greenstein: most of the light scatters forward, a glow around the sun
      float g = 0.55, c = dot(dir, lightDir);
      float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5) * 0.25;
      // mostly the glow towards the sun; only a little haze everywhere else, or it washes the image out
      base.rgb += lightColor * acc * (0.08 + phase);
      gl_FragColor = base;
    }`,
});

export class VolumetricPass extends Pass {
  private quad = new FullScreenQuad();
  private mats = [false, true].map((c) => new THREE.ShaderMaterial({ ...shader(c), depthTest: false, depthWrite: false }));
  private frame = 0;
  /** brightness of the scattered light (follows the sun: none at night unless the moon is up) */
  strength = 1;

  constructor(private camera: THREE.PerspectiveCamera, private sun: THREE.DirectionalLight) {
    super();
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const map = this.sun.shadow.map?.depthTexture;
    const compare = !!map?.compareFunction;
    const mat = this.mats[compare ? 1 : 0];
    const u = mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.tShadow.value = map ?? null;
    u.projInv.value.copy(this.camera.projectionMatrixInverse);
    u.camWorld.value.copy(this.camera.matrixWorld);
    u.shadowMatrix.value.copy(this.sun.shadow.matrix);
    u.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.lightDir.value.copy(ATMOS.lightDir);
    // the sun's own colour and strength, scaled to a gentle haze
    u.lightColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.3 * this.strength);
    u.maxDist.value = Math.min(90, this.sun.shadow.camera.right);
    u.frame.value = this.frame++ % 64;
    this.quad.material = mat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.quad.dispose();
    for (const m of this.mats) m.dispose();
  }
}
