// The towns' kit buildings stay off their plazas, roads, walls and residents (shared/src/village.ts).
// Run: npx tsx tools/scripts/check-towns.ts
import assert from 'node:assert/strict';
import { albaIssues, fortIssues, FORTS } from '../../shared/src/village';

assert.deepEqual(albaIssues(), [], 'Alba');
for (const f of FORTS) assert.deepEqual(fortIssues(f), [], f.town.name);
console.log(`ok: Alba and ${FORTS.length} forts are clear`);

// The continent (shared/src/terrain.ts): towns, zones and everything placed in them stand on dry land, the roads join
// every town to every other and stay out of the water, the shore ends before the playable edge.
import { heightAt, landAt, PLAYABLE_HALF, regionAt, REGIONS, ROAD_SEGS, SWIM_Y, TOWNS, WATER_LEVEL } from '../../shared/src/terrain';
import { NPCS, TELEPORTS, ZONES } from '../../shared/src/data/world';
import { CAMPS } from '../../shared/src/data/camps';
import { RAIDS } from '../../shared/src/data/raids';

const dry = (x: number, z: number) => landAt(x, z) > 0.9 && heightAt(x, z) > WATER_LEVEL + 1;
for (const p of [...TOWNS, ...ZONES]) assert.ok(dry(p.x, p.z), `${p.name} centre is not dry land`);
for (const p of [...NPCS, ...CAMPS]) assert.ok(heightAt(p.x, p.z) > WATER_LEVEL, `${p.id} stands in water`);
for (const t of TELEPORTS) assert.ok(heightAt(t.x, t.z) > SWIM_Y, `teleport ${t.id} drops into deep water`);
for (const r of Object.values(RAIDS)) assert.ok(heightAt(r.entry.x, r.entry.z) > SWIM_Y, `raid ${r.id} entry in deep water`);
for (const zn of ZONES) {
  let ok = 0, n = 0;
  for (let a = 0; a < 24; a++) for (const k of [0.3, 0.6, 0.9]) (n++, (ok += +dry(zn.x + Math.cos(a / 3.82) * zn.r * k, zn.z + Math.sin(a / 3.82) * zn.r * k)));
  assert.ok(ok / n >= 0.75, `${zn.id} is only ${((100 * ok) / n).toFixed(0)}% dry land`);
}
// the shore ends before the edge walkers are clamped to
for (let s = -PLAYABLE_HALF; s <= PLAYABLE_HALF; s += 20)
  for (const [x, z] of [[s, -PLAYABLE_HALF], [s, PLAYABLE_HALF], [-PLAYABLE_HALF, s], [PLAYABLE_HALF, s]]) assert.equal(landAt(x, z), 0, `land at the edge (${x}, ${z})`);
// roads: never deep water, and one network (a vertex joins any segment it lies on)
let wet = 0;
for (const [ax, az, bx, bz] of ROAD_SEGS) for (let t = 0; t <= 1; t += 2 / Math.hypot(bx - ax, bz - az)) if (heightAt(ax + (bx - ax) * t, az + (bz - az) * t) < SWIM_Y) wet++;
assert.equal(wet, 0, `${wet} road samples in deep water`);
const onSeg = (x: number, z: number, [ax, az, bx, bz]: number[]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz) < 1;
};
const seen = new Set<number>([ROAD_SEGS.findIndex((s) => onSeg(TOWNS[0].x, TOWNS[0].z, s))]);
for (let grew = true; grew; ) {
  grew = false;
  for (let i = 0; i < ROAD_SEGS.length; i++) {
    if (seen.has(i)) continue;
    const s = ROAD_SEGS[i];
    if ([...seen].some((j) => { const o = ROAD_SEGS[j]; return onSeg(s[0], s[1], o) || onSeg(s[2], s[3], o) || onSeg(o[0], o[1], s) || onSeg(o[2], o[3], s); })) (seen.add(i), (grew = true));
  }
}
assert.equal(seen.size, ROAD_SEGS.length, 'a road is cut off from the rest');
for (const t of TOWNS) assert.ok(ROAD_SEGS.some((s) => onSeg(t.x, t.z, s)), `${t.name} has no road`);
// south to north: each town in its own region, the regions' levels rising northward
assert.deepEqual(TOWNS.map((t) => regionAt(t.x, t.z)), ['dawn', 'dusk', 'frost', 'swamp', 'ash']);
assert.deepEqual(REGIONS.map((r) => regionAt(r.x, r.z)), REGIONS.map((r) => r.id));
const t0 = performance.now();
let sum = 0;
for (let i = 0; i < 1e6; i++) sum += heightAt(((i * 7919) % 4000) - 2000, ((i * 104729) % 4000) - 2000);
console.log(`ok: towns, zones, folk, camps and raids on dry land; ${ROAD_SEGS.length} road segments joined and dry; heightAt ${((performance.now() - t0) / 1000).toFixed(2)} µs/call (${sum.toFixed(0)})`);
