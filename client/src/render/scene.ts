import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, heightAt, smoothstep, TOWN, TOWN_HEIGHT, WORLD_HALF } from '../../../shared/src/terrain';
import { ZONES } from '../../../shared/src/data/world';
import { layoutRocks, layoutTown, layoutTrees, layoutZoneProps, roadDist } from '../../../shared/src/layout';

const SKY = 0xa9c6e0;

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
  follow(p: THREE.Vector3): void;
}

export function createWorldScene(): WorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 90, 420);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 1.6));
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
  scene.add(mergeStatic(buildTown()));
  scene.add(mergeStatic(buildZoneProps()));

  return {
    scene, terrain, sun,
    follow(p) {
      sun.position.set(p.x + 60, p.y + 120, p.z + 40);
      sun.target.position.copy(p);
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
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
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
  const pineGeo = new THREE.ConeGeometry(1.5, 4, 6);
  pineGeo.translate(0, 3.8, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1.7, 0);
  leafGeo.translate(0, 3.4, 0);
  const trunks: Inst[] = [], pines: Inst[] = [], leaves: Inst[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const t of layoutTrees()) {
    p.set(t.x, t.h - 0.1, t.z);
    q.setFromAxisAngle(up, t.rot);
    s.set(t.sc, t.sc, t.sc);
    const m = new THREE.Matrix4().compose(p, q, s);
    trunks.push({ m, x: t.x, z: t.z, c: new THREE.Color(t.dead ? 0x3a3030 : 0x6b4a2b) });
    if (t.dead) continue;
    if (t.pine) pines.push({ m, x: t.x, z: t.z, c: new THREE.Color().setHSL(0.3 + t.hue * 0.05, 0.45, 0.22 + t.light * 0.08) });
    else leaves.push({ m, x: t.x, z: t.z, c: new THREE.Color().setHSL(0.22 + t.hue * 0.08, 0.5, 0.3 + t.light * 0.1) });
  }
  const mat = () => new THREE.MeshLambertMaterial({ flatShading: true });
  const g = new THREE.Group();
  g.add(chunkedInstances(trunkGeo, mat(), trunks), chunkedInstances(pineGeo, mat(), pines), chunkedInstances(leafGeo, mat(), leaves));
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

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function house(w: number, d: number, wall: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  const h = 3.2;
  g.add(box(w, h, d, wall, 0, h / 2, 0));
  // timber frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.3, h, 0.3, 0x5a3a20, (sx * w) / 2, h / 2, (sz * d) / 2));
  g.add(box(w + 0.2, 0.25, d + 0.2, 0x5a3a20, 0, h, 0));
  const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.82, 2.6, 4), mat(roof));
  r.rotation.y = Math.PI / 4;
  r.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
  r.position.y = h + 1.3;
  r.castShadow = true;
  g.add(r);
  g.add(box(1.1, 2, 0.1, 0x4a2a15, 0, 1, d / 2 + 0.05));
  g.add(box(0.8, 0.8, 0.1, 0x9fd3ff, w / 4, 2, d / 2 + 0.05));
  return g;
}

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
  // palisade
  for (const w of L.walls) {
    const seg = box(7, 3.2, 0.7, 0x7a5a3a, w.x, heightAt(w.x, w.z) + 1.4, w.z);
    seg.rotation.y = w.rot;
    g.add(seg);
    if (w.tower) {
      g.add(box(2, 6, 2, 0x6a4a2a, w.x, heightAt(w.x, w.z) + 3, w.z));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 4), mat(0x8a3a2a));
      roof.position.set(w.x, heightAt(w.x, w.z) + 7, w.z);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
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
