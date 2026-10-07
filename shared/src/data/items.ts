export type Slot = 'weapon' | 'head' | 'chest' | 'legs' | 'gloves' | 'feet';
export const SLOTS: Slot[] = ['head', 'weapon', 'chest', 'gloves', 'legs', 'feet'];
export type Grade = 'NG' | 'D' | 'C';

export interface ItemDef {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'consumable' | 'material' | 'currency';
  slot?: Slot;
  grade?: Grade;
  weaponType?: 'sword' | 'staff' | 'blunt';
  pAtk?: number; mAtk?: number; pDef?: number; mDef?: number; mp?: number;
  price: number;
  stack?: boolean;
  use?: { hp?: number; mp?: number; escape?: boolean; cd: number };
  icon: string;
  color: number;
  desc?: string;
}

const list: ItemDef[] = [
  { id: 'adena', name: 'Adena', type: 'currency', price: 1, stack: true, icon: '🪙', color: 0xffd34d },
  // Weapons
  { id: 'short_sword', name: 'Espada Corta', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'sword', pAtk: 8, mAtk: 6, price: 80, icon: '🗡️', color: 0xb8c4cc },
  { id: 'apprentice_wand', name: 'Varita de Aprendiz', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'staff', pAtk: 5, mAtk: 8, price: 80, icon: '🪄', color: 0x9b7b4a },
  { id: 'broadsword', name: 'Espada Ancha', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'sword', pAtk: 11, mAtk: 7, price: 600, icon: '⚔️', color: 0xc8d0d8 },
  { id: 'willow_staff', name: 'Báculo de Sauce', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'staff', pAtk: 7, mAtk: 12, price: 600, icon: '🪄', color: 0x7a9b4a },
  { id: 'iron_hammer', name: 'Martillo de Hierro', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'blunt', pAtk: 12, mAtk: 6, price: 750, icon: '🔨', color: 0x8a8f95 },
  { id: 'sword_of_revolution', name: 'Espada de la Revolución', type: 'weapon', slot: 'weapon', grade: 'D', weaponType: 'sword', pAtk: 20, mAtk: 12, price: 6000, icon: '⚔️', color: 0x9ad0ff },
  { id: 'war_hammer', name: 'Martillo de Guerra Enano', type: 'weapon', slot: 'weapon', grade: 'D', weaponType: 'blunt', pAtk: 22, mAtk: 10, price: 6500, icon: '🔨', color: 0xc08a50 },
  { id: 'staff_of_life', name: 'Báculo de la Vida', type: 'weapon', slot: 'weapon', grade: 'D', weaponType: 'staff', pAtk: 12, mAtk: 22, price: 6000, icon: '🪄', color: 0x6fe08a },
  { id: 'samurai_longsword', name: 'Espada Larga Samurái', type: 'weapon', slot: 'weapon', grade: 'C', weaponType: 'sword', pAtk: 33, mAtk: 18, price: 30000, icon: '⚔️', color: 0xff6a6a },
  { id: 'sages_staff', name: 'Báculo del Sabio', type: 'weapon', slot: 'weapon', grade: 'C', weaponType: 'staff', pAtk: 18, mAtk: 35, price: 30000, icon: '🪄', color: 0xb070ff },
  // Armor NG
  { id: 'leather_cap', name: 'Gorro de Cuero', type: 'armor', slot: 'head', grade: 'NG', pDef: 3, mDef: 1, price: 60, icon: '⛑️', color: 0x8b5a2b },
  { id: 'apprentice_tunic', name: 'Túnica de Aprendiz', type: 'armor', slot: 'chest', grade: 'NG', pDef: 7, mDef: 2, price: 50, icon: '👕', color: 0x8c7a5b },
  { id: 'apprentice_stockings', name: 'Calzas de Aprendiz', type: 'armor', slot: 'legs', grade: 'NG', pDef: 5, mDef: 1, price: 40, icon: '👖', color: 0x6b5a3b },
  { id: 'short_gloves', name: 'Guantes Cortos', type: 'armor', slot: 'gloves', grade: 'NG', pDef: 2, price: 40, icon: '🧤', color: 0x8b5a2b },
  { id: 'leather_sandals', name: 'Sandalias de Cuero', type: 'armor', slot: 'feet', grade: 'NG', pDef: 2, price: 40, icon: '👢', color: 0x8b5a2b },
  // Armor D
  { id: 'brigandine_helm', name: 'Yelmo de Brigantina', type: 'armor', slot: 'head', grade: 'D', pDef: 6, mDef: 2, price: 1800, icon: '⛑️', color: 0x7c8a99 },
  { id: 'brigandine_tunic', name: 'Túnica de Brigantina', type: 'armor', slot: 'chest', grade: 'D', pDef: 15, mDef: 3, price: 4200, icon: '🛡️', color: 0x7c8a99 },
  { id: 'brigandine_gaiters', name: 'Grebas de Brigantina', type: 'armor', slot: 'legs', grade: 'D', pDef: 10, mDef: 2, price: 3000, icon: '👖', color: 0x5f6b78 },
  { id: 'reinforced_gloves', name: 'Guantes de Cuero Reforzado', type: 'armor', slot: 'gloves', grade: 'D', pDef: 4, mDef: 1, price: 1200, icon: '🧤', color: 0x6b4a2b },
  { id: 'reinforced_boots', name: 'Botas de Cuero Reforzado', type: 'armor', slot: 'feet', grade: 'D', pDef: 4, mDef: 1, price: 1200, icon: '👢', color: 0x6b4a2b },
  { id: 'karmian_tunic', name: 'Túnica Karmiana', type: 'armor', slot: 'chest', grade: 'D', pDef: 10, mDef: 8, mp: 40, price: 4200, icon: '👘', color: 0x3c5aa8 },
  { id: 'karmian_stockings', name: 'Calzas Karmianas', type: 'armor', slot: 'legs', grade: 'D', pDef: 7, mDef: 5, mp: 20, price: 3000, icon: '👖', color: 0x2c4a88 },
  // Armor C (drop only)
  { id: 'full_plate_helmet', name: 'Yelmo de Placas', type: 'armor', slot: 'head', grade: 'C', pDef: 9, mDef: 3, price: 9000, icon: '⛑️', color: 0xc0c8d0 },
  { id: 'full_plate_armor', name: 'Armadura de Placas', type: 'armor', slot: 'chest', grade: 'C', pDef: 24, mDef: 4, price: 22000, icon: '🛡️', color: 0xc0c8d0 },
  { id: 'demons_tunic', name: 'Túnica del Demonio', type: 'armor', slot: 'chest', grade: 'C', pDef: 16, mDef: 14, mp: 80, price: 22000, icon: '👘', color: 0x8a1f3a },
  // Consumables
  { id: 'lesser_healing_potion', name: 'Poción de Curación Menor', type: 'consumable', stack: true, price: 15, use: { hp: 60, cd: 5000 }, icon: '🧪', color: 0xd04040, desc: 'Recupera 60 de HP.' },
  { id: 'healing_potion', name: 'Poción de Curación', type: 'consumable', stack: true, price: 60, use: { hp: 160, cd: 5000 }, icon: '🧪', color: 0xff3030, desc: 'Recupera 160 de HP.' },
  { id: 'mana_potion', name: 'Poción de Maná', type: 'consumable', stack: true, price: 80, use: { mp: 60, cd: 8000 }, icon: '🧪', color: 0x3060ff, desc: 'Recupera 60 de MP.' },
  { id: 'scroll_of_escape', name: 'Pergamino de Escape', type: 'consumable', stack: true, price: 200, use: { escape: true, cd: 3000 }, icon: '📜', color: 0xe8d8a0, desc: 'Te lleva de vuelta a la Aldea del Alba.' },
  // Materials (vendor trash)
  { id: 'animal_skin', name: 'Cuero de Animal', type: 'material', stack: true, price: 12, icon: '🟫', color: 0x8b6b4b },
  { id: 'animal_bone', name: 'Hueso de Animal', type: 'material', stack: true, price: 10, icon: '🦴', color: 0xeeeedd },
  { id: 'wolf_pelt', name: 'Piel de Lobo', type: 'material', stack: true, price: 35, icon: '🐺', color: 0x999999 },
  { id: 'goblin_ear', name: 'Oreja de Goblin', type: 'material', stack: true, price: 45, icon: '👂', color: 0x77aa55 },
  { id: 'orc_tusk', name: 'Colmillo de Orco', type: 'material', stack: true, price: 80, icon: '🦷', color: 0xeeeecc },
  { id: 'stone_fragment', name: 'Fragmento de Piedra', type: 'material', stack: true, price: 110, icon: '🪨', color: 0x888888 },
  { id: 'cursed_bone', name: 'Hueso Maldito', type: 'material', stack: true, price: 150, icon: '💀', color: 0xbbbbaa },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((i) => [i.id, i]));
export const GRADE_COLOR: Record<Grade, string> = { NG: '#c8c8c8', D: '#6fb2ff', C: '#ffd24d' };
