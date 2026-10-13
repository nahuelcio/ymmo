// Regenerates client/public/p, the particle textures (Kenney Particle Pack 1.1, CC0).
// Usage: node tools/scripts/p-assets.mjs <unzipped pack dir>
// Takes the black-background PNGs the effects use, shrinks them to 128px WebP (via `npx sharp-cli`);
// the client packs them into one atlas at load (render/particles.ts), in the order of CELLS there.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) throw new Error('usage: node tools/scripts/p-assets.mjs <unzipped pack dir>');
const OUT = path.resolve('client/public/p');
/** keep in sync with CELLS in client/src/render/particles.ts */
const FILES = ['circle_05', 'trace_01', 'star_06', 'star_05', 'fire_01', 'flame_02', 'smoke_04', 'smoke_07',
  'magic_02', 'circle_03', 'spark_05', 'dirt_02', 'slash_01', 'twirl_01', 'scorch_01', 'light_01'];

const dir = path.join(SRC, 'PNG (Black background)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p-assets-'));
for (const f of FILES) fs.copyFileSync(path.join(dir, `${f}.png`), path.join(tmp, `${f}.png`));
fs.mkdirSync(OUT, { recursive: true });
execSync(`npx -y sharp-cli -i "${tmp.replaceAll('\\', '/')}/*.png" -o "${OUT.replaceAll('\\', '/')}" -f webp -q 85 resize 128 128`, { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), `Particle textures: Particle Pack 1.1 by Kenney (kenney.nl), CC0 1.0 (public domain):
https://creativecommons.org/publicdomain/zero/1.0/
Regenerate with tools/scripts/p-assets.mjs.
`);
for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(18), fs.statSync(path.join(OUT, f)).size);
