// Surface textures for everything that isn't terrain: buildings and props (phase 3 of
// docs/plan-texturas-mundo.md), rocks, trees and the ripples on the water (phase 4).
// Static props are merged into world-space geometry without UVs (mergeStatic in scene.ts) and the
// vegetation is instanced, so the texture is projected from world position: triplanar in high quality,
// the dominant axis only in low. Like the terrain, the texture only modulates brightness: every
// material keeps its colour (or its per-instance colour).
// Every surfaced material carries the shader from the start, compiled out (no PROP_TEX define) until
// a texture set is ready; switching quality only flips defines, after compiling the new variants.
import * as THREE from 'three';
import { bumpNormal, getTextureSet, PROP_LAYERS, relief, TERRAIN_LAYERS, type TextureQuality } from './textures';

export type Surface = 'wood' | 'stone' | 'roof' | 'plaster' | 'bark' | 'leaves' | 'rock';
export type PropTexQuality = 'off' | TextureQuality;

interface SurfaceDef {
  /** which texture array the layer lives in (rock reuses the terrain's) */
  array: 'props' | 'terrain';
  layer: number;
  /** world units per repeat */
  tile: number;
  /** strength of the brightness pattern (1 = as painted) */
  contrast: number;
  /** wood grain / bark furrows run up the side faces */
  vertical?: boolean;
  /** roof tiles: project from the sides only so the rows stay horizontal on the slopes */
  sides?: boolean;
  /** only in high quality */
  hqOnly?: boolean;
}

const P = (l: (typeof PROP_LAYERS)[number]) => PROP_LAYERS.indexOf(l);
const SURFACES: Record<Surface, SurfaceDef> = {
  wood: { array: 'props', layer: P('wood'), tile: 2.4, contrast: 1.2, vertical: true },
  stone: { array: 'props', layer: P('stone'), tile: 3, contrast: 1.2 },
  roof: { array: 'props', layer: P('roof'), tile: 3, contrast: 1.2, sides: true },
  plaster: { array: 'props', layer: P('plaster'), tile: 4, contrast: 1.2 },
  bark: { array: 'props', layer: P('bark'), tile: 1.6, contrast: 1.2, vertical: true },
  leaves: { array: 'props', layer: P('leaves'), tile: 2.2, contrast: 0.8, hqOnly: true },
  // boulders are small: a tighter repeat than the cliffs (9 u) so strata and cracks fit on them
  rock: { array: 'terrain', layer: TERRAIN_LAYERS.indexOf('rock'), tile: 1.8, contrast: 1.5 },
};

const shared = {
  uPropTex: { value: null as THREE.DataArrayTexture | null },
  uPropTerrainTex: { value: null as THREE.DataArrayTexture | null },
  uPropStrength: { value: 0 },
  uRelief: relief,
  uPropMean: { value: PROP_LAYERS.map(() => 0.45) },
  uPropTerrainMean: { value: TERRAIN_LAYERS.map(() => 0.45) },
};

/** Water ripples (atmos.ts waterMaterial): the props array's 'ripple' layer, on once textures are. */
export const waterRipple = {
  uRippleTex: { value: null as THREE.DataArrayTexture | null },
  uRippleLayer: { value: P('ripple') },
  uRippleOn: { value: 0 },
};

// World position and normal, after instancing and any vertex animation (wind sway), so the pattern
// stays glued to the surface. propRot = (cos, sin) of a merged piece's yaw (mergeStatic): position and
// normal are turned back into the piece's own frame so the pattern follows its walls. Instanced and
// unmerged meshes read (0, 0): no turn.
const VERT_DECL = /* glsl */ `
#ifdef PROP_TEX
attribute vec2 propRot;
varying vec3 vPropWorld;
varying vec3 vPropNormal;
#endif
`;
const VERT_MAIN = /* glsl */ `
#ifdef PROP_TEX
{
  vec4 lp = vec4(transformed, 1.0);
  vec3 ln = objectNormal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
#endif
  vec3 wp = (modelMatrix * lp).xyz;
  vec3 wn = normalize(mat3(modelMatrix) * ln);
  vec2 cs = dot(propRot, propRot) > 0.5 ? propRot : vec2(1.0, 0.0);
  mat2 back = mat2(cs.x, cs.y, -cs.y, cs.x); // inverse yaw
  vPropWorld = vec3(back * wp.xz, wp.y).xzy;
  vPropNormal = vec3(back * wn.xz, wn.y).xzy;
}
#endif
`;

const FRAG_DECL = /* glsl */ `
#ifdef PROP_TEX
#ifdef PROP_ARRAY_TERRAIN
uniform highp sampler2DArray uPropTerrainTex;
uniform float uPropTerrainMean[${TERRAIN_LAYERS.length}];
#define PROP_SAMPLER uPropTerrainTex
#define PROP_MEAN uPropTerrainMean
#else
uniform highp sampler2DArray uPropTex;
uniform float uPropMean[${PROP_LAYERS.length}];
#define PROP_SAMPLER uPropTex
#define PROP_MEAN uPropMean
#endif
uniform float uPropStrength;
uniform float uRelief;
varying vec3 vPropWorld;
varying vec3 vPropNormal;

vec4 propPlane(vec2 uv) { return texture(PROP_SAMPLER, vec3(uv * PROP_SCALE, PROP_LAYER)); }
#endif
`;

// Planes: X-facing sides use (z, y), Z-facing sides (x, y), floors and tops (x, z).
// PROP_VERTICAL_GRAIN swaps the side planes so wood grain runs up posts, doors, staves and trunks.
// PROP_SIDES_ONLY (roof tiles) ignores the top plane so the tile rows stay horizontal on the slopes.
const FRAG_MAIN = /* glsl */ `
#ifdef PROP_TEX
float propBump = 0.0;
{
  vec3 n = normalize(vPropNormal), p = vPropWorld, a = abs(n);
#ifdef PROP_VERTICAL_GRAIN
  vec2 ux = p.yz, uz = p.yx;
#else
  vec2 ux = p.zy, uz = p.xy;
#endif
  vec2 uy = p.xz;
#ifdef PROP_SIDES_ONLY
  a.y = (a.x + a.z) < 0.15 ? 1.0 : 0.0; // only flat tops fall back to the top plane
#endif
#ifdef PROP_TEX_HQ
  vec3 w = pow(a, vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec4 t = propPlane(ux) * w.x + propPlane(uy) * w.y + propPlane(uz) * w.z;
#else
  vec4 t = a.x >= a.y && a.x >= a.z ? propPlane(ux) : a.z >= a.y ? propPlane(uz) : propPlane(uy);
#endif
  float lum = 1.0 + (t.r / PROP_MEAN[int(PROP_LAYER)] - 1.0) * PROP_CONTRAST;
  vec3 detail = lum * (vec3(1.0) + (t.b - 0.5) * vec3(0.08, 0.05, -0.05));
  float k = uPropStrength * (1.0 - smoothstep(70.0, 180.0, length(vViewPosition)));
  diffuseColor.rgb *= mix(vec3(1.0), detail, k);
  propBump = t.g * k * (0.01 / PROP_SCALE); // relief depth in world units, ~1% of the tile
}
#endif
`;

// Relief only in high quality: the low path picks one plane per fragment, and the jump between
// planes would show up as a hard line in the derivatives.
const FRAG_BUMP = /* glsl */ `
#ifdef PROP_TEX_HQ
${bumpNormal('propBump')}
#endif
`;

const surfaced = new Set<THREE.MeshLambertMaterial>();
let quality: PropTexQuality = 'off';
let wanted: PropTexQuality = 'off';

/**
 * Give a Lambert material a surface texture (applied once textures are on). Chains onto any
 * onBeforeCompile the material already has (e.g. the wind sway on tree canopies).
 */
export function addSurface(m: THREE.MeshLambertMaterial, surface: Surface): THREE.MeshLambertMaterial {
  const prev = m.onBeforeCompile;
  // the injected code must not collapse two different materials (with / without sway) into one program
  const prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <project_vertex>', `${VERT_MAIN}\n#include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_BUMP}`);
  };
  // the defines tell the quality variants apart; this marks the injected code (plus whatever came before)
  m.customProgramCacheKey = () => `${prevKey}|prop-tex`;
  m.userData.surface = surface;
  m.defines = definesFor(m, quality);
  surfaced.add(m);
  return m;
}

function definesFor(m: THREE.Material, q: PropTexQuality): Record<string, string> {
  const s = SURFACES[m.userData.surface as Surface];
  const d: Record<string, string> = {};
  if (q === 'off' || (s.hqOnly && q !== 'high')) return d;
  d.PROP_TEX = '';
  d.PROP_LAYER = `${s.layer}.0`;
  d.PROP_SCALE = (1 / s.tile).toFixed(4);
  d.PROP_CONTRAST = s.contrast.toFixed(2);
  if (s.array === 'terrain') d.PROP_ARRAY_TERRAIN = '';
  if (s.vertical) d.PROP_VERTICAL_GRAIN = '';
  if (s.sides) d.PROP_SIDES_ONLY = '';
  if (q === 'high') d.PROP_TEX_HQ = '';
  return d;
}

/** Compiles shader programs off the critical path (renderer.compileAsync in the world's lighting). */
export type Precompile = (o: THREE.Object3D) => Promise<unknown>;

/**
 * Warm the program cache for quality `q`: one stand-in mesh per distinct shader variant (colour is a
 * uniform, so a handful of variants covers every surfaced material). Swapping defines afterwards
 * then finds the programs ready instead of stalling the frame on a compile. Instanced materials get
 * an instanced stand-in, since instancing is part of the program.
 */
async function warm(q: PropTexQuality, precompile?: Precompile): Promise<() => void> {
  if (!precompile) return () => {};
  const g = new THREE.Group(), seen = new Set<string>(), geo = new THREE.BoxGeometry();
  for (const m of surfaced) {
    const defines = definesFor(m, q), instanced = !!m.userData.instanced;
    const key = `${m.customProgramCacheKey()}|${instanced}|${JSON.stringify(defines)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = m.clone();
    c.onBeforeCompile = m.onBeforeCompile;
    c.customProgramCacheKey = m.customProgramCacheKey;
    c.defines = defines;
    const mesh = instanced ? new THREE.InstancedMesh(geo, c, 1) : new THREE.Mesh(geo, c);
    if (instanced) (mesh as THREE.InstancedMesh).setColorAt(0, new THREE.Color());
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  try {
    await precompile(g);
  } catch {
    /* compiling on first use instead is fine */
  }
  // three.js deletes a program as soon as no material uses it, so the stand-ins must outlive the swap
  return () => {
    geo.dispose();
    for (const ch of g.children) ((ch as THREE.Mesh).material as THREE.Material).dispose();
  };
}

/** Run `fn` once the next few frames have rendered (the swapped materials hold their programs by then). */
const afterFrames = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(fn)));

/** Switch every surfaced material to a quality; textures load (or come from cache) and compile first. */
export function setPropTextures(q: PropTexQuality, maxAnisotropy: number, precompile?: Precompile) {
  wanted = q;
  const apply = () => {
    if (wanted !== q) return;
    quality = q;
    for (const m of surfaced) {
      m.defines = definesFor(m, q);
      m.needsUpdate = true;
    }
    waterRipple.uRippleOn.value = q === 'off' ? 0 : 1;
  };
  if (q === 'off') {
    void warm(q, precompile).then((release) => {
      apply();
      afterFrames(release);
    });
    return;
  }
  void getTextureSet(q, maxAnisotropy).then(async (set) => {
    if (wanted !== q) return;
    const release = await warm(q, precompile);
    if (wanted === q) {
      const fresh = shared.uPropTex.value !== set.props;
      shared.uPropTex.value = set.props;
      shared.uPropTerrainTex.value = set.terrain;
      shared.uPropMean.value = set.propMeans.map((v) => Math.max(0.05, v));
      shared.uPropTerrainMean.value = set.terrainMeans.map((v) => Math.max(0.05, v));
      waterRipple.uRippleTex.value = set.props;
      if (fresh) shared.uPropStrength.value = 0;
      apply();
    }
    afterFrames(release);
  });
}

/** Per frame: ease textures in after they first show up. */
export function updatePropTextures(dt: number) {
  if (quality !== 'off' && shared.uPropStrength.value < 1) shared.uPropStrength.value = Math.min(1, shared.uPropStrength.value + dt * 1.5);
}
