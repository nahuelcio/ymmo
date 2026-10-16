import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { basis } from '../assets';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { TOWN, TOWN_HEIGHT } from '../../../shared/src/terrain';
import { bumpNormal, relief } from './textures';
import { plazaBenches } from '../../../shared/src/layout';
import { albaCurtain, BELL_TOWER, fortCurtain, fortProps, FORTS, type PropName, groundInstances, houseInstances, V_PIECES, type CurtainDraw, type VPiece } from '../../../shared/src/village';

/**
 * Static kit meshes for settlements, batched per material (buildVillage), each piece culled on its own.
 * Assets: client/public/v.
 */

interface Prim { geo: THREE.BufferGeometry; map: THREE.Texture | null }
const prims = new Map<VPiece, Prim[]>();
const matCache = new Map<string, THREE.MeshLambertMaterial>();
/** Kit albedo maps, keyed by file name, so the curtain can reuse them. */
const kitTex = new Map<string, THREE.Texture>();
let ready = false;
let loading: Promise<void> | null = null;

export const vReady = () => ready;

function bakePiece(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.clone();
  // Quantized glTF stores positions as normalized ints. Writing a metre-scale
  // matrix back into that buffer clamps at 1, so expand to float first.
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

function texKey(map: THREE.Texture | null): string {
  if (!map) return 'flat';
  const img = map.image as { currentSrc?: string; src?: string } | undefined;
  return img?.currentSrc || img?.src || map.name || map.uuid;
}

function rememberTex(map: THREE.Texture | null) {
  if (!map) return;
  const file = texKey(map).split('/').pop()?.split('?')[0];
  if (file && !kitTex.has(file)) kitTex.set(file, map);
}

/**
 * The kit ships albedo maps only, so their brightness doubles as the height for the 'relief' setting
 * (pale stones stand proud of the dark joints).
 */
function kitRelief(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
  shader.uniforms.uRelief = relief;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uRelief;')
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       #ifdef USE_MAP
         float kitBump = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.6, 0.1)) * 0.4;
         ${bumpNormal('kitBump')}
       #endif`,
    );
}

/**
 * The piece's own matrix in the vertex shader: the town draws its pieces as BatchedMesh (batchingMatrix, declared in
 * <batching_vertex>, after <uv_vertex>, which is why the UV hooks below go there), an InstancedMesh would have instanceMatrix.
 */
const PIECE_MATRIX = `
  #if defined(USE_BATCHING)
    mat4 pieceMatrix = batchingMatrix;
  #elif defined(USE_INSTANCING)
    mat4 pieceMatrix = instanceMatrix;
  #else
    mat4 pieceMatrix = mat4(1.0);
  #endif`;

/** World metres covered by one repeat of the plaza paving. */
const FLOOR_TILE = 3;

/**
 * Paving: mapped in world space, turned off the grid, so the 2 m pieces leave no seams between them.
 * ponytail: the repeat is hidden by a brightness wash (the same map, huge and blurred; 0.2 is its
 * eyeballed mean). If the pattern still reads as tiled, upgrade to stochastic (hex) tiling.
 */
function kitFloor(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <batching_vertex>',
    `#include <batching_vertex>
     ${PIECE_MATRIX}
     vMapUv = mat2(0.8, -0.6, 0.6, 0.8) * (modelMatrix * pieceMatrix * vec4(position, 1.0)).xz / ${FLOOR_TILE.toFixed(1)};`,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
     diffuseColor.rgb *= 1.0 + (dot(texture2D(map, vMapUv * 0.13, 3.0).rgb, vec3(0.3, 0.6, 0.1)) - 0.2) * 3.0;`,
  );
}

/** How much of the texture's own colour a dyed kit piece loses before its tint is applied. */
const DYE_GREY = 0.7;
function kitDye(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
     #ifdef USE_MAP
       diffuseColor.rgb = diffuse * mix(sampledDiffuseColor.rgb, vec3(dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114))), ${DYE_GREY.toFixed(2)});
     #endif`,
  );
}

function lambert(map: THREE.Texture | null, color = 0xffffff, floor = false): THREE.MeshLambertMaterial {
  const key = `${texKey(map)}|${color}|${floor}`;
  let m = matCache.get(key);
  if (m) return m;
  matCache.set(key, (m = new THREE.MeshLambertMaterial({ map, color, side: THREE.DoubleSide })));
  // A tint (the Bastión's dark stone, slate and wine roofs) dyes a greyed copy of the texture: multiplying the
  // bright orange tiles as they are only gives a deeper orange.
  const dye = color !== 0xffffff && !floor;
  if (map) {
    m.customProgramCacheKey = () => (floor ? 'kit-floor' : dye ? 'kit-dye' : 'kit');
    m.onBeforeCompile = (shader) => {
      kitRelief(shader);
      if (floor) kitFloor(shader);
      if (dye) kitDye(shader);
    };
  }
  return m;
}

/** Fantasy Props MegaKit pieces by name (client/public/v/props.glb). */
const propPrims = new Map<PropName, Prim[]>();
/** Banners in the Bastión's red, the weapon stand in dark wood (kitDye greys the texture first). */
const PROP_DYE: Partial<Record<PropName, number>> = { Banner_1_Cloth: 0xa8282c, Banner_2_Cloth: 0x8a2028, WeaponStand: 0x8a6e5a };

/** One-off CC0 bell tower. Flat materials, so it is not an instanced kit piece. */
let bell: THREE.Object3D | null = null;
/** CC0 bench. The glb is 0.665 m long; the plaza benches it replaces were 2.2 m. */
const BENCH_SCALE = 2.2 / 0.665;
let benchGeo: THREE.BufferGeometry | null = null;
let benchColor = 0xffffff;

/** Stone curtain pieces (wall run, open gate, watchtower). Painted with the kit albedo maps. */
type CurtainKind = CurtainDraw['kind'];
const curtainPrims: Record<CurtainKind, { geo: THREE.BufferGeometry; color: number }[]> = {
  wall: [], gate: [], tower: [],
};
const curtainMats = new Map<string, THREE.MeshLambertMaterial>();

/** A kit colour map by file name (null until loadV finishes): the golems borrow the rock. */
export const kitTexture = (file: string): THREE.Texture | null => kitTex.get(file) ?? null;

/** Flat glb colours, matched to the kit textures those parts already use on the houses. */
function curtainMap(color: number): THREE.Texture | null {
  const file = color === 0xb15945 ? 'T_RoundTiles_BaseColor.webp'
    : color === 0x886a42 || color === 0xa58758 ? 'T_WoodTrim_BaseColor.webp'
      : color === 0x888880 ? 'T_RockTrim_BaseColor.webp'
        : 'T_UnevenBrick_BaseColor.webp';
  return kitTex.get(file) ?? null;
}

/**
 * The curtain models are flat-coloured and their UVs cover the whole mesh once.
 * Box-map the kit textures in world metres so a brick stays the size it has on a 2×3 m house wall,
 * including on wall runs whose length scale differs.
 */
function curtainLambert(map: THREE.Texture, tint = 0xffffff): THREE.MeshLambertMaterial {
  const key = `${map.uuid}|${tint}`;
  const cached = curtainMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshLambertMaterial({ map, color: tint, side: THREE.DoubleSide });
  const dye = tint !== 0xffffff;
  mat.customProgramCacheKey = () => (dye ? 'curtain-box-dye' : 'curtain-box');
  mat.onBeforeCompile = (shader) => {
    kitRelief(shader);
    if (dye) kitDye(shader);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <batching_vertex>',
      `#include <batching_vertex>
       ${PIECE_MATRIX}
         {
           float sx = length(pieceMatrix[0].xyz);
           float sy = length(pieceMatrix[1].xyz);
           float sz = length(pieceMatrix[2].xyz);
           vec3 m = vec3(position.x * sx, position.y * sy, position.z * sz);
           vec3 n = abs(normal);
           bool top = n.y >= n.x && n.y >= n.z;
           vec2 boxUv = top ? m.xz : n.x >= n.z ? vec2(m.z, m.y) : vec2(m.x, m.y);
           vMapUv = boxUv / vec2(2.0, top ? 2.0 : 3.0);
         }`,
    );
  };
  curtainMats.set(key, mat);
  return mat;
}

function flatPrims(root: THREE.Object3D, skip?: (mesh: THREE.Mesh) => boolean): { geo: THREE.BufferGeometry; color: number }[] {
  root.updateMatrixWorld(true);
  const out: { geo: THREE.BufferGeometry; color: number }[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip?.(o)) return;
    const color = (o.material as THREE.MeshStandardMaterial).color.getHex();
    let geo = bakePiece(o.geometry, o.matrixWorld);
    // Flagpoles on the gate share the door's wood mesh. They stand above the wall, on z = 0.
    if (o.name.endsWith('_3') && o.name.startsWith('WallTowers')) geo = dropFlagpoles(geo);
    out.push({ geo, color });
  });
  return out;
}

/** Triangles of the two pennant poles, above the gate walkway. */
function dropFlagpoles(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  if (!index) return geo;
  const keep: number[] = [];
  const v = new THREE.Vector3();
  const pole = (i: number) => {
    v.fromBufferAttribute(pos, i);
    return v.y > 0.5 && Math.abs(v.z) < 0.02 && Math.abs(v.x) > 0.7;
  };
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (pole(a) && pole(b) && pole(c)) continue;
    keep.push(a, b, c);
  }
  geo.setIndex(keep);
  return geo;
}

export function loadV(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(basis());
    const gltfs = await Promise.all(V_PIECES.map((f) => loader.loadAsync(`v/${f}.gltf`)));
    const sources = new Map<string, THREE.Texture['source']>();
    V_PIECES.forEach((name, i) => {
      const scene = gltfs[i].scene;
      scene.updateMatrixWorld(true);
      const meshes: Prim[] = [];
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const std = o.material as THREE.MeshStandardMaterial;
        const map = std.map ?? null;
        if (map?.name && map.image) {
          const shared = sources.get(map.name);
          if (shared) map.source = shared;
          else sources.set(map.name, map.source);
        }
        rememberTex(map);
        const geo = bakePiece(o.geometry, o.matrixWorld);
        meshes.push({ geo, map });
      });
      prims.set(name, meshes);
    });
    const [tower, benchGltf, wallGltf, gateGltf, watchGltf, propsGltf] = await Promise.all([
      loader.loadAsync('v/Bell_Tower.glb'),
      loader.loadAsync('v/Bench.glb'),
      loader.loadAsync('v/Stone_Wall.glb'),
      loader.loadAsync('v/Stone_Gate.glb'),
      loader.loadAsync('v/Stone_Tower.glb'),
      loader.loadAsync('v/props.glb'),
    ]);
    // town props, a scene each: every mesh baked into its scene's frame, so one instance matrix places the lot
    for (const sc of propsGltf.scenes) {
      sc.updateMatrixWorld(true);
      const list: Prim[] = [];
      sc.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const map = (o.material as THREE.MeshStandardMaterial).map;
        list.push({ geo: bakePiece(o.geometry, o.matrixWorld), map });
      });
      propPrims.set(sc.name as PropName, list);
    }
    const group = new THREE.Group();
    group.name = 'bell-tower';
    for (const prim of flatPrims(tower.scene)) {
      const mesh = new THREE.Mesh(prim.geo, lambert(null, prim.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    bell = group;
    const benchPrim = flatPrims(benchGltf.scene)[0];
    if (benchPrim) {
      benchColor = benchPrim.color;
      benchGeo = benchPrim.geo;
    }
    curtainPrims.wall = flatPrims(wallGltf.scene);
    curtainPrims.gate = flatPrims(gateGltf.scene, (m) => m.name.endsWith('_4'));
    // Crates at the tower base sit inside the wall runs and poke through the stone.
    curtainPrims.tower = flatPrims(watchGltf.scene, (m) => /_[45]$/.test(m.name));
    ready = true;
  })());
}

/** Geometries can share a BatchedMesh only with the same attributes (name, size, type) and both indexed or not. */
function layout(geo: THREE.BufferGeometry): string {
  const a = Object.entries(geo.attributes).map(([k, v]) => `${k}:${v.itemSize}:${(v as THREE.BufferAttribute).array.constructor.name}:${v.normalized}`);
  return `${a.sort().join()}|${geo.index ? 'i' : 'n'}`;
}

/** Both towns' kit buildings, paving and curtain walls, and Alba's bell tower. No-op until loadV() finishes. */
export function buildVillage(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'village';
  if (!ready) return g;
  // Every piece goes into one BatchedMesh per material (and vertex layout): a few dozen draws for both towns where an
  // InstancedMesh per piece, chunk and tint took ~480. Each instance is frustum-culled on its own.
  const batches = new Map<string, { mat: THREE.Material; list: { geo: THREE.BufferGeometry; m: THREE.Matrix4 }[] }>();
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) => {
    const key = `${mat.uuid}|${layout(geo)}`;
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { mat, list: [] }));
    b.list.push({ geo, m: m.clone() });
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (const it of [...groundInstances(), ...houseInstances()]) {
    q.setFromAxisAngle(up, it.rot);
    pos.set(it.x, TOWN_HEIGHT + it.y, it.z);
    m4.compose(pos, q, scl);
    for (const prim of prims.get(it.piece) ?? []) put(prim.geo, lambert(prim.map, it.tint ?? 0xffffff, it.piece === 'Floor_UnevenBrick'), m4);
  }
  if (bell) {
    const t = bell.clone();
    t.position.set(TOWN.x + BELL_TOWER.x, TOWN_HEIGHT + 0.01, TOWN.z + BELL_TOWER.z);
    t.rotation.y = BELL_TOWER.rot;
    t.scale.setScalar(BELL_TOWER.scale);
    g.add(t);
  }
  if (benchGeo) {
    // the ring the coloured planters used to occupy, backs to the bell tower (shared: they are seats too)
    const benchScale = new THREE.Vector3(BENCH_SCALE, BENCH_SCALE, BENCH_SCALE);
    for (const b of plazaBenches()) {
      q.setFromAxisAngle(up, Math.atan2(-Math.cos(b.a), -Math.sin(b.a)));
      pos.set(b.x, TOWN_HEIGHT + 0.02, b.z);
      put(benchGeo, lambert(null, benchColor), m4.compose(pos, q, benchScale));
    }
  }
  for (const fort of FORTS) for (const it of fortProps(fort)) for (const prim of propPrims.get(it.name) ?? []) {
    q.setFromAxisAngle(up, it.rot);
    pos.set(it.x, TOWN_HEIGHT + it.y, it.z);
    scl.setScalar(it.s);
    put(prim.geo, lambert(prim.map, PROP_DYE[it.name] ?? 0xffffff), m4.compose(pos, q, scl));
  }
  for (const curtain of [albaCurtain().draw, ...FORTS.map((f) => fortCurtain(f).draw)]) for (const kind of ['wall', 'gate', 'tower'] as const) {
    const list = curtain.filter((d) => d.kind === kind);
    if (!list.length) continue;
    const tint = list[0].tint ?? 0xffffff;
    for (const prim of curtainPrims[kind]) {
      const map = curtainMap(prim.color);
      const mat = map ? curtainLambert(map, tint) : lambert(null, new THREE.Color(prim.color).multiply(new THREE.Color(tint)).getHex());
      for (const it of list) {
        q.setFromAxisAngle(up, it.rot);
        pos.set(it.x, TOWN_HEIGHT + 0.02, it.z);
        scl.set(it.sx, it.sy, it.sz);
        put(prim.geo, mat, m4.compose(pos, q, scl));
      }
    }
  }
  for (const { mat, list } of batches.values()) {
    const geos = [...new Set(list.map((e) => e.geo))];
    const verts = geos.reduce((n, x) => n + x.getAttribute('position').count, 0);
    const index = geos.reduce((n, x) => n + (x.index?.count ?? 0), 0);
    const mesh = new THREE.BatchedMesh(list.length, verts, index, mat);
    const ids = new Map(geos.map((x) => [x, mesh.addGeometry(x)]));
    for (const e of list) mesh.setMatrixAt(mesh.addInstance(ids.get(e.geo)!), e.m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}
