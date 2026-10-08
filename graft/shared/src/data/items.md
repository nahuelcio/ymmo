# shared/src/data/items.ts

The game's master item catalog: it defines the item schema (slots, grades, stats) and the full data table of weapons, armor, consumables, and materials that shops, drops, and combat stats are built from.

- Slot · type · L1-L1 — Enumerates the six equipment slots a character can gear, which determines which items can be equipped where.
- Grade · type · L4-L4 — Defines the three item quality tiers (NG, D, C) that gate gear power, price, and tooltip coloring.
- ItemDef · interface · L6-L25 — The schema every item must satisfy, specifying its identity, price, combat stats, stacking behavior, and consumable use effects.
- tier · function · L31-L49 — function tier(grade: Grade, p: string, sg: string, pl: string, w: number, a: number, j: number, price: number, color: number, mats?: [string, string]): ItemDef[]
- craft · function · L34-L34 — craft = (k: number)
- armor · function · L35-L35 — armor = (id: string, name: string, slot: Slot, icon: string, k: number, s: Partial<ItemDef>): ItemDef
- enchantChance · function · L133-L133 — enchantChance = (e: number)
- enchanted · function · L135-L135 — enchanted = (d: ItemDef, k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef', e = 0)
