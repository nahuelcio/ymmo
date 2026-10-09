# server-rs/src/chat.rs

Port of the TypeScript chat system: sanitizes player messages and routes them through slash commands or the shout/party/whisper/local chat channels of the game world.

- LOCAL_RANGE · constant · L7-L7 — Radius (100 units) that bounds delivery of plain chat messages so default 'all' chatter only reaches nearby players rather than the whole world.
- handle_chat · function · L10-L83 — Entry point for every player message: strips control chars and caps length, then dispatches '/' slash commands (invite, whisper, who, loc, unstuck, raid, dance, pvp, help) or routes text to the shout/party/whisper/local channels.
- whisper · function · L85-L92 — Delivers a private message to a named online player and echoes a confirmation copy back to the sender, enforcing the "name message usage and rejecting offline recipients.
