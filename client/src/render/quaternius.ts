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
/**
 * Each cape is a file of its own (q/gear/cape_<key>.glb): its node, 'cape', skinned to a grid of points of its own
 * (`cape_<row>_<column>`), whose places in the male bind pose come in the node's extras (`cape_grid`). The rig has no
 * such bones: the client makes one for each point and simulates the grid as cloth each frame (capeCloth), its top row
 * pinned to the upper spine.
 */
const CAPES: Record<string, string> = {
  wool_cape: 'wool', hunter_cape: 'hunter', knight_cape: 'knight', abyssal_cape: 'abyssal', ashforged_cape: 'ashforged', dragon_cape: 'dragon',
  glacial_cape: 'glacial', emerald_cape: 'emerald', infernal_cape: 'infernal',
};
type GearFile = GearSet | `shield_${string}` | `weapons_${string}` | `cape_${string}` | MageFile | LightFile;
/** A region set's mage gear, a file a set (q/gear/mage_<set>.glb): `robe`, `circlet`, `gloves` and `feet`. */
type MageFile = `mage_${string}`;
/** a set's light armour (the archer's and the assassin's), a file of its own: nodes 'hood', 'chest', 'gloves', 'legs', 'feet' */
type LightFile = `light_${string}`;
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
  const m = /^(abyssal|ashforged|dragon|glacial|emerald|infernal)_(plate|robe|gauntlets|gloves|greaves|boots|shoes|jerkin|bracers|leggings|treads)$/.exec(id);
  const [set, name] = m ? [m[1] as GearSet, { plate: 'chest', robe: 'robe', gauntlets: 'gloves', gloves: 'gloves', greaves: 'legs', boots: 'feet', shoes: 'feet',
    jerkin: 'chest', bracers: 'gloves', leggings: 'legs', treads: 'feet' }[m[2]]!] : SET_PIECE[id] ?? [];
  // a mage's pieces (the robe, the cloth gloves, the shoes) and the light armour come in files of their own
  const file: GearFile | undefined = m && /^(robe|gloves|shoes)$/.test(m[2]) ? `mage_${m[1]}` : m && /^(jerkin|bracers|leggings|treads)$/.test(m[2]) ? `light_${m[1]}` : set;
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
/** A cape's model, when it has one (capePiece -> QOpts.cape): its node, with its cloth's grid in its extras. */
export function capePiece(id: string): THREE.Object3D | undefined {
  const key = CAPES[id];
  return (key && wantGear(`cape_${key}`)?.getObjectByName('cape')) || undefined;
}
/** A body piece's joints and weights (the _joints and _weights attributes, the joint names in its node's extras), as
 * a skin in our joint order (a cape's own bones after the rig's 65). */
function toSkin(m: THREE.Mesh) {
  const g = m.geometry, j = g.getAttribute('_joints'), w = g.getAttribute('_weights');
  const names = (m.userData.joints ?? m.parent?.userData.joints) as string[] | undefined;
  if (!j || !w || !names) return;
  const grid = (m.userData.cape_grid ?? m.parent?.userData.cape_grid) as number[] | undefined;
  const all = grid ? joints.concat(Array.from({ length: grid[0] * grid[1] }, (_, i) => `cape_${Math.floor(i / grid[1])}_${i % grid[1]}`)) : joints;
  const map = names.map((n) => Math.max(0, all.indexOf(n)));
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
export type Helm = keyof typeof HELMS | GearSet | MageFile | LightFile;
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
  // the light armour's hoods hide the hair and the ears, leaving the face
  ...Object.fromEntries((['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const).map((s) => [`${s}_hood`, { model: `light_${s}` as Helm, closed: true }])),
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
const SET_WEAPON = /^(abyssal|ashforged|dragon|glacial|emerald|infernal)_(blade|staff|bow|dagger)$/;
/** the plain bows and daggers, modelled in gear.py like the sets' weapons: one file, a node each */
const BASIC_WEAPONS = new Set(['short_bow', 'hunting_bow', 'composite_bow', 'stiletto']);
/**
 * The item's own weapon model, if it has one (geometry and materials are shared between instances). A set's sword or
 * staff comes in with its file: until then there is none (the caller draws the plain one), and 'gear-loaded' redraws.
 */
export function qWeapon(item: string | null): THREE.Object3D | null {
  if (!item) return null;
  if (WEAPONS.includes(item)) return props[item].clone();
  const m = BASIC_WEAPONS.has(item) ? ['', 'basic', item] : SET_WEAPON.exec(item);
  const node = m && wantGear(`weapons_${m[1]}`)?.getObjectByName(m[2]);
  if (!node) return null;
  const w = node.clone(), held = new THREE.Group();
  w.position.set(0, 0, 0);
  held.add(w);
  // built as the Fiend props are (upright, the grip at the origin), and held as they are
  if (m[2] === 'staff') {
    held.rotation.z = -Math.PI / 2;
    held.position.z = 0.05;
  } else if (!/bow$/.test(m[2])) held.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0, 'ZYX')); // a bow stays upright
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
      mat.userData.gear = true; // tintGear finds the set's pieces by it
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
      if (m.name === 'chest' || m.name === 'robe') m.userData.back = backOf(m.geometry);
    });
    gear[s] = g.scene;
    dispatchEvent(new CustomEvent('gear-loaded', { detail: s }));
  }).catch((err) => console.warn('gear', s, err)); // a set that fails to load leaves its pieces off
  return undefined;
}

/** Gear materials repainted (tintGear), by the set's own material and the colour. */
const tinted = new WeakMap<THREE.Material, Map<number, THREE.Material>>();
/**
 * Repaint every set piece worn under `root` (armour, helm, cape) in `hex`: its dark lacquer, paint and cloth (the
 * greys and blacks of the baked map) take the colour, its gold, brass and gems stay as they are; `glow` makes the
 * repainted parts glow with it, as metal heated red. For a mob dressed in a set (render/mobs.ts MOB_KNIGHT): the world
 * raid's Infernal plate in red, smouldering.
 */
export function tintGear(root: THREE.Object3D, hex: number, glow = 0) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material as THREE.Material).userData?.gear) return;
    const src = o.material as THREE.MeshPhongMaterial;
    let byHex = tinted.get(src);
    if (!byHex) tinted.set(src, (byHex = new Map()));
    const id = hex + glow * 0x1000000;
    let mat = byHex.get(id);
    if (!mat) {
      const m = src.clone();
      const prev = src.onBeforeCompile.bind(src), key = src.customProgramCacheKey();
      m.onBeforeCompile = (sh, r) => {
        prev(sh, r);
        sh.uniforms.gearTint = { value: new THREE.Color(hex) };
        sh.uniforms.gearGlow = { value: glow };
        sh.fragmentShader = `uniform vec3 gearTint;\nuniform float gearGlow;\n${sh.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = diffuseColor.rgb;
            float lum = dot(c, vec3(0.299, 0.587, 0.114));
            float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
            float k = (1.0 - smoothstep(0.06, 0.22, sat)) * (1.0 - smoothstep(0.3, 0.6, lum));
            diffuseColor.rgb = mix(c, gearTint * (0.25 + lum * 2.2), k);
            totalEmissiveRadiance += gearTint * k * gearGlow;
          }`);
      };
      m.customProgramCacheKey = () => `${key}|tint${hex}|${glow}`;
      byHex.set(id, (mat = m));
    }
    o.material = mat;
  });
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
    // a pair of swords swings with each hand in turn: the same slash with the left
    if (clips.Sword_Attack) clips.Sword_Attack_M = mirrorClip(clips.Sword_Attack, armature.m!, 'Sword_Attack_M');
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
  /** a cape (capePiece): its node, skinned to a grid of points animateQ simulates as cloth */
  cape?: THREE.Object3D;
  /** no boots: a set's own feet piece (greaves and sabatons) takes their place */
  bareFeet?: boolean;
  /** no cloth on the trunk and arms, or on the legs: a set's armour covers them, over the bare body dyed `suit` */
  noTop?: boolean; noLegs?: boolean; suit?: number;
  /** weapon built along +Z with the grip at the origin */
  inHand?: THREE.Object3D | null;
  /** inHand is a bow: held upright in the left hand, and drawn and loosed as it shoots (aimBow) */
  bow?: boolean;
  /** a second weapon, in the left hand (a pair of swords): the attacks then swing with each hand in turn */
  offHand?: THREE.Object3D | null;
}

export interface QAnim {
  mixer: THREE.AnimationMixer; acts: Record<string, THREE.AnimationAction>; w: Record<string, number>; t: number; armed: boolean;
  /** knees and ankles with their straight rest pose, and how far a floor sit has straightened them (0..1) */
  legs: { bone: THREE.Object3D; rest: THREE.Quaternion }[];
  floor: number;
  /** a cape's cloth, as capeCloth moves it */
  cape?: QCape;
  /** a bow's arms, as aimBow poses them */
  bow?: BowArms;
  /** a pair of swords: whether the swing under way is the left hand's, and how far into it the last frame was */
  dual?: { left: boolean; age: number };
}

/** The bones a bow is drawn with, and how far into the archer's stance the arms are (0..1). */
/** A modelled bow's string, drawn by the client between its tips (the node's `bow_tips`, its own space), pulled back
 * to the drawing hand as the bow is drawn. */
interface BowString { node: THREE.Object3D; line: THREE.Line; top: THREE.Vector3; bottom: THREE.Vector3 }
const stringMat = new THREE.LineBasicMaterial({ color: 0xe8e0c8 });
/** A modelled bow's node (it carries its tips), none for the plain one. */
function bowNode(held: THREE.Object3D): THREE.Object3D | undefined {
  let node: THREE.Object3D | undefined;
  held.traverse((o) => { if (!node && (o.userData.bow_tips as number[] | undefined)?.length === 6) node = o; });
  return node;
}
function bowString(held: THREE.Object3D): BowString | undefined {
  const node = bowNode(held);
  if (!node) return undefined;
  const t = node.userData.bow_tips as number[];
  const [top, bottom] = [new THREE.Vector3(t[0], t[1], t[2]), new THREE.Vector3(t[3], t[4], t[5])];
  const g = new THREE.BufferGeometry().setFromPoints([top, top.clone().lerp(bottom, 0.5), bottom]);
  const line = new THREE.Line(g, stringMat);
  line.frustumCulled = false;
  node.add(line);
  return { node, line, top, bottom };
}
interface BowArms {
  root: THREE.Object3D; head: THREE.Object3D; string?: BowString;
  /** what holds the bow in the fist (attach's anchor), its turn as the hand carries it, and how far it is held upright */
  grip?: THREE.Object3D; gripRest: THREE.Quaternion; hold: number;
  uaL: THREE.Object3D; laL: THREE.Object3D; handL: THREE.Object3D; uaR: THREE.Object3D; laR: THREE.Object3D; handR: THREE.Object3D; w: number }
const _aq = new THREE.Quaternion(), _aq2 = new THREE.Quaternion(), _aq3 = new THREE.Quaternion(), _av = new THREE.Vector3(), _av2 = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _left = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3();
/** Turn `bone` so that the way to its child `tip` points along the world direction `dir`, `w` of the way. */
function aimBone(bone: THREE.Object3D, tip: THREE.Object3D, dir: THREE.Vector3, w: number) {
  bone.updateWorldMatrix(true, true);
  const from = _av.setFromMatrixPosition(tip.matrixWorld).sub(_av2.setFromMatrixPosition(bone.matrixWorld)).normalize();
  const world = _aq.setFromUnitVectors(from, dir).multiply(bone.getWorldQuaternion(_aq2));
  const local = bone.parent!.getWorldQuaternion(_aq3).invert().multiply(world);
  bone.quaternion.slerp(local, w);
}
/** Two-bone IK: turn `upper` and `lower` so that `hand` reaches `target`, the elbow bending towards `pole`, `w` of the way. */
const _ik = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
function reach(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  upper.updateWorldMatrix(true, true);
  const [S, E, H, u, v, e] = _ik;
  S.setFromMatrixPosition(upper.matrixWorld);
  E.setFromMatrixPosition(lower.matrixWorld);
  H.setFromMatrixPosition(hand.matrixWorld);
  const a = S.distanceTo(E), b = E.distanceTo(H);
  u.subVectors(target, S);
  const d = THREE.MathUtils.clamp(u.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  u.normalize();
  v.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
  const cos = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  e.copy(S).addScaledVector(u, cos * a).addScaledVector(v, Math.sqrt(1 - cos * cos) * a); // where the elbow goes
  aimBone(upper, lower, E.subVectors(e, S).normalize(), w);
  lower.updateWorldMatrix(true, true);
  aimBone(lower, hand, H.subVectors(target, S.setFromMatrixPosition(lower.matrixWorld)).normalize(), w);
}
const _tgt = new THREE.Vector3(), _pole = new THREE.Vector3(), _head = new THREE.Vector3(), _str = new THREE.Vector3();
/**
 * An archer's arms, over the idle or the jog (the animations have no bow): the bow arm straight out ahead at shoulder
 * height; the other hand takes the string at the bow, draws it back to the cheek over the first half of a shot, the
 * elbow up behind, and lets go, slipping back past the ear. Held drawn while a skill is aimed. Eases in and out.
 */
function aimBow(b: BowArms, s: AnimState, dt: number) {
  const shot = s.atkAge < ATK_MS ? s.atkAge / ATK_MS : -1;
  const down = s.deadAge >= 0 || s.swimming || (s.sitAge ?? -1) >= 0;
  const want = down ? 0 : s.casting || shot >= 0 ? 1 : 0;
  b.w += (want - b.w) * Math.min(1, dt * 10);
  b.hold += ((down ? 0 : 1) - b.hold) * Math.min(1, dt * 6);
  b.root.getWorldQuaternion(_aq3);
  const fwd = _fwd.set(0, 0, 1).applyQuaternion(_aq3).setY(0).normalize();
  const left = _left.set(fwd.z, 0, -fwd.x); // facing +z, the left hand is on +x
  if (b.w < 0.01) {
    straightBowArm(b, b.hold);
    holdBow(b, fwd);
    return pullString(b, 0);
  }
  const phase = s.casting ? 0.5 : Math.max(0, shot);
  const drawn = THREE.MathUtils.smoothstep(phase, 0.05, 0.5), loosed = THREE.MathUtils.smoothstep(phase, 0.55, 0.72);
  const sc = b.root.getWorldScale(_av2).y;
  // the bow arm, straight out ahead, a touch up
  _d1.copy(fwd).addScaledVector(left, 0.08).setY(0.06).normalize();
  aimBone(b.uaL, b.laL, _d1, b.w);
  aimBone(b.laL, b.handL, _d1, b.w);
  b.handL.updateWorldMatrix(true, false);
  // the string, a hand's breadth inside the bow; the cheek, beside the jaw; past the ear, let go
  _str.setFromMatrixPosition(b.handL.matrixWorld).addScaledVector(fwd, -0.12 * sc).addScaledVector(left, -0.04 * sc);
  b.head.updateWorldMatrix(true, false);
  _head.setFromMatrixPosition(b.head.matrixWorld);
  _tgt.copy(_head).addScaledVector(left, -0.08 * sc).addScaledVector(fwd, 0.07 * sc).y -= 0.1 * sc;
  _tgt.lerpVectors(_str, _tgt, drawn);
  if (loosed > 0) _tgt.lerp(_av.copy(_head).addScaledVector(left, -0.2 * sc).addScaledVector(fwd, -0.14 * sc), loosed);
  // the elbow out to the side, at shoulder height: the forearm level with the arrow
  _pole.copy(left).multiplyScalar(-1).addScaledVector(fwd, -0.15).setY(0.05);
  reach(b.uaR, b.laR, b.handR, _tgt, _pole, b.w);
  straightBowArm(b, b.hold * (1 - b.w));
  holdBow(b, fwd);
  pullString(b, b.w * drawn * (1 - loosed));
}
/** The bow arm carried straight, the forearm in line with the upper arm (the clips bend the elbow, a running one most),
 * `k` of the way; the upper arm keeps its own swing. */
function straightBowArm(b: BowArms, k: number) {
  if (k < 0.01) return;
  b.uaL.updateWorldMatrix(true, true);
  _d2.setFromMatrixPosition(b.laL.matrixWorld).sub(_av.setFromMatrixPosition(b.uaL.matrixWorld)).normalize();
  aimBone(b.laL, b.handL, _d2, k);
}
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(),
  _bq2 = new THREE.Quaternion();
/**
 * How the bow sits in the fist, whatever way the clip turns the hand: carried (standing, running) it lies along the
 * body, one limb ahead a little lower than the other behind, its back to the ground and its string on top; drawn it
 * stands upright, its back towards where the archer faces and the string towards the archer; between the two as the
 * draw comes and goes. Fallen, sitting or swimming it goes with the hand again.
 */
function holdBow(b: BowArms, fwd: THREE.Vector3) {
  const g = b.grip;
  if (!g) return;
  g.quaternion.copy(b.gripRest);
  if (b.hold < 0.01) return;
  g.parent!.updateWorldMatrix(true, false);
  // carried: the bow's Y (its limbs) along fwd, dipping forward; its X (its back) down
  _by.copy(fwd).multiplyScalar(Math.cos(0.25)).y -= Math.sin(0.25);
  _by.normalize();
  _bx.set(0, -1, 0).addScaledVector(_by, _by.y).normalize();
  _bz.crossVectors(_bx, _by);
  _bq.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
  if (b.w > 0.001) {
    // drawn: its X along fwd, its Y up
    _by.set(0, 1, 0);
    _bz.crossVectors(fwd, _by);
    _bq2.setFromRotationMatrix(_bm.makeBasis(fwd, _by, _bz));
    _bq.slerp(_bq2, b.w);
  }
  g.quaternion.slerp(g.parent!.getWorldQuaternion(_aq).invert().multiply(_bq), b.hold);
}
/** The string's middle: at rest between the tips, pulled `k` of the way to the drawing hand. */
function pullString(b: BowArms, k: number) {
  const st = b.string;
  if (!st) return;
  const pos = st.line.geometry.getAttribute('position') as THREE.BufferAttribute;
  const mid = _av.copy(st.top).lerp(st.bottom, 0.5);
  if (k > 0.001) {
    b.handR.updateWorldMatrix(true, false);
    st.node.updateWorldMatrix(true, false);
    const hand = _av2.setFromMatrixPosition(b.handR.matrixWorld).applyMatrix4(_m.copy(st.node.matrixWorld).invert());
    mid.lerp(hand, k);
  }
  pos.setXYZ(1, mid.x, mid.y, mid.z);
  pos.needsUpdate = true;
}

/** How far behind the body a chest piece or robe stands (z, the male bind pose) over the shoulder blades and at the
 * knee: a cape is fitted clear of most, and pushed back off the few that stand out further (a hood, a fur pelt) or
 * swung back off a skirt that does (a fur hem). A dragon's wings hold it up instead (qPlayer). */
function backOf(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  let top = 0, low = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = Math.abs(p.getX(i));
    if (y > 1.36 && y < 1.56 && x < 0.14) top = Math.min(top, p.getZ(i));
    else if (y > 0.55 && y < 0.75 && x < 0.2) low = Math.min(low, p.getZ(i));
  }
  return { top, low };
}
/** A cape's cloth as capeCloth simulates it: its grid of points (rows down from the pinned top row, columns across),
 * their bones and bind places, where they are in the world now and a step ago, what holds them together and what of
 * the body they bump into. */
interface QCape {
  root: THREE.Object3D; body: THREE.Object3D; spine: THREE.Object3D;
  rows: number; cols: number; bones: THREE.Bone[];
  /** each point's place and the cloth's turn there in the bind pose (the turn transposed, to take it off) */
  bind: THREE.Vector3[]; frame0: THREE.Matrix4[];
  /** each point where it hangs at rest, in spine_03's own space (where it starts) */
  home: THREE.Vector3[];
  /** the top row's pins: for each, the bones it follows, where it is in each one's own space, and how much (as the
   * armour over the shoulder blades follows them: the spine and, out to the side, its collarbone; hung from a pair of
   * wings, the spine they are on) */
  pins: [THREE.Object3D, THREE.Vector3, number][][];
  pos: THREE.Vector3[]; prev: THREE.Vector3[];
  /** the points in the body's own space, worked out each frame for their bones */
  local: THREE.Vector3[];
  /** pairs of points, how far apart they are in the bind pose (model metres) and how stiff (1; the diagonals of the
   * cells by a pair of wings' claws give: the claws turn with the shoulders, and the cloth there shears rather than
   * swinging round whole) */
  links: [number, number, number, number][];
  /** what the cloth may not pass through: capsules between two bones (one for a sphere), their radius in model metres */
  hit: [THREE.Object3D, THREE.Object3D, number][];
  /** for each point, the vertices of the armour or robe worn under it that stand out furthest behind round it: the
   * cloth is kept behind them as they are posed (each frame where they are, skinned), so nothing worn comes through
   * it, whatever the race, the body or the move */
  anchors: [THREE.SkinnedMesh, number][][];
  /** spine_03's turn in the male bind pose, taken off its turn now: how the back has turned since (its outward way) */
  spineRest: THREE.Quaternion;
  last: THREE.Vector3 | null; started: boolean;
  /** hung from a pair of wings (their claws hold its top row) */
  hooked: boolean;
  /** the shoulders' twist and sideways lean against the body (rad), as the top row follows them: smoothed */
  twist: { yaw: number; roll: number } | null;
  /** how high spine_03 was over the body's root last frame */
  lift: number | null;
  /** the pinned row where it was last frame and where it is now: within a frame it goes from one to the other */
  pinned: THREE.Vector3[]; pinTo: THREE.Vector3[];
}
const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(),
  _c = new THREE.Vector3(), _d = new THREE.Vector3(), _y = new THREE.Vector3(), _p = new THREE.Vector3(), _air = new THREE.Vector3(), _air2 = new THREE.Vector3(),
  _up = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _rv = new THREE.Vector3(),
  _piv = new THREE.Vector3(), _e = new THREE.Euler(), _sp = new THREE.Vector3(), _mv = new THREE.Vector3(), _cy = new THREE.Vector3();
const wrapAngle = (a: number) => THREE.MathUtils.euclideanModulo(a + Math.PI, 2 * Math.PI) - Math.PI;
/** a kit piece's vertices at rest in the male bind pose (qPlayer's cape anchors): the same on every rig of its sex */
const kitRest = new WeakMap<THREE.BufferGeometry, Float32Array>();
/** the cloth's turn at a point of the grid, from its neighbours: across the cape, and up it */
function clothFrame(L: THREE.Vector3[], rows: number, cols: number, i: number, out: THREE.Matrix4) {
  const r = Math.floor(i / cols), c = i % cols;
  _a.subVectors(L[r * cols + Math.min(cols - 1, c + 1)], L[r * cols + Math.max(0, c - 1)]).normalize();
  _y.subVectors(L[Math.max(0, r - 1) * cols + c], L[Math.min(rows - 1, r + 1) * cols + c]);
  _y.addScaledVector(_a, -_y.dot(_a)).normalize();
  _c.crossVectors(_a, _y);
  return out.makeBasis(_a, _y, _c);
}
/**
 * A cape's cloth, after the clip has posed the body: its top row pinned over the shoulder blades, the rest falling
 * under gravity and dragged by the air - running, its hem streams out behind, where the legs cannot reach it; standing
 * a breeze stirs it; on a turn it swings out; sitting or fallen it drapes over the body and lies on the ground. The
 * points keep their distances (a few rounds of relaxing each link), and are pushed out of the back, the hips and the
 * legs, then each one's bone takes its place and the cloth's turn there.
 */
function capeCloth(c: QCape, s: AnimState, dt: number) {
  if (dt <= 0) return;
  c.root.updateWorldMatrix(true, true);
  const bodyW = c.body.matrixWorld, spineW = c.spine.matrixWorld;
  const scale = (_v.setFromMatrixColumn(bodyW, 0).length() + _v.setFromMatrixColumn(bodyW, 1).length()) / 2;
  const n = c.pos.length, cols = c.cols;
  const rootPos = c.root.getWorldPosition(_w);
  // first frame, or a jump (a teleport, a world change): every point straight to where it hangs
  const jump = !c.started || (c.last !== null && c.last.distanceTo(rootPos) > 3);
  if (jump) {
    for (let i = 0; i < n; i++) {
      c.pos[i].copy(c.home[i]).applyMatrix4(spineW);
      c.prev[i].copy(c.pos[i]);
    }
    c.started = true;
    c.last = c.lift = null;
  }
  const moved = _mv.subVectors(rootPos, c.last ?? rootPos), vel = _rv.copy(moved).divideScalar(dt), speed = vel.length();
  c.last = (c.last ?? new THREE.Vector3()).copy(rootPos);
  // the air: still, but for a breeze standing; running in place (the gallery) it blows back as running would
  c.root.getWorldQuaternion(_q);
  const fwd = _d.set(0, 0, 1).applyQuaternion(_q).setY(0).normalize();
  const side = _p.set(fwd.z, 0, -fwd.x);
  const air = _air.set(0, 0, 0);
  if (s.moving && speed < 1.5 && s.deadAge < 0) air.addScaledVector(fwd, -3.6 * scale);
  if (s.moving || speed > 1.5) air.addScaledVector(side, 0.9 * scale * Math.sin(s.t * 7.1)).y += 0.7 * scale * Math.sin(s.t * 5.3); // flutter
  air.addScaledVector(fwd, -0.5 * scale).addScaledVector(side, 0.45 * scale * Math.sin(s.t * 0.9) + 0.25 * scale * Math.sin(s.t * 2.3));
  air.sub(vel); // as the cloth feels it, carried along with the body (below)
  const ground = rootPos.y + 0.02 * scale;
  // the back's outward way now, and where the armour under each point is
  const out = _air2.set(0, 0, -1).applyQuaternion(c.spine.getWorldQuaternion(_q2).multiply(c.spineRest)).normalize();
  const under = c.anchors.map((list) => list.map(([m, k]) => m.getVertexPosition(k, new THREE.Vector3()).applyMatrix4(m.matrixWorld)));
  const clear = 0.018 * scale; // the points lie on the cloth's middle: its folds dip a centimetre nearer, and it has a thickness
  // the back's upward way: however the body whips round (a sword swing), the cloth never rises over the shoulders
  const up = _up.set(0, 1, 0).applyQuaternion(_q2).normalize();
  // The top row leans forward with the back at once, but follows its twist and sideways lean smoothed: the jog swings
  // the shoulders some 40 and 25 degrees each stride, and cloth hung on a line turning that much swings round with it,
  // hem and all, from side to side. Standing, it settles back flat on the shoulder blades. Not on wings: it hangs on them
  let turn: THREE.Quaternion | null = null;
  const pivot = c.spine.getWorldPosition(_piv);
  if (!c.hooked) {
    _e.setFromQuaternion(_qt.copy(_q).invert().multiply(_q2), 'YXZ'); // the back's turn against the body's
    const k = c.twist ? 1 - Math.exp(-dt / 0.6) : 1, t = (c.twist ??= { yaw: _e.y, roll: _e.z });
    t.yaw += wrapAngle(_e.y - t.yaw) * k;
    t.roll += wrapAngle(_e.z - t.roll) * k;
    turn = _qt.setFromEuler(_e.set(_e.x, t.yaw, t.roll, 'YXZ')).premultiply(_q).multiply(_q2.invert()); // from where it is to there
    _q2.invert();
  }
  // The cloth goes along with the body - the run, a slope and most of the jog's bobbing (a quarter of a metre each step)
  // - feeling only the air that makes, and the body's turns and swings: left behind each frame, it caught up in jerks
  // (a flicker running), and each step flung it up off the back and dropped it back on
  const lift = c.spine.getWorldPosition(_sp).y - rootPos.y;
  const carry = _cy.copy(moved);
  if (c.lift !== null) carry.y += (lift - c.lift) * 0.8;
  c.lift = lift;
  for (let i = cols; i < n; i++) {
    c.pos[i].add(carry);
    c.prev[i].add(carry);
  }
  // where the pinned row is now, from the bones it follows, and from where it goes there over the frame's steps
  for (let i = 0; i < cols; i++) {
    const to = c.pinTo[i].set(0, 0, 0);
    for (const [b, at, w] of c.pins[i]) to.addScaledVector(_v.copy(at).applyMatrix4(b.matrixWorld), w);
    if (turn) to.sub(pivot).applyQuaternion(turn).add(pivot);
    if (jump) c.pinned[i].copy(to);
    else c.pinned[i].add(moved);
  }
  const vmax = 9 * scale; // nor moves faster than this (m/s): a pose snapping (a swing begun again) must not fling it
  const steps = Math.min(6, Math.max(1, Math.ceil(dt * 90))), h = dt / steps;
  const g = 9.8 * scale, drag = 2.4;
  // how much of its sway sideways against the body the cloth loses each step: it trails behind (hung on wings, which
  // turn with the shoulders, more so)
  const sway = 1 - Math.exp(-(c.hooked ? 8 : 4) * h);
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < cols; i++) { // the pinned row, on its way to where the bones it follows put it
      c.pos[i].lerpVectors(c.pinned[i], c.pinTo[i], (k + 1) / steps);
      c.prev[i].copy(c.pos[i]);
    }
    for (let i = cols; i < n; i++) {
      const p = c.pos[i], q = c.prev[i];
      let vx = (p.x - q.x) / h, vy = (p.y - q.y) / h, vz = (p.z - q.z) / h;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > vmax) [vx, vy, vz] = [(vx * vmax) / sp, (vy * vmax) / sp, (vz * vmax) / sp];
      const lat = (vx * side.x + vz * side.z) * sway;
      vx -= side.x * lat;
      vz -= side.z * lat;
      const ax = drag * (air.x - vx), ay = drag * (air.y - vy) - g, az = drag * (air.z - vz);
      q.copy(p);
      p.set(p.x + vx * h * 0.995 + ax * h * h, p.y + vy * h * 0.995 + ay * h * h, p.z + vz * h * 0.995 + az * h * h);
    }
    for (let it = 0; it < 5; it++) {
      for (const [i, j, rest, stiff] of c.links) {
        const pi = c.pos[i], pj = c.pos[j];
        _a.subVectors(pj, pi);
        const d = _a.length();
        if (d < 1e-9) continue;
        const wi = i < cols ? 0 : 1, wj = j < cols ? 0 : 1;
        if (!wi && !wj) continue;
        const f = ((d - rest * scale) / d / (wi + wj)) * stiff;
        if (wi) pi.addScaledVector(_a, f * wi);
        if (wj) pj.addScaledVector(_a, -f * wj);
      }
      for (let i = cols; i < n; i++) {
        const p = c.pos[i];
        for (const [b0, b1, r] of c.hit) {
          const a0 = b0.getWorldPosition(_c), a1 = b1 === b0 ? a0 : b1.getWorldPosition(_y);
          _a.subVectors(a1, a0);
          const len2 = _a.lengthSq();
          const t = len2 > 1e-9 ? THREE.MathUtils.clamp(_v.subVectors(p, a0).dot(_a) / len2, 0, 1) : 0;
          _v.copy(a0).addScaledVector(_a, t);
          _w.subVectors(p, _v);
          const d = _w.length(), rr = r * scale;
          if (d < rr) p.copy(_v).addScaledVector(d > 1e-6 ? _w.divideScalar(d) : _w.copy(fwd).negate(), rr);
        }
        if (p.y < ground) p.y = ground;
      }
      _c.set(0, 0, 0);
      for (let i = 0; i < cols; i++) _c.add(c.pos[i]);
      _c.divideScalar(cols);
      for (let i = cols; i < n; i++) { // no higher than a little over the pinned row
        const over = _w.subVectors(c.pos[i], _c).dot(up) - 0.05 * scale;
        if (over > 0) c.pos[i].addScaledVector(up, -over);
      }
      for (let i = 0; i < n; i++) { // behind what is worn under the cloth (the pinned row too)
        const p = c.pos[i];
        for (const a of under[i]) {
          const d = _w.subVectors(p, a).dot(out);
          if (d < clear) p.addScaledVector(out, Math.min(clear - d, 0.04 * scale)); // a little at a time: never flung
        }
      }
    }
  }
  for (let i = 0; i < cols; i++) c.pinned[i].copy(c.pinTo[i]);
  // each point's bone: its place in the body's own space, and the cloth's turn there against the bind pose
  _m.copy(bodyW).invert();
  const L = c.local;
  for (let i = 0; i < n; i++) L[i].copy(c.pos[i]).applyMatrix4(_m);
  for (let i = 0; i < n; i++) {
    clothFrame(L, c.rows, cols, i, _b);
    c.bones[i].matrix.multiplyMatrices(_b, c.frame0[i]).setPosition(L[i]);
  }
}

/** Hangs `o` from a bone keeping the orientation it was modelled in (bones have arbitrary axes). */
/**
 * A clip played on the other side of the body: each left bone moves as its right one did and the other way round,
 * mirrored across the body's plane (x = 0). The bones' own axes are not mirror images of each other's, so every key is
 * corrected by the rest pose: q'(m B) = K(par B)⁻¹ · mirror(q B) · K(B), with K(X) = mirror(P X)⁻¹ · P(m X), P the rest
 * world rotations and mirror(x, y, z, w) = (x, −y, −z, w); a position p becomes K(par B)⁻¹ · (−px, py, pz).
 */
function mirrorClip(clip: THREE.AnimationClip, rig: THREE.Object3D, name: string): THREE.AnimationClip {
  const other = (n: string) => n.replace(/_([lr])$/, (_, s: string) => (s === 'l' ? '_r' : '_l'));
  const mirror = (q: THREE.Quaternion) => q.set(q.x, -q.y, -q.z, q.w);
  rig.updateMatrixWorld(true);
  const K = (o: THREE.Object3D | null) => {
    if (!o) return new THREE.Quaternion();
    const m = rig.getObjectByName(other(o.name)) ?? o;
    return mirror(o.getWorldQuaternion(new THREE.Quaternion())).invert().multiply(m.getWorldQuaternion(new THREE.Quaternion()));
  };
  const q = new THREE.Quaternion(), v = new THREE.Vector3();
  const tracks = clip.tracks.map((t) => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(t.name);
    const out = t.clone(); // its own copy of the keys
    out.name = `${other(nodeName)}.${propertyName}`;
    const bone = rig.getObjectByName(nodeName);
    if (!bone) return out;
    const kp = K(bone.parent).invert(), kb = K(bone), vals = out.values;
    if (propertyName === 'quaternion') for (let i = 0; i < vals.length; i += 4) mirror(q.fromArray(vals, i)).premultiply(kp).multiply(kb).toArray(vals, i);
    else if (propertyName === 'position') for (let i = 0; i < vals.length; i += 3) v.fromArray(vals, i).setX(-vals[i]).applyQuaternion(kp).toArray(vals, i);
    return out;
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

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
  const worn: THREE.SkinnedMesh[] = []; // everything worn on the body (the kit's cloth, the armour): what a cape hangs over
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
      if (!/^(Head_|Hair_)/.test(file)) worn.push(m);
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
      const torsoPiece = node.name === 'chest' || node.name === 'robe';
      const bust = o.g === 'f' && torsoPiece;
      node.traverse((x) => {
        if (!(x instanceof THREE.Mesh) || !x.userData.skinned) return;
        const m = new THREE.SkinnedMesh(bust ? bustGeo(x.geometry) : x.geometry, x.material); // geometry and materials are shared
        m.bind(sk, new THREE.Matrix4());
        m.castShadow = true;
        m.frustumCulled = false;
        body.add(m);
        worn.push(m);
      });
    }
  }

  let cape: QCape | undefined;
  const grid = o.cape?.userData.cape_grid as number[] | undefined;
  if (o.cape && grid && grid.length === 2 + grid[0] * grid[1] * 3) {
    const [rows, cols] = grid;
    const bind = Array.from({ length: rows * cols }, (_, i) => new THREE.Vector3(grid[2 + i * 3], grid[3 + i * 3], grid[4 + i * 3]));
    // pushed back off a chest or robe standing out behind further than it was fitted to (a hood, fur: at most 5 cm),
    // unless the chest has wings to hang it from (the dragon's: their claws, in its extras, the male bind pose)
    let top = 0, low = 0, hooks: number[] | undefined;
    for (const n of o.armor ?? []) n.traverse((x) => {
      const b = x.userData.back as { top: number; low: number } | undefined;
      if (b) [top, low] = [Math.min(top, b.top), Math.min(low, b.low)];
      if ((x.userData.cape_hooks as number[] | undefined)?.length === 6) hooks = x.userData.cape_hooks;
    });
    const push = hooks ? 0 : THREE.MathUtils.clamp(((o.cape.userData.cape_back as number | undefined) ?? -0.22) - top + 0.004, 0, 0.05);
    const robe = !!o.armor?.some((n) => n.name === 'robe');
    // where each point hangs at rest in the male bind pose: where it was fitted or, hooked on wings, its top row slung
    // between their claws (sagging a little in the middle) and the cloth let down from there to the hem, still at the knee
    const hang = bind.map((p) => new THREE.Vector3(p.x, p.y, p.z - push));
    if (hooks) {
      const [right, left] = [new THREE.Vector3().fromArray(hooks, 3), new THREE.Vector3().fromArray(hooks, 0)]; // column 0 is on the right (-x)
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1), d = new THREE.Vector3().lerpVectors(right, left, u);
        d.y -= 0.025 * (1 - (2 * u - 1) ** 2);
        d.sub(bind[c]);
        for (let r = 0; r < rows; r++) hang[r * cols + c].addScaledVector(d, 1 - r / (rows - 1));
      }
    }
    // and there on this rig's spine_03, carried over from the male bind pose (as the armour is)
    const spineRest = armature.m!.getObjectByName('spine_03')!.matrixWorld.clone().invert();
    const home = hang.map((p) => p.clone().applyMatrix4(spineRest));
    const restOf = (n: string) => armature.m!.getObjectByName(n)!.matrixWorld.clone().invert();
    const [clavL, clavR] = [restOf('clavicle_l'), restOf('clavicle_r')];
    const pins = hang.slice(0, cols).map((q) => {
      if (hooks) return [[byName.spine_03, q.clone().applyMatrix4(spineRest), 1]] as [THREE.Object3D, THREE.Vector3, number][]; // the wings are on spine_03 alone
      const side = THREE.MathUtils.smoothstep(q.x, -0.1, 0.1);
      return [[byName.spine_03, q.clone().applyMatrix4(spineRest), 0.6], [byName.clavicle_l, q.clone().applyMatrix4(clavL), 0.4 * side],
        [byName.clavicle_r, q.clone().applyMatrix4(clavR), 0.4 * (1 - side)]] as [THREE.Object3D, THREE.Vector3, number][];
    });
    const pts = hang.map((p, i) => {
      const b = new THREE.Bone();
      b.name = `cape_${Math.floor(i / cols)}_${i % cols}`;
      b.matrixAutoUpdate = false;
      b.matrix.makeTranslation(p.x, p.y, p.z);
      body.add(b);
      return b;
    });
    const sk = new THREE.Skeleton([...bones, ...pts], [...restInv, ...bind.map((p) => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z))]);
    skeletons.set(-2, sk);
    o.cape.traverse((x) => {
      if (!(x instanceof THREE.Mesh) || !x.userData.skinned) return;
      const m = new THREE.SkinnedMesh(x.geometry, x.material);
      m.bind(sk, new THREE.Matrix4());
      m.castShadow = true;
      m.frustumCulled = false;
      body.add(m);
    });
    // what holds the cloth together: each point to the next across and down, the diagonals (no shearing), and two down
    // (no folding back on itself)
    const links: [number, number, number, number][] = [];
    const link = (r0: number, c0: number, r1: number, c1: number) => {
      if (r1 < rows && c1 >= 0 && c1 < cols) {
        links.push([r0 * cols + c0, r1 * cols + c1, hang[r0 * cols + c0].distanceTo(hang[r1 * cols + c1]), hooks && r0 < 2 && r1 !== r0 && c1 !== c0 ? 0.02 : 1]);
      }
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      link(r, c, r, c + 1);
      link(r, c, r + 1, c);
      link(r, c, r + 1, c + 1);
      link(r, c, r + 1, c - 1);
      link(r, c, r + 2, c);
    }
    // the back, as far out as what is worn on it stands from the spine (z -0.042 in the bind pose), the hips and the legs
    // (a robe's skirt round them wider), in model metres
    const [lt, lc] = robe ? [0.15, 0.17] : [0.1, 0.08];
    const torso = THREE.MathUtils.clamp(-top - 0.042 + 0.006, 0.14, 0.157 + push); // at most where the cloth hangs at rest
    const hit: [THREE.Object3D, THREE.Object3D, number][] = [
      [byName.pelvis, byName.neck_01, torso], [byName.pelvis, byName.pelvis, 0.16],
      [byName.thigh_l, byName.calf_l, lt], [byName.calf_l, byName.foot_l, lc], [byName.thigh_r, byName.calf_r, lt], [byName.calf_r, byName.foot_r, lc],
    ];
    // the shoulder blades, which the collarbones carry back as the arms come down, and the armour over them: a sphere on
    // each collarbone there, out to what is worn (at most where the cloth hangs)
    for (const [bn, sx, rest] of [['clavicle_l', 1, clavL], ['clavicle_r', -1, clavR]] as const) {
      const m = new THREE.Object3D();
      m.position.set(sx * 0.07, 1.4, -0.035).applyMatrix4(rest);
      byName[bn].add(m);
      hit.push([m, m, THREE.MathUtils.clamp(-top - 0.035 + 0.004, 0.13, 0.164 + push)]);
    }
    // a robe's skirt standing out behind the knees, between the legs where they do not reach: a capsule down the middle
    // there, held by the pelvis, as far out as the skirt goes
    const fitLow = (o.cape.userData.cape_low as number | undefined) ?? -0.23;
    if (low < fitLow + 0.01) {
      const pelvisRest = armature.m!.getObjectByName('pelvis')!.matrixWorld.clone().invert();
      const mark = (y: number) => {
        const m = new THREE.Object3D();
        m.position.set(0, y, -0.045).applyMatrix4(pelvisRest);
        byName.pelvis.add(m);
        return m;
      };
      hit.push([mark(0.72), mark(0.46), -low - 0.045 + 0.008]);
    }
    // under each point, the three vertices of what is worn (the armour, the kit's cloth) standing out furthest behind
    // within its reach (the cells of the grid round it, inside the cape's width): the cloth between points is kept behind
    // them too. Only what the trunk and the legs carry: a pauldron goes up and back with a raised arm, and would fling the
    // cloth over the head. None for a row hooked on wings: it stays on their claws; under them, only what is about as high
    // as each point (the wings rise from under the cloth to the claws: what is higher is behind the row above)
    const dy = (hang[0].y - hang[(rows - 1) * cols].y) / (rows - 1) / (hooks ? 2 : 1);
    // where each vertex of what is worn is at rest, in the male bind pose the cape was fitted in: the armour was modelled
    // there; the kit's vertices are stored packed (another space altogether), so they are skinned to this rig's rest pose
    // and carried over by spine_03, as the cape is
    body.updateMatrixWorld(true); // the rig at rest, at the origin
    const onMale = armature.m!.getObjectByName('spine_03')!.matrixWorld.clone().multiply(byName.spine_03.matrixWorld.clone().invert());
    const rest = new Map(worn.map((m) => {
      const raw = m.bindMatrix.equals(_m.identity());
      let at = raw ? undefined : kitRest.get(m.geometry);
      if (!at) {
        const p = m.geometry.getAttribute('position');
        at = new Float32Array(p.count * 3);
        for (let k = 0; k < p.count; k++) (raw ? _v.fromBufferAttribute(p, k) : m.getVertexPosition(k, _v).applyMatrix4(onMale)).toArray(at, k * 3);
        if (!raw) kitRest.set(m.geometry, at);
      }
      return [m, at] as const;
    }));
    const anchors = hang.map((b, i) => {
      const r = Math.floor(i / cols), dx = Math.abs(hang[r * cols + 1].x - hang[r * cols].x), wide = Math.abs(hang[r * cols].x) + 0.02;
      const best: [THREE.SkinnedMesh, number, number][] = [];
      if (hooks && r === 0) return [];
      for (const m of worn) {
        const at = rest.get(m)!, si = m.geometry.getAttribute('skinIndex'), sw = m.geometry.getAttribute('skinWeight');
        const names = m.skeleton.bones.map((bn) => bn.name);
        for (let k = 0; k < at.length / 3; k++) {
          const v = _v.fromArray(at, k * 3);
          if (v.z > -0.08 || Math.abs(v.x) > wide || Math.abs(v.x - b.x) > dx || Math.abs(v.y - b.y) > dy) continue;
          let arm = 0;
          for (let j = 0; j < 4; j++) if (/arm|hand|thumb|index|middle|ring|pinky|Head/.test(names[si.getComponent(k, j)] ?? '')) arm += sw.getComponent(k, j);
          if (arm > 0.2) continue;
          best.push([m, k, v.z]);
          best.sort((u, v) => u[2] - v[2]);
          if (best.length > 3) best.pop();
        }
      }
      return best.map(([m, k]) => [m, k] as [THREE.SkinnedMesh, number]);
    });
    const frame0 = bind.map((_, i) => clothFrame(bind, rows, cols, i, new THREE.Matrix4()).transpose());
    cape = { root, body, spine: byName.spine_03, rows, cols, bones: pts, bind, frame0, home, pins, pos: bind.map(() => new THREE.Vector3()),
      prev: bind.map(() => new THREE.Vector3()), local: bind.map(() => new THREE.Vector3()), links, hit, anchors,
      spineRest: armature.m!.getObjectByName('spine_03')!.getWorldQuaternion(new THREE.Quaternion()).invert(), last: null, started: false,
      hooked: !!hooks, twist: null, lift: null, pinned: pins.map(() => new THREE.Vector3()), pinTo: pins.map(() => new THREE.Vector3()) };
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
    const model = fixed ? props[o.helm] : wantGear(o.helm as GearFile)?.getObjectByName(o.helm.startsWith('mage_') ? 'circlet' : o.helm.startsWith('light_') ? 'hood' : 'helm');
    const [y, z, s] = fixed ?? [0, 0, 1];
    if (model) attach(byName.Head, model.clone(), 0, y, z, s); // geometry and materials are shared
  }
  // a bow in the left hand (the right draws the string), any other weapon in the right; the plain bow (models.ts, while
  // a model loads) has its back towards +Z where the modelled ones have it towards +X, and is held by its string: its
  // grip goes in the fist
  if (o.bow && o.inHand && !bowNode(o.inHand)) {
    o.inHand.rotation.y += Math.PI / 2;
    o.inHand.position.x -= 0.6;
  }
  if (o.inHand) attach(o.bow ? byName.hand_l : byName.hand_r, o.inHand, o.bow ? 0.09 : -0.09, -0.02, 0.03, 0.85);
  if (o.offHand) attach(byName.hand_l, o.offHand, 0.09, -0.02, 0.03, 0.85);

  const mixer = new THREE.AnimationMixer(arm);
  const acts: Record<string, THREE.AnimationAction> = {}, w: Record<string, number> = {};
  for (const name in clips) {
    const a = (acts[name] = mixer.clipAction(clips[name]));
    a.setEffectiveWeight((w[name] = name === 'Idle_Loop' ? 1 : 0));
    a.play();
  }
  // driven by the entity's own clock (swing, death, sitting down and getting up)
  for (const n of ['Sword_Attack', 'Sword_Attack_M', 'Punch_Jab', 'Death01', 'Sitting_Enter', 'Sitting_Exit']) if (acts[n]) acts[n].timeScale = 0;
  root.scale.setScalar(o.scale);
  body.scale.set(o.bulk, 1, o.bulk);
  return {
    root, body, kind: 'humanoid', legs: [], height: top * o.scale, radius: 0.33 * o.scale * o.bulk,
    q: { mixer, acts, w, t: Infinity, armed: !!o.inHand, floor: 0, cape, dual: o.offHand ? { left: true, age: Infinity } : undefined,
      bow: o.bow ? { root, head: byName.Head, string: o.inHand ? bowString(o.inHand) : undefined, grip: o.inHand?.parent ?? undefined,
        gripRest: o.inHand?.parent?.quaternion.clone() ?? new THREE.Quaternion(), hold: 1, uaL: byName.upperarm_l, laL: byName.lowerarm_l, handL: byName.hand_l, uaR: byName.upperarm_r, laR: byName.lowerarm_r, handR: byName.hand_r, w: 0 } : undefined,
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
  // an archer neither swings nor casts with its hands up: aimBow draws the bow over the idle or the jog
  else if (s.casting && !q.bow) cur = 'Spell_Simple_Idle_Loop';
  else if (s.atkAge < ATK_MS && !q.bow) {
    // a pair of swords: every new swing (its age starts over) with the other hand
    if (q.dual) {
      if (s.atkAge < q.dual.age) q.dual.left = !q.dual.left;
      q.dual.age = s.atkAge;
    }
    cur = q.dual?.left && q.acts.Sword_Attack_M ? 'Sword_Attack_M' : atk;
    q.acts[cur].time = (s.atkAge / ATK_MS) * (clips[cur].duration - 0.02);
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
  if (q.bow) aimBow(q.bow, s, dt);
  if (q.cape) capeCloth(q.cape, s, dt);
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

  // [weapon, chest, head, gloves, legs, feet, shield, cape]
  const TIERS: Record<string, (string | null)[]> = {
    'Sin equipo': [null, null, null, null, null, null],
    NG: ['short_sword', 'apprentice_tunic', 'leather_cap', 'short_gloves', 'apprentice_stockings', 'leather_sandals', 'wooden_buckler', 'wool_cape'],
    D: ['sword_of_revolution', 'brigandine_tunic', 'brigandine_helm', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots', 'brigandine_shield', 'hunter_cape'],
    C: ['samurai_longsword', 'full_plate_armor', 'full_plate_helmet', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots', null, 'knight_cape'],
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
      [`${s}_blade`, `${s}_plate`, `${s}_helm`, `${s}_gauntlets`, `${s}_greaves`, `${s}_boots`, `${s}_shield`, `${s}_cape`],
    ])),
    // every helmet side by side, on one race (?race=, default human; ?g=f for women)
    Cascos: [null, 'brigandine_tunic', null, null, null, null],
    // every shield side by side, the same way
    Escudos: ['broadsword', 'brigandine_tunic', null, null, null, null, null],
    // each region set with its sword and its staff, side by side
    Armas: [null, null, null, null, null, null, null],
    // the archer's bows and the assassin's daggers: the plain ones, then each region set's (over its plate)
    Arcos: [null, null, null, null, null, null, null],
    // each region set's light armour (the archer's and the assassin's): hood, jerkin, bracers, leggings, treads
    ...Object.fromEntries((['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const).map((s) => [
      `Ligera ${{ abyssal: 'Abisal', ashforged: 'Ceniza', dragon: 'Dragón', glacial: 'Glacial', emerald: 'Esmeralda', infernal: 'Infernal' }[s]}`,
      [`${s}_bow`, `${s}_jerkin`, `${s}_hood`, `${s}_bracers`, `${s}_leggings`, `${s}_treads`, null, `${s}_cape`],
    ])),
    Dagas: [null, null, null, null, null, null, null],
    // the gladiator's pairs of swords, the same way: Atacar swings each hand in turn
    Duales: [null, null, null, null, null, null, null],
    // each region set's mage gear (tools/art/blender/gear.py mage_<set>), and all the crowns side by side
    ...Object.fromEntries((['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'] as const).map((s) => [
      `Místico ${{ abyssal: 'Abisal', ashforged: 'Ceniza', dragon: 'Dragón', glacial: 'Glacial', emerald: 'Esmeralda', infernal: 'Infernal' }[s]}`,
      [`${s}_staff`, `${s}_robe`, `${s}_circlet`, `${s}_gloves`, `${s}_greaves`, `${s}_shoes`, null, `${s}_cape`],
    ])),
    Coronas: [null, null, null, null, null, null, null],
    // every cape side by side, over a set's plate or robe (see it from behind: ?ry=3.14)
    Capas: [null, null, null, null, null, null, null, null],
  };
  const HELMETS = ['leather_cap', 'brigandine_helm', 'karmian_hat', 'full_plate_helmet', 'demons_circlet', 'abyssal_helm', 'ashforged_helm', 'dragon_helm', 'glacial_helm', 'emerald_helm', 'infernal_helm'];
  const STATES: Record<string, Partial<AnimState>> = { Idle: {}, Correr: { moving: true }, Atacar: {}, Castear: { casting: true }, Sentar: { sitAge: 5000 }, Morir: {} };
  let tier = p.get('tier') ?? 'NG', state = p.get('state') ?? 'Idle', since = performance.now();
  const spin = !p.has('still'), ry = Number(p.get('ry')) || 0;
  let rigs: Rig[] = [];
  const build = () => {
    for (const r of rigs) {
      scene.remove(r.root);
      r.dispose?.();
    }
    const [w, chest, ...eq] = TIERS[tier] ?? TIERS.NG;
    if (tier === 'Arcos' || tier === 'Dagas' || tier === 'Duales') {
      const race = (p.get('race') ?? 'human') as Race, g = p.get('g') === 'f' ? 'f' : 'm';
      const sets = ['abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal'];
      const bow = tier === 'Arcos';
      const kind = bow ? 'bow' : tier === 'Duales' ? 'duals' : 'dagger';
      const plain = { bow: ['short_bow', 'hunting_bow', 'composite_bow'], dagger: ['dagger', 'assassin_dagger', 'stiletto'], duals: ['short_sword_duals', 'broadsword_duals', 'revolution_duals', 'samurai_duals'] }[kind];
      const list = [...plain, ...sets.map((s) => `${s}_${kind}`)];
      rigs = list.map((w, i) => {
        const set = /^(abyssal|ashforged|dragon|glacial|emerald|infernal)_/.exec(w)?.[1];
        const rig = playerModel(race, 'fighter', w, set ? `${set}_plate` : 'brigandine_tunic', { g, hs: i % 3, hc: 0 },
          set ? [`${set}_helm`, `${set}_gauntlets`, `${set}_greaves`, `${set}_boots`, null] : ['brigandine_helm', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots', null]);
        rig.root.position.set((i - (list.length - 1) / 2) * 1.1, 0, 0);
        // a still swing (?atk=) is the right hand's; ?left holds it on the left one's
        if (p.has('left') && rig.q?.dual) rig.q.dual = { left: true, age: -Infinity };
        scene.add(rig.root);
        return rig;
      });
      return;
    }
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
    if (tier === 'Capas') {
      const race = (p.get('race') ?? 'human') as Race, g = p.get('g') === 'f' ? 'f' : 'm';
      const list = Object.keys(CAPES);
      rigs = list.map((c, i) => {
        // each set's cape over its own harness (a robe on every other one, to see it over a mage's too), the plain ones over brigandine
        const set = /^(abyssal|ashforged|dragon|glacial|emerald|infernal)_/.exec(c)?.[1];
        const chest = set ? `${set}_${i % 2 ? 'robe' : 'plate'}` : 'brigandine_tunic';
        const rig = playerModel(race, set && i % 2 ? 'mystic' : 'fighter', null, chest, { g, hs: (i % 3) + 1, hc: 0 }, [set ? `${set}_${i % 2 ? 'circlet' : 'helm'}` : null, null, null, null, null, c]);
        rig.root.position.set((i - (list.length - 1) / 2) * 1.1, 0, 0);
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
  // ?slow=0.25: time at a quarter of its pace, to see a cape's motion frame by frame
  const slow = Number(p.get('slow')) || 1, clock = () => performance.now() * slow;
  for (const name in STATES) btn(name, () => { state = name; since = clock(); });
  build();

  // ?walk=6: running, the rigs go forward at that speed (m/s) for real, the camera with them, as in the game (a cape
  // trails in still air, not in the wind it gets running in place)
  const walk = Number(p.get('walk')) || 0, walked = new THREE.Vector3();
  // ?atk=350: the attack held at that moment (ms into it), to see a pose frame by frame (an archer's draw)
  const atkAt = p.has('atk') ? Number(p.get('atk')) : undefined;
  since = clock();
  let last = clock();
  renderer.setAnimationLoop(() => {
    const now = clock(), age = now - since, dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (walk && state === 'Correr' && !spin) {
      const d = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(walk * dt);
      walked.add(d);
      cam.position.add(d);
    }
    rigs.forEach((rig, i) => {
      const at = (rig.root.userData.walked ??= new THREE.Vector3()) as THREE.Vector3; // a rig built since starts where the rest are
      rig.root.position.add(new THREE.Vector3().subVectors(walked, at));
      at.copy(walked);
      rig.root.rotation.y = spin ? now / 2500 : ry;
      animate(rig, {
        moving: false, casting: false, t: now / 1000 + i,
        atkAge: state === 'Atacar' ? (atkAt ?? age % 1100) : Infinity, deadAge: state === 'Morir' ? age : -1, ...STATES[state],
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
