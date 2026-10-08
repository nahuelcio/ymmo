# server-rs/src/party.rs

Party system for the game world: sending/accepting invitations, joining, leaving with automatic dissolution, and broadcasting roster state to clients.

- party_invite · function · L7-L27 — Lets a player invite an online player to their party, enforcing leader-only invites, capacity limits, and a single 30-second pending invitation per target.
- party_respond · function · L29-L55 — Resolves a pending invitation on accept/decline, lazily creating the inviter's party if needed, and adds the accepter as a new member unless the party is full.
- party_leave · function · L57-L79 — Removes a player from their party (voluntarily or on disconnect) and dissolves the party entirely once fewer than two members remain.
- send_party · function · L81-L90 — Pushes a fresh roster snapshot (names, levels, classes, hp/mp/cp, leader flag) to every member's client so party UIs stay in sync.
- send_party_updates · function · L92-L94 — Periodic sync that refreshes every party's roster across the whole world after stat changes.
- join_group · function · L97-L112 — For instanced raids/groups, silently places a player into the world's single group party, creating the party if none exists yet.
