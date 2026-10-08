# shared/src/data/world.ts

Declares the game world's data layer: the four hunting zones with their spawn tables, the town's NPC roster (shopkeepers, gatekeeper, quest givers), teleport destinations with fares, and helpers to resolve region names and NPC chatter lines.

- ZoneDef · interface · L3-L10 — Shape of a hunting-zone record: circular map bounds, intended level range, ground tint, and which mobs spawn in what numbers.
- zoneAt · function · L36-L40 — Resolves which named region a world coordinate sits in, used for location display, by giving the town priority (with a small safety margin), then checking each zone's radius, and defaulting to 'Tierras Salvajes'.
- NpcDef · interface · L42-L56 — Shape of a town NPC record: placement and facing, behavioral kind (shop, gatekeeper, talker, or quest giver), optional shop inventory and chatter lines, and appearance tweaks.
- randomLine · function · L81-L84 — Picks a random flavor line when the player clicks or passes by an NPC, falling back to its standard greeting if it has no dedicated chatter lines.
