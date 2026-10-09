# shared/src/data/mobs.ts

This is the game's monster catalog: it defines the MobDef/MobPhase schemas plus the full level-ordered list of mob definitions (stats, aggression, on-hit statuses, telegraphed specials, boss flags, adena ranges and drop tables) used to spawn, balance, and loot combat encounters across zones.

- MobShape · type · L3-L3 — Enumerates the body-model archetypes (beast, goblin, orc, etc.) so the client can pick which 3D shape to render each mob with.
- Drop · interface · L5-L5 — Represents one entry in a mob's loot table — which item may drop, with what probability, and the optional stack-size range.
- MobDef · interface · L7-L33 — The full contract for a monster species: identity, visuals and level, combat tuning (aggression, speed, attack cadence, stat multipliers), optional behaviors like on-hit statuses, telegraphed AoE specials and raid phases, plus its adena/drop rewards.
- MobPhase · interface · L35-L43 — Describes one raid-boss phase trigger — what changes (adds summoned, attack-speed haste, special swap, boss yell) when the boss's HP crosses the 'at' percentage threshold.
