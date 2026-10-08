# shared/src/terrain.ts · [[deterministic-procedural-terrain]] [[shared-cross-process-contract]]

Defines the shared deterministic terrain model (seeded noise, town plateau, edge mountains, water line, playable bounds) so server and client compute identical ground heights without communicating.

- hash2 · function · L11-L16 — Maps an integer grid cell to a stable pseudo-random value in [0,1), providing the lattice randomness the noise functions are built on.
- smoothstep · function · L18-L21 — Provides the eased 0-to-1 transition used to blend the town's flat plateau smoothly into the surrounding wild terrain.
- valueNoise · function · L23-L29 — Turns the per-cell hash into continuous 2D noise by bilinearly interpolating the four lattice corners with smooth fade weights.
- fbm · function · L31-L40 — Layers value noise at doubling frequency and halving amplitude to create natural multi-scale terrain detail, normalized back into [0,1].
- heightAt · function · L44-L51 — Computes the authoritative ground height at any point: fbm base plus fine bumps, mountains rising near the world edge, and terrain forced flat to TOWN_HEIGHT inside the town circle.
- inTown · function · L53-L55 — Simple radius test telling gameplay whether a position is inside the safe town circle (with a small buffer), e.g. for spawn or safety rules.
- mulberry32 · function · L58-L67 — Factory for a small seeded PRNG so decoration placement and mob spawns come out identical on server and client for the same seed.
