// Textured outskirts: a curated slice of the nature pack, instanced per chunk.
// Assets: client/public/n (tools/scripts/n-assets.ts). Procedural props stay as the fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { basis } from '../assets';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { biomeWeight, heightAt, valueNoise, mulberry32, regionAt, TOWN, TOWN_HEIGHT, WORLD_HALF } from '../../../shared/src/terrain';
import { fertile, layoutBushes, roadDist, layoutRocks, layoutTown, layoutTrees, ROADS, spotHash, zoneOf } from '../../../shared/src/layout';
import { sway } from './atmos';
import { NODE_BASE, nodeById } from '../../../shared/src/nodes';

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
// Leaf tints per biome (instance colour multiplies the texture; over 1 brightens it).
// ponytail: tints are hand-picked constants, one per biome; a per-region palette table is the upgrade if more pile up
const FROSTED = new THREE.Color(0.6, 0.78, 0.95);
const DARK_PINE = new THREE.Color(0.72, 0.8, 0.78);
const LUSH = new THREE.Color(0.62, 0.92, 0.55);
const GIANT = new THREE.Color(0.68, 0.88, 0.62);
/** the dusk lands' autumn: deep red maples, copper, and pale gold birches */
const FALL = [new THREE.Color(1.05, 0.62, 0.5), new THREE.Color(1.1, 0.85, 0.6), new THREE.Color(1.15, 1, 0.8)];
const CHARRED = new THREE.Color(0.32, 0.3, 0.3);
const BLEACHED = new THREE.Color(0.8, 0.78, 0.82);
/** the steppes' golden grass and the ash lands' rocks */
const GOLDEN = new THREE.Color(1.25, 1.0, 0.45);
const BASALT = new THREE.Color(0.35, 0.32, 0.32);
const MIRE = new THREE.Color(0.55, 0.62, 0.42);
/** the swamp's grass, dark and wet */
const BOGGY = new THREE.Color(0.6, 0.7, 0.46);
/** wildflower petals: white, butter yellow, pink, poppy red, lilac */
const PETALS = [new THREE.Color(1, 1, 0.96), new THREE.Color(1, 0.86, 0.25), new THREE.Color(1, 0.55, 0.72), new THREE.Color(0.95, 0.22, 0.18), new THREE.Color(0.72, 0.55, 1)];
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

/**
 * The crowns between the camera and the player are seen through: from this low camera they hid the player all the way
 * through a forest. Leaves inside a capsule from the camera to the player's chest (wider toward the camera) are thinned
 * out by an ordered dither (no sorting: the leaves stay opaque cut-outs), up to most of them at its axis. Shadows don't
 * change (they render with their own depth material). game.ts sets the ends every frame.
 */
const SEE = { uSeeCam: { value: new THREE.Vector3() }, uSeeFocus: { value: new THREE.Vector3() }, uSeeOn: { value: 0 } };
export function setSeeThrough(cam: THREE.Vector3, focus: THREE.Vector3 | null) {
  SEE.uSeeOn.value = focus ? 1 : 0;
  SEE.uSeeCam.value.copy(cam);
  if (focus) SEE.uSeeFocus.value.copy(focus);
}
function seeThrough(m: THREE.Material) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, SEE);
    sh.vertexShader = `varying vec3 vSeeW;\n${sh.vertexShader}`.replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
      #ifdef USE_INSTANCING
        vSeeW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vSeeW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = `uniform vec3 uSeeCam, uSeeFocus;\nuniform float uSeeOn;\nvarying vec3 vSeeW;\n${sh.fragmentShader}`.replace('#include <alphatest_fragment>', /* glsl */ `#include <alphatest_fragment>
      if (uSeeOn > 0.5) {
        vec3 ab = uSeeFocus - uSeeCam;
        float t = dot(vSeeW - uSeeCam, ab) / max(dot(ab, ab), 1e-4);
        if (t > 0.0 && t < 1.0) {
          float rad = mix(2.6, 1.2, t), d = length(vSeeW - (uSeeCam + ab * t));
          float thin = (1.0 - smoothstep(rad * 0.45, rad, d)) * 0.85;
          const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
          ivec2 px = ivec2(mod(gl_FragCoord.xy, 4.0));
          if (thin > (B[px.x + px.y * 4] + 0.5) / 16.0) discard;
        }
      }`);
  };
}

interface Prim { geo: THREE.BufferGeometry; mat: THREE.MeshLambertMaterial }
const prims = new Map<string, Prim[]>();
const mats = new Map<string, THREE.MeshLambertMaterial>();
const texByFile = new Map<string, THREE.Texture>();
let ready = false;
let loading: Promise<void> | null = null;

export const natureReady = () => ready;

/** The instances that draw each world node (shared/src/nodes.ts), so render/nodes.ts can fell, empty or restore it. */
export const nodeInstances = new Map<number, { mesh: THREE.InstancedMesh; i: number }[]>();
/** Called with the node ids a freshly streamed tile just drew (render/nodes.ts re-applies felled/mined state). */
export const nodeHooks = { built: (_ids: number[]) => {} };
/** A streamed tile is going away: forget its instances in nodeInstances. */
export function dropNodeInstances(meshes: THREE.Object3D[]) {
  for (const m of meshes) for (const id of (m.userData.nodes as number[] | undefined) ?? []) {
    const l = nodeInstances.get(id)?.filter((e) => e.mesh !== m);
    if (l?.length) nodeInstances.set(id, l);
    else nodeInstances.delete(id);
  }
}

const CHUNK = 200;
const DETAIL_CHUNK = 40;
const DETAIL_PER_CELL = 440;
/** Pack bushes are about twice the old icosahedron clusters. */
const BUSH_FIT = 0.55;

const hash = spotHash;
function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
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
  if (mode === 'leaves') seeThrough(m);
  if (mode === 'flower') {
    // the pack's petals are all one teal: grey them out and let the instance colour paint them, stems keep their green
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      base.call(m, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', /* glsl */ `
        #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
          float petal = smoothstep(0.04, 0.2, diffuseColor.b - diffuseColor.r);
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vColor * (0.35 + lum * 1.6), petal);
        #endif`);
    };
  }
  m.customProgramCacheKey = () => `nature|${mode}|${def.sway}`;
  mats.set(key, m);
  return m;
}

export function loadNature(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(basis());
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

interface Item { m: THREE.Matrix4; x: number; z: number; piece: string; prim: number; c?: THREE.Color; node?: number }

/** Instanced meshes per world chunk and model; with `cell`, everything is that one cell's (centred there). */
function chunked(items: Item[], chunk: number, cell?: { cx: number; cz: number }): THREE.Group {
  const g = new THREE.Group();
  const buckets = new Map<string, Item[]>();
  for (const it of items) {
    const k = `${cell ? '0,0' : `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`}|${it.piece}|${it.prim}`;
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
      if (it.node !== undefined) {
        (mesh.userData.nodes ??= []).push(it.node);
        let l = nodeInstances.get(it.node);
        if (!l) nodeInstances.set(it.node, (l = []));
        l.push({ mesh, i });
      }
    });
    mesh.castShadow = true;
    // ponytail: cutout foliage casts shadows but does not receive them: leaf cards shadowing each other stamped crisp dark leaf blotches all over the crowns. Upgrade path: soft per-tree shading instead.
    mesh.receiveShadow = !prim.mat.alphaTest;
    mesh.computeBoundingSphere();
    // every chunk size gets its center so follow() can hide the far ones
    const [ix, iz] = k.split('|')[0].split(',').map(Number);
    mesh.userData.cx = cell ? cell.cx : (ix + 0.5) * chunk;
    mesh.userData.cz = cell ? cell.cz : (iz + 0.5) * chunk;
    g.add(mesh);
  }
  return g;
}

const WHITE = new THREE.Color(0xffffff);
const DRY = new THREE.Color(1, 0.92, 0.5);
const PARCHED = new THREE.Color(1, 0.98, 0.75);
const up = new THREE.Vector3(0, 1, 0);

/** leafOnly: the tint skips the opaque parts (trunks keep their bark). */
function spawn(piece: string, m: THREE.Matrix4, x: number, z: number, c?: THREE.Color, node?: number, leafOnly = false): Item[] {
  const mm = m.clone();
  const list = prims.get(piece) ?? [];
  const out: Item[] = [];
  list.forEach((p, prim) => out.push({ m: mm, x, z, piece, prim, c: leafOnly && !p.mat.alphaTest ? undefined : c, node }));
  return out;
}

/** One streamed tile's trees, rocks and bushes (indices into layoutTrees/Rocks/Bushes). */
export function natureTile(idx: { trees: number[]; rocks: number[]; bushes: number[] }): THREE.Object3D[] {
  const g = [buildNatureTrees(idx.trees), buildNatureRocks(idx.rocks), buildNatureBushes(idx.bushes)];
  const out = g.flatMap((x) => [...x.children]);
  nodeHooks.built(out.flatMap((m) => (m.userData.nodes as number[] | undefined) ?? []));
  return out;
}

function buildNatureTrees(idx: number[]): THREE.Group {
  const items: Item[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const all = layoutTrees();
  idx.forEach((treeIdx) => {
    const t = all[treeIdx];
    const u = hash(t.x, t.z);
    const reg = regionAt(t.x, t.z), zone = zoneOf(t.x, t.z)?.id;
    // the jungle keeps its green all year; the dusk lands burn with autumn
    const jungle = biomeWeight('swamp', t.x, t.z) > 0.5, fall = reg === 'dusk' && zone !== 'wastes';
    const piece = t.dead ? pick(DEAD, u) : t.pine ? pick(PINES, u) : jungle || t.sc > 3 ? pick(GREENS, u)
      : u < (fall ? 0.75 : 0.3) ? pick(AUTUMN, u / (fall ? 0.75 : 0.3)) : pick(GREENS, (u - 0.3) / 0.7);
    // giants sink a little more so their wide root flare does not float on slopes
    const m = new THREE.Matrix4().compose(p.set(t.x, t.h - 0.1 * t.sc, t.z), q.setFromAxisAngle(up, t.rot), s.set(t.sc, t.sc, t.sc));
    const tint = t.dead ? (biomeWeight('ash', t.x, t.z) > 0.5 ? CHARRED : zone === 'wastes' ? BLEACHED : undefined)
      : biomeWeight('frost', t.x, t.z) > 0.5 ? FROSTED // snow-dusted pines
      : jungle ? LUSH : t.sc > 3 ? GIANT
      : fall && piece !== GREENS[0] && piece !== GREENS[1] ? FALL[Math.floor(t.hue * 3)]
      : t.pine && (reg === 'dragon' || zone === 'barracks') ? DARK_PINE : undefined;
    items.push(...spawn(piece, m, t.x, t.z, tint, NODE_BASE.tree + treeIdx, !t.dead));
  });
  return chunked(items, CHUNK);
}

function buildNatureRocks(idx: number[]): THREE.Group {
  const items: Item[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const all = layoutRocks();
  idx.forEach((rockIdx) => {
    const r = all[rockIdx];
    const piece = pick(ROCKS, hash(r.x, r.z));
    const m = new THREE.Matrix4().compose(p.set(r.x, r.y, r.z), q.setFromEuler(e.set(r.e[0], r.e[1], r.e[2])), s.set(r.s[0], r.s[1], r.s[2]));
    const id = NODE_BASE.rock + rockIdx;
    items.push(...spawn(piece, m, r.x, r.z, biomeWeight('ash', r.x, r.z) > 0.5 ? BASALT : undefined, nodeById(id) ? id : undefined));
  });
  return chunked(items, CHUNK);
}

const ROCKS = ['Rock_1', 'Rock_2', 'Rock_3'] as const;

function buildNatureBushes(idx: number[]): THREE.Group {
  const items: Item[] = [];
  const q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3();
  const all = layoutBushes();
  idx.forEach((bushIdx) => {
    const b = all[bushIdx];
    const piece = b.u < 0.18 ? pick(BUSH_FLOWERS, b.u / 0.18) : pick(BUSHES, (b.u - 0.18) / 0.82);
    const sc = b.sc * BUSH_FIT;
    const m = new THREE.Matrix4().compose(p.set(b.x, b.h - 0.1, b.z), q.setFromAxisAngle(up, b.rot), sv.set(sc, sc, sc));
    // the swamp's mangrove thickets: big, dark and wet
    const bog = biomeWeight('swamp', b.x, b.z) > 0.5;
    if (bog) m.scale(sv.set(1.6, 1.25, 1.6));
    items.push(...spawn(piece, m, b.x, b.z, bog ? MIRE : zoneOf(b.x, b.z)?.id === 'steppes' ? GOLDEN : undefined, b.fruit ? NODE_BASE.bush + bushIdx : undefined));
  });
  return chunked(items, CHUNK);
}

/** Random numbers one grass cell takes (5 per candidate, placed or not): see detailCells. */
export const NATURE_DETAIL_DRAWS = DETAIL_PER_CELL * 5;
/** One grass cell (shared/src/layout.ts detailCells): its tufts and flowers, one instanced mesh per model. */
export function natureDetailCell(x0: number, z0: number, seed: number): THREE.Object3D[] {
  const items: Item[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const rng = mulberry32(seed), c2 = new THREE.Color();
  {
      // ponytail: fewer candidates per cell (was 520) cuts blade count ~30%; the look changes slightly, the cost ceiling is this constant
      for (let i = 0; i < DETAIL_PER_CELL; i++) {
        const x = x0 + rng() * DETAIL_CHUNK, z = z0 + rng() * DETAIL_CHUNK, h = heightAt(x, z);
        const r1 = rng(), r2 = rng(), r3 = rng();
        if (!fertile(x, z, h)) continue;
        // clumping: thick tussocks where the noise is high, near-bare ground where it is low
        const dens = valueNoise(x / 16 + 3, z / 16 - 9);
        if ((r2 * 13) % 1 > dens * 1.3 + 0.1) continue;
        // wildflower patches: a few meadows burst into bloom instead of a flower here and there
        const verge = roadDist(x, z), edge = verge > 3.8 && verge < 7 ? 0.5 : 0; // roads get flowered verges
        const bloom = Math.max(edge, Math.min(1, Math.max(0, (valueNoise(x / 34 - 21, z / 34 + 6) - 0.6) * 5)));
        const zone = zoneOf(x, z)?.id;
        const sc = 0.7 + r1 * 0.9;
        const m = m4.compose(p.set(x, h - 0.05, z), q.setFromAxisAngle(up, r2 * 6.3), sv.set(sc, sc, sc)).clone();
        // the odd shrub and pebble inside the thick patches, so the grass is not the only thing at your feet
        if (dens > 0.62 && r3 > 0.985 && zone !== 'wastes') {
          items.push(...spawn(r1 < 0.4 ? 'Bush_Small_Flowers' : 'Bush_Small', m4.compose(p.set(x, h - 0.1, z), q.setFromAxisAngle(up, r2 * 6.3), sv.setScalar(0.35 + r1 * 0.3)).clone(), x, z));
          continue;
        }
        if (r3 < 0.006) {
          items.push(...spawn(r1 < 0.5 ? 'Rock_1' : 'Rock_2', m4.compose(p.set(x, h - 0.08, z), q.setFromAxisAngle(up, r2 * 6.3), sv.setScalar(0.12 + r1 * 0.15)).clone(), x, z));
          continue;
        }
        if (r3 < (zone === 'meadows' ? 0.09 : zone ? 0.015 : 0.04) + bloom * 0.3 && zone !== 'wastes') {
          // one colour per patch, so a meadow reads as drifts of white or red rather than confetti
          const hue = PETALS[Math.floor(valueNoise(x / 9 + 40, z / 9 - 17) * PETALS.length * 1.999) % PETALS.length];
          items.push(...spawn(r1 < 0.5 ? 'Flower_1_Clump' : 'Flower_3_Clump', m, x, z, hue));
        } else {
          const dry = zone === 'wastes' ? 1 : zone === 'barracks' ? 0.5 : 0;
          const tint = zone === 'steppes' ? GOLDEN : dry === 1 ? DRY : dry === 0.5 ? PARCHED : biomeWeight('swamp', x, z) > 0.5 ? BOGGY : regionAt(x, z) === 'dusk' ? PARCHED : WHITE;
          items.push(...spawn(r1 > 0.72 ? 'Grass_Large' : 'Grass_Small', m, x, z, c.copy(tint).multiplyScalar(0.82 + dens * 0.3).add(c2.setRGB((1 - dens) * 0.12, (1 - dens) * 0.06, 0)).clone()));
        }
      }
    }
  return [...chunked(items, DETAIL_CHUNK, { cx: x0 + DETAIL_CHUNK / 2, cz: z0 + DETAIL_CHUNK / 2 }).children];
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
