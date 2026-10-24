// Regenerates client/public/q from the Quaternius packs (all CC0):
//   Modular Character Outfits - Fantasy, Universal Base Characters (hairstyles), Universal Animation Library 1 and 2.
// and retargets a few clips from KayKit Character Animations 1.1 (Kay Lousberg, CC0; kaylousberg.com) onto the same rig:
// the bow, the two-handed and dual-wielded blows, the kick, the dodge and sitting on the floor, which the Quaternius
// libraries lack (retarget.mjs).
// The heads come from heads.glb, built by art/blender/characters.py.
// Usage: node scripts/q-assets.mjs <dir with the packs unzipped> [more dirs...] [--anims-only]
//   --anims-only: rebuild just anims.gltf/.bin from the animation libraries (the other packs need not be there)
// Keeps only BaseColor (as 1024px WebP, via `npx sharp-cli`) and the animation clips the game plays,
// then quantizes and meshopt-compresses every model (via `npx @gltf-transform/cli`).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { readAccessor, readGlb, retargetClip, seatOnFloor, skeleton } from './retarget.mjs';

const SRCS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ANIMS_ONLY = process.argv.includes('--anims-only');
if (!SRCS.length || !SRCS.every((d) => fs.existsSync(d))) throw new Error('usage: node scripts/q-assets.mjs <unzipped packs dir> [more dirs...]');
const OUT = path.resolve('client/public/q');
const CLIPS = [
  'Idle_Loop', 'Jog_Fwd_Loop', 'Sword_Attack', 'Punch_Jab', 'Spell_Simple_Idle_Loop', 'Death01', 'Dance_Loop',
  // the fists' second blow (render/swings.ts)
  'Punch_Cross',
  // a spell: raising it, and loosing it as it goes off (quaternius.ts SKILL_ANIM)
  'Spell_Simple_Enter', 'Spell_Simple_Shoot',
  // world interactions (shared/src/nodes.ts): sitting, swimming, picking
  'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit', 'Swim_Idle_Loop', 'Swim_Fwd_Loop', 'Fixing_Kneeling',
];
/** From Universal Animation Library 2 (the same rig): the shield's blows and guard, quick cuts, a hook, a throw, a dash. */
const CLIPS2 = [
  'Shield_OneShot', 'Shield_Dash', 'Idle_Shield_Loop', 'Sword_Regular_A', 'Sword_Regular_B', 'Melee_Hook', 'OverhandThrow', 'Sword_Dash',
  // the sword's chain of blows and the way back from each (render/swings.ts)
  'Sword_Regular_C', 'Sword_Regular_A_Rec', 'Sword_Regular_B_Rec',
  // the melee skills' blows, cut out of UAL2's combos (quaternius.ts SKILL_ANIM)
  'Sword_Regular_Combo', 'Sword_Heavy_Combo',
];
/** From KayKit Character Animations 1.1 (Rig_Medium), retargeted: [library, clip, name in the game]. */
const KAYKIT = [
  ['CombatRanged', 'Ranged_Bow_Idle', 'KK_Bow_Idle'], ['CombatRanged', 'Ranged_Bow_Draw', 'KK_Bow_Draw'], ['CombatRanged', 'Ranged_Bow_Aiming_Idle', 'KK_Bow_Aim'],
  ['CombatRanged', 'Ranged_Bow_Release', 'KK_Bow_Release'], ['CombatRanged', 'Ranged_Bow_Draw_Up', 'KK_Bow_Draw_Up'], ['CombatRanged', 'Ranged_Bow_Release_Up', 'KK_Bow_Release_Up'],
  ['MovementAdvanced', 'Running_HoldingBow', 'KK_Bow_Run'], ['MovementAdvanced', 'Dodge_Backward', 'KK_Dodge_Back'],
  ['CombatMelee', 'Melee_Dualwield_Attack_Stab', 'KK_Dual_Stab'], ['CombatMelee', 'Melee_Dualwield_Attack_Slice', 'KK_Dual_Slice'],
  ['CombatMelee', 'Melee_Unarmed_Attack_Kick', 'KK_Kick'],
  // the blows of each weapon (render/swings.ts): the one-handed chop, the two-handed ones (spear, staff) and their guard,
  // a pair's
  ['CombatMelee', 'Melee_1H_Attack_Chop', 'KK_1H_Chop'],
  ['CombatMelee', 'Melee_2H_Attack_Chop', 'KK_2H_Chop'], ['CombatMelee', 'Melee_2H_Attack_Slice', 'KK_2H_Slice'], ['CombatMelee', 'Melee_2H_Attack_Stab', 'KK_2H_Stab'],
  ['CombatMelee', 'Melee_2H_Idle', 'KK_2H_Idle'], ['CombatMelee', 'Melee_Dualwield_Attack_Chop', 'KK_Dual_Chop'],
  // the skills' (quaternius.ts SKILL_ANIM): a leap and a chop, the spins, and the spells' raising, channelling and loosing
  ['CombatMelee', 'Melee_1H_Attack_Jump_Chop', 'KK_Jump_Chop'], ['CombatMelee', 'Melee_2H_Attack_Spin', 'KK_Spin'],
  ['CombatMelee', 'Melee_2H_Attack_Spinning', 'KK_Spinning'], ['CombatMelee', 'Melee_1H_Attack_Slice_Diagonal', 'KK_1H_Slice_Diagonal'],
  ['CombatRanged', 'Ranged_Magic_Raise', 'KK_Magic_Raise'], ['CombatRanged', 'Ranged_Magic_Shoot', 'KK_Magic_Shoot'],
  ['CombatRanged', 'Ranged_Magic_Spellcasting_Long', 'KK_Magic_Channel'], ['CombatRanged', 'Ranged_Magic_Summon', 'KK_Magic_Summon'],
  ['Simulation', 'Sit_Floor_Down', 'KK_Sit_Floor_Down'], ['Simulation', 'Sit_Floor_Idle', 'KK_Sit_Floor_Idle'], ['Simulation', 'Sit_Floor_StandUp', 'KK_Sit_Floor_StandUp'],
];
/** How much further than the retarget brings them the hips go down sat on the floor, of their standing height (seatOnFloor). */
const SEAT_DROP = 0.22;
/** Rig_Medium's bones on ours (clavicles, the neck, spine_02 and the fingers have no counterpart: they hold their pose). */
const KK_MAP = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', head: 'Head',
  'upperarm.l': 'upperarm_l', 'lowerarm.l': 'lowerarm_l', 'wrist.l': 'hand_l', 'upperarm.r': 'upperarm_r', 'lowerarm.r': 'lowerarm_r', 'wrist.r': 'hand_r',
  'upperleg.l': 'thigh_l', 'lowerleg.l': 'calf_l', 'foot.l': 'foot_l', 'toes.l': 'ball_l', 'upperleg.r': 'thigh_r', 'lowerleg.r': 'calf_r', 'foot.r': 'foot_r', 'toes.r': 'ball_r',
};

const walk = (d, o = []) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p, o) : o.push(p);
  }
  return o;
};
const all = SRCS.flatMap((d) => walk(d));
const webp = (uri) => path.basename(uri).replace(/(_png)?\.png$/, '.webp');
/** Quantize + meshopt in place (also prunes whatever the file no longer references). */
const compress = (file) => {
  const tmp = fs.mkdtempSync(path.join(OUT, '.opt-'));
  execSync(`npx -y @gltf-transform/cli meshopt "${path.join(OUT, file)}" "${path.join(tmp, file)}"`, { stdio: 'ignore' });
  for (const f of fs.readdirSync(tmp)) if (!f.endsWith('.webp')) fs.copyFileSync(path.join(tmp, f), path.join(OUT, f));
  fs.rmSync(tmp, { recursive: true });
};

// hand-made props (*.glb, modelled in Fiend) live here too: overwrite, never wipe
fs.mkdirSync(OUT, { recursive: true });

// --- models: drop everything but BaseColor, point the images at the shared .webp files
if (!ANIMS_ONLY) {
const models = all.filter((f) => /Modular Parts[\\/].*\.gltf$|Rigged to Head Bone[\\/]glTF[^\\/]*[\\/]Hair_.*\.gltf$/.test(f));
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
  for (const m of g.meshes) for (const p of m.primitives) for (const k of ['COLOR_0', 'COLOR_1', 'TANGENT']) delete p.attributes[k]; // unused by the game's materials
  used.forEach((uri) => textures.add(webp(uri)));
  fs.writeFileSync(path.join(OUT, path.basename(f)), JSON.stringify(g));
  for (const b of g.buffers) fs.copyFileSync(path.join(path.dirname(f), decodeURIComponent(b.uri)), path.join(OUT, b.uri));
  compress(path.basename(f));
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
}

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
/** A track that never moves (a held finger, a bone the clip leaves alone) as a single key: the same pose, a fraction of the bytes. */
const still = (times, values, per) => {
  for (let k = per; k < values.length; k++) if (Math.abs(values[k] - values[k % per]) > 1e-5) return null;
  return [times.subarray ? times.subarray(0, 1) : times.slice(0, 1), values.slice(0, per)];
};
/** New float data (another file's, or retargeted) as an accessor; `time`: an animation input, which needs its min/max. */
const addFloats = (arr, type, time = false) => {
  const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  chunks.push(Buffer.from(b));
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
  offset += b.length;
  const acc = { bufferView: bufferViews.length - 1, byteOffset: 0, componentType: 5126, count: arr.length / SIZE[type], type };
  if (time) Object.assign(acc, { min: [arr[0]], max: [arr[arr.length - 1]] });
  return accessors.push(acc) - 1;
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

// Universal Animation Library 2: the same 65 joints, so its channels only need pointing at this file's nodes (by name)
const ual2 = all.find((f) => f.endsWith('UAL2_Standard.glb'));
if (ual2) {
  const u = readGlb(ual2), byName = Object.fromEntries(g.nodes.map((n, i) => [n.name, i]));
  for (const name of CLIPS2) {
    const a = u.json.animations.find((x) => x.name === name);
    if (!a) throw new Error(`UAL2 clip not found: ${name}`);
    const samplers = [];
    const channels = a.channels
      .filter((c) => byName[u.json.nodes[c.target.node].name] !== undefined)
      .filter((c) => c.target.path === 'rotation' || (c.target.path === 'translation' && u.json.nodes[c.target.node].name === 'pelvis'))
      .map((c) => {
        const sm = a.samplers[c.sampler], per = c.target.path === 'rotation' ? 4 : 3;
        let [ti, va] = [readAccessor(u, sm.input), readAccessor(u, sm.output)];
        [ti, va] = still(ti, va, per) ?? [ti, va];
        return { target: { node: byName[u.json.nodes[c.target.node].name], path: c.target.path },
          sampler: samplers.push({ interpolation: sm.interpolation, input: addFloats(Float32Array.from(ti), 'SCALAR', true), output: addFloats(Float32Array.from(va), per === 4 ? 'VEC4' : 'VEC3') }) - 1 };
      });
    animations.push({ name, channels, samplers });
  }
} else console.warn('[q-assets] no UAL2_Standard.glb among the sources: its clips are left out');

// KayKit: retargeted onto this rig, the fingers closed round a grip (the jab's first frame: both fists)
const kkDir = all.find((f) => /Rig_Medium[\\/]Rig_Medium_CombatMelee\.glb$/.test(f));
if (kkDir) {
  const joints = new Set(g.skins[0].joints.map((j) => g.nodes[j].name));
  const sword = g.animations.find((x) => x.name === 'Punch_Jab'); // both fists closed
  const fist = {};
  for (const c of sword.channels) {
    const n = g.nodes[c.target.node].name;
    if (c.target.path !== 'rotation' || !/^(thumb|index|middle|ring|pinky)_/.test(n)) continue;
    const v = readAccessor({ json: g, bin }, sword.samplers[c.sampler].output);
    fist[n] = new THREE.Quaternion(v[0], v[1], v[2], v[3]);
  }
  const libs = {};
  const kk = KAYKIT.map(([lib, clip, name]) => {
    const src = (libs[lib] ??= readGlb(path.join(path.dirname(kkDir), `Rig_Medium_${lib}.glb`)));
    return [name, retargetClip(src, clip, g, KK_MAP, ['hips', 'pelvis'], fist, joints)];
  });
  // the floor sit, sat on the floor: the seat down to it and the feet kept on it (seatOnFloor), measured against our own
  // idle (the ankles and toes standing) and the clips' first frames (the hips standing, and sat)
  const sk = skeleton(g), idle = g.animations.find((x) => x.name === 'Idle_Loop');
  sk.pose(idle.channels.map((c) => ({ node: c.target.node, path: c.target.path, values: readAccessor({ json: g, bin }, idle.samplers[c.sampler].output) })), 0);
  const y = (n) => sk.obj(n).getWorldPosition(new THREE.Vector3()).y, both = (n) => (y(`${n}_l`) + y(`${n}_r`)) / 2;
  const [ankle, ball] = [both('foot'), both('ball')];
  const hipsAt = (name) => (sk.pose(kk.find((c) => c[0] === name)[1].tracks, 0), y('pelvis'));
  const [stand, seat] = [hipsAt('KK_Sit_Floor_Down'), hipsAt('KK_Sit_Floor_Idle')];
  for (const [name, r] of kk) if (name.startsWith('KK_Sit_Floor')) seatOnFloor(r, g, { stand, seat, drop: SEAT_DROP * stand, ankle, ball });
  for (const [name, r] of kk) {
    const times = Float32Array.from(r.times), input = addFloats(times, 'SCALAR', true);
    let one;
    const samplers = [], channels = [];
    for (const t of r.tracks) {
      const per = t.path === 'rotation' ? 4 : 3, held = still(times, t.values, per);
      const inp = held ? (one ??= addFloats(Float32Array.of(times[0]), 'SCALAR', true)) : input;
      channels.push({ target: { node: t.node, path: t.path }, sampler: samplers.push({ interpolation: 'LINEAR', input: inp, output: addFloats(Float32Array.from(held ? held[1] : t.values), per === 4 ? 'VEC4' : 'VEC3') }) - 1 });
    }
    animations.push({ name, channels, samplers });
  }
} else console.warn('[q-assets] no KayKit Rig_Medium animations among the sources: the bow, stab, kick and dodge clips are left out');
const nodes = g.nodes.map(({ mesh, skin, ...n }) => n);
fs.writeFileSync(path.join(OUT, 'anims.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'anims.gltf'), JSON.stringify({
  asset: g.asset, scene: 0, scenes: g.scenes, nodes, animations, accessors, bufferViews, buffers: [{ uri: 'anims.bin', byteLength: offset }],
}));

compress('anims.gltf');

// --- heads.glb (art/blender/characters.py output): only the body, eyes, brows and tusks are used
if (!ANIMS_ONLY && fs.existsSync(path.join(OUT, 'heads.glb'))) {
  const h = fs.readFileSync(path.join(OUT, 'heads.glb'));
  const len = h.readUInt32LE(12), j = JSON.parse(h.subarray(20, 20 + len).toString());
  const drop = new Set(j.nodes.flatMap((n, i) => (/__(belt|boots|bottom|gloves|top|hair\d|buzz|beard|sock_\w+)$/.test(n.name) ? [i] : [])));
  for (const n of j.nodes) if (n.children) n.children = n.children.filter((c) => !drop.has(c));
  const json = Buffer.from(JSON.stringify(j).padEnd(Math.ceil(Buffer.byteLength(JSON.stringify(j)) / 4) * 4));
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + h.length - 20 - len, 8);
  head.writeUInt32LE(json.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(path.join(OUT, 'heads.glb'), Buffer.concat([head, json, h.subarray(20 + len)]));
  compress('heads.glb');
}

// --- hand-made props
if (!ANIMS_ONLY) for (const f of fs.readdirSync(OUT)) if (f.endsWith('.glb') && f !== 'heads.glb') compress(f);

const size = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${fs.readdirSync(OUT).length} files, ${(size / 1e6).toFixed(1)} MB -> ${OUT}`);
