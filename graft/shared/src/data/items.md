# shared/src/data/items.ts

The game's master item catalog: it defines the item schema (slots, grades, stats) and the full data table of weapons, armor, consumables, and materials that shops, drops, and combat stats are built from.

- Slot · type · L1-L1 — Enumerates the six equipment slots a character can gear, which determines which items can be equipped where.
- Grade · type · L3-L3 — Defines the three item quality tiers (NG, D, C) that gate gear power, price, and tooltip coloring.
- ItemDef · interface · L5-L20 — The schema every item must satisfy, specifying its identity, price, combat stats, stacking behavior, and consumable use effects.
