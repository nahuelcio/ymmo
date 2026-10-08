# server-rs/src/quests.rs

Implements the quest lifecycle — accepting quests from NPCs, tracking kill/collect progress, and turning them in for adena/XP rewards — as the Rust port of the TypeScript quests system.

- NPC_RANGE · constant · L9-L9 — Defines the maximum distance (8 units) a player must be within to interact with a quest NPC.
- npc_name · function · L11-L11 — Resolves a quest giver's display name for completion messages, falling back to a generic label if the NPC def is missing.
- quest_progress · function · L13-L16 — Reports how far a player is on a quest, reading the kill counter or counting the required item in inventory depending on the objective type.
- prime_quest_notices · function · L18-L23 — On (re)connect, pre-marks already-complete quests as 'notified' so returning players don't get duplicate ready announcements.
- send_quests · function · L25-L34 — Pushes the player's quest journal to their client, splitting quests into active (with progress) and completed lists.
- status_of · function · L36-L43 — Classifies a quest for the dialogue UI as done, level-locked, available, ready to turn in, or in progress.
- qname · function · L45-L45 — Returns a quest's name localized to the player's language (English or Spanish).
- quest_npc · function · L48-L57 — Gatekeeps quest interactions by verifying the target entity is a quest NPC within range, otherwise telling the player they are too far away.
- open_quest · function · L59-L68 — Opens the quest NPC's dialogue, sending greeting, title, and the player's current status/progress on that NPC's quest.
- accept_quest · function · L70-L85 — Lets a player start a quest after rejecting repeats, already-active quests, and level-locked quests.
- turn_in_quest · function · L88-L116 — Completes an active, finished quest — confiscating collect items, paying adena, and returning the XP reward for the caller to grant — while rejecting incomplete or already-done quests.
- credit_kill · function · L118-L143 — Credits a mob kill to every involved player's matching kill-quest, bumping counters and announcing progress or completion.
- on_inventory_changed · function · L145-L165 — Re-evaluates collect-objective quests after inventory changes to announce when a quest becomes ready (or un-ready) to turn in.
