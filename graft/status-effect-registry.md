---
name: Status effect registry
slug: status-effect-registry
type: file
sources:
  - path: shared/src/status.ts
    hash: 07c244f16821e9e5d9a75dd46c1997284c7569978f127cae5912fbede8221765
sources_digest: 382ed3f938dfd6597bbe0976928983b0a9d2632b55d35d19a0d7a02e63c15322
links:
  - to: entity-flag-bitmask
    relation: implements
    description: >-
      Registers status bits at 128/256/512/1024 that must never collide with the
      F_* flag constants; statusIcons(flags) decodes the mask for client
      rendering
  - to: shared-cross-process-contract
    relation: part_of
    description: >-
      Shared registry so server (applier/ticker) and client (icon renderer)
      agree on status definitions
generator:
  version: 1
covers:
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
---
<!-- context:generated:start -->
## Summary

Defines the four statuses (stun/slow/bleed/poison) as a single STATUSES registry of bit flag + emoji icon + localized Spanish text; the server applies and ticks statuses while clients only ever see them as entity flag bits (decoded via statusIcons). Non-obvious semantics: DOT magnitude is a FRACTION of the triggering hit's damage (bleed/poison scale with the attack that caused them), `chance` gates on-hit procs while skills always apply, and SLOW_MUL (0.6) is the shared multiplier behind slow's '40% slower' description. STATUS_MASK ORs all flags for clearing/testing; new statuses must pick a fresh power-of-two bit — values start at 128 because lower bits are reserved by other flag definitions.

## Related

- implements [[entity-flag-bitmask]] — Registers status bits at 128/256/512/1024 that must never collide with the F_* flag constants; statusIcons(flags) decodes the mask for client rendering
- part of [[shared-cross-process-contract]] — Shared registry so server (applier/ticker) and client (icon renderer) agree on status definitions
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
