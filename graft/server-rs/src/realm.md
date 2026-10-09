# server-rs/src/realm.rs

Character lifecycle for a world instance: loading a stored character in, saving it (manually and via a staggered autosave), and moving players between the overworld and raid instances via /raid, exit, and quit.

- join · function · L14-L45 — Materializes a stored character into this world as a live player entity: loads its DB row, inventory and quests, resolves the spawn point (a ring around the raid entry when joining a raid), then registers the entity and session and pushes the first self/inventory/quest snapshot to the socket.
- save_player · function · L47-L57 — Persists a player's progression (level/xp, position, hp/mp/cp, adena, karma, pk/pvp, inventory, quests) to the database, clamping HP so a corpse never saves with 0 HP.
- take_out · function · L60-L75 — Removes a player from the world when their socket closes or they switch worlds, persisting them first — if they died they are revived at a town point with 70% HP and saved there, otherwise saved at their current position — and returns the session member so the hub can hand it to another world.
- exit_point · function · L78-L78 — Chooses the coordinates a leaving character is saved at: always the village point when inside a raid, so nobody gets persisted standing in the arena.
- quit · function · L80-L84 — Handles a socket disconnect by saving and removing that session's character and notifying the hub the connection closed.
- exit_to_town · function · L87-L91 — Pulls a player out of a raid instance back to the overworld, saving them at the village and telling the hub to rejoin them in the main world.
- raid_command · function · L95-L136 — Handles the /raid command: exits back to town if already in an instance, otherwise validates the raid id, prerequisite quest, party leadership, player cap and minimum level, then dissolves the party, extracts every member, and asks the hub to carry them into a new raid instance.
- autosave · function · L139-L150 — Spreads DB write load by saving only players whose last save is 60+ seconds old, capped at 3 players per call, instead of persisting everyone at once.
