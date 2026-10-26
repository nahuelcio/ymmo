import type { BuffMods } from './skills';

/**
 * Legend: past the level cap (MAX_LEVEL) XP fills a Legend bar instead (server-rs legend.rs; its length is
 * formulas.rs legend_to_next). Every Legend level is a point to spend on one of these passives, up to `max` ranks
 * each: every rank adds `mods` once more (a multiplier's share, or its points). The whole tree takes LEGEND.max points.
 */
export interface LegendPassive { id: string; name: string; nameEn: string; max: number; mods: BuffMods }
export const LEGEND = {
  max: 80,
  /** adena per point spent, to take them all back (only in a town) */
  resetCost: 50_000,
  passives: [
    { id: 'might', name: 'Fuerza', nameEn: 'Might', max: 10, mods: { pAtk: 1.01 } },
    { id: 'arcana', name: 'Arcano', nameEn: 'Arcana', max: 10, mods: { mAtk: 1.01 } },
    { id: 'bulwark', name: 'Coraza', nameEn: 'Bulwark', max: 10, mods: { pDef: 1.01 } },
    { id: 'ward', name: 'Égida', nameEn: 'Ward', max: 10, mods: { mDef: 1.01 } },
    { id: 'vigor', name: 'Vitalidad', nameEn: 'Vigor', max: 10, mods: { maxHp: 1.01 } },
    { id: 'edge', name: 'Filo', nameEn: 'Edge', max: 10, mods: { crit: 0.5 } },
    { id: 'renewal', name: 'Renovación', nameEn: 'Renewal', max: 10, mods: { hpRegen: 1.03, mpRegen: 1.03 } },
    { id: 'haste', name: 'Celeridad', nameEn: 'Haste', max: 10, mods: { atkSpd: 1.005, castSpd: 1.005 } },
  ] as LegendPassive[],
};
