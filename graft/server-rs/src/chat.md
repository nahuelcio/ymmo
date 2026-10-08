# server-rs/src/chat.rs

Chat system (port of chat.ts) that sanitizes player messages and routes them either to slash commands (/invite, /leave, /w, /who, /loc, /unstuck, /raid, /pvp, /help) or to chat channels: global shout (!), party (#), whisper ("name), or short-range local chat.

- LOCAL_RANGE · constant · L7-L7 — Radius (100 units) that bounds delivery of plain chat messages so default 'all' chatter only reaches nearby players rather than the whole world.
- handle_chat · function · L10-L83 — Entry point for a raw client chat line: strips control chars and caps it at 200 chars, then executes a slash command if present, or fans the message out to the shout, party, whisper, or proximity 'all' channel depending on its prefix.
- whisper · function · L85-L92 — Delivers a private message to a named online player and echoes a confirmation copy back to the sender, enforcing the "name message usage and rejecting offline recipients.
