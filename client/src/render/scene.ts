import * as THREE from 'three';
import { Clouds, cloudShadow } from './clouds';
import { fortLanterns, FORTS } from '../../../shared/src/village';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { biomeWeight, fbm, heightAt, inTown, mulberry32, valueNoise, smoothstep, TOWN, TOWN_HEIGHT, TOWNS, VOLCANO, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { ZONES } from '../../../shared/src/data/world';
import { layoutCamps, layoutRocks, layoutTown, layoutTrees, layoutZoneProps, nearCamp, plazaBenches, roadDist, ROADS, zoneOf, detailCells, layoutBushes } from '../../../shared/src/layout';
import { buildVillage, vReady } from './village';
import { buildNatureTown, dropNodeInstances, natureDetailCell, NATURE_DETAIL_DRAWS, natureReady, natureTile } from './nature';
import { setCharAniso } from './quaternius';
import { settings } from '../settings';
import { ATMOS, sunPhase, sway, waterMaterial, type LightSource } from './atmos';
import { TerrainTextures, type TerrainTexQuality } from './terrainTex';
import { WaterReflection } from './reflect';
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
/** near: where the fog starts, as a share of the view distance (thick swamp air, clear frost); 0.22 when left out. */
interface SkyPal { top: number; horizon: number; ground: number; sun: number; sunI: number; hemi: number; cloud: number; near?: number }
const SKIES: Record<string, SkyPal> = {
  town: { top: 0x4a86d0, horizon: 0xb8d4ec, ground: 0x5a4a35, sun: 0xfff0d0, sunI: 2.4, hemi: 1.6, cloud: 0xffffff },
  meadows: { top: 0x3a8ae0, horizon: 0xcfe6f6, ground: 0x5a5a35, sun: 0xfff6dc, sunI: 2.6, hemi: 1.7, cloud: 0xffffff },
  hills: { top: 0x5a8cc0, horizon: 0xc8d6d8, ground: 0x4a4a30, sun: 0xfff0d8, sunI: 2.3, hemi: 1.5, cloud: 0xeef2f4 },
  barracks: { top: 0x5a4a78, horizon: 0xe8a070, ground: 0x4a3020, sun: 0xffb070, sunI: 2.1, hemi: 1.3, cloud: 0xf0b890 },
  wastes: { top: 0x24203a, horizon: 0x7a7088, ground: 0x2a2228, sun: 0xc8b8e8, sunI: 1.4, hemi: 1.0, cloud: 0x5a5468 },
  coast: { top: 0x3f7fb8, horizon: 0xd8e4e0, ground: 0x6a6048, sun: 0xfff2d8, sunI: 2.5, hemi: 1.6, cloud: 0xf4f6f6 },
  ruins: { top: 0x41617a, horizon: 0x9fb2b4, ground: 0x34403c, sun: 0xdde6e0, sunI: 1.8, hemi: 1.3, cloud: 0xb4c0c2 },
  steppes: { top: 0x8a5a3a, horizon: 0xe8b078, ground: 0x5a3420, sun: 0xffc080, sunI: 2.5, hemi: 1.3, cloud: 0xe8a878 },
  citadel: { top: 0x4a3a30, horizon: 0x9a8670, ground: 0x302820, sun: 0xe8c8a0, sunI: 1.8, hemi: 1.1, cloud: 0x80705e },
  valley: { top: 0x4a6e70, horizon: 0xa8c0a8, ground: 0x34402c, sun: 0xf0f0d0, sunI: 2.0, hemi: 1.4, cloud: 0xc8d4c8 },
  nest: { top: 0x3a2438, horizon: 0x9a6a6a, ground: 0x2a1c22, sun: 0xff9a70, sunI: 1.7, hemi: 1.0, cloud: 0x7a5058 },
  // whole regions (biomeWeight), so their towns and the land between zones get the sky too
  dusk: { top: 0x5a78b0, horizon: 0xf0c8a0, ground: 0x5a3a28, sun: 0xffd8a0, sunI: 2.4, hemi: 1.5, cloud: 0xf8dcc0 },
  heart: { top: 0x3a84d0, horizon: 0xc4e0d0, ground: 0x3a5a30, sun: 0xfff4d0, sunI: 2.6, hemi: 1.7, cloud: 0xffffff, near: 0.3 },
  dragon: { top: 0x52506e, horizon: 0xb09a90, ground: 0x3a2a24, sun: 0xffc8a0, sunI: 2.1, hemi: 1.3, cloud: 0xc0a8a0, near: 0.18 },
  frost: { top: 0x6a90b8, horizon: 0xe4ecf2, ground: 0xb8c4cc, sun: 0xf0f6ff, sunI: 2.2, hemi: 1.8, cloud: 0xf4f8fc, near: 0.12 },
  swamp: { top: 0x3e4c34, horizon: 0x8a9670, ground: 0x2a3020, sun: 0xd8e0a0, sunI: 1.5, hemi: 1.2, cloud: 0x7a8466, near: 0.03 },
  ash: { top: 0x1e1210, horizon: 0x7a4a34, ground: 0x2a1810, sun: 0xff7a40, sunI: 1.5, hemi: 0.9, cloud: 0x4a3430, near: 0.06 },
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
  const frost = biomeWeight('frost', x, z), swamp = biomeWeight('swamp', x, z), ash = biomeWeight('ash', x, z);
  // the snow line: every range's tops are white (the volcano's are not)
  const peak = smoothstep(36, 50, h + (valueNoise(x / 25, z / 25) - 0.5) * 10) * (1 - ash);
  const shore = (1 - smoothstep(WATER_LEVEL + 0.4, WATER_LEVEL + 2.2, h)) * (1 - dirt);
  return {
    n: fbm(x / 40 + 50, z / 40 - 20, 3),
    rock: smoothstep(14, 26, h),
    // the peaks, and the whole frost region under its snow
    snow: Math.max(peak, frost * 0.92),
    peak, ash,
    road, town, dirt,
    // pond shores: sand at the waterline (snow in the frost region, mud in the swamp), darker silt underwater
    sand: shore * (1 - frost) * (1 - swamp),
    mud: shore * swamp,
    deep: 1 - smoothstep(WATER_LEVEL - 2.5, WATER_LEVEL - 0.2, h),
  };
}

/** Ground colour (sRGB 0..1) used by both terrain mesh and minimap. */
export function groundColor(x: number, z: number, h: number): [number, number, number] {
  const f = groundFactors(x, z, h), n = f.n;
  let r = 0.3 + n * 0.12, g = 0.5 + n * 0.14, b = 0.2 + n * 0.06;
  // the swamp region's dark, wet green
  const sw = biomeWeight('swamp', x, z) * 0.85;
  r += (0.2 + n * 0.08 - r) * sw; g += (0.3 + n * 0.1 - g) * sw; b += (0.13 + n * 0.04 - b) * sw;
  // the volcanic region's basalt and ash
  const as = f.ash * 0.9;
  r += (0.14 + n * 0.05 - r) * as; g += (0.12 + n * 0.03 - g) * as; b += (0.115 + n * 0.03 - b) * as;
  // the midlands: dusk's dry olive autumn, the Heart's lush green, the dragon's scorched brown
  const du = biomeWeight('dusk', x, z) * 0.55, he = biomeWeight('heart', x, z) * 0.45, dr = biomeWeight('dragon', x, z) * 0.5;
  r += (0.46 + n * 0.1 - r) * du; g += (0.46 + n * 0.08 - g) * du; b += (0.2 + n * 0.04 - b) * du;
  r += (0.24 + n * 0.08 - r) * he; g += (0.46 + n * 0.12 - g) * he; b += (0.15 + n * 0.05 - b) * he;
  r += (0.34 + n * 0.08 - r) * dr; g += (0.36 + n * 0.06 - g) * dr; b += (0.22 + n * 0.04 - b) * dr;
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
  r += (0.27 - r) * f.mud; g += (0.25 - g) * f.mud; b += (0.16 - b) * f.mud;
  r += (0.22 - r) * f.deep; g += (0.32 - g) * f.deep; b += (0.34 - b) * f.deep;
  // the ash lands' lava: thin glowing cracks along a ridged noise, off the roads and towns
  const lava = f.ash * smoothstep(0.965, 0.99, 1 - Math.abs(valueNoise(x / 22 - 7, z / 22 + 3) * 2 - 1)) * (1 - f.dirt) * (1 - f.deep);
  r += (1.0 - r) * lava; g += (0.32 - g) * lava; b += (0.06 - b) * lava;
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
  apply(2, f.ash * 0.75); // the ash region: bare rock
  apply(4, f.snow);
  apply(1, f.road * 0.85); // roads: packed dirt
  apply(5, f.town); // towns are paved
  apply(3, f.sand);
  apply(1, f.mud); // the swamp's banks: wet dirt
  apply(3, f.deep); // silt under the ponds reads as sand
  // steep slopes turn to bare rock (snow stays on top of the peaks; the frost region's cliffs show their stone)
  apply(2, smoothstep(0.07, 0.28, slopeAt(x, z)) * 0.85 * (1 - f.peak) * (1 - f.town));
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
  /** sampler anisotropy for the GLTF colour maps (setting textureAniso) */
  setAniso(n: number): void;
  /** Cinematic preset: render the world mirrored in the water for this frame (before the main render). */
  renderReflection(on: boolean, renderer: THREE.WebGLRenderer, camera: THREE.Camera): void;
  /** free the PMREM targets (the gallery disposes its world when unmounted) */
  dispose(): void;
}

export function createWorldScene(opts: { maxAnisotropy?: number; precompile?: Precompile; renderer?: THREE.WebGLRenderer } = {}): WorldScene {
  const t0 = performance.now();
  const scene = new THREE.Scene();
  // The scene itself never moves. Left on, it re-marks its own matrix every frame and three.js then recomputes the
  // world matrix of every node under it, frozen or not (4.7 ms a frame on the grown map).
  scene.matrixAutoUpdate = false;
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 90, 420);
  /** where follow() last culled the chunks, and with which view distance / foliage setting */
  const lastCull = new THREE.Vector3(Infinity, 0, 0);
  let lastReach = 0, lastDetail = false, grassLeft = false, tilesLeft = false;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 1.6);
  scene.add(hemi);
  // sky dome (follows the camera; scaled to sit just inside the far plane)
  const skyMat = new THREE.ShaderMaterial({ ...SkyShader, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  // IBL: the sky itself lights the world. A twin of the dome (same material, so same uniforms) is baked into a PMREM
  // and set as the scene's environment: every Lambert then picks up the sky's bounce (horizon glow, zone tints, dusk
  // orange) for the cost of one texture lookup. The hemisphere light hands over part of its energy so the total
  // ambient stays where it was tuned. Re-baked lazily: only when the sky has drifted past ENV_EPS since the last bake
  // (a zone crossing, the sun crossing the sky) and at most every ENV_MIN_MS — a bake is a handful of tiny cube
  // renders of the dome alone.
  const ENV_I = 0.45, HEMI_KEEP = 0.7, ENV_MIN_MS = 1500, ENV_EPS = 0.05;
  const pmrem = opts.renderer ? new THREE.PMREMGenerator(opts.renderer) : null;
  const envScene = pmrem ? new THREE.Scene() : null;
  if (envScene) envScene.add(sky.clone());
  let envRT: THREE.WebGLRenderTarget | null = null, lastBake = -1e9;
  const baked = { top: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(), night: 0, dir: new THREE.Vector3(9, 9, 9) };
  /** total channel distance between two colours, the drift unit below */
  const cd = (a: THREE.Color, b: THREE.Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  const skyDrift = () => {
    const u = skyMat.uniforms;
    return cd(baked.top, u.top.value) + cd(baked.horizon, u.horizon.value)
      + cd(baked.ground, u.ground.value) + cd(baked.sun, u.sunColor.value)
      + Math.abs(baked.night - u.night.value) * 0.5 + baked.dir.distanceTo(u.sunDir.value);
  };
  const bakeEnv = () => {
    if (!pmrem || !envScene) return;
    const next = pmrem.fromScene(envScene);
    const old = envRT;
    envRT = next;
    scene.environment = envRT.texture;
    scene.environmentIntensity = ENV_I;
    if (old) old.dispose();
    const u = skyMat.uniforms;
    baked.top.copy(u.top.value); baked.horizon.copy(u.horizon.value); baked.ground.copy(u.ground.value);
    baked.sun.copy(u.sunColor.value); baked.night = u.night.value; baked.dir.copy(u.sunDir.value);
    lastBake = performance.now();
  };
  const clouds = new Clouds();
  scene.add(clouds.mesh);
  const cloudLit = new THREE.Color(), cloudShade = new THREE.Color(), cloudRim = new THREE.Color();
  const pal = { ...SKIES.town };
  const cur = { top: new THREE.Color(pal.top), horizon: new THREE.Color(pal.horizon), ground: new THREE.Color(pal.ground), sun: new THREE.Color(pal.sun), cloud: new THREE.Color(pal.cloud), sunI: pal.sunI, hemi: pal.hemi, near: 0.22 };
  const tgt = { top: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(), cloud: new THREE.Color(), sunI: 0, hemi: 0, near: 0.22 };
  const tmp = new THREE.Color();
  /** Blend the palettes of nearby zones (town as the base) at world position (x,z). */
  const paletteAt = (x: number, z: number) => {
    const base = SKIES.town;
    tgt.top.set(base.top); tgt.horizon.set(base.horizon); tgt.ground.set(base.ground); tgt.sun.set(base.sun); tgt.cloud.set(base.cloud);
    tgt.sunI = base.sunI; tgt.hemi = base.hemi;
    tgt.near = 0.22;
    const blend = (p: SkyPal, w: number) => {
      tgt.top.lerp(tmp.set(p.top), w); tgt.horizon.lerp(tmp.set(p.horizon), w); tgt.ground.lerp(tmp.set(p.ground), w);
      tgt.sun.lerp(tmp.set(p.sun), w); tgt.cloud.lerp(tmp.set(p.cloud), w);
      tgt.sunI += (p.sunI - tgt.sunI) * w; tgt.hemi += (p.hemi - tgt.hemi) * w; tgt.near += ((p.near ?? 0.22) - tgt.near) * w;
    };
    // the midland regions under the zones, the far regions over them
    for (const id of ['dusk', 'heart', 'dragon'] as const) blend(SKIES[id], biomeWeight(id, x, z));
    for (const zn of ZONES) {
      const w = 1 - smoothstep(zn.r * 0.6, zn.r * 1.5, Math.hypot(x - zn.x, z - zn.z));
      if (w <= 0) continue;
      // zones without a palette of their own (volcanic, abyss, tundra...) take their ring region's sky below
      const p = SKIES[zn.id] as SkyPal | undefined;
      if (p) blend(p, w);
    }
    for (const id of ['frost', 'swamp', 'ash'] as const) blend(SKIES[id], biomeWeight(id, x, z));
  };
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  // terrain tiles and their trees/rocks/bushes stream in around the player (streamTiles); the start town's are built now
  const tiles = streamTiles();
  const terrain = tiles.terrain;
  tiles.update(new THREE.Vector3(TOWN.x, 0, TOWN.z), (scene.fog as THREE.Fog).far);
  const terrainTex = new TerrainTextures(terrain, tiles.plain, opts.maxAnisotropy ?? 1, opts.precompile);
  scene.add(terrain, tiles.forest);
  const water = buildWater();
  scene.add(buildSeabed());
  const waterPlain = water.material as THREE.MeshLambertMaterial, waterFancy = waterMaterial();
  const reflection = new WaterReflection(waterFancy.uniforms as ConstructorParameters<typeof WaterReflection>[0], WATER_LEVEL);
  scene.add(water);
  // the volcano's lava churns on the water's clock
  scene.add(buildLava(waterFancy.uniforms.time as { value: number }));
  const grass = natureReady() ? lazyDetail(natureDetailCell, NATURE_DETAIL_DRAWS) : lazyDetail(makeDetailCell(), DETAIL_PER_CELL * 5);
  const detail = grass.group;
  scene.add(detail);
  scene.add(mergeStatic(buildTown()));
  if (natureReady()) scene.add(buildNatureTown());
  scene.add(buildVillage());
  scene.add(mergeStatic(buildZoneProps()));
  const { props: campProps, flames } = buildCamps();
  scene.add(mergeStatic(campProps), flames);
  // Static world: bake every local matrix once so the per-frame scene traversal (render + labels) skips recomposing them.
  for (const o of scene.children) if (o !== sky && o !== clouds.mesh && o !== flames && o !== sun && o !== sun.target && o !== hemi) freeze(o);

  // Sampler anisotropy for the GLTF colour maps (nature, village kit, characters): user setting,
  // capped by the GPU's max. three.js clamps per-texture at upload too; this keeps it explicit.
  const setAniso = (n: number): number => sharpenMaps(scene, n) + setCharAniso(n);
  const aniso = setAniso(Math.min(settings.s.textureAniso, opts.maxAnisotropy ?? settings.s.textureAniso));
  console.info(`[world] built in ${(performance.now() - t0).toFixed(0)} ms`);
  if (aniso > 0) console.debug(`[tex] aniso ${settings.s.textureAniso}x: ${aniso} maps sharpened`);

  return {
    scene, terrain, sun,
    detail,
    sky,
    renderReflection(on, renderer, camera) {
      // only the fancy water shader can show it
      reflection.update(on && water.material === waterFancy, renderer, scene, camera, water);
    },
    dispose() {
      pmrem?.dispose();
      envRT?.dispose();
      scene.environment = null;
    },
    setTextureQuality: (q) => {
      terrainTex.set(q);
      setPropTextures(q, opts.maxAnisotropy ?? 1, opts.precompile);
      // a quality swap re-creates materials: apply the current aniso setting to the new maps too
      setAniso(Math.min(settings.s.textureAniso, opts.maxAnisotropy ?? settings.s.textureAniso));
    },

    setAniso: (n) => {
      const v = Math.min(n, opts.maxAnisotropy ?? n);
      const changed = setAniso(v);
      if (changed) console.debug(`[tex] aniso -> ${v}x (${changed} maps re-sampled)`);
    },
    updateSky(camera: THREE.Camera, far: number, dt: number) {
      terrainTex.update(dt);
      updatePropTextures(dt);
      sky.position.copy(camera.position);
      sky.scale.setScalar(far * 0.92);
      // ease the sky towards the current region's palette
      paletteAt(camera.position.x, camera.position.z);
      const k = Math.min(1, dt * 0.8);
      cur.top.lerp(tgt.top, k); cur.horizon.lerp(tgt.horizon, k); cur.ground.lerp(tgt.ground, k);
      cur.sun.lerp(tgt.sun, k); cur.cloud.lerp(tgt.cloud, k);
      cur.sunI += (tgt.sunI - cur.sunI) * k; cur.hemi += (tgt.hemi - cur.hemi) * k; cur.near += (tgt.near - cur.near) * k;
      // the region's air: the fog starts closer in the swamp and the ash, the far edge stays the view distance
      (scene.fog as THREE.Fog).near = (scene.fog as THREE.Fog).far * cur.near;
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
      hemi.intensity = cur.hemi * (nb + (1 - nb) * day) * (pmrem ? HEMI_KEEP : 1);
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
      // clouds: white tops by day, gold at the ends of the day, slate blue in the moonlight; bellies take the sky's tint
      cloudLit.copy(cur.cloud).lerp(tmp.set(0xffb070), dusk * 0.8).multiplyScalar(0.2 + 0.58 * Math.max(day, dusk * 0.95)).lerp(tmp.set(0x3e4866), (1 - day) * (1 - dusk) * 0.75);
      cloudShade.copy(cloudLit).multiplyScalar(0.5).lerp(A.top, 0.25);
      cloudRim.copy(up ? u.sunColor.value : tmp.set(0x8fa6e8)).multiplyScalar(up ? 1 : 0.35);
      clouds.update(camera.position, A.lightDir, cloudLit, cloudShade, cloudRim, A.horizon, day);
      // the IBL trails the visible sky: first frame bakes (lastBake starts at -inf), then only on real drift
      if (pmrem && performance.now() - lastBake > ENV_MIN_MS && skyDrift() > ENV_EPS) bakeEnv();
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
      // chunk visibility only changes after a few steps (or a new view distance): don't re-check every frame
      const reachNow = (scene.fog as THREE.Fog).far;
      const moved = lastCull.distanceToSquared(p);
      if (moved < 4 && lastReach === reachNow && lastDetail === detail.visible && !grassLeft && !tilesLeft) return;
      lastCull.copy(p);
      lastReach = reachNow;
      lastDetail = detail.visible;
      // grass and flowers only around the player (still building some: come back next frame)
      if (detail.visible) grassLeft = !grass.update(p, moved > 60 * 60);
      // terrain/forest tiles: build what came into range (a few ms a frame), drop what fell far behind
      tilesLeft = !tiles.update(p, reachNow);
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
  // and keep the per-frame matrix pass out of the whole subtree: thousands of nodes walked for nothing otherwise.
  // (three.js r186 still walks the children of a node with matrixWorldAutoUpdate off, so the walk stops here;
  // an explicit updateMatrixWorld(true) still goes all the way down.)
  o.matrixWorldAutoUpdate = false;
  o.updateMatrixWorld = frozenUpdate;
}
function frozenUpdate(this: THREE.Object3D, force?: boolean) {
  if (force) THREE.Object3D.prototype.updateMatrixWorld.call(this, true);
}

/**
 * Set anisotropy on every colour map under `o` to exactly `n` (raising or lowering; the setting is
 * user-configurable). GLTF albedo maps ship at 1 and smear into mud at grazing angles (the town
 * paving, distant walls); the terrain array texture already gets the max. Materials are shared, so
 * this touches a handful of textures. Measured on this repo's dev machine (bench, 48 mobs): 8x
 * halves the frame rate on its GPU, 4x holds — hence the default.
 */
function sharpenMaps(o: THREE.Object3D, n: number): number {
  let changed = 0;
  o.traverse((x) => {
    const mat = (x as THREE.Mesh).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const map = (m as THREE.MeshLambertMaterial).map;
      if (map && map.anisotropy !== n) {
        map.anisotropy = n;
        map.needsUpdate = true; // sampler state is read on upload
        changed++;
      }
    }
  });
  return changed;
}

// The world is split into square chunks so the camera frustum (and the far plane,
// i.e. the view distance) can skip everything that isn't on screen. One big mesh or
// InstancedMesh would always be drawn whole.
const CHUNK = 200;
/** streamed terrain/forest tile size: the same grid as the merged chunks */
const TILE = CHUNK;
/** the sea floor outside the land tiles: one big plane under the water */
const SEABED = WATER_LEVEL - 8;
const chunkKey = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

/** Terrain vertex spacing index for a tile whose centre is `d` m away: 4 m near, coarser far (skirts hide the seams). */
export function tileLod(d: number): number {
  return d < 350 ? 0 : d < 700 ? 1 : 2;
}
const LOD_STEP = [4, 8, 20]; // m between vertices; each divides TILE

/** Tiles (cx, cz, centre distance) whose centre lies within `r` of (x, z), nearest first. */
export function tilesWithin(x: number, z: number, r: number): { cx: number; cz: number; d: number }[] {
  const out: { cx: number; cz: number; d: number }[] = [];
  const n = Math.ceil(r / TILE) + 1, ix = Math.floor(x / TILE), iz = Math.floor(z / TILE);
  for (let cx = ix - n; cx <= ix + n; cx++)
    for (let cz = iz - n; cz <= iz + n; cz++) {
      const d = Math.hypot((cx + 0.5) * TILE - x, (cz + 0.5) * TILE - z);
      if (d < r) out.push({ cx, cz, d });
    }
  return out.sort((a, b) => a.d - b.d);
}

/**
 * Terrain tiles with distance LOD plus each tile's trees/rocks/bushes, built around the player and let go when far.
 * update() builds the tiles under the player at once (spawn, teleport) and the rest within a few ms a frame,
 * nearest first. False while some are left to build.
 */
function streamTiles() {
  const terrain = new THREE.Group(), forest = new THREE.Group();
  terrain.name = 'terrain';
  const plain = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  plain.onBeforeCompile = cloudShadow;
  const live = new Map<string, { lod: number; ground: THREE.Mesh | null; trees: THREE.Object3D[] | null }>();
  let buckets: Map<string, TileIdx> | null = null;
  const BUDGET_MS = 4;
  const update = (p: THREE.Vector3, fog: number): boolean => {
    const reach = fog + 150; // fog end + about a tile's half-diagonal: nothing visible pops
    buckets ??= bucketLayout();
    const t0 = performance.now();
    let done = true;
    const want = new Set<string>();
    for (const { cx, cz, d } of tilesWithin(p.x, p.z, reach + TILE)) {
      const k = `${cx},${cz}`, lod = tileLod(d);
      want.add(k);
      let t = live.get(k);
      if (!t) live.set(k, (t = { lod: -1, ground: null, trees: null }));
      const needTrees = !t.trees && d < reach;
      if (t.lod !== lod || needTrees) {
        const urgent = d < TILE * 1.2 && (t.lod < 0 || needTrees);
        if (!urgent && performance.now() - t0 > BUDGET_MS) {
          done = false;
          continue;
        }
        if (t.lod !== lod) {
          const g = buildTile(cx, cz, LOD_STEP[lod]);
          if (t.ground) terrain.remove(t.ground), t.ground.geometry.dispose();
          // new tiles take whatever material the texture setting put on the others (render/terrainTex.ts)
          if (g) (g.material = (terrain.children[0] as THREE.Mesh | undefined)?.material ?? plain), terrain.add(g);
          t.ground = g;
          t.lod = lod;
        }
        if (needTrees) {
          const idx = buckets.get(k) ?? { trees: [], rocks: [], bushes: [] };
          t.trees = natureReady() ? natureTile(idx) : fallbackTile(idx);
          // the group is frozen (no per-frame matrix pass): the meshes sit at the origin, so their matrices already are right
          for (const m of t.trees) (m.matrixAutoUpdate = false), forest.add(m);
        }
      }
      // fog hides everything past its far end
      if (t.trees) for (const m of t.trees) m.visible = d < reach;
    }
    // ponytail: drops a tile as soon as it leaves the wanted ring (one tile of hysteresis past reach); upgrade path: a small LRU if pacing back and forth rebuilds too often
    for (const [k, t] of live) {
      if (want.has(k)) continue;
      if (t.ground) terrain.remove(t.ground), t.ground.geometry.dispose();
      if (t.trees) {
        dropNodeInstances(t.trees);
        for (const m of t.trees) forest.remove(m), (m as THREE.InstancedMesh).dispose(); // instance buffers; geometry/material are shared
      }
      live.delete(k);
    }
    return done;
  };
  return { terrain, forest, plain, update };
}

interface TileIdx { trees: number[]; rocks: number[]; bushes: number[] }
/** Which layout trees/rocks/bushes sit in each tile (indices, so node ids keep layout order). */
function bucketLayout(): Map<string, TileIdx> {
  const m = new Map<string, TileIdx>();
  const add = (list: { x: number; z: number }[], key: keyof TileIdx) => list.forEach((o, i) => {
    const k = chunkKey(o.x, o.z);
    let b = m.get(k);
    if (!b) m.set(k, (b = { trees: [], rocks: [], bushes: [] }));
    b[key].push(i);
  });
  add(layoutTrees(), 'trees');
  add(layoutRocks(), 'rocks');
  add(layoutBushes(), 'bushes');
  return m;
}

/** One terrain tile at vertex spacing `step`, with a skirt hanging from its rim; null over open sea (the seabed plane covers it). */
function buildTile(cx: number, cz: number, step: number): THREE.Mesh | null {
  const x0 = cx * TILE, z0 = cz * TILE;
  if (Math.max(Math.abs(x0 + TILE / 2), Math.abs(z0 + TILE / 2)) > WORLD_HALF + TILE) return null;
  let top = -Infinity;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) top = Math.max(top, heightAt(x0 + (i * TILE) / 4, z0 + (j * TILE) / 4));
  // ponytail: a 5x5 probe can miss an islet narrower than 50 m; upgrade path: probe landAt() on a finer grid
  if (top < SEABED - 1) return null;
  const seg = TILE / step;
  const c = new THREE.Color();
  const geo = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + TILE / 2, 0, z0 + TILE / 2);
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
    if (steep <= 0) continue;
    const o = i * 3;
    // the volcanic region's slopes are dark basalt, not grey stone
    const k = 1 - 0.6 * biomeWeight('ash', pos.getX(i), pos.getZ(i));
    colors[o] += (0.36 * k - colors[o]) * steep * 0.8;
    colors[o + 1] += (0.33 * k - colors[o + 1]) * steep * 0.8;
    colors[o + 2] += (0.3 * k - colors[o + 2]) * steep * 0.8;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  addSkirt(geo, seg, step * 1.5 + 3);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Copy the rim of a (seg+1)² grid `depth` m down and wall it in: hides the gaps where LODs meet. */
function addSkirt(geo: THREE.BufferGeometry, seg: number, depth: number) {
  const w = seg + 1, rim: number[] = [];
  for (let i = 0; i < seg; i++) rim.push(i); // top row
  for (let j = 0; j < seg; j++) rim.push(j * w + seg); // right column
  for (let i = seg; i > 0; i--) rim.push(seg * w + i); // bottom row
  for (let j = seg; j > 0; j--) rim.push(j * w); // left column
  rim.push(0);
  const n = geo.attributes.position.count;
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name] as THREE.BufferAttribute, k = a.itemSize;
    const arr = new Float32Array((n + rim.length) * k);
    arr.set(a.array as Float32Array);
    rim.forEach((v, r) => {
      for (let c = 0; c < k; c++) arr[(n + r) * k + c] = a.array[v * k + c];
      if (name === 'position') arr[(n + r) * 3 + 1] -= depth;
    });
    geo.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  const idx = Array.from(geo.index!.array as ArrayLike<number>);
  // ponytail: both windings, so the wall shows from either side without working out which way the rim runs
  for (let r = 0; r + 1 < rim.length; r++) {
    const a = rim[r], b = rim[r + 1], a2 = n + r, b2 = n + r + 1;
    idx.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
  }
  geo.setIndex(idx);
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

/** Procedural trees/rocks/bushes for one streamed tile, when the nature models did not load. */
function fallbackTile(idx: TileIdx): THREE.Object3D[] {
  return [buildTrees(idx.trees), buildRocks(idx.rocks), buildBushes(idx.bushes)].flatMap((g) => [...g.children.flatMap((c) => (c instanceof THREE.Group ? [...c.children] : [c]))]);
}
/** shared geometry/materials of the procedural fallback, made once */
const once = <T,>(f: () => T) => { let v: T | undefined; return () => (v ??= f()); };
const treeRes = once(() => {
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
  const mat = () => new THREE.MeshLambertMaterial({ flatShading: true });
  const canopy = (amp: number) => instancedSurface(sway(mat(), amp), 'leaves');
  return { trunkGeo, pineGeo, leafGeo, deadGeo, bark: instancedSurface(mat(), 'bark'), pine: canopy(0.007), leaf: canopy(0.009) };
});
function buildTrees(idx: number[]): THREE.Group {
  const { trunkGeo, pineGeo, leafGeo, deadGeo, bark, pine, leaf } = treeRes();
  const trunks: Inst[] = [], pines: Inst[] = [], leaves: Inst[] = [], deads: Inst[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const all = layoutTrees();
  for (const t of idx.map((i) => all[i])) {
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
  const g = new THREE.Group();
  g.add(chunkedInstances(trunkGeo, bark, trunks), chunkedInstances(pineGeo, pine, pines), chunkedInstances(leafGeo, leaf, leaves));
  if (deads.length) g.add(chunkedInstances(deadGeo, bark, deads));
  return g;
}

const rockRes = once(() => ({ geo: new THREE.DodecahedronGeometry(1, 0), mat: instancedSurface(new THREE.MeshLambertMaterial({ flatShading: true }), 'rock') }));
function buildRocks(idx: number[]): THREE.Group {
  const items: Inst[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const all = layoutRocks();
  for (const r of idx.map((i) => all[i])) {
    p.set(r.x, r.y, r.z);
    q.setFromEuler(e.set(...r.e));
    s.set(...r.s);
    items.push({ m: new THREE.Matrix4().compose(p, q, s), x: r.x, z: r.z, c: new THREE.Color().setHSL(0.08, 0.06, 0.38 + r.light * 0.15) });
  }
  return chunkedInstances(rockRes().geo, rockRes().mat, items);
}

/** The volcano's crater: a disc of slow-churning lava on its flat floor (its glow is a fire in lightSources). */
const LAVA_Y = () => heightAt(VOLCANO.x, VOLCANO.z) + 0.4;
function buildLava(time: { value: number }): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { time },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vP = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec2 vP;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vP * 0.35;
        // two crusts drifting over the melt: dark where they cool, bright in the cracks
        float c = noise(p + vec2(time * 0.15, time * 0.08)) * 0.6 + noise(p * 2.3 - vec2(time * 0.11, -time * 0.17)) * 0.4;
        vec3 col = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.5, 0.06), smoothstep(0.35, 0.8, c));
        col += vec3(1.0, 0.85, 0.4) * smoothstep(0.82, 0.95, c) * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(VOLCANO.crater * 0.55 + 1, 40).rotateX(-Math.PI / 2), mat);
  m.position.set(VOLCANO.x, LAVA_Y(), VOLCANO.z);
  return m;
}

function buildWater(): THREE.Mesh {
  // one plane for the whole sea, reaching well past the coast so the horizon is water
  const geo = new THREE.PlaneGeometry(WORLD_HALF * 4, WORLD_HALF * 4, 1, 1).rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x3a7ab0, transparent: true, opacity: 0.72, depthWrite: false }));
  water.position.y = WATER_LEVEL;
  water.renderOrder = 2;
  return water;
}

function buildSeabed(): THREE.Mesh {
  const [r, g, b] = groundColor(0, 0, SEABED);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF * 4, WORLD_HALF * 4, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace) }));
  m.position.y = SEABED;
  m.receiveShadow = true;
  return m;
}

/** Can decorative foliage grow here? (not on roads, town, water, rock or snow) */
function fertile(x: number, z: number, h: number): boolean {
  return h > WATER_LEVEL + 1.2 && h < 22 && !inTown(x, z) && roadDist(x, z) > 3.2 && !nearCamp(x, z, 16);
}

const bushRes = once(() => ({
  geo: mergeGeometries([
    new THREE.IcosahedronGeometry(0.6, 0).translate(0, 0.45, 0),
    new THREE.IcosahedronGeometry(0.45, 0).translate(0.45, 0.35, 0.1),
    new THREE.IcosahedronGeometry(0.42, 0).translate(-0.4, 0.32, -0.15),
  ])!,
  mat: instancedSurface(new THREE.MeshLambertMaterial({ flatShading: true }), 'leaves'),
}));
function buildBushes(idx: number[]): THREE.Group {
  const rng = mulberry32(21 + (idx[0] ?? 0)); // ponytail: per-tile colour seed, so a tile looks the same each time it streams in
  const { geo, mat } = bushRes();
  const items: Inst[] = [];
  const q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const all = layoutBushes();
  for (const b of idx.map((i) => all[i])) {
    items.push({ m: new THREE.Matrix4().compose(p.set(b.x, b.h - 0.1, b.z), q.setFromAxisAngle(up, b.rot), sv.set(b.sc, b.sc * (0.8 + b.u * 0.4), b.sc)),
      x: b.x, z: b.z, c: new THREE.Color().setHSL(0.24 + rng() * 0.08, 0.45, 0.24 + rng() * 0.1) });
  }
  return chunkedInstances(geo, mat, items);
}

const DETAIL_CHUNK = 40;
/** Grass tufts and flowers without the nature models: a builder for one cell (shared/src/layout.ts detailCells). */
function makeDetailCell(): (x0: number, z0: number, seed: number) => THREE.Object3D[] {
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
  return (x0, z0, seed) => {
      const rng = mulberry32(seed), out: THREE.Object3D[] = [];
      const grass: [THREE.Matrix4, THREE.Color][] = [], flowers: [THREE.Matrix4, THREE.Color][] = [];
      for (let i = 0; i < DETAIL_PER_CELL; i++) {
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
        out.push(im);
      }
      return out;
  };
}
const DETAIL_PER_CELL = 520;

/**
 * Grass and flowers are only drawn within 95 m of the player, so only those cells are built: all of them over the
 * grown map were 34 MB and 6,000 meshes for the two dozen ever on screen. Walking builds a few new cells a frame
 * (all at once after a jump: spawning, teleports) and lets go of the ones left 200 m behind; a cell comes back
 * exactly as it was (detailCells gives each its seed).
 */
function lazyDetail(build: (x0: number, z0: number, seed: number) => THREE.Object3D[], draws: number) {
  const SHOW = 95, KEEP = 200, PER_CALL = 2;
  const group = new THREE.Group();
  const cells = detailCells(DETAIL_CHUNK, draws), built = new Map<number, THREE.Object3D[]>();
  /** Show the cells around `p`, building the missing ones (`all`: no limit per call). False while some are left to build. */
  const update = (p: THREE.Vector3, all: boolean): boolean => {
    let left = all ? Infinity : PER_CALL, done = true;
    cells.forEach((c, i) => {
      const dx = Math.abs(c.x0 + DETAIL_CHUNK / 2 - p.x), dz = Math.abs(c.z0 + DETAIL_CHUNK / 2 - p.z), near = dx < SHOW && dz < SHOW;
      let meshes = built.get(i);
      if (near && !meshes) {
        if (left-- <= 0) return void (done = false);
        built.set(i, (meshes = build(c.x0, c.z0, c.seed)));
        // the group is frozen (no per-frame matrix pass): the meshes sit at the origin, so their matrices already are right
        for (const m of meshes) (m.matrixAutoUpdate = false), group.add(m);
      }
      if (!meshes) return;
      if (Math.max(dx, dz) > KEEP) {
        for (const m of meshes) group.remove(m), (m as THREE.InstancedMesh).dispose(); // frees the instance buffers; geometry and material are shared
        built.delete(i);
      } else for (const m of meshes) m.visible = near;
    });
    return done;
  };
  return { group, update };
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
    if (kit) continue; // the kit instances (render/village.ts) replace the boxes in both towns
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
  // Both rings are the kit stone curtain (render/village.ts). Without the kit: one box per wall, gate jamb and tower.
  if (!kit) for (const w of L.walls) {
    const wy = heightAt(w.x, w.z);
    const h = w.tower ? 11 : 4;
    const seg = box((w.hw ?? 1) * 2, h, (w.hd ?? 0.15) * 2, w.tower ? 0x9a9488 : 0x8a8478, w.x, wy + h / 2, w.z);
    seg.rotation.y = w.rot;
    g.add(seg);
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
  // every fort: a big iron brazier on a stone plinth (its flames are particles, game.ts; its light, lightSources)
  for (const f of FORTS) g.add(brazier(f.town.x, y, f.town.z));
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
  if (!vReady()) for (const { a } of plazaBenches()) {
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
    if (!natureReady()) for (let k = 0; k < 6; k++) {
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
  if (!natureReady()) for (let i = 0; i < 70; i++) {
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
/** Where each fort's brazier burns: flames, embers and smoke are emitted here (game.ts), and it lights the plaza. */
export const BRAZIER_FIRES = FORTS.map((f) => ({ x: f.town.x, y: TOWN_HEIGHT + 2.05, z: f.town.z }));

/** A wide iron bowl on a stepped stone plinth, glowing coals inside. */
function brazier(x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0x55525a), dark = mat(0x3e3c42), iron = mat(0x2a2a30);
  const step = (r: number, h: number, at: number, m: THREE.Material) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 8), m);
    c.position.y = at + h / 2;
    c.castShadow = c.receiveShadow = true;
    g.add(c);
  };
  step(1.55, 0.25, 0, dark);
  step(1.2, 0.3, 0.25, stone);
  step(0.42, 0.75, 0.55, stone); // the column
  // the bowl: a lathe profile flaring out to a lip
  const bowl = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.35, 0), new THREE.Vector2(0.9, 0.2), new THREE.Vector2(1.15, 0.55), new THREE.Vector2(1.22, 0.62), new THREE.Vector2(1.1, 0.62), new THREE.Vector2(0.85, 0.3), new THREE.Vector2(0, 0.3),
  ], 12), iron);
  bowl.position.y = 1.3;
  bowl.castShadow = true;
  g.add(bowl);
  for (let i = 0; i < 4; i++) {
    // iron legs from the plinth to the rim
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), iron);
    leg.position.set(Math.cos(a) * 0.8, 1.15, Math.sin(a) * 0.8);
    leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    g.add(leg);
  }
  const coals = new THREE.Mesh(new THREE.CircleGeometry(0.95, 12), new THREE.MeshLambertMaterial({ color: 0x8a2a10, emissive: 0xc8400c, emissiveIntensity: 0.55 }));
  coals.rotation.x = -Math.PI / 2;
  coals.position.y = 1.72;
  g.add(coals);
  g.position.set(x, y, z);
  return g;
}

export function lightSources(): LightSource[] {
  const out: LightSource[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    out.push({ x: TOWN.x + Math.cos(a) * 17.4, y: TOWN_HEIGHT + 2.8, z: TOWN.z + Math.sin(a) * 17.4, fire: false });
  }
  for (const c of layoutCamps()) out.push({ x: c.fire.x, y: heightAt(c.fire.x, c.fire.z) + 1, z: c.fire.z, fire: true });
  for (const b of BRAZIER_FIRES) out.push({ ...b, y: b.y + 0.8, fire: true });
  out.push({ x: VOLCANO.x, y: LAVA_Y() + 4, z: VOLCANO.z, fire: true }); // the lava lights its crater
  for (const l of fortLanterns()) out.push({ x: l.x, y: TOWN_HEIGHT + l.y, z: l.z, fire: false });
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
