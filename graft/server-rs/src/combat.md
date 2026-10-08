# server-rs/src/combat.rs

The server's combat system (Rust port of combat.ts): PvP opt-in rules, attack resolution, damage and status effects, XP/level-ups, deaths, and skill casting.

- PVP_OFF_COOLDOWN · constant · L11-L11 — Constant enforcing that a player must stay out of combat for 10 seconds before being allowed to turn PvP mode off.
- is_fighter · function · L13-L13 — One-line helper telling whether an entity id is a fighter-class player, used for threat weighting and redirecting DoT damage.
- set_pvp_mode · function · L17-L30 — Toggles a player's PvP opt-in, refusing to turn it off while the player carries karma or was recently in combat (10 s cooldown), so players can't hide mid-fight.
- can_attack · function · L32-L47 — Gatekeeper for player attacks that returns the localized reason an attack is forbidden (peace zone, party member, PvP off, unflagged target) or None when the attack is legal.
- def_stats · function · L49-L55 — Fetches an entity's defensive stats (physical defense, magic defense, evasion) for the hit/damage formulas, defaulting for non-combat kinds.
- send_miss · function · L57-L61 — Notifies both attacker and target that an attack missed by sending a zero-damage dmg message flagged as a miss.
- auto_attack · function · L63-L73 — Resolves one player basic attack: broadcasts the swing, rolls accuracy vs evasion for a hit, rolls a crit, and applies the physical damage.
- mob_attack · function · L75-L88 — Resolves a mob's melee attack on a player, honoring dodge windows and evasion, and rolling the mob's templated on-hit status effect chance.
- apply_status · function · L91-L104 — Applies a timed status to a target, scaling damage-over-time off the hit that caused it, and interrupts casting/movement/special attacks when the status is a stun.
- tick_statuses · function · L107-L123 — Per-entity status upkeep: removes expired or dead-target statuses and ticks bleed/poison damage once per second, falling back to self-damage if the applier is gone.
- add_threat · function · L125-L127 — Accumulates a player's threat value on a mob, which drives the mob's aggro decisions.
- apply_damage · function · L129-L172 — Central damage funnel: broadcasts the hit, books mob hate/threat (fighters weighted higher) and mob deaths, absorbs player damage with CP first, flags PvP aggressors, and triggers deaths.
- gain_xp · function · L174-L216 — Grants XP to a player, using part of it to cleanse karma, then loops level-ups that award new skills, recalc stats, and refill resources.
- choose_spec · function · L219-L236 — pub fn choose_spec(&mut self, pid: u32, spec: &str)
- kill_mob · function · L238-L315 — Resolves a mob death: schedules its respawn, records camp contributors, splits the mob's XP among damage dealers (parties share with bonus and distance/level rules), and gives loot and boss credit to the top damager's side.
- Unit · struct · L268-L268 — Local struct that groups damage dealers into attribution units (a solo player or a whole party) with their combined damage, so XP and loot can be split per unit.
- kill_player · function · L317-L358 — Resolves a player's death: clears buffs/intent/casting, distinguishes a legitimate PvP kill (flagged or karma target) from a PK that adds karma to the killer, applies XP loss on non-player deaths, and may drop items from high-karma victims.
- respawn_player · function · L360-L369 — Revives a dead player, restoring HP/MP/CP to 70% and teleporting them back to the town point.
- request_skill · function · L371-L393 — Entry point for a player asking to use a skill: verifies the skill exists and has actually been learned by that class/race/gender at the player's level before proceeding with the cast.
- process_skill_intent · function · L395-L430 — Advances a player's queued skill each tick — keeping them moving into range and validating target/cooldown/cast-time gates — until the skill is ready to fire.
- finish_cast · function · L432-L515 — Executes a completed skill cast, dispatching by skill type (damage, heal, buff/status, AoE) while spending mana, applying cooldowns, and notifying nearby clients.
