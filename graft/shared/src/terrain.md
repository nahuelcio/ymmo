# shared/src/terrain.ts

Single source of truth for the world's ground shape and zone rules (fBm hills, mountain walls at the world edge, flat town plateaus, ponds, play-area bounds), letting server and client compute identical terrain from a fixed seed with no sync.

- BiomeId · type · L33-L33 — type BiomeId = 'frost' | 'swamp' | 'ash';
- biomeWeight · function · L44-L52 — function biomeWeight(id: BiomeId, x: number, z: number): number
- onRaidFloor · function · L68-L68 — onRaidFloor = (x: number, z: number, pad = 0)
- inCrater · function · L70-L70 — inCrater = (x: number, z: number, pad = 0)
- hash2 · function · L77-L82 — Maps an integer grid cell to a stable pseudo-random value in [0,1), providing the lattice randomness the noise functions are built on.
- smoothstep · function · L84-L87 — Provides the eased 0-to-1 transition used to blend the town's flat plateau smoothly into the surrounding wild terrain.
- valueNoise · function · L89-L95 — Turns the per-cell hash into continuous 2D noise by bilinearly interpolating the four lattice corners with smooth fade weights.
- fbm · function · L97-L106 — Layers value noise at doubling frequency and halving amplitude to create natural multi-scale terrain detail, normalized back into [0,1].
- segDist · function · L110-L114 — function segDist(px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]): number
- ridges · function · L117-L128 — function ridges(x: number, z: number, passes = true): number
- heightAt · function · L130-L132 — Computes the authoritative ground height at any world coordinate: layered noise hills, squared mountain rise near the world edge, and terrain blended flat to TOWN_HEIGHT across each town's safe radius so settlements sit on level ground.
- firstMapHeightAt · function · L138-L140 — function firstMapHeightAt(x: number, z: number): number
- terrainHeight · function · L142-L149 — function terrainHeight(x: number, z: number, passes: boolean): number
- relief · function · L152-L170 — function relief(x: number, z: number): number
- floors · function · L173-L179 — function floors(x: number, z: number, h: number): number
- roadBed · function · L182-L187 — function roadBed(x: number, z: number, h: number): number
- inTown · function · L189-L191 — Reports whether a point lies inside any town's peaceful area (its radius plus a 5-unit buffer), the predicate used to enforce safe-zone rules like no combat or spawning.
- mulberry32 · function · L194-L203 — Factory for a small seeded PRNG so decoration placement and mob spawns come out identical on server and client for the same seed.
- isDeep · function · L215-L215 — isDeep = (x: number, z: number)
- isDeepCell · function · L218-L219 — isDeepCell = (x: number, z: number)
- bodyY · function · L221-L221 — bodyY = (x: number, z: number)
