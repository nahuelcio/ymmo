// Regenerates client/public/v from the Quaternius Medieval Village MegaKit (CC0).
// Usage: npx tsx scripts/v-assets.ts [pack dir]
// Keeps only BaseColor (1024px WebP) and meshopt-compresses the curated piece list.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { V_PIECES } from '../shared/src/village';

const SRC = process.argv[2];
if (!SRC) throw new Error('pass the MegaKit directory: npx tsx scripts/v-assets.ts <pack dir>');
const GLTF = path.join(SRC, 'glTF');
const TEXDIR = path.join(SRC, 'Textures');
if (!fs.existsSync(GLTF)) throw new Error(`glTF folder not found: ${GLTF}`);
const OUT = path.resolve('client/public/v');
fs.mkdirSync(OUT, { recursive: true });

const webp = (uri: string) => path.basename(uri).replace(/(_png)?\.png$/, '.webp');
const findPng = (uri: string) => {
  const base = path.basename(decodeURIComponent(uri));
  for (const dir of [GLTF, TEXDIR]) {
    const p = path.join(dir, base);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`texture not found: ${base}`);
};

const textures = new Set<string>();
for (const name of V_PIECES) {
  const file = path.join(GLTF, `${name}.gltf`);
  if (!fs.existsSync(file)) throw new Error(`missing piece: ${name}`);
  const g = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } }; normalTexture?: unknown; occlusionTexture?: unknown; emissiveTexture?: unknown }[];
    images?: { uri: string }[];
    textures?: { source: number }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    buffers?: { uri: string }[];
    samplers?: unknown;
    animations?: unknown;
  };
  const used: string[] = [];
  for (const m of g.materials ?? []) {
    const base = m.pbrMetallicRoughness?.baseColorTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    m.pbrMetallicRoughness = base ? { baseColorTexture: { index: used.push(g.images![g.textures![base.index].source].uri) - 1 } } : {};
  }
  g.images = used.map((uri) => ({ uri: webp(uri) }));
  g.textures = used.map((_, i) => ({ source: i }));
  delete g.samplers;
  delete g.animations;
  for (const m of g.meshes) for (const p of m.primitives) for (const k of ['COLOR_0', 'COLOR_1', 'TANGENT', 'TEXCOORD_1']) delete p.attributes[k];
  used.forEach((uri) => textures.add(webp(uri)));
  fs.writeFileSync(path.join(OUT, `${name}.gltf`), JSON.stringify(g));
  for (const b of g.buffers ?? []) fs.copyFileSync(path.join(GLTF, decodeURIComponent(b.uri)), path.join(OUT, path.basename(b.uri)));
}

const tmp = fs.mkdtempSync(path.join(OUT, '.tex-'));
for (const name of textures) {
  const png = findPng(name.replace(/\.webp$/, '.png'));
  fs.copyFileSync(png, path.join(tmp, name.replace('.webp', '.png')));
}
execSync(`npx -y sharp-cli -i "${tmp.replaceAll('\\', '/')}/*.png" -o "${OUT.replaceAll('\\', '/')}" -f webp -q 82 resize 1024 1024`, { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true });

const compress = (file: string) => {
  const opt = fs.mkdtempSync(path.join(OUT, '.opt-'));
  execSync(`npx -y @gltf-transform/cli meshopt "${path.join(OUT, file)}" "${path.join(opt, file)}"`, { stdio: 'inherit' });
  for (const f of fs.readdirSync(opt)) if (!f.endsWith('.webp')) fs.copyFileSync(path.join(opt, f), path.join(OUT, f));
  fs.rmSync(opt, { recursive: true });
};
for (const name of V_PIECES) compress(`${name}.gltf`);

const size = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${fs.readdirSync(OUT).length} files, ${(size / 1e6).toFixed(1)} MB -> ${OUT}`);
