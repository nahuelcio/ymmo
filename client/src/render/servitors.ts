import * as THREE from 'three';
import { SERVITORS } from '../../../shared/src/data/servitors';
import { glbRig, STEED, type GlbLook } from './mobs';
import { mobModel, type Rig } from './models';

/**
 * The summoner's servitors (shared/src/data/servitors.ts): their own models, made with Tripo and set onto the mobs'
 * skeletons (render/mobs.ts AI_DONOR): an armoured wolf, a water unicorn, a winged one, a hooded wraith and a spectral
 * knight. Without them (`?ai=0`, or a file that failed) the mobs' own models dressed as they were: a runic wolf, two
 * unicorns (the horse, standing alert, with a horn), a spectre and a ghostly golem. Until the models load, the mob each
 * looks like stands in for it.
 */
interface ServitorLook extends GlbLook {
  /** its own model, before the dressed mob */
  ai?: GlbLook;
  /** a unicorn's horn on its Head bone, this colour */
  horn?: number;
  /** the mob drawn while the models load */
  stand: string;
}

const SERVITOR_LOOK: Record<string, ServitorLook> = {
  war_wolf: { ai: { model: 'ai_war_wolf', height: 1.45 }, model: 'wolf', height: 1.3, tint: { Main: 0x3a4660, Main_Light: 0x7a8ab8, Eyes_Black: 0x60c8ff }, glow: 0x08142a, stand: 'war_wolf' },
  mirage: { ai: { model: 'ai_mirage', height: 2.0, clips: STEED }, model: 'horse', height: 1.8, clips: STEED, pale: 1.5, dye: 0xa8dcff, glow: 0x0a2a4a, horn: 0x9ae0ff, stand: 'wild_horse' },
  soulless: { ai: { model: 'ai_soulless', height: 1.9, ghost: true, opacity: 0.85, kind: 'humanoid' }, model: 'skeleton_mage', height: 1.9, ghost: true, dye: 0xb8ffc0, glow: 0x2a8a3a, kind: 'humanoid', stand: 'ruin_wraith' },
  seraphim: { ai: { model: 'ai_seraphim', height: 2.0, clips: STEED }, model: 'horse', height: 1.8, clips: STEED, pale: 2, dye: 0xfff8ec, glow: 0x3a2a08, horn: 0xffe08a, stand: 'wild_horse' },
  spectral_lord: { ai: { model: 'ai_spectral_lord', height: 2.5, ghost: true, opacity: 0.85, hover: false, kind: 'humanoid', clips: { idle: 'Idle_A', attack: 'Melee_Unarmed_Attack_Punch_A', death: 'Death_A' } }, model: 'golem', height: 2.3, rock: 4, dye: 0xc8b8ff, glow: 0x3a1a8a, ghost: true, kind: 'humanoid', stand: 'fire_elemental' },
};

/** A unicorn's horn: a spiralled cone from the forehead, forward and up, fixed to the Head bone. */
function addHorn(rig: Rig, color: number) {
  let head: THREE.Object3D | undefined;
  rig.root.traverse((o) => { if (!head && (o as THREE.Bone).isBone && /^Head$/.test(o.name)) head = o; });
  if (!head) return;
  rig.root.updateMatrixWorld(true);
  const k = rig.height / 1.8;
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.065 * k, 0.55 * k, 10, 4), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6 }));
  horn.castShadow = true;
  // set in world space at bind pose (the model faces +z), then hung on the bone as it is
  const at = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
  horn.position.copy(at).add(new THREE.Vector3(0, 0.2 * k, 0.16 * k));
  horn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.75, 0.66).normalize());
  rig.root.add(horn);
  horn.updateMatrixWorld(true);
  head.attach(horn);
}

/** A servitor's model: its own, else its look on the mob models (the unicorns' horn then), else the mob it looks like
 * while they load. */
export function servitorModel(tpl: string): Rig {
  const l = SERVITOR_LOOK[tpl] ?? SERVITOR_LOOK.war_wolf, scale = SERVITORS[tpl]?.scale ?? 1;
  const own = l.ai && glbRig(l.ai, scale, `pet:${tpl}:ai`);
  if (own) return own;
  const rig = glbRig(l, scale, `pet:${tpl}`);
  if (!rig) return mobModel(l.stand);
  if (l.horn !== undefined) addHorn(rig, l.horn);
  return rig;
}
