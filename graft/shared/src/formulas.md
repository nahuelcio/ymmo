# shared/src/formulas.ts

- Stats · interface · L6-L12 — interface Stats
- levelMod · function · L17-L19 — function levelMod(level: number): number
- computeStats · function · L21-L53 — function computeStats(race: Race, cls: ClassType, level: number, equipped: ItemDef[], buffs: BuffMods[], gender: Gender = 'm'): Stats
- mobStats · function · L55-L67 — function mobStats(m: MobDef)
- rand · function · L69-L69 — rand = (a: number, b: number)
- hitChance · function · L71-L73 — function hitChance(accuracy: number, evasion: number): number
- physDamage · function · L75-L77 — function physDamage(pAtk: number, pDef: number, mult: number, crit: boolean): number
- magicDamage · function · L79-L81 — function magicDamage(mAtk: number, mDef: number, mult: number, crit: boolean): number
- xpToNext · function · L83-L86 — function xpToNext(level: number): number
- mobXp · function · L88-L90 — function mobXp(m: MobDef): number
- levelPenalty · function · L92-L96 — function levelPenalty(playerLvl: number, mobLvl: number): number
