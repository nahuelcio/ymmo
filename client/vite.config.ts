import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * A short content hash of every file in client/public (models, animations, textures, audio), keyed by its path.
 * Those files keep their names, so the client asks for them with ?v=<hash> (src/assets.ts): a changed file is a
 * new URL, and browsers can't keep playing an old animation file against new code.
 */
function publicHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = join(root, 'public');
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 10);
    }
  };
  walk(dir);
  return out;
}

export default defineConfig(({ command }) => ({
  root,
  // the dev server never caches public files: no hashes needed there
  define: { __ASSET_HASHES__: JSON.stringify(command === 'build' ? publicHashes() : {}) },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // GAME_PORT is the game server. Local cargo uses 3001. The Docker map is 3002.
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${process.env.GAME_PORT ?? '3001'}`, ws: true },
      // clan crests are served by the game server (server-rs/src/main.rs)
      '/crest': { target: `http://127.0.0.1:${process.env.GAME_PORT ?? '3001'}` },
    },
    allowedHosts: ['localhost', 'bus-sonic-screenshots-escape.trycloudflare.com', '0.0.0.0'],
  },
  build: {
    outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200,
    // three.js in its own file: it rarely changes, so players keep it cached across game updates
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } } },
  },
}));
