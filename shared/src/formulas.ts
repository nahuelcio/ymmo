import { CLASSES, MAX_LEVEL, RACES, type ClassType, type Race } from './data/classes';
import type { ItemDef } from './data/items';
import type { MobDef } from './data/mobs';
import type { BuffMods } from './data/skills';

export interface Stats {
  maxHp: number; maxMp: number; maxCp: number;
  pAtk: number; mAtk: number; pDef: number; mDef: number;
  accuracy: number; evasion: number; crit: number;
  atkInterval: number; castMul: number; speed: number;
  hpRegen: number; mpRegen: number; cpRegen: number;
}

export const BASE_SPEED = 6;
export const MELEE_RANGE = 2.2;

export function levelMod(level: number): number {
  return 1 + (level - 1) * 0.1;
}

export function computeStats(race: Race, cls: ClassType, level: number, equipped: ItemDef[], buffs: BuffMods[]): Stats {
  const r = RACES[race].mods;
  const c = CLASSES[cls];
  const lm = levelMod(level);
  let wP = 4, wM = 4, armP = 0, armM = 0, mpBonus = 0;
  for (const it of equipped) {
    if (it.type === 'weapon') { wP = (it.pAtk ?? 0) + 4; wM = (it.mAtk ?? 0) + 4; }
    else { armP += it.pDef ?? 0; armM += it.mDef ?? 0; }
    mpBonus += it.mp ?? 0;
  }
  const b = { pAtk: 1, pDef: 1, mAtk: 1, mDef: 1, speed: 1, atkSpd: 1 };
  for (const bf of buffs) for (const k of Object.keys(bf) as (keyof BuffMods)[]) b[k] *= bf[k] ?? 1;

  const maxHp = Math.round((c.baseHp + c.hpLvl * (level - 1)) * r.hp);
  const maxMp = Math.round((c.baseMp + c.mpLvl * (level - 1)) * r.mp + mpBonus);
  const maxCp = Math.round(maxHp * c.cpRatio);
  return {
    maxHp, maxMp, maxCp,
    pAtk: Math.round(wP * lm * r.pAtk * b.pAtk),
    mAtk: Math.round(wM * lm * r.mAtk * b.mAtk * (cls === 'mystic' ? 1 : 0.6)),
    pDef: Math.round((20 + armP) * lm * r.pDef * b.pDef),
    mDef: Math.round((15 + armM) * lm * r.mDef * b.mDef),
    accuracy: 80 + level + r.accuracy,
    evasion: 30 + level + r.evasion,
    crit: (cls === 'fighter' ? 8 : 4) + r.crit,
    atkInterval: Math.round(c.atkInterval / (r.atkSpd * b.atkSpd)),
    castMul: 1 / r.castSpd,
    speed: BASE_SPEED * r.speed * b.speed,
    hpRegen: maxHp * 0.008 + 0.5,
    mpRegen: maxMp * (cls === 'mystic' ? 0.015 : 0.01) + 0.3,
    cpRegen: maxCp * 0.03,
  };
}

export function mobStats(m: MobDef) {
  const l = m.level;
  const def = Math.round((30 + 3 * l) * (m.defMult ?? 1));
  return {
    maxHp: Math.round((50 + 15 * l + 1.5 * l * l) * (m.hpMult ?? 1)),
    pAtk: Math.round((4 + 3 * l) * (m.atkMult ?? 1)),
    pDef: def,
    mDef: def,
    accuracy: 80 + l,
    evasion: 30 + l,
    crit: 3,
  };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function hitChance(accuracy: number, evasion: number): number {
  return Math.min(0.98, Math.max(0.6, 0.9 + (accuracy - evasion - 50) * 0.01));
}

export function physDamage(pAtk: number, pDef: number, mult: number, crit: boolean): number {
  return Math.max(1, Math.round(((70 * pAtk) / Math.max(1, pDef)) * mult * rand(0.9, 1.1) * (crit ? 2 : 1)));
}

export function magicDamage(mAtk: number, mDef: number, mult: number, crit: boolean): number {
  return Math.max(1, Math.round(((70 * mAtk) / Math.max(1, mDef)) * mult * rand(0.92, 1.08) * (crit ? 1.8 : 1)));
}

export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(80 * Math.pow(level, 2.2));
}

export function mobXp(m: MobDef): number {
  return Math.round((25 * Math.pow(m.level, 1.9) + 5) * Math.pow(m.hpMult ?? 1, 0.85));
}

export function levelPenalty(playerLvl: number, mobLvl: number): number {
  const diff = playerLvl - mobLvl;
  if (diff <= 5) return 1;
  return Math.max(0.05, 1 - (diff - 5) * 0.2);
}

export const PARTY_BONUS = [1, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8];
export const MAX_PARTY = 9;
export const PVP_FLAG_MS = 30000;
export const KARMA_PER_PK = 360;
