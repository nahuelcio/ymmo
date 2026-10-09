# shared/src/data/raids.ts

Catalogue of instanced raid encounters — each party runs a private copy of the arena with its own spawn/entry coordinates, player cap, level/quest gates, and post-boss-kill close timer — plus the party-size HP scaling rule used to size each boss for the group attempting it.

- RaidDef · interface · L3-L18 — Plain data contract each instanced raid must declare: arena centre and player entry points, player cap, level gate, optional quest prerequisite for opening it, and how long the instance stays open after the boss dies.
- raidHpScale · function · L27-L27 — Boss HP balancing rule that scales a raid boss's health by group size while giving a floor of 0.35x so even a solo attempt stays feasible, just long.
