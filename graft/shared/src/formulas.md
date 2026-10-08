# shared/src/formulas.ts

Central balance-math module for the game: derives character and monster stats from level/race/class/gear/buffs and defines the combat resolution, hit chance, and XP progression formulas.

- Stats · interface · L6-L12 — The full set of derived combat and regen attributes (HP/MP/CP pools, attack/defense, accuracy/evasion/crit, timings, and regen rates) that any player or mob entity carries.
- levelMod · function · L17-L19 — Global level-scaling factor that grants 10% more offensive and defensive output per level above 1, keeping power growth linear with level.
- computeStats · function · L21-L53 — Builds a character's complete final stat block by combining race modifiers, class growth curves, gear attack/defense values, and multiplicative buff modifiers, including mystic-only magic and regen rules.
- mobStats · function · L55-L67 — Derives a monster's combat stats purely from its level (with quadratic HP growth) so mobs need no hand-authored numbers, with optional per-mob multipliers for tuning elites.
- rand · function · L69-L69 — One-line helper producing a random float in a range, used to inject the ±10% variance into damage rolls.
- hitChance · function · L71-L73 — Determines whether an attack lands by starting from a 90% base hit rate, shifting 1% per point of accuracy-over-evasion beyond 50, and clamping to the 60–98% band.
- physDamage · function · L75-L77 — Rolls melee damage as 70×pAtk divided by the target's pDef, scaled by skill multiplier, ±10% randomness, and doubled on critical hits, never below 1.
- magicDamage · function · L79-L81 — Rolls spell damage as 70×mAtk over mDef with a tighter ±8% variance and a 1.8× critical multiplier instead of the physical 2×, never below 1.
- xpToNext · function · L83-L86 — Defines the leveling grind via a power curve (80×level^2.2) of XP needed to reach the next level, returning 0 once the player is at max level.
- mobXp · function · L88-L90 — Sets the XP reward for killing a mob from its level (level^1.9 growth) further boosted by how tough the mob's HP multiplier makes it.
- levelPenalty · function · L92-L96 — Anti-farming rule that discounts XP to zero-ish (floor 5%) when the player out-levels the mob by more than 5 levels, while leaving fair fights untouched.
