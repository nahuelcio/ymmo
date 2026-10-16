# shared/src/terrain.ts

Single source of truth for the world's ground shape and zone rules (fBm hills, mountain walls at the world edge, flat town plateaus, ponds, play-area bounds), letting server and client compute identical terrain from a fixed seed with no sync.

- Pt · type · L19-L19 — type Pt = [number, number];
- Seg · type · L20-L20 — type Seg = [number, number, number, number];
- segsOf · function · L46-L46 — segsOf = (l: Pt[]): Seg[]
- roadLegs · function · L51-L59 — function roadLegs(t: { x: number; z: number }): Pt[]
- at · function · L52-L52 — at = (p: Pt)
- forestAt · function · L106-L114 — function forestAt(x: number, z: number): number
- rev · function · L120-L120 — rev = (l: Pt[])
- inPoly · function · L136-L143 — function inPoly(poly: Pt[], x: number, z: number): boolean
- regionAt · function · L145-L148 — function regionAt(x: number, z: number): string | null
- BiomeId · type · L151-L151 — type BiomeId = 'dawn' | 'dusk' | 'heart' | 'dragon' | 'frost' | 'swamp' | 'ash';
- biomeWeight · function · L154-L162 — function biomeWeight(id: BiomeId, x: number, z: number): number
- onRaidFloor · function · L178-L178 — onRaidFloor = (x: number, z: number, pad = 0)
- inCrater · function · L180-L180 — inCrater = (x: number, z: number, pad = 0)
- hash2 · function · L187-L192 — Maps an integer grid cell to a stable pseudo-random value in [0,1), providing the lattice randomness the noise functions are built on.
- smoothstep · function · L194-L197 — Provides the eased 0-to-1 transition used to blend the town's flat plateau smoothly into the surrounding wild terrain.
- valueNoise · function · L199-L205 — Turns the per-cell hash into continuous 2D noise by bilinearly interpolating the four lattice corners with smooth fade weights.
- fbm · function · L207-L216 — Layers value noise at doubling frequency and halving amplitude to create natural multi-scale terrain detail, normalized back into [0,1].
- segDist · function · L220-L224 — function segDist(px: number, pz: number, [ax, az, bx, bz]: Seg): number
- Boxed · interface · L225-L225 — interface Boxed
- boxed · function · L226-L228 — function boxed(pad: number)
- nearSeg · function · L230-L234 — function nearSeg(list: Boxed[], x: number, z: number): number
- landAt · function · L240-L249 — function landAt(x: number, z: number): number
- ridged · function · L274-L285 — function ridged(x: number, z: number): number
- massifs · function · L286-L298 — function massifs(x: number, z: number): number
- heightAt · function · L300-L323 — Computes the authoritative ground height at any world coordinate: layered noise hills, squared mountain rise near the world edge, and terrain blended flat to TOWN_HEIGHT across each town's safe radius so settlements sit on level ground.
- water · function · L327-L337 — function water(x: number, z: number, h: number): number
- relief · function · L340-L358 — function relief(x: number, z: number): number
- floors · function · L361-L367 — function floors(x: number, z: number, h: number): number
- roadBed · function · L370-L374 — function roadBed(x: number, z: number, h: number): number
- inTown · function · L376-L378 — Reports whether a point lies inside any town's peaceful area (its radius plus a 5-unit buffer), the predicate used to enforce safe-zone rules like no combat or spawning.
- mulberry32 · function · L381-L390 — Factory for a small seeded PRNG so decoration placement and mob spawns come out identical on server and client for the same seed.
- isDeep · function · L403-L403 — isDeep = (x: number, z: number)
- isDeepCell · function · L406-L407 — isDeepCell = (x: number, z: number)
- bodyY · function · L409-L409 — bodyY = (x: number, z: number)
