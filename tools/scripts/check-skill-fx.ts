// Every skill should have its own visual signature (client/src/render/skill-fx.ts).
// Run: npx tsx tools/scripts/check-skill-fx.ts
import assert from 'node:assert/strict';
import { SKILLS } from '../../shared/src/data/skills';
import { SKILL_VFX } from '../../client/src/render/skill-fx';

const missing = Object.keys(SKILLS).filter((id) => !SKILL_VFX[id]);
assert.deepEqual(missing, [], `skills without their own effect: ${missing.join(', ')}`);
console.log(`ok: ${Object.keys(SKILLS).length} skills, each with its own effect`);
