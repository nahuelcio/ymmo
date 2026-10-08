import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { animate, playerModel, type AnimState, type Rig } from './models';
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
/**
 * Helmets modelled in Fiend directly in the head bone's space, at real size ([up, forward, scale] stay
 * for nudging): the head spans x ±0.09, y 0..0.21 and z -0.09..0.13 from that bone.
 */
const HELMS = { HelmC: [0, 0, 1], HelmD: [0, 0, 1], karmian_hat: [0, 0, 1], demons_circlet: [0, 0, 1] } as const;
export type Helm = keyof typeof HELMS;
/** Head items with a model: which one, whether it covers the hair and whether it closes over the face (no ears or tusks). */
export const HEADGEAR: Record<string, { model: Helm; hair?: boolean; closed?: boolean }> = {
  brigandine_helm: { model: 'HelmD' }, full_plate_helmet: { model: 'HelmC', closed: true },
  karmian_hat: { model: 'karmian_hat' }, demons_circlet: { model: 'demons_circlet', hair: true },
};
/**
 * One model per weapon item, also from Fiend, built upright (+Y) with the grip at the origin. Staffs are
 * carried that way; everything else is laid along +Z like weaponMesh(), hammers and axes with the head turned to strike downwards.
 */
const WEAPONS = ['short_sword', 'broadsword', 'sword_of_revolution', 'samurai_longsword', 'apprentice_wand', 'willow_staff', 'staff_of_life', 'sages_staff', 'iron_hammer', 'war_hammer',
  'dagger', 'assassin_dagger', 'hand_axe', 'battle_axe', 'spear', 'partisan'];
const PROPS = [...Object.keys(HELMS), ...WEAPONS, 'mohawk'];
const props: Record<string, THREE.Object3D> = {};
let joints: string[] = [];
let ready = false;
let loading: Promise<void> | null = null;

export const qReady = () => ready;
/** The item's own weapon model, if it has one (geometry and materials are shared between instances). */
export const qWeapon = (item: string | null): THREE.Object3D | null => (item && WEAPONS.includes(item) ? props[item].clone() : null);

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
function headOnly(geo: THREE.BufferGeometry) {
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight'), idx = geo.index!;
  const keep = (v: number) => {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > bw) { bw = sw.getComponent(v, k); best = si.getComponent(v, k); }
    return joints[best] === 'Head' || joints[best] === 'neck_01';
  };
  const out: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    if (keep(a) || keep(b) || keep(c)) out.push(a, b, c);
  }
  geo.setIndex(out);
}

export function loadQ(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [[anims, ...gltfs], heads, rigid] = await Promise.all([
      Promise.all(['anims', ...FILES].map((f) => loader.loadAsync(`q/${f}.gltf`))),
      loader.loadAsync('q/heads.glb'),
      Promise.all(PROPS.map((f) => loader.loadAsync(`q/${f}.glb`))),
    ]);
    PROPS.forEach((name, i) => {
      const o = (props[name] = rigid[i].scene);
      o.children.forEach((c) => c.position.set(0, 0, 0));
      if (WEAPONS.includes(name) && !/staff|wand/.test(name)) o.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, /hammer|axe/.test(name) ? -Math.PI / 2 : 0, 'ZYX'));
      o.traverse((m) => {
        if (!(m instanceof THREE.Mesh)) return;
        const { color, emissive, emissiveIntensity } = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity, side: THREE.DoubleSide }); // no env map here: metal would render black
        m.castShadow = true;
      });
    });
    for (const clip of anims.animations) clips[clip.name] = clip;
    const famKeys = new Map<string, number>();
    const sources = new Map<string, THREE.Source>(); // every file loads its own copy of the shared .webp: keep one on the GPU
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
        if (mat.map && !mat.map.userData.avg) mat.map.userData.avg = avgColor(mat.map);
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
    // heads.glb names everything `<m|f>__part`; its skeletons are the same 65 joints, so the pieces bind to ours
    for (const g of ['m', 'f'] as const) {
      const get = (n: string) => heads.scene.getObjectByName(`${g}__${n}`) as THREE.SkinnedMesh;
      collect(`Head_${g}`, [get('body'), get('eyes'), get('brows')], true);
      const t = (tusks[g] = get('tusks'));
      t.material = new THREE.MeshLambertMaterial({ color: 0xf0ecd8 });
    }
    ready = true;
  })());
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
  /** weapon built along +Z with the grip at the origin */
  inHand?: THREE.Object3D | null;
}

export interface QAnim { mixer: THREE.AnimationMixer; acts: Record<string, THREE.AnimationAction>; w: Record<string, number>; t: number; armed: boolean }

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
  add(`${S}_${kit(o.chest)}_Body`, zone(o.chest));
  add(`${S}_${kit(o.chest)}_Arms`, zone(o.chest, o.gloves));
  add(`${S}_${kit(o.legs)}_Legs`, zone(o.legs));
  add(o.feet.ranger ? (o.g === 'm' ? 'Male_Ranger_Feet_Boots' : 'Female_Ranger_Feet') : `${S}_Peasant_Feet`, zone(o.feet));
  if (o.pauldron) add(o.g === 'm' ? 'Male_Ranger_Acc_Pauldron' : 'Female_Ranger_Acc_Pauldrons', zone(o.chest));
  const hair = (p: Prim): [number, number, boolean] => [o.hair, 0.9, false];
  if (o.hood !== undefined) add(`${S}_Ranger_Head_Hood`, zone({ ranger: true, dye: o.hood }));
  else if (!o.hideHair && (o.bald || HAIR[o.hairStyle])) add(o.bald ? 'Hair_Buzzed' : HAIR[o.hairStyle]!, hair);
  if (o.beard) add('Hair_Beard', hair);

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
    const [y, z, s] = HELMS[o.helm];
    attach(byName.Head, props[o.helm].clone(), 0, y, z, s); // geometry and materials are shared
  }
  if (o.inHand) attach(byName.hand_r, o.inHand, -0.09, -0.02, 0.03, 0.85);

  const mixer = new THREE.AnimationMixer(arm);
  const acts: Record<string, THREE.AnimationAction> = {}, w: Record<string, number> = {};
  for (const name in clips) {
    const a = (acts[name] = mixer.clipAction(clips[name]));
    a.setEffectiveWeight((w[name] = name === 'Idle_Loop' ? 1 : 0));
    a.play();
  }
  for (const n of ['Sword_Attack', 'Punch_Jab', 'Death01']) acts[n].timeScale = 0; // driven by the entity's own clock
  root.scale.setScalar(o.scale);
  body.scale.set(o.bulk, 1, o.bulk);
  return {
    root, body, kind: 'humanoid', legs: [], height: top * o.scale, radius: 0.33 * o.scale * o.bulk,
    q: { mixer, acts, w, t: Infinity, armed: !!o.inHand },
    dispose: () => skeletons.forEach((s) => s.dispose()),
  };
}

const ATK_MS = 700;
export function animateQ(q: QAnim, s: AnimState) {
  const dt = Math.min(0.1, Math.max(0, s.t - q.t));
  q.t = s.t;
  const atk = q.armed ? 'Sword_Attack' : 'Punch_Jab';
  let cur = 'Idle_Loop';
  if (s.deadAge >= 0) {
    cur = 'Death01';
    q.acts.Death01.time = Math.min(s.deadAge / 1000, clips.Death01.duration - 0.02);
  } else if (s.casting) cur = 'Spell_Simple_Idle_Loop';
  else if (s.atkAge < ATK_MS) {
    cur = atk;
    q.acts[atk].time = (s.atkAge / ATK_MS) * (clips[atk].duration - 0.02);
  } else if (s.moving) cur = 'Jog_Fwd_Loop';
  const k = Math.min(1, dt * 14);
  for (const n in q.acts) q.acts[n].setEffectiveWeight((q.w[n] += ((n === cur ? 1 : 0) - q.w[n]) * k));
  q.mixer.update(dt);
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
    NG: ['short_sword', 'apprentice_tunic', 'leather_cap', 'short_gloves', 'apprentice_stockings', 'leather_sandals'],
    D: ['sword_of_revolution', 'brigandine_tunic', 'brigandine_helm', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    C: ['samurai_longsword', 'full_plate_armor', 'full_plate_helmet', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    'Místico D': ['staff_of_life', 'karmian_tunic', 'karmian_hat', null, 'karmian_stockings', null],
    Hacha: ['battle_axe', 'brigandine_tunic', 'brigandine_helm', 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    Lanza: ['partisan', 'brigandine_tunic', null, 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    Daga: ['assassin_dagger', 'apprentice_tunic', 'leather_cap', 'short_gloves', 'apprentice_stockings', 'leather_sandals'],
    Martillo: ['war_hammer', 'brigandine_tunic', null, 'reinforced_gloves', 'brigandine_gaiters', 'reinforced_boots'],
    'Místico C': ['sages_staff', 'demons_tunic', 'demons_circlet', null, 'karmian_stockings', 'reinforced_boots'],
  };
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
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
    bar.remove();
  };
}
