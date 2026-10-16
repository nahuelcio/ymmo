// Regenerates client/public/m, the mob models (CC0 unless noted, see CREDITS below):
//   Quaternius Ultimate Animated Animal Pack: Wolf.glb, Fox.glb (from poly.pizza)
//   Creatures (CREATURES): Quaternius' Spider and Dragon and Poly by Google's Cobra (CC-BY 3.0) from poly.pizza, and
//   OpenGameArt models exported from .blend by tools/art/blender/mobs_export.py into "<Mob Models>/glb" first
//   KayKit Character Pack: Skeletons 1.1 (Kay Lousberg): the four skeletons and their weapons
//   KayKit Character Animations 1.1 (Kay Lousberg): the Rig_Medium clips the skeletons share
// Usage: node tools/scripts/m-assets.mjs <unzipped pack dir>...
// Keeps only the clips the game plays (the skeletons' retargeted onto one armature), names each scene after its model,
// shrinks the texture to a 512px WebP and meshopt-compresses everything (via `npx @gltf-transform/cli`).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = process.argv.slice(2);
if (!SRC.length || !SRC.every((d) => fs.existsSync(d))) throw new Error('usage: node tools/scripts/m-assets.mjs <unzipped pack dir>...');
const OUT = path.resolve('client/public/m');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'm-assets-'));

const ANIMALS = { wolf: 'Wolf.glb', fox: 'Fox.glb', stag: 'Stag.glb', horse: 'Horse.glb', donkey: 'Donkey.glb', alpaca: 'Alpaca.glb', bull: 'Bull.glb', cow: 'Cow.glb' };
/** output name -> source file and its clips (source name -> the short name the client uses) */
const CREATURES = {
  spider: { file: 'Spider.glb', clips: { 'SpiderArmature|Spider_Idle': 'Idle', 'SpiderArmature|Spider_Walk': 'Walk', 'SpiderArmature|Spider_Attack': 'Attack', 'SpiderArmature|Spider_Death': 'Death' } },
  wyvern: { file: 'Dragon.glb', clips: { 'DragonArmature|Dragon_Flying': 'Fly', 'DragonArmature|Dragon_Attack': 'Attack', 'DragonArmature|Dragon_Death': 'Death' } },
  cobra: { file: 'Cobra.glb', clips: {} },
  drake: { file: 'drake.glb', clips: { Idle: 'Idle', Walk: 'Walk', Attack: 'Attack', Die: 'Death' } },
  crab: { file: 'crab.glb', clips: { idle: 'Idle', walk: 'Walk' } },
  limule: { file: 'limule.glb', clips: { Idle: 'Idle', Forward: 'Walk', 'Attack.000': 'Attack', OnBack: 'Death' } },
  golem: { file: 'golem.glb', clips: { idle: 'Idle', walk: 'Walk', smash: 'Attack' } },
  raptor: { file: 'raptor.glb', clips: { Velociraptor_Idle: 'Idle', Velociraptor_Run: 'Run', Velociraptor_Attack: 'Attack', Velociraptor_Death: 'Death' } },
  werewolf: { file: 'werewolf.glb', clips: { 'idle-loop': 'Idle', 'run-loop': 'Run', attack: 'Attack', death: 'Death' } },
  forest: { file: 'forest.glb', clips: { Idle: 'Idle', Walk: 'Walk', Attack: 'Attack', Dying: 'Death' } },
};
const ANIMAL_CLIPS = ['Idle', 'Walk', 'Gallop', 'Eating', 'Attack', 'Death'];
const SKELETONS = ['Skeleton_Warrior', 'Skeleton_Minion', 'Skeleton_Rogue', 'Skeleton_Mage'];
const WEAPONS = ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Shield_Large_A', 'Skeleton_Shield_Small_A'];
/** Rig_Medium animation file -> clips kept from it */
const SKELETON_CLIPS = {
  Special: ['Skeletons_Idle', 'Skeletons_Walking', 'Skeletons_Death'],
  MovementBasic: ['Running_A'],
  CombatMelee: ['Melee_1H_Attack_Chop', 'Melee_2H_Attack_Chop'],
  CombatRanged: ['Ranged_Magic_Spellcasting'],
};

const walk = (d, o = []) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p, o) : o.push(p);
  }
  return o;
};
const all = SRC.flatMap((d) => walk(d));
const find = (re) => all.find((f) => re.test(f)) ?? (() => { throw new Error(`not found in ${SRC}: ${re}`); })();
const gt = (args) => execSync(`npx -y @gltf-transform/cli ${args}`, { stdio: 'ignore' });
const tmp = (name) => path.join(TMP, name);

/** Rewrites a .glb's JSON chunk with `edit` (the binary chunk stays: prune drops what is no longer referenced). */
function editGlb(src, edit, dst = src) {
  const b = fs.readFileSync(src);
  const len = b.readUInt32LE(12);
  const g = JSON.parse(b.subarray(20, 20 + len).toString());
  edit(g);
  let json = Buffer.from(JSON.stringify(g));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const bin = b.subarray(20 + len);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0), head.writeUInt32LE(2, 4), head.writeUInt32LE(20 + json.length + bin.length, 8);
  head.writeUInt32LE(json.length, 12), head.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(dst, Buffer.concat([head, json, bin]));
}
/** Only the named clips (a list, or source name -> new name), the scene named `name`, and optionally no meshes (clips only). */
const trim = (src, dst, { name, clips, clipsOnly = false }) => editGlb(src, (g) => {
  const keep = Array.isArray(clips) ? Object.fromEntries(clips.map((c) => [c, c])) : clips ?? {};
  g.animations = (g.animations ?? []).filter((a) => a.name in keep);
  for (const a of g.animations) a.name = keep[a.name];
  if (!g.animations.length) delete g.animations;
  if (name) g.scenes[g.scene ?? 0].name = name;
  if (clipsOnly) {
    for (const n of g.nodes) delete n.mesh, delete n.skin;
    for (const k of ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers']) delete g[k];
  }
}, dst);
/** Drop what nothing references (bones stay: --keep-leaves), then quantize + meshopt. */
const finish = (src, out) => {
  gt(`prune "${src}" "${src}" --keep-leaves`);
  gt(`meshopt "${src}" "${path.join(OUT, out)}"`);
};

fs.mkdirSync(OUT, { recursive: true });

// --- animals: one file each, with their clips
for (const [out, file] of Object.entries(ANIMALS)) {
  trim(find(new RegExp(`[\\\\/]${file}$`)), tmp(file), { clips: ANIMAL_CLIPS });
  finish(tmp(file), `${out}.glb`);
}

/** shrinks a file's textures to 512 px WebP */
const texture = (f) => {
  gt(`resize "${f}" "${f}" --width 512 --height 512`);
  gt(`webp "${f}" "${f}"`);
};

// --- creatures: a file each, their clips renamed to the roles' names, textures shrunk
for (const [out, { file, clips }] of Object.entries(CREATURES)) {
  const f = tmp(`creature_${out}.glb`);
  trim(find(new RegExp(`[\\\\/]${file.replace('.', '\\.')}$`)), f, { name: out, clips });
  editGlb(f, (g) => {
    // only the colour map: normal, specular and occlusion maps are not used by the game's materials
    for (const m of g.materials ?? []) {
      for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete m[k];
      if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  });
  gt(`prune "${f}" "${f}" --keep-leaves`);
  if ((JSON.parse(fs.readFileSync(f).subarray(20, 20 + fs.readFileSync(f).readUInt32LE(12))).images ?? []).length) texture(f);
  finish(f, `${out}.glb`);
}

// --- skeletons: a file each (merged into one, three.js would rename the repeated bones hips_1, hips_2...)
const glbOf = (name) => {
  let src = find(new RegExp(`[\\\\/]${name}\\.(glb|gltf)$`));
  if (src.endsWith('.gltf')) gt(`copy "${src}" "${(src = tmp(`${name}.src.glb`))}"`);
  trim(src, tmp(`${name}.glb`), { name });
  return tmp(`${name}.glb`);
};
for (const name of SKELETONS) {
  const f = glbOf(name);
  texture(f);
  finish(f, `${name.toLowerCase()}.glb`);
}
// their weapons: one file, a scene per weapon named after it (no bones to clash)
const weapons = tmp('skeleton_weapons.glb');
gt(`merge ${WEAPONS.map((n) => `"${glbOf(n)}"`).join(' ')} "${weapons}"`);
gt(`dedup "${weapons}" "${weapons}"`);
texture(weapons);
finish(weapons, 'skeleton_weapons.glb');

// --- the skeletons' clips, without the preview mannequin each animation file carries,
// all retargeted onto the first file's armature (same bone names) so there is one set of bones
const clipFiles = Object.entries(SKELETON_CLIPS).map(([set, clips]) => {
  const f = tmp(`clips_${set}.glb`);
  trim(find(new RegExp(`Rig_Medium[\\\\/]Rig_Medium_${set}\\.glb$`)), f, { clips, clipsOnly: true });
  return `"${f}"`;
});
const anims = tmp('skeleton_anims.glb');
gt(`merge ${clipFiles.join(' ')} "${anims}"`);
editGlb(anims, (g) => {
  const first = new Map();
  const mark = (i) => {
    if (!first.has(g.nodes[i].name)) first.set(g.nodes[i].name, i);
    for (const c of g.nodes[i].children ?? []) mark(c);
  };
  for (const n of g.scenes[0].nodes) mark(n);
  for (const a of g.animations) for (const c of a.channels) c.target.node = first.get(g.nodes[c.target.node].name);
  g.scenes = [g.scenes[0]];
  g.scene = 0;
});
finish(anims, 'skeleton_anims.glb');

fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), `Mob models, CC0 1.0 (public domain) unless noted: https://creativecommons.org/publicdomain/zero/1.0/
wolf.glb, fox.glb, stag.glb, horse.glb, donkey.glb, alpaca.glb, bull.glb, cow.glb: Ultimate Animated Animal Pack by Quaternius (quaternius.com), via poly.pizza
skeleton_*.glb: KayKit Character Pack: Skeletons 1.1 by Kay Lousberg (kaylousberg.com)
skeleton_anims.glb: KayKit Character Animations 1.1 by Kay Lousberg (kaylousberg.com)
spider.glb, wyvern.glb: Spider and Dragon by Quaternius (quaternius.com), via poly.pizza
drake.glb: Cethiel's Dragon 3D by Drummyfish, after Cethiel's 2D dragon (opengameart.org/content/cethiels-dragon-3d)
crab.glb: Crab low poly animated 3D model by methodical pixel (opengameart.org/content/crab-low-poly-animated-3d-model)
limule.glb: Swamp Limule by Čestmír Dammer (CDmir) (opengameart.org/content/swamp-limule)
golem.glb: Lava golem by gavlig (opengameart.org/content/lava-golem)
raptor.glb: Velociraptor, Animated LowPoly Dinosaurs by Quaternius (quaternius.itch.io/animated-lowpoly-dinosaurs)
werewolf.glb: Werewolf by br-n518 (opengameart.org/content/werewolf-0)
forest.glb: Forest Monster by Čestmír Dammer (CDmir) (opengameart.org/content/forest-monster); its body only, without
  the tree on its back (that one used a CC BY-NC-SA texture)

Not CC0 - Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/):
cobra.glb: "Cobra" by Poly by Google (poly.pizza/m/40_5Xq467-U)

Regenerate with tools/scripts/m-assets.mjs.
`);
fs.rmSync(TMP, { recursive: true, force: true });
for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(24), fs.statSync(path.join(OUT, f)).size);
