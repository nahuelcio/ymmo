// Building & prop textures (phase 3 of docs/plan-texturas-mundo.md).
// Static props are merged into world-space geometry without UVs (mergeStatic in scene.ts), so the
// texture is projected from world position: triplanar in high quality, the dominant axis only in low.
// Like the terrain, the texture only modulates brightness: every material keeps its colour.
// Every surfaced material carries the shader from the start, compiled out (no PROP_TEX define) until
// a texture set is ready; switching quality only flips defines.
import * as THREE from 'three';
import { getTextureSet, PROP_LAYERS, type PropLayer, type TextureQuality } from './textures';

export type Surface = PropLayer;
export type PropTexQuality = 'off' | TextureQuality;

/** World units covered by one repeat of each surface. */
const TILE: Record<Surface, number> = { wood: 2.4, stone: 3, roof: 3, plaster: 4 };

const shared = {
  uPropTex: { value: null as THREE.DataArrayTexture | null },
  uPropStrength: { value: 0 },
  uPropMean: { value: PROP_LAYERS.map(() => 0.45) },
};

// propRot = (cos, sin) of the piece's yaw, baked by mergeStatic; position and normal are turned back
// into the piece's own frame so the pattern follows its walls. Unmerged meshes read (0, 0): no turn.
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
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vec2 cs = dot(propRot, propRot) > 0.5 ? propRot : vec2(1.0, 0.0);
  mat2 back = mat2(cs.x, cs.y, -cs.y, cs.x); // inverse yaw
  vPropWorld = vec3(back * wp.xz, wp.y).xzy;
  vPropNormal = vec3(back * wn.xz, wn.y).xzy;
}
#endif
`;

const FRAG_DECL = /* glsl */ `
#ifdef PROP_TEX
uniform highp sampler2DArray uPropTex;
uniform float uPropStrength;
uniform float uPropMean[4];
varying vec3 vPropWorld;
varying vec3 vPropNormal;

vec4 propPlane(vec2 uv) { return texture(uPropTex, vec3(uv * PROP_SCALE, PROP_LAYER)); }
#endif
`;

// Planes: X-facing walls use (z, y), Z-facing walls (x, y), floors and tops (x, z).
// PROP_VERTICAL_GRAIN swaps the side planes so wood grain runs up posts, doors and barrel staves.
// PROP_SIDES_ONLY (roof tiles) ignores the top plane so the tile rows stay horizontal on the slopes.
const FRAG_MAIN = /* glsl */ `
#ifdef PROP_TEX
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
  float lum = 1.0 + (t.r / uPropMean[int(PROP_LAYER)] - 1.0) * 1.2;
  vec3 detail = lum * (vec3(1.0) + (t.b - 0.5) * vec3(0.08, 0.05, -0.05));
  float k = uPropStrength * (1.0 - smoothstep(70.0, 180.0, length(vViewPosition)));
  diffuseColor.rgb *= mix(vec3(1.0), detail, k);
}
#endif
`;

const surfaced = new Set<THREE.MeshLambertMaterial>();
let quality: PropTexQuality = 'off';
let wanted: PropTexQuality = 'off';

/** Give a Lambert material a surface texture (applied once textures are on). */
export function addSurface(m: THREE.MeshLambertMaterial, surface: Surface): THREE.MeshLambertMaterial {
  const layer = PROP_LAYERS.indexOf(surface);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`);
  };
  m.userData.surface = { layer, scale: (1 / TILE[surface]).toFixed(4), vertical: surface === 'wood', sides: surface === 'roof' };
  // the defines tell the variants apart; this only marks the program as carrying the injected code
  m.customProgramCacheKey = () => 'prop-tex';
  m.defines = definesFor(m, quality);
  surfaced.add(m);
  return m;
}

function definesFor(m: THREE.Material, q: PropTexQuality): Record<string, string> {
  const s = m.userData.surface as { layer: number; scale: string; vertical: boolean; sides: boolean };
  const d: Record<string, string> = {};
  if (q !== 'off') {
    d.PROP_TEX = '';
    d.PROP_LAYER = `${s.layer}.0`;
    d.PROP_SCALE = s.scale;
    if (s.vertical) d.PROP_VERTICAL_GRAIN = '';
    if (s.sides) d.PROP_SIDES_ONLY = '';
    if (q === 'high') d.PROP_TEX_HQ = '';
  }
  return d;
}

/** Compiles shader programs off the critical path (renderer.compileAsync in the world's lighting). */
export type Precompile = (o: THREE.Object3D) => Promise<unknown>;

/**
 * Warm the program cache for quality `q`: one stand-in mesh per distinct shader variant (colour is a
 * uniform, so a handful of variants covers every surfaced material). Swapping defines afterwards
 * then finds the programs ready instead of stalling the frame on a compile.
 */
async function warm(q: PropTexQuality, precompile?: Precompile): Promise<() => void> {
  if (!precompile) return () => {};
  const g = new THREE.Group(), seen = new Set<string>(), geo = new THREE.BoxGeometry();
  for (const m of surfaced) {
    const defines = definesFor(m, q), key = JSON.stringify(defines);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = m.clone();
    c.onBeforeCompile = m.onBeforeCompile;
    c.customProgramCacheKey = m.customProgramCacheKey;
    c.defines = defines;
    const mesh = new THREE.Mesh(geo, c);
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

/** Run `fn` once the next couple of frames have rendered (the swapped materials hold their programs by then). */
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
      shared.uPropMean.value = set.propMeans.map((v) => Math.max(0.05, v));
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
