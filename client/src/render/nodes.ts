// World nodes on screen (shared/src/nodes.ts): a felled tree falls and leaves a stump, a mined rock shrinks to
// rubble, a picked bush loses its berries, and all of it comes back when the server says so. Works on the
// nature chunks' instances (render/nature.ts nodeInstances): nothing runs per frame except a fall in progress.
import * as THREE from 'three';
import { layoutBushes, layoutTrees } from '../../../shared/src/layout';
import { allNodes, nodeById, nodeIndex, type NodeDef } from '../../../shared/src/nodes';
import { heightAt } from '../../../shared/src/terrain';
import { natureReady, nodeInstances } from './nature';

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const FALL_MS = 1400;

interface Fall { g: THREE.Group; t0: number; axis: THREE.Vector3; pivot: THREE.Vector3 }

export class NodeVisuals {
  private gone = new Set<number>();
  /** each node's instance matrices before they were changed */
  private saved = new Map<number, THREE.Matrix4[]>();
  private stumps: THREE.InstancedMesh;
  private stumpSlot = new Map<number, number>();
  private freeStumps: number[] = [];
  private berries: THREE.InstancedMesh;
  private berrySlot = new Map<number, number>();
  private falls: Fall[] = [];

  constructor(private scene: THREE.Scene) {
    // stumps: a short tapered log, one pooled instance per felled tree
    const stumpGeo = new THREE.CylinderGeometry(0.3, 0.38, 0.5, 9).translate(0, 0.25, 0);
    this.stumps = new THREE.InstancedMesh(stumpGeo, new THREE.MeshLambertMaterial({ color: 0x6a4a2c }), 256);
    for (let i = 255; i >= 0; i--) {
      this.stumps.setMatrixAt(i, HIDDEN);
      this.freeStumps.push(i);
    }
    this.stumps.castShadow = this.stumps.receiveShadow = true;
    this.stumps.frustumCulled = false;
    // berries: a cluster of red drops on every fruit bush
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4, r = 0.28 + (k % 3) * 0.08;
      parts.push(new THREE.IcosahedronGeometry(0.06, 0).translate(Math.cos(a) * r, 0.35 + (k % 2) * 0.18, Math.sin(a) * r).toNonIndexed());
    }
    const berryGeo = mergeAll(parts);
    // only over the textured bushes (the procedural fallback scatters its own, elsewhere)
    const bushes = layoutBushes(), fruit = natureReady() ? allNodes().filter((n) => n.kind === 'bush') : [];
    this.berries = new THREE.InstancedMesh(berryGeo, new THREE.MeshLambertMaterial({ color: 0xc0283c, emissive: 0x300008 }), fruit.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    fruit.forEach((n, i) => {
      const b = bushes[nodeIndex(n)];
      const sc = b.sc * 0.9;
      this.berries.setMatrixAt(i, m.compose(p.set(b.x, b.h, b.z), q.setFromAxisAngle(UP, b.rot), s.set(sc, sc, sc)));
      this.berrySlot.set(n.id, i);
    });
    this.berries.computeBoundingSphere();
    this.berries.castShadow = false;
    for (const o of [this.stumps, this.berries]) {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
      scene.add(o);
    }
  }

  isGone(id: number) {
    return this.gone.has(id);
  }

  /** Spent or back. `animate`: play the fall (only for what happens near the player). */
  setGone(id: number, gone: boolean, animate = false) {
    if (this.gone.has(id) === gone) return;
    const n = nodeById(id);
    if (!n || n.kind === 'seat') return;
    if (gone) this.gone.add(id);
    else this.gone.delete(id);
    if (n.kind === 'bush') return this.setBerries(n, !gone);
    const inst = nodeInstances.get(id) ?? [];
    if (gone) {
      this.saved.set(id, inst.map(({ mesh, i }) => {
        const mm = new THREE.Matrix4();
        mesh.getMatrixAt(i, mm);
        return mm;
      }));
      if (n.kind === 'tree') {
        if (animate) this.fall(n, inst);
        for (const { mesh, i } of inst) setAt(mesh, i, HIDDEN);
        this.showStump(n, true);
      } else {
        // a mined rock: sunk and shrunk to rubble
        const saved = this.saved.get(id)!;
        inst.forEach(({ mesh, i }, k) => {
          const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
          saved[k].decompose(pos, q, sc);
          sc.multiplyScalar(0.35);
          pos.y = heightAt(n.x, n.z) + sc.y * 0.2;
          setAt(mesh, i, new THREE.Matrix4().compose(pos, q, sc));
        });
      }
    } else {
      const saved = this.saved.get(id);
      inst.forEach(({ mesh, i }, k) => saved?.[k] && setAt(mesh, i, saved[k]));
      this.saved.delete(id);
      if (n.kind === 'tree') this.showStump(n, false);
    }
  }

  private setBerries(n: NodeDef, on: boolean) {
    const i = this.berrySlot.get(n.id);
    if (i === undefined) return;
    const bushes = layoutBushes(), b = bushes[nodeIndex(n)];
    const sc = b.sc * 0.9;
    setAt(this.berries, i, on ? new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.h, b.z), new THREE.Quaternion().setFromAxisAngle(UP, b.rot), new THREE.Vector3(sc, sc, sc)) : HIDDEN);
  }

  private showStump(n: NodeDef, on: boolean) {
    if (on) {
      const i = this.freeStumps.pop();
      if (i === undefined) return;
      this.stumpSlot.set(n.id, i);
      const t = layoutTrees()[nodeIndex(n)];
      setAt(this.stumps, i, new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.h - 0.1, t.z), new THREE.Quaternion().setFromAxisAngle(UP, t.rot), new THREE.Vector3(t.sc, t.sc, t.sc)));
    } else {
      const i = this.stumpSlot.get(n.id);
      if (i === undefined) return;
      this.stumpSlot.delete(n.id);
      this.freeStumps.push(i);
      setAt(this.stumps, i, HIDDEN);
    }
  }

  /** A copy of the tree that tips over away from the woodcutter and sinks out of sight. */
  private fall(n: NodeDef, inst: { mesh: THREE.InstancedMesh; i: number }[]) {
    const g = new THREE.Group();
    const m = new THREE.Matrix4();
    for (const { mesh, i } of inst) {
      mesh.getMatrixAt(i, m);
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.applyMatrix4(m);
      copy.castShadow = true;
      g.add(copy);
    }
    const t = layoutTrees()[nodeIndex(n)];
    const dir = Math.random() * Math.PI * 2;
    // pivot at the base of the trunk; the group is moved so it rotates about it
    const pivot = new THREE.Vector3(t.x, t.h - 0.1, t.z);
    const holder = new THREE.Group();
    holder.position.copy(pivot);
    g.position.sub(pivot);
    holder.add(g);
    this.scene.add(holder);
    this.falls.push({ g: holder, t0: performance.now(), axis: new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir)), pivot });
  }

  /** Per frame, only while a tree is falling. */
  update() {
    if (!this.falls.length) return;
    const now = performance.now();
    this.falls = this.falls.filter((f) => {
      const k = (now - f.t0) / FALL_MS;
      if (k >= 1) {
        this.scene.remove(f.g);
        return false;
      }
      // accelerates like a real fall, then the trunk sinks into the ground
      const tip = Math.min(1, k * 1.4) ** 2 * (Math.PI / 2 - 0.08);
      f.g.quaternion.setFromAxisAngle(f.axis, tip);
      f.g.position.copy(f.pivot).setY(f.pivot.y - Math.max(0, k - 0.7) * 6);
      return true;
    });
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function setAt(mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4) {
  mesh.setMatrixAt(i, m);
  mesh.instanceMatrix.needsUpdate = true;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    p.computeVertexNormals();
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
