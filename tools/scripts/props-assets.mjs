// Builds client/public/v/props.glb: a few props from Quaternius' Fantasy Props MegaKit (Standard, CC0) for the towns.
// Usage: node tools/scripts/props-assets.mjs "<Fantasy Props MegaKit[Standard] dir>"
// One file, a scene per prop named after it (render/village.ts picks them by name). Only BaseColor is kept,
// shrunk to a 512px WebP and shared by every prop that uses it; everything is meshopt-compressed
// (via `npx @gltf-transform/cli`).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) throw new Error('usage: node tools/scripts/props-assets.mjs "<Fantasy Props MegaKit[Standard] dir>"');
const GLTF = path.join(SRC, 'Exports', 'glTF');
const OUT = path.resolve('client/public/v');
/** keep in sync with PROPS in client/src/render/village.ts */
const PROPS = ['Banner_1_Cloth', 'Banner_2_Cloth', 'Lantern_Wall', 'WeaponStand', 'Anvil', 'Cauldron', 'Barrel', 'Crate_Wooden'];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'props-assets-'));
const gt = (args) => execSync(`npx -y @gltf-transform/cli ${args}`, { stdio: 'ignore' });

/** Rewrites a .glb's JSON chunk with `edit` (prune drops what is no longer referenced). */
function editGlb(file, edit) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + len).toString());
  edit(g);
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0), head.writeUInt32LE(2, 4), head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12), head.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([head, json, bin]));
}

const parts = PROPS.map((name) => {
  const f = path.join(TMP, `${name}.glb`);
  gt(`copy "${path.join(GLTF, `${name}.gltf`)}" "${f}"`);
  editGlb(f, (g) => {
    g.scenes[g.scene ?? 0].name = name;
    for (const m of g.materials ?? []) {
      for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
      if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  });
  return `"${f}"`;
});
const out = path.join(TMP, 'props.glb');
gt(`merge ${parts.join(' ')} "${out}"`);
gt(`dedup "${out}" "${out}"`);
gt(`prune "${out}" "${out}"`);
gt(`resize "${out}" "${out}" --width 512 --height 512`);
gt(`webp "${out}" "${out}"`);
gt(`meshopt "${out}" "${path.join(OUT, 'props.glb')}"`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), `Town kit: Medieval Village MegaKit by Quaternius (quaternius.com), CC0 1.0 (tools/scripts/v-assets.ts).
props.glb: Fantasy Props MegaKit (Standard) by Quaternius (quaternius.com), CC0 1.0 (tools/scripts/props-assets.mjs).
https://creativecommons.org/publicdomain/zero/1.0/
`);
console.log('props.glb', fs.statSync(path.join(OUT, 'props.glb')).size);
