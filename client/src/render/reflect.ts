// The world mirrored in the water (Cinematic preset). The water is one flat plane, so a planar
// reflection is exact: three's Reflector renders the scene from the mirrored camera (oblique near
// plane, no shadow update) into a half-resolution HDR target, and the water shader (atmos.ts) samples
// it in place of the analytic sky, rippled by its normal. We only use the Reflector for that render;
// its own material is never drawn.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export class WaterReflection {
  private probe: Reflector | null = null;
  private worldInv = new THREE.Matrix4();
  private size = new THREE.Vector2();

  /** uniforms the water shader reads */
  constructor(private uniforms: { reflTex: { value: THREE.Texture | null }; reflMat: { value: THREE.Matrix4 }; reflOn: { value: number } }, private level: number) {}

  /** Render the reflection for this frame (call before the main render), or switch it off. */
  update(on: boolean, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, water: THREE.Object3D) {
    this.uniforms.reflOn.value = on ? 1 : 0;
    if (!on) {
      if (this.probe) this.dispose();
      return;
    }
    const s = renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.round(s.x / 2)), h = Math.max(1, Math.round(s.y / 2));
    if (!this.probe) {
      this.probe = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: w, textureHeight: h, clipBias: 0.003, multisample: 0 });
      this.probe.rotation.x = -Math.PI / 2;
      this.probe.position.y = this.level;
      this.probe.updateMatrixWorld(true);
      this.worldInv.copy(this.probe.matrixWorld).invert();
      this.uniforms.reflTex.value = this.probe.getRenderTarget().texture;
    }
    const rt = this.probe.getRenderTarget();
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    // the water itself must not show up in its own reflection
    const vis = water.visible;
    water.visible = false;
    this.probe.onBeforeRender(renderer, scene, camera, undefined as never, undefined as never, undefined as never);
    water.visible = vis;
    // the Reflector's matrix maps its local plane; the water shader works in world space
    const tm = (this.probe.material as THREE.ShaderMaterial).uniforms.textureMatrix.value as THREE.Matrix4;
    this.uniforms.reflMat.value.multiplyMatrices(tm, this.worldInv);
  }

  dispose() {
    this.probe?.geometry.dispose();
    this.probe?.dispose();
    this.probe = null;
    this.uniforms.reflTex.value = null;
  }
}
