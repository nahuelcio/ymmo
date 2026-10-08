# server-rs/src/msgs.rs

Defines the client-to-server message protocol for the game world (port of World.handle/handleMsg): tolerant JSON field readers plus a dispatcher that routes each player command to the matching world action.

- num · function · L6-L6 — Reads a numeric field from a client message, accepting JSON numbers or numeric strings and yielding NaN when missing/unparseable so malformed input never panics a handler.
- id · function · L7-L7 — Validates a client-supplied entity id, rejecting non-finite or negative values so only sane u32 ids reach world logic like targeting and pickups.
- truthy · function · L8-L10 — Coerces any JSON value type (bool, number, string, null) into a boolean flag per the protocol's loose typing, backing toggles like pvpMode, autoLoot, and attack force.
- s · function · L11-L13 — Coerces any JSON value into a string field (empty when absent) for text-carrying commands such as chat, skill names, and equipment slots.
- handle · function · L16-L24 — Entry point for every inbound client packet: dispatches it through handle_msg, then immediately runs the player's update after attack/pickup/talk/skill so interactions take effect at once instead of waiting for the next tick.
- handle_msg · function · L26-L103 — The command dispatcher: verifies the sender still exists, then matches the message type to its world action (move, attack, trade, quest, party, respawn, pvp, dash...), enforcing per-command guards such as not acting while dead.
