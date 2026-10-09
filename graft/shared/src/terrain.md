# shared/src/terrain.ts

Single source of truth for the world's ground shape and zone rules (fBm hills, mountain walls at the world edge, flat town plateaus, ponds, play-area bounds), letting server and client compute identical terrain from a fixed seed with no sync.

- hash2 · function · L11-L16 — Maps an integer grid cell to a stable pseudo-random value in [0,1), providing the lattice randomness the noise functions are built on.
- smoothstep · function · L18-L21 — Provides the eased 0-to-1 transition used to blend the town's flat plateau smoothly into the surrounding wild terrain.
- valueNoise · function · L23-L29 — Turns the per-cell hash into continuous 2D noise by bilinearly interpolating the four lattice corners with smooth fade weights.
- fbm · function · L31-L40 — Layers value noise at doubling frequency and halving amplitude to create natural multi-scale terrain detail, normalized back into [0,1].
- heightAt · function · L44-L51 — Computes the authoritative ground height at any world coordinate: layered noise hills, squared mountain rise near the world edge, and terrain blended flat to TOWN_HEIGHT across each town's safe radius so settlements sit on level ground.
- inTown · function · L53-L55 — Reports whether a point lies inside any town's peaceful area (its radius plus a 5-unit buffer), the predicate used to enforce safe-zone rules like no combat or spawning.
- mulberry32 · function · L58-L67 — Factory for a small seeded PRNG so decoration placement and mob spawns come out identical on server and client for the same seed.
