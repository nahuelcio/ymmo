# shared/src/data/classes.ts

- Race · type · L1-L1 — type Race = 'human' | 'elf' | 'darkelf' | 'orc' | 'dwarf';
- ClassType · type · L2-L2 — type ClassType = 'fighter' | 'mystic';
- Gender · type · L3-L3 — type Gender = 'm' | 'f';
- Look · interface · L6-L6 — interface Look
- sanitizeLook · function · L14-L17 — function sanitizeLook(l: Partial<Look> | undefined): Look
- n · function · L15-L15 — n = (v: unknown, max: number)
- StatMods · interface · L19-L22 — interface StatMods
- RaceDef · interface · L24-L30 — interface RaceDef
- ClassDef · interface · L46-L50 — interface ClassDef
- Spec · type · L66-L66 — type Spec = 'knight' | 'gladiator' | 'sorcerer' | 'cleric';
- SpecDef · interface · L67-L67 — interface SpecDef
- GenderDef · interface · L77-L77 — interface GenderDef
- statMods · function · L85-L92 — function statMods(race: Race, g: Gender): StatMods
