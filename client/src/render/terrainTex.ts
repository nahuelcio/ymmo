// Terrain texture splatting (phase 2 of docs/plan-texturas-mundo.md).
// The terrain keeps its vertex colours (zone palette, minimap); the textures only modulate brightness
// and add a slight tint jitter. Each vertex carries six layer weights (splatA/splatB, see
// groundLayers in scene.ts); the fragment shader blends the layers by weight + texel height so the
// edges between grass, dirt and rock come out ragged instead of a soft fade.
import * as THREE from 'three';
import { getTextureSet, TERRAIN_LAYERS, type TextureQuality, type TextureSet } from './textures';

export type TerrainTexQuality = 'off' | TextureQuality;

/** World units covered by one repeat of each layer (TERRAIN_LAYERS order). */
const TILE_SIZE: Record<(typeof TERRAIN_LAYERS)[number], number> = { grass: 7, dirt: 6, rock: 9, sand: 6, snow: 10, cobble: 4 };

const VERT_DECL = /* glsl */ `
attribute vec4 splatA;
attribute vec2 splatB;
varying vec4 vSplatA;
varying vec2 vSplatB;
varying vec3 vTexWorld;
varying vec3 vTexNormal;
`;

const VERT_MAIN = /* glsl */ `
vSplatA = splatA;
vSplatB = splatB;
vTexWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTexNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_DECL = /* glsl */ `
uniform highp sampler2DArray uTerrainTex;
uniform float uTexStrength;
uniform float uTexContrast;
uniform float uTexScale[6];
uniform float uTexMean[6];
varying vec4 vSplatA;
varying vec2 vSplatB;
varying vec3 vTexWorld;
varying vec3 vTexNormal;

vec4 terrainSample(vec2 p, int layer) {
  float s = uTexScale[layer];
  vec4 a = texture(uTerrainTex, vec3(p * s, float(layer)));
#ifdef TERRAIN_TEX_HQ
  // a second, rotated and larger sample of the same layer breaks up the visible repetition
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * s * 0.37 + 0.5;
  vec4 b = texture(uTerrainTex, vec3(q, float(layer)));
  a = mix(a, b, 0.4);
  a.r = uTexMean[layer] + (a.r - uTexMean[layer]) * 1.35; // restore the contrast lost by averaging
#endif
  return a;
}

vec4 terrainRock(vec3 wp, vec3 n) {
#ifdef TERRAIN_TEX_HQ
  // triplanar: cliffs get the rock projected from the side instead of stretched from above
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float s = uTexScale[2];
  return texture(uTerrainTex, vec3(wp.zy * s, 2.0)) * w.x
       + terrainSample(wp.xz, 2) * w.y
       + texture(uTerrainTex, vec3(wp.xy * s, 2.0)) * w.z;
#else
  return terrainSample(wp.xz, 2);
#endif
}
`;

const FRAG_MAIN = /* glsl */ `
{
  vec2 p = vTexWorld.xz;
  vec4 s0 = terrainSample(p, 0);
  vec4 s1 = terrainSample(p, 1);
  vec4 s2 = terrainRock(vTexWorld, normalize(vTexNormal));
  vec4 s3 = terrainSample(p, 3);
  vec4 s4 = terrainSample(p, 4);
  vec4 s5 = terrainSample(p, 5);
  float w0 = vSplatA.x, w1 = vSplatA.y, w2 = vSplatA.z, w3 = vSplatA.w, w4 = vSplatB.x, w5 = vSplatB.y;
  // height blend: a layer wins where its weight plus its texel height is highest
  const float D = 0.3;
  float h0 = w0 > 0.001 ? w0 + s0.g * D : 0.0;
  float h1 = w1 > 0.001 ? w1 + s1.g * D : 0.0;
  float h2 = w2 > 0.001 ? w2 + s2.g * D : 0.0;
  float h3 = w3 > 0.001 ? w3 + s3.g * D : 0.0;
  float h4 = w4 > 0.001 ? w4 + s4.g * D : 0.0;
  float h5 = w5 > 0.001 ? w5 + s5.g * D : 0.0;
  float top = max(max(max(h0, h1), max(h2, h3)), max(h4, h5)) - D;
  float b0 = max(h0 - top, 0.0), b1 = max(h1 - top, 0.0), b2 = max(h2 - top, 0.0);
  float b3 = max(h3 - top, 0.0), b4 = max(h4 - top, 0.0), b5 = max(h5 - top, 0.0);
  float bs = b0 + b1 + b2 + b3 + b4 + b5 + 1e-5;
  // brightness relative to each layer's mean, so the average ground colour stays what it was
  float lum = (b0 * s0.r / uTexMean[0] + b1 * s1.r / uTexMean[1] + b2 * s2.r / uTexMean[2]
             + b3 * s3.r / uTexMean[3] + b4 * s4.r / uTexMean[4] + b5 * s5.r / uTexMean[5]) / bs;
  float tint = (b0 * s0.b + b1 * s1.b + b2 * s2.b + b3 * s3.b + b4 * s4.b + b5 * s5.b) / bs;
  // fade out with distance: far away the texels only shimmer
  float k = uTexStrength * (1.0 - smoothstep(140.0, 340.0, length(vViewPosition)));
  lum = 1.0 + (lum - 1.0) * uTexContrast;
  vec3 detail = lum * (vec3(1.0) + (tint - 0.5) * vec3(0.12, 0.07, -0.08));
  diffuseColor.rgb *= mix(vec3(1.0), detail, k);
}
`;

interface TexUniforms {
  uTerrainTex: { value: THREE.DataArrayTexture | null };
  uTexStrength: { value: number };
  uTexContrast: { value: number };
  uTexScale: { value: number[] };
  uTexMean: { value: number[] };
}

function texturedMaterial(set: TextureSet, quality: TextureQuality, uniforms: TexUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.defines = quality === 'high' ? { TERRAIN_TEX_HQ: '' } : {};
  uniforms.uTerrainTex.value = set.terrain;
  uniforms.uTexMean.value = set.terrainMeans.map((v) => Math.max(0.05, v));
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`);
  };
  m.customProgramCacheKey = () => `terrain-tex-${quality}`;
  return m;
}

/**
 * Owns the terrain's materials: the plain vertex-colour one (also the fallback while textures are
 * being painted) and one textured material per quality. Textures fade in once they arrive.
 */
export class TerrainTextures {
  private quality: TerrainTexQuality = 'off';
  private materials = new Map<TextureQuality, THREE.MeshLambertMaterial>();
  private uniforms: Record<TextureQuality, TexUniforms> = {
    low: this.makeUniforms(),
    high: this.makeUniforms(),
  };

  constructor(private terrain: THREE.Group, private plain: THREE.Material, private maxAnisotropy: number) {}

  private makeUniforms(): TexUniforms {
    return {
      uTerrainTex: { value: null },
      uTexStrength: { value: 0 },
      /** how strongly the texture's brightness pattern shows (1 = as painted) */
      uTexContrast: { value: 1.5 },
      uTexScale: { value: TERRAIN_LAYERS.map((l) => 1 / TILE_SIZE[l]) },
      uTexMean: { value: TERRAIN_LAYERS.map(() => 0.45) },
    };
  }

  private setMaterial(m: THREE.Material) {
    for (const ch of this.terrain.children) if (ch instanceof THREE.Mesh) ch.material = m;
  }

  set(q: TerrainTexQuality) {
    if (q === this.quality) return;
    this.quality = q;
    if (q === 'off') {
      this.setMaterial(this.plain);
      return;
    }
    const ready = this.materials.get(q);
    if (ready) {
      this.setMaterial(ready);
      return;
    }
    // keep showing what we have until the set is painted (or read back from the cache)
    void getTextureSet(q, this.maxAnisotropy).then((set) => {
      if (!this.materials.has(q)) {
        this.uniforms[q].uTexStrength.value = 0;
        this.materials.set(q, texturedMaterial(set, q, this.uniforms[q]));
      }
      if (this.quality === q) this.setMaterial(this.materials.get(q)!);
    });
  }

  /** Per frame: ease the active textures in after they first show up. */
  update(dt: number) {
    if (this.quality === 'off') return;
    const u = this.uniforms[this.quality].uTexStrength;
    if (this.materials.has(this.quality) && u.value < 1) u.value = Math.min(1, u.value + dt * 1.5);
  }
}
