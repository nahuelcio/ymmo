import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DUSK, fbm, heightAt, inTown, mulberry32, smoothstep, TOWN, TOWN_HEIGHT, TOWNS, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { ZONES } from '../../../shared/src/data/world';
import { layoutCamps, layoutRocks, layoutTown, layoutTrees, layoutZoneProps, nearCamp, roadDist, ROADS, zoneOf } from '../../../shared/src/layout';
import { buildVillage, vReady } from './village';
import { settings } from '../settings';
import { ATMOS, sunPhase, sway, waterMaterial, type LightSource } from './atmos';
import { TerrainTextures, type TerrainTexQuality } from './terrainTex';
import { addSurface, setPropTextures, updatePropTextures, type Precompile, type Surface } from './propTex';

const SKY = 0xa9c6e0;
// Height fog: the standard fog gets a little thicker near the ground (valleys, low fields), scaled by distance
// so nearby geometry is untouched. Patched once on three's shared chunks, so every standard material picks it up.
const FC = THREE.ShaderChunk;
FC.fog_pars_vertex = FC.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogY;');
FC.fog_vertex = FC.fog_vertex.replace('vFogDepth = - mvPosition.z;', `vFogDepth = - mvPosition.z;
	#ifdef USE_INSTANCING
		vFogY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
	#else
		vFogY = (modelMatrix * vec4(transformed, 1.0)).y;
	#endif`);
FC.fog_pars_fragment = FC.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogY;');
FC.fog_fragment = FC.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
  'fogFactor = clamp(fogFactor * (1.0 + 0.55 * (1.0 - smoothstep(0.0, 14.0, vFogY))), 0.0, 1.0);\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );');
const SNAP_UP = new THREE.Vector3(0, 1, 0), snapR = new THREE.Vector3(), snapU = new THREE.Vector3(), snapped = new THREE.Vector3();

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
    sunDir: { value: new THREE.Vector3(0.45, 0.8, 0.3).normalize() }, sunColor: { value: new THREE.Color() }, night: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top, horizon, ground, sunColor, sunDir;
    uniform float night;
    varying vec3 vDir;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, ground, smoothstep(0.0, 0.25, -h));
      float s = max(dot(d, sunDir), 0.0);
      // the sun: a solid disc with a halo and a wide glow (it was a pinprick that was easy to miss)
      c += sunColor * (smoothstep(0.9988, 0.9993, s) * 3.0 + pow(s, 90.0) * 0.5 + pow(s, 10.0) * 0.2) * smoothstep(-0.1, 0.02, sunDir.y);
      if (night > 0.01 && h > 0.0) {
        vec3 q = d * 330.0; // stars: one cell in a few hundred holds a small round dot
        c += vec3(0.85, 0.92, 1.0) * step(0.9955, hash(floor(q))) * smoothstep(0.3, 0.05, length(fract(q) - 0.5)) * night * smoothstep(0.03, 0.3, h);
        float m = max(dot(d, -sunDir), 0.0); // the moon rides opposite the sun
        c += vec3(0.78, 0.85, 1.0) * (smoothstep(0.9993, 0.9996, m) + pow(m, 60.0) * 0.1) * night;
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export { ROADS, roadDist } from '../../../shared/src/layout';

/**
 * How much of each surface covers the ground at (x, z, h). Both the colour (groundColor) and the
 * texture-layer weights (groundLayers) are derived from these, applied in the same order, so the
 * textures always sit on the matching colour.
 */
function groundFactors(x: number, z: number, h: number) {
  const road = 1 - smoothstep(2.2, 4.2, roadDist(x, z));
  const town = Math.max(...TOWNS.map((t) => 1 - smoothstep(t.r - 2, t.r + 6, Math.hypot(x - t.x, z - t.z))));
  const dirt = Math.max(road * 0.85, town);
  return {
    n: fbm(x / 40 + 50, z / 40 - 20, 3),
    rock: smoothstep(14, 26, h),
    snow: smoothstep(45, 60, h),
    road, town, dirt,
    // pond shores: sand at the waterline, darker silt underwater
    sand: (1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 2.2, h)) * (1 - dirt),
    deep: 1 - smoothstep(WATER_LEVEL - 2.5, WATER_LEVEL - 0.2, h),
  };
}

/** Ground colour (sRGB 0..1) used by both terrain mesh and minimap. */
export function groundColor(x: number, z: number, h: number): [number, number, number] {
  const f = groundFactors(x, z, h), n = f.n;
  let r = 0.3 + n * 0.12, g = 0.5 + n * 0.14, b = 0.2 + n * 0.06;
  for (const zn of ZONES) {
    const w = (1 - smoothstep(zn.r * 0.5, zn.r * 1.15, Math.hypot(x - zn.x, z - zn.z))) * 0.75;
    r += (zn.tint[0] * (0.85 + n * 0.3) - r) * w;
    g += (zn.tint[1] * (0.85 + n * 0.3) - g) * w;
    b += (zn.tint[2] * (0.85 + n * 0.3) - b) * w;
  }
  r += (0.47 + n * 0.08 - r) * f.rock; g += (0.45 + n * 0.08 - g) * f.rock; b += (0.42 + n * 0.08 - b) * f.rock;
  r += (0.92 - r) * f.snow; g += (0.93 - g) * f.snow; b += (0.96 - b) * f.snow;
  r += (0.6 + n * 0.08 - r) * f.dirt; g += (0.52 + n * 0.06 - g) * f.dirt; b += (0.38 + n * 0.05 - b) * f.dirt;
  r += (0.74 - r) * f.sand; g += (0.68 - g) * f.sand; b += (0.5 - b) * f.sand;
  r += (0.22 - r) * f.deep; g += (0.32 - g) * f.deep; b += (0.34 - b) * f.deep;
  return [r, g, b];
}

/** Steepness 0 (flat) .. 1 (cliff) from the analytic height field: continuous across terrain chunks. */
export function slopeAt(x: number, z: number): number {
  const e = 1;
  const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  return 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz); // 1 - normal.y
}

/**
 * Texture-layer weights at a ground point, in TERRAIN_LAYERS order
 * (grass, dirt, rock, sand, snow, cobble), written into out[o..o+5]. They sum to 1.
 */
export function groundLayers(x: number, z: number, h: number, out: Float32Array, o: number) {
  const f = groundFactors(x, z, h);
  out.fill(0, o, o + 6);
  out[o] = 1;
  const apply = (layer: number, k: number) => {
    if (k <= 0) return;
    for (let i = 0; i < 6; i++) out[o + i] *= 1 - k;
    out[o + layer] += k;
  };
  apply(2, f.rock);
  apply(4, f.snow);
  apply(1, f.road * 0.85); // roads: packed dirt
  apply(5, f.town); // towns are paved
  apply(3, f.sand);
  apply(3, f.deep); // silt under the ponds reads as sand
  // steep slopes turn to bare rock (snow stays on top of the peaks)
  apply(2, smoothstep(0.07, 0.28, slopeAt(x, z)) * 0.85 * (1 - f.snow) * (1 - f.town));
}

/**
 * Surface texture for the building palette's named colours (render/propTex.ts). Colours that come in
 * as parameters (a house's walls and roof) pass their surface explicitly to mat(); anything not listed
 * here (metal, glass, cloth, gold, foliage) stays plain.
 */
const SURFACE_OF = new Map<number, Surface>([
  // timber, planks, doors, barrels, crates, stools, signs
  ...[0x5a3a20, 0x4a2a15, 0x7a5030, 0x7a5a3a, 0x6a4a2a, 0x6e4e2e, 0x8a6a4a, 0x4a3420, 0x9a7a4a, 0x3a2a18, 0x6a5a3a].map((c) => [c, 'wood'] as const),
  // footings, walls, trim, chimneys, paving, fountain, ruins, graves
  ...[0x8a8478, 0x7a746a, 0x5e5a52, 0x6e695f, 0xbab4a6, 0xcac4b6, 0xa8a294, 0xb8b2a4, 0x8f897d, 0x9a9488, 0x6a6460, 0x8a8480].map((c) => [c, 'stone'] as const),
  // roof tiles, ridge caps, slate
  ...[0x8a3a2a, 0x5e2a1e, 0x4a5a7a].map((c) => [c, 'roof'] as const),
  [0xe0d4b8, 'plaster'],
]);

const matCache = new Map<string, THREE.MeshLambertMaterial>();
/** Flat-shaded Lambert per colour; `surface` overrides the palette lookup ('none' = never textured). */
export function mat(color: number, surface?: Surface | 'none'): THREE.MeshLambertMaterial {
  const s = surface ?? SURFACE_OF.get(color) ?? 'none';
  const key = `${color}|${s}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    if (s !== 'none') addSurface(m, s);
    matCache.set(key, m);
  }
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
  /** ground textures: off, low or high (render/terrainTex.ts) */
  setTextureQuality(q: TerrainTexQuality): void;
}

export function createWorldScene(opts: { maxAnisotropy?: number; precompile?: Precompile } = {}): WorldScene {
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
  const terrainTex = new TerrainTextures(terrain, (terrain.children[0] as THREE.Mesh).material as THREE.Material, opts.maxAnisotropy ?? 1, opts.precompile);
  scene.add(terrain);
  scene.add(buildTrees());
  scene.add(buildRocks());
  scene.add(buildBushes());
  const water = buildWater();
  const waterPlain = water.material as THREE.MeshLambertMaterial, waterFancy = waterMaterial();
  scene.add(water);
  const detail = buildDetail();
  scene.add(detail);
  scene.add(mergeStatic(buildTown()));
  scene.add(buildVillage());
  scene.add(mergeStatic(buildZoneProps()));
  const { props: campProps, flames } = buildCamps();
  scene.add(mergeStatic(campProps), flames);
  // Static world: bake every local matrix once so the per-frame scene traversal (render + labels) skips recomposing them.
  for (const o of scene.children) if (o !== sky && o !== clouds && o !== flames && o !== sun && o !== sun.target && o !== hemi) freeze(o);

  return {
    scene, terrain, sun,
    detail,
    sky,
    setTextureQuality: (q) => {
      terrainTex.set(q);
      setPropTextures(q, opts.maxAnisotropy ?? 1, opts.precompile);
    },
    updateSky(camera: THREE.Camera, far: number, dt: number) {
      terrainTex.update(dt);
      updatePropTextures(dt);
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
      // Hour of the day on top of the region's palette. `el` is the sun's elevation (-0.9 midnight .. 0.9 noon);
      // with the cycle off it stays where the fixed sun always was.
      const A = ATMOS;
      if (settings.s.dayNight) {
        const ph = sunPhase();
        A.sunDir.set(Math.cos(ph) * 0.85, Math.sin(ph), 0.4).normalize();
      } else A.sunDir.set(0.45, 0.8, 0.3).normalize();
      const el = A.sunDir.y;
      const day = (A.day = smoothstep(-0.14, 0.28, el));
      const dusk = (1 - smoothstep(0, 0.42, Math.abs(el))) * smoothstep(-0.3, 0, el); // low sun: warm light
      A.top.copy(tmp.set(0x0a1230)).lerp(cur.top, day);
      A.horizon.copy(tmp.set(0x223258)).lerp(cur.horizon, day).lerp(tmp.set(0xff9450), dusk * 0.55);
      const u = skyMat.uniforms;
      u.top.value.copy(A.top); u.horizon.value.copy(A.horizon);
      u.ground.value.copy(cur.ground).multiplyScalar(0.2 + 0.8 * day);
      u.sunColor.value.copy(cur.sun).lerp(tmp.set(0xff7a30), dusk * 0.8);
      u.sunDir.value.copy(A.sunDir);
      u.night.value = 1 - day;
      (scene.fog as THREE.Fog).color.copy(A.horizon);
      (scene.background as THREE.Color).copy(A.horizon);
      // the sun lights the world while it is up, the moon (opposite) once it is down
      const up = el > -0.06;
      A.lightDir.copy(A.sunDir).multiplyScalar(up ? 1 : -1);
      if (A.lightDir.y < 0.12) A.lightDir.setY(0.12).normalize(); // never rake the ground from below the horizon
      A.lightColor.copy(up ? u.sunColor.value : tmp.set(0x8fa6e8));
      sun.color.copy(A.lightColor);
      // nights stay playable: moonlight and a floor of sky light keep the ground readable
      const nb = settings.s.nightBrightness;
      sun.intensity = up ? cur.sunI * smoothstep(-0.06, 0.24, el) : 1.9 * nb * smoothstep(0.08, 0.3, -el);
      hemi.intensity = cur.hemi * (nb + (1 - nb) * day);
      hemi.color.copy(A.horizon).lerp(tmp.set(0xffffff), 0.4 * day);
      // water follows the setting and the light
      const fancy = settings.s.fancyWater;
      if ((water.material === waterFancy) !== fancy) water.material = fancy ? waterFancy : waterPlain;
      const wu = waterFancy.uniforms, fog = scene.fog as THREE.Fog;
      wu.time.value = performance.now() / 1000;
      wu.day.value = day;
      wu.fogColor.value.copy(fog.color);
      wu.fogNear.value = fog.near;
      wu.fogFar.value = fog.far;
      waterPlain.color.set(0x3a7ab0).multiplyScalar(0.25 + 0.75 * day);
      // campfires flicker
      const ft = performance.now() / 1000;
      flames.children.forEach((f, i) => f.scale.set(1, 0.8 + Math.sin(ft * 13 + i * 1.7) * 0.15 + Math.sin(ft * 7.3 + i) * 0.1, 1));
      CLOUD_MAT.color.copy(cur.cloud).lerp(tmp.set(0xff9a60), dusk * 0.5);
      CLOUD_MAT.emissive.copy(CLOUD_MAT.color).multiplyScalar(0.45 * (0.12 + 0.88 * day));
    },
    follow(p) {
      // snap to whole shadow texels in light space: the map then moves in steps, so edges don't shimmer while walking
      const L = ATMOS.lightDir;
      const texel = (sun.shadow.camera.right * 2) / sun.shadow.mapSize.x;
      if (texel > 0) {
        snapR.crossVectors(SNAP_UP, L).normalize();
        snapU.crossVectors(L, snapR);
        const dr = Math.round(p.dot(snapR) / texel) * texel - p.dot(snapR);
        const du = Math.round(p.dot(snapU) / texel) * texel - p.dot(snapU);
        p = snapped.copy(p).addScaledVector(snapR, dr).addScaledVector(snapU, du);
      }
      sun.position.copy(p).addScaledVector(L, 150);
      sun.target.position.copy(p);
      // grass and flowers only around the player
      if (detail.visible)
        for (const ch of detail.children) ch.visible = Math.abs(ch.userData.cx - p.x) < 95 && Math.abs(ch.userData.cz - p.z) < 95;
    },
  };
}

/** Compute `o`'s subtree matrices now and stop three.js recomputing them every frame (for things that never move). */
function freeze(o: THREE.Object3D) {
  o.traverse((x) => {
    x.updateMatrix();
    x.matrixAutoUpdate = false;
  });
  o.updateMatrixWorld(true);
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
      // texture-layer weights (render/terrainTex.ts): splatA = grass, dirt, rock, sand; splatB = snow, cobble
      const layers = new Float32Array(6);
      const splatA = new Float32Array(pos.count * 4), splatB = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = heightAt(x, z);
        pos.setY(i, h);
        const [r, gg, b] = groundColor(x, z, h);
        c.setRGB(r, gg, b, THREE.SRGBColorSpace);
        colors.set([c.r, c.g, c.b], i * 3);
        groundLayers(x, z, h, layers, 0);
        splatA.set(layers.subarray(0, 4), i * 4);
        splatB.set(layers.subarray(4, 6), i * 2);
      }
      geo.setAttribute('splatA', new THREE.BufferAttribute(splatA, 4));
      geo.setAttribute('splatB', new THREE.BufferAttribute(splatB, 2));
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
/** A surface-textured material for instanced meshes (propTex.ts precompiles the instanced variant). */
function instancedSurface(m: THREE.MeshLambertMaterial, surface: Surface): THREE.MeshLambertMaterial {
  m.userData.instanced = true;
  return addSurface(m, surface);
}

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
    // each piece's yaw, so surface textures (propTex.ts) line up with its own walls, not the world axes
    const e = o.matrixWorld.elements, yaw = Math.atan2(-e[2], e[0]);
    const rot = new Float32Array(g.attributes.position.count * 2);
    for (let i = 0; i < rot.length; i += 2) {
      rot[i] = Math.cos(yaw);
      rot[i + 1] = Math.sin(yaw);
    }
    g.setAttribute('propRot', new THREE.BufferAttribute(rot, 2));
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
  const bark = () => instancedSurface(mat(), 'bark'), canopy = (amp: number) => instancedSurface(sway(mat(), amp), 'leaves');
  const g = new THREE.Group();
  g.add(chunkedInstances(trunkGeo, bark(), trunks), chunkedInstances(pineGeo, canopy(0.007), pines), chunkedInstances(leafGeo, canopy(0.009), leaves));
  if (deads.length) g.add(chunkedInstances(deadGeo, bark(), deads));
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
  return chunkedInstances(new THREE.DodecahedronGeometry(1, 0), instancedSurface(new THREE.MeshLambertMaterial({ flatShading: true }), 'rock'), items);
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
  return chunkedInstances(geo, instancedSurface(new THREE.MeshLambertMaterial({ flatShading: true }), 'leaves'), items);
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
  const grassMat = sway(new THREE.MeshLambertMaterial({ flatShading: true }), 0.45);
  const flowerMat = sway(new THREE.MeshLambertMaterial({ flatShading: true }), 0.5);
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

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, surface?: Surface | 'none') {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, surface));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function house(w: number, d: number, wall: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  const TIMBER = 0x5a3a20, STONE = 0x8a8478, base = 0.5, h = 3.4;
  g.add(box(w + 0.3, base, d + 0.3, STONE, 0, base / 2, 0)); // stone footing
  g.add(box(w, h - base, d, wall, 0, (h + base) / 2, 0, 'plaster'));
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
  const r = new THREE.Mesh(prism, mat(roof, 'roof'));
  r.position.y = h + 0.1 + (rr / 2) * sy;
  r.castShadow = true;
  g.add(r);
  g.add(box(w + 1.1, 0.14, 0.3, darken(roof), 0, h + 0.1 + roofH, 0, 'roof')); // ridge cap
  // the gable ends are wall, not roof
  for (const sx of [-1, 1]) {
    const gable = new THREE.Mesh(new THREE.CylinderGeometry(d / Math.sqrt(3), d / Math.sqrt(3), 0.1, 3, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, (roofH * 0.82) / (1.5 * (d / Math.sqrt(3))), 1), mat(wall, 'plaster'));
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

// ---------------------------------------------------------------- landmark buildings
// All three are built front toward +z around the origin, like house(), on the footprint the shared layout gives.
const LM_TIMBER = 0x5a3a20, LM_STONE = 0x8a8478, LM_DARK = 0x4a2a15;
const WINDOW_LIT = new THREE.MeshLambertMaterial({ color: 0xffd98a, emissive: 0xffb040, emissiveIntensity: 0.85, flatShading: true });
const EMBERS = new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0xff4a00, emissiveIntensity: 1, flatShading: true });

/** Gabled roof (ridge along x) sitting on y = 0. */
function gable(w: number, d: number, h: number, color: number, surface?: Surface | 'none'): THREE.Mesh {
  const rr = d / Math.sqrt(3), sy = h / (1.5 * rr);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, w, 3, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, sy, 1), mat(color, surface));
  m.position.y = (rr / 2) * sy;
  m.castShadow = true;
  return m;
}

/** A window on a front/back wall (side = false) or a side wall: frame, pane, cross bar. */
function pane(g: THREE.Group, x: number, y: number, z: number, side: boolean, w = 0.9, h = 0.9, lit = false) {
  const t = 0.14;
  g.add(box(side ? t : w + 0.24, h + 0.24, side ? w + 0.24 : t, LM_TIMBER, x, y, z));
  const glass = box(side ? t + 0.02 : w, h, side ? w : t + 0.02, 0x9fd3ff, x, y, z);
  if (lit) glass.material = WINDOW_LIT;
  g.add(glass);
  g.add(box(side ? t + 0.04 : 0.07, h, side ? 0.07 : t + 0.04, LM_TIMBER, x, y, z));
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

function barrel(x: number, y: number, z: number): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.85, 8), mat(0x7a5030));
  b.position.set(x, y + 0.42, z);
  b.castShadow = true;
  return b;
}

/** Two-storey inn: stone ground floor, jettied timber upper floor, lit windows, a sign and tables outside. */
function tavern(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const f = d / 2, uw = w + 0.9, ud = d + 0.9, y1 = 3.5, y2 = 6.1;
  g.add(box(w + 0.4, 0.5, d + 0.4, LM_STONE, 0, 0.25, 0));
  g.add(box(w, y1 - 0.5, d, 0xa8a294, 0, (y1 + 0.5) / 2, 0)); // stone ground floor
  g.add(box(uw + 0.2, 0.3, ud + 0.2, LM_TIMBER, 0, y1, 0)); // jetty beam
  g.add(box(uw, y2 - y1, ud, 0xe0d4b8, 0, (y1 + y2) / 2, 0)); // plastered upper floor
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(box(0.3, y2 - y1, 0.3, LM_TIMBER, (sx * uw) / 2, (y1 + y2) / 2, (sz * ud) / 2));
    for (const k of [-1, 0, 1]) g.add(box(0.18, y2 - y1, 0.1, LM_TIMBER, (k * uw) / 3.2, (y1 + y2) / 2, (sx * (ud + 0.06)) / 2));
  }
  g.add(box(uw + 0.3, 0.26, ud + 0.3, LM_TIMBER, 0, y2, 0));
  g.add(at(gable(uw - 0.02, ud, 2.6, 0xe0d4b8), 0, y2 + 0.1, 0)); // gable ends
  const roof = gable(uw + 1.1, ud + 1.5, 3.2, 0x8a3a2a);
  roof.position.y += y2 + 0.1;
  g.add(roof);
  g.add(box(uw + 1.2, 0.16, 0.34, 0x5e2a1e, 0, y2 + 3.3, 0));
  g.add(box(1.3, 9.2, 1.3, LM_STONE, -w / 2 - 0.3, 4.6, -d / 5)); // chimney up the side
  g.add(box(1.6, 0.25, 1.6, 0x5e5a52, -w / 2 - 0.3, 9.3, -d / 5));
  // double door, step and a lantern
  g.add(box(2.7, 2.9, 0.14, LM_TIMBER, 0, 1.95, f + 0.05));
  for (const sx of [-1, 1]) g.add(box(1.1, 2.6, 0.18, LM_DARK, sx * 0.58, 1.8, f + 0.06));
  g.add(box(3.4, 0.25, 1.1, LM_STONE, 0, 0.37, f + 0.6));
  g.add(at(new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), WINDOW_LIT), 1.75, 2.9, f + 0.35));
  // windows: warm light on both floors
  for (const sx of [-1, 1]) {
    pane(g, sx * (w / 2 - 1.7), 2.1, f + 0.04, false, 1.4, 1.2, true);
    pane(g, sx * (w / 2 + 0.04), 2.1, 0, true, 1.4, 1.2, true);
    pane(g, sx * (uw / 2 + 0.04), 4.8, 0, true, 1.1, 1.1, true);
  }
  for (const k of [-1, 0, 1]) pane(g, (k * uw) / 3.2 + uw / 6.4, 4.8, ud / 2 + 0.04, false, 1, 1.1, k !== 0);
  // hanging sign: a mug of ale
  g.add(box(0.14, 0.14, 1.8, LM_TIMBER, -2.4, 3.3, f + 0.9));
  g.add(box(1.2, 0.9, 0.1, 0x3a2a18, -2.4, 2.65, f + 1.5));
  for (const sz of [-0.07, 0.07]) {
    g.add(box(0.42, 0.46, 0.04, 0xe8c060, -2.45, 2.6, f + 1.5 + sz));
    g.add(box(0.46, 0.14, 0.04, 0xf4f0e4, -2.45, 2.9, f + 1.5 + sz));
  }
  // out front: tables with stools, and the cellar's barrels
  for (const sx of [-1, 1]) {
    const tx = sx * (w / 2 - 1.2), tz = f + 2.6;
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 10), mat(0x7a5a3a)), tx, 0.85, tz));
    g.add(box(0.2, 0.8, 0.2, LM_TIMBER, tx, 0.4, tz));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + sx;
      g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.48, 8), mat(0x6a4a2a)), tx + Math.cos(a) * 1.15, 0.24, tz + Math.sin(a) * 1.15));
    }
    g.add(box(0.22, 0.26, 0.22, 0xe8c060, tx + 0.2, 1.03, tz - 0.1));
  }
  g.add(barrel(w / 2 + 0.7, 0, f - 1), barrel(w / 2 + 0.7, 0, f - 1.8), barrel(w / 2 + 0.7, 0.85, f - 1.4));
  return g;
}

/** Stone town hall: steps, pilasters, banners and a clock tower with a bell and a spire. */
function townHall(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const f = d / 2, WALL = 0xb8b2a4, TRIM = 0x8f897d, SLATE = 0x4a5a7a, y0 = 0.8, y1 = 6;
  g.add(box(w + 1.2, y0, d + 1.2, 0x7a746a, 0, y0 / 2, 0)); // plinth
  g.add(box(w, y1 - y0, d, WALL, 0, (y0 + y1) / 2, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.7, y1 - y0, 0.7, TRIM, (sx * w) / 2, (y0 + y1) / 2, (sz * d) / 2));
  g.add(box(w + 0.8, 0.4, d + 0.8, TRIM, 0, y1, 0)); // cornice
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 3, 4), mat(SLATE));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, (d + 1) / (w + 1));
  roof.position.y = y1 + 1.7;
  roof.castShadow = true;
  g.add(roof);
  // clock tower rising out of the front
  const tz = f - 1.1, th = 11.5;
  g.add(box(3.2, th, 3.2, WALL, 0, y0 + th / 2, tz));
  for (const sx of [-1, 1]) g.add(box(0.5, th, 0.5, TRIM, sx * 1.6, y0 + th / 2, tz + 1.6));
  g.add(box(3.8, 0.35, 3.8, TRIM, 0, y0 + th, tz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.4, 1.9, 0.4, TRIM, sx * 1.4, y0 + th + 1.1, tz + sz * 1.4)); // belfry
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.65, 0.8, 8), mat(0xd8b050)), 0, y0 + th + 1.2, tz)); // bell
  g.add(box(3.8, 0.3, 3.8, TRIM, 0, y0 + th + 2.2, tz));
  const spire = new THREE.Mesh(new THREE.ConeGeometry(2.7, 3.6, 4), mat(SLATE));
  spire.rotation.y = Math.PI / 4;
  spire.position.set(0, y0 + th + 4.1, tz);
  spire.castShadow = true;
  g.add(spire);
  g.add(box(0.08, 1.6, 0.08, 0x2a2a2a, 0, y0 + th + 6.6, tz));
  g.add(box(0.9, 0.5, 0.04, 0x8a1a2a, 0.5, y0 + th + 7.1, tz));
  // clock face with its hands
  const face = at(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 16).rotateX(Math.PI / 2), mat(0xf0ead8)), 0, y0 + 9.2, tz + 1.62);
  g.add(face, at(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.08, 16).rotateX(Math.PI / 2), mat(0x3a2a18)), 0, y0 + 9.2, tz + 1.6));
  g.add(box(0.1, 0.75, 0.05, 0x1a1a1a, 0, y0 + 9.55, tz + 1.72));
  const hand = box(0.08, 0.55, 0.05, 0x1a1a1a, 0.22, y0 + 9.35, tz + 1.72);
  hand.rotation.z = -1.1;
  g.add(hand);
  // great door at the top of the steps
  g.add(box(2.4, 3.5, 0.16, TRIM, 0, y0 + 1.75, tz + 1.62));
  for (const sx of [-1, 1]) g.add(box(0.95, 3.1, 0.2, LM_DARK, sx * 0.5, y0 + 1.55, tz + 1.64));
  for (let k = 0; k < 3; k++) g.add(box(6 - k * 0.6, y0 / 3, 0.6, 0x9a9488, 0, (y0 / 3) * (k + 0.5), tz + 2.9 - k * 0.6));
  // banners and tall windows
  for (const sx of [-1, 1]) {
    g.add(box(1.1, 3.6, 0.08, 0x8a1a2a, sx * (w / 2 - 2.6), 3.9, f + 0.06));
    g.add(box(0.5, 0.5, 0.1, 0xe8c060, sx * (w / 2 - 2.6), 4.4, f + 0.08));
    pane(g, sx * (w / 2 - 1.1), 3.6, f + 0.04, false, 0.9, 2.4);
    for (const k of [-1, 0, 1]) pane(g, sx * (w / 2 + 0.04), 3.6, k * (d / 3.4), true, 1, 2.4);
  }
  for (const k of [-1.5, -0.5, 0.5, 1.5]) pane(g, k * (w / 4.4), 3.6, -f - 0.04, false, 1, 2.4);
  return g;
}

/** Open-fronted smithy: forge with glowing coals and a chimney, anvil, grindstone, quench trough and racks. */
function smithy(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const f = d / 2, h = 3.5, IRON = 0x3a3a3a;
  g.add(box(w + 0.4, 0.3, d + 0.4, 0x7a746a, 0, 0.15, 0)); // flagstone floor
  g.add(box(w, h - 0.3, 0.5, LM_STONE, 0, (h + 0.3) / 2, -f + 0.25)); // back wall
  g.add(box(0.5, h - 0.3, d * 0.62, LM_STONE, -w / 2 + 0.25, (h + 0.3) / 2, -f + d * 0.31)); // forge-side wall
  g.add(box(0.5, 1.2, d * 0.5, LM_STONE, w / 2 - 0.25, 0.9, -f + d * 0.25)); // low wall on the open side
  for (const [px, pz] of [[-w / 2 + 0.2, f - 0.2], [w / 2 - 0.2, f - 0.2], [w / 2 - 0.2, -f + 0.2], [0, f - 0.2]]) g.add(box(0.36, h - 0.3, 0.36, LM_TIMBER, px, (h + 0.3) / 2, pz));
  for (const sz of [-1, 1]) g.add(box(w + 0.6, 0.3, 0.3, LM_TIMBER, 0, h, sz * (f - 0.2)));
  for (const sx of [-1, 0, 1]) g.add(box(0.3, 0.3, d + 0.6, LM_TIMBER, sx * (w / 2 - 0.2), h, 0));
  const roof = gable(w + 1.6, d + 1.8, 2.3, 0x3a3a3a, 'roof');
  roof.position.y += h + 0.15;
  g.add(roof);
  // forge and chimney
  const fx = -w / 4, fz = -f + 1.5;
  g.add(box(2.6, 1.1, 1.9, 0x5e5a52, fx, 0.85, fz));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 1.2), EMBERS), fx, 1.46, fz + 0.1));
  g.add(box(2.6, 0.5, 0.3, 0x5e5a52, fx, 1.65, fz - 0.8));
  g.add(box(1.5, 7.2, 1.3, LM_STONE, fx, 3.9, -f + 0.9));
  g.add(box(1.8, 0.25, 1.6, 0x5e5a52, fx, 7.6, -f + 0.9));
  g.add(box(1.1, 0.5, 0.7, 0x6a4a2a, fx - 1.7, 0.75, fz + 0.3)); // bellows
  // anvil on its stump
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.7, 8), mat(0x6a4a2a)), 0.9, 0.65, 0.2));
  g.add(box(0.5, 0.2, 0.36, IRON, 0.9, 1.1, 0.2), box(1.05, 0.24, 0.42, IRON, 0.95, 1.32, 0.2), box(0.3, 0.14, 0.3, IRON, 1.6, 1.3, 0.2));
  // quench trough and grindstone
  g.add(box(1.6, 0.7, 0.8, 0x6a4a2a, w / 2 - 1.4, 0.65, f - 1.2));
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.55), new THREE.MeshLambertMaterial({ color: 0x4a90c8, flatShading: true })), w / 2 - 1.4, 0.98, f - 1.2));
  g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.16, 12).rotateZ(Math.PI / 2), mat(0x9a9488)), -w / 2 + 1.4, 0.95, f - 1.4));
  for (const sx of [-1, 1]) g.add(box(0.1, 0.9, 0.5, LM_TIMBER, -w / 2 + 1.4 + sx * 0.2, 0.7, f - 1.4));
  // rack of finished blades on the back wall, shields and a stack of ingots
  g.add(box(3, 0.12, 0.16, LM_TIMBER, w / 4, 2.4, -f + 0.6), box(3, 0.12, 0.16, LM_TIMBER, w / 4, 1.5, -f + 0.6));
  for (let k = 0; k < 4; k++) {
    g.add(box(0.1, 1.5, 0.04, 0xc8d0d8, w / 4 - 1.1 + k * 0.72, 1.95, -f + 0.7));
    g.add(box(0.32, 0.07, 0.08, 0x8a6a2a, w / 4 - 1.1 + k * 0.72, 1.35, -f + 0.7));
  }
  for (const [sx, c] of [[-0.5, 0x8a1a2a], [0.5, 0x3a5a8a]] as const) g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 10).rotateX(Math.PI / 2), mat(c)), w / 2 - 0.55, 2.2, -f + d * 0.25 + sx));
  for (let k = 0; k < 5; k++) g.add(box(0.6, 0.16, 0.26, k % 2 ? 0x8a8f95 : 0x7a7f85, w / 2 - 1.5 + (k % 2) * 0.1, 0.38 + (k >> 1) * 0.17, -f + 1 + (k % 2) * 0.3));
  // hanging sign: an anvil
  g.add(box(0.14, 0.14, 1.6, LM_TIMBER, w / 2 - 0.2, 3.1, f + 0.6));
  g.add(box(1.1, 0.8, 0.1, 0x3a2a18, w / 2 - 0.2, 2.5, f + 1.1));
  for (const sz of [-0.07, 0.07]) g.add(box(0.6, 0.16, 0.04, 0xc8d0d8, w / 2 - 0.2, 2.6, f + 1.1 + sz), box(0.26, 0.24, 0.04, 0xc8d0d8, w / 2 - 0.2, 2.4, f + 1.1 + sz));
  g.add(barrel(-w / 2 - 0.6, 0, f - 0.8));
  return g;
}

function buildTown(): THREE.Group {
  const g = new THREE.Group();
  const y = TOWN_HEIGHT;
  // The bell tower stands where the fountain was (client/src/render/village.ts).

  // village life: lamp posts around the plaza, barrels and crates by the stalls
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
  const L = layoutTown();
  const kit = vReady();
  for (const h of L.houses) {
    if (!h.out && kit) continue; // the kit instances replace the village boxes
    const hs = h.kind === 'tavern' ? tavern(h.w, h.d) : h.kind === 'hall' ? townHall(h.w, h.d) : h.kind === 'smithy' ? smithy(h.w, h.d) : house(h.w, h.d, h.wall, h.roof);
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
  // The village ring is the stone curtain (render/village.ts). These logs are the Bastión.
  // Without the kit, the village falls back to one box per wall, gate jamb and tower.
  for (const w of L.walls) {
    if (!w.out) {
      if (!kit) {
        const wy = heightAt(w.x, w.z);
        const h = w.tower ? 11 : 4;
        const seg = box((w.hw ?? 1) * 2, h, (w.hd ?? 0.15) * 2, w.tower ? 0x9a9488 : 0x8a8478, w.x, wy + h / 2, w.z);
        seg.rotation.y = w.rot;
        g.add(seg);
      }
      continue;
    }
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
  // the village's own dressing (lanes, arches, yards) only knows the village
  dressTown(g, { ...L, houses: L.houses.filter((h) => !h.out), walls: L.walls.filter((w) => !w.out), gates: L.gates.filter((p) => !p.out) }, y);
  // Bastión del Ocaso: a dark stone plaza around a watch fire
  const dusk = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.2, 24), mat(0x6e695f));
  dusk.position.set(DUSK.x, y + 0.02, DUSK.z);
  dusk.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.6, 10), mat(0x4a4640));
  ring.position.set(DUSK.x, y + 0.3, DUSK.z);
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 6), new THREE.MeshLambertMaterial({ color: 0xff8a2a, emissive: 0xff5a10, emissiveIntensity: 1, flatShading: true }));
  fire.position.set(DUSK.x, y + 1.3, DUSK.z);
  g.add(dusk, ring, fire);
  return g;
}

/**
 * Village dressing: benches, yards and hedges. Gates are the stone arches on the curtain.
 * The ground is the stone tiles from the kit (shared/src/village.ts). None of this has collision.
 */
function dressTown(g: THREE.Group, L: ReturnType<typeof layoutTown>, y: number) {
  const TIMBER = 0x5a3a20;
  const rng = mulberry32(21);
  const flat = (m: THREE.Mesh) => ((m.castShadow = false), m);
  const turned = <T extends THREE.Object3D>(o: T, ry: number) => ((o.rotation.y = ry), o);
  const roads = ROADS.map(([ax, az, bx, bz]) => Math.atan2(bz - az, bx - ax));

  // Box benches only if the kit bench did not load. Backs face the bell tower.
  if (!vReady()) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const bench = new THREE.Group();
    bench.add(box(2.2, 0.12, 0.6, 0x7a5a3a, 0, 0.5, 0));
    bench.add(box(2.2, 0.45, 0.1, 0x7a5a3a, 0, 0.9, -0.28));
    for (const sx of [-0.95, 0.95]) bench.add(box(0.12, 0.5, 0.55, TIMBER, sx, 0.25, 0));
    bench.position.set(TOWN.x + Math.cos(a) * 9.5, y + 0.12, TOWN.z + Math.sin(a) * 9.5);
    g.add(turned(bench, Math.atan2(Math.cos(a), Math.sin(a))));
  }

  // each house: a fenced vegetable bed, a woodpile and a barrel or hay bale. The street is already paved.
  for (const h of L.houses) {
    if (h.kind) continue;
    const yard = new THREE.Group();
    const f = h.d / 2;
    const bx = h.w / 2 + 1.7;
    yard.add(flat(box(2.4, 0.22, 3, 0x4e3a24, bx, 0.11, 0)));
    for (let k = 0; k < 6; k++) {
      const crop = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(k % 3 ? 0x4f8a3a : 0xc86a3a));
      crop.position.set(bx - 0.6 + (k % 2) * 1.2, 0.36, -1 + (k >> 1));
      yard.add(crop);
    }
    for (const sz of [-1.6, 1.6]) yard.add(box(2.7, 0.08, 0.08, TIMBER, bx, 0.55, sz));
    for (const sx of [-1.3, 1.3]) {
      yard.add(box(0.08, 0.08, 3.2, TIMBER, bx + sx, 0.55, 0));
      for (const sz of [-1.6, 0, 1.6]) yard.add(box(0.12, 0.75, 0.12, TIMBER, bx + sx, 0.37, sz));
    }
    // woodpile against the side wall: three logs with two on top
    [[0, 0.19], [0.36, 0.19], [0.72, 0.19], [0.18, 0.5], [0.54, 0.5]].forEach(([dx, ly], k) => {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.3, 6).rotateX(Math.PI / 2), mat(k % 2 ? 0x7a5a3a : 0x6a4a2a));
      log.position.set(-h.w / 2 - 0.4 - dx, ly, -h.d / 4);
      log.castShadow = true;
      yard.add(log);
    });
    if (rng() < 0.5) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.85, 8), mat(0x7a5030));
      barrel.position.set(h.w / 2 - 0.5, 0.42, f + 0.5);
      barrel.castShadow = true;
      yard.add(barrel);
    } else {
      yard.add(box(1.3, 0.8, 0.8, 0xc8a84a, -h.w / 2 + 0.7, 0.4, f + 0.6));
      yard.add(box(1.34, 0.06, 0.84, 0x8a6a2a, -h.w / 2 + 0.7, 0.55, f + 0.6));
    }
    yard.position.set(h.x, y, h.z);
    g.add(turned(yard, h.rot));
  }

  // bushes along the inside of the curtain, open at each road
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + rng() * 0.05;
    if (roads.some((r) => Math.abs(Math.atan2(Math.sin(a - r), Math.cos(a - r))) < 0.22)) continue;
    const r = TOWN.r - 1.2 - rng() * 0.7, sc = 0.8 + rng() * 0.6;
    const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 0), mat(rng() < 0.5 ? 0x4a7a3a : 0x3d6a34));
    bush.position.set(TOWN.x + Math.cos(a) * r, heightAt(TOWN.x + Math.cos(a) * r, TOWN.z + Math.sin(a) * r) + sc * 0.45, TOWN.z + Math.sin(a) * r);
    bush.scale.y = 0.7;
    bush.rotation.y = rng() * 3;
    bush.castShadow = true;
    g.add(bush);
  }
}

/** Everything that glows in the world: lamp posts, campfires, the forge and the tavern door. */
export function lightSources(): LightSource[] {
  const out: LightSource[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    out.push({ x: TOWN.x + Math.cos(a) * 17.4, y: TOWN_HEIGHT + 2.8, z: TOWN.z + Math.sin(a) * 17.4, fire: false });
  }
  for (const c of layoutCamps()) out.push({ x: c.fire.x, y: heightAt(c.fire.x, c.fire.z) + 1, z: c.fire.z, fire: true });
  for (const h of layoutTown().houses) {
    // a point in the building's own frame (front = +z), turned into the world like its mesh
    const local = h.kind === 'smithy' ? [0, 1.6, h.d / 2 + 0.6] : h.kind === 'tavern' ? [0, 2.4, h.d / 2 + 1] : null;
    if (!local) continue;
    const c = Math.cos(h.rot), sn = Math.sin(h.rot);
    out.push({ x: h.x + local[0] * c + local[2] * sn, y: TOWN_HEIGHT + local[1], z: h.z - local[0] * sn + local[2] * c, fire: h.kind === 'smithy' });
  }
  return out;
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
    const tent = new THREE.Mesh(new THREE.ConeGeometry(3, 4, 5), mat(0x7a5a3a, 'none')); // leather, not planks
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
