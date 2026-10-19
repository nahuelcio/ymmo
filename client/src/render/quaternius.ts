import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { basis } from '../assets';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { animate, playerModel, type AnimState, type Rig } from './models';
import { contactPhases, crossed } from './footfalls';
import { HAIR_STYLES, RACES, type Gender, type Race } from '../../../shared/src/data/classes';

/**
 * Player characters built from the Quaternius modular kits (CC0): an outfit piece per
 * zone (torso, arms, legs, feet, hood, pauldron), a hairstyle and the Universal Animation
 * Library clips, under the head from heads.glb (art/blender/characters.py: the same base
 * body with elf/orc ears as shape keys and tusks). Every file shares the same 65 joints in
 * the same order, so all the pieces of a character hang from one armature.
 * Assets live in client/public/q (regenerate the kit pieces with scripts/q-assets.mjs).
 */

const SEX = { m: 'Male', f: 'Female' } as const;
const FILES = [
  ...(['m', 'f'] as const).flatMap((g) =>
    ['Peasant_Body', 'Peasant_Arms', 'Peasant_Legs', 'Peasant_Feet', 'Ranger_Arms', 'Ranger_Body', 'Ranger_Legs', 'Ranger_Head_Hood'].map((p) => `${SEX[g]}_${p}`)),
  'Male_Ranger_Feet_Boots', 'Female_Ranger_Feet', 'Male_Ranger_Acc_Pauldron', 'Female_Ranger_Acc_Pauldrons',
  'Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard',
];
/** By HAIR_STYLES index: null is a shaved head; the mohawk is a buzz cut plus a rigid crest (the `mohawk` prop). */
const HAIR = ['Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', null, 'Hair_Buzzed', 'Hair_Buzzed'];
const MOHAWK = 5;

interface Prim { geo: THREE.BufferGeometry; tex: THREE.Texture | null; kind: 'skin' | 'hair' | 'eyes' | 'cloth'; fam: number; bind: THREE.Matrix4; morphs?: Record<string, number> }
const prims = new Map<string, Prim[]>();
/**
 * Distinct sets of inverse bind matrices, relative to the root joint's: pieces of the same family
 * share a Skeleton. The root's own inverse goes in each piece's bind matrix, which is where the
 * per-file quantization transform ends up, so compression doesn't split the families. */
const families: THREE.Matrix4[][] = [];
const armature: Partial<Record<Gender, THREE.Object3D>> = {};
const tusks: Partial<Record<Gender, THREE.Mesh>> = {};
const clips: Record<string, THREE.AnimationClip> = {};
/** the moments (0..1) the feet land in Jog_Fwd_Loop, measured once it loads */
let jogSteps: number[] = [0, 0.5];
/**
 * Helmets modelled in Fiend directly in the head bone's space, at real size ([up, forward, scale] stay
 * for nudging): the head spans x ±0.09, y 0..0.21 and z -0.09..0.13 from that bone.
 */
const HELMS = { HelmC: [0, 0, 1], HelmD: [0, 0, 1], karmian_hat: [0, 0, 1], demons_circlet: [0, 0, 1] } as const;
/**
 * Armour sets modelled from code (tools/art/blender/gear.py), one file each with a node per piece: `helm`, modelled
 * round the head bone's pivot like the helmets above, and the body pieces (`chest`, `gloves`, `legs`, `feet`), modelled
 * on the male body in its bind pose with the joints and weights of the body under them, worn as skins.
 */
const GEAR_SETS = ['apprentice', 'abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const;
export type GearSet = (typeof GEAR_SETS)[number];
/** Each shield is a file of its own (q/gear/shield_<key>.glb, tools/art/blender/gear.py): its one node, 'shield', worn on the left forearm. */
const SHIELDS: Record<string, string> = {
  wooden_buckler: 'buckler', brigandine_shield: 'brigandine', full_plate_shield: 'plate', abyssal_shield: 'abyssal', ashforged_shield: 'ashforged',
  dragon_shield: 'dragon', glacial_shield: 'glacial', emerald_shield: 'emerald', infernal_shield: 'infernal',
};
type GearFile = GearSet | `shield_${string}` | `weapons_${string}` | MageFile;
/** A region set's mage gear, a file a set (q/gear/mage_<set>.glb): `robe`, `circlet`, `gloves` and `feet`. */
type MageFile = `mage_${string}`;
const gear: Partial<Record<GearFile, THREE.Object3D>> = {};
/** The male bind pose's inverse bone matrices, in `joints` order: the body pieces were modelled in it, so a woman's
 * bones carry them over onto her (and every race's scaling onto it). */
let restInv: THREE.Matrix4[] = [];
/** The cloth under a set's armour: the peasant kit dyed in it (the bulkier ranger kit would poke through). */
const UNDER: Partial<Record<GearSet, number>> = { dragon: 0x1e1517, abyssal: 0x0a0f18, ashforged: 0x1c1a19, glacial: 0x161d26, emerald: 0x121a16, infernal: 0x0d0d10 };
/** The items whose set has a model of their own for them (not every set has its body pieces yet). */
const SET_PIECE: Record<string, [GearSet, string]> = {
  apprentice_tunic: ['apprentice', 'chest'], apprentice_stockings: ['apprentice', 'legs'], short_gloves: ['apprentice', 'gloves'],
  leather_sandals: ['apprentice', 'feet'],
};
/** A set's model for an armour item, when there is one: the node to wear and the colour to dye the cloth under it. */
export function armorPiece(id: string): { node: THREE.Object3D; under: number } | undefined {
  const m = /^(abyssal|ashforged|dragon|glacial|emerald|infernal)_(plate|robe|gauntlets|gloves|greaves|boots|shoes)$/.exec(id);
  const [set, name] = m ? [m[1] as GearSet, { plate: 'chest', robe: 'robe', gauntlets: 'gloves', gloves: 'gloves', greaves: 'legs', boots: 'feet', shoes: 'feet' }[m[2]]!] : SET_PIECE[id] ?? [];
  // a mage's pieces (the robe, the cloth gloves, the shoes) come in a file of their own
  const file: GearFile | undefined = m && /^(robe|gloves|shoes)$/.test(m[2]) ? `mage_${m[1]}` : set;
  const node = file && wantGear(file)?.getObjectByName(name);
  return node ? { node, under: UNDER[set!] ?? 0x3a3530 } : undefined;
}
/**
 * A chest piece as a woman wears it. The sets' plates are fitted to the man's chest, and her bust, taken into his rest
 * pose, stands up to 3.5 cm further out, some 7 cm either side of the middle at the height of his chest: it would come
 * through. Her copy swells forward there (bridging the middle, as a cuirass would), the hollows of the plates and
 * everything on them moved alike, its normals turned to match. One copy per piece.
 */
const bustCopies = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function bustGeo(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = bustCopies.get(src);
  if (g) return g;
  g = src.clone();
  const swell = (x: number, y: number, z: number) => {
    const ax = Math.abs(x), across = ax < 0.068 ? 0.88 + 0.12 * (ax / 0.068) ** 2 : Math.exp(-(((ax - 0.068) / 0.035) ** 2));
    return 0.04 * across * Math.exp(-(((y - 1.34) / (y < 1.34 ? 0.085 : 0.04)) ** 2)) * THREE.MathUtils.smoothstep(z, -0.02, 0.04);
  };
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), n = new THREE.Vector3(), e = 0.002;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), h = swell(x, y, z);
    if (h < 1e-5) continue;
    pos.setZ(i, z + h);
    if (!nor) continue;
    const hx = (swell(x + e, y, z) - swell(x - e, y, z)) / (2 * e), hy = (swell(x, y + e, z) - swell(x, y - e, z)) / (2 * e);
    n.set(nor.getX(i) - hx * nor.getZ(i), nor.getY(i) - hy * nor.getZ(i), nor.getZ(i)).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  bustCopies.set(src, g);
  return g;
}
/** A shield's model, when it has one (a body piece like the rest of the armour, skinned to the left forearm). */
export function shieldPiece(id: string): THREE.Object3D | undefined {
  const key = SHIELDS[id];
  return (key && wantGear(`shield_${key}`)?.getObjectByName('shield')) || undefined;
}
/** A body piece's joints and weights (the _joints and _weights attributes, the joint names in its node's extras), as
 * a skin in our joint order. */
function toSkin(m: THREE.Mesh) {
  const g = m.geometry, j = g.getAttribute('_joints'), w = g.getAttribute('_weights');
  const names = (m.userData.joints ?? m.parent?.userData.joints) as string[] | undefined;
  if (!j || !w || !names) return;
  const map = names.map((n) => Math.max(0, joints.indexOf(n)));
  const idx = new Uint16Array(j.count * 4), wt = new Float32Array(j.count * 4);
  for (let i = 0; i < j.count; i++) {
    for (let k = 0; k < 4; k++) {
      idx[i * 4 + k] = map[Math.round(j.getComponent(i, k))] ?? 0;
      wt[i * 4 + k] = w.getComponent(i, k);
    }
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  g.deleteAttribute('_joints');
  g.deleteAttribute('_weights');
  m.userData.skinned = true;
}
export type Helm = keyof typeof HELMS | GearSet | MageFile;
/** Head items with a model: which one, whether it covers the hair and whether it closes over the face (no ears or tusks). */
export const HEADGEAR: Record<string, { model: Helm; hair?: boolean; closed?: boolean }> = {
  brigandine_helm: { model: 'HelmD' }, full_plate_helmet: { model: 'HelmC', closed: true },
  karmian_hat: { model: 'karmian_hat' }, demons_circlet: { model: 'demons_circlet', hair: true },
  // closed: covers the ears (an elf's or an orc's would poke through), the face too for some
  leather_cap: { model: 'apprentice', closed: true }, abyssal_helm: { model: 'abyssal', closed: true }, ashforged_helm: { model: 'ashforged', closed: true },
  dragon_helm: { model: 'dragon', closed: true }, glacial_helm: { model: 'glacial', closed: true }, emerald_helm: { model: 'emerald', closed: true },
  infernal_helm: { model: 'infernal', closed: true },
  // the mages' crowns sit over the hair, and leave the ears and the face as they are
  ...Object.fromEntries((['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const).map((s) => [`${s}_circlet`, { model: `mage_${s}` as Helm, hair: true }])),
};
/**
 * One model per weapon item, also from Fiend, built upright (+Y) with the grip at the origin. Staffs are
 * turned to stand upright in a hanging hand; everything else is laid along +Z like weaponMesh(), hammers and axes with the head turned to strike downwards.
 */
const WEAPONS = ['short_sword', 'broadsword', 'sword_of_revolution', 'samurai_longsword', 'apprentice_wand', 'willow_staff', 'staff_of_life', 'sages_staff', 'iron_hammer', 'war_hammer',
  'dagger', 'assassin_dagger', 'hand_axe', 'battle_axe', 'spear', 'partisan',
  // gathering tools, from the Fantasy Props MegaKit (tools/art/blender/tools_props.py)
  'woodcutter_axe', 'miner_pickaxe'];
const PROPS = [...Object.keys(HELMS), ...WEAPONS, 'mohawk'];
const props: Record<string, THREE.Object3D> = {};
let joints: string[] = [];
let ready = false;
let loading: Promise<void> | null = null;

export const qReady = () => ready;
/** The region sets' swords and staffs, a file a set (q/gear/weapons_<set>.glb, tools/art/blender/gear.py): nodes 'blade' and 'staff'. */
const SET_WEAPON = /^(abyssal|ashforged|dragon|glacial|emerald|infernal)_(blade|staff)$/;
/**
 * The item's own weapon model, if it has one (geometry and materials are shared between instances). A set's sword or
 * staff comes in with its file: until then there is none (the caller draws the plain one), and 'gear-loaded' redraws.
 */
export function qWeapon(item: string | null): THREE.Object3D | null {
  if (!item) return null;
  if (WEAPONS.includes(item)) return props[item].clone();
  const m = SET_WEAPON.exec(item);
  const node = m && wantGear(`weapons_${m[1]}`)?.getObjectByName(m[2]);
  if (!node) return null;
  const w = node.clone(), held = new THREE.Group();
  w.position.set(0, 0, 0);
  held.add(w);
  // built as the Fiend props are (upright, the grip at the origin), and held as they are
  if (m[2] === 'staff') {
    held.rotation.z = -Math.PI / 2;
    held.position.z = 0.05;
  } else held.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'ZYX'));
  return held;
}

/**
 * Typical colour of a texture, to recolour it relative to its own tone. Only the brighter
 * half counts: atlases pad with near-black, which would drag a plain average far below the skin.
 */
function avgColor(tex: THREE.Texture): THREE.Color {
  const N = 32, c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(tex.image as CanvasImageSource, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const lum = (i: number) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  let mean = 0;
  for (let i = 0; i < d.length; i += 4) mean += lum(i) / (N * N);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (lum(i) >= mean) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

/** The outfits cover the body: keep only the triangles of the base mesh that follow the head and neck. */
/** Keep only the triangles touching a vertex whose strongest joint `keep` accepts (or, with `all`, only those whose
 * every vertex it accepts). */
function trim(geo: THREE.BufferGeometry, keep: (joint: string) => boolean, all = false) {
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight'), idx = geo.index!;
  const ok = (v: number) => {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > bw) { bw = sw.getComponent(v, k); best = si.getComponent(v, k); }
    return keep(joints[best]);
  };
  const out: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    if (all ? ok(a) && ok(b) && ok(c) : ok(a) || ok(b) || ok(c)) out.push(a, b, c);
  }
  geo.setIndex(out);
}
const isHead = (j: string) => j === 'Head' || j === 'neck_01';
const headOnly = (geo: THREE.BufferGeometry) => trim(geo, isHead);
/** The bare body under a set's armour, in three parts (whichever the armour covers stands in for the cloth there):
 * the trunk and arms, the hips and legs, the feet; the head and neck are the head's. */
const SUIT: Record<'top' | 'legs' | 'feet', (j: string) => boolean> = {
  top: (j) => !isHead(j) && j !== 'pelvis' && !/^(thigh|calf|foot|ball)/.test(j),
  legs: (j) => /^(pelvis|thigh|calf)/.test(j),
  feet: (j) => /^(foot|ball)/.test(j),
};

let gearLoader: GLTFLoader | null = null;
const gearLoading = new Set<GearFile>();
/**
 * An armour set's file, fetched the first time a character wears something of it (a whole set's maps are tens of
 * megabytes on the GPU: only the sets on screen get loaded). Until it is in, the piece is left off; then a
 * 'gear-loaded' event (detail: the set) tells whoever drew a character without it to build it again.
 */
function wantGear(s: GearFile): THREE.Object3D | undefined {
  if (gear[s] || !gearLoader || gearLoading.has(s)) return gear[s];
  gearLoading.add(s);
  gearLoader.loadAsync(`q/gear/${s}.glb`).then((g) => {
    g.scene.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      // the baked look (colour and relief maps per piece); metal takes a highlight tinted by itself, tighter the more
      // polished, while paint, leather and the insides barely shine (what each is made of comes in the glTF extras)
      const src = m.material as THREE.MeshStandardMaterial;
      const { kind = '', rgb = 0xffffff, rough = 0.6 } = src.userData as { kind?: string; rgb?: number; rough?: number };
      const metal = ['steel', 'blued', 'black', 'iron', 'brass', 'gold', 'bronze', 'mail'].includes(kind);
      const specular = metal ? new THREE.Color(rgb).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(0.6)
        : new THREE.Color(kind === 'enamel' ? 0x383838 : 0x121212);
      const { color, map, normalMap, normalScale } = src;
      const mat = new THREE.MeshPhongMaterial({ color, map, normalMap, normalScale, specular, shininess: 6 + (1 - rough) ** 2 * 90 });
      if (src.userData.shine && map) {
        // one material for the whole piece: how much each part of it shines is in the colour map's alpha
        mat.specularMap = map;
        mat.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <specularmap_fragment>', 'float specularStrength = texture2D(specularMap, vSpecularMapUv).a;');
        };
        mat.customProgramCacheKey = () => 'gear-shine';
      }
      m.material = mat;
      m.castShadow = true;
      toSkin(m);
    });
    gear[s] = g.scene;
    dispatchEvent(new CustomEvent('gear-loaded', { detail: s }));
  }).catch((err) => console.warn('gear', s, err)); // a set that fails to load leaves its pieces off
  return undefined;
}

export function loadQ(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(basis());
    gearLoader = loader;
    const [[anims, ...gltfs], heads, rigid] = await Promise.all([
      Promise.all(['anims', ...FILES].map((f) => loader.loadAsync(`q/${f}.gltf`))),
      loader.loadAsync('q/heads.glb'),
      Promise.all(PROPS.map((f) => loader.loadAsync(`q/${f}.glb`))),
    ]);
    PROPS.forEach((name, i) => {
      const o = (props[name] = rigid[i].scene);
      o.children.forEach((c) => c.position.set(0, 0, 0));
      if (WEAPONS.includes(name)) {
        // a wand is too short for that: it would lie along the forearm, so it points forward out of the fist like a blade
        if (/staff/.test(name)) {
          // along the arm (the bind pose has the arms out sideways), so it stands upright by the leg when the arm hangs
          o.rotation.z = -Math.PI / 2;
          o.position.z = 0.05;
        } else o.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, /hammer|axe/.test(name) ? -Math.PI / 2 : 0, 'ZYX'));
      }
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const { color, emissive, emissiveIntensity, map } = m.material as THREE.MeshStandardMaterial;
        // no env map here: metal would render black; the kit tools keep their texture (the hand-made props have none)
        m.material = new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity, map, side: THREE.DoubleSide });
        m.castShadow = true;
      });
    });
    for (const clip of anims.animations) clips[clip.name] = clip;
    const famKeys = new Map<string, number>();
    const sources = new Map<string, THREE.Texture['source']>(); // every file loads its own copy of the shared .webp: keep one on the GPU
    const collect = (key: string, meshes: THREE.SkinnedMesh[], head = false) =>
      prims.set(key, meshes.map((m) => {
        const mat = m.material as THREE.MeshStandardMaterial;
        const kind = /Regular|^skin/.test(mat.name) ? 'skin' : /hair/i.test(mat.name) ? 'hair' : /eye/i.test(mat.name) ? 'eyes' : 'cloth';
        const inv = m.skeleton.boneInverses, bind = inv[0].clone(), root = bind.clone().invert();
        const rel = inv.map((b) => b.clone().multiply(root));
        const fkey = rel.map((b) => b.elements.map((e) => e.toFixed(3)).join()).join();
        let fam = famKeys.get(fkey);
        if (fam === undefined) famKeys.set(fkey, (fam = families.push(rel) - 1));
        if (mat.map?.name.endsWith('.webp')) {
          const shared = sources.get(mat.map.name);
          if (shared) mat.map.source = shared;
          else sources.set(mat.map.name, mat.map.source);
        }
        if (head && kind === 'skin') headOnly(m.geometry);
        // KTX2 maps carry it precomputed (tools/scripts/ktx2.mjs, as [r, g, b]): their pixels cannot be drawn on a canvas
        const avg = mat.map?.userData.avg as THREE.Color | number[] | undefined;
        if (mat.map && !(avg instanceof THREE.Color)) mat.map.userData.avg = avg ? new THREE.Color().setRGB(avg[0], avg[1], avg[2], THREE.SRGBColorSpace) : avgColor(mat.map);
        return { geo: m.geometry, tex: mat.map, kind, fam, bind, morphs: m.morphTargetDictionary };
      }));
    FILES.forEach((file, i) => {
      const meshes: THREE.SkinnedMesh[] = [];
      gltfs[i].scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
      });
      if (!joints.length) joints = meshes[0].skeleton.bones.map((b) => b.name);
      collect(file, meshes);
      if (file.endsWith('Peasant_Body')) {
        for (const m of meshes) m.removeFromParent();
        armature[file.startsWith('Female') ? 'f' : 'm'] = gltfs[i].scene; // what is left is the bone hierarchy
      }
    });
    armature.m!.updateMatrixWorld(true);
    restInv = joints.map((n) => armature.m!.getObjectByName(n)!.matrixWorld.clone().invert());
    // heads.glb names everything `<m|f>__part`; its skeletons are the same 65 joints, so the pieces bind to ours
    for (const g of ['m', 'f'] as const) {
      const get = (n: string) => heads.scene.getObjectByName(`${g}__${n}`) as THREE.SkinnedMesh;
      for (const part of ['top', 'legs', 'feet'] as const) {
        const b = get('body'), m = new THREE.SkinnedMesh(b.geometry.clone(), b.material);
        m.bind(b.skeleton, b.bindMatrix);
        trim(m.geometry, SUIT[part], true);
        collect(`Suit_${part}_${g}`, [m]);
      }
      collect(`Head_${g}`, [get('body'), get('eyes'), get('brows')], true);
      const t = (tusks[g] = get('tusks'));
      t.material = new THREE.MeshLambertMaterial({ color: 0xf0ecd8 });
    }
    // when the feet land in the jog, for the footsteps (render/footfalls.ts), measured on a spare copy of the bones
    const spare = armature.m!.clone(true);
    if (clips.Jog_Fwd_Loop) jogSteps = contactPhases(spare, clips.Jog_Fwd_Loop, ['foot_l', 'foot_r'].map((n) => spare.getObjectByName(n)!));
    ready = true;
  })());
}

/**
 * Set anisotropy on the character atlas textures to exactly `n` (raising or lowering: the setting
 * is user-configurable) — the GLTFs ship them at 1, so hair and cloth smear when seen at a grazing
 * angle. Textures are shared across every rig built from `prims`, so this is a handful of uploads.
 * Returns how many maps changed.
 */
export function setCharAniso(n: number): number {
  if (n <= 1) n = 1;
  let changed = 0;
  for (const list of prims.values()) {
    for (const p of list) {
      if (p.tex && p.tex.anisotropy !== n) {
        p.tex.anisotropy = n;
        p.tex.needsUpdate = true; // sampler state is read on upload
        changed++;
      }
    }
  }
  return changed;
}

const LUM = new THREE.Vector3(0.3, 0.59, 0.11);
const crestMats = new Map<number, THREE.MeshLambertMaterial>();
const matCache = new Map<string, THREE.MeshLambertMaterial>();
/**
 * skin: multiplied so the texture's average tone lands on the race colour (keeps lips, cheeks, shading).
 * dye (hair, cloth): each texel keeps its brightness but leans `k` of the way to the colour.
 */
function material(p: Prim, color: number | undefined, k: number, glow: boolean): THREE.MeshLambertMaterial {
  const key = `${p.tex?.uuid}|${p.kind}|${color}|${k}|${glow}`;
  let m = matCache.get(key);
  if (m) return m;
  matCache.set(key, (m = new THREE.MeshLambertMaterial({ map: p.tex })));
  if (glow) {
    m.emissive.set(0xe8c060);
    m.emissiveMap = p.tex;
    m.emissiveIntensity = 0.45;
  }
  if (color === undefined || !p.tex) return m;
  const avg = p.tex.userData.avg as THREE.Color, c = new THREE.Color(color);
  if (p.kind === 'skin') m.color.setRGB(c.r / avg.r, c.g / avg.g, c.b / avg.b);
  else {
    const gain = 1 / Math.max(0.05, new THREE.Vector3(avg.r, avg.g, avg.b).dot(LUM));
    m.onBeforeCompile = (s) => {
      s.uniforms.qDye = { value: new THREE.Vector4(c.r * gain, c.g * gain, c.b * gain, k) };
      s.fragmentShader = 'uniform vec4 qDye;\n' + s.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, qDye.rgb * dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), qDye.a);');
    };
    m.customProgramCacheKey = () => 'qdye';
  }
  return m;
}

/** One outfit zone: which kit it comes from, the dye of the item worn there and whether it glows (C grade). */
export interface QZone { ranger: boolean; dye?: number; glow?: boolean }
export interface QOpts {
  g: Gender; skin: number; hair: number; hairStyle: number; beard?: boolean;
  /** buzz cut instead of the chosen style */
  bald?: boolean;
  chest: QZone; legs: QZone; feet: QZone;
  /** glove colour: dyes the hands */
  gloves?: number;
  /** hood colour (hides the hair) */
  hood?: number;
  pauldron?: boolean;
  hideHair?: boolean;
  /** uniform scale and extra width (stocky races) */
  scale: number; bulk: number;
  /** upper-body scale: chest, arms and head grow, the legs do not (brutes) */
  brawn?: number;
  /** head scale, ear shape key and tusks of the race */
  head?: number; ears?: 'elf_ears' | 'orc_ears'; tusks?: boolean;
  helm?: Helm;
  /** body pieces of the armour sets (armorPiece), worn over the cloth */
  armor?: THREE.Object3D[];
  /** no boots: a set's own feet piece (greaves and sabatons) takes their place */
  bareFeet?: boolean;
  /** no cloth on the trunk and arms, or on the legs: a set's armour covers them, over the bare body dyed `suit` */
  noTop?: boolean; noLegs?: boolean; suit?: number;
  /** weapon built along +Z with the grip at the origin */
  inHand?: THREE.Object3D | null;
}

export interface QAnim {
  mixer: THREE.AnimationMixer; acts: Record<string, THREE.AnimationAction>; w: Record<string, number>; t: number; armed: boolean;
  /** knees and ankles with their straight rest pose, and how far a floor sit has straightened them (0..1) */
  legs: { bone: THREE.Object3D; rest: THREE.Quaternion }[];
  floor: number;
}

/** Hangs `o` from a bone keeping the orientation it was modelled in (bones have arbitrary axes). */
function attach(bone: THREE.Object3D, o: THREE.Object3D, x: number, y: number, z: number, scale: number) {
  const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  const anchor = new THREE.Group();
  anchor.quaternion.copy(q);
  anchor.position.set(x, y, z).applyQuaternion(q);
  anchor.scale.setScalar(scale);
  anchor.add(o);
  bone.add(anchor);
}

export function qPlayer(o: QOpts): Rig {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const arm = armature[o.g]!.clone(true);
  body.add(arm);
  const byName: Record<string, THREE.Object3D> = {};
  arm.traverse((b) => (byName[b.name] = b));
  const bones = joints.map((n) => byName[n] as THREE.Bone);
  const skeletons = new Map<number, THREE.Skeleton>();
  const add = (file: string, tint: (p: Prim) => [number | undefined, number, boolean]) => {
    for (const p of prims.get(file) ?? []) {
      let sk = skeletons.get(p.fam);
      if (!sk) skeletons.set(p.fam, (sk = new THREE.Skeleton(bones, families[p.fam])));
      const m = new THREE.SkinnedMesh(p.geo, material(p, ...tint(p)));
      m.userData.file = file;
      m.bind(sk, p.bind);
      if (o.ears && p.morphs?.[o.ears] !== undefined) m.morphTargetInfluences![p.morphs[o.ears]] = 1;
      m.castShadow = true;
      m.frustumCulled = false; // the bounding sphere is the bind pose's; the game culls whole entities itself
      body.add(m);
    }
  };
  const S = SEX[o.g];
  const zone = (z: QZone, hands?: number) => (p: Prim): [number | undefined, number, boolean] =>
    p.kind === 'skin' ? (hands !== undefined ? [new THREE.Color(hands).multiplyScalar(0.55).getHex(), 0, false] : [o.skin, 0, false]) : [z.dye, 0.85, !!z.glow];
  const kit = (z: QZone) => (z.ranger ? 'Ranger' : 'Peasant');
  add(`Head_${o.g}`, (p) => (p.kind === 'skin' ? [o.skin, 0, false] : p.kind === 'hair' ? [o.hair, 0.9, false] : [undefined, 0, false]));
  if (o.suit !== undefined) {
    const suit = (): [number, number, boolean] => [o.suit!, 0.9, false];
    if (o.noTop) add(`Suit_top_${o.g}`, suit);
    if (o.noLegs) add(`Suit_legs_${o.g}`, suit);
    if (o.bareFeet) add(`Suit_feet_${o.g}`, suit);
  }
  if (!o.noTop) {
    add(`${S}_${kit(o.chest)}_Body`, zone(o.chest));
    add(`${S}_${kit(o.chest)}_Arms`, zone(o.chest, o.gloves));
  }
  if (!o.noLegs) add(`${S}_${kit(o.legs)}_Legs`, zone(o.legs));
  if (!o.bareFeet) add(o.feet.ranger ? (o.g === 'm' ? 'Male_Ranger_Feet_Boots' : 'Female_Ranger_Feet') : `${S}_Peasant_Feet`, zone(o.feet));
  if (o.pauldron) add(o.g === 'm' ? 'Male_Ranger_Acc_Pauldron' : 'Female_Ranger_Acc_Pauldrons', zone(o.chest));
  const hair = (p: Prim): [number, number, boolean] => [o.hair, 0.9, false];
  if (o.hood !== undefined) add(`${S}_Ranger_Head_Hood`, zone({ ranger: true, dye: o.hood }));
  else if (!o.hideHair && (o.bald || HAIR[o.hairStyle])) add(o.bald ? 'Hair_Buzzed' : HAIR[o.hairStyle]!, hair);
  if (o.beard) add('Hair_Beard', hair);
  if (o.armor?.length) {
    const sk = new THREE.Skeleton(bones, restInv);
    skeletons.set(-1, sk);
    for (const node of o.armor) {
      const bust = o.g === 'f' && (node.name === 'chest' || node.name === 'robe');
      node.traverse((x) => {
        if (!(x instanceof THREE.Mesh) || !x.userData.skinned) return;
        const m = new THREE.SkinnedMesh(bust ? bustGeo(x.geometry) : x.geometry, x.material); // geometry and materials are shared
        m.bind(sk, new THREE.Matrix4());
        m.castShadow = true;
        m.frustumCulled = false;
        body.add(m);
      });
    }
  }

  if (o.tusks) {
    const t = tusks[o.g]!.clone(); // keeps its offset from the head bone
    if (o.g === 'f') t.scale.multiplyScalar(0.7);
    byName.Head.add(t);
  }
  if (o.brawn) byName.spine_02.scale.multiplyScalar(o.brawn); // clips only carry rotations, so these stick
  if (o.head) byName.Head.scale.multiplyScalar(o.head);
  body.updateMatrixWorld(true);
  const top = byName.Head.getWorldPosition(new THREE.Vector3()).y + 0.17; // crown of the unscaled model
  if (o.hairStyle === MOHAWK && !o.bald && !o.hideHair && o.hood === undefined) {
    const crest = props.mohawk.clone();
    let m = crestMats.get(o.hair);
    if (!m) crestMats.set(o.hair, (m = new THREE.MeshLambertMaterial({ color: o.hair, side: THREE.DoubleSide })));
    crest.traverse((x) => x instanceof THREE.Mesh && (x.material = m!));
    attach(byName.Head, crest, 0, 0, 0, 1);
  }
  if (o.helm) {
    const fixed = (HELMS as Record<string, readonly [number, number, number]>)[o.helm];
    const model = fixed ? props[o.helm] : wantGear(o.helm as GearFile)?.getObjectByName(o.helm.startsWith('mage_') ? 'circlet' : 'helm');
    const [y, z, s] = fixed ?? [0, 0, 1];
    if (model) attach(byName.Head, model.clone(), 0, y, z, s); // geometry and materials are shared
  }
  if (o.inHand) attach(byName.hand_r, o.inHand, -0.09, -0.02, 0.03, 0.85);

  const mixer = new THREE.AnimationMixer(arm);
  const acts: Record<string, THREE.AnimationAction> = {}, w: Record<string, number> = {};
  for (const name in clips) {
    const a = (acts[name] = mixer.clipAction(clips[name]));
    a.setEffectiveWeight((w[name] = name === 'Idle_Loop' ? 1 : 0));
    a.play();
  }
  // driven by the entity's own clock (swing, death, sitting down and getting up)
  for (const n of ['Sword_Attack', 'Punch_Jab', 'Death01', 'Sitting_Enter', 'Sitting_Exit']) if (acts[n]) acts[n].timeScale = 0;
  root.scale.setScalar(o.scale);
  body.scale.set(o.bulk, 1, o.bulk);
  return {
    root, body, kind: 'humanoid', legs: [], height: top * o.scale, radius: 0.33 * o.scale * o.bulk,
    q: { mixer, acts, w, t: Infinity, armed: !!o.inHand, floor: 0,
      legs: ['calf_l', 'calf_r', 'foot_l', 'foot_r'].map((n) => ({ bone: byName[n], rest: byName[n].quaternion.clone() })) },
    dispose: () => skeletons.forEach((s) => s.dispose()),
  };
}

const ATK_MS = 700;
/** Pose the character for this frame. Returns how many feet landed in it (footsteps). */
export function animateQ(q: QAnim, s: AnimState): number {
  const dt = Math.min(0.1, Math.max(0, s.t - q.t));
  q.t = s.t;
  const atk = q.armed ? 'Sword_Attack' : 'Punch_Jab';
  let cur = 'Idle_Loop';
  /** play a one-shot clip at ms into it, held on its last frame */
  const at = (name: string, ms: number) => {
    if (!q.acts[name]) return false;
    q.acts[name].time = Math.min(ms / 1000, clips[name].duration - 0.02);
    cur = name;
    return true;
  };
  const sitAge = s.sitAge ?? -1, standAge = s.standAge ?? Infinity;
  if (s.deadAge >= 0) {
    cur = 'Death01';
    q.acts.Death01.time = Math.min(s.deadAge / 1000, clips.Death01.duration - 0.02);
  } else if (s.gather && s.gather.anim !== 'pick') {
    // felling and mining: the weapon swing, once per stroke
    cur = 'Sword_Attack';
    q.acts.Sword_Attack.time = ((s.gather.age % s.gather.swingMs) / s.gather.swingMs) * (clips.Sword_Attack.duration - 0.02);
  } else if (s.gather && q.acts.Fixing_Kneeling) cur = 'Fixing_Kneeling';
  else if (sitAge >= 0) {
    if (!clips.Sitting_Enter || sitAge > clips.Sitting_Enter.duration * 1000 || !at('Sitting_Enter', sitAge)) cur = 'Sitting_Idle_Loop';
  } else if (standAge < (clips.Sitting_Exit?.duration ?? 0) * 1000) at('Sitting_Exit', standAge);
  else if (s.swimming) cur = s.moving ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop';
  else if (s.casting) cur = 'Spell_Simple_Idle_Loop';
  else if (s.atkAge < ATK_MS) {
    cur = atk;
    q.acts[atk].time = (s.atkAge / ATK_MS) * (clips[atk].duration - 0.02);
  } else if (s.moving) cur = 'Jog_Fwd_Loop';
  else if (s.dancing) cur = 'Dance_Loop';
  // a clip this build's animation file lacks (an old cached copy, a trimmed pack): the plain pose instead of no pose
  if (!q.acts[cur]) cur = s.moving && !s.swimming ? 'Jog_Fwd_Loop' : 'Idle_Loop';
  const k = Math.min(1, dt * 14);
  for (const n in q.acts) {
    // a fading clip is cut to exactly 0 near the end: the mixer skips sampling clips at zero weight,
    // where an asymptotic fade kept all of them sampled for most of a minute after every switch
    let w = q.w[n] + ((n === cur ? 1 : 0) - q.w[n]) * k;
    if (w < 0.003) w = 0;
    else if (w > 0.997) w = 1;
    q.acts[n].setEffectiveWeight((q.w[n] = w));
  }
  const jog = q.acts.Jog_Fwd_Loop, jog0 = jog?.time ?? 0;
  q.mixer.update(dt);
  // the jog's clock runs at any weight: a foot lands when it passes one of the clip's landing moments
  const steps = jog && cur === 'Jog_Fwd_Loop' && q.w.Jog_Fwd_Loop > 0.5 ? crossed(jog0 / jog.getClip().duration, jog.time / jog.getClip().duration, jogSteps) : 0;
  // Sitting on the floor: there is no floor-sit clip, so the chair sit is lowered to the ground (game.ts) and its
  // knees straightened back toward the bind pose: legs out in front instead of shins sunk into the ground.
  const floor = s.floorSit && (cur === 'Sitting_Enter' || cur === 'Sitting_Idle_Loop') ? 1 : 0;
  q.floor += (floor - q.floor) * Math.min(1, dt * 8);
  if (q.floor < 0.01) q.floor = 0;
  if (q.floor > 0) for (const l of q.legs) l.bone.quaternion.slerp(l.rest, q.floor);
  return steps;
}

/** Dev gallery (?q=1): every race and gender in each gear tier, with the animation states. No server needed. */
export async function mountQuaterniusPreview(host: HTMLElement): Promise<() => void> {
  host.innerHTML = '';
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10;display:flex;gap:6px;flex-wrap:wrap';
  host.append(bar);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x1a2230);
  renderer.domElement.style.cssText = 'position:fixed;inset:0';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 2));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  const p = new URLSearchParams(location.search);
  const zoom = Number(p.get('zoom')) || 1;
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    const d = 15 / zoom / Math.min(1, cam.aspect / 1.7);
    const y = Number(p.get('y')) || 1.1;
    cam.position.set(Number(p.get('x')) || 0, y + 0.2 + d * 0.08, d);
    cam.lookAt(Number(p.get('x')) || 0, y, 0);
    cam.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  await loadQ();

  // [weapon, chest, head, gloves, legs, feet]
  const TIERS: Record<string, (string | null)[]> = {
    'Sin equipo': [null, null, null, null, null, null],
    NG: ['short_sword', 'apprentice_tunic', 'leather_cap', 'short_gloves', 'apprentice_stockings', 'leather_sandals', 'wooden_buckler'],
    D: ['sword_of_revolution', 'brigandine_tunic', 'brigandine_helm', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots', 'brigandine_shield'],
    C: ['samurai_longsword', 'full_plate_armor', 'full_plate_helmet', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    'Místico NG': ['apprentice_wand', 'apprentice_tunic', null, null, 'apprentice_stockings', null],
    'Místico D': ['staff_of_life', 'karmian_tunic', 'karmian_hat', null, 'karmian_stockings', null],
    Hacha: ['battle_axe', 'brigandine_tunic', 'brigandine_helm', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    Lanza: ['partisan', 'brigandine_tunic', null, 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    Daga: ['assassin_dagger', 'apprentice_tunic', 'leather_cap', 'short_gloves', 'apprentice_stockings', 'leather_sandals'],
    Martillo: ['war_hammer', 'brigandine_tunic', null, 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    'Místico C': ['sages_staff', 'demons_tunic', 'demons_circlet', null, 'karmian_stockings', 'reinforced_boots'],
    // the region sets (tools/art/blender/gear.py)
    ...Object.fromEntries((['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const).map((s) => [
      { abyssal: 'Abisal', ashforged: 'Ceniza', dragon: 'Dragón', glacial: 'Glacial', emerald: 'Esmeralda', infernal: 'Infernal' }[s],
      [`${s}_blade`, `${s}_plate`, `${s}_helm`, `${s}_gauntlets`, `${s}_greaves`, `${s}_boots`, `${s}_shield`],
    ])),
    // every helmet side by side, on one race (?race=, default human; ?g=f for women)
    Cascos: [null, 'brigandine_tunic', null, null, null, null],
    // every shield side by side, the same way
    Escudos: ['broadsword', 'brigandine_tunic', null, null, null, null, null],
    // each region set with its sword and its staff, side by side
    Armas: [null, null, null, null, null, null, null],
    // each region set's mage gear (tools/art/blender/gear.py mage_<set>), and all the crowns side by side
    ...Object.fromEntries((['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const).map((s) => [
      `Místico ${{ abyssal: 'Abisal', ashforged: 'Ceniza', dragon: 'Dragón', glacial: 'Glacial', emerald: 'Esmeralda', infernal: 'Infernal' }[s]}`,
      [`${s}_staff`, `${s}_robe`, `${s}_circlet`, `${s}_gloves`, `${s}_greaves`, `${s}_shoes`, null],
    ])),
    Coronas: [null, null, null, null, null, null, null],
  };
  const HELMETS = ['leather_cap', 'brigandine_helm', 'karmian_hat', 'full_plate_helmet', 'demons_circlet', 'abyssal_helm', 'ashforged_helm', 'dragon_helm', 'glacial_helm', 'emerald_helm', 'infernal_helm'];
  const STATES: Record<string, Partial<AnimState>> = { Idle: {}, Correr: { moving: true }, Atacar: {}, Castear: { casting: true }, Morir: {} };
  let tier = p.get('tier') ?? 'NG', state = p.get('state') ?? 'Idle', since = performance.now();
  const spin = !p.has('still'), ry = Number(p.get('ry')) || 0;
  let rigs: Rig[] = [];
  const build = () => {
    for (const r of rigs) {
      scene.remove(r.root);
      r.dispose?.();
    }
    const [w, chest, ...eq] = TIERS[tier] ?? TIERS.NG;
    if (tier === 'Armas') {
      const race = (p.get('race') ?? 'human') as Race, g = p.get('g') === 'f' ? 'f' : 'm';
      const sets = ['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'];
      rigs = sets.flatMap((s, i) => (['blade', 'staff'] as const).map((k, j) => {
        const mage = k === 'staff';
        const rig = playerModel(race, mage ? 'mystic' : 'fighter', `${s}_${k}`, `${s}_${mage ? 'robe' : 'plate'}`, { g, hs: 1, hc: 0 },
          mage ? [`${s}_circlet`, `${s}_gloves`, `${s}_greaves`, `${s}_shoes`, null] : [`${s}_helm`, `${s}_gauntlets`, `${s}_greaves`, `${s}_boots`, null]);
        rig.root.position.set((i * 2 + j - 5.5) * 1.1, 0, 0);
        scene.add(rig.root);
        return rig;
      }));
      return;
    }
    if (tier === 'Coronas') {
      const race = (p.get('race') ?? 'human') as Race, g = p.get('g') === 'f' ? 'f' : 'm';
      const crowns = ['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'].map((s) => `${s}_circlet`);
      rigs = crowns.map((c, i) => {
        const rig = playerModel(race, 'mystic', null, c.replace('_circlet', '_robe'), { g, hs: (i % 3) + 1, hc: 0 }, [c, null, null, null, null]);
        rig.root.position.set((i - (crowns.length - 1) / 2) * 1.1, 0, 0);
        scene.add(rig.root);
        return rig;
      });
      return;
    }
    if (tier === 'Escudos') {
      const race = (p.get('race') ?? 'human') as Race, g = p.get('g') === 'f' ? 'f' : 'm';
      const list = Object.keys(SHIELDS);
      rigs = list.map((sh, i) => {
        const rig = playerModel(race, 'fighter', w, chest, { g, hs: 1, hc: 0 }, [null, null, null, null, sh]);
        rig.root.position.set((i - (list.length - 1) / 2) * 1.1, 0, 0);
        scene.add(rig.root);
        return rig;
      });
      return;
    }
    if (tier === 'Cascos') {
      const race = (p.get('race') ?? 'human') as Race, g = p.get('g') === 'f' ? 'f' : 'm';
      rigs = HELMETS.map((h, i) => {
        const rig = playerModel(race, 'fighter', w, chest, { g, hs: 1, hc: 0 }, [h, ...eq.slice(1)]);
        rig.root.position.set((i - (HELMETS.length - 1) / 2) * 1.1, 0, 0);
        scene.add(rig.root);
        return rig;
      });
      return;
    }
    rigs = (Object.keys(RACES) as Race[]).flatMap((race, i) => (['m', 'f'] as const).map((g, j) => {
      const rig = playerModel(race, tier.startsWith('Místico') ? 'mystic' : 'fighter', w, chest, { g, hs: (i + j) % HAIR_STYLES.length, hc: 0 }, eq);
      rig.root.position.set((i * 2 + j - 4.5) * 1.25, 0, 0);
      scene.add(rig.root);
      return rig;
    }));
  };
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:6px 10px;border-radius:8px;border:1px solid #445;background:#16202e;color:#dfe9f5;cursor:pointer';
    b.onclick = fn;
    bar.appendChild(b);
  };
  for (const name in TIERS) btn(name, () => { tier = name; build(); });
  addEventListener('gear-loaded', build);
  for (const name in STATES) btn(name, () => { state = name; since = performance.now(); });
  build();

  renderer.setAnimationLoop(() => {
    const now = performance.now(), age = now - since;
    rigs.forEach((rig, i) => {
      rig.root.rotation.y = spin ? now / 2500 : ry;
      animate(rig, {
        moving: false, casting: false, t: now / 1000 + i,
        atkAge: state === 'Atacar' ? age % 1100 : Infinity, deadAge: state === 'Morir' ? age : -1, ...STATES[state],
      });
    });
    renderer.render(scene, cam);
  });

  return () => {
    removeEventListener('resize', resize);
    removeEventListener('gear-loaded', build);
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    bar.remove();
  };
}
