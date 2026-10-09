# server-rs/src/player.rs

Rust port of the TypeScript player tick system: it advances one player per tick through regen, buff expiry, escape teleport, stun/cast gating, and intent execution (move, attack, skill, pickup, talk).

- update_player · function · L7-L107 — Runs the full per-tick pipeline for one alive player — regenerating HP/MP/CP (slower while in combat), dropping expired buffs, teleporting home when an escape fires, bailing on stun or active casting, then executing the player's current intent and clearing it when done — enforcing that a player only acts (or moves toward acting) on one intent at a time.
