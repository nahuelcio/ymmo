// Turns the colour maps the .gltf files in client/public/{n,v} use into KTX2 (Basis ETC1S, mipmapped) and points the
// files at them through KHR_texture_basisu. A KTX2 map stays compressed on the GPU (ASTC/ETC2 on phones, BC on PCs)
// where a WebP unpacks to full RGBA: about a sixth of the video memory. The client transcodes it with three.js's
// WASM Basis transcoder (client/public/basis, set up in client/src/assets.ts).
// Each image keeps `name: <file>.webp`, the key the client looks textures up by (village kitTexture, nature fileOf),
// and `extras.avg`, its mean colour over the brighter half (sRGB 0-1): the client cannot read a compressed map's
// pixels, so quaternius.ts tints with this one.
// The .webp files stay as the source this script reads (the game no longer fetches them).
// Usage: node tools/scripts/ktx2.mjs [path to toktx]   (KTX-Software 4.x, https://github.com/KhronosGroup/KTX-Software)
// Idempotent: run it again after n-assets / v-assets regenerate the folders.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const TOKTX = process.argv[2] ?? 'toktx';
const PUB = path.resolve('client/public');

for (const dir of ['n', 'v', 'q']) {
  const abs = path.join(PUB, dir);
  const webps = fs.readdirSync(abs).filter((f) => f.endsWith('.webp'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));
  const slash = (p) => p.replaceAll('\\', '/');
  const list = webps.map((f) => `"${slash(path.join(abs, f))}"`).join(' ');
  const small = path.join(tmp, 'avg');
  fs.mkdirSync(small);
  execSync(`npx -y sharp-cli -i ${list} -o "${slash(small)}" -f png --adaptiveFiltering false resize 32 32 --fit fill`, { stdio: 'ignore' });
  const avg = new Map(webps.map((f) => [f, meanBright(pixels(path.join(small, f.replace(/\.webp$/, '.png'))))]));
  execSync(`npx -y sharp-cli -i ${list} -o "${slash(tmp)}" -f png`, { stdio: 'ignore' });
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
      if (avg.has(webp)) img.extras = { ...img.extras, avg: avg.get(webp) };
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

/** RGB(A) bytes of a small 8-bit PNG written without row filters (sharp's adaptiveFiltering off), filter bytes dropped. */
function pixels(file) {
  const b = fs.readFileSync(file), idat = [];
  let o = 8, w = 0, ch = 0;
  while (o < b.length) {
    const n = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8);
    if (type === 'IHDR') {
      w = b.readUInt32BE(o + 8);
      if (b[o + 16] !== 8 || (b[o + 17] !== 2 && b[o + 17] !== 6)) throw new Error(`${file}: not 8-bit RGB/RGBA`);
      ch = b[o + 17] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + n));
    o += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), row = w * ch + 1, out = [];
  for (let y = 0; y * row < raw.length; y++) {
    if (raw[y * row] !== 0) throw new Error(`${file}: row ${y} is filtered`);
    for (let x = 1; x < row; x += ch) out.push(raw[y * row + x], raw[y * row + x + 1], raw[y * row + x + 2]);
  }
  return out;
}

/** Same as quaternius.ts used to do on a canvas: the mean of the pixels at or above the mean luminance. */
function meanBright(px) {
  const ch = 3;
  const lum = (i) => px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  let mean = 0;
  for (let i = 0; i < px.length; i += ch) mean += lum(i) / 1024;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += ch) if (lum(i) >= mean) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
  return [r, g, b].map((v) => +(v / n / 255).toFixed(4));
}
