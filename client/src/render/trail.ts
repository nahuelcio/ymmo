// A faint ribbon behind a weapon as it swings: the blade's base and tip sampled each frame while the blow is under
// way (quaternius.ts animateQ says when), fading out over a fraction of a second. Additive, so it reads as a streak of
// light on any background and costs nothing once it has faded (hidden).
import * as THREE from 'three';
import { settings } from '../settings';

/** samples kept (one a frame), and how long one lasts (s) */
const N = 10, LIFE = 0.12;
/** the streak's colour at full strength: a pale steel, kept low (it adds to what is behind it) */
const COLOR = new THREE.Color(0xc8d4e8).multiplyScalar(0.17);

export class WeaponTrail {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(N * 2 * 3);
  private col = new Float32Array(N * 2 * 3);
  /** each sample's base and tip (in the rig root's space) and its age, newest first */
  private samples: { base: THREE.Vector3; tip: THREE.Vector3; age: number }[] = [];
  /** the blade's base and tip in the weapon's own space */
  private base = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  private m = new THREE.Matrix4();

  /** held: the weapon as attached to the hand; root: the rig's root, which the ribbon is drawn in */
  constructor(private held: THREE.Object3D, private root: THREE.Object3D) {
    // the blade runs along the weapon's longest side, from the grip (nearest the hand) to the far end
    const box = new THREE.Box3();
    held.updateWorldMatrix(true, true);
    const toHeld = new THREE.Matrix4().copy(held.matrixWorld).invert();
    held.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toHeld, m.matrixWorld)));
    });
    const size = box.getSize(new THREE.Vector3()), axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : size.y > size.z ? 'y' : 'z';
    const far = Math.abs(box.max[axis]) > Math.abs(box.min[axis]) ? box.max[axis] : box.min[axis];
    const near = far === box.max[axis] ? box.min[axis] : box.max[axis];
    box.getCenter(this.tip);
    this.base.copy(this.tip);
    this.tip[axis] = far;
    this.base[axis] = near + (far - near) * 0.35;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  /** Every frame: on (the blow under way) adds where the blade is now; the samples age and fade either way. */
  update(on: boolean, dt: number) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > LIFE) this.samples.pop();
    if (on && settings.s.particles) {
      // the bones were posed for this frame after the last render: their world matrices are a frame old, which a
      // streak behind the blade does not show
      this.inv.copy(this.root.matrixWorld).invert();
      const m = this.m.multiplyMatrices(this.inv, this.held.matrixWorld);
      const s = this.samples.length === N ? this.samples.pop()! : { base: new THREE.Vector3(), tip: new THREE.Vector3(), age: 0 };
      s.base.copy(this.base).applyMatrix4(m);
      s.tip.copy(this.tip).applyMatrix4(m);
      s.age = 0;
      this.samples.unshift(s);
    }
    this.mesh.visible = this.samples.length > 1;
    if (!this.mesh.visible) return;
    for (let i = 0; i < N; i++) {
      const s = this.samples[Math.min(i, this.samples.length - 1)];
      s.base.toArray(this.pos, i * 6);
      s.tip.toArray(this.pos, i * 6 + 3);
      // brightest at the tip and the newest sample, nothing at the base and the oldest
      const k = i < this.samples.length ? Math.max(0, 1 - s.age / LIFE) * (1 - i / N) : 0;
      this.col.fill(0, i * 6, i * 6 + 3);
      this.col[i * 6 + 3] = COLOR.r * k;
      this.col[i * 6 + 4] = COLOR.g * k;
      this.col[i * 6 + 5] = COLOR.b * k;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
