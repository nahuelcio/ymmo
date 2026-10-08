---
name: Wire protocol & entity schema
slug: wire-protocol-entity-schema
type: file
sources:
  - path: shared/src/protocol.ts
    hash: 4348ca088f73a0e920ce11b8cfabaa69c7a7b3e48955d26dc78bcec8497dca43
sources_digest: 2ac9ffa6749b12a1019bf3873472b774ea958fe417286452e8467ee4c6619c2e
links:
  - to: delta-snapshot-bandwidth-model
    relation: implements
    description: >-
      snap carries only EntAdd adds, six-number EntUpd tuples, and gone-ids —
      never full world state; terse field names throughout
  - to: entity-flag-bitmask
    relation: implements
    description: >-
      Defines the F_DEAD/F_MOVING/F_CASTING/F_COMBAT/F_PVP flag constants and
      ships a flags bitmask in EntAdd/EntUpd
  - to: shared-cross-process-contract
    relation: part_of
    description: >-
      One of the three modules both processes import; defines every entity and
      message shape exchanged over the socket
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

Single source of truth for all C2S/S2C JSON messages (discriminated by `t`: login/resume, move, attack, skill, trading, quests, party, dash, ping vs error, chars, enter, snap, me, inv, dmg, cast, npc dialogs, tele) and entity shapes EntPlayer/Mob/Npc/Item (discriminated by `k`). Gotchas: EntUpd carries HP as a PERCENT, so absolute full HP only arrives via EntAdd or SelfState; `hp` on EntNpc/EntItem means something unrelated (item durability); `snap.st` server timestamp is optional despite depending on a wire clock in sibling binary.ts; the `world` message tells the client to forget ALL entities on world switch (raid entry); sessions support token-based resume via `resume`/`logout` with the token returned in `chars`.

## Related

- implements [[delta-snapshot-bandwidth-model]] — snap carries only EntAdd adds, six-number EntUpd tuples, and gone-ids — never full world state; terse field names throughout
- implements [[entity-flag-bitmask]] — Defines the F_DEAD/F_MOVING/F_CASTING/F_COMBAT/F_PVP flag constants and ships a flags bitmask in EntAdd/EntUpd
- part of [[shared-cross-process-contract]] — One of the three modules both processes import; defines every entity and message shape exchanged over the socket
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
