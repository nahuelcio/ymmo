# shared/src/data/quests.ts

Shared quest catalog: definitions for the game's kill/collect quests (NPC, level gate, dialogue, objective, XP/adena rewards) plus helpers for objective summaries, NPC markers, qualifying mobs, and status dialogue.

- QuestStatus · type · L4-L4 — Enumerates the player-facing lifecycle stages of a quest: locked, available, active, ready, and done.
- QuestDef · interface · L6-L19 — The contract for a single quest: which NPC offers it, its level gate, its four dialogue strings, its kill-or-collect objective, and its XP/adena payout.
- questSummary · function · L21-L25 — Renders a quest's objective as a player-facing one-liner in Spanish, resolving mob or item ids to their display names.
- QuestMarker · type · L30-L30 — The set of punctuation markers shown over a quest giver (yellow !/? actionable, grey 'soon', 'active', or none).
- questMarker · function · L33-L38 — Decides which WoW-style marker floats over a quest giver by prioritizing done → active/ready → level-gated availability → not-yet 'soon'.
- questMobs · function · L41-L45 — Determines which mob templates advance a quest: the designated kill target, or every mob whose drop table contains the quest item.
- questLine · function · L47-L53 — Maps a quest's current status to the dialogue line the giver NPC should say (level lock notice, offer, in-progress nag, turn-in, or post-completion text).
