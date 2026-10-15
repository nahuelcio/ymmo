// The towns' kit buildings stay off their plazas, roads, walls and residents (shared/src/village.ts).
// Run: npx tsx tools/scripts/check-towns.ts
import assert from 'node:assert/strict';
import { albaIssues, fortIssues, FORTS } from '../../shared/src/village';

assert.deepEqual(albaIssues(), [], 'Alba');
for (const f of FORTS) assert.deepEqual(fortIssues(f), [], f.town.name);
console.log(`ok: Alba and ${FORTS.length} forts are clear`);
