// Procedural world textures (see docs/plan-texturas-mundo.md). Texels are painted by texgen.ts in a
// worker and packed into DataArrayTextures, one per material family, so a material needs a single
// sampler. Channel layout is documented in texgen.ts.
import * as THREE from 'three';
import { paintLayers, PROP_LAYERS, TERRAIN_LAYERS, type LayerName } from './texgen';

export { PROP_LAYERS, TERRAIN_LAYERS };
export type { PropLayer, TerrainLayer } from './texgen';

export type TextureQuality = 'low' | 'high';

export interface TextureSet {
  terrain: THREE.DataArrayTexture;
  props: THREE.DataArrayTexture;
  /** mean R (0..1) per layer: dividing a sample by it keeps the average brightness unchanged */
  terrainMeans: number[];
  propMeans: number[];
  /** wall-clock time to get the textures in ms (painted in a worker, or read back from IndexedDB) */
  ms: number;
}

/** Terrain covers the whole screen, so it gets the resolution; props never cover much of it. */
const SIZES: Record<TextureQuality, { terrain: number; props: number; maxAniso: number }> = {
  low: { terrain: 256, props: 128, maxAniso: 1 },
  high: { terrain: 512, props: 256, maxAniso: 4 },
};

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, (data: Uint8Array<ArrayBuffer>) => void>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./texgen.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; data: Uint8Array<ArrayBuffer> }>) => {
        pending.get(e.data.id)?.(e.data.data);
        pending.delete(e.data.id);
      };
      worker.onerror = () => {
        workerBroken = true;
        worker = null;
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

// ---------------------------------------------------------------- IndexedDB cache
// Painting takes ~0.3-1 s, so the result is kept per browser. Bump TEX_VERSION whenever texgen.ts
// changes its output. Every access is guarded: private windows or blocked storage just repaint.

const TEX_VERSION = 3;
const DB_NAME = 'claudi-textures', STORE = 'layers';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        pruneOldVersions(req.result);
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Drop layers painted by older generator versions so they don't pile up. */
function pruneOldVersions(d: IDBDatabase) {
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result) if (!String(k).startsWith(`v${TEX_VERSION}:`)) store.delete(k);
    };
  } catch {
    /* ignore */
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

async function cacheGet(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? new Uint8Array(req.result) : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(key: string, data: Uint8Array<ArrayBuffer>) {
  const d = await db();
  if (!d) return;
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(data.buffer.slice(0), key);
  } catch {
    /* storage full or unavailable: next load repaints */
  }
}

/** Cached paint: IndexedDB first, then the worker (or the main thread as a fallback). */
async function paint(layers: readonly LayerName[], size: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = `v${TEX_VERSION}:${size}:${layers.join(',')}`;
  const hit = await cacheGet(key);
  if (hit && hit.length === size * size * 4 * layers.length) return hit;
  const data = await paintFresh(layers, size);
  void cachePut(key, data);
  return data;
}

/** Paint in the worker when possible, on the main thread otherwise. */
function paintFresh(layers: readonly LayerName[], size: number): Promise<Uint8Array<ArrayBuffer>> {
  const w = getWorker();
  if (!w) return Promise.resolve(paintLayers(layers, size));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    w.postMessage({ id, layers: [...layers], size });
  });
}

function toArrayTexture(data: Uint8Array<ArrayBuffer>, size: number, depth: number, anisotropy: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, depth);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Average R (luminance, 0..1) of each layer, so shaders can keep the mean brightness at 1. */
function layerMeans(data: Uint8Array, size: number, depth: number): number[] {
  const n = size * size, out: number[] = [];
  for (let l = 0; l < depth; l++) {
    let sum = 0;
    for (let i = l * n * 4, end = (l + 1) * n * 4; i < end; i += 4) sum += data[i];
    out.push(sum / n / 255);
  }
  return out;
}

/**
 * Fragment snippet for after <normal_fragment_maps>: tilts `normal` by the slope of the height `h`
 * (a float in world units), taken from screen derivatives, so the G channel doubles as a normal map.
 */
export const bumpNormal = (h: string) => /* glsl */ `
{
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  normal = normalize(abs(det) * normal - sign(det) * uRelief * (dFdx(${h}) * r1 + dFdy(${h}) * r2));
}
`;
/** Strength of that relief (the 'relief' setting; 0 = flat). Shaders declare `uniform float uRelief`. */
export const relief = { value: 0.4 };

const cache = new Map<TextureQuality, Promise<TextureSet>>();

/** Build (or return the cached) texture set for a quality level. */
export function getTextureSet(quality: TextureQuality, maxAnisotropy = 1): Promise<TextureSet> {
  let p = cache.get(quality);
  if (!p) {
    const s = SIZES[quality];
    const aniso = Math.min(s.maxAniso, maxAnisotropy);
    const t0 = performance.now();
    p = Promise.all([paint(TERRAIN_LAYERS, s.terrain), paint(PROP_LAYERS, s.props)]).then(([t, pr]) => ({
      terrain: toArrayTexture(t, s.terrain, TERRAIN_LAYERS.length, aniso),
      props: toArrayTexture(pr, s.props, PROP_LAYERS.length, aniso),
      terrainMeans: layerMeans(t, s.terrain, TERRAIN_LAYERS.length),
      propMeans: layerMeans(pr, s.props, PROP_LAYERS.length),
      ms: performance.now() - t0,
    }));
    cache.set(quality, p);
  }
  return p;
}

export async function disposeTextureSets() {
  for (const p of cache.values()) {
    const s = await p;
    s.terrain.dispose();
    s.props.dispose();
  }
  cache.clear();
}

/** Bytes of GPU memory a set takes, mipmaps included (≈ 4/3 of the base level). */
export function textureSetBytes(quality: TextureQuality): number {
  const s = SIZES[quality];
  const layerBytes = (n: number) => n * n * 4;
  return Math.round((layerBytes(s.terrain) * TERRAIN_LAYERS.length + layerBytes(s.props) * PROP_LAYERS.length) * (4 / 3));
}

/** Debug helper: one layer's channel (0 = luminance, 1 = height) tiled `tiles` × `tiles` in a canvas. */
export function previewLayer(tex: THREE.DataArrayTexture, layer: number, channel: 0 | 1 = 0, tiles = 2): HTMLCanvasElement {
  const size = tex.image.width;
  const data = tex.image.data as Uint8Array;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * tiles;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const base = layer * size * size * 4;
  for (let i = 0; i < size * size; i++) {
    const g = data[base + i * 4 + channel];
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) ctx.putImageData(img, tx * size, ty * size);
  return cv;
}
