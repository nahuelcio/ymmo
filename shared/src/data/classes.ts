export type Race = 'human' | 'elf' | 'darkelf' | 'orc' | 'dwarf';
export type ClassType = 'fighter' | 'mystic';
export type Gender = 'm' | 'f';

/** Character appearance chosen at creation. */
export interface Look { g: Gender; hs: number; hc: number }

export const HAIR_STYLES = ['Corto', 'Largo', 'Rodete', 'Pelado', 'Rapado', 'Cresta'];
/** index 0 = the race's natural colour */
export const HAIR_COLORS = [-1, 0x1e1a18, 0x6a3a1a, 0xe8d27a, 0xb03020, 0xe6e6f0, 0x3a5a9a];

export const DEFAULT_LOOK: Look = { g: 'm', hs: 0, hc: 0 };

export function sanitizeLook(l: Partial<Look> | undefined): Look {
  const n = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? (v as number) : 0);
  return { g: l?.g === 'f' ? 'f' : 'm', hs: n(l?.hs, HAIR_STYLES.length), hc: n(l?.hc, HAIR_COLORS.length) };
}

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
  human: { name: 'Humano', skin: 0xe8b996, hair: 0x5a3a1e, height: 1, bulk: 1, classes: ['fighter', 'mystic'], mods: { ...base }, desc: 'Equilibrado en todo.' },
  elf: { name: 'Elfo', skin: 0xf3d6bd, hair: 0xe8d27a, height: 1.05, bulk: 0.9, classes: ['fighter', 'mystic'],
    mods: { ...base, hp: 0.95, pAtk: 0.95, speed: 1.1, atkSpd: 1.05, castSpd: 1.1, evasion: 3, accuracy: 2, mDef: 1.05 }, desc: 'Rápido y elegante.' },
  darkelf: { name: 'Elfo Oscuro', skin: 0x9a8fa8, hair: 0xe6e6f0, height: 1.05, bulk: 0.9, classes: ['fighter', 'mystic'],
    mods: { ...base, hp: 0.9, pAtk: 1.1, mAtk: 1.12, speed: 1.05, crit: 2, pDef: 0.95 }, desc: 'Letal, pero frágil.' },
  orc: { name: 'Orco', skin: 0x6f8f4e, hair: 0x2a2a2a, height: 1.12, bulk: 1.25, classes: ['fighter', 'mystic'],
    mods: { ...base, hp: 1.2, mp: 1.1, pAtk: 1.1, mAtk: 0.95, speed: 0.95, atkSpd: 0.95, evasion: -2 }, desc: 'Fuerza bruta y mucho aguante.' },
  dwarf: { name: 'Enano', skin: 0xd9a77e, hair: 0xa0522d, height: 0.78, bulk: 1.3, classes: ['fighter'],
    mods: { ...base, hp: 1.15, pAtk: 1.05, pDef: 1.08, speed: 0.92, crit: 1 }, desc: 'Artesanos duros como la piedra. Solo guerreros.' },
};

export interface ClassDef {
  name: string;
  baseHp: number; hpLvl: number; baseMp: number; mpLvl: number; cpRatio: number;
  atkInterval: number; startItems: [string, number, boolean][];
}

export const CLASSES: Record<ClassType, ClassDef> = {
  fighter: {
    name: 'Guerrero', baseHp: 100, hpLvl: 18, baseMp: 30, mpLvl: 6, cpRatio: 0.5, atkInterval: 900,
    startItems: [['short_sword', 1, true], ['apprentice_tunic', 1, true], ['apprentice_stockings', 1, true],
      ['lesser_healing_potion', 10, false], ['scroll_of_escape', 1, false]],
  },
  mystic: {
    name: 'Místico', baseHp: 80, hpLvl: 12, baseMp: 60, mpLvl: 14, cpRatio: 0.3, atkInterval: 1200,
    startItems: [['apprentice_wand', 1, true], ['apprentice_tunic', 1, true], ['apprentice_stockings', 1, true],
      ['lesser_healing_potion', 10, false], ['mana_potion', 3, false], ['scroll_of_escape', 1, false]],
  },
};

/** Specialization picked once at SPEC_LEVEL: the base class stays, the spec adds its own skills. */
export type Spec = 'knight' | 'gladiator' | 'sorcerer' | 'cleric';
export interface SpecDef { name: string; base: ClassType; desc: string }
export const SPEC_LEVEL = 20;

export const SPECS: Record<Spec, SpecDef> = {
  knight: { name: 'Caballero', base: 'fighter', desc: 'Tanque. Aguanta, aturde y mantiene a los enemigos encima suyo.' },
  gladiator: { name: 'Gladiador', base: 'fighter', desc: 'Daño cuerpo a cuerpo. Golpes brutales, sangrados y furia.' },
  sorcerer: { name: 'Hechicero', base: 'mystic', desc: 'Daño mágico. Fuego, hielo y rayos sobre grupos enteros.' },
  cleric: { name: 'Clérigo', base: 'mystic', desc: 'Sanador. Curaciones grandes y bendiciones para el grupo.' },
};

export interface GenderDef { name: string; mods: StatMods; desc: string }

export const GENDERS: Record<Gender, GenderDef> = {
  m: { name: 'Masculino', mods: { ...base, hp: 1.04, pAtk: 1.03 }, desc: 'Algo más de vida y de fuerza.' },
  f: { name: 'Femenino', mods: { ...base, mp: 1.06, castSpd: 1.04, speed: 1.02, evasion: 2 }, desc: 'Algo más de velocidad, de maná y de rapidez para lanzar.' },
};

/** Combined race × gender modifiers (multiplicative %, additive flat stats). */
export function statMods(race: Race, g: Gender): StatMods {
  const r = RACES[race].mods, s = GENDERS[g].mods;
  return {
    hp: r.hp * s.hp, mp: r.mp * s.mp, pAtk: r.pAtk * s.pAtk, mAtk: r.mAtk * s.mAtk, pDef: r.pDef * s.pDef, mDef: r.mDef * s.mDef,
    speed: r.speed * s.speed, atkSpd: r.atkSpd * s.atkSpd, castSpd: r.castSpd * s.castSpd,
    evasion: r.evasion + s.evasion, accuracy: r.accuracy + s.accuracy, crit: r.crit + s.crit,
  };
}

export const START_ADENA = 500;
export const MAX_LEVEL = 50;
