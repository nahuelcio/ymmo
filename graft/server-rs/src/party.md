# server-rs/src/party.rs

Implements the party lifecycle for the game world — leader-only invites with capacity/pending guards, accept/decline with expiry, leave with auto-dissolution below two members, roster broadcasting, and forced group joins for raid instances — ported from the original TypeScript system.

- party_invite · function · L7-L27 — Lets a player invite an online player to their party, enforcing leader-only invites, capacity limits, and a single 30-second pending invitation per target.
- party_respond · function · L29-L55 — Resolves a pending invitation on accept/decline, lazily creating the inviter's party if needed, and adds the accepter as a new member unless the party is full.
- party_leave · function · L57-L79 — Removes a player from their party (voluntarily or on disconnect) and dissolves the party entirely once fewer than two members remain.
- send_party · function · L81-L90 — Serializes a party's live roster (each member's id, name, level, class, spec, vitals, and leader flag, with the first member as leader) and pushes it to every member so clients can render the party frame.
- send_party_updates · function · L92-L94 — Periodic sync that refreshes every party's roster across the whole world after stat changes.
- join_group · function · L97-L112 — For instanced raids/groups, silently places a player into the world's single group party, creating the party if none exists yet.
