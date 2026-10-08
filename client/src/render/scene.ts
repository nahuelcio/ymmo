import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, heightAt, inTown, mulberry32, smoothstep, TOWN, TOWN_HEIGHT, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { ZONES } from '../../../shared/src/data/world';
import { layoutCamps, layoutRocks, layoutTown, layoutTrees, layoutZoneProps, nearCamp, roadDist, zoneOf } from '../../../shared/src/layout';

const SKY = 0xa9c6e0;

/** Sky palette per region: zenith, horizon (also fog), ground bounce, sun colour & strength, cloud tint. */
interface SkyPal { top: number; horizon: number; ground: number; sun: number; sunI: number; hemi: number; cloud: number }
const SKIES: Record<string, SkyPal> = {
  town: { top: 0x4a86d0, horizon: 0xb8d4ec, ground: 0x5a4a35, sun: 0xfff0d0, sunI: 2.4, hemi: 1.6, cloud: 0xffffff },
  meadows: { top: 0x3a8ae0, horizon: 0xcfe6f6, ground: 0x5a5a35, sun: 0xfff6dc, sunI: 2.6, hemi: 1.7, cloud: 0xffffff },
  hills: { top: 0x5a8cc0, horizon: 0xc8d6d8, ground: 0x4a4a30, sun: 0xfff0d8, sunI: 2.3, hemi: 1.5, cloud: 0xeef2f4 },
  barracks: { top: 0x5a4a78, horizon: 0xe8a070, ground: 0x4a3020, sun: 0xffb070, sunI: 2.1, hemi: 1.3, cloud: 0xf0b890 },
  wastes: { top: 0x24203a, horizon: 0x7a7088, ground: 0x2a2228, sun: 0xc8b8e8, sunI: 1.4, hemi: 1.0, cloud: 0x5a5468 },
};

const SkyShader = {
  uniforms: {
    top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0.45, 0.8, 0.3).normalize() }, sunColor: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top, horizon, ground, sunColor, sunDir;
    varying vec3 vDir;
    void main() {
      float h = vDir.y;
      vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, ground, smoothstep(0.0, 0.25, -h));
      float s = max(dot(normalize(vDir), sunDir), 0.0);
      c += sunColor * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18); // sun disc + glow
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export { ROADS, roadDist } from '../../../shared/src/layout';

/** Ground colour (sRGB 0..1) used by both terrain mesh and minimap. */
export function groundColor(x: number, z: number, h: number): [number, number, number] {
  const n = fbm(x / 40 + 50, z / 40 - 20, 3);
  let r = 0.3 + n * 0.12, g = 0.5 + n * 0.14, b = 0.2 + n * 0.06;
  for (const zn of ZONES) {
    const w = (1 - smoothstep(zn.r * 0.5, zn.r * 1.15, Math.hypot(x - zn.x, z - zn.z))) * 0.75;
    r += (zn.tint[0] * (0.85 + n * 0.3) - r) * w;
    g += (zn.tint[1] * (0.85 + n * 0.3) - g) * w;
    b += (zn.tint[2] * (0.85 + n * 0.3) - b) * w;
  }
  const rock = smoothstep(14, 26, h);
  r += (0.47 + n * 0.08 - r) * rock; g += (0.45 + n * 0.08 - g) * rock; b += (0.42 + n * 0.08 - b) * rock;
  const snow = smoothstep(45, 60, h);
  r += (0.92 - r) * snow; g += (0.93 - g) * snow; b += (0.96 - b) * snow;
  const road = 1 - smoothstep(2.2, 4.2, roadDist(x, z));
  const town = 1 - smoothstep(TOWN.r - 2, TOWN.r + 6, Math.hypot(x - TOWN.x, z - TOWN.z));
  const dirt = Math.max(road * 0.85, town);
  r += (0.6 + n * 0.08 - r) * dirt; g += (0.52 + n * 0.06 - g) * dirt; b += (0.38 + n * 0.05 - b) * dirt;
  // pond shores: sand at the waterline, darker silt underwater
  const sand = (1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 2.2, h)) * (1 - dirt);
  r += (0.74 - r) * sand; g += (0.68 - g) * sand; b += (0.5 - b) * sand;
  const deep = 1 - smoothstep(WATER_LEVEL - 2.5, WATER_LEVEL - 0.2, h);
  r += (0.22 - r) * deep; g += (0.32 - g) * deep; b += (0.34 - b) * deep;
  return [r, g, b];
}

const matCache = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new THREE.MeshLambertMaterial({ color, flatShading: true })));
  return m;
}

export interface WorldScene {
  scene: THREE.Scene;
  terrain: THREE.Group;
  sun: THREE.DirectionalLight;
  /** grass & flowers (toggle with the foliage setting) */
  detail: THREE.Group;
  sky: THREE.Mesh;
  /** per-frame: keep the sky around the camera and blend its palette by region */
  updateSky(camera: THREE.Camera, far: number, dt: number): void;
  follow(p: THREE.Vector3): void;
}

export function createWorldScene(): WorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 90, 420);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 1.6);
  scene.add(hemi);
  // sky dome (follows the camera; scaled to sit just inside the far plane)
  const skyMat = new THREE.ShaderMaterial({ ...SkyShader, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  const clouds = buildClouds();
  scene.add(clouds);
  const pal = { ...SKIES.town };
  const cur = { top: new THREE.Color(pal.top), horizon: new THREE.Color(pal.horizon), ground: new THREE.Color(pal.ground), sun: new THREE.Color(pal.sun), cloud: new THREE.Color(pal.cloud), sunI: pal.sunI, hemi: pal.hemi };
  const tgt = { top: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(), cloud: new THREE.Color(), sunI: 0, hemi: 0 };
  const tmp = new THREE.Color();
  /** Blend the palettes of nearby zones (town as the base) at world position (x,z). */
  const paletteAt = (x: number, z: number) => {
    const base = SKIES.town;
    tgt.top.set(base.top); tgt.horizon.set(base.horizon); tgt.ground.set(base.ground); tgt.sun.set(base.sun); tgt.cloud.set(base.cloud);
    tgt.sunI = base.sunI; tgt.hemi = base.hemi;
    for (const zn of ZONES) {
      const w = 1 - smoothstep(zn.r * 0.6, zn.r * 1.5, Math.hypot(x - zn.x, z - zn.z));
      if (w <= 0) continue;
      const p = SKIES[zn.id];
      tgt.top.lerp(tmp.set(p.top), w); tgt.horizon.lerp(tmp.set(p.horizon), w); tgt.ground.lerp(tmp.set(p.ground), w);
      tgt.sun.lerp(tmp.set(p.sun), w); tgt.cloud.lerp(tmp.set(p.cloud), w);
      tgt.sunI += (p.sunI - tgt.sunI) * w; tgt.hemi += (p.hemi - tgt.hemi) * w;
    }
  };
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const terrain = buildTerrain();
  scene.add(terrain);
  scene.add(buildTrees());
  scene.add(buildRocks());
  scene.add(buildBushes());
  scene.add(buildWater());
  const detail = buildDetail();
  scene.add(detail);
  scene.add(mergeStatic(buildTown()));
  scene.add(mergeStatic(buildZoneProps()));
  const { props: campProps, flames } = buildCamps();
  scene.add(mergeStatic(campProps), flames);

  return {
    scene, terrain, sun,
    detail,
    sky,
    updateSky(camera: THREE.Camera, far: number, dt: number) {
      sky.position.copy(camera.position);
      sky.scale.setScalar(far * 0.92);
      clouds.position.set(camera.position.x, 0, camera.position.z);
      const drift = (performance.now() / 1000) * 1.5;
      clouds.children.forEach((c, i) => {
        const u = c.userData as { x: number; z: number };
        c.position.x = ((u.x + drift + 600) % 1200) - 600;
        c.position.z = u.z + Math.sin(drift * 0.01 + i) * 4;
      });
      // ease the sky towards the current region's palette
      paletteAt(camera.position.x, camera.position.z);
      const k = Math.min(1, dt * 0.8);
      cur.top.lerp(tgt.top, k); cur.horizon.lerp(tgt.horizon, k); cur.ground.lerp(tgt.ground, k);
      cur.sun.lerp(tgt.sun, k); cur.cloud.lerp(tgt.cloud, k);
      cur.sunI += (tgt.sunI - cur.sunI) * k; cur.hemi += (tgt.hemi - cur.hemi) * k;
      const u = skyMat.uniforms;
      u.top.value.copy(cur.top); u.horizon.value.copy(cur.horizon); u.ground.value.copy(cur.ground); u.sunColor.value.copy(cur.sun);
      (scene.fog as THREE.Fog).color.copy(cur.horizon);
      (scene.background as THREE.Color).copy(cur.horizon);
      sun.color.copy(cur.sun);
      sun.intensity = cur.sunI;
      hemi.intensity = cur.hemi;
      hemi.color.copy(cur.horizon).lerp(tmp.set(0xffffff), 0.4);
      // campfires flicker
      const ft = performance.now() / 1000;
      flames.children.forEach((f, i) => f.scale.set(1, 0.8 + Math.sin(ft * 13 + i * 1.7) * 0.15 + Math.sin(ft * 7.3 + i) * 0.1, 1));
      CLOUD_MAT.color.copy(cur.cloud);
      CLOUD_MAT.emissive.copy(cur.cloud).multiplyScalar(0.45);
    },
    follow(p) {
      sun.position.set(p.x + 60, p.y + 120, p.z + 40);
      sun.target.position.copy(p);
      // grass and flowers only around the player
      if (detail.visible)
        for (const ch of detail.children) ch.visible = Math.abs(ch.userData.cx - p.x) < 95 && Math.abs(ch.userData.cz - p.z) < 95;
    },
  };
}

// The world is split into square chunks so the camera frustum (and the far plane,
// i.e. the view distance) can skip everything that isn't on screen. One big mesh or
// InstancedMesh would always be drawn whole.
const CHUNK = 200;
const chunkKey = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

function buildTerrain(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'terrain';
  const n = Math.round((WORLD_HALF * 2) / CHUNK), seg = Math.round(250 / n);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const c = new THREE.Color();
  for (let cx = 0; cx < n; cx++)
    for (let cz = 0; cz < n; cz++) {
      const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, seg, seg);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-WORLD_HALF + (cx + 0.5) * CHUNK, 0, -WORLD_HALF + (cz + 0.5) * CHUNK);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = heightAt(x, z);
        pos.setY(i, h);
        const [r, gg, b] = groundColor(x, z, h);
        c.setRGB(r, gg, b, THREE.SRGBColorSpace);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geo.computeVertexNormals();
      // steep slopes turn to bare rock and darken a little: hills read as hills
      const nrm = geo.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const steep = 1 - smoothstep(0.72, 0.93, nrm.getY(i));
        const o = i * 3;
        colors[o] += (0.36 - colors[o]) * steep * 0.8;
        colors[o + 1] += (0.33 - colors[o + 1]) * steep * 0.8;
        colors[o + 2] += (0.3 - colors[o + 2]) * steep * 0.8;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      g.add(mesh);
    }
  return g;
}

interface Inst { m: THREE.Matrix4; c: THREE.Color; x: number; z: number }

/** One InstancedMesh per world chunk, each with its own bounds so it can be culled. */
function chunkedInstances(geo: THREE.BufferGeometry, material: THREE.Material, items: Inst[]): THREE.Group {
  const g = new THREE.Group();
  const byChunk = new Map<string, Inst[]>();
  for (const it of items) {
    const k = chunkKey(it.x, it.z);
    let l = byChunk.get(k);
    if (!l) byChunk.set(k, (l = []));
    l.push(it);
  }
  for (const list of byChunk.values()) {
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.c);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  return g;
}

/**
 * Bake a group of static meshes into one mesh per (material, chunk): hundreds of
 * little boxes become a handful of draw calls that can still be frustum-culled.
 */
function mergeStatic(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();
  const v = new THREE.Vector3();
  src.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.Material;
    o.getWorldPosition(v);
    const key = `${mat.uuid}|${chunkKey(v.x, v.z)}|${o.castShadow}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, geos: [], cast: o.castShadow }));
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    b.geos.push(g);
  });
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

function buildTrees(): THREE.Group {
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.2, 5);
  trunkGeo.translate(0, 1.1, 0);
  // pines: three stacked tiers; broadleaf: a cluster of blobs
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(1.6, 2.2, 7).translate(0, 2.7, 0),
    new THREE.ConeGeometry(1.25, 1.9, 7).translate(0, 3.8, 0),
    new THREE.ConeGeometry(0.85, 1.6, 7).translate(0, 4.8, 0),
  ].map((g) => g.toNonIndexed()))!;
  const leafGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1.45, 0).translate(0, 3.5, 0),
    new THREE.IcosahedronGeometry(1.0, 0).translate(0.9, 3.0, 0.3),
    new THREE.IcosahedronGeometry(1.05, 0).translate(-0.8, 3.1, -0.4),
    new THREE.IcosahedronGeometry(0.85, 0).translate(0.1, 4.4, 0.2),
  ])!;
  // dead trees in the wastes get bare branches
  const deadGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.18, 0.3, 2.6, 5).translate(0, 1.3, 0),
    new THREE.CylinderGeometry(0.06, 0.1, 1.2, 4).rotateZ(0.9).translate(0.45, 2.2, 0),
    new THREE.CylinderGeometry(0.05, 0.08, 1.0, 4).rotateZ(-1.0).translate(-0.4, 2.5, 0.1),
    new THREE.CylinderGeometry(0.04, 0.07, 0.9, 4).rotateX(0.9).translate(0, 2.0, 0.35),
  ].map((g) => g.toNonIndexed()))!;
  const trunks: Inst[] = [], pines: Inst[] = [], leaves: Inst[] = [], deads: Inst[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const t of layoutTrees()) {
    p.set(t.x, t.h - 0.1, t.z);
    q.setFromAxisAngle(up, t.rot);
    s.set(t.sc, t.sc, t.sc);
    const m = new THREE.Matrix4().compose(p, q, s);
    if (t.dead) {
      deads.push({ m, x: t.x, z: t.z, c: new THREE.Color(0x3a3030) });
      continue;
    }
    trunks.push({ m, x: t.x, z: t.z, c: new THREE.Color(0x6b4a2b) });
    if (t.pine) pines.push({ m, x: t.x, z: t.z, c: new THREE.Color().setHSL(0.3 + t.hue * 0.05, 0.45, 0.22 + t.light * 0.08) });
    else leaves.push({ m, x: t.x, z: t.z, c: new THREE.Color().setHSL(0.22 + t.hue * 0.08, 0.5, 0.3 + t.light * 0.1) });
  }
  const mat = () => new THREE.MeshLambertMaterial({ flatShading: true });
  const g = new THREE.Group();
  g.add(chunkedInstances(trunkGeo, mat(), trunks), chunkedInstances(pineGeo, mat(), pines), chunkedInstances(leafGeo, mat(), leaves));
  if (deads.length) g.add(chunkedInstances(deadGeo, mat(), deads));
  return g;
}

function buildRocks(): THREE.Group {
  const items: Inst[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  for (const r of layoutRocks()) {
    p.set(r.x, r.y, r.z);
    q.setFromEuler(e.set(...r.e));
    s.set(...r.s);
    items.push({ m: new THREE.Matrix4().compose(p, q, s), x: r.x, z: r.z, c: new THREE.Color().setHSL(0.08, 0.06, 0.38 + r.light * 0.15) });
  }
  return chunkedInstances(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), items);
}

const CLOUD_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: 0x606060 });

/** Low-poly cloud puffs high above, drifting with the wind. */
function buildClouds(): THREE.Group {
  const g = new THREE.Group();
  const rng = mulberry32(31);
  const puff = mergeGeometries([
    new THREE.IcosahedronGeometry(9, 0),
    new THREE.IcosahedronGeometry(7, 0).translate(10, -1.5, 2),
    new THREE.IcosahedronGeometry(6.5, 0).translate(-9, -2, -1),
    new THREE.IcosahedronGeometry(5, 0).translate(3, 3.5, -3),
  ])!;
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(puff, CLOUD_MAT);
    const x = (rng() * 2 - 1) * 600, z = (rng() * 2 - 1) * 600;
    m.userData = { x, z };
    m.position.set(x, 110 + rng() * 40, z);
    m.scale.set(1.6 + rng() * 1.8, 0.7 + rng() * 0.4, 1.3 + rng() * 1.2);
    m.rotation.y = rng() * 6;
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}

function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_HALF * 2, WORLD_HALF * 2, 1, 1).rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3a7ab0, transparent: true, opacity: 0.72, depthWrite: false }));
  water.position.y = WATER_LEVEL;
  water.renderOrder = 2;
  return water;
}

/** Can decorative foliage grow here? (not on roads, town, water, rock or snow) */
function fertile(x: number, z: number, h: number): boolean {
  return h > WATER_LEVEL + 1.2 && h < 22 && !inTown(x, z) && roadDist(x, z) > 3.2 && !nearCamp(x, z, 16);
}

function buildBushes(): THREE.Group {
  const rng = mulberry32(21);
  const geo = mergeGeometries([
    new THREE.IcosahedronGeometry(0.6, 0).translate(0, 0.45, 0),
    new THREE.IcosahedronGeometry(0.45, 0).translate(0.45, 0.35, 0.1),
    new THREE.IcosahedronGeometry(0.42, 0).translate(-0.4, 0.32, -0.15),
  ])!;
  const items: Inst[] = [];
  const q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 4000 && items.length < 1400; i++) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.9, z = (rng() * 2 - 1) * WORLD_HALF * 0.9, h = heightAt(x, z);
    if (!fertile(x, z, h) || zoneOf(x, z)?.id === 'wastes') continue;
    const sc = 0.7 + rng() * 0.8;
    items.push({ m: new THREE.Matrix4().compose(p.set(x, h - 0.1, z), q.setFromAxisAngle(up, rng() * 6.3), sv.set(sc, sc * (0.8 + rng() * 0.4), sc)),
      x, z, c: new THREE.Color().setHSL(0.24 + rng() * 0.08, 0.45, 0.24 + rng() * 0.1) });
  }
  return chunkedInstances(geo, new THREE.MeshLambertMaterial({ flatShading: true }), items);
}

const DETAIL_CHUNK = 40;
/** Grass tufts and flowers: dense but tiny, so only chunks near the player are drawn. */
function buildDetail(): THREE.Group {
  const g = new THREE.Group();
  const rng = mulberry32(77);
  const blade = mergeGeometries([0, 1, 2].map((i) =>
    new THREE.ConeGeometry(0.07, 0.55, 3).translate(0, 0.27, 0).rotateZ((i - 1) * 0.35).translate((i - 1) * 0.08, 0, (i % 2) * 0.06).toNonIndexed()))!;
  const flower = mergeGeometries([
    new THREE.CylinderGeometry(0.015, 0.015, 0.4, 3).translate(0, 0.2, 0).toNonIndexed(),
    new THREE.IcosahedronGeometry(0.08, 0).translate(0, 0.42, 0),
  ])!;
  const grassMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const flowerMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const FLOWERS = [0xf0e04a, 0xffffff, 0xe85a8a, 0x8a7aff, 0xff8a3a];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const n = Math.ceil((WORLD_HALF * 2 * 0.86) / DETAIL_CHUNK);
  for (let cx = 0; cx < n; cx++)
    for (let cz = 0; cz < n; cz++) {
      const x0 = -WORLD_HALF * 0.86 + cx * DETAIL_CHUNK, z0 = -WORLD_HALF * 0.86 + cz * DETAIL_CHUNK;
      const grass: [THREE.Matrix4, THREE.Color][] = [], flowers: [THREE.Matrix4, THREE.Color][] = [];
      for (let i = 0; i < 520; i++) {
        const x = x0 + rng() * DETAIL_CHUNK, z = z0 + rng() * DETAIL_CHUNK, h = heightAt(x, z);
        const r1 = rng(), r2 = rng(), r3 = rng();
        if (!fertile(x, z, h)) continue;
        const zone = zoneOf(x, z)?.id;
        const sc = 0.7 + r1 * 0.9;
        m.compose(p.set(x, h - 0.05, z), q.setFromAxisAngle(up, r2 * 6.3), sv.set(sc, sc, sc));
        if (r3 < (zone === 'meadows' ? 0.09 : zone ? 0.015 : 0.04) && zone !== 'wastes') {
          flowers.push([m.clone(), c.set(FLOWERS[Math.floor(r1 * FLOWERS.length)]).clone()]);
        } else {
          // dry yellowed grass in the wastes and barracks, lush elsewhere
          const dry = zone === 'wastes' ? 1 : zone === 'barracks' ? 0.5 : 0;
          grass.push([m.clone(), c.setHSL(0.25 - dry * 0.12 + r1 * 0.03, 0.5 - dry * 0.2, 0.3 + r2 * 0.1 + dry * 0.05).clone()]);
        }
      }
      for (const [geo, mt, list] of [[blade, grassMat, grass], [flower, flowerMat, flowers]] as const) {
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(geo, mt, list.length);
        list.forEach(([mm, cc], i) => {
          im.setMatrixAt(i, mm);
          im.setColorAt(i, cc);
        });
        im.computeBoundingSphere();
        im.receiveShadow = true;
        im.userData.cx = x0 + DETAIL_CHUNK / 2;
        im.userData.cz = z0 + DETAIL_CHUNK / 2;
        g.add(im);
      }
    }
  return g;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function house(w: number, d: number, wall: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  const TIMBER = 0x5a3a20, STONE = 0x8a8478, base = 0.5, h = 3.4;
  g.add(box(w + 0.3, base, d + 0.3, STONE, 0, base / 2, 0)); // stone footing
  g.add(box(w, h - base, d, wall, 0, (h + base) / 2, 0));
  // timber frame: corner posts, a beam at mid height and under the eaves, studs on the long walls
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.3, h - base, 0.3, TIMBER, (sx * w) / 2, (h + base) / 2, (sz * d) / 2));
  for (const y of [base + (h - base) * 0.52, h]) {
    for (const sz of [-1, 1]) g.add(box(w + 0.2, 0.22, 0.12, TIMBER, 0, y, (sz * (d + 0.1)) / 2));
    for (const sx of [-1, 1]) g.add(box(0.12, 0.22, d + 0.2, TIMBER, (sx * (w + 0.1)) / 2, y, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.16, h - base, 0.1, TIMBER, (sx * w) / 4, (h + base) / 2, (sz * (d + 0.06)) / 2));
  // gabled roof: a triangular prism along the width, overhanging the walls
  const rr = (d + 1.4) / Math.sqrt(3), roofH = 2.7, sy = roofH / (1.5 * rr);
  const prism = new THREE.CylinderGeometry(rr, rr, w + 1, 3, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, sy, 1);
  const r = new THREE.Mesh(prism, mat(roof));
  r.position.y = h + 0.1 + (rr / 2) * sy;
  r.castShadow = true;
  g.add(r);
  g.add(box(w + 1.1, 0.14, 0.3, darken(roof), 0, h + 0.1 + roofH, 0)); // ridge cap
  // the gable ends are wall, not roof
  for (const sx of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.CylinderGeometry(d / Math.sqrt(3), d / Math.sqrt(3), 0.1, 3, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, (roofH * 0.82) / (1.5 * (d / Math.sqrt(3))), 1), mat(wall));
    gable.position.set((sx * w) / 2, h + 0.1 + (d / Math.sqrt(3) / 2) * ((roofH * 0.82) / (1.5 * (d / Math.sqrt(3)))), 0);
    g.add(gable);
  }
  g.add(box(0.7, 2, 0.7, 0x7a746a, -w / 4, h + 1.7, -d / 5)); // chimney
  g.add(box(0.9, 0.16, 0.9, 0x5e5a52, -w / 4, h + 2.75, -d / 5));
  // door with frame and step
  const f = d / 2 + 0.06;
  g.add(box(1.5, 2.35, 0.12, TIMBER, 0, base + 1.1, f));
  g.add(box(1.15, 2.05, 0.14, 0x4a2a15, 0, base + 1.0, f + 0.02));
  g.add(box(0.1, 0.1, 0.1, 0xd8b050, 0.38, base + 1.0, f + 0.1));
  g.add(box(1.7, 0.2, 0.6, STONE, 0, base - 0.1, f + 0.3));
  // windows: frame, glass, cross bar and a sill, on the front and both long sides
  const win = (x: number, z: number, side: boolean) => {
    const [fw, fd] = side ? [0.12, 1.1] : [1.1, 0.12], [gw, gd] = side ? [0.14, 0.86] : [0.86, 0.14];
    g.add(box(fw, 1.1, fd, TIMBER, x, base + 1.75, z));
    g.add(box(gw, 0.86, gd, 0x9fd3ff, x, base + 1.75, z));
    g.add(box(side ? 0.16 : 0.07, 0.86, side ? 0.07 : 0.16, TIMBER, x, base + 1.75, z));
    g.add(box(side ? 0.3 : 1.25, 0.1, side ? 1.25 : 0.3, TIMBER, x, base + 1.18, z));
  };
  win(w / 3.2, f, false);
  win(-w / 3.2, f, false);
  win(0, -f, false);
  for (const sx of [-1, 1]) win(sx * (w / 2 + 0.06), 0, true);
  return g;
}

const darken = (c: number, k = 0.72) => (Math.floor(((c >> 16) & 255) * k) << 16) | (Math.floor(((c >> 8) & 255) * k) << 8) | Math.floor((c & 255) * k);

function buildTown(): THREE.Group {
  const g = new THREE.Group();
  const y = TOWN_HEIGHT;
  // plaza
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.2, 24), mat(0x9a9488));
  plaza.position.set(TOWN.x, y + 0.02, TOWN.z);
  plaza.receiveShadow = true;
  g.add(plaza);
  // fountain + statue
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 0.9, 16), mat(0xbab4a6));
  basin.position.set(TOWN.x, y + 0.45, TOWN.z);
  basin.castShadow = basin.receiveShadow = true;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.1, 16), new THREE.MeshLambertMaterial({ color: 0x4a90c8, transparent: true, opacity: 0.85 }));
  water.position.set(TOWN.x, y + 0.93, TOWN.z);
  const ped = box(1.6, 2.2, 1.6, 0xcac4b6, TOWN.x, y + 1.6, TOWN.z);
  const statue = new THREE.Group();
  statue.add(box(0.8, 1.6, 0.5, 0xd8c48a, 0, 0.8, 0));
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), mat(0xd8c48a));
  head.position.y = 1.9;
  statue.add(head);
  const sword = box(0.12, 2.2, 0.05, 0xe8e0c0, 0.55, 1.6, 0.2);
  sword.rotation.z = -0.2;
  statue.add(sword);
  statue.position.set(TOWN.x, y + 2.7, TOWN.z);
  g.add(basin, water, ped, statue);

  // village life: lamp posts around the plaza, barrels and crates by the stalls, flower beds
  const lampGlow = new THREE.MeshLambertMaterial({ color: 0xffd27a, emissive: 0xffb040, emissiveIntensity: 0.9, flatShading: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const lx = TOWN.x + Math.cos(a) * 17, lz = TOWN.z + Math.sin(a) * 17;
    g.add(box(0.14, 3, 0.14, 0x2a2a2a, lx, y + 1.5, lz));
    g.add(box(0.5, 0.08, 0.08, 0x2a2a2a, lx + Math.cos(a) * 0.2, y + 3, lz + Math.sin(a) * 0.2));
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), lampGlow);
    lamp.position.set(lx + Math.cos(a) * 0.4, y + 2.8, lz + Math.sin(a) * 0.4);
    g.add(lamp);
  }
  const rng = mulberry32(5);
  for (const st of layoutTown().stalls) {
    for (let k = 0; k < 3; k++) {
      const ox = st.x + Math.cos(st.rot) * (1.9 + k * 0.6) + (rng() - 0.5) * 0.4, oz = st.z - Math.sin(st.rot) * (1.9 + k * 0.6) + (rng() - 0.5) * 0.4;
      if (rng() < 0.5) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.8, 8), mat(0x7a5030));
        barrel.position.set(ox, y + 0.4, oz);
        barrel.castShadow = true;
        g.add(barrel);
        const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 8), mat(0x3a3a3a));
        hoop.position.set(ox, y + 0.62, oz);
        g.add(hoop);
      } else g.add(box(0.6, 0.55, 0.6, 0x9a7a4a, ox, y + 0.28, oz));
    }
  }
  const FLOWER_C = [0xe85a8a, 0xf0e04a, 0xffffff, 0x8a7aff];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const fx = TOWN.x + Math.cos(a) * 9.5, fz = TOWN.z + Math.sin(a) * 9.5;
    const bed = box(2.2, 0.3, 0.9, 0x6a4a2a, fx, y + 0.15, fz);
    bed.rotation.y = -a;
    g.add(bed);
    for (let k = 0; k < 6; k++) {
      const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(FLOWER_C[(i + k) % FLOWER_C.length]));
      fl.position.set(fx + Math.cos(-a) * (k - 2.5) * 0.32, y + 0.4, fz - Math.sin(-a) * (k - 2.5) * 0.32);
      g.add(fl);
    }
  }

  const L = layoutTown();
  for (const h of L.houses) {
    const hs = house(h.w, h.d, h.wall, h.roof);
    hs.position.set(h.x, y, h.z);
    hs.rotation.y = h.rot;
    g.add(hs);
  }
  // merchant stalls behind NPCs
  for (const st of L.stalls) {
    const stall = new THREE.Group();
    stall.add(box(3, 1, 1, 0x7a5a3a, 0, 0.5, 0));
    for (const sx of [-1.4, 1.4]) stall.add(box(0.15, 2.6, 0.15, 0x5a3a20, sx, 1.3, -0.4));
    const awning = box(3.4, 0.12, 1.8, st.color, 0, 2.6, 0.2);
    awning.rotation.x = 0.25;
    stall.add(awning);
    stall.position.set(st.x, y, st.z);
    stall.rotation.y = st.rot;
    g.add(stall);
  }
  // palisade: sharpened logs bound by a rail, with watchtowers on a stone base
  for (const w of L.walls) {
    const wy = heightAt(w.x, w.z);
    for (let k = -3.5; k <= 3.5; k++) {
      const lx = w.x + Math.cos(w.rot) * k * 0.9, lz = w.z - Math.sin(w.rot) * k * 0.9;
      const h = 3.1 + (((k + 3.5) * 7 + 3) % 5) * 0.12;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, h, 6), mat(k % 2 ? 0x6e4e2e : 0x7a5a3a));
      log.position.set(lx, wy + h / 2 - 0.2, lz);
      log.castShadow = log.receiveShadow = true;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 6), mat(0x8a6a4a));
      tip.position.set(lx, wy + h - 0.2 + 0.35, lz);
      tip.castShadow = true;
      g.add(log, tip);
    }
    const rail = box(7.3, 0.28, 0.2, 0x4a3420, w.x, wy + 2.1, w.z);
    rail.rotation.y = w.rot;
    rail.translateZ(-0.5); // on the town side
    g.add(rail);
    if (w.tower) {
      const tower = new THREE.Group();
      tower.add(box(2.6, 3.4, 2.6, 0x8a8478, 0, 1.7, 0));
      tower.add(box(2.8, 0.25, 2.8, 0x6e695f, 0, 3.4, 0));
      tower.add(box(3.2, 0.3, 3.2, 0x5a3a20, 0, 3.7, 0)); // platform
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower.add(box(0.28, 2.6, 0.28, 0x5a3a20, sx * 1.4, 5.1, sz * 1.4));
      for (const sx of [-1, 1]) {
        tower.add(box(0.14, 0.9, 2.8, 0x6a4a2a, sx * 1.4, 4.3, 0));
        tower.add(box(2.8, 0.9, 0.14, 0x6a4a2a, 0, 4.3, sx * 1.4));
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 2.2, 4), mat(0x8a3a2a));
      roof.position.y = 7.5;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      tower.add(roof);
      tower.position.set(w.x, wy - 0.2, w.z);
      tower.rotation.y = w.rot;
      g.add(tower);
    }
  }
  // gate pillars with banners at road exits
  for (const gp of L.gates) {
    g.add(box(1.2, 5, 1.2, 0x8a8478, gp.x, heightAt(gp.x, gp.z) + 2.5, gp.z));
    const banner = box(0.8, 2, 0.05, 0x8a1a2a, gp.x, heightAt(gp.x, gp.z) + 3.2, gp.z);
    banner.rotation.y = gp.rot;
    g.add(banner);
  }
  return g;
}

const FLAME_OUT = new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1, flatShading: true });
const FLAME_IN = new THREE.MeshLambertMaterial({ color: 0xffe060, emissive: 0xffd040, emissiveIntensity: 1, flatShading: true });

/** Hostile camps: tents, a crackling campfire, a broken palisade of sharpened logs and the banner. */
function buildCamps(): { props: THREE.Group; flames: THREE.Group } {
  const g = new THREE.Group(), flames = new THREE.Group();
  for (const c of layoutCamps()) {
    const y0 = (x: number, z: number) => heightAt(x, z);
    for (const t of c.tents) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3, 5), mat(0x7a6040));
      tent.position.set(t.x, y0(t.x, t.z) + 1.5, t.z);
      tent.rotation.y = t.rot;
      tent.castShadow = true;
      g.add(tent);
      const flap = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 3), mat(0x2a1a10));
      flap.position.set(t.x - Math.cos(-t.rot) * 1.7, y0(t.x, t.z) + 0.8, t.z - Math.sin(-t.rot) * 1.7);
      g.add(flap);
      const pole = box(0.08, 0.8, 0.08, 0x4a3020, t.x, y0(t.x, t.z) + 3.2, t.z);
      g.add(pole);
    }
    for (const w of c.walls) {
      const wy = y0(w.x, w.z);
      for (let k = -3; k <= 3; k++) {
        const lx = w.x + Math.cos(-w.rot) * k * 1.05, lz = w.z + Math.sin(-w.rot) * k * 1.05;
        const h = 2.2 + ((k * 7 + 3) % 5) * 0.15;
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, h, 6), mat(0x6a4a2a));
        log.position.set(lx, wy + h / 2 - 0.2, lz);
        log.castShadow = true;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 6), mat(0x8a6a4a));
        tip.position.set(lx, wy + h - 0.2 + 0.25, lz);
        g.add(log, tip);
      }
    }
    // campfire: stone ring, crossed logs, flames
    const fx = c.fire.x, fz = c.fire.z, fy = y0(fx, fz);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), mat(0x6a6660));
      st.position.set(fx + Math.cos(a) * 0.75, fy + 0.1, fz + Math.sin(a) * 0.75);
      g.add(st);
    }
    for (const r of [0.4, -0.5, 1.6]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5), mat(0x3a2414));
      log.rotation.set(Math.PI / 2, r, 0.3);
      log.position.set(fx, fy + 0.15, fz);
      g.add(log);
    }
    for (const [r, h, m, dx, dz] of [[0.35, 1.1, FLAME_OUT, 0, 0], [0.22, 0.8, FLAME_OUT, 0.18, 0.1], [0.2, 0.7, FLAME_IN, -0.1, -0.05]] as const) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5).translate(0, h / 2, 0), m);
      f.position.set(fx + dx, fy + 0.1, fz + dz);
      flames.add(f);
    }
    // banner with the camp's colour and a skull
    const bx = c.banner.x, bz = c.banner.z, by = y0(bx, bz);
    g.add(box(0.12, 4.2, 0.12, 0x4a3020, bx, by + 2.1, bz));
    g.add(box(1.1, 1.6, 0.05, c.camp.banner, bx + 0.6, by + 3.3, bz));
    g.add(box(0.36, 0.36, 0.07, 0xe8e0cc, bx + 0.6, by + 3.4, bz));
  }
  return { props: g, flames };
}

function buildZoneProps(): THREE.Group {
  const g = new THREE.Group();
  const zp = layoutZoneProps();
  for (const { x, z } of zp.tents) {
    const tent = new THREE.Mesh(new THREE.ConeGeometry(3, 4, 5), mat(0x7a5a3a));
    tent.position.set(x, heightAt(x, z) + 2, z);
    tent.castShadow = true;
    g.add(tent);
  }
  for (const { x, z } of zp.totems) {
    g.add(box(0.6, 4, 0.6, 0x5a3a20, x, heightAt(x, z) + 2, z));
    g.add(box(1.2, 0.8, 0.8, 0xaa3322, x, heightAt(x, z) + 3.6, z));
  }
  for (const { x, z, h, tilt } of zp.ruins) {
    const p = box(1, h, 1, 0x6a6460, x, heightAt(x, z) + h / 2 - 0.2, z);
    p.rotation.z = tilt;
    g.add(p);
  }
  for (const { x, z, rot } of zp.graves) {
    const s = box(0.7, 1, 0.2, 0x8a8480, x, heightAt(x, z) + 0.4, z);
    s.rotation.y = rot;
    g.add(s);
  }
  for (const { x, z } of zp.huts) {
    const hut = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 2, 6), mat(0x6a5a3a));
    hut.position.set(x, heightAt(x, z) + 1, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2, 6), mat(0x8a7a3a));
    roof.position.set(x, heightAt(x, z) + 3, z);
    hut.castShadow = roof.castShadow = true;
    g.add(hut, roof);
  }
  return g;
}
