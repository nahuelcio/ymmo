// Regenerates client/public/q from the Quaternius packs (all CC0):
//   Modular Character Outfits - Fantasy, Universal Base Characters, Universal Animation Library.
// Usage: node scripts/q-assets.mjs <dir with the three packs unzipped>
// Keeps only BaseColor (as 1024px WebP, via `npx sharp-cli`) and the animation clips the game plays.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) throw new Error('usage: node scripts/q-assets.mjs <unzipped packs dir>');
const OUT = path.resolve('client/public/q');
const CLIPS = ['Idle_Loop', 'Jog_Fwd_Loop', 'Sword_Attack', 'Punch_Jab', 'Spell_Simple_Idle_Loop', 'Death01'];

const walk = (d, o = []) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p, o) : o.push(p);
  }
  return o;
};
const all = walk(SRC);
const webp = (uri) => path.basename(uri).replace(/(_png)?\.png$/, '.webp');

// hand-made props (*.glb, modelled in Fiend) live here too: overwrite, never wipe
fs.mkdirSync(OUT, { recursive: true });

// --- models: drop everything but BaseColor, point the images at the shared .webp files
const models = all.filter((f) => /Modular Parts[\\/].*\.gltf$|Godot - UE[\\/].*\.gltf$|Rigged to Head Bone[\\/]glTF[^\\/]*[\\/]Hair_.*\.gltf$/.test(f));
const textures = new Set();
for (const f of models) {
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  const used = [];
  for (const m of g.materials ?? []) {
    const base = m.pbrMetallicRoughness?.baseColorTexture;
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
    m.pbrMetallicRoughness = base ? { baseColorTexture: { index: used.push(g.images[g.textures[base.index].source].uri) - 1 } } : {};
  }
  g.images = used.map((uri) => ({ uri: webp(uri) }));
  g.textures = used.map((_, i) => ({ source: i }));
  delete g.samplers;
  delete g.animations;
  used.forEach((uri) => textures.add(webp(uri)));
  fs.writeFileSync(path.join(OUT, path.basename(f)), JSON.stringify(g));
  for (const b of g.buffers) fs.copyFileSync(path.join(path.dirname(f), decodeURIComponent(b.uri)), path.join(OUT, b.uri));
}

// --- textures: every BaseColor the models reference, 1024px WebP
const tmp = fs.mkdtempSync(path.join(OUT, '.tex-'));
for (const name of textures) {
  const png = all.find((f) => webp(f) === name && !/Normal|Roughness|ORM/.test(f));
  if (!png) throw new Error(`texture not found: ${name}`);
  fs.copyFileSync(png, path.join(tmp, name.replace('.webp', '.png')));
}
execSync(`npx -y sharp-cli -i "${tmp.replaceAll('\\', '/')}/*.png" -o "${OUT}" -f webp -q 82 resize 1024 1024`, { stdio: 'ignore' });
fs.rmSync(tmp, { recursive: true });

// --- animations: only CLIPS, rotations only (plus the pelvis translation) so every body keeps its own proportions
const glb = fs.readFileSync(all.find((f) => f.endsWith('UAL1_Standard.glb')));
const jsonLen = glb.readUInt32LE(12);
const g = JSON.parse(glb.subarray(20, 20 + jsonLen).toString());
const bin = glb.subarray(20 + jsonLen + 8);
const SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const chunks = [], accessors = [], bufferViews = [];
let offset = 0;
const keep = (i) => {
  const a = g.accessors[i], v = g.bufferViews[a.bufferView];
  const len = a.count * SIZE[a.type] * 4; // animation data is always float32 here
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  chunks.push(bin.subarray(start, start + len));
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: len });
  offset += len;
  return accessors.push({ ...a, bufferView: bufferViews.length - 1, byteOffset: 0 }) - 1;
};
const animations = CLIPS.map((name) => {
  const a = g.animations.find((x) => x.name === name);
  if (!a) throw new Error(`clip not found: ${name}`);
  const samplers = [];
  const channels = a.channels
    .filter((c) => c.target.path === 'rotation' || (c.target.path === 'translation' && g.nodes[c.target.node].name === 'pelvis'))
    .map((c) => {
      const s = a.samplers[c.sampler];
      return { target: c.target, sampler: samplers.push({ ...s, input: keep(s.input), output: keep(s.output) }) - 1 };
    });
  return { name, channels, samplers };
});
const nodes = g.nodes.map(({ mesh, skin, ...n }) => n);
fs.writeFileSync(path.join(OUT, 'anims.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'anims.gltf'), JSON.stringify({
  asset: g.asset, scene: 0, scenes: g.scenes, nodes, animations, accessors, bufferViews, buffers: [{ uri: 'anims.bin', byteLength: offset }],
}));

const size = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${fs.readdirSync(OUT).length} files, ${(size / 1e6).toFixed(1)} MB -> ${OUT}`);
