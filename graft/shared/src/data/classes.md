# shared/src/data/classes.ts

Character-creation data module: playable races, fighter/mystic classes, genders, appearance rules, and the stat-modifier math that combines them into starting character stats.

- Race · type · L1-L1 — Enumerates the five playable races a character can be created as.
- ClassType · type · L2-L2 — Enumerates the two class archetypes: fighter (melee) vs mystic (caster).
- Gender · type · L3-L3 — Enumerates the two gender options used to look up appearance and stat modifiers.
- Look · interface · L6-L6 — The visual appearance (gender, hair style, hair color) a player picks for a new character.
- sanitizeLook · function · L14-L17 — Coerces untrusted client-supplied appearance data into a guaranteed-valid Look, clamping bad values to defaults.
- n · function · L15-L15 — Inline validator that accepts only non-negative integers below max, otherwise falling back to 0.
- StatMods · interface · L19-L22 — The set of stat adjustments (percent multipliers plus flat bonuses) that race/class/gender choices apply to a character.
- RaceDef · interface · L24-L30 — Defines one race's identity: appearance defaults, physical proportions, allowed classes, stat mods, and description.
- ClassDef · interface · L46-L50 — Defines one class's growth profile (HP/MP bases and per-level gains, CP ratio, attack interval) and its starting inventory.
- Spec · type · L66-L66 — type Spec = 'knight' | 'gladiator' | 'sorcerer' | 'cleric';
- SpecDef · interface · L67-L67 — interface SpecDef
- GenderDef · interface · L77-L77 — Describes a gender's display name, stat modifiers, and description for the character-creation UI.
- statMods · function · L85-L92 — Computes the effective stat modifiers for a character by combining race and gender modifiers (percent stats multiplied, flat stats summed).
