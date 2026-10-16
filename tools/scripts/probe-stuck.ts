// Probe: is the stuck player's position consistent with the CURRENT world data?
//   npx tsx tools/scripts/probe-stuck.ts
import { readFileSync } from 'node:fs';
import { getObstacles, WALK_RADIUS } from '../../shared/src/collision';
import { heightAt, isDeep, PLAYABLE_HALF, TOWNS } from '../../shared/src/terrain';

const X = 231.9160713925649, Z = 666.1992752593223; // MagoPrueba saved position

const live = JSON.parse(readFileSync('server-rs/data/game.json', 'utf8'));
const fresh = getObstacles();
console.log(`obstacles: embedded=${live.obstacles.length} fresh=${fresh.length}`);
const key = (o: any) => `${o.k}|${o.x}|${o.z}|${o.r ?? o.hw}|${o.hd ?? ''}|${o.cos ?? ''}`;
const a = new Set(live.obstacles.map(key)), b = new Set(fresh.map(key));
const onlyEmbedded = live.obstacles.filter((o: any) => !b.has(key(o))).length;
const onlyFresh = fresh.filter((o: any) => !a.has(key(o))).length;
console.log(`diff: only-in-embedded=${onlyEmbedded} only-in-fresh=${onlyFresh}`);

console.log(`\nplayer pos (${X.toFixed(1)}, ${Z.toFixed(1)}):`);
console.log(`  heightAt=${heightAt(X, Z).toFixed(2)}  isDeep=${isDeep(X, Z)}  playableHalf=${PLAYABLE_HALF}`);
const near = fresh
  .map((o) => ({ o, d: Math.hypot(o.x - X, o.z - Z) - (o.k === 'c' ? o.r : o.hw) }))
  .filter((n) => n.d < 4)
  .sort((p, q) => p.d - q.d)
  .slice(0, 6);
for (const n of near) console.log(`  obstacle ${n.o.k} at (${n.o.x.toFixed(1)}, ${n.o.z.toFixed(1)}) gap=${n.d.toFixed(2)}m`);
if (!near.length) console.log('  no obstacles within 4m');
console.log(`  nearest towns: ${TOWNS.map((t) => `${t.name}@${Math.hypot(t.x - X, t.z - Z) | 0}m`).join(', ')}`);
console.log(`  WALK_RADIUS=${WALK_RADIUS}`);
