# server-rs/src/player.rs

The per-tick player simulation system (ported from TS systems/player.ts), handling combat-gated HP/MP/CP regen, buff expiry, escape teleport, stun/cast gating, and resolution of the player's current movement/attack/skill/pickup/talk intent.

- update_player · function · L7-L101 — Resolves one player's tick: regenerates stats (slower while in combat), expires buffs, performs pending escape teleport, then either gates on stun/casting/no-intent or steps toward and executes the active Move/Attack/Skill/Pickup/Talk intent.
