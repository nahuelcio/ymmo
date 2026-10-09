export type Slot = 'weapon' | 'head' | 'chest' | 'legs' | 'gloves' | 'feet' | 'amulet' | 'earring' | 'ring';
// ponytail: one ring, so an item's slot is always where it is worn; a second ring needs ring1/ring2 and a "first free" rule in equip
export const SLOTS: Slot[] = ['head', 'weapon', 'chest', 'gloves', 'legs', 'feet', 'amulet', 'earring', 'ring'];
export type Grade = 'NG' | 'D' | 'C' | 'B' | 'A' | 'S';

export interface ItemDef {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'consumable' | 'material' | 'currency' | 'chest';
  slot?: Slot;
  grade?: Grade;
  /** cosmetic: picks the model and the tooltip label, combat only reads the stats */
  weaponType?: 'sword' | 'staff' | 'blunt' | 'axe' | 'spear' | 'dagger';
  pAtk?: number; mAtk?: number; pDef?: number; mDef?: number; hp?: number; mp?: number;
  /** cooldown reduction for skills, as a fraction: 0.1 = 10% shorter (capped at 50% in total) */
  cdr?: number;
  price: number;
  stack?: boolean;
  use?: { hp?: number; mp?: number; escape?: boolean; cd: number };
  /** recipe: a merchant who lists this item in `craft` makes it for these materials and this much adena */
  craft?: { mats: [string, number][]; adena: number };
  /** enchant scroll: the kind of gear it works on */
  enchant?: 'weapon' | 'armor';
  icon: string;
  color: number;
  desc?: string;
}

/**
 * One full set per grade for levels 20-50. w: sword P.Atk (what a fighter needs to drop a same-level mob in ~12 hits,
 * see the balance_table test in server-rs/src/formulas.rs), a: plate P.Def, j: ring HP, price: base price.
 */
function tier(grade: Grade, p: string, sg: string, pl: string, w: number, a: number, j: number, price: number, color: number, mats?: [string, string]): ItemDef[] {
  const r = Math.round;
  // crafted tiers: 4 of each material per price step (a weapon is 24 + 24) and a third of the price in adena
  const craft = (k: number) => (mats ? { craft: { mats: mats.map((m) => [m, r(k * 4)] as [string, number]), adena: r((price * k) / 3) } } : {});
  const armor = (id: string, name: string, slot: Slot, icon: string, k: number, s: Partial<ItemDef>): ItemDef => ({ id: `${p}_${id}`, name, type: 'armor', slot, grade, price: r(price * k), icon, color, ...s, ...craft(k) });
  return [
    { id: `${p}_blade`, name: `Hoja ${sg}`, type: 'weapon', slot: 'weapon', grade, weaponType: 'sword', pAtk: w, mAtk: r(w * 0.55), price: price * 6, icon: '⚔️', color, ...craft(6) },
    { id: `${p}_staff`, name: `Báculo ${sg}`, type: 'weapon', slot: 'weapon', grade, weaponType: 'staff', pAtk: r(w * 0.55), mAtk: r(w * 1.06), price: price * 6, icon: '🪄', color, ...craft(6) },
    armor('helm', `Yelmo ${sg}`, 'head', '⛑️', 2, { pDef: r(a * 0.4), mDef: r(a * 0.12) }),
    armor('plate', `Coraza ${sg}`, 'chest', '🛡️', 4, { pDef: a, mDef: r(a * 0.15) }),
    armor('robe', `Túnica ${sg}`, 'chest', '👘', 4, { pDef: r(a * 0.67), mDef: r(a * 0.6), mp: j * 2 }),
    armor('greaves', `Grebas ${pl}`, 'legs', '👖', 3, { pDef: r(a * 0.53), mDef: r(a * 0.1) }),
    armor('gauntlets', `Guanteletes ${pl}`, 'gloves', '🧤', 1.5, { pDef: r(a * 0.23), mDef: r(a * 0.05) }),
    armor('boots', `Botas ${pl}`, 'feet', '👢', 1.5, { pDef: r(a * 0.23), mDef: r(a * 0.05) }),
    armor('ring', `Anillo ${sg}`, 'ring', '💍', 2, { mDef: r(j * 0.15), hp: j }),
    armor('earring', `Pendiente ${sg}`, 'earring', '✨', 2, { mDef: r(j * 0.17), mp: r(j * 1.5) }),
    armor('necklace', `Collar ${sg}`, 'amulet', '📿', 3, { mDef: r(j * 0.2), hp: r(j * 1.4), mp: j }),
  ];
}

const list: ItemDef[] = [
  { id: 'adena', name: 'Adena', type: 'currency', price: 1, stack: true, icon: '🪙', color: 0xffd34d },
  // Weapons
  { id: 'short_sword', name: 'Espada Corta', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'sword', pAtk: 8, mAtk: 6, price: 80, icon: '🗡️', color: 0xb8c4cc },
  { id: 'apprentice_wand', name: 'Varita de Aprendiz', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'staff', pAtk: 5, mAtk: 8, price: 80, icon: '🪄', color: 0x9b7b4a },
  { id: 'broadsword', name: 'Espada Ancha', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'sword', pAtk: 11, mAtk: 7, price: 600, icon: '⚔️', color: 0xc8d0d8 },
  { id: 'willow_staff', name: 'Báculo de Sauce', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'staff', pAtk: 7, mAtk: 12, price: 600, icon: '🪄', color: 0x7a9b4a },
  { id: 'iron_hammer', name: 'Martillo de Hierro', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'blunt', pAtk: 12, mAtk: 6, price: 750, icon: '🔨', color: 0x8a8f95 },
  { id: 'dagger', name: 'Daga', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'dagger', pAtk: 9, mAtk: 6, price: 250, icon: '🗡️', color: 0xb8c4cc },
  { id: 'hand_axe', name: 'Hacha de Mano', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'axe', pAtk: 11, mAtk: 6, price: 650, icon: '🪓', color: 0x9aa2aa },
  { id: 'spear', name: 'Lanza', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'spear', pAtk: 11, mAtk: 7, price: 650, icon: '🔱', color: 0xb8c4cc },
  { id: 'assassin_dagger', name: 'Daga del Asesino', type: 'weapon', slot: 'weapon', grade: 'D', weaponType: 'dagger', pAtk: 19, mAtk: 12, price: 5800, icon: '🗡️', color: 0x7adf6a },
  { id: 'battle_axe', name: 'Hacha de Batalla', type: 'weapon', slot: 'weapon', grade: 'D', weaponType: 'axe', pAtk: 22, mAtk: 10, price: 6500, icon: '🪓', color: 0xffb060 },
  { id: 'partisan', name: 'Partesana', type: 'weapon', slot: 'weapon', grade: 'D', weaponType: 'spear', pAtk: 21, mAtk: 11, price: 6200, icon: '🔱', color: 0xa8d8e8 },
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
  { id: 'karmian_hat', name: 'Sombrero Karmiano', type: 'armor', slot: 'head', grade: 'D', pDef: 4, mDef: 4, mp: 15, price: 1800, icon: '🎩', color: 0x3c5aa8 },
  { id: 'brigandine_tunic', name: 'Túnica de Brigantina', type: 'armor', slot: 'chest', grade: 'D', pDef: 15, mDef: 3, price: 4200, icon: '🛡️', color: 0x7c8a99 },
  { id: 'brigandine_gaiters', name: 'Grebas de Brigantina', type: 'armor', slot: 'legs', grade: 'D', pDef: 10, mDef: 2, price: 3000, icon: '👖', color: 0x5f6b78 },
  { id: 'reinforced_gloves', name: 'Guantes de Cuero Reforzado', type: 'armor', slot: 'gloves', grade: 'D', pDef: 4, mDef: 1, price: 1200, icon: '🧤', color: 0x6b4a2b },
  { id: 'reinforced_boots', name: 'Botas de Cuero Reforzado', type: 'armor', slot: 'feet', grade: 'D', pDef: 4, mDef: 1, price: 1200, icon: '👢', color: 0x6b4a2b },
  { id: 'karmian_tunic', name: 'Túnica Karmiana', type: 'armor', slot: 'chest', grade: 'D', pDef: 10, mDef: 8, mp: 40, price: 4200, icon: '👘', color: 0x3c5aa8 },
  { id: 'karmian_stockings', name: 'Calzas Karmianas', type: 'armor', slot: 'legs', grade: 'D', pDef: 7, mDef: 5, mp: 20, price: 3000, icon: '👖', color: 0x2c4a88 },
  // Armor C (drop only)
  { id: 'full_plate_helmet', name: 'Yelmo de Placas', type: 'armor', slot: 'head', grade: 'C', pDef: 9, mDef: 3, price: 9000, icon: '⛑️', color: 0xc0c8d0 },
  { id: 'demons_circlet', name: 'Diadema del Demonio', type: 'armor', slot: 'head', grade: 'C', pDef: 6, mDef: 7, mp: 30, price: 9000, icon: '👑', color: 0x8a1f3a },
  { id: 'full_plate_armor', name: 'Armadura de Placas', type: 'armor', slot: 'chest', grade: 'C', pDef: 24, mDef: 4, price: 22000, icon: '🛡️', color: 0xc0c8d0 },
  { id: 'demons_tunic', name: 'Túnica del Demonio', type: 'armor', slot: 'chest', grade: 'C', pDef: 16, mDef: 14, mp: 80, price: 22000, icon: '👘', color: 0x8a1f3a },
  // Levels 20-50: B is sold in the Bastión del Ocaso; A and S drop, or its smiths make them from zone materials
  ...tier('B', 'abyssal', 'Abisal', 'Abisales', 52, 30, 60, 8000, 0x4a8ab0),
  ...tier('A', 'ashforged', 'de Ceniza', 'de Ceniza', 92, 38, 85, 20000, 0xc8501a, ['ember_shard', 'citadel_sigil']),
  ...tier('S', 'dragon', 'del Dragón', 'del Dragón', 140, 48, 115, 45000, 0x8a1a2a, ['drake_scale', 'dragon_fang']),
  // Jewelry: armor without P.Def (D sold in town, C drop only)
  { id: 'ring_of_vigor', name: 'Anillo del Vigor', type: 'armor', slot: 'ring', grade: 'D', mDef: 3, hp: 25, price: 2200, icon: '💍', color: 0xc0a040 },
  { id: 'earring_of_focus', name: 'Pendiente del Foco', type: 'armor', slot: 'earring', grade: 'D', mDef: 4, mp: 30, price: 2600, icon: '✨', color: 0x6090d0 },
  { id: 'necklace_of_valor', name: 'Collar del Valor', type: 'armor', slot: 'amulet', grade: 'D', mDef: 5, hp: 40, price: 3200, icon: '📿', color: 0xd06060 },
  { id: 'ring_of_the_wastes', name: 'Anillo del Páramo', type: 'armor', slot: 'ring', grade: 'C', mDef: 6, hp: 40, price: 9000, icon: '💍', color: 0x8a6ab0 },
  { id: 'earring_of_binding', name: 'Pendiente del Sello', type: 'armor', slot: 'earring', grade: 'C', mDef: 7, mp: 60, price: 9000, icon: '✨', color: 0x7a4ab0 },
  { id: 'necklace_of_the_ascended', name: 'Collar del Ascendido', type: 'armor', slot: 'amulet', grade: 'C', mDef: 9, hp: 60, mp: 40, price: 12000, icon: '📿', color: 0x8a2aaa },
  // Cooldown reduction: shorter skill recharge times
  { id: 'ring_of_swiftness', name: 'Anillo de Presteza', type: 'armor', slot: 'ring', grade: 'D', mDef: 2, cdr: 0.05, price: 4000, icon: '💍', color: 0x60d0c0, desc: 'Recarga de habilidades -5%.' },
  { id: 'earring_of_clarity', name: 'Pendiente de la Claridad', type: 'armor', slot: 'earring', grade: 'C', mDef: 5, mp: 40, cdr: 0.08, price: 9500, icon: '✨', color: 0x80c8ff, desc: 'Recarga de habilidades -8%.' },
  { id: 'amulet_of_haste', name: 'Amuleto de Celeridad', type: 'armor', slot: 'amulet', grade: 'C', mDef: 6, hp: 50, cdr: 0.1, price: 13000, icon: '📿', color: 0xe0c060, desc: 'Recarga de habilidades -10%.' },
  // Consumables
  { id: 'lesser_healing_potion', name: 'Poción de Curación Menor', type: 'consumable', stack: true, price: 15, use: { hp: 60, cd: 5000 }, icon: '🧪', color: 0xd04040, desc: 'Recupera 60 de HP.' },
  { id: 'healing_potion', name: 'Poción de Curación', type: 'consumable', stack: true, price: 60, use: { hp: 160, cd: 5000 }, icon: '🧪', color: 0xff3030, desc: 'Recupera 160 de HP.' },
  { id: 'mana_potion', name: 'Poción de Maná', type: 'consumable', stack: true, price: 80, use: { mp: 60, cd: 8000 }, icon: '🧪', color: 0x3060ff, desc: 'Recupera 60 de MP.' },
  { id: 'greater_healing_potion', name: 'Poción de Curación Mayor', type: 'consumable', stack: true, price: 250, use: { hp: 400, cd: 5000 }, icon: '🧪', color: 0xff5080, desc: 'Recupera 400 de HP.' },
  { id: 'greater_mana_potion', name: 'Poción de Maná Mayor', type: 'consumable', stack: true, price: 320, use: { mp: 180, cd: 8000 }, icon: '🧪', color: 0x50a0ff, desc: 'Recupera 180 de MP.' },
  { id: 'scroll_of_escape', name: 'Pergamino de Escape', type: 'consumable', stack: true, price: 200, use: { escape: true, cd: 3000 }, icon: '📜', color: 0xe8d8a0, desc: 'Te lleva de vuelta a la Aldea del Alba.' },
  { id: 'scroll_enchant_weapon', name: 'Pergamino: Encantar Arma', type: 'consumable', stack: true, price: 9000, enchant: 'weapon', icon: '📜', color: 0xff8a50, desc: 'Sube +1 un arma. Click derecho sobre el arma para usarlo.' },
  { id: 'scroll_enchant_armor', name: 'Pergamino: Encantar Armadura', type: 'consumable', stack: true, price: 3500, enchant: 'armor', icon: '📜', color: 0x50a0ff, desc: 'Sube +1 una pieza de armadura o joya. Click derecho sobre la pieza para usarlo.' },
  // Materials (vendor trash)
  { id: 'animal_skin', name: 'Cuero de Animal', type: 'material', stack: true, price: 12, icon: '🟫', color: 0x8b6b4b },
  { id: 'animal_bone', name: 'Hueso de Animal', type: 'material', stack: true, price: 10, icon: '🦴', color: 0xeeeedd },
  { id: 'wolf_pelt', name: 'Piel de Lobo', type: 'material', stack: true, price: 35, icon: '🐺', color: 0x999999 },
  { id: 'goblin_ear', name: 'Oreja de Goblin', type: 'material', stack: true, price: 45, icon: '👂', color: 0x77aa55 },
  { id: 'orc_tusk', name: 'Colmillo de Orco', type: 'material', stack: true, price: 80, icon: '🦷', color: 0xeeeecc },
  { id: 'stone_fragment', name: 'Fragmento de Piedra', type: 'material', stack: true, price: 110, icon: '🪨', color: 0x888888 },
  { id: 'camp_chest', name: 'Cofre del Campamento', type: 'chest', price: 0, icon: '🧰', color: 0x8a5a2a, desc: 'Botín del campamento. Abrilo para quedarte con lo que tiene.' },
  { id: 'cursed_bone', name: 'Hueso Maldito', type: 'material', stack: true, price: 150, icon: '💀', color: 0xbbbbaa },
  { id: 'sea_pearl', name: 'Perla Marina', type: 'material', stack: true, price: 220, icon: '🫧', color: 0xd8e8f0 },
  { id: 'ruin_relic', name: 'Reliquia de las Ruinas', type: 'material', stack: true, price: 300, icon: '🏺', color: 0x8a9a8a },
  { id: 'ember_shard', name: 'Esquirla de Brasa', type: 'material', stack: true, price: 400, icon: '🔥', color: 0xe8601a },
  { id: 'citadel_sigil', name: 'Sello de la Ciudadela', type: 'material', stack: true, price: 520, icon: '🎖️', color: 0x8a2a2a },
  { id: 'drake_scale', name: 'Escama de Draco', type: 'material', stack: true, price: 660, icon: '🐉', color: 0x4a8a4a },
  { id: 'dragon_fang', name: 'Colmillo de Dragón', type: 'material', stack: true, price: 820, icon: '🦷', color: 0xf0e8d0 },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((i) => [i.id, i]));
/**
 * Enchanting: each +1 adds `weapon`/`armor` (a fraction) to the piece's stats. Safe up to +`safe`; after that every
 * attempt is `step` less likely, and a failed one destroys the piece (failDestroys) or sends it back to +0.
 */
export const ENCHANT = { weapon: 0.08, armor: 0.05, safe: 3, step: 0.1, max: 10, failDestroys: true };
export const enchantChance = (e: number) => (e < ENCHANT.safe ? 1 : 1 - ENCHANT.step * (e - ENCHANT.safe + 1));
/** A stat of a piece at +e, as the tooltips show it (the server does the real math). */
export const enchanted = (d: ItemDef, k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef', e = 0) => Math.round((d[k] ?? 0) * (1 + (d.type === 'weapon' ? ENCHANT.weapon : ENCHANT.armor) * e));

export const GRADE_COLOR: Record<Grade, string> = { NG: '#c8c8c8', D: '#6fb2ff', C: '#ffd24d', B: '#b388ff', A: '#ff8a3d', S: '#ff4d6a' };
