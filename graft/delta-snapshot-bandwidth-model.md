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
covers:
  - symbol: NameColor
    kind: type
    at: 'shared/src/protocol.ts:L6-L6'
  - symbol: CharSummary
    kind: interface
    at: 'shared/src/protocol.ts:L8-L8'
  - symbol: EntPlayer
    kind: interface
    at: 'shared/src/protocol.ts:L10-L15'
  - symbol: EntMob
    kind: interface
    at: 'shared/src/protocol.ts:L16-L16'
  - symbol: EntNpc
    kind: interface
    at: 'shared/src/protocol.ts:L17-L17'
  - symbol: EntItem
    kind: interface
    at: 'shared/src/protocol.ts:L18-L18'
  - symbol: EntAdd
    kind: type
    at: 'shared/src/protocol.ts:L19-L19'
  - symbol: EntUpd
    kind: type
    at: 'shared/src/protocol.ts:L22-L22'
  - symbol: InvItem
    kind: interface
    at: 'shared/src/protocol.ts:L31-L31'
  - symbol: SelfState
    kind: interface
    at: 'shared/src/protocol.ts:L33-L43'
  - symbol: PartyMember
    kind: interface
    at: 'shared/src/protocol.ts:L45-L45'
  - symbol: C2S
    kind: type
    at: 'shared/src/protocol.ts:L48-L82'
  - symbol: S2C
    kind: type
    at: 'shared/src/protocol.ts:L84-L114'
---
<!-- context:generated:start -->
## Summary

Never send full world state: per-tick `snap` messages contain only adds (EntAdd), compact EntUpd tuples (id, position, rotation, HP-percent, flags), and gone-ids. Size is economized everywhere — terse field names (x, z, ry, lk, k), tuples instead of objects, HP as a percent. Consequence clients must honor: absolute HP only exists in EntAdd/SelfState, so each client tracks its own per-entity HP pool and applies updates as percentages; snap.st (server clock) is optional and may be absent.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
