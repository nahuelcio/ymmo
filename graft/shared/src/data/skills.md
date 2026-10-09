# shared/src/data/skills.ts

- BuffMods · interface · L4-L4 — Payload of optional stat multipliers (physical/magic attack and defense, movement speed, attack speed) that buffs apply while active.
- SkillDef · interface · L6-L32 — Schema for one skill: eligibility gates (class, spec, race, gender, level), combat mechanics (kind, target, power, MP cost, cooldown, cast time, range, AoE), and effects (buff stat mods or applied status).
- allSkillsFor · function · L97-L100 — Computes the full list of skills a character qualifies for by keeping only skills whose class/spec/race/gender gates match (absent gates are universal) and ordering them by learning level.
