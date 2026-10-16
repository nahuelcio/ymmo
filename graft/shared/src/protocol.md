# shared/src/protocol.ts

The shared wire contract between game client and server: entity snapshot shapes and status flags, player/bag/party state, and the exhaustive JSON message vocabularies each side may send.

- NameColor · type · L6-L6 — Classifies a player's reputation standing so the client can tint their name normal, PvP-flagged purple, or karma red.
- CharSummary · interface · L8-L8 — One character slot as shown on the character-selection screen (identity, race/class/spec, level, look), letting the player decide which toon to enter the world with.
- EntPlayer · interface · L10-L21 — The renderable snapshot of another player visible in the world — position, vitals, appearance, name colour (normal/pvp/karma), status flags, and the ids of their visible gear pieces.
- ClanMemberInfo · interface · L24-L24 — interface ClanMemberInfo
- ClanWarInfo · interface · L27-L27 — interface ClanWarInfo
- AllyClanInfo · interface · L29-L29 — interface AllyClanInfo
- AllyInfo · interface · L31-L31 — interface AllyInfo
- ClanInfo · interface · L32-L38 — interface ClanInfo
- ClanWhItem · interface · L40-L40 — interface ClanWhItem
- ClanWhLog · interface · L41-L41 — interface ClanWhLog
- EntMob · interface · L42-L42 — Spawn snapshot for a monster, carrying its template id, position, level, hp, and behaviour flags so the client can render and fight it.
- EntNpc · interface · L43-L43 — Spawn snapshot for an NPC in the world, carrying its display title and template id so the client knows which interaction (shop, gatekeeper, quest) it offers.
- EntItem · interface · L45-L45 — Spawn snapshot for an item lying on the ground (template, stack count, hp/durability) so the client can render loot and support picking it up.
- EntAdd · type · L46-L46 — The set of entity kinds (player, mob, npc, ground item) the server may add to a client's view in a snapshot's 'add' list.
- EntUpd · type · L49-L49 — A bandwidth-cheap fixed tuple (id, x, z, rotation, hp percentage, flags) used to re-sync already-visible entities each tick.
- InvItem · interface · L63-L63 — A bag entry keyed by a stable uid so equip/use/enchant/destroy actions can target the exact stack, recording its equipped slot and enchant level (+N).
- SelfState · interface · L65-L76 — The authoritative stat sheet of the player's own character — xp curve, hp/mp/cp pools, combat stats, adena, karma/pk/pvp counters, skills, buffs, and zone — that drives the client HUD and ability checks.
- PartyMember · interface · L78-L78 — One ally's vitals and leader flag as displayed in the party HUD, so members can track group hp/mp and healers can keep the group alive.
- C2S · type · L81-L156 — The exhaustive vocabulary of player actions the client may request — login, movement, combat, inventory, shopping, quests, party, and pvp/dash toggles — each discriminated by its `t` tag.
- S2C · type · L158-L207 — The exhaustive vocabulary of server pushes that drive the client — world snapshots, self/inventory updates, combat and chat events, npc panels, party state, telegraphed AoEs, and latency probes — each discriminated by its `t` tag.
