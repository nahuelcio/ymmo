# shared/src/data/camps.ts

Catalog of hostile camp encounter definitions (mob packs led by an elite, cleared for per-player loot chests that repopulate after a timed respawn), plus the id-keyed lookup index built from it.

- CampLoot · interface · L5-L5 — Describes one possible loot-chest drop: which item it can be, the drop chance, and the optional quantity rolled when it drops.
- CampDef · interface · L7-L18 — Template for a full hostile camp encounter — where it stands, its level, elite leader, mob composition, banner color, repopulation delay, and the chest rewards for clearing it.
