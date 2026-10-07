export type Race = 'human' | 'elf' | 'darkelf' | 'orc' | 'dwarf';
export type ClassType = 'fighter' | 'mystic';

export interface StatMods {
  hp: number; mp: number; pAtk: number; mAtk: number; pDef: number; mDef: number;
  speed: number; atkSpd: number; castSpd: number; evasion: number; accuracy: number; crit: number;
}

export interface RaceDef {
  name: string;
  skin: number; hair: number; height: number; bulk: number;
  classes: ClassType[];
  mods: StatMods;
  desc: string;
}

const base: StatMods = { hp: 1, mp: 1, pAtk: 1, mAtk: 1, pDef: 1, mDef: 1, speed: 1, atkSpd: 1, castSpd: 1, evasion: 0, accuracy: 0, crit: 0 };

export const RACES: Record<Race, RaceDef> = {
  human: { name: 'Human', skin: 0xe8b996, hair: 0x5a3a1e, height: 1, bulk: 1, classes: ['fighter', 'mystic'], mods: { ...base }, desc: 'Balanced in every way.' },
  elf: { name: 'Elf', skin: 0xf3d6bd, hair: 0xe8d27a, height: 1.05, bulk: 0.9, classes: ['fighter', 'mystic'],
    mods: { ...base, hp: 0.95, pAtk: 0.95, speed: 1.1, atkSpd: 1.05, castSpd: 1.1, evasion: 3, accuracy: 2, mDef: 1.05 }, desc: 'Swift and graceful.' },
  darkelf: { name: 'Dark Elf', skin: 0x9a8fa8, hair: 0xe6e6f0, height: 1.05, bulk: 0.9, classes: ['fighter', 'mystic'],
    mods: { ...base, hp: 0.9, pAtk: 1.1, mAtk: 1.12, speed: 1.05, crit: 2, pDef: 0.95 }, desc: 'Deadly but fragile.' },
  orc: { name: 'Orc', skin: 0x6f8f4e, hair: 0x2a2a2a, height: 1.12, bulk: 1.25, classes: ['fighter', 'mystic'],
    mods: { ...base, hp: 1.2, mp: 1.1, pAtk: 1.1, mAtk: 0.95, speed: 0.95, atkSpd: 0.95, evasion: -2 }, desc: 'Brutal strength and stamina.' },
  dwarf: { name: 'Dwarf', skin: 0xd9a77e, hair: 0xa0522d, height: 0.78, bulk: 1.3, classes: ['fighter'],
    mods: { ...base, hp: 1.15, pAtk: 1.05, pDef: 1.08, speed: 0.92, crit: 1 }, desc: 'Sturdy craftsmen. Fighters only.' },
};

export interface ClassDef {
  name: string;
  baseHp: number; hpLvl: number; baseMp: number; mpLvl: number; cpRatio: number;
  atkInterval: number; startItems: [string, number, boolean][];
}

export const CLASSES: Record<ClassType, ClassDef> = {
  fighter: {
    name: 'Fighter', baseHp: 100, hpLvl: 18, baseMp: 30, mpLvl: 6, cpRatio: 0.5, atkInterval: 900,
    startItems: [['short_sword', 1, true], ['apprentice_tunic', 1, true], ['apprentice_stockings', 1, true],
      ['lesser_healing_potion', 10, false], ['scroll_of_escape', 1, false]],
  },
  mystic: {
    name: 'Mystic', baseHp: 80, hpLvl: 12, baseMp: 60, mpLvl: 14, cpRatio: 0.3, atkInterval: 1200,
    startItems: [['apprentice_wand', 1, true], ['apprentice_tunic', 1, true], ['apprentice_stockings', 1, true],
      ['lesser_healing_potion', 10, false], ['mana_potion', 3, false], ['scroll_of_escape', 1, false]],
  },
};

export const START_ADENA = 500;
export const MAX_LEVEL = 20;
