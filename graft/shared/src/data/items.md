# shared/src/data/items.ts

- Slot · type · L3-L3 — type Slot = 'weapon' | 'shield' | 'head' | 'chest' | 'cape' | 'legs' | 'gloves' | 'feet' | 'amulet' | 'earring' | 'ring';
- Grade · type · L6-L6 — type Grade = 'NG' | 'D' | 'C' | 'B' | 'A' | 'S';
- ItemDef · interface · L16-L52 — interface ItemDef
- tier · function · L58-L99 — function tier(grade: Grade, p: string, sg: string, pl: string, w: number, a: number, j: number, price: number, color: number, mats?: [string, string], look?: Grade): ItemDef[]
- craft · function · L61-L61 — craft = (k: number)
- armor · function · L62-L62 — armor = (id: string, name: string, slot: Slot, icon: string, k: number, s: Partial<ItemDef>): ItemDef
- dualsOf · function · L102-L108 — function dualsOf(sword: string, name: string): ItemDef
- enchantChance · function · L263-L263 — enchantChance = (e: number)
- enchanted · function · L265-L265 — enchanted = (d: ItemDef, k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef', e = 0)
- wearLevel · function · L272-L272 — wearLevel = (d: ItemDef)
- scrollFits · function · L275-L276 — scrollFits = (scroll: ItemDef, piece: ItemDef)
- MasterworkBonus · interface · L284-L284 — interface MasterworkBonus
- masterworkBonus · function · L290-L298 — function masterworkBonus(race: Race, cls: ClassType, isWeapon: boolean): MasterworkBonus
- speed · function · L292-L292 — speed = (f: number): MasterworkBonus
- lookGrade · function · L300-L300 — lookGrade = (d: ItemDef | null | undefined): Grade | undefined
