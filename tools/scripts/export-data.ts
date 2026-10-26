// Exports the shared game data (shared/src) to JSON for the Rust server, so both servers and the
// client keep one source of truth. English names are resolved here, so Rust needs no overlay logic.
//   npm run export-data   (also run by the Docker builds)
import { layoutHerds } from '../../shared/src/layout';
import { writeFileSync } from 'node:fs';
import { ENCHANT, ITEMS, GRADE_LEVEL, MASTERWORK, SET_BONUS } from '../../shared/src/data/items';
import { MOBS } from '../../shared/src/data/mobs';
import { SKILLS } from '../../shared/src/data/skills';
import { dailySet, QUEST_LIST } from '../../shared/src/data/quests';
import { NPCS, TELEPORTS, ZONES } from '../../shared/src/data/world';
import { CAMPS } from '../../shared/src/data/camps';
import { CLASSES, GENDERS, RACES, START_ADENA, MAX_LEVEL, SPEC_LEVEL, SPECS, HAIR_STYLES, HAIR_COLORS } from '../../shared/src/data/classes';
import { RAIDS } from '../../shared/src/data/raids';
import { LEGEND } from '../../shared/src/data/legend';
import { CLAN, CLAN_DEFAULT_PRIVS, CLAN_GRADE_LEVEL, CLAN_LEVELS, CLAN_REP, CLAN_SKILLS } from '../../shared/src/data/clans';
import { STATUSES } from '../../shared/src/status';
import { getObstacles, WALK_RADIUS } from '../../shared/src/collision';
import { isDeep, PLAYABLE_HALF, SWIM_SPEED, TOWN, TOWNS, WATER_CELL, WORLD_HALF } from '../../shared/src/terrain';
import { allNodes, GATHER, HUT_CAP, HUT_REGEN, SIT_REGEN, STAND_UP_MS, TENT_REGEN } from '../../shared/src/nodes';
import { campName, itemName, mobName, npcLines, npcText, questField, skillName, specName, teleportName, zoneName } from '../../shared/src/i18n';

/** Deep water on the WATER_CELL grid, as runs per row: [row, firstCol, lastCol] (the server has no terrain function). */
function waterRuns(): [number, number, number][] {
  const n = (WORLD_HALF * 2) / WATER_CELL, runs: [number, number, number][] = [];
  for (let row = 0; row < n; row++) {
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const deep = col < n && isDeep(-WORLD_HALF + (col + 0.5) * WATER_CELL, -WORLD_HALF + (row + 0.5) * WATER_CELL);
      if (deep && start < 0) start = col;
      else if (!deep && start >= 0) (runs.push([row, start, col - 1]), (start = -1));
    }
  }
  return runs;
}

const out = {
  constants: { PLAYABLE_HALF, SWIM_SPEED, STAND_UP_MS, SIT_REGEN, TENT_REGEN, HUT_REGEN, HUT_CAP, WALK_RADIUS, START_ADENA, MAX_LEVEL, SPEC_LEVEL, HAIR_STYLES: HAIR_STYLES.length, HAIR_COLORS: HAIR_COLORS.length },
  town: { ...TOWN, nameEn: zoneName(TOWN.name, 'en') },
  towns: TOWNS.map((t) => ({ ...t, nameEn: zoneName(t.name, 'en') })),
  wild: { name: 'Tierras Salvajes', nameEn: zoneName('Tierras Salvajes', 'en') },
  enchant: ENCHANT,
  items: Object.values(ITEMS).map((i) => ({ ...i, nameEn: itemName(i.id, 'en') })),
  gradeLevel: GRADE_LEVEL,
  masterwork: MASTERWORK,
  setBonus: SET_BONUS,
  mobs: Object.values(MOBS).map((m) => ({ ...m, nameEn: mobName(m.id, 'en') })),
  skills: Object.values(SKILLS).map((s) => ({ ...s, nameEn: skillName(s.id, 'en') })),
  quests: QUEST_LIST.map((q) => ({ id: q.id, npc: q.npc, name: q.name, nameEn: questField(q, 'name', 'en'), minLevel: q.minLevel, objective: q.objective, xp: q.xp, adena: q.adena, evolve: q.evolve ?? false, daily: q.daily ?? false, rewards: q.rewards ?? [] })),
  npcs: NPCS.map((n) => ({
    id: n.id, name: n.name, kind: n.kind, x: n.x, z: n.z, ry: n.ry, shop: n.shop ?? null, craft: n.craft ?? null,
    title: n.title, titleEn: npcText(n.id, 'title', 'en'), greeting: n.greeting, greetingEn: npcText(n.id, 'greeting', 'en'),
    lines: npcLines(n.id, 'es'), linesEn: npcLines(n.id, 'en'), road: n.road ?? null, currency: n.currency ?? null, prices: n.prices ?? {},
  })),
  // open-country herds spawn like a small zone each (server-rs world.rs spawn_mobs)
  herds: layoutHerds().map((h) => ({ name: '', nameEn: '', x: h.x, z: h.z, r: 10, spawns: [{ mob: h.mob, count: h.count }] })),
  zones: ZONES.map((z) => ({ id: z.id, name: z.name, nameEn: zoneName(z.name, 'en'), x: z.x, z: z.z, r: z.r, spawns: z.spawns, pvp: z.pvp })),
  teleports: TELEPORTS.map((t) => ({ ...t, nameEn: teleportName(t.id, 'en') })),
  camps: CAMPS.map((c) => ({ ...c, nameEn: campName(c.id, 'en') })),
  races: Object.entries(RACES).map(([id, r]) => ({ id, classes: r.classes, mods: r.mods, mw: r.mw })),
  genders: Object.entries(GENDERS).map(([id, g]) => ({ id, mods: g.mods })),
  classes: Object.entries(CLASSES).map(([id, c]) => ({ id, ...c, startItems: c.startItems.map(([item, count, equip]) => ({ item, count, equip })) })),
  specs: (Object.keys(SPECS) as (keyof typeof SPECS)[]).map((id) => ({ id, base: SPECS[id].base, name: SPECS[id].name, nameEn: specName(id, 'en'), parent: SPECS[id].parent ?? null, block: SPECS[id].block ?? null, weapon: SPECS[id].weapon ?? null, crit: SPECS[id].crit ?? null, charges: SPECS[id].charges ?? null })),
  statuses: Object.entries(STATUSES).map(([id, s]) => ({ id, flag: s.flag })),
  raids: Object.values(RAIDS),
  // world nodes: [id, x, z, r, ry, seatY, zone]; gather rules per kind
  nodes: allNodes().map((n) => [n.id, +n.x.toFixed(2), +n.z.toFixed(2), +n.r.toFixed(2), +(n.ry ?? 0).toFixed(3), n.y ?? 0, n.zone ?? '']),
  gather: GATHER,
  clans: { levels: CLAN_LEVELS, cfg: CLAN, privs: CLAN_DEFAULT_PRIVS, gradeLevel: CLAN_GRADE_LEVEL, rep: CLAN_REP, skills: CLAN_SKILLS },
  legend: LEGEND,
  // what the client's dailySet offers on a week of days: server-rs checks its daily_set picks the same (formulas.rs test)
  dailyProbe: Array.from({ length: 7 }, (_, i) => [20000 + i, dailySet(20000 + i).map((q) => q.id)]),
  water: { cell: WATER_CELL, half: WORLD_HALF, runs: waterRuns() },
  obstacles: getObstacles().map((o) => (o.k === 'c' ? { k: 'c', x: o.x, z: o.z, r: o.r } : { k: 'b', x: o.x, z: o.z, hw: o.hw, hd: o.hd, cos: o.cos, sin: o.sin })),
};

const path = new URL('../../server-rs/data/game.json', import.meta.url);
writeFileSync(path, JSON.stringify(out));
console.log(`[export-data] ${out.items.length} items, ${out.mobs.length} mobs, ${out.skills.length} skills, ${out.quests.length} quests, ${out.obstacles.length} obstacles, ${out.nodes.length} nodes, ${out.water.runs.length} water runs -> server-rs/data/game.json`);
