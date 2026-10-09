// Textured outskirts: a curated slice of the nature pack, instanced per chunk.
// Assets: client/public/n (tools/scripts/n-assets.ts). Procedural props stay as the fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { heightAt, inTown, mulberry32, TOWN, TOWN_HEIGHT, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { layoutRocks, layoutTown, layoutTrees, nearCamp, roadDist, ROADS, zoneOf } from '../../../shared/src/layout';
import { sway } from './atmos';

const PIECES = [
  'PineTree_1', 'PineTree_2', 'PineTree_3',
  'NormalTree_1', 'NormalTree_2',
  'BirchTree_1', 'MapleTree_1',
  'DeadTree_1', 'DeadTree_2',
  'Bush_Small', 'Bush', 'Bush_Large', 'Bush_Small_Flowers', 'Bush_Flowers',
  'Grass_Small', 'Grass_Large',
  'Flower_1_Clump', 'Flower_3_Clump',
  'Rock_1', 'Rock_2', 'Rock_3',
] as const;

const PINES = ['PineTree_1', 'PineTree_2', 'PineTree_3'] as const;
const GREENS = ['NormalTree_1', 'NormalTree_2'] as const;
const AUTUMN = ['BirchTree_1', 'MapleTree_1'] as const;
const DEAD = ['DeadTree_1', 'DeadTree_2'] as const;
const BUSHES = ['Bush_Small', 'Bush', 'Bush_Large'] as const;
const BUSH_FLOWERS = ['Bush_Small_Flowers', 'Bush_Flowers'] as const;

type Mode = 'bark' | 'leaves' | 'bush' | 'grass' | 'flower' | 'rock';
const MODE: Record<Mode, { sway: number; side: THREE.Side; cutout: boolean }> = {
  bark: { sway: 0, side: THREE.FrontSide, cutout: false },
  leaves: { sway: 0.008, side: THREE.DoubleSide, cutout: true },
  bush: { sway: 0.03, side: THREE.DoubleSide, cutout: true },
  grass: { sway: 0.45, side: THREE.DoubleSide, cutout: false },
  flower: { sway: 0.5, side: THREE.DoubleSide, cutout: true },
  rock: { sway: 0, side: THREE.FrontSide, cutout: false },
};

interface Prim { geo: THREE.BufferGeometry; mat: THREE.MeshLambertMaterial }
const prims = new Map<string, Prim[]>();
const mats = new Map<string, THREE.MeshLambertMaterial>();
const texByFile = new Map<string, THREE.Texture>();
let ready = false;
let loading: Promise<void> | null = null;

export const natureReady = () => ready;

const CHUNK = 200;
const DETAIL_CHUNK = 40;
/** Pack bushes are about twice the old icosahedron clusters. */
const BUSH_FIT = 0.55;

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}
function fertile(x: number, z: number, h: number): boolean {
  return h > WATER_LEVEL + 1.2 && h < 22 && !inTown(x, z) && roadDist(x, z) > 3.2 && !nearCamp(x, z, 16);
}

function fileOf(map: THREE.Texture): string {
  const img = map.image as { currentSrc?: string; src?: string } | undefined;
  return (img?.currentSrc || img?.src || map.name || map.uuid).split('/').pop()?.split('?')[0] ?? map.uuid;
}

function modeOf(piece: string, matName: string): Mode {
  if (piece.startsWith('Rock')) return 'rock';
  if (piece.startsWith('Grass')) return 'grass';
  if (piece.startsWith('Flower')) return 'flower';
  if (piece.startsWith('Bush')) return 'bush';
  if (/Bark|Trunk/.test(matName)) return 'bark';
  return 'leaves';
}

function bake(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.clone();
  for (const name of ['position', 'normal']) {
    const attr = g.getAttribute(name);
    if (!attr || attr.array instanceof Float32Array) continue;
    const f = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      f[i * 3] = attr.getX(i);
      f[i * 3 + 1] = attr.getY(i);
      f[i * 3 + 2] = attr.getZ(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(f, 3));
  }
  g.applyMatrix4(matrix);
  return g;
}

/** Sit the whole model on y = 0 without sliding its parts apart. */
function ground(list: Prim[]) {
  let minY = Infinity;
  for (const p of list) {
    p.geo.computeBoundingBox();
    minY = Math.min(minY, p.geo.boundingBox!.min.y);
  }
  if (!Number.isFinite(minY) || Math.abs(minY) < 1e-4) return;
  for (const p of list) {
    p.geo.translate(0, -minY, 0);
    p.geo.computeBoundingBox();
  }
}

/** Match the old unit dodecahedron so layoutRocks' scale and collision still line up. */
function fitRock(geo: THREE.BufferGeometry) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = new THREE.Vector3(), center = new THREE.Vector3();
  bb.getSize(size);
  bb.getCenter(center);
  const fit = 2 / Math.max(size.x, size.y, size.z);
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(fit, fit, fit);
  geo.computeBoundingBox();
}

function material(map: THREE.Texture, mode: Mode): THREE.MeshLambertMaterial {
  const file = fileOf(map);
  const shared = texByFile.get(file);
  const tex = shared ?? map;
  if (!shared) texByFile.set(file, map);
  else if (map !== shared) map.dispose();
  const key = `${file}|${mode}`;
  const hit = mats.get(key);
  if (hit) return hit;
  const def = MODE[mode];
  const m = new THREE.MeshLambertMaterial({
    map: tex,
    color: 0xffffff,
    side: def.side,
    alphaTest: def.cutout ? 0.45 : 0,
    depthWrite: true,
  });
  if (def.sway) sway(m, def.sway);
  m.customProgramCacheKey = () => `nature|${mode}|${def.sway}`;
  mats.set(key, m);
  return m;
}

export function loadNature(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltfs = await Promise.all(PIECES.map((f) => loader.loadAsync(`n/${f}.gltf`)));
    PIECES.forEach((name, i) => {
      const root = gltfs[i].scene;
      root.updateMatrixWorld(true);
      const list: Prim[] = [];
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const std = o.material as THREE.MeshStandardMaterial;
        const map = std.map;
        if (!map) return;
        const geo = bake(o.geometry, o.matrixWorld);
        if (name.startsWith('Rock')) fitRock(geo);
        list.push({ geo, mat: material(map, modeOf(name, std.name)) });
      });
      if (!name.startsWith('Rock')) ground(list);
      prims.set(name, list);
    });
    ready = prims.size === PIECES.length && [...prims.values()].every((l) => l.length > 0);
  })());
}

interface Item { m: THREE.Matrix4; x: number; z: number; piece: string; prim: number; c?: THREE.Color }

function chunked(items: Item[], chunk: number): THREE.Group {
  const g = new THREE.Group();
  const buckets = new Map<string, Item[]>();
  for (const it of items) {
    const k = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}|${it.piece}|${it.prim}`;
    let l = buckets.get(k);
    if (!l) buckets.set(k, (l = []));
    l.push(it);
  }
  for (const [k, list] of buckets) {
    const prim = prims.get(list[0].piece)?.[list[0].prim];
    if (!prim) continue;
    const mesh = new THREE.InstancedMesh(prim.geo, prim.mat, list.length);
    const tinted = list.some((it) => it.c);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (tinted) mesh.setColorAt(i, it.c ?? WHITE);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (chunk === DETAIL_CHUNK) {
      const [ix, iz] = k.split('|')[0].split(',').map(Number);
      mesh.userData.cx = (ix + 0.5) * chunk;
      mesh.userData.cz = (iz + 0.5) * chunk;
    }
    g.add(mesh);
  }
  return g;
}

const WHITE = new THREE.Color(0xffffff);
const DRY = new THREE.Color(1, 0.92, 0.5);
const PARCHED = new THREE.Color(1, 0.98, 0.75);
const up = new THREE.Vector3(0, 1, 0);

function spawn(piece: string, m: THREE.Matrix4, x: number, z: number, c?: THREE.Color): Item[] {
  const mm = m.clone();
  const n = prims.get(piece)?.length ?? 0;
  const out: Item[] = [];
  for (let prim = 0; prim < n; prim++) out.push({ m: mm, x, z, piece, prim, c });
  return out;
}

export function buildNatureTrees(): THREE.Group {
  const items: Item[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (const t of layoutTrees()) {
    const u = hash(t.x, t.z);
    const piece = t.dead ? pick(DEAD, u) : t.pine ? pick(PINES, u) : u < 0.3 ? pick(AUTUMN, u / 0.3) : pick(GREENS, (u - 0.3) / 0.7);
    const m = new THREE.Matrix4().compose(p.set(t.x, t.h - 0.1, t.z), q.setFromAxisAngle(up, t.rot), s.set(t.sc, t.sc, t.sc));
    items.push(...spawn(piece, m, t.x, t.z));
  }
  return chunked(items, CHUNK);
}

export function buildNatureRocks(): THREE.Group {
  const items: Item[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  for (const r of layoutRocks()) {
    const piece = pick(ROCKS, hash(r.x, r.z));
    const m = new THREE.Matrix4().compose(p.set(r.x, r.y, r.z), q.setFromEuler(e.set(r.e[0], r.e[1], r.e[2])), s.set(r.s[0], r.s[1], r.s[2]));
    items.push(...spawn(piece, m, r.x, r.z));
  }
  return chunked(items, CHUNK);
}

const ROCKS = ['Rock_1', 'Rock_2', 'Rock_3'] as const;

export function buildNatureBushes(): THREE.Group {
  const rng = mulberry32(21);
  const items: Item[] = [];
  const q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0, n = 0; i < 4000 && n < 1400; i++) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.9, z = (rng() * 2 - 1) * WORLD_HALF * 0.9, h = heightAt(x, z);
    if (!fertile(x, z, h) || zoneOf(x, z)?.id === 'wastes') continue;
    const sc = (0.7 + rng() * 0.8) * BUSH_FIT;
    rng(); // the old blob's vertical squash; kept so later samples stay put
    const u = hash(x, z);
    const piece = u < 0.18 ? pick(BUSH_FLOWERS, u / 0.18) : pick(BUSHES, (u - 0.18) / 0.82);
    const m = new THREE.Matrix4().compose(p.set(x, h - 0.1, z), q.setFromAxisAngle(up, rng() * 6.3), sv.set(sc, sc, sc));
    items.push(...spawn(piece, m, x, z));
    n++;
  }
  return chunked(items, CHUNK);
}

export function buildNatureDetail(): THREE.Group {
  const rng = mulberry32(77);
  const items: Item[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const n = Math.ceil((WORLD_HALF * 2 * 0.86) / DETAIL_CHUNK);
  for (let cx = 0; cx < n; cx++)
    for (let cz = 0; cz < n; cz++) {
      const x0 = -WORLD_HALF * 0.86 + cx * DETAIL_CHUNK, z0 = -WORLD_HALF * 0.86 + cz * DETAIL_CHUNK;
      for (let i = 0; i < 520; i++) {
        const x = x0 + rng() * DETAIL_CHUNK, z = z0 + rng() * DETAIL_CHUNK, h = heightAt(x, z);
        const r1 = rng(), r2 = rng(), r3 = rng();
        if (!fertile(x, z, h)) continue;
        const zone = zoneOf(x, z)?.id;
        const sc = 0.7 + r1 * 0.9;
        const m = m4.compose(p.set(x, h - 0.05, z), q.setFromAxisAngle(up, r2 * 6.3), sv.set(sc, sc, sc)).clone();
        if (r3 < (zone === 'meadows' ? 0.09 : zone ? 0.015 : 0.04) && zone !== 'wastes') {
          items.push(...spawn(r1 < 0.5 ? 'Flower_1_Clump' : 'Flower_3_Clump', m, x, z));
        } else {
          const dry = zone === 'wastes' ? 1 : zone === 'barracks' ? 0.5 : 0;
          const tint = dry === 1 ? DRY : dry === 0.5 ? PARCHED : WHITE;
          items.push(...spawn(r1 > 0.72 ? 'Grass_Large' : 'Grass_Small', m, x, z, c.copy(tint).clone()));
        }
      }
    }
  return chunked(items, DETAIL_CHUNK);
}

/** Alba's yards and the inside of the curtain. Kept out of mergeStatic so the albedo UVs survive. */
export function buildNatureTown(): THREE.Group {
  const items: Item[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const place = (piece: string, x: number, y: number, z: number, rot: number, sc: number) => {
    const m = new THREE.Matrix4().compose(p.set(x, y, z), q.setFromAxisAngle(up, rot), s.set(sc, sc, sc));
    items.push(...spawn(piece, m, x, z));
  };
  const world = (ox: number, oz: number, rot: number, lx: number, lz: number) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    return { x: ox + lx * c + lz * sn, z: oz - lx * sn + lz * c };
  };

  const houses = layoutTown().houses.filter((h) => !h.out && !h.kind);
  for (const h of houses) {
    const bx = h.w / 2 + 1.7;
    for (let k = 0; k < 6; k++) {
      const at = world(h.x, h.z, h.rot, bx - 0.6 + (k % 2) * 1.2, -1 + (k >> 1));
      const flower = k % 3 === 0;
      place(flower ? (k < 3 ? 'Flower_1_Clump' : 'Flower_3_Clump') : 'Grass_Small', at.x, TOWN_HEIGHT + 0.22, at.z, h.rot + k, flower ? 0.55 : 0.85);
    }
    const rockAt = world(h.x, h.z, h.rot, bx + 1.55, 1.5);
    const rs = 0.28 + hash(h.x, h.z) * 0.12;
    place(pick(ROCKS, hash(h.x, h.z)), rockAt.x, TOWN_HEIGHT + rs * 0.15, rockAt.z, hash(h.z, h.x) * 6.3, rs);
  }

  // Same scatter as the old hedge, including the barrel coin-flip so the yards stay put.
  const rng = mulberry32(21);
  for (const h of houses) if (!h.kind) rng();
  const roads = ROADS.map(([ax, az, bx, bz]) => Math.atan2(bz - az, bx - ax));
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng() * 0.05;
    if (roads.some((r) => Math.abs(Math.atan2(Math.sin(a - r), Math.cos(a - r))) < 0.22)) continue;
    const rad = TOWN.r - 1.2 - rng() * 0.7, sc = 0.8 + rng() * 0.6;
    rng();
    const x = TOWN.x + Math.cos(a) * rad, z = TOWN.z + Math.sin(a) * rad;
    const rot = rng() * 3;
    if (i % 5 === 0) {
      const rs = sc * 0.42;
      place(pick(ROCKS, hash(x, z)), x, TOWN_HEIGHT + rs * 0.15, z, rot, rs);
    } else place(i % 3 === 0 ? 'Bush_Small_Flowers' : 'Bush_Small', x, TOWN_HEIGHT, z, rot, sc * 0.42);
  }
  return chunked(items, CHUNK);
}
