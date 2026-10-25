# shared/src/data/classes.ts

- Race · type · L1-L1 — type Race = 'human' | 'elf' | 'darkelf' | 'orc' | 'dwarf';
- ClassType · type · L2-L2 — type ClassType = 'fighter' | 'mystic';
- Gender · type · L3-L3 — type Gender = 'm' | 'f';
- Look · interface · L6-L6 — interface Look
- sanitizeLook · function · L14-L17 — function sanitizeLook(l: Partial<Look> | undefined): Look
- n · function · L15-L15 — n = (v: unknown, max: number)
- StatMods · interface · L19-L22 — interface StatMods
- RaceDef · interface · L24-L32 — interface RaceDef
- ClassDef · interface · L48-L52 — interface ClassDef
- Spec · type · L71-L72 — type Spec = 'knight' | 'gladiator' | 'archer' | 'assassin' | 'swordsinger' | 'bladedancer' | 'sorcerer' | 'cleric' | 'phoenix_knight' | 'duelist' | 'sharpshooter' | 'shade' | 'sword_muse' | 'spectral_dancer' | 'archmage' | 'hierophant';
- SpecDef · interface · L73-L83 — interface SpecDef
- evolutionOf · function · L107-L107 — evolutionOf = (s: Spec | null | undefined): Spec | undefined
- GenderDef · interface · L109-L109 — interface GenderDef
- statMods · function · L117-L124 — function statMods(race: Race, g: Gender): StatMods
