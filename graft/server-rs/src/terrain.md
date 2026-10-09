# server-rs/src/terrain.rs

Tells the server whether a world coordinate lies inside a town's sphere of influence, enforcing location rules like safe-zone or town-based gameplay by testing every town's circle plus a 5-unit buffer.

- in_town · function · L4-L6 — Resolves the human-facing zone label for a coordinate using a fixed precedence: any town (with a generous 10-unit margin) wins, then the first zone circle containing the point, otherwise the catch-all wild area.
- zone_at · function · L9-L16 — Tells the server whether a world coordinate lies inside a town's sphere of influence, enforcing location rules like safe-zone or town-based gameplay by testing every town's circle plus a 5-unit buffer.
- Mulberry32 · struct · L19-L19 — Newtype holding the u32 PRNG state so terrain generation is deterministic and reproducible across server and shared TS implementations.
- new · function · L21-L21 — Seeds the mulberry32 generator with a u32 to start a reproducible random sequence.
- next · function · L22-L28 — Advances the mulberry32 state and returns the next uniform [0,1) float, keeping server terrain rolls in sync with the client's generator.
