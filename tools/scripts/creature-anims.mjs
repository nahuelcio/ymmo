// Gives a Mixamo-rigged creature the moves it lacks, retargeted from the Universal Animation Library (Quaternius, CC0)
// onto its own skeleton (retarget.mjs): the Sketchfab werewolf (client/public/m/CREDITS.txt) comes with idles only.
// Writes a .glb with the creature's own animations plus these, for tools/art/blender/creatures.py.
// Usage: node tools/scripts/creature-anims.mjs <creature.glb> <out.glb> <UAL1_Standard.glb> <UAL2_Standard.glb>
//   (a .gltf converts first: npx @gltf-transform/cli copy scene.gltf creature.glb)
import fs from 'node:fs';
import { readGlb, retargetClip } from './retarget.mjs';

const [inp, out, ual1, ual2] = process.argv.slice(2);
if (![inp, ual1, ual2].every((f) => f && fs.existsSync(f)) || !out) throw new Error('usage: node tools/scripts/creature-anims.mjs <creature.glb> <out.glb> <UAL1_Standard.glb> <UAL2_Standard.glb>');
/** [library, clip, the creature's name for it, seconds kept from its start (a long clip cut to its first blow)] */
const MOVES = [[ual1, 'Jog_Fwd_Loop', 'Run'], [ual2, 'Zombie_Scratch', 'Attack'], [ual1, 'Death01', 'Death']];
/** the Universal Animation Library's bones on Mixamo's; the fingers and the bones it lacks keep their rest pose */
const MIXAMO = {
  pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', Head: 'Head',
  clavicle_l: 'LeftShoulder', upperarm_l: 'LeftArm', lowerarm_l: 'LeftForeArm', hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder', upperarm_r: 'RightArm', lowerarm_r: 'RightForeArm', hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg', calf_l: 'LeftLeg', foot_l: 'LeftFoot', ball_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg', calf_r: 'RightLeg', foot_r: 'RightFoot', ball_r: 'RightToeBase',
};

const g = readGlb(inp);
const j = g.json;
// Sketchfab's exports number every node (mixamorig:Hips_94): the bone of that name, with or without its number
const node = (m) => j.nodes.find((n) => new RegExp(`^mixamorig:${m}(_\\d+)?$`).test(n.name ?? ''))?.name;
const map = Object.fromEntries(Object.entries(MIXAMO).map(([s, m]) => [s, node(m) ?? (() => { throw new Error(`no mixamorig:${m} in ${inp}`); })()]));
const joints = new Set(j.skins[0].joints.map((i) => j.nodes[i].name));

const pad = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
const chunks = [pad(Buffer.from(g.bin.subarray(0, j.buffers[0].byteLength)))];
let offset = chunks[0].length;
const SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const addFloats = (arr, type, time = false) => {
  const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  chunks.push(pad(Buffer.from(b)));
  j.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
  offset += chunks.at(-1).length;
  const acc = { bufferView: j.bufferViews.length - 1, componentType: 5126, count: arr.length / SIZE[type], type };
  if (time) Object.assign(acc, { min: [arr[0]], max: [arr[arr.length - 1]] });
  return j.accessors.push(acc) - 1;
};

const libs = {};
for (const [lib, clip, name] of MOVES) {
  const src = (libs[lib] ??= readGlb(lib));
  const r = retargetClip(src, clip, j, map, ['pelvis', map.pelvis], {}, joints);
  const input = addFloats(Float32Array.from(r.times), 'SCALAR', true);
  const samplers = [], channels = [];
  for (const t of r.tracks) {
    const output = addFloats(Float32Array.from(t.values), t.path === 'rotation' ? 'VEC4' : 'VEC3');
    channels.push({ target: { node: t.node, path: t.path }, sampler: samplers.push({ input, output, interpolation: 'LINEAR' }) - 1 });
  }
  j.animations.push({ name, channels, samplers });
  console.log(`[creature-anims] ${clip} -> ${name}: ${r.times.length} keys, ${r.tracks.length} tracks`);
}

const bin = Buffer.concat(chunks);
j.buffers = [{ byteLength: bin.length }];
const json = Buffer.from(JSON.stringify(j));
const jsonPad = json.length % 4 ? Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]) : json;
const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jsonPad.length + 8 + bin.length, 8);
jh.writeUInt32LE(jsonPad.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(out, Buffer.concat([head, jh, jsonPad, bh, bin]));
console.log(`[creature-anims] ${out}: ${j.animations.length} animations`);
