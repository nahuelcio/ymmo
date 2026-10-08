---
name: Entity flag bitmask
slug: entity-flag-bitmask
type: concept
sources:
  - path: shared/src/protocol.ts
    hash: 4348ca088f73a0e920ce11b8cfabaa69c7a7b3e48955d26dc78bcec8497dca43
  - path: shared/src/status.ts
    hash: 07c244f16821e9e5d9a75dd46c1997284c7569978f127cae5912fbede8221765
sources_digest: 372d2fe3dbbcb4fcc18e50d6f87dca17bd089daf119d104add7bf37ac6a666b4
links: []
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

A single integer per entity encodes both world state and status effects: F_DEAD/F_MOVING/F_CASTING/F_COMBAT/F_PVP (protocol.ts) occupy the low bits, and status flags start at 128 (stun) through 1024 (poison) (status.ts). The two modules' bits must never collide; the server sets bits and clients never receive StatusId directly — only the mask — so icon rendering depends entirely on this encoding staying consistent.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
