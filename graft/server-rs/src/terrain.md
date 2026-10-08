# server-rs/src/terrain.rs

Server-side world-geometry helpers that classify coordinates as town/zone/wilderness and provide a deterministic PRNG matching the shared TypeScript terrain generator.

- in_town · function · L4-L6 — Decides whether a world position counts as inside town (town radius plus a 5-unit grace margin) so town-only server rules can be applied.
- zone_at · function · L9-L16 — Resolves the Spanish zone name governing a position, checking town first, then circular zones, and falling back to the wilderness.
- Mulberry32 · struct · L19-L19 — Newtype holding the u32 PRNG state so terrain generation is deterministic and reproducible across server and shared TS implementations.
- new · function · L21-L21 — Seeds the mulberry32 generator with a u32 to start a reproducible random sequence.
- next · function · L22-L28 — Advances the mulberry32 state and returns the next uniform [0,1) float, keeping server terrain rolls in sync with the client's generator.
