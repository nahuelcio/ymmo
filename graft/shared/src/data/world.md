# shared/src/data/world.ts

Central world-data module that lays out the game's static geography: level-banded hunting zones with their mob spawn tables, teleport destinations with costs, all town/outpost NPCs (shops, gatekeepers, quest givers, flavor talkers), and the coordinate-to-area-name lookup used by the UI.

- ZoneDef · interface · L4-L11 — Shape of a hunting-zone record: circular map bounds, intended level range, ground tint, and which mobs spawn in what numbers.
- zoneAt · function · L52-L56 — Resolves a world coordinate to its display area name, enforcing the precedence that towns claim their radius plus a 10-unit buffer first, then hunting zones, with 'Tierras Salvajes' as the wilderness fallback.
- NpcDef · interface · L58-L73 — Blueprint for every NPC's identity and interactive role: the 'kind' discriminator (shop / gatekeeper / talker / quest) drives what the engine offers, while shop/craft item lists, click lines, and appearance options flesh out merchants, teleporters, chatter, and quest givers.
- randomLine · function · L98-L101 — Picks a random flavor line when the player clicks or passes by an NPC, falling back to its standard greeting if it has no dedicated chatter lines.
- folk · function · L127-L127 — folk = (id: string)
- fort · function · L128-L128 — fort = (id: string)
