import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MOBS } from '../../../shared/src/data/mobs';
import { animate, heldWeapon, mobModel, type AnimState, type Rig, type WeaponKind } from './models';
import { loadQ, qPlayer, qReady, qWeapon, type Helm } from './quaternius';
import { kitTexture, loadV } from './village';

/**
 * Mob models instead of the procedural box rigs (models.ts mobModel), all CC0:
 * - humanoids (orcs, goblins, cultists, zombies, the drowned) dressed from the same Quaternius kit as players and NPCs (client/public/q);
 * - wolves and keltirs (Quaternius animals) and skeletons (KayKit) from client/public/m (tools/scripts/m-assets.mjs), with their own clips.
 * Mobs with no model here, or while their files haven't loaded, keep the procedural rig.
 */
interface MobLook {
  g?: 'm' | 'f';
  skin: number;
  hair?: number;
  /** HAIR_STYLES index (3 is shaved) */
  hs?: number;
  beard?: boolean;
  /** outfit kit and dye: chest and arms, then legs and feet (the mob's own colour by default) */
  ranger?: boolean;
  top?: number;
  bottom?: number;
  hood?: number;
  helm?: Helm;
  pauldron?: boolean;
  /** a weapon item with its own model, or a procedural kind with a colour (bows have no model) */
  weapon?: string | [WeaponKind, number];
  /** race features */
  ears?: 'elf_ears' | 'orc_ears';
  tusks?: boolean;
  head?: number;
  brawn?: number;
  bulk?: number;
}

const ORC = 0x5a7340, ORC_DARK = 0x4a5e34, GOBLIN = 0x6f8a3a, ROT = 0x7d8a68, DROWNED = 0x7a9294;
const orc = (o: Partial<MobLook>): MobLook => ({ skin: ORC, hair: 0x1e1e1a, hs: 3, ears: 'orc_ears', tusks: true, brawn: 1.14, bulk: 1.15, ...o });
const goblin = (o: Partial<MobLook>): MobLook => ({ skin: GOBLIN, hair: 0x2a2a1a, hs: 3, ears: 'elf_ears', head: 1.3, bulk: 1.1, ...o });

export const MOB_LOOK: Record<string, MobLook> = {
  // goblins: small, big-headed, pointed ears
  gremlin: goblin({ top: 0x6a4a2a, bottom: 0x4a3a2a, weapon: 'iron_hammer' }),
  goblin_scout: goblin({ ranger: true, top: 0x3a4a2a, bottom: 0x3a3a2a, hood: 0x3a4a2a, weapon: 'dagger' }),
  gremlin_chief: goblin({ skin: 0x5f7e2a, ranger: true, top: 0x8a2a20, bottom: 0x4a3a2a, pauldron: true, weapon: 'hand_axe' }),
  // orc camps
  goblin_brute: orc({ skin: 0x55703a, top: 0x5a4030, bottom: 0x3a2a20, weapon: 'iron_hammer', brawn: 1.2 }),
  goblin_chieftain: orc({ skin: ORC_DARK, ranger: true, top: 0x4a5a2a, bottom: 0x3a2a20, helm: 'HelmD', pauldron: true, weapon: 'battle_axe' }),
  orc_warrior: orc({ ranger: true, top: 0x5a4030, bottom: 0x3a2a20, helm: 'HelmD', weapon: 'battle_axe' }),
  orc_archer: orc({ ranger: true, top: 0x5a5a30, bottom: 0x3a3020, hood: 0x6a3a20, weapon: ['bow', 0x6a4a2a] }),
  orc_shaman: orc({ top: 0x6a2a5a, bottom: 0x3a2030, hs: 4, beard: true, weapon: 'staff_of_life' }),
  orc_captain: orc({ skin: ORC_DARK, ranger: true, top: 0x6a2020, bottom: 0x2a2020, helm: 'HelmC', pauldron: true, weapon: 'broadsword', brawn: 1.2 }),
  orc_warlord: orc({ skin: ORC_DARK, ranger: true, top: 0x4a2a1a, bottom: 0x2a1a14, helm: 'HelmC', pauldron: true, weapon: 'war_hammer', brawn: 1.22 }),
  gruhash: orc({ skin: 0x4a5a30, ranger: true, top: 0x6a1414, bottom: 0x2a1a14, helm: 'HelmC', pauldron: true, weapon: 'battle_axe', brawn: 1.25 }),
  gruhash_guard: orc({ ranger: true, top: 0x7a2a1a, bottom: 0x3a2a20, helm: 'HelmD', pauldron: true, weapon: 'partisan' }),
  // the steppes and the citadel
  steppe_raider: orc({ skin: 0x627a40, ranger: true, top: 0x8a5a2a, bottom: 0x4a3a2a, hood: 0x7a4a24, weapon: 'hand_axe' }),
  steppe_shaman: orc({ skin: 0x627a40, top: 0xa8402a, bottom: 0x4a2a1a, hs: 1, beard: true, weapon: 'willow_staff' }),
  citadel_guard: orc({ skin: ORC_DARK, ranger: true, top: 0x4a5a3a, bottom: 0x2a2a24, helm: 'HelmD', pauldron: true, weapon: 'spear' }),
  citadel_archer: orc({ skin: ORC_DARK, ranger: true, top: 0x6a6a3a, bottom: 0x2a2a24, helm: 'HelmD', weapon: ['bow', 0x4a3a2a] }),
  citadel_warlock: orc({ skin: ORC_DARK, top: 0x5a1a5a, bottom: 0x2a142a, hood: 0x3a1040, weapon: 'sages_staff' }),
  citadel_champion: orc({ skin: ORC_DARK, ranger: true, top: 0x8a1a1a, bottom: 0x2a1a1a, helm: 'HelmC', pauldron: true, weapon: 'samurai_longsword', brawn: 1.22 }),
  // cultists: robed humans under hoods
  abyssal_cultist: { skin: 0xb8a8b0, hair: 0x1a1a1a, hs: 0, top: 0x3a2a6a, bottom: 0x2a1a40, hood: 0x2a1a4a, weapon: 'apprentice_wand' },
  dragon_cultist: { skin: 0xc8a080, hair: 0x2a1a1a, hs: 0, top: 0x7a2020, bottom: 0x3a1414, hood: 0x5a1414, weapon: 'staff_of_life' },
  dragonkin: { skin: 0x3a6a5a, hs: 3, ears: 'elf_ears', head: 1.1, brawn: 1.2, bulk: 1.15, ranger: true, top: 0x3a4a44, bottom: 0x2a3430, helm: 'HelmD', pauldron: true, weapon: 'partisan' },
  // the walking dead
  zombie: { skin: ROT, hair: 0x2a2a20, hs: 1, top: 0x4a4a3a, bottom: 0x3a3428 },
  drowned_sailor: { skin: DROWNED, hair: 0x2a3a3a, hs: 1, beard: true, top: 0x5a7a80, bottom: 0x3a4a50, weapon: 'dagger' },
  drowned_corsair: { skin: 0x6a8490, hair: 0x1a2a2a, hs: 0, beard: true, ranger: true, top: 0x2a4a6a, bottom: 0x2a3440, hood: 0x6a1a1a, pauldron: true, weapon: 'samurai_longsword' },
  // the frost region: tundra folk in furs, ice-blue orcs, and the giants of the peaks
  tundra_raider: { skin: 0xd8b090, hair: 0xb89060, hs: 1, beard: true, ranger: true, top: 0x8a6a4a, bottom: 0x4a3a2a, hood: 0xd8d0c0, weapon: 'spear' },
  tundra_jarl: { skin: 0xd0a080, hair: 0xc89050, hs: 1, beard: true, ranger: true, top: 0x6a4a3a, bottom: 0x3a2a20, helm: 'HelmD', pauldron: true, weapon: 'battle_axe', brawn: 1.2, bulk: 1.15 },
  ice_shaman: orc({ skin: 0x6a8aa0, top: 0x3a5a8a, bottom: 0x2a3a5a, hs: 4, beard: true, weapon: 'staff_of_life' }),
  frost_giant: orc({ skin: 0x8aa8c8, hair: 0xe8eef4, hs: 1, beard: true, ears: undefined, tusks: false, ranger: true, top: 0x5a6a7a, bottom: 0x3a4a5a, pauldron: true, weapon: 'war_hammer', brawn: 1.3, bulk: 1.25 }),
  hrimgar: { skin: 0x7a9ac0, hair: 0xe8f0f8, hs: 1, beard: true, ranger: true, top: 0x7aa0c8, bottom: 0x4a5a78, helm: 'HelmC', pauldron: true, weapon: 'samurai_longsword', brawn: 1.3, bulk: 1.3 },
};

/** ?proc: every mob as its old procedural rig (to compare looks and cost) */
const PROC_ONLY = typeof location !== 'undefined' && new URLSearchParams(location.search).has('proc');

/** This mob's model, or null when it has none or its files haven't loaded (the procedural rig then). */
export function realMob(tplId: string): Rig | null {
  if (PROC_ONLY) return null;
  return glbMob(tplId) ?? qMob(tplId);
}

function qMob(tplId: string): Rig | null {
  const l = MOB_LOOK[tplId], t = MOBS[tplId];
  if (!l || !t || !qReady()) return null;
  const top = { ranger: !!l.ranger, dye: l.top ?? t.color }, bottom = { ranger: !!l.ranger, dye: l.bottom ?? l.top ?? t.color };
  const w = l.weapon;
  const inHand: THREE.Object3D | null = !w ? null : typeof w === 'string' ? qWeapon(w) : heldWeapon(w[0], w[1]);
  const closed = l.helm === 'HelmC';
  return qPlayer({
    g: l.g ?? 'm', skin: l.skin, hair: l.hair ?? 0x2a2a2a, hairStyle: l.hs ?? 0, beard: l.beard,
    chest: top, legs: bottom, feet: bottom, hood: l.hood, pauldron: l.pauldron, helm: l.helm, hideHair: !!l.helm,
    scale: t.scale * 1.08, bulk: l.bulk ?? 1, brawn: l.brawn, head: l.head,
    ...(!closed && { ears: l.ears, tusks: l.tusks }),
    inHand,
  });
}

// --- models with their own skeleton and clips (client/public/m)

/** creatures: one file each, clips named by role in tools/scripts/m-assets.mjs (CREATURES) */
const CREATURES = ['spider', 'wyvern', 'cobra', 'drake', 'crab', 'limule', 'golem', 'raptor', 'werewolf', 'forest'] as const;
type Model = 'wolf' | 'fox' | 'skeleton_warrior' | 'skeleton_minion' | 'skeleton_rogue' | 'skeleton_mage' | (typeof CREATURES)[number];
type Role = 'idle' | 'run' | 'attack' | 'death' | 'cast';
type ClipSet = Partial<Record<Role, string>>;
const ANIMAL: ClipSet = { idle: 'Idle', run: 'Gallop', attack: 'Attack', death: 'Death' };
const CREATURE: ClipSet = { idle: 'Idle', run: 'Walk', attack: 'Attack', death: 'Death' };
const BONES: ClipSet = { idle: 'Skeletons_Idle', run: 'Running_A', attack: 'Melee_1H_Attack_Chop', death: 'Skeletons_Death', cast: 'Ranged_Magic_Spellcasting' };
const SKELETONS = ['skeleton_warrior', 'skeleton_minion', 'skeleton_rogue', 'skeleton_mage'] as const;

interface GlbLook {
  model: Model;
  /** height at mob scale 1 */
  height: number;
  /** material name -> colour: replaces a flat colour, multiplies a texture */
  tint?: Record<string, number>;
  /** KayKit weapons for the hand slots (bones handslot.r / .l, which three.js names handslotr / handslotl) */
  right?: string;
  left?: string;
  clips?: ClipSet;
  /** multiplies every material (a light tint keeps a texture readable) */
  dye?: number;
  /** a glow of this colour on every material */
  glow?: number;
  /** a translucent, glowing spirit (the wraith) */
  ghost?: boolean;
  /** a static model that undulates along its length (the sea serpent) */
  wave?: boolean;
  /** painted with the village kit's rock (repeat count), instead of its own texture: the golems */
  rock?: number;
  /** its texture greyed and brightened by this much before the tint and dye: a white yeti from the dark werewolf */
  pale?: number;
  kind?: Rig['kind'];
}

export const MOB_GLB: Record<string, GlbLook> = {
  keltir: { model: 'fox', height: 1.15 },
  elder_keltir: { model: 'fox', height: 1.15, tint: { Main: 0x9a6a3a } },
  young_wolf: { model: 'wolf', height: 1.3, tint: { Main: 0x9a9a9a } },
  wolf: { model: 'wolf', height: 1.3 },
  ash_hound: { model: 'wolf', height: 1.3, tint: { Main: 0x5a4a44, Main_Light: 0x8a6a5a } },
  war_wolf: { model: 'wolf', height: 1.3, tint: { Main: 0x3a3a3c, Main_Light: 0x6a6a6a } },
  skeleton: { model: 'skeleton_warrior', height: 1.9, right: 'Skeleton_Blade', left: 'Skeleton_Shield_Small_A' },
  bone_servant: { model: 'skeleton_minion', height: 1.9, right: 'Skeleton_Axe' },
  reborn_servant: { model: 'skeleton_rogue', height: 1.9, right: 'Skeleton_Blade', tint: { skeleton: 0xe8c8d4 } },
  crypt_knight: { model: 'skeleton_warrior', height: 1.9, right: 'Skeleton_Axe', left: 'Skeleton_Shield_Large_A', tint: { skeleton: 0xd8d0c8 } },
  kaim_vanul: { model: 'skeleton_mage', height: 1.9, right: 'Skeleton_Staff', tint: { skeleton: 0x9a88b8, Glow: 0xb050ff } },
  kaim_ascended: { model: 'skeleton_mage', height: 1.9, right: 'Skeleton_Staff', tint: { skeleton: 0x8a78b0, Glow: 0xc060ff } },
  kaim_reborn: { model: 'skeleton_mage', height: 1.9, right: 'Skeleton_Staff', tint: { skeleton: 0xf0c8d8, Glow: 0xff4080 } },
  ruin_wraith: { model: 'skeleton_mage', height: 1.9, ghost: true, dye: 0xb8d8ff, glow: 0x4a7ab0, kind: 'humanoid' },
  // spiders, crabs and the deep lurker
  cave_spider: { model: 'spider', height: 0.9, dye: 0x9a8aa8, kind: 'spider' },
  ember_spider: { model: 'spider', height: 0.9, dye: 0xffa070, glow: 0x7a2200, kind: 'spider' },
  brood_spider: { model: 'spider', height: 0.9, dye: 0xa86a7a, kind: 'spider' },
  tide_crab: { model: 'crab', height: 0.75, kind: 'spider' },
  tide_spawn: { model: 'crab', height: 0.75, dye: 0xffc0c8, kind: 'spider' },
  coast_queen: { model: 'crab', height: 0.75, dye: 0xe8a8d0, kind: 'spider' },
  deep_lurker: { model: 'limule', height: 0.8, dye: 0xa0c0d0, kind: 'spider' },
  // beasts
  werewolf: { model: 'werewolf', height: 1.9, clips: { run: 'Run' } },
  hill_lizard: { model: 'raptor', height: 1.25, dye: 0xa8d0a8, clips: { run: 'Run' } },
  aberration: { model: 'forest', height: 2.1, dye: 0xd0a8d8 },
  sea_serpent: { model: 'cobra', height: 1.0, dye: 0x8ac0e0, wave: true },
  // drakes and dragons
  drake_whelp: { model: 'drake', height: 1.3, dye: 0xb0e0a8 },
  nest_hatchling: { model: 'drake', height: 1.3, dye: 0xffb898 },
  valley_basilisk: { model: 'drake', height: 1.4, dye: 0xd0d898 },
  elder_drake: { model: 'drake', height: 1.5, dye: 0x98c8a8 },
  ancient_drake: { model: 'drake', height: 1.55, dye: 0xd89090 },
  vharion: { model: 'drake', height: 1.6, dye: 0xc86058, glow: 0x2a0800 },
  wyvern: { model: 'wyvern', height: 1.8, dye: 0xffe0b8, clips: { idle: 'Fly', run: 'Fly' } },
  // golems: the lava golem, dyed per kind
  stone_golem: { model: 'golem', height: 2.3, rock: 4, dye: 0xd8d4d0, kind: 'humanoid' },
  reef_golem: { model: 'golem', height: 2.3, rock: 4, dye: 0xa8dcc8, kind: 'humanoid' },
  ruin_sentinel: { model: 'golem', height: 2.3, rock: 4, dye: 0xd0d8d8, kind: 'humanoid' },
  magma_golem: { model: 'golem', height: 2.3, rock: 4, dye: 0xffa888, glow: 0x5a1400, kind: 'humanoid' },
  obsidian_golem: { model: 'golem', height: 2.3, rock: 4, dye: 0x6e6e80, kind: 'humanoid' },
  nest_guardian: { model: 'golem', height: 2.3, rock: 4, dye: 0xd0a888, kind: 'humanoid' },
  // the frost region
  frost_wolf: { model: 'wolf', height: 1.3, tint: { Main: 0xe8eef4, Main_Light: 0xffffff } },
  frost_wraith: { model: 'skeleton_mage', height: 1.9, ghost: true, dye: 0xd0f0ff, glow: 0x3a8ac8, kind: 'humanoid' },
  ice_golem: { model: 'golem', height: 2.3, rock: 4, dye: 0xc8ecff, glow: 0x14405a, kind: 'humanoid' },
  yeti: { model: 'werewolf', height: 1.9, clips: { run: 'Run' }, pale: 2.2, dye: 0xf0f6ff },
  yeti_cub: { model: 'werewolf', height: 1.9, clips: { run: 'Run' }, pale: 2.2, dye: 0xfaf6f0 },
  yeti_matriarch: { model: 'werewolf', height: 1.9, clips: { run: 'Run' }, pale: 2.2, dye: 0xfff4e8 },
  primal_yeti: { model: 'werewolf', height: 1.9, clips: { run: 'Run' }, pale: 2.4, dye: 0xe0f0ff, glow: 0x081828 },
  white_drake: { model: 'drake', height: 1.5, pale: 2, dye: 0xe8f4ff },
  frost_wyvern: { model: 'wyvern', height: 1.8, tint: { Main: 0x9ac0e0, Belly: 0xf0f4f8, Wings: 0x6a90b8 }, clips: { idle: 'Fly', run: 'Fly' } },
  frost_knight: { model: 'skeleton_warrior', height: 1.9, right: 'Skeleton_Blade', left: 'Skeleton_Shield_Large_A', pale: 1.7, tint: { skeleton: 0xa8d4ff, Glow: 0x60c0ff } },
  frost_guard: { model: 'skeleton_warrior', height: 1.9, right: 'Skeleton_Axe', left: 'Skeleton_Shield_Small_A', pale: 1.7, tint: { skeleton: 0xc0e0ff, Glow: 0x80d0ff } },
};

interface Loaded { scene: THREE.Object3D; height: number; base: number; clips: THREE.AnimationClip[] }
const loaded: Partial<Record<Model, Loaded>> = {};
const weapons: Record<string, THREE.Object3D> = {};
let loadingMobs: Promise<void> | null = null;

/** Loads client/public/m. Mobs spawned before it finishes keep their procedural rig. */
export function loadMobs(): Promise<void> {
  return (loadingMobs ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const get = (f: string) => loader.loadAsync(`m/${f}.glb`);
    const [wolf, fox, anims, kit, ...skels] = await Promise.all([get('wolf'), get('fox'), get('skeleton_anims'), get('skeleton_weapons'), ...SKELETONS.map(get)]);
    // creatures: a file that fails leaves its mobs procedural, not the rest
    const creatures = await Promise.all(CREATURES.map((c) => get(c).catch((err) => (console.warn('mob model', c, err), null))));
    const add = (m: Model, g: { scene: THREE.Object3D }, clips: THREE.AnimationClip[]) => {
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene);
      loaded[m] = { scene: g.scene, height: box.max.y - box.min.y, base: box.min.y, clips };
    };
    add('wolf', wolf, wolf.animations);
    add('fox', fox, fox.animations);
    SKELETONS.forEach((m, i) => add(m, skels[i], anims.animations));
    for (const s of kit.scenes) weapons[s.name] = s;
    CREATURES.forEach((c, i) => creatures[i] && add(c, creatures[i]!, creatures[i]!.animations));
  })());
}

/** Lambert like the rest of the world (the files carry PBR), one per source material and tint. */
const mats = new Map<string, THREE.Material>();
/** the sea serpent's sway (render time, seconds), shared by every wave material */
const WAVE_T = { value: 0 };
/** The kit's rock texture repeated n times over a model's own UVs (a copy: the walls keep theirs). */
const rocks = new Map<number, THREE.Texture>();
function rockMap(n: number): THREE.Texture | null {
  let t = rocks.get(n);
  if (!t) {
    const base = kitTexture('T_RockTrim_BaseColor.webp');
    if (!base) return null;
    t = base.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(n, n);
    t.needsUpdate = true;
    rocks.set(n, t);
  }
  return t;
}
function lambert(src: THREE.Material, tint: number | undefined, l?: GlbLook): THREE.Material {
  const key = `${src.uuid}:${tint ?? ''}:${l?.dye ?? ''}:${l?.glow ?? ''}:${l?.ghost ? 'g' : ''}:${l?.wave ? 'w' : ''}:${l?.rock ?? ''}:${l?.pale ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    const s = src as THREE.MeshStandardMaterial;
    const color = tint === undefined ? s.color.clone() : s.map ? s.color.clone().multiply(new THREE.Color(tint)) : new THREE.Color(tint);
    if (l?.dye !== undefined) color.multiply(new THREE.Color(l.dye));
    const glow = !!s.emissive && s.emissive.getHex() !== 0;
    const mat = new THREE.MeshLambertMaterial({
      name: s.name, map: (l?.rock && rockMap(l.rock)) || s.map, color,
      emissive: l?.glow ?? (glow ? (tint === undefined ? s.emissive.clone() : new THREE.Color(tint)) : 0x000000), emissiveMap: l?.glow ? null : s.emissiveMap,
    });
    if (l?.ghost) Object.assign(mat, { transparent: true, opacity: 0.55, depthWrite: false });
    if (l?.pale && mat.map) {
      // the texture's shading as grey, brightened (square root, so its dark fur still reads), then tinted
      const k = l.pale.toFixed(2);
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          #ifdef USE_MAP
            diffuseColor.rgb = diffuse * vec3(min(1.0, sqrt(dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114))) * ${k}));
          #endif`);
      };
      mat.customProgramCacheKey = () => `mob-pale-${k}`;
    }
    if (l?.wave) {
      // a travelling S along the body (local z), stronger toward the tail
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWaveT = WAVE_T;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWaveT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            transformed.x += sin(transformed.z * 6.0 - uWaveT * 3.0) * 0.06 * smoothstep(0.1, -0.4, transformed.z);
            transformed.y += sin(transformed.z * 4.0 - uWaveT * 2.2) * 0.02;`);
      };
      mat.customProgramCacheKey = () => 'mob-wave';
    }
    mats.set(key, (m = mat));
  }
  return m;
}

const ATK_MS = 700;
interface ClipAnim {
  mixer: THREE.AnimationMixer; acts: Partial<Record<Role, THREE.AnimationAction>>; w: Partial<Record<Role, number>>; t: number;
  /** the model's holder, for the moves a model has no clip for (lunge, keel over, hover) */
  body: THREE.Object3D;
  float: boolean;
  wave: boolean;
}

function glbMob(tplId: string): Rig | null {
  const l = MOB_GLB[tplId], t = MOBS[tplId], src = l && loaded[l.model];
  if (!l || !t || !src) return null;
  const obj = cloneSkinned(src.scene);
  const skinned: THREE.SkinnedMesh[] = [];
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material;
    o.material = lambert(m, l.tint?.[m.name], l);
    o.castShadow = true;
    o.frustumCulled = false; // bind-pose bounds; the game culls whole entities itself
    if (o instanceof THREE.SkinnedMesh) skinned.push(o);
  });
  for (const [slot, w] of [['handslotr', l.right], ['handslotl', l.left]] as const) {
    const hand = w && weapons[w] ? obj.getObjectByName(slot) : undefined;
    if (!hand) continue;
    const item = weapons[w!].clone();
    item.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = lambert(o.material as THREE.Material, undefined);
      o.castShadow = true;
    });
    hand.add(item);
  }
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(obj);
  const height = l.height * t.scale;
  obj.scale.multiplyScalar(height / src.height);
  obj.position.y = -src.base * (height / src.height); // feet on the ground whatever the model's origin

  const animal = !l.model.startsWith('skeleton');
  const creature = (CREATURES as readonly string[]).includes(l.model);
  const set = { ...(creature ? CREATURE : animal ? ANIMAL : BONES), ...l.clips };
  const mixer = new THREE.AnimationMixer(obj);
  const a: ClipAnim = { mixer, acts: {}, w: {}, t: Infinity, body, float: !!l.ghost, wave: !!l.wave };
  for (const role of Object.keys(set) as Role[]) {
    const clip = src.clips.find((c) => c.name === set[role]);
    if (!clip) continue;
    const act = (a.acts[role] = mixer.clipAction(clip));
    act.setEffectiveWeight((a.w[role] = role === 'idle' ? 1 : 0));
    if (role === 'attack' || role === 'death') act.timeScale = 0; // driven by the entity's clock
    act.play();
  }
  return {
    root, body, kind: l.kind ?? (animal ? 'beast' : 'humanoid'), legs: [], height, radius: (l.kind === 'humanoid' || !animal ? 0.4 : 0.55) * t.scale,
    anim: (s) => animateClips(a, s),
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(obj);
      for (const m of skinned) m.skeleton.dispose();
    },
  };
}

function animateClips(a: ClipAnim, s: AnimState) {
  const dt = Math.min(0.1, Math.max(0, s.t - a.t));
  a.t = s.t;
  /** a one-shot clip at ms into it, held on its last frame */
  const at = (act: THREE.AnimationAction, ms: number) => (act.time = Math.min(ms / 1000, act.getClip().duration - 0.02));
  let cur: Role = 'idle';
  if (s.deadAge >= 0 && a.acts.death) {
    cur = 'death';
    at(a.acts.death, s.deadAge);
  } else if (s.casting && a.acts.cast) cur = 'cast';
  else if (s.atkAge < ATK_MS && a.acts.attack) {
    cur = 'attack';
    at(a.acts.attack, (s.atkAge / ATK_MS) * a.acts.attack.getClip().duration * 1000);
  } else if (s.moving && a.acts.run) cur = 'run';
  // moves a model has no clip for, on its holder: a lunge, keeling over, hovering, a bob while walking
  const b = a.body;
  b.position.set(0, 0, 0);
  b.rotation.set(0, 0, 0);
  if (s.deadAge >= 0 && !a.acts.death) {
    const k = Math.min(1, s.deadAge / 500);
    b.rotation.z = k * Math.PI * 0.5;
    b.position.y = -k * 0.15;
  } else if (s.atkAge < ATK_MS && !a.acts.attack) b.position.z = Math.sin((s.atkAge / ATK_MS) * Math.PI) * 0.45;
  else if (s.moving && !a.acts.run) b.position.y = Math.abs(Math.sin(s.t * 9)) * 0.06;
  if (a.float && s.deadAge < 0) b.position.y += 0.35 + Math.sin(s.t * 1.6) * 0.12;
  if (a.wave) WAVE_T.value = s.t;
  // weights snap to 0/1 at the ends, as in animateQ: the mixer skips clips at zero weight
  const k = Math.min(1, dt * 14);
  for (const r of Object.keys(a.acts) as Role[]) {
    let w = a.w[r]! + ((r === cur ? 1 : 0) - a.w[r]!) * k;
    if (w < 0.003) w = 0;
    else if (w > 0.997) w = 1;
    a.acts[r]!.setEffectiveWeight((a.w[r] = w));
  }
  a.mixer.update(dt);
}

/**
 * Dev gallery (?mobs=1): every mob in a grid with its name, and the animation states. No server needed.
 * ?only=<shape, id,id,... or 'real'> narrows it down, ?zoom / ?pitch (degrees) / ?still / ?ry frame it for screenshots.
 */
export async function mountMobPreview(host: HTMLElement): Promise<() => void> {
  host.innerHTML = '';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10;display:flex;gap:6px;flex-wrap:wrap';
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;font:12px sans-serif;color:#dfe9f5';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x1a2230);
  renderer.domElement.style.cssText = 'position:fixed;inset:0';
  host.append(renderer.domElement, labels, bar);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 2));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  await Promise.all([loadQ(), loadV().catch(() => {}), loadMobs().catch((err) => console.warn('mobs', err))]);

  const p = new URLSearchParams(location.search);
  const only = p.get('only')?.split(',');
  const ids = Object.values(MOBS)
    .filter((t) => !only || only.includes(t.id) || only.includes(t.shape) || (only.includes('real') && (MOB_LOOK[t.id] || MOB_GLB[t.id])))
    .sort((a, b) => a.shape.localeCompare(b.shape) || a.level - b.level)
    .map((t) => t.id);
  const cols = Math.ceil(Math.sqrt(ids.length * 1.8)), rows = Math.ceil(ids.length / cols), gap = 3.2;
  const rigs = ids.map((id, i) => {
    const rig = mobModel(id);
    rig.root.position.set((i % cols - (cols - 1) / 2) * gap, 0, (Math.floor(i / cols) - (rows - 1) / 2) * gap);
    scene.add(rig.root);
    const tag = document.createElement('div');
    tag.textContent = `${MOBS[id].name}${MOB_LOOK[id] || MOB_GLB[id] ? '' : ' ·'}`;
    tag.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;text-shadow:0 1px 2px #000';
    labels.append(tag);
    return { rig, tag };
  });

  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const zoom = Number(p.get('zoom')) || 1;
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    const d = (Math.max(cols * gap / cam.aspect, rows * gap) * 1.9 + 4) / zoom;
    const pitch = ((Number(p.get('pitch')) || 45) * Math.PI) / 180;
    cam.position.set(0, d * Math.sin(pitch), d * Math.cos(pitch));
    cam.lookAt(0, 0.8, 0);
    cam.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const STATES: Record<string, { moving?: boolean; casting?: boolean }> = { Idle: {}, Correr: { moving: true }, Atacar: {}, Castear: { casting: true }, Morir: {} };
  let state = p.get('state') ?? 'Idle', since = performance.now();
  const spin = !p.has('still'), ry = Number(p.get('ry')) || 0;
  for (const name in STATES) {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid #445;background:#16202e;color:#dfe9f5;cursor:pointer';
    b.onclick = () => { state = name; since = performance.now(); };
    bar.appendChild(b);
  }
  const v = new THREE.Vector3();
  const frame = (now: number, draw = true) => {
    const age = now - since;
    rigs.forEach(({ rig, tag }, i) => {
      rig.root.rotation.y = spin ? now / 2500 : ry;
      animate(rig, {
        moving: false, casting: false, t: now / 1000 + i,
        atkAge: state === 'Atacar' ? age % 1100 : Infinity, deadAge: state === 'Morir' ? age : -1, ...STATES[state],
      });
      v.set(0, rig.height + 0.25, 0).applyMatrix4(rig.root.matrixWorld).project(cam);
      tag.style.left = `${(v.x + 1) * 50}%`;
      tag.style.top = `${(1 - v.y) * 50}%`;
    });
    if (draw) renderer.render(scene, cam);
  };
  /** galleryBench(n, draw): CPU ms per frame (animation, plus draw calls unless draw is false) over n frames; compare with ?proc */
  (window as unknown as { galleryBench: (n: number, draw?: boolean) => number }).galleryBench = (n, draw = true) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) frame(t0 + i * 16.7, draw);
    return (performance.now() - t0) / n;
  };
  renderer.setAnimationLoop((now) => frame(now));
  return () => {
    removeEventListener('resize', resize);
    renderer.setAnimationLoop(null);
    renderer.dispose();
    host.innerHTML = '';
  };
}
