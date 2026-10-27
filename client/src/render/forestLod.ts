// Distance LOD and shadow casting for the streamed forest (render/nature.ts tiles) and the grass cells.
//
// LOD: a tile draws its trees as one InstancedMesh per model part. A trunk part keeps every instance in its source mesh,
// which no camera draws (SOURCE_LAYER), and child buckets draw them: one per level, filled with the instances at that
// distance from the player every few metres walked. Leaves, bushes, rocks and grass draw as they are.
//
// Shadows: the sun's shadow camera covers a box around the player (the shadowRange setting), but a tile is 200 m and a
// grass cell 40 m, and three.js draws a whole InstancedMesh into the shadow map whenever its bounds touch the box. So
// no registered mesh casts itself: one caster mesh per part and level holds just the instances inside the box (with
// some slack), rebuilt after a few metres or when the sun has turned. The shadows are the same, drawn with ~40 draws
// instead of ~250 and none of the trees outside the box. The casters are hidden except while the shadow map renders
// (attach): in three r186 the shadow pass tests layers against the main camera, so a layer can't keep them apart.
import * as THREE from 'three';
import { settings } from '../settings';

/** No camera renders this layer: the trunk sources the buckets are filled from. */
const SOURCE_LAYER = 2;

/**
 * A trunk's levels (render/nature.ts builds them): from `from` m on, about `ratio` of its triangles, no vertex moved
 * more than `error` of the model's size (a few cm on a full-grown tree: under a pixel at those distances).
 */
export const TRUNK_LEVELS = [
  { from: 40, ratio: 0.25, error: 0.003 },
  { from: 100, ratio: 0.1, error: 0.006 },
];
/** level for a distance, capped by how many levels the part has */
const levelAt = (d: number, n: number) => Math.min(n - 1, d >= TRUNK_LEVELS[1].from ? 2 : d >= TRUNK_LEVELS[0].from ? 1 : 0);
/** metres walked before the buckets and the casters are sorted again */
const STEP = 3;
/** the casters cover the shadow box plus this much: a few steps and a slight turn of the sun stay inside it */
const SLACK = 6;
/** the sun may turn this much (cosine) before the casters are rebuilt: ~0.4°, under 2 m at the box's far corners */
const TURN = 0.99998;

interface Kind { mesh: THREE.InstancedMesh; n: number }
interface Source {
  mesh: THREE.InstancedMesh;
  /** levels, index 0 the full part; a single level draws the source itself */
  lods: THREE.BufferGeometry[];
  /** per level, the child that draws it (trunks only) */
  buckets: THREE.InstancedMesh[];
  /** per level, the caster it goes into */
  kinds: (Kind | undefined)[];
  /** it cast shadows before it was registered */
  cast: boolean;
  /** instanceMatrix.version and visibility last seen */
  version: number;
  shown: boolean;
  /** the single level all its instances were last put in, -1 when split */
  uniform: number;
  /** per instance: world-space bounding sphere (x, y, z, r) */
  inst: Float32Array;
}

const UP = new THREE.Vector3(0, 1, 0);
const L = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
const BOUNDS = new Float64Array(7 * 3);

/** the object and all its parents are visible */
function shown(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Whether a sphere (centre p, radius r) reaches into the sun's shadow box as it stands now (scene.ts follow). */
export function inShadowBox(sun: THREE.DirectionalLight, p: THREE.Vector3, r: number): boolean {
  const c = sun.target.position, cam = sun.shadow.camera;
  const dist = L.subVectors(sun.position, c).length();
  L.divideScalar(dist);
  R.crossVectors(UP, L);
  if (R.lengthSq() < 1e-8) R.set(1, 0, 0);
  R.normalize();
  U.crossVectors(L, R);
  const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
  const z = dx * L.x + dy * L.y + dz * L.z;
  return Math.abs(dx * R.x + dy * R.y + dz * R.z) <= (cam.right - cam.left) / 2 + r && Math.abs(dx * U.x + dy * U.y + dz * U.z) <= (cam.top - cam.bottom) / 2 + r
    && z >= dist - cam.far - r && z <= dist - cam.near + r;
}

function copy16(dst: THREE.TypedArray, j: number, src: THREE.TypedArray, i: number) {
  for (let k = 0; k < 16; k++) dst[j + k] = src[i + k];
}

export class ForestLod {
  /** the shadow casters: hidden except while the sun's shadow map renders */
  readonly casters = new THREE.Group();
  private sources = new Map<THREE.InstancedMesh, Source>();
  private kinds = new Map<string, Kind>();
  /** where the buckets were last sorted from */
  private lodAt = new THREE.Vector3(Infinity, 0, 0);
  /** the shadow box the casters were built for: centre, light direction and size */
  private boxAt = new THREE.Vector3(Infinity, 0, 0);
  private boxDir = new THREE.Vector3();
  private boxSize = 0;
  private castOn = false;
  /** attach() was called: the casters draw the shadows (without it every mesh keeps casting its own) */
  private attached = false;
  /** a source came, went, was shown or hidden, or had instances moved (a tree felled) */
  private dirty = true;

  constructor() {
    this.casters.visible = false;
    this.casters.matrixAutoUpdate = false;
  }

  /** Show the casters to the sun's shadow map and nowhere else. */
  attach(renderer: THREE.WebGLRenderer) {
    this.attached = true;
    const sm = renderer.shadowMap, render = sm.render.bind(sm);
    sm.render = (lights, scene, camera) => {
      this.casters.visible = true;
      try {
        render(lights, scene, camera);
      } finally {
        this.casters.visible = false;
      }
    };
  }

  /** Take over a streamed mesh's shadow (and its levels, if it has them in userData.lods). Call once it is in the scene. */
  add(mesh: THREE.Object3D) {
    if (!(mesh instanceof THREE.InstancedMesh) || this.sources.has(mesh)) return;
    const lods = (mesh.userData.lods as THREE.BufferGeometry[] | undefined) ?? [mesh.geometry];
    if (!mesh.castShadow && lods.length < 2) return;
    const cast = mesh.castShadow;
    const s: Source = { mesh, lods, buckets: [], kinds: [], cast: this.attached && cast, version: -1, shown: false, uniform: -1, inst: new Float32Array(mesh.count * 4) };
    if (this.attached) mesh.castShadow = false;
    mesh.geometry.boundingSphere ?? mesh.geometry.computeBoundingSphere();
    mesh.boundingSphere ?? mesh.computeBoundingSphere();
    if (lods.length > 1) {
      mesh.layers.set(SOURCE_LAYER);
      s.buckets = lods.map((g) => {
        const b = new THREE.InstancedMesh(g, mesh.material, mesh.count);
        if (mesh.instanceColor) b.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
        b.count = 0;
        b.visible = false;
        b.castShadow = !this.attached && cast;
        b.receiveShadow = mesh.receiveShadow;
        b.matrixAutoUpdate = false;
        b.boundingSphere = new THREE.Sphere();
        mesh.add(b);
        return b;
      });
    }
    this.sources.set(mesh, s);
    this.dirty = true;
  }

  /** Let go of a mesh that is leaving the scene (before it is disposed). */
  remove(mesh: THREE.Object3D) {
    const s = this.sources.get(mesh as THREE.InstancedMesh);
    if (!s) return;
    for (const b of s.buckets) mesh.remove(b), b.dispose();
    this.sources.delete(s.mesh);
    this.dirty = true;
  }

  /** Per frame, after the sun has been placed over the player `p`. */
  update(p: THREE.Vector3, sun: THREE.DirectionalLight) {
    const moved = this.lodAt.distanceToSquared(p) >= STEP * STEP;
    if (moved) this.lodAt.copy(p);
    for (const s of this.sources.values()) {
      const v = s.mesh.instanceMatrix.version, vis = shown(s.mesh), changed = v !== s.version || vis !== s.shown;
      if (v !== s.version) {
        s.version = v;
        s.uniform = -1;
        this.spheres(s);
      }
      if (changed) (s.shown = vis), (this.dirty = true);
      if ((changed || moved) && vis && s.buckets.length) this.fill(s);
    }
    this.cast(sun);
    this.dirty = false;
  }

  /** Each instance's bounding sphere in the world, from its matrix and the part's bounds. */
  private spheres(s: Source) {
    const n = s.mesh.count, a = s.mesh.instanceMatrix.array, bs = s.mesh.geometry.boundingSphere!, gc = bs.center;
    if (s.inst.length < n * 4) s.inst = new Float32Array(n * 4);
    const out = s.inst;
    for (let i = 0; i < n; i++) {
      const o = i * 16, j = i * 4;
      out[j] = a[o] * gc.x + a[o + 4] * gc.y + a[o + 8] * gc.z + a[o + 12];
      out[j + 1] = a[o + 1] * gc.x + a[o + 5] * gc.y + a[o + 9] * gc.z + a[o + 13];
      out[j + 2] = a[o + 2] * gc.x + a[o + 6] * gc.y + a[o + 10] * gc.z + a[o + 14];
      const sx = a[o] ** 2 + a[o + 1] ** 2 + a[o + 2] ** 2, sy = a[o + 4] ** 2 + a[o + 5] ** 2 + a[o + 6] ** 2, sz = a[o + 8] ** 2 + a[o + 9] ** 2 + a[o + 10] ** 2;
      out[j + 3] = bs.radius * Math.sqrt(Math.max(sx, sy, sz));
    }
  }

  /** Sort a trunk part's instances into its level buckets by their distance from lodAt. */
  private fill(s: Source) {
    const m = s.mesh, nl = s.lods.length, px = this.lodAt.x, pz = this.lodAt.z;
    // a whole part on one side of the level boundaries: one bucket, and nothing to redo while it stays there
    const bs = m.boundingSphere!, d0 = Math.hypot(bs.center.x - px, bs.center.z - pz);
    const lo = levelAt(Math.max(0, d0 - bs.radius), nl), hi = levelAt(d0 + bs.radius, nl);
    if (lo === hi && s.uniform === lo && s.buckets[lo].count === m.count) return;
    s.uniform = lo === hi ? lo : -1;
    const n = m.count, a = m.instanceMatrix.array, col = m.instanceColor?.array, inst = s.inst;
    const cnt = [0, 0, 0];
    BOUNDS.fill(Infinity, 0, 9);
    BOUNDS.fill(-Infinity, 9, 21);
    for (let i = 0; i < n; i++) {
      const j = i * 4, x = inst[j], y = inst[j + 1], z = inst[j + 2];
      const lv = lo === hi ? lo : levelAt(Math.hypot(x - px, z - pz), nl), k = cnt[lv]++, b = s.buckets[lv];
      copy16(b.instanceMatrix.array, k * 16, a, i * 16);
      if (col) for (let c = 0; c < 3; c++) b.instanceColor!.array[k * 3 + c] = col[i * 3 + c];
      const o = lv * 3;
      BOUNDS[o] = Math.min(BOUNDS[o], x), BOUNDS[o + 1] = Math.min(BOUNDS[o + 1], y), BOUNDS[o + 2] = Math.min(BOUNDS[o + 2], z);
      BOUNDS[9 + o] = Math.max(BOUNDS[9 + o], x), BOUNDS[10 + o] = Math.max(BOUNDS[10 + o], y), BOUNDS[11 + o] = Math.max(BOUNDS[11 + o], z);
      BOUNDS[18 + lv] = Math.max(BOUNDS[18 + lv], inst[j + 3]);
    }
    s.buckets.forEach((b, lv) => {
      b.count = cnt[lv];
      b.visible = cnt[lv] > 0;
      if (!b.visible) return;
      const o = lv * 3, sp = b.boundingSphere!;
      sp.center.set((BOUNDS[o] + BOUNDS[9 + o]) / 2, (BOUNDS[o + 1] + BOUNDS[10 + o]) / 2, (BOUNDS[o + 2] + BOUNDS[11 + o]) / 2);
      sp.radius = Math.hypot(BOUNDS[9 + o] - BOUNDS[o], BOUNDS[10 + o] - BOUNDS[o + 1], BOUNDS[11 + o] - BOUNDS[o + 2]) / 2 + BOUNDS[18 + lv];
      for (const attr of [b.instanceMatrix, b.instanceColor]) {
        if (!attr) continue;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, cnt[lv] * attr.itemSize);
        attr.needsUpdate = true;
      }
    });
  }

  /** Put the instances inside the sun's shadow box (plus SLACK) into the casters, at their level. */
  private cast(sun: THREE.DirectionalLight) {
    const on = this.attached && settings.s.shadows !== 'off' && sun.castShadow;
    if (!on) {
      if (this.castOn) for (const k of this.kinds.values()) k.mesh.visible = false;
      this.castOn = false;
      this.boxAt.set(Infinity, 0, 0);
      return;
    }
    const c = sun.target.position, cam = sun.shadow.camera;
    const dist = L.subVectors(sun.position, c).length();
    L.divideScalar(dist);
    const size = cam.right - cam.left;
    if (this.castOn && !this.dirty && size === this.boxSize && this.boxDir.dot(L) >= TURN && this.boxAt.distanceToSquared(c) < STEP * STEP) return;
    this.castOn = true;
    this.boxAt.copy(c);
    this.boxDir.copy(L);
    this.boxSize = size;
    // the shadow camera's axes: it sits `dist` along L from c, looking back at it with +y up (scene.ts follow)
    R.crossVectors(UP, L);
    if (R.lengthSq() < 1e-8) R.set(1, 0, 0);
    R.normalize();
    U.crossVectors(L, R);
    const hx = (cam.right - cam.left) / 2 + SLACK, hy = (cam.top - cam.bottom) / 2 + SLACK;
    const z0 = dist - cam.far - SLACK, z1 = dist - cam.near + SLACK;
    const px = this.lodAt.x, pz = this.lodAt.z;
    for (const k of this.kinds.values()) k.n = 0;
    for (const s of this.sources.values()) {
      if (!s.shown || !s.cast) continue;
      // the whole part outside the box: none of its instances can be inside
      const bs = s.mesh.boundingSphere!;
      let dx = bs.center.x - c.x, dy = bs.center.y - c.y, dz = bs.center.z - c.z;
      let x = dx * R.x + dy * R.y + dz * R.z, y = dx * U.x + dy * U.y + dz * U.z, z = dx * L.x + dy * L.y + dz * L.z;
      if (Math.abs(x) > hx + bs.radius || Math.abs(y) > hy + bs.radius || z < z0 - bs.radius || z > z1 + bs.radius) continue;
      const n = s.mesh.count, a = s.mesh.instanceMatrix.array, inst = s.inst, nl = s.lods.length;
      for (let i = 0; i < n; i++) {
        const j = i * 4, r = inst[j + 3];
        dx = inst[j] - c.x;
        dy = inst[j + 1] - c.y;
        dz = inst[j + 2] - c.z;
        x = dx * R.x + dy * R.y + dz * R.z;
        y = dx * U.x + dy * U.y + dz * U.z;
        z = dx * L.x + dy * L.y + dz * L.z;
        if (r === 0 || Math.abs(x) > hx + r || Math.abs(y) > hy + r || z < z0 - r || z > z1 + r) continue;
        const lv = nl > 1 ? levelAt(Math.hypot(inst[j] - px, inst[j + 2] - pz), nl) : 0;
        const k = (s.kinds[lv] ??= this.kind(s.lods[lv], s.mesh.material as THREE.Material));
        if (k.n === k.mesh.instanceMatrix.count) this.grow(k);
        copy16(k.mesh.instanceMatrix.array, k.n++ * 16, a, i * 16);
      }
    }
    for (const k of this.kinds.values()) {
      k.mesh.count = k.n;
      k.mesh.visible = k.n > 0;
      const im = k.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, k.n * 16);
      im.needsUpdate = true;
    }
  }

  private kind(geometry: THREE.BufferGeometry, material: THREE.Material): Kind {
    const key = `${geometry.uuid}|${material.uuid}`;
    let k = this.kinds.get(key);
    if (!k) this.kinds.set(key, (k = { mesh: this.caster(geometry, material, 64), n: 0 }));
    return k;
  }

  private caster(geometry: THREE.BufferGeometry, material: THREE.Material, size: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geometry, material, size);
    m.castShadow = true;
    m.frustumCulled = false; // already cut to the shadow box
    m.matrixAutoUpdate = false;
    m.count = 0;
    this.casters.add(m);
    return m;
  }

  /** Twice the room, keeping what is already in. */
  private grow(k: Kind) {
    const old = k.mesh, m = this.caster(old.geometry, old.material as THREE.Material, old.instanceMatrix.count * 2);
    (m.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, k.n * 16));
    this.casters.remove(old);
    old.dispose();
    k.mesh = m;
  }
}
