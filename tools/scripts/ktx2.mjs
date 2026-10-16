// Turns the colour maps the .gltf files in client/public/{n,v} use into KTX2 (Basis ETC1S, mipmapped) and points the
// files at them through KHR_texture_basisu. A KTX2 map stays compressed on the GPU (ASTC/ETC2 on phones, BC on PCs)
// where a WebP unpacks to full RGBA: about a sixth of the video memory. The client transcodes it with three.js's
// WASM Basis transcoder (client/public/basis, set up in client/src/assets.ts).
// Each image keeps `name: <file>.webp`, the key the client looks textures up by (village kitTexture, nature fileOf).
// The .webp files stay as the source this script reads (the game no longer fetches them).
// ponytail: q/ is left out on purpose, quaternius.ts avgColor() draws its maps on a 2D canvas, which a compressed
// texture cannot do; convert it too once that colour is precomputed.
// Usage: node tools/scripts/ktx2.mjs [path to toktx]   (KTX-Software 4.x, https://github.com/KhronosGroup/KTX-Software)
// Idempotent: run it again after n-assets / v-assets regenerate the folders.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKTX = process.argv[2] ?? 'toktx';
const PUB = path.resolve('client/public');

for (const dir of ['n', 'v']) {
  const abs = path.join(PUB, dir);
  const webps = fs.readdirSync(abs).filter((f) => f.endsWith('.webp'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));
  execSync(`npx -y sharp-cli -i ${webps.map((f) => `"${path.join(abs, f).replaceAll('\\', '/')}"`).join(' ')} -o "${tmp.replaceAll('\\', '/')}" -f png`, { stdio: 'ignore' });
  for (const f of webps) {
    const png = path.join(tmp, f.replace(/\.webp$/, '.png'));
    execFileSync(TOKTX, ['--t2', '--encode', 'etc1s', '--clevel', '4', '--qlevel', '255', '--genmipmap', '--assign_oetf', 'srgb',
      path.join(abs, f.replace(/\.webp$/, '.ktx2')), png], { stdio: 'inherit' });
  }
  fs.rmSync(tmp, { recursive: true });

  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.gltf'))) {
    const file = path.join(abs, f);
    const g = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!g.images?.length) continue;
    for (const img of g.images) {
      const webp = img.name ?? img.uri;
      img.name = webp;
      img.uri = webp.replace(/\.webp$/, '.ktx2');
      img.mimeType = 'image/ktx2';
    }
    for (const t of g.textures ?? []) {
      if (t.source === undefined) continue;
      t.extensions = { ...t.extensions, KHR_texture_basisu: { source: t.source } };
      delete t.source;
    }
    for (const k of ['extensionsUsed', 'extensionsRequired']) g[k] = [...new Set([...(g[k] ?? []), 'KHR_texture_basisu'])];
    fs.writeFileSync(file, JSON.stringify(g));
  }
}
