---
name: Shared cross-process contract
slug: shared-cross-process-contract
type: system
sources:
  - path: shared/src/protocol.ts
    hash: 4348ca088f73a0e920ce11b8cfabaa69c7a7b3e48955d26dc78bcec8497dca43
  - path: shared/src/status.ts
    hash: 07c244f16821e9e5d9a75dd46c1997284c7569978f127cae5912fbede8221765
  - path: shared/src/terrain.ts
    hash: 985dc1f3492f5d1556d7201f87d5582f9ba9aba9cde8caff06636675fcf1e757
sources_digest: 485a4f77fb6c7d487fe7fb0cd1a447f8c0a1bb6f8a2c120efd06d4d11f5134a0
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
  - symbol: StatusId
    kind: type
    at: 'shared/src/status.ts:L4-L4'
  - symbol: StatusDef
    kind: interface
    at: 'shared/src/status.ts:L6-L6'
  - symbol: StatusApply
    kind: interface
    at: 'shared/src/status.ts:L20-L27'
  - symbol: statusIcons
    kind: function
    at: 'shared/src/status.ts:L29-L31'
  - symbol: hash2
    kind: function
    at: 'shared/src/terrain.ts:L7-L12'
  - symbol: smoothstep
    kind: function
    at: 'shared/src/terrain.ts:L14-L17'
  - symbol: valueNoise
    kind: function
    at: 'shared/src/terrain.ts:L19-L25'
  - symbol: fbm
    kind: function
    at: 'shared/src/terrain.ts:L27-L36'
  - symbol: heightAt
    kind: function
    at: 'shared/src/terrain.ts:L40-L47'
  - symbol: inTown
    kind: function
    at: 'shared/src/terrain.ts:L49-L51'
  - symbol: mulberry32
    kind: function
    at: 'shared/src/terrain.ts:L54-L63'
---
<!-- context:generated:start -->
## Summary

Dependency-light modules imported by BOTH game client and server so message shapes, status definitions, and terrain math agree without any wire negotiation. Core invariant: the two processes must be deployed together — changing protocol shapes, status bits, or terrain formulas/SEED silently desyncs the other side (terrain replaces data-sharing with identical computation). Player-facing strings here are localized in Spanish.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
