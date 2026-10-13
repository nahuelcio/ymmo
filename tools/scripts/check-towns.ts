// The towns' kit buildings stay off their plazas, roads, walls and residents (shared/src/village.ts).
// Run: npx tsx tools/scripts/check-towns.ts
import assert from 'node:assert/strict';
import { albaIssues, duskIssues } from '../../shared/src/village';

assert.deepEqual(albaIssues(), [], 'Alba');
assert.deepEqual(duskIssues(), [], 'Bastión del Ocaso');
console.log('ok: both town plans are clear');
