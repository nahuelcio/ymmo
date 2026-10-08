# server-rs/src/realm.rs

World membership lifecycle: loading characters into a world and saving them out, a staggered autosave, and moving players between the overworld and raid instances (port of realm.ts plus raid enter/exit logic).

- join · function · L14-L45 — Brings a character into the world for a socket — loading it from the DB (resolving a raid-entry spawn point when switching worlds), rebuilding its inventory, spawning it as an entity, registering the session, and sending the initial self/inventory/quest state.
- save_player · function · L47-L57 — Persists a player's progression (level/xp, position, hp/mp/cp, adena, karma, pk/pvp, inventory, quests) to the database, clamping HP so a corpse never saves with 0 HP.
- take_out · function · L60-L75 — Removes a character from the world when its socket closes or it changes worlds — first reviving dead players at the village with 70% HP — saving the character and returning its Member so the hub can track it.
- exit_point · function · L78-L78 — Enforces where a leaving character is saved: the village coordinates when departing a raid instance, or nowhere (keep current position) in the overworld.
- quit · function · L80-L84 — Handles a socket disconnect by saving and removing that session's character and notifying the hub the connection closed.
- exit_to_town · function · L87-L91 — Pulls a player out of a raid instance back to the overworld, saving them at the village and telling the hub to rejoin them in the main world.
- raid_command · function · L94-L127 — Implements the /raid command: it leaves to town if already in a raid, otherwise gates entry (alive, party-leader-only, max players, minimum level), dissolves the party, extracts every member, and asks the hub to start a raid instance with them.
- autosave · function · L130-L141 — Spreads DB write load by saving only players whose last save is 60+ seconds old, capped at 3 players per call, instead of persisting everyone at once.
