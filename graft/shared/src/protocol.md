# shared/src/protocol.ts · [[delta-snapshot-bandwidth-model]] [[entity-flag-bitmask]] [[shared-cross-process-contract]] [[wire-protocol-entity-schema]]

The shared wire contract between the game client and server: entity snapshot shapes, self/party state, and the complete catalogue of client requests (C2S) and server notifications (S2C) for an MMO covering login, movement, combat, loot, NPCs, quests, parties, and PvP.

- NameColor · type · L6-L6 — Classifies a player's reputation standing so the client can tint their name normal, PvP-flagged purple, or karma red.
- CharSummary · interface · L8-L8 — Minimal identity and appearance info for each of a player's characters, used to render the character-selection screen.
- EntPlayer · interface · L10-L15 — Describes another player as they appear in the world (position, level, name colour for PvP/karma, faction flags, and visible gear) when they come into view.
- EntMob · interface · L16-L16 — Spawn snapshot for a monster, carrying its template id, position, level, hp, and behaviour flags so the client can render and fight it.
- EntNpc · interface · L17-L17 — Spawn snapshot for an NPC in the world, carrying its display title and template id so the client knows which interaction (shop, gatekeeper, quest) it offers.
- EntItem · interface · L18-L18 — Spawn snapshot for an item lying on the ground (template, stack count, hp/durability) so the client can render loot and support picking it up.
- EntAdd · type · L19-L19 — The set of entity kinds (player, mob, npc, ground item) the server may add to a client's view in a snapshot's 'add' list.
- EntUpd · type · L22-L22 — A bandwidth-cheap fixed tuple (id, x, z, rotation, hp percentage, flags) used to re-sync already-visible entities each tick.
- InvItem · interface · L31-L31 — One stack in a player's inventory, linking a unique slot instance to its item template, quantity, and the equipment slot it occupies if worn.
- SelfState · interface · L33-L43 — The authoritative snapshot of the local player — combat stats, hp/mp/cp, adena, karma/PvP standing, skills, buffs, and current zone — that drives the client HUD.
- PartyMember · interface · L45-L45 — Per-member vitals shown in the party HUD (class, level, hp/mp/cp bars, and who is leader).
- C2S · type · L48-L82 — Every action a player client can ask the server to perform, from login/character management through movement, combat, trading, quests, party management, and PvP/auto-loot toggles.
- S2C · type · L84-L114 — Every notification the server can push to a client, covering world snapshots, self/inventory updates, combat and death events, chat, NPC dialogs, party state, telegraphed area attacks, and latency probes.
