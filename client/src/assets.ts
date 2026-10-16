// Files in client/public (models, animations, textures, audio) keep their names across deploys, so a browser could
// keep using the copy it cached against newer code: new code, old animation file. Every request for one carries a
// hash of its content instead (computed at build time, client/vite.config.ts), so a changed file is a new URL and
// the server can let browsers keep each version for good. Imported first thing by main.ts.
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

declare const __ASSET_HASHES__: Record<string, string>;
const HASHES: Record<string, string> = __ASSET_HASHES__;

/** The URL with ?v=<content hash> when it is one of our public files (unchanged otherwise, and in dev). */
export function versioned(url: string): string {
  if (/^(data|blob):/.test(url)) return url;
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) return url;
  const h = HASHES[decodeURIComponent(u.pathname).slice(import.meta.env.BASE_URL.length)];
  if (!h) return url;
  u.searchParams.set('v', h);
  return u.pathname + u.search;
}

// every three.js loader (glTF, its .bin buffers and textures) goes through the default manager
THREE.DefaultLoadingManager.setURLModifier(versioned);

let ktx2: KTX2Loader | null = null;
/**
 * The KTX2 loader the glTF loaders hand compressed colour maps to (tools/scripts/ktx2.mjs). Its WASM Basis
 * transcoder (client/public/basis, copied from three/examples/jsm/libs/basis) picks the format this GPU reads
 * compressed: ASTC or ETC2 on phones, BC7/DXT on PCs, plain RGBA as the last resort. The models load before the
 * game's renderer exists, so support is read off a throwaway context.
 */
export function basis(): KTX2Loader {
  if (!ktx2) {
    const r = new THREE.WebGLRenderer();
    ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(r);
    r.dispose();
    r.forceContextLoss();
  }
  return ktx2;
}
