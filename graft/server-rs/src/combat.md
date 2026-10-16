# server-rs/src/combat.rs

The server's combat system (Rust port of combat.ts): PvP opt-in rules, attack resolution, damage and status effects, XP/level-ups, deaths, and skill casting.

- PVP_OFF_COOLDOWN · constant · L11-L11 — Constant enforcing that a player must stay out of combat for 10 seconds before being allowed to turn PvP mode off.
- is_fighter · function · L13-L13 — One-line helper telling whether an entity id is a fighter-class player, used for threat weighting and redirecting DoT damage.
- set_pvp_mode · function · L17-L30 — Toggles a player's PvP opt-in, refusing to turn it off while the player carries karma or was recently in combat (10 s cooldown), so players can't hide mid-fight.
- can_attack · function · L32-L53 — Gatekeeper that decides whether a player may attack a target, rejecting dead/invalid targets, peace-zone fights, party members, and PvP-off players, while allowing attacks on karma carriers or flagged players without needing Ctrl-force.
- def_stats · function · L55-L61 — Fetches an entity's defensive stats (physical defense, magic defense, evasion) for the hit/damage formulas, defaulting for non-combat kinds.
- send_miss · function · L63-L67 — Notifies both attacker and target that an attack missed by sending a zero-damage dmg message flagged as a miss.
- auto_attack · function · L69-L79 — Resolves one player basic attack: broadcasts the swing, rolls accuracy vs evasion for a hit, rolls a crit, and applies the physical damage.
- mob_attack · function · L81-L94 — Resolves a mob's melee attack on a player, honoring dodge windows and evasion, and rolling the mob's templated on-hit status effect chance.
- apply_status · function · L97-L110 — Applies a timed status to a target, scaling damage-over-time off the hit that caused it, and interrupts casting/movement/special attacks when the status is a stun.
- tick_statuses · function · L113-L129 — Per-entity status upkeep: removes expired or dead-target statuses and ticks bleed/poison damage once per second, falling back to self-damage if the applier is gone.
- add_threat · function · L131-L133 — Accumulates a player's threat value on a mob, which drives the mob's aggro decisions.
- apply_damage · function · L135-L179 — Central damage funnel: broadcasts the hit, books mob hate/threat (fighters weighted higher) and mob deaths, absorbs player damage with CP first, flags PvP aggressors, and triggers deaths.
- gain_xp · function · L181-L223 — Awards XP to a player — cleansing karma by a third of the gain in the process — then loops level-ups, announcing newly learned skills/spec availability and restoring full HP/MP/CP on level-up.
- choose_spec · function · L226-L243 — Handles the one-time specialization pick at SPEC_LEVEL, validating that the spec matches the player's base class and none is chosen yet, persisting it to the DB, and announcing the spec's skills (base-class skills are kept).
- kill_mob · function · L245-L322 — Resolves a mob death: schedules its respawn, records camp contributors, splits the mob's XP among damage dealers (parties share with bonus and distance/level rules), and gives loot and boss credit to the top damager's side.
- Unit · struct · L275-L275 — Local struct that groups damage dealers into attribution units (a solo player or a whole party) with their combined damage, so XP and loot can be split per unit.
- kill_player · function · L324-L368 — Resolves a player's death: clears buffs/intent/casting, distinguishes a legitimate PvP kill (flagged or karma target) from a PK that adds karma to the killer, applies XP loss on non-player deaths, and may drop items from high-karma victims.
- respawn_player · function · L370-L379 — Revives a dead player by clearing the death state (dead flag, buffs, intents) and restoring full HP/MP/CP so they return to play, typically at the town/spawn point.
- request_skill · function · L381-L403 — Entry point when a player tries to cast a skill: validates cooldown, resource cost, and target/range legality before spending the resources and applying the skill's damage or status effect.
- process_skill_intent · function · L405-L438 — Advances a player's queued skill each tick — keeping them moving into range and validating target/cooldown/cast-time gates — until the skill is ready to fire.
- finish_cast · function · L440-L531 — Executes a completed skill cast, dispatching by skill type (damage, heal, buff/status, AoE) while spending mana, applying cooldowns, and notifying nearby clients.
