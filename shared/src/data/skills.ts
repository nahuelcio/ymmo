import type { ClassType } from './classes';

export interface BuffMods { pAtk?: number; pDef?: number; mAtk?: number; mDef?: number; speed?: number; atkSpd?: number }

export interface SkillDef {
  id: string;
  name: string;
  cls: ClassType;
  level: number;
  kind: 'phys' | 'magic' | 'heal' | 'buff' | 'drain';
  target: 'enemy' | 'self' | 'friend';
  /** damage multiplier for phys/magic/drain, flat heal amount for heal */
  power: number;
  mp: number;
  cooldown: number; // ms
  cast: number; // ms
  range: number;
  aoe?: number;
  aoeOnSelf?: boolean;
  buff?: { dur: number; mods: BuffMods };
  icon: string;
  color: number;
  desc: string;
}

const list: SkillDef[] = [
  // Fighter
  { id: 'power_strike', name: 'Power Strike', cls: 'fighter', level: 1, kind: 'phys', target: 'enemy', power: 1.8, mp: 8, cooldown: 5000, cast: 300, range: 2.6, icon: '💥', color: 0xffaa33, desc: 'A powerful blow. 180% damage.' },
  { id: 'mortal_blow', name: 'Mortal Blow', cls: 'fighter', level: 5, kind: 'phys', target: 'enemy', power: 2.6, mp: 12, cooldown: 8000, cast: 400, range: 2.6, icon: '🩸', color: 0xff3344, desc: 'A vicious strike. 260% damage.' },
  { id: 'rage', name: 'Rage', cls: 'fighter', level: 8, kind: 'buff', target: 'self', power: 0, mp: 15, cooldown: 120000, cast: 500, range: 0, buff: { dur: 60000, mods: { pAtk: 1.2, atkSpd: 1.15 } }, icon: '😡', color: 0xff5522, desc: 'P.Atk +20%, Atk.Spd +15% for 60s.' },
  { id: 'whirlwind', name: 'Whirlwind', cls: 'fighter', level: 11, kind: 'phys', target: 'enemy', power: 1.5, mp: 20, cooldown: 12000, cast: 500, range: 2.6, aoe: 5, aoeOnSelf: true, icon: '🌀', color: 0xdddddd, desc: 'Hits all enemies around you. 150% damage.' },
  { id: 'iron_will', name: 'Iron Will', cls: 'fighter', level: 14, kind: 'buff', target: 'self', power: 0, mp: 18, cooldown: 90000, cast: 500, range: 0, buff: { dur: 60000, mods: { pDef: 1.35, mDef: 1.2 } }, icon: '🛡️', color: 0x88aaff, desc: 'P.Def +35%, M.Def +20% for 60s.' },
  { id: 'power_smash', name: 'Power Smash', cls: 'fighter', level: 17, kind: 'phys', target: 'enemy', power: 3.4, mp: 25, cooldown: 10000, cast: 600, range: 2.6, icon: '🔥', color: 0xff7700, desc: 'Crushing strike. 340% damage.' },
  // Mystic
  { id: 'wind_strike', name: 'Wind Strike', cls: 'mystic', level: 1, kind: 'magic', target: 'enemy', power: 1.6, mp: 9, cooldown: 2500, cast: 1000, range: 20, icon: '🌪️', color: 0x9ae8ff, desc: 'Attacks with a blade of wind.' },
  { id: 'heal', name: 'Heal', cls: 'mystic', level: 1, kind: 'heal', target: 'friend', power: 70, mp: 12, cooldown: 4000, cast: 1200, range: 20, icon: '💚', color: 0x55ff77, desc: 'Restores HP to you or an ally.' },
  { id: 'ice_bolt', name: 'Ice Bolt', cls: 'mystic', level: 5, kind: 'magic', target: 'enemy', power: 2.1, mp: 14, cooldown: 3000, cast: 1300, range: 20, icon: '❄️', color: 0x66aaff, desc: 'Hurls a shard of ice.' },
  { id: 'vampiric_touch', name: 'Vampiric Touch', cls: 'mystic', level: 8, kind: 'drain', target: 'enemy', power: 1.5, mp: 16, cooldown: 6000, cast: 1200, range: 12, icon: '🦇', color: 0xaa2266, desc: 'Drains HP from the target. Heals 50% of damage.' },
  { id: 'blessing', name: 'Blessing', cls: 'mystic', level: 11, kind: 'buff', target: 'friend', power: 0, mp: 20, cooldown: 10000, cast: 1500, range: 20, buff: { dur: 180000, mods: { pAtk: 1.12, pDef: 1.15, mAtk: 1.12 } }, icon: '✨', color: 0xffee88, desc: 'P.Atk +12%, P.Def +15%, M.Atk +12% for 3 min.' },
  { id: 'aura_flare', name: 'Aura Flare', cls: 'mystic', level: 14, kind: 'magic', target: 'enemy', power: 1.8, mp: 30, cooldown: 8000, cast: 1500, range: 20, aoe: 6, icon: '☄️', color: 0xff66ff, desc: 'Explodes on the target, hitting nearby enemies.' },
  { id: 'greater_heal', name: 'Greater Heal', cls: 'mystic', level: 17, kind: 'heal', target: 'friend', power: 240, mp: 35, cooldown: 6000, cast: 2000, range: 20, icon: '💖', color: 0x88ffaa, desc: 'Restores a large amount of HP.' },
];

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(list.map((s) => [s.id, s]));

export function skillsFor(cls: ClassType, level: number): SkillDef[] {
  return list.filter((s) => s.cls === cls && s.level <= level);
}
