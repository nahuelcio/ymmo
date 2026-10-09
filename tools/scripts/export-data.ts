// Exports the shared game data (shared/src) to JSON for the Rust server, so both servers and the
// client keep one source of truth. English names are resolved here, so Rust needs no overlay logic.
//   npm run export-data   (also run by `npm run build:rs`)
import { writeFileSync } from 'node:fs';
import { ENCHANT, ITEMS } from '../shared/src/data/items';
import { MOBS } from '../shared/src/data/mobs';
import { SKILLS } from '../shared/src/data/skills';
import { QUEST_LIST } from '../shared/src/data/quests';
import { NPCS, TELEPORTS, ZONES } from '../shared/src/data/world';
import { CAMPS } from '../shared/src/data/camps';
import { CLASSES, GENDERS, RACES, START_ADENA, MAX_LEVEL, SPEC_LEVEL, SPECS, HAIR_STYLES, HAIR_COLORS } from '../shared/src/data/classes';
import { RAIDS } from '../shared/src/data/raids';
import { STATUSES } from '../shared/src/status';
import { getObstacles, WALK_RADIUS } from '../shared/src/collision';
import { PLAYABLE_HALF, TOWN, TOWNS } from '../shared/src/terrain';
import { campName, itemName, mobName, npcLines, npcText, questField, skillName, specName, teleportName, zoneName } from '../shared/src/i18n';

const out = {
  constants: { PLAYABLE_HALF, WALK_RADIUS, START_ADENA, MAX_LEVEL, SPEC_LEVEL, HAIR_STYLES: HAIR_STYLES.length, HAIR_COLORS: HAIR_COLORS.length },
  town: { ...TOWN, nameEn: zoneName(TOWN.name, 'en') },
  towns: TOWNS.map((t) => ({ ...t, nameEn: zoneName(t.name, 'en') })),
  wild: { name: 'Tierras Salvajes', nameEn: zoneName('Tierras Salvajes', 'en') },
  enchant: ENCHANT,
  items: Object.values(ITEMS).map((i) => ({ ...i, nameEn: itemName(i.id, 'en') })),
  mobs: Object.values(MOBS).map((m) => ({ ...m, nameEn: mobName(m.id, 'en') })),
  skills: Object.values(SKILLS).map((s) => ({ ...s, nameEn: skillName(s.id, 'en') })),
  quests: QUEST_LIST.map((q) => ({ id: q.id, npc: q.npc, name: q.name, nameEn: questField(q, 'name', 'en'), minLevel: q.minLevel, objective: q.objective, xp: q.xp, adena: q.adena })),
  npcs: NPCS.map((n) => ({
    id: n.id, name: n.name, kind: n.kind, x: n.x, z: n.z, ry: n.ry, shop: n.shop ?? null, craft: n.craft ?? null,
    title: n.title, titleEn: npcText(n.id, 'title', 'en'), greeting: n.greeting, greetingEn: npcText(n.id, 'greeting', 'en'),
    lines: npcLines(n.id, 'es'), linesEn: npcLines(n.id, 'en'),
  })),
  zones: ZONES.map((z) => ({ id: z.id, name: z.name, nameEn: zoneName(z.name, 'en'), x: z.x, z: z.z, r: z.r, spawns: z.spawns })),
  teleports: TELEPORTS.map((t) => ({ ...t, nameEn: teleportName(t.id, 'en') })),
  camps: CAMPS.map((c) => ({ ...c, nameEn: campName(c.id, 'en') })),
  races: Object.entries(RACES).map(([id, r]) => ({ id, classes: r.classes, mods: r.mods })),
  genders: Object.entries(GENDERS).map(([id, g]) => ({ id, mods: g.mods })),
  classes: Object.entries(CLASSES).map(([id, c]) => ({ id, ...c, startItems: c.startItems.map(([item, count, equip]) => ({ item, count, equip })) })),
  specs: (Object.keys(SPECS) as (keyof typeof SPECS)[]).map((id) => ({ id, base: SPECS[id].base, name: SPECS[id].name, nameEn: specName(id, 'en') })),
  statuses: Object.entries(STATUSES).map(([id, s]) => ({ id, flag: s.flag })),
  raids: Object.values(RAIDS),
  obstacles: getObstacles().map((o) => (o.k === 'c' ? { k: 'c', x: o.x, z: o.z, r: o.r } : { k: 'b', x: o.x, z: o.z, hw: o.hw, hd: o.hd, cos: o.cos, sin: o.sin })),
};

const path = new URL('../server-rs/data/game.json', import.meta.url);
writeFileSync(path, JSON.stringify(out));
console.log(`[export-data] ${out.items.length} items, ${out.mobs.length} mobs, ${out.skills.length} skills, ${out.quests.length} quests, ${out.obstacles.length} obstacles -> server-rs/data/game.json`);
