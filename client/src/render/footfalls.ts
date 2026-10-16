// Footfalls: when in a walk or run cycle each foot lands, so a footstep sounds the moment the foot meets the ground
// (game.ts footfall) instead of every so many metres.
import * as THREE from 'three';

const SAMPLES = 64;
const cache = new Map<string, number[]>();

/**
 * The moments (0..1 of the clip) the feet land in a looping walk or run `clip`, played on `model` (a copy that is not
 * in the scene: its pose is overwritten). Each foot lands once per cycle: the first moment after its highest point at
 * which it is back within 15% of its swing above its lowest. Cached by clip and feet.
 */
export function contactPhases(model: THREE.Object3D, clip: THREE.AnimationClip, feet: THREE.Object3D[]): number[] {
  const key = `${clip.uuid}:${feet.map((f) => f.name).join()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mixer = new THREE.AnimationMixer(model), act = mixer.clipAction(clip);
  act.play();
  const heights = feet.map(() => new Float32Array(SAMPLES)), p = new THREE.Vector3();
  for (let i = 0; i < SAMPLES; i++) {
    mixer.setTime((i / SAMPLES) * clip.duration);
    model.updateMatrixWorld(true);
    feet.forEach((f, k) => (heights[k][i] = f.getWorldPosition(p).y));
  }
  act.stop();
  mixer.uncacheRoot(model);
  const out: number[] = [];
  for (const h of heights) {
    let lo = 0, hi = 0;
    for (let i = 1; i < SAMPLES; i++) {
      if (h[i] < h[lo]) lo = i;
      if (h[i] > h[hi]) hi = i;
    }
    const swing = h[hi] - h[lo];
    if (swing < 1e-4) continue; // a foot that never lifts
    for (let j = 1; j <= SAMPLES; j++) {
      const i = (hi + j) % SAMPLES;
      if (h[i] <= h[lo] + swing * 0.15) {
        out.push(i / SAMPLES);
        break;
      }
    }
  }
  // a foot and its toes (or two bones of one paw) land together: one footfall
  out.sort((a, b) => a - b);
  const phases = out.filter((c, i) => i === 0 || c - out[i - 1] > 0.06).filter((c, i, a) => !(i === a.length - 1 && a.length > 1 && a[0] + 1 - c <= 0.06));
  if (!phases.length) phases.push(0, 0.5);
  cache.set(key, phases);
  return phases;
}

/** How many of `phases` (0..1) the cycle passed going from p0 to p1 this frame (it may have looped round). */
export function crossed(p0: number, p1: number, phases: number[]): number {
  let n = 0;
  for (const c of phases) {
    if (p1 >= p0 ? c > p0 && c <= p1 : c > p0 || c <= p1) n++;
  }
  return n;
}
