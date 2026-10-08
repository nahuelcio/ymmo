---
name: Delta snapshot bandwidth model
slug: delta-snapshot-bandwidth-model
type: concept
sources:
  - path: shared/src/protocol.ts
    hash: 4348ca088f73a0e920ce11b8cfabaa69c7a7b3e48955d26dc78bcec8497dca43
sources_digest: 2ac9ffa6749b12a1019bf3873472b774ea958fe417286452e8467ee4c6619c2e
links: []
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

Never send full world state: per-tick `snap` messages contain only adds (EntAdd), compact EntUpd tuples (id, position, rotation, HP-percent, flags), and gone-ids. Size is economized everywhere — terse field names (x, z, ry, lk, k), tuples instead of objects, HP as a percent. Consequence clients must honor: absolute HP only exists in EntAdd/SelfState, so each client tracks its own per-entity HP pool and applies updates as percentages; snap.st (server clock) is optional and may be absent.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
