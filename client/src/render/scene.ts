import * as THREE from 'three';
import { fbm, heightAt, inTown, mulberry32, smoothstep, TOWN, TOWN_HEIGHT, WORLD_HALF } from '../../../shared/src/terrain';
import { NPCS, TELEPORTS, ZONES } from '../../../shared/src/data/world';

const SKY = 0xa9c6e0;

/** Road segments from the village toward each hunting ground. */
export const ROADS: [number, number, number, number][] = TELEPORTS.map((t) => {
  const z = ZONES.find((zz) => zz.id === t.id)!;
  return [TOWN.x, TOWN.z, z.x, z.z];
});

function distToSegment(px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function roadDist(x: number, z: number): number {
  let d = Infinity;
  for (const r of ROADS) d = Math.min(d, distToSegment(x, z, r));
  return d;
}

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
  terrain: THREE.Mesh;
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
  scene.add(buildTown());
  scene.add(buildZoneProps());

  return {
    scene, terrain, sun,
    follow(p) {
      sun.position.set(p.x + 60, p.y + 120, p.z + 40);
      sun.target.position.copy(p);
    },
  };
}

function buildTerrain(): THREE.Mesh {
  const size = WORLD_HALF * 2, seg = 250;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const [r, g, b] = groundColor(x, z, h);
    c.setRGB(r, g, b, THREE.SRGBColorSpace);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

function zoneOf(x: number, z: number) {
  return ZONES.find((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r * 1.1);
}

function buildTrees(): THREE.Group {
  const g = new THREE.Group();
  const rng = mulberry32(7);
  const N = 2600;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.2, 5);
  trunkGeo.translate(0, 1.1, 0);
  const pineGeo = new THREE.ConeGeometry(1.5, 4, 6);
  pineGeo.translate(0, 3.8, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1.7, 0);
  leafGeo.translate(0, 3.4, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ flatShading: true }), N);
  const pines = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ flatShading: true }), N);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let ti = 0, pi = 0, li = 0;
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N * 3 && ti < N; i++) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.95, z = (rng() * 2 - 1) * WORLD_HALF * 0.95;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 14 || roadDist(x, z) < 6) continue;
    const h = heightAt(x, z);
    if (h > 42) continue;
    const zone = zoneOf(x, z);
    // keep hunting grounds a bit more open
    if (zone && rng() < 0.55) continue;
    const sc = 0.7 + rng() * 0.7;
    p.set(x, h - 0.1, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    trunks.setMatrixAt(ti, m);
    const dead = zone?.id === 'wastes';
    trunks.setColorAt(ti++, col.set(dead ? 0x3a3030 : 0x6b4a2b));
    if (dead) continue;
    const pine = h > 10 || zone?.id === 'barracks' ? rng() < 0.8 : rng() < 0.35;
    if (pine) {
      pines.setMatrixAt(pi, m);
      pines.setColorAt(pi++, col.setHSL(0.3 + rng() * 0.05, 0.45, 0.22 + rng() * 0.08));
    } else {
      leaves.setMatrixAt(li, m);
      leaves.setColorAt(li++, col.setHSL(0.22 + rng() * 0.08, 0.5, 0.3 + rng() * 0.1));
    }
  }
  for (const [mesh, used] of [[trunks, ti], [pines, pi], [leaves, li]] as const) {
    for (let k = used; k < N; k++) mesh.setMatrixAt(k, hide);
    mesh.count = used;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    g.add(mesh);
  }
  return g;
}

function buildRocks(): THREE.InstancedMesh {
  const rng = mulberry32(99);
  const N = 500;
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0;
  while (n < N) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.95, z = (rng() * 2 - 1) * WORLD_HALF * 0.95;
    if (inTown(x, z) || roadDist(x, z) < 4) continue;
    const sc = 0.3 + rng() * rng() * 2.5;
    p.set(x, heightAt(x, z) + sc * 0.2, z);
    q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
    s.set(sc * (0.8 + rng() * 0.6), sc * (0.6 + rng() * 0.4), sc * (0.8 + rng() * 0.6));
    m.compose(p, q, s);
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n++, col.setHSL(0.08, 0.06, 0.38 + rng() * 0.15));
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
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

  // houses in a ring, leaving road gaps
  const roadAngles = ROADS.map(([ax, az, bx, bz]) => Math.atan2(bz - az, bx - ax));
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const rng = mulberry32(3);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.1;
    if (roadAngles.some((ra) => angDiff(a, ra) < 0.32)) continue;
    const r = 32 + rng() * 8;
    const hx = TOWN.x + Math.cos(a) * r, hz = TOWN.z + Math.sin(a) * r;
    const hs = house(5 + rng() * 3, 5 + rng() * 2, rng() < 0.5 ? 0xe0d4b8 : 0xd0c0a0, rng() < 0.5 ? 0x8a3a2a : 0x4a5a7a);
    hs.position.set(hx, y, hz);
    hs.rotation.y = -a - Math.PI / 2;
    g.add(hs);
  }
  // merchant stalls behind NPCs
  for (const n of NPCS) {
    const stall = new THREE.Group();
    stall.add(box(3, 1, 1, 0x7a5a3a, 0, 0.5, 0));
    for (const sx of [-1.4, 1.4]) stall.add(box(0.15, 2.6, 0.15, 0x5a3a20, sx, 1.3, -0.4));
    const awning = box(3.4, 0.12, 1.8, n.color, 0, 2.6, 0.2);
    awning.rotation.x = 0.25;
    stall.add(awning);
    const dirX = Math.sin(n.ry), dirZ = Math.cos(n.ry);
    stall.position.set(n.x - dirX * 1.6, y, n.z - dirZ * 1.6);
    stall.rotation.y = n.ry;
    g.add(stall);
  }
  // palisade
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    if (roadAngles.some((ra) => angDiff(a, ra) < 0.12)) continue;
    const r = TOWN.r + 2;
    const wx = TOWN.x + Math.cos(a) * r, wz = TOWN.z + Math.sin(a) * r;
    const seg = box(7, 3.2, 0.7, 0x7a5a3a, wx, heightAt(wx, wz) + 1.4, wz);
    seg.rotation.y = -a + Math.PI / 2;
    g.add(seg);
    if (i % 6 === 0) {
      const tower = box(2, 6, 2, 0x6a4a2a, wx, heightAt(wx, wz) + 3, wz);
      g.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 4), mat(0x8a3a2a));
      roof.position.set(wx, heightAt(wx, wz) + 7, wz);
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
    }
  }
  // gate pillars with banners at road exits
  for (const ra of roadAngles) {
    for (const off of [-0.11, 0.11]) {
      const r = TOWN.r + 2;
      const px = TOWN.x + Math.cos(ra + off) * r, pz = TOWN.z + Math.sin(ra + off) * r;
      g.add(box(1.2, 5, 1.2, 0x8a8478, px, heightAt(px, pz) + 2.5, pz));
      const banner = box(0.8, 2, 0.05, 0x8a1a2a, px, heightAt(px, pz) + 3.2, pz);
      banner.rotation.y = -ra;
      g.add(banner);
    }
  }
  return g;
}

function buildZoneProps(): THREE.Group {
  const g = new THREE.Group();
  const rng = mulberry32(11);
  for (const zn of ZONES) {
    if (zn.id === 'barracks') {
      // orc tents & totems
      for (let i = 0; i < 10; i++) {
        const a = rng() * Math.PI * 2, r = 15 + rng() * zn.r * 0.7;
        const x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        const tent = new THREE.Mesh(new THREE.ConeGeometry(3, 4, 5), mat(0x7a5a3a));
        tent.position.set(x, heightAt(x, z) + 2, z);
        tent.castShadow = true;
        g.add(tent);
      }
      for (let i = 0; i < 8; i++) {
        const a = rng() * Math.PI * 2, r = rng() * zn.r * 0.8;
        const x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        g.add(box(0.6, 4, 0.6, 0x5a3a20, x, heightAt(x, z) + 2, z));
        g.add(box(1.2, 0.8, 0.8, 0xaa3322, x, heightAt(x, z) + 3.6, z));
      }
    }
    if (zn.id === 'wastes') {
      // ruined pillars & graves
      for (let i = 0; i < 30; i++) {
        const a = rng() * Math.PI * 2, r = rng() * zn.r * 0.9;
        const x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        const h = 1 + rng() * 5;
        const p = box(1, h, 1, 0x6a6460, x, heightAt(x, z) + h / 2 - 0.2, z);
        p.rotation.z = (rng() - 0.5) * 0.3;
        g.add(p);
      }
      for (let i = 0; i < 40; i++) {
        const a = rng() * Math.PI * 2, r = rng() * zn.r * 0.9;
        const x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        const s = box(0.7, 1, 0.2, 0x8a8480, x, heightAt(x, z) + 0.4, z);
        s.rotation.y = rng() * 0.6;
        g.add(s);
      }
    }
    if (zn.id === 'hills') {
      for (let i = 0; i < 8; i++) {
        const a = rng() * Math.PI * 2, r = rng() * zn.r * 0.8;
        const x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
        const hut = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 2, 6), mat(0x6a5a3a));
        hut.position.set(x, heightAt(x, z) + 1, z);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2, 6), mat(0x8a7a3a));
        roof.position.set(x, heightAt(x, z) + 3, z);
        hut.castShadow = roof.castShadow = true;
        g.add(hut, roof);
      }
    }
  }
  return g;
}
