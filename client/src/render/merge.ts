// Fewer draws for models built from many small parts. The untextured parts of a rigid prop (a weapon, a helm) or of a
// creature's skinned body are merged into one mesh per material look, each part's colour carried per vertex: Lambert
// multiplies the material colour by the vertex colour, so white times the part's own colour shades exactly as before.
// Skinned parts that only differ in their Skeleton object (glTF gives every primitive its own, and SkeletonUtils.clone
// copies each) share one, so its bones are composed and uploaded once a frame instead of once a part.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A float copy of an attribute: positions, normals and weights may be quantized (KHR_mesh_quantization, meshopt). */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.itemSize, out = new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    out[i * n] = a.getX(i);
    if (n > 1) out[i * n + 1] = a.getY(i);
    if (n > 2) out[i * n + 2] = a.getZ(i);
    if (n > 3) out[i * n + 3] = a.getW(i);
  }
  return new THREE.BufferAttribute(out, n);
}

/** What a part's material must share with the others to be merged (null: it can't be, e.g. it has a texture). */
function lookOf(m: THREE.Material | THREE.Material[]): string | null {
  if (!(m instanceof THREE.MeshLambertMaterial) || m.map || m.emissiveMap || m.alphaMap || m.vertexColors || m.transparent || m.wireframe) return null;
  return [m.emissive.getHex(), m.emissiveIntensity, m.side, m.flatShading, m.opacity, m.customProgramCacheKey()].join('|');
}

/** One part, ready to merge: plain float attributes, indexed, its colour per vertex, moved by `matrix` if given. */
function part(g: THREE.BufferGeometry, color: THREE.Color, matrix: THREE.Matrix4 | null, skinned: boolean): THREE.BufferGeometry | null {
  const a = g.attributes;
  if (!a.position || !a.normal || (skinned && (!a.skinIndex || !a.skinWeight)) || Object.keys(g.morphAttributes).length || g.groups.length > 1) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', floats(a.position));
  out.setAttribute('normal', floats(a.normal));
  if (skinned) {
    const si = a.skinIndex, idx = new Uint16Array(si.count * 4);
    for (let i = 0; i < si.count; i++) (idx[i * 4] = si.getX(i)), (idx[i * 4 + 1] = si.getY(i)), (idx[i * 4 + 2] = si.getZ(i)), (idx[i * 4 + 3] = si.getW(i));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    out.setAttribute('skinWeight', floats(a.skinWeight));
  }
  const n = a.position.count;
  out.setIndex(g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i));
  if (matrix) out.applyMatrix4(matrix);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) (col[i * 3] = color.r), (col[i * 3 + 1] = color.g), (col[i * 3 + 2] = color.b);
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** The merged parts' material: the first part's, white, taking its colour from the vertices. */
function whiteOf(m: THREE.MeshLambertMaterial): THREE.MeshLambertMaterial {
  const w = m.clone();
  w.color.set(0xffffff);
  w.vertexColors = true;
  w.onBeforeCompile = m.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) w.customProgramCacheKey = m.customProgramCacheKey;
  return w;
}

/**
 * Merge a rigid prop's untextured parts, one mesh per material look, in place. Call once on the loaded prop: its clones
 * share the merged geometry and material. Parts with a texture, or with children of their own, stay as they are.
 */
export function mergeRigid(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), m4 = new THREE.Matrix4();
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    // a part with children, or with data of its own (a bow's string tips; glTF puts every node's name there too), is
    // looked up later: left alone
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.SkinnedMesh || o.children.length || Object.keys(o.userData).some((k) => k !== 'name')) return;
    const k = lookOf(o.material);
    if (k === null) return;
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => part(o.geometry, (o.material as THREE.MeshLambertMaterial).color, m4.multiplyMatrices(inv, o.matrixWorld), false));
    const merged = geos.every((g) => g) ? mergeGeometries(geos as THREE.BufferGeometry[]) : null;
    for (const g of geos) g?.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, whiteOf(list[0].material as THREE.MeshLambertMaterial));
    mesh.name = list.map((o) => o.name).join('+');
    mesh.castShadow = list.some((o) => o.castShadow);
    mesh.receiveShadow = list.some((o) => o.receiveShadow);
    for (const o of list) o.removeFromParent();
    root.add(mesh);
  }
}

/** Parts that can share one Skeleton: the same bones, in the same order, with the same inverse bind matrices. */
function sameSkeleton(a: THREE.Skeleton, b: THREE.Skeleton) {
  return a === b || (a.bones.length === b.bones.length && a.bones.every((x, i) => x === b.bones[i]) && a.boneInverses.every((x, i) => x.equals(b.boneInverses[i])));
}

/** Rebind skinned parts to one Skeleton wherever theirs are interchangeable. Returns how many skeletons are left. */
export function shareSkeletons(meshes: THREE.SkinnedMesh[]): number {
  const kept: THREE.Skeleton[] = [];
  for (const m of meshes) {
    const s = kept.find((k) => sameSkeleton(k, m.skeleton));
    if (!s) kept.push(m.skeleton);
    else if (s !== m.skeleton) m.bind(s, m.bindMatrix);
  }
  return kept.length;
}

/** How a template's skinned parts merge: per group, the parts (by their order in the model) and what replaces them. */
export interface SkinnedMerge { parts: number[]; geometry: THREE.BufferGeometry; material: THREE.Material }

/**
 * Plan the merge of a model's untextured skinned parts (in traversal order), parts with the same Skeleton bones and bind
 * matrix and the same material look going together. Build it once per model look and apply it to every copy.
 */
export function planSkinnedMerge(meshes: THREE.SkinnedMesh[]): SkinnedMerge[] {
  const groups = new Map<string, number[]>();
  const anchors: THREE.SkinnedMesh[] = [];
  meshes.forEach((m, i) => {
    const look = lookOf(m.material);
    if (look === null) return;
    let a = anchors.findIndex((x) => sameSkeleton(x.skeleton, m.skeleton) && x.bindMatrix.equals(m.bindMatrix));
    if (a < 0) a = anchors.push(m) - 1;
    const k = `${a}|${look}`;
    let l = groups.get(k);
    if (!l) groups.set(k, (l = []));
    l.push(i);
  });
  const out: SkinnedMerge[] = [];
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const geos = parts.map((i) => part(meshes[i].geometry, (meshes[i].material as THREE.MeshLambertMaterial).color, null, true));
    const geometry = geos.every((g) => g) ? mergeGeometries(geos as THREE.BufferGeometry[]) : null;
    for (const g of geos) g?.dispose();
    if (geometry) out.push({ parts, geometry, material: whiteOf(meshes[parts[0]].material as THREE.MeshLambertMaterial) });
  }
  return out;
}

/** Apply a merge plan to one copy of the model (its skinned parts in the same order). Returns the parts left. */
export function applySkinnedMerge(meshes: THREE.SkinnedMesh[], plan: SkinnedMerge[]): THREE.SkinnedMesh[] {
  const gone = new Set<number>(), added: THREE.SkinnedMesh[] = [];
  for (const { parts, geometry, material } of plan) {
    const first = meshes[parts[0]];
    if (!first?.parent || parts.some((i) => !meshes[i])) continue;
    const m = new THREE.SkinnedMesh(geometry, material);
    m.name = parts.map((i) => meshes[i].name).join('+');
    m.castShadow = parts.some((i) => meshes[i].castShadow);
    m.receiveShadow = parts.some((i) => meshes[i].receiveShadow);
    m.frustumCulled = first.frustumCulled;
    m.bind(first.skeleton, first.bindMatrix);
    first.parent.add(m);
    for (const i of parts) meshes[i].removeFromParent(), gone.add(i);
    added.push(m);
  }
  return [...meshes.filter((_, i) => !gone.has(i)), ...added];
}
