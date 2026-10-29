// The summoner's servitors (data/classes.ts summoner and arcana_lord): called by a summon skill (data/skills.ts kind
// 'summon'), at its owner's level, as many at its side at once as its level allows (SERVITOR_SLOTS), each a different one. It follows its owner, fights what it is told to, and uses
// its own skills when its owner presses them (its panel, or the bars). server-rs pet.rs runs it.
import { SKILLS, type SkillDef } from './skills';

export interface ServitorDef {
  id: string;
  name: string;
  nameEn: string;
  /** the owner level its summon is learned at */
  level: number;
  /** melee: it bites at arm's length; caster: magic bolts from afar; support: it looks after its owner */
  role: 'melee' | 'caster' | 'support';
  /** multipliers on a same-level mob's curves (server-rs formulas.rs pet_stats); matk: its magic, which mobs have none of */
  hpMult: number; mpMult: number; atkMult: number; matkMult: number; defMult: number;
  /** ms between its auto-attacks, how far they reach, and how fast it runs */
  atkInterval: number; range: number; speed: number;
  /** its size against the model's (client render/servitors.ts) */
  scale: number;
  /** its own skills (PET_SKILLS), in the order its panel shows them */
  skills: string[];
  icon: string;
  color: number;
  desc: string;
  descEn: string;
}

const list: ServitorDef[] = [
  { id: 'war_wolf', name: 'Lobo de Guerra', nameEn: 'War Wolf', level: 20, role: 'melee', hpMult: 1.4, mpMult: 0.8, atkMult: 0.9, matkMult: 0.5, defMult: 1.3,
    atkInterval: 1300, range: 2.4, speed: 7, scale: 1.15, skills: ['wolf_bite', 'wolf_howl'], icon: '🐺', color: 0x6a7aa8,
    desc: 'Un lobo rúnico: aguanta los golpes, muerde con fuerza y llama la atención de los enemigos.', descEn: 'A runic wolf: it takes the blows, bites hard and draws the enemies to itself.' },
  { id: 'mirage', name: 'Espejismo', nameEn: 'Mirage', level: 35, role: 'caster', hpMult: 1, mpMult: 1.3, atkMult: 0.5, matkMult: 1.15, defMult: 1,
    atkInterval: 1700, range: 14, speed: 7, scale: 1, skills: ['water_lance', 'whirlpool'], icon: '🦄', color: 0x7ad0ff,
    desc: 'Un unicornio de agua que ataca con magia desde lejos.', descEn: 'A unicorn of water that strikes with magic from afar.' },
  { id: 'soulless', name: 'Sin Alma', nameEn: 'Soulless', level: 50, role: 'caster', hpMult: 1.1, mpMult: 1.2, atkMult: 0.6, matkMult: 1.1, defMult: 1.1,
    atkInterval: 1700, range: 12, speed: 7, scale: 1, skills: ['toxic_smoke', 'shadow_touch'], icon: '👻', color: 0x7ac87a,
    desc: 'Un espectro que envenena a grupos enteros y les roba la vida.', descEn: 'A spectre that poisons whole packs and drinks their life.' },
  { id: 'seraphim', name: 'Serafín', nameEn: 'Seraphim', level: 60, role: 'support', hpMult: 1, mpMult: 1.5, atkMult: 0.5, matkMult: 0.8, defMult: 1.1,
    atkInterval: 2200, range: 14, speed: 7, scale: 1, skills: ['seraph_blessing', 'healing_light', 'aegis'], icon: '🕊️', color: 0xfff0b0,
    desc: 'Un unicornio de luz que cuida de su invocador: lo cura y lo bendice.', descEn: 'A unicorn of light that looks after its summoner: it heals and blesses them.' },
  { id: 'spectral_lord', name: 'Señor Espectral', nameEn: 'Spectral Lord', level: 76, role: 'melee', hpMult: 1.8, mpMult: 1.2, atkMult: 1.35, matkMult: 1, defMult: 1.5,
    atkInterval: 1400, range: 2.8, speed: 7, scale: 1.1, skills: ['spectral_strike', 'abyss_cry', 'spectral_pact'], icon: '💀', color: 0xb0a0ff,
    desc: 'Un coloso de ultratumba atado al Señor Arcano: pelea como un jefe.', descEn: 'A colossus from beyond the grave bound to the Arcana Lord: it fights like a boss.' },
];

export const SERVITORS: Record<string, ServitorDef> = Object.fromEntries(list.map((s) => [s.id, s]));

/** How many servitors a summoner may have out at once, from what level (server-rs pet.rs summon_pet): one more past
 * that sends the one out longest away. */
export const SERVITOR_SLOTS: { level: number; n: number }[] = [{ level: 1, n: 1 }, { level: 40, n: 2 }, { level: 70, n: 3 }];
export const servitorSlots = (level: number) => SERVITOR_SLOTS.filter((s) => level >= s.level).at(-1)?.n ?? 1;

/** The servitors' own skills, shaped as the players' (their numbers on the servitor's stats); target enemy: what it is
 * fighting (or its owner's target), owner: its summoner, self: itself. English in i18n/en.ts skills, like the players'. */
const petList: SkillDef[] = [
  // War Wolf
  { id: 'wolf_bite', name: 'Mordisco Desgarrador', level: 20, kind: 'phys', target: 'enemy', power: 2.2, mp: 20, cooldown: 8000, cast: 300, range: 2.6, status: { id: 'bleed', ms: 6000, dot: 0.2 }, icon: '🦷', color: 0xd04a4a, desc: '220% de daño y sangrado durante 6 s.' },
  { id: 'wolf_howl', name: 'Aullido', level: 20, kind: 'taunt', target: 'self', power: 0, mp: 25, cooldown: 15000, cast: 300, range: 0, aoe: 8, icon: '🌕', color: 0xc0c8e8, desc: 'Aúlla: los enemigos a 8 m le pasan a pegar al lobo durante 4 s.' },
  // Mirage
  { id: 'water_lance', name: 'Lanza de Agua', level: 35, kind: 'magic', target: 'enemy', power: 2.6, mp: 25, cooldown: 5000, cast: 1200, range: 20, icon: '🌊', color: 0x5ab0ff, desc: 'Una lanza de agua. 260% de daño.' },
  { id: 'whirlpool', name: 'Remolino', level: 35, kind: 'magic', target: 'enemy', power: 1.8, mp: 40, cooldown: 12000, cast: 1500, range: 20, aoe: 5, status: { id: 'slow', ms: 3000 }, icon: '🌀', color: 0x7ad0ff, desc: '180% de daño al objetivo y a los que tiene cerca, y los ralentiza 3 s.' },
  // Soulless
  { id: 'toxic_smoke', name: 'Humo Tóxico', level: 50, kind: 'magic', target: 'enemy', power: 1.5, mp: 40, cooldown: 12000, cast: 1200, range: 20, aoe: 6, status: { id: 'poison', ms: 8000, dot: 0.3 }, icon: '🌫️', color: 0x7ac83a, desc: '150% de daño al objetivo y a los que tiene cerca, y veneno durante 8 s.' },
  { id: 'shadow_touch', name: 'Toque Sombrío', level: 50, kind: 'drain', target: 'enemy', power: 2.2, mp: 30, cooldown: 8000, cast: 1000, range: 14, icon: '🖤', color: 0x6a4a8a, desc: '220% de daño, y el Sin Alma se cura la mitad.' },
  // Seraphim
  { id: 'seraph_blessing', name: 'Bendición del Serafín', level: 60, kind: 'buff', target: 'owner', power: 0, mp: 40, cooldown: 30000, cast: 1000, range: 20, buff: { dur: 300000, mods: { mAtk: 1.15, castSpd: 1.15 } }, icon: '✨', color: 0xfff0b0, desc: 'Atq.M y vel. de casteo +15% a su invocador durante 5 min.' },
  { id: 'healing_light', name: 'Luz Sanadora', level: 60, kind: 'heal', target: 'owner', power: 180, mp: 40, cooldown: 10000, cast: 1500, range: 20, icon: '💛', color: 0xffee66, desc: 'Cura a su invocador.' },
  { id: 'aegis', name: 'Égida', level: 60, kind: 'buff', target: 'owner', power: 0, mp: 40, cooldown: 30000, cast: 1000, range: 20, buff: { dur: 300000, mods: { pDef: 1.25, mDef: 1.25 } }, icon: '🔰', color: 0x9ad0ff, desc: 'Def.F y Def.M +25% a su invocador durante 5 min.' },
  // Spectral Lord
  { id: 'spectral_strike', name: 'Golpe Espectral', level: 76, kind: 'phys', target: 'enemy', power: 3.5, mp: 40, cooldown: 8000, cast: 400, range: 2.8, icon: '👊', color: 0xb0a0ff, desc: 'Un golpe de ultratumba. 350% de daño.' },
  { id: 'abyss_cry', name: 'Grito del Abismo', level: 76, kind: 'magic', target: 'enemy', power: 2, mp: 60, cooldown: 20000, cast: 600, range: 2.8, aoe: 6, aoeOnSelf: true, status: { id: 'stun', ms: 2000 }, icon: '😱', color: 0x7a5aaa, desc: '200% de daño a todo lo que lo rodea y lo aturde 2 s.' },
  { id: 'spectral_pact', name: 'Pacto Espectral', level: 76, kind: 'buff', target: 'owner', power: 0, mp: 50, cooldown: 60000, cast: 800, range: 20, buff: { dur: 300000, mods: { pAtk: 1.2, mAtk: 1.2 } }, icon: '🤝', color: 0x9a8aff, desc: 'Atq.F y Atq.M +20% a su invocador durante 5 min.' },
];

export const PET_SKILLS: Record<string, SkillDef> = Object.fromEntries(petList.map((s) => [s.id, s]));

/** A player's skill or a servitor's: what an icon, a tooltip or a cast on screen needs, whoever casts it. */
export const anySkill = (id: string): SkillDef | undefined => SKILLS[id] ?? PET_SKILLS[id];

/** The servitor a skill of this id summons, if it is a summon. */
export const summonOf = (id: string): ServitorDef | undefined => SERVITORS[SKILLS[id]?.summon ?? ''];
