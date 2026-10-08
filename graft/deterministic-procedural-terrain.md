---
name: Deterministic procedural terrain
slug: deterministic-procedural-terrain
type: file
sources:
  - path: shared/src/terrain.ts
    hash: 985dc1f3492f5d1556d7201f87d5582f9ba9aba9cde8caff06636675fcf1e757
sources_digest: e42cecf698341c0adaa8ea64f9bf911db0b7e3f9bf0210c950acdddaf1c3a31a
links:
  - to: shared-cross-process-contract
    relation: part_of
    description: >-
      Pure math with zero imports, included in both processes precisely so they
      can compute identical ground heights without sharing terrain data
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

Zero-import, purely mathematical module: server and client derive identical ground heights from the fixed SEED 1337 instead of sharing terrain data, with all randomness flowing through a hash2 integer mix using Math.imul for 32-bit cross-platform determinism. Geometry invariants: the town 'Aldea del Alba' is flattened to a plateau via a smoothstep blend starting outside its radius, bowl-shaped mountains fence the map beyond 82% of WORLD_HALF (500), PLAYABLE_HALF bounds the playable area, and WATER_LEVEL (-7) is explicitly visual-only (wadeable ponds, no physics boundary). Any change to SEED, noise formulas, or constants desyncs client/server terrain unless both redeploy together.

## Related

- part of [[shared-cross-process-contract]] — Pure math with zero imports, included in both processes precisely so they can compute identical ground heights without sharing terrain data
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
