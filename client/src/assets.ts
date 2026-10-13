// Files in client/public (models, animations, textures, audio) keep their names across deploys, so a browser could
// keep using the copy it cached against newer code: new code, old animation file. Every request for one carries a
// hash of its content instead (computed at build time, client/vite.config.ts), so a changed file is a new URL and
// the server can let browsers keep each version for good. Imported first thing by main.ts.
import * as THREE from 'three';

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
