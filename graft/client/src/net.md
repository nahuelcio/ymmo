# client/src/net.ts

Browser networking layer for the game client: a single WebSocket wrapper that opens the socket to /ws, parses incoming server traffic as JSON text or binary snapshots, and fans messages out to registered typed subscribers.

- Handler · type · L5-L5 — Type alias for the internal callback signature every S2C message handler must satisfy, stored untyped in the handler map.
- Net · class · L7-L47 — Client-side WebSocket wrapper that owns the connection to the game server and routes decoded server messages to per-type and wildcard ('*') subscribers, hiding raw socket details (send guard, decode, subscribe/unsubscribe) behind a typed API.
- connect · method · L12-L35 — Establishes the WebSocket connection to the game server (ws/wss by page protocol), returns a promise that resolves once the socket is open (after declaring the player's language) or rejects on connection error, and installs the message loop that decodes text JSON vs binary snapshots before dispatching to handlers.
- send · method · L37-L39 — Outgoing client-to-server message sender that serializes to JSON and silently drops the message unless the socket is fully open, preventing sends during connect/close states.
- on · method · L41-L46 — Typed subscribe API that registers a handler for a message type (or '*' for all) and returns an unsubscribe closure so UI components can cleanly detach listeners.
