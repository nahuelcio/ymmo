# shared/src/data/raids.ts

Data module for instanced raid definitions (each group runs its own arena copy in a worker thread), providing the raid registry with arena/entry coordinates and limits plus the boss HP scaling rule used to balance groups of any size.

- RaidDef · interface · L3-L18 — Plain configuration shape describing one instanced raid: its boss, arena centre and player entry point, player cap, minimum level, and how long the instance stays open after the boss dies.
- raidHpScale · function · L27-L27 — Boss HP balancing rule that scales a raid boss's health by group size while giving a floor of 0.35x so even a solo attempt stays feasible, just long.
