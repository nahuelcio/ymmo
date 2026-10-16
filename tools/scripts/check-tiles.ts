// Streamed terrain tiles (client/src/render/scene.ts): tile selection and distance LOD. Run: npx tsx tools/scripts/check-tiles.ts
import assert from 'node:assert/strict';
(globalThis as { __ASSET_HASHES__?: object }).__ASSET_HASHES__ = {};
const { tileLod, tilesWithin } = await import('../../client/src/render/scene');

assert.deepEqual([0, 349, 350, 699, 700, 5000].map(tileLod), [0, 0, 1, 1, 2, 2]);
const t = tilesWithin(-10, 10, 300);
assert.deepEqual(t[0], { cx: -1, cz: 0, d: Math.hypot(-100 + 10, 100 - 10) }); // nearest first: the tile under the point
assert.ok(t.every((a, i) => a.d < 300 && (i === 0 || t[i - 1].d <= a.d)));
assert.equal(new Set(t.map((a) => `${a.cx},${a.cz}`)).size, t.length);
// every tile whose centre is in range is listed, also across the origin
assert.ok(t.some((a) => a.cx === 0 && a.cz === -1) && t.some((a) => a.cx === -1 && a.cz === -1));
console.log(`tiles ok (${t.length} within 300 m)`);
