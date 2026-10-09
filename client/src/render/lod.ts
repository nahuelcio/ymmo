// Level of detail for characters and monsters: far away they draw a simplified copy of each part.
// Only the index buffer is simplified (meshoptimizer); vertices, skin weights and bones are shared, so
// a far rig still animates and looks the same, just with fewer triangles. Copies are built in the
// background, a little per frame, and cached per part geometry (parts are shared between entities).
import * as THREE from 'three';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';

/** distance (m) from which each level is used, and the share of triangles it keeps */
const LEVELS = [
  { from: 30, ratio: 0.5 },
  { from: 60, ratio: 0.25 },
];
/** relative error the simplifier may introduce (of the part's size): invisible at those distances */
const MAX_ERROR = 0.02;
/** parts smaller than this keep their full mesh (nothing to gain) */
const MIN_TRIS = 300;

let ready = false;
void MeshoptSimplifier.ready.then(() => (ready = true));

/** per source geometry: its levels (index 0 = itself), or null while queued */
const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry[] | null>();
const queue: THREE.BufferGeometry[] = [];

export const lodLevel = (dist: number) => (dist >= LEVELS[1].from ? 2 : dist >= LEVELS[0].from ? 1 : 0);

function build(g: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const pos = g.attributes.position;
  if (!g.index || g.groups.length > 1 || g.index.count / 3 < MIN_TRIS || !pos || pos.itemSize !== 3) return [g];
  // positions may be quantized (meshopt / KHR_mesh_quantization): the simplifier wants plain floats
  const p = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) (p[i * 3] = pos.getX(i)), (p[i * 3 + 1] = pos.getY(i)), (p[i * 3 + 2] = pos.getZ(i));
  const idx = new Uint32Array(g.index.array);
  const out = [g];
  for (const { ratio } of LEVELS) {
    const target = Math.floor((idx.length * ratio) / 3) * 3;
    const [res] = MeshoptSimplifier.simplify(idx, p, 3, target, MAX_ERROR, ['LockBorder']);
    if (res.length >= idx.length * 0.9) break; // couldn't simplify much: not worth a level
    const lg = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) lg.setAttribute(name, a); // shared, no copy
    lg.morphAttributes = g.morphAttributes;
    lg.setIndex(new THREE.BufferAttribute(res, 1));
    lg.boundingBox = g.boundingBox;
    lg.boundingSphere = g.boundingSphere;
    out.push(lg);
  }
  return out;
}

/** Build a few queued levels; call once per frame. Stops after ~2 ms so it never causes a hitch. */
export function tickLod() {
  if (!ready || !queue.length) return;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 2) {
    const g = queue.shift()!;
    cache.set(g, build(g));
  }
}

/** An entity's current level; `done` is false while some of its parts still wait for their copies. */
export interface LodState { level: number; done: boolean }

/**
 * Switch an entity to the level for its distance. Its meshes are collected on every switch (equipment can
 * change); each remembers its full geometry in userData.lodBase. Baked per-entity meshes are left alone
 * (they are disposed with it). Levels not built yet are queued; the full mesh stays meanwhile.
 */
export function applyLod(root: THREE.Object3D, s: LodState, dist: number) {
  const want = lodLevel(dist);
  if (want === s.level && s.done) return;
  s.level = want;
  s.done = true;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.baked) return;
    const base = (o.userData.lodBase ??= o.geometry) as THREE.BufferGeometry;
    const levels = cache.get(base);
    if (levels === undefined) {
      cache.set(base, null);
      queue.push(base);
    }
    if (!levels) return void (s.done = false);
    o.geometry = levels[Math.min(want, levels.length - 1)];
  });
}
