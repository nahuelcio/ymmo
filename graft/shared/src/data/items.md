# shared/src/data/items.ts

- Slot · type · L1-L1 — type Slot = 'weapon' | 'head' | 'chest' | 'legs' | 'gloves' | 'feet' | 'amulet' | 'earring' | 'ring';
- Grade · type · L4-L4 — type Grade = 'NG' | 'D' | 'C' | 'B' | 'A' | 'S';
- ItemDef · interface · L6-L25 — interface ItemDef
- tier · function · L31-L49 — function tier(grade: Grade, p: string, sg: string, pl: string, w: number, a: number, j: number, price: number, color: number, mats?: [string, string]): ItemDef[]
- craft · function · L34-L34 — craft = (k: number)
- armor · function · L35-L35 — armor = (id: string, name: string, slot: Slot, icon: string, k: number, s: Partial<ItemDef>): ItemDef
- enchantChance · function · L133-L133 — enchantChance = (e: number)
- enchanted · function · L135-L135 — enchanted = (d: ItemDef, k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef', e = 0)
