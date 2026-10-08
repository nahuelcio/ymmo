import { RAIDS } from '../data/raids';
// Language support: Argentine Spanish (the data's native language) and English.
import { ITEMS } from '../data/items';
import { MOBS } from '../data/mobs';
import { SKILLS } from '../data/skills';
import { QUESTS, type QuestDef } from '../data/quests';
import { NPCS, TELEPORTS, ZONES } from '../data/world';
import { CLASSES, GENDERS, HAIR_STYLES, RACES, type ClassType, type Gender, type Race } from '../data/classes';
import { CAMP_BY_ID } from '../data/camps';
import { STATUSES, type StatusId } from '../status';
import { TOWN } from '../terrain';
import { EN } from './en';

export type Lang = 'es' | 'en';
export const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: 'es', label: 'Castellano (AR)', flag: '🇦🇷' },
  { id: 'en', label: 'English', flag: '🇬🇧' },
];
export const isLang = (v: unknown): v is Lang => v === 'es' || v === 'en';

type Dict = Record<string, unknown>;
const en = EN as unknown as {
  items: Record<string, { name: string; desc?: string }>; mobs: Record<string, string>; skills: Record<string, { name: string; desc: string }>;
  quests: Record<string, Record<string, string>>; npcs: Record<string, { title: string; greeting: string; lines?: string[] }>;
  zones: Record<string, string>; teleports: Record<string, string>; races: Record<string, { name: string; desc: string }>;
  classes: Record<string, string>; genders: Record<string, { name: string; desc: string }>; hairStyles: string[];
  camps: Record<string, string>; statuses: Record<string, { name: string; desc: string }>;
} & Dict;

const pick = <T>(lang: Lang, es: T, enV: T | undefined): T => (lang === 'en' && enV !== undefined ? enV : es);

export const itemName = (id: string, l: Lang) => pick(l, ITEMS[id]?.name ?? id, en.items[id]?.name);
export const itemDesc = (id: string, l: Lang) => pick(l, ITEMS[id]?.desc, en.items[id]?.desc);
export const mobName = (id: string, l: Lang) => pick(l, MOBS[id]?.name ?? id, en.mobs[id]);
export const skillName = (id: string, l: Lang) => pick(l, SKILLS[id]?.name ?? id, en.skills[id]?.name);
export const skillDesc = (id: string, l: Lang) => pick(l, SKILLS[id]?.desc ?? '', en.skills[id]?.desc);
export const raceName = (r: Race, l: Lang) => pick(l, RACES[r].name, en.races[r]?.name);
export const raceDesc = (r: Race, l: Lang) => pick(l, RACES[r].desc, en.races[r]?.desc);
export const className = (c: ClassType, l: Lang) => pick(l, CLASSES[c].name, en.classes[c]);
export const genderName = (g: Gender, l: Lang) => pick(l, GENDERS[g].name, en.genders[g]?.name);
export const genderDesc = (g: Gender, l: Lang) => pick(l, GENDERS[g].desc, en.genders[g]?.desc);
export const hairStyle = (i: number, l: Lang) => pick(l, HAIR_STYLES[i], en.hairStyles[i]);
export const campName = (id: string, l: Lang) => pick(l, CAMP_BY_ID[id]?.name ?? id, en.camps[id]);
export const statusName = (id: StatusId, l: Lang) => pick(l, STATUSES[id].name, en.statuses[id]?.name);
export const statusDesc = (id: StatusId, l: Lang) => pick(l, STATUSES[id].desc, en.statuses[id]?.desc);
export const teleportName = (id: string, l: Lang) => pick(l, TELEPORTS.find((t) => t.id === id)?.name ?? id, en.teleports[id]);

export function npcText(id: string, field: 'title' | 'greeting', l: Lang): string {
  const n = NPCS.find((x) => x.id === id);
  return pick(l, n?.[field] ?? '', en.npcs[id]?.[field]);
}
export function npcLines(id: string, l: Lang): string[] {
  const n = NPCS.find((x) => x.id === id);
  return pick(l, n?.lines ?? [n?.greeting ?? ''], en.npcs[id]?.lines);
}

/** Zone names arrive as text (Spanish); map them to the reader's language. */
export function zoneName(es: string, l: Lang): string {
  if (l === 'es') return es;
  if (es === TOWN.name) return en.zones.town;
  const raid = Object.values(RAIDS).find((r) => r.name === es);
  if (raid) return raid.nameEn;
  const z = ZONES.find((zz) => zz.name === es);
  return z ? en.zones[z.id] ?? es : es === 'Tierras Salvajes' ? en.zones.wild : es;
}

export function questField(q: QuestDef, field: 'name' | 'story' | 'offer' | 'busy' | 'ready' | 'doneText', l: Lang): string {
  return pick(l, q[field], en.quests[q.id]?.[field]);
}
export const questName = (id: string, l: Lang) => questField(QUESTS[id], 'name', l);

/** Inline bilingual string: tr(lang, 'castellano', 'english'). */
export const tr = (l: Lang, es: string, enS: string) => (l === 'en' ? enS : es);

/** "Kill 8 × Keltir" / "Bring 5 × Wolf Pelt" in the reader's language. */
export function questSummaryL(q: QuestDef, l: Lang): string {
  const o = q.objective;
  return o.type === 'kill' ? tr(l, `Matar ${o.count} × ${mobName(o.mob, l)}`, `Kill ${o.count} × ${mobName(o.mob, l)}`)
    : tr(l, `Traer ${o.count} × ${itemName(o.item, l)}`, `Bring ${o.count} × ${itemName(o.item, l)}`);
}

export function questLineL(q: QuestDef, status: 'locked' | 'available' | 'active' | 'ready' | 'done', l: Lang): string {
  if (status === 'locked') return tr(l, `Volvé cuando llegues a nivel ${q.minLevel}.`, `Come back when you reach level ${q.minLevel}.`);
  return questField(q, status === 'available' ? 'offer' : status === 'active' ? 'busy' : status === 'ready' ? 'ready' : 'doneText', l);
}
