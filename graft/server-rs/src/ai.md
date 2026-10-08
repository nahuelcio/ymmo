# server-rs/src/ai.rs

- LEASH · constant · L9-L9 — Maximum distance a mob may be pulled from its home spot before it abandons the fight and heads back.
- AGGRO_RANGE · constant · L10-L10 — Radius within which an aggressive mob will notice and attack nearby players while idle.
- valid_enemy · function · L13-L18 — Guard that a player is a legitimate target: alive, outside town sanctuary, and still within leash distance of the mob's home.
- update_mob · function · L20-L153 — The per-tick mob state machine: death/respawn and hide, stun, leash break (hand off to next threat or reset and return home), return trip with full heal, combat (telegraphed specials, chase, cooldown melee), out-of-combat regen, passive aggro, and wandering.
- resolve_special · function · L156-L179 — After a special's wind-up ends, judges each nearby player on their own latency timeline, scheduling a delayed hit that still respects dodge and position at impact, then applies damage and an optional stun.
- respawn_mob · function · L181-L203 — Brings a dead mob back at its home spot with full HP and cleared combat state, and announces awakened raid bosses to everyone.
- retarget · function · L206-L222 — Threat policy: swap target to a player whose threat clearly exceeds the current one's by 10% (110% rule), suppressed while taunted and throttled to 500 ms checks.
- check_phases · function · L225-L273 — Raid-boss phase engine: each time HP falls to the next threshold it advances the phase, applying haste, swapping the special, shouting an announcement, and spawning adds that prioritize the furthest (healer/caster) threats.
