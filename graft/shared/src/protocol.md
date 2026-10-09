# shared/src/protocol.ts

The shared wire contract between game client and server: entity snapshot shapes and status flags, player/bag/party state, and the exhaustive JSON message vocabularies each side may send.

- NameColor · type · L6-L6 — Classifies a player's reputation standing so the client can tint their name normal, PvP-flagged purple, or karma red.
- CharSummary · interface · L8-L8 — One character slot as shown on the character-selection screen (identity, race/class/spec, level, look), letting the player decide which toon to enter the world with.
- EntPlayer · interface · L10-L15 — The renderable snapshot of another player visible in the world — position, vitals, appearance, name colour (normal/pvp/karma), status flags, and the ids of their visible gear pieces.
- EntMob · interface · L16-L16 — Spawn snapshot for a monster, carrying its template id, position, level, hp, and behaviour flags so the client can render and fight it.
- EntNpc · interface · L17-L17 — Spawn snapshot for an NPC in the world, carrying its display title and template id so the client knows which interaction (shop, gatekeeper, quest) it offers.
- EntItem · interface · L18-L18 — Spawn snapshot for an item lying on the ground (template, stack count, hp/durability) so the client can render loot and support picking it up.
- EntAdd · type · L19-L19 — The set of entity kinds (player, mob, npc, ground item) the server may add to a client's view in a snapshot's 'add' list.
- EntUpd · type · L22-L22 — A bandwidth-cheap fixed tuple (id, x, z, rotation, hp percentage, flags) used to re-sync already-visible entities each tick.
- InvItem · interface · L32-L32 — A bag entry keyed by a stable uid so equip/use/enchant/destroy actions can target the exact stack, recording its equipped slot and enchant level (+N).
- SelfState · interface · L34-L44 — The authoritative stat sheet of the player's own character — xp curve, hp/mp/cp pools, combat stats, adena, karma/pk/pvp counters, skills, buffs, and zone — that drives the client HUD and ability checks.
- PartyMember · interface · L46-L46 — One ally's vitals and leader flag as displayed in the party HUD, so members can track group hp/mp and healers can keep the group alive.
- C2S · type · L49-L91 — The exhaustive vocabulary of player actions the client may request — login, movement, combat, inventory, shopping, quests, party, and pvp/dash toggles — each discriminated by its `t` tag.
- S2C · type · L93-L126 — The exhaustive vocabulary of server pushes that drive the client — world snapshots, self/inventory updates, combat and chat events, npc panels, party state, telegraphed AoEs, and latency probes — each discriminated by its `t` tag.
