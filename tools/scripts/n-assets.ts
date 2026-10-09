// Regenerates client/public/n from the Ultimate Stylized Nature Pack.
// Usage: npx tsx tools/scripts/n-assets.ts <pack dir>
// Keeps a curated subset. Albedo only (leaves 1024, bark/grass/rock 512, WebP),
// alpha-blended cards become a mask, meshes are meshopt-compressed.
// Pieces missing from the pack's glTF folder are exported with Blender when it
// is on PATH, and otherwise built from the pack's OBJ (same meshes, Y-up).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) throw new Error('pass the pack directory: npx tsx tools/scripts/n-assets.ts <pack dir>');
const GLTF = path.join(SRC, 'glTF');
const OBJ = path.join(SRC, 'OBJ');
const TEXDIR = path.join(SRC, 'Textures');
const BLENDS = path.join(SRC, 'Blends');
if (!fs.existsSync(GLTF)) throw new Error(`glTF folder not found: ${GLTF}`);

/** Curated set: pines and green broadleaf, a little autumn, dead wood, bushes, near detail, rocks. */
const PIECES = [
  'PineTree_1', 'PineTree_2', 'PineTree_3',
  'NormalTree_1', 'NormalTree_2',
  'BirchTree_1', 'MapleTree_1',
  'DeadTree_1', 'DeadTree_2',
  'Bush_Small', 'Bush', 'Bush_Large', 'Bush_Small_Flowers', 'Bush_Flowers',
  'Grass_Small', 'Grass_Large',
  'Flower_1_Clump', 'Flower_3_Clump',
  'Rock_1', 'Rock_2', 'Rock_3',
] as const;

const OUT = path.resolve('client/public/n');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

interface GltfMaterial {
  name?: string;
  alphaMode?: string;
  alphaCutoff?: number;
  doubleSided?: boolean;
  normalTexture?: unknown;
  occlusionTexture?: unknown;
  emissiveTexture?: unknown;
  pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number };
}
interface Gltf {
  materials?: GltfMaterial[];
  images?: { uri: string }[];
  textures?: { source: number }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  buffers?: { uri: string; byteLength?: number }[];
  samplers?: unknown;
  animations?: unknown;
}

const webpName = (uri: string) => path.basename(decodeURIComponent(uri)).replace(/\.(png|jpe?g)$/i, '.webp');
const cutoutName = (name: string) => /Leaves|Flower|Bush/i.test(name);
const texSize = (name: string) => (cutoutName(name) ? 1024 : 512);

function findImage(file: string): string {
  const stem = path.basename(file).replace(/\.(png|jpe?g|webp)$/i, '');
  for (const dir of [TEXDIR, GLTF]) {
    for (const ext of ['.png', '.jpg', '.jpeg']) {
      const p = path.join(dir, stem + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error(`texture not found: ${file}`);
}

function hasBlender(): boolean {
  try {
    execSync('blender --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface Built {
  materials: GltfMaterial[];
  images: { uri: string }[];
  textures: { source: number }[];
  meshes: Gltf['meshes'];
  accessors: unknown[];
  bufferViews: unknown[];
  bin: Buffer;
}

/** OBJ (Y-up, Blender) → glTF. UV V is flipped into glTF's top-left origin. */
function objToGltf(name: string): Built {
  const text = fs.readFileSync(path.join(OBJ, `${name}.obj`), 'utf8');
  const v: number[] = [], vt: number[] = [], vn: number[] = [];
  const groups = new Map<string, number[][][]>();
  let mat = 'default';
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'vt') vt.push(+p[1], +p[2]);
    else if (p[0] === 'vn') vn.push(+p[1], +p[2], +p[3]);
    else if (p[0] === 'usemtl') mat = p[1];
    else if (p[0] === 'f') {
      const idx = p.slice(1).map((c) => c.split('/').map((n) => +n));
      let g = groups.get(mat);
      if (!g) groups.set(mat, (g = []));
      for (let i = 1; i < idx.length - 1; i++) g.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  const texOf = (m: string) => (m === 'Rock' ? 'Rocks.png' : m === 'Grass' || m === 'None' ? 'Grass.png' : `${m}.png`);
  const chunks: Buffer[] = [];
  let offset = 0;
  const bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  const push = (data: Buffer, target: number) => {
    if (offset % 4) {
      const pad = Buffer.alloc(4 - (offset % 4));
      chunks.push(pad);
      offset += pad.length;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length, target });
    chunks.push(data);
    offset += data.length;
    return bufferViews.length - 1;
  };
  const at = (i: number, arr: number[], stride: number) => ((i > 0 ? i - 1 : arr.length / stride + i) * stride);
  const materials: GltfMaterial[] = [];
  const images: { uri: string }[] = [];
  const textures: { source: number }[] = [];
  const seen = new Map<string, number>();
  const primitives: { attributes: Record<string, number>; indices: number; material: number }[] = [];
  for (const [m, faces] of groups) {
    if (!faces.length) continue;
    const map = new Map<string, number>();
    const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const tri of faces) {
      for (const c of tri) {
        const key = c.join('/');
        let id = map.get(key);
        if (id === undefined) {
          id = map.size;
          map.set(key, id);
          const pi = at(c[0], v, 3), ti = at(c[1] || 0, vt, 2), ni = at(c[2] || 0, vn, 3);
          pos.push(v[pi], v[pi + 1], v[pi + 2]);
          uv.push(vt[ti] ?? 0, 1 - (vt[ti + 1] ?? 0));
          nrm.push(vn[ni] ?? 0, vn[ni + 1] ?? 1, vn[ni + 2] ?? 0);
        }
        idx.push(id);
      }
    }
    const uri = webpName(texOf(m));
    let src = seen.get(uri);
    if (src === undefined) {
      src = images.length;
      seen.set(uri, src);
      images.push({ uri });
      textures.push({ source: src });
    }
    const cutout = cutoutName(m);
    materials.push({
      name: m,
      doubleSided: cutout || m === 'Grass',
      ...(cutout ? { alphaMode: 'MASK', alphaCutoff: 0.45 } : {}),
      pbrMetallicRoughness: { baseColorTexture: { index: src }, metallicFactor: 0, roughnessFactor: 0.5 },
    });
    const pMin = [Infinity, Infinity, Infinity], pMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        pMin[k] = Math.min(pMin[k], pos[i + k]);
        pMax[k] = Math.max(pMax[k], pos[i + k]);
      }
    const wide = idx.length > 65535;
    const indexBuf = Buffer.from((wide ? new Uint32Array(idx) : new Uint16Array(idx)).buffer);
    const pv = push(Buffer.from(new Float32Array(pos).buffer), 34962);
    accessors.push({ bufferView: pv, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: pMin, max: pMax });
    const nv = push(Buffer.from(new Float32Array(nrm).buffer), 34962);
    accessors.push({ bufferView: nv, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    const tv = push(Buffer.from(new Float32Array(uv).buffer), 34962);
    accessors.push({ bufferView: tv, componentType: 5126, count: uv.length / 2, type: 'VEC2' });
    const iv = push(indexBuf, 34963);
    accessors.push({ bufferView: iv, componentType: wide ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
    const base = accessors.length - 4;
    primitives.push({ attributes: { POSITION: base, NORMAL: base + 1, TEXCOORD_0: base + 2 }, indices: base + 3, material: materials.length - 1 });
  }
  if (!primitives.length) throw new Error(`no faces in ${name}.obj`);
  return { materials, images, textures, meshes: [{ primitives }], accessors, bufferViews, bin: Buffer.concat(chunks) };
}

const blender = hasBlender();
const work = fs.mkdtempSync(path.join(OUT, '.src-'));
const py = path.resolve('tools/scripts/export-nature-blend.py');

function sourceOf(name: string): { file: string; dir: string } {
  const packed = path.join(GLTF, `${name}.gltf`);
  if (fs.existsSync(packed)) return { file: packed, dir: GLTF };
  const dest = path.join(work, `${name}.gltf`);
  const blend = path.join(BLENDS, `${name}.blend`);
  if (blender && fs.existsSync(blend)) {
    execSync(`blender --background "${blend}" --python "${py}" -- "${dest}"`, { stdio: 'inherit' });
    return { file: dest, dir: work };
  }
  if (!fs.existsSync(path.join(OBJ, `${name}.obj`))) throw new Error(`missing piece: ${name}`);
  const built = objToGltf(name);
  fs.writeFileSync(dest, JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    materials: built.materials,
    meshes: built.meshes,
    textures: built.textures,
    images: built.images,
    accessors: built.accessors,
    bufferViews: built.bufferViews,
    buffers: [{ uri: `${name}.bin`, byteLength: built.bin.length }],
  }));
  fs.writeFileSync(path.join(work, `${name}.bin`), built.bin);
  return { file: dest, dir: work };
}

const textures = new Map<string, string>();
for (const name of PIECES) {
  const { file, dir } = sourceOf(name);
  const g = JSON.parse(fs.readFileSync(file, 'utf8')) as Gltf;
  const used: string[] = [];
  for (const m of g.materials ?? []) {
    const base = m.pbrMetallicRoughness?.baseColorTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.alphaMode === 'BLEND') {
      m.alphaMode = 'MASK';
      m.alphaCutoff = 0.45;
    }
    const uri = base ? g.images![g.textures![base.index].source].uri : '';
    m.pbrMetallicRoughness = base ? { baseColorTexture: { index: used.push(uri) - 1 } } : {};
  }
  g.images = used.map((uri) => ({ uri: webpName(uri) }));
  g.textures = used.map((_, i) => ({ source: i }));
  delete g.samplers;
  delete g.animations;
  for (const mesh of g.meshes)
    for (const prim of mesh.primitives)
      for (const k of ['COLOR_0', 'COLOR_1', 'TANGENT', 'TEXCOORD_1']) delete prim.attributes[k];
  used.forEach((uri) => {
    const out = webpName(uri);
    if (!textures.has(out)) textures.set(out, findImage(uri));
  });
  fs.writeFileSync(path.join(OUT, `${name}.gltf`), JSON.stringify(g));
  for (const b of g.buffers ?? []) {
    const bin = path.join(dir, path.basename(decodeURIComponent(b.uri)));
    fs.copyFileSync(bin, path.join(OUT, path.basename(bin)));
  }
}

const bySize = new Map<number, [string, string][]>();
for (const [name, src] of textures) {
  const size = texSize(name);
  const list = bySize.get(size) ?? [];
  list.push([name, src]);
  bySize.set(size, list);
}
for (const [size, files] of bySize) {
  const tmp = fs.mkdtempSync(path.join(OUT, '.tex-'));
  for (const [name, src] of files) fs.copyFileSync(src, path.join(tmp, name.replace(/\.webp$/, path.extname(src).toLowerCase())));
  const q = size === 1024 ? 90 : 82;
  execSync(`npx -y sharp-cli -i "${tmp.replaceAll('\\', '/')}/*" -o "${OUT.replaceAll('\\', '/')}" -f webp -q ${q} resize ${size} ${size}`, { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true });
}

const compress = (file: string) => {
  const opt = fs.mkdtempSync(path.join(OUT, '.opt-'));
  execSync(`npx -y @gltf-transform/cli meshopt "${path.join(OUT, file)}" "${path.join(opt, file)}"`, { stdio: 'inherit' });
  for (const f of fs.readdirSync(opt)) if (!f.endsWith('.webp')) fs.copyFileSync(path.join(opt, f), path.join(OUT, f));
  fs.rmSync(opt, { recursive: true });
};
for (const name of PIECES) compress(`${name}.gltf`);
fs.rmSync(work, { recursive: true, force: true });

const size = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${fs.readdirSync(OUT).length} files, ${(size / 1e6).toFixed(1)} MB -> ${OUT}`);
