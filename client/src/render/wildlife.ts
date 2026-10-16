// Wildlife: animals that graze, wander and bolt when you come close, a herd of the region's species around the player.
// Models: Quaternius Ultimate Animated Animal Pack (CC0) in client/public/m (see CREDITS.txt there).
// ponytail: purely cosmetic and local (each player sees their own herd, not attackable, no collision); server-side
// critters are the upgrade if players should hunt them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { heightAt, inTown, regionAt, TOWNS, WATER_LEVEL } from '../../../shared/src/terrain';
import { settings } from '../settings';

type Species = 'stag' | 'horse' | 'donkey' | 'alpaca' | 'bull' | 'cow';
/** height in metres at the withers-ish (the model's whole box) */
const HEIGHT: Record<Species, number> = { stag: 1.9, horse: 1.8, donkey: 1.4, alpaca: 1.7, bull: 1.7, cow: 1.6 };
/** who lives where; farm animals near the towns instead */
const WILD: Record<string, Species[]> = {
  dawn: ['stag', 'stag', 'horse'],
  dusk: ['stag', 'horse'],
  heart: ['horse', 'horse', 'stag'],
  dragon: ['bull'],
  frost: ['alpaca'],
};
const FARM: Species[] = ['cow', 'cow', 'donkey'];

interface Model { scene: THREE.Object3D; scale: number; clips: THREE.AnimationClip[] }
const models: Partial<Record<Species, Model>> = {};
let loading: Promise<void> | null = null;

export function loadWildlife(): Promise<void> {
  return (loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    await Promise.all((Object.keys(HEIGHT) as Species[]).map(async (s) => {
      const g = await loader.loadAsync(`m/${s}.glb`).catch((err) => (console.warn('wildlife', s, err), null));
      if (!g) return;
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // flat-coloured models: Lambert like the rest of the world, and cheap
        const src = m.material as THREE.MeshStandardMaterial;
        m.material = new THREE.MeshLambertMaterial({ color: src.color, map: src.map ?? null });
        m.castShadow = true;
      });
      const box = new THREE.Box3().setFromObject(g.scene);
      models[s] = { scene: g.scene, scale: HEIGHT[s] / Math.max(0.01, box.max.y - box.min.y), clips: g.animations };
    }));
  })());
}

interface Animal {
  sp: Species; root: THREE.Object3D; mixer: THREE.AnimationMixer;
  acts: Partial<Record<string, THREE.AnimationAction>>; cur: string;
  x: number; z: number; yaw: number; speed: number; until: number;
}

const NEAR_FARM = 160;
const COUNT = 14;

export class Wildlife {
  readonly group = new THREE.Group();
  private herd: Animal[] = [];

  private pick(x: number, z: number): Species | null {
    const farm = TOWNS.some((t) => Math.hypot(x - t.x, z - t.z) < NEAR_FARM);
    const list = farm ? FARM : WILD[regionAt(x, z) ?? ''] ?? [];
    const sp = list.length ? list[Math.floor(Math.random() * list.length)] : null;
    return sp && models[sp] ? sp : null;
  }

  private spawn(center: THREE.Vector3): void {
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 40;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (heightAt(x, z) < WATER_LEVEL + 0.5 || inTown(x, z)) continue;
      const sp = this.pick(x, z);
      if (!sp) return;
      const m = models[sp]!;
      const root = clone(m.scene);
      root.scale.setScalar(m.scale);
      const mixer = new THREE.AnimationMixer(root);
      const acts: Animal['acts'] = {};
      for (const c of m.clips) acts[c.name] = mixer.clipAction(c);
      const an: Animal = { sp, root, mixer, acts, cur: '', x, z, yaw: Math.random() * 6.3, speed: 0, until: 0 };
      this.play(an, 'Eating');
      this.group.add(root);
      this.herd.push(an);
      return;
    }
  }

  private play(an: Animal, name: string) {
    if (an.cur === name) return;
    const next = an.acts[name] ?? an.acts.Idle;
    if (!next) return;
    const prev = an.cur ? an.acts[an.cur] : undefined;
    next.reset().play();
    if (prev && prev !== next) prev.crossFadeTo(next, 0.35, false);
    an.cur = name;
  }

  private drop(i: number) {
    const an = this.herd[i];
    this.group.remove(an.root);
    an.mixer.stopAllAction();
    this.herd.splice(i, 1);
  }

  update(center: THREE.Vector3, dt: number, now: number) {
    const on = settings.s.particles;
    this.group.visible = on;
    if (!on) return;
    for (let i = this.herd.length - 1; i >= 0; i--) {
      if (Math.hypot(this.herd[i].x - center.x, this.herd[i].z - center.z) > 120) this.drop(i);
    }
    if (this.herd.length < COUNT && Math.random() < dt * 2) this.spawn(center);
    for (const an of this.herd) {
      const dx = an.x - center.x, dz = an.z - center.z, d = Math.hypot(dx, dz);
      if (d < 13) {
        // bolt: gallop straight away from the player
        an.yaw = Math.atan2(dx, dz);
        an.speed = 7;
        an.until = now + 2500;
        this.play(an, 'Gallop');
      } else if (now > an.until) {
        // calm: graze, stand, or amble a few metres
        const r = Math.random();
        if (r < 0.45) (an.speed = 0), this.play(an, 'Eating');
        else if (r < 0.7) (an.speed = 0), this.play(an, 'Idle');
        else (an.yaw += (Math.random() - 0.5) * 2), (an.speed = 1.3), this.play(an, 'Walk');
        an.until = now + 3000 + Math.random() * 6000;
      }
      if (an.speed) {
        const nx = an.x + Math.sin(an.yaw) * an.speed * dt, nz = an.z + Math.cos(an.yaw) * an.speed * dt;
        // never into the water or a town: turn around instead
        if (heightAt(nx, nz) < WATER_LEVEL + 0.3 || inTown(nx, nz)) an.yaw += Math.PI;
        else (an.x = nx), (an.z = nz);
      }
      an.root.position.set(an.x, heightAt(an.x, an.z), an.z);
      an.root.rotation.y = an.yaw;
      an.mixer.update(dt);
    }
  }
}
