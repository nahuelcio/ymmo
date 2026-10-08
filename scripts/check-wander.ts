// Self-check: no mob may "walk in place" (flagged as moving while its position stays put).
//   npx tsx scripts/check-wander.ts
// Runs the overworld with a fake clock for a few simulated minutes and fails if any mob spends
// more than two seconds moving without getting anywhere.
import assert from 'node:assert';
import { World } from '../server/src/world/World';

let clock = 1_700_000_000_000;
Date.now = () => clock;

const world = new World();
const stuck = new Map<number, { x: number; z: number; ms: number }>();
let worst = 0, worstMob = '';
for (let i = 0; i < 20 * 240; i++) {
  clock += 50;
  (world as unknown as { tick(): void }).tick(); // private: the server drives it from its own timer
  for (const m of world.mobs) {
    const s = stuck.get(m.id) ?? { x: m.x, z: m.z, ms: 0 };
    s.ms = m.moving && Math.hypot(m.x - s.x, m.z - s.z) < 0.01 ? s.ms + 50 : 0;
    s.x = m.x;
    s.z = m.z;
    stuck.set(m.id, s);
    if (s.ms > worst) (worst = s.ms), (worstMob = `${m.tpl.id} at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
  }
}
console.log(`${world.mobs.length} mobs, 240 s simulated; longest walk in place: ${worst} ms (${worstMob || 'none'})`);
assert(worst <= 2000, 'a mob walked in place');
process.exit(0);
