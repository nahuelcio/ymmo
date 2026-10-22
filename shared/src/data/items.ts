import { RACES, type ClassType, type Race } from './classes';

export type Slot = 'weapon' | 'shield' | 'head' | 'chest' | 'cape' | 'legs' | 'gloves' | 'feet' | 'amulet' | 'earring' | 'ring';
// ponytail: one ring, so an item's slot is always where it is worn; a second ring needs ring1/ring2 and a "first free" rule in equip
export const SLOTS: Slot[] = ['head', 'weapon', 'shield', 'chest', 'cape', 'gloves', 'legs', 'feet', 'amulet', 'earring', 'ring'];
export type Grade = 'NG' | 'D' | 'C' | 'B' | 'A' | 'S';
/** A shield's chance to block, by its grade: 15% at NG, 3% more each grade, 30% at S. */
export const SHIELD_BLOCK: Record<Grade, number> = { NG: 0.15, D: 0.18, C: 0.21, B: 0.24, A: 0.27, S: 0.3 };
/** How much faster a cape lets its wearer run, by its grade: 2% at NG up to 5% at S (enchanting adds to its defences, not this). */
export const CAPE_SPEED: Record<Grade, number> = { NG: 0.02, D: 0.025, C: 0.03, B: 0.035, A: 0.04, S: 0.05 };
/** how much evasion and attack speed a set's light armour gives, by grade (a multiplier on each piece's share) */
export const LIGHT_EDGE: Record<Grade, number> = { NG: 0.8, D: 1, C: 1.25, B: 1.5, A: 1.75, S: 2 };
/** how much faster each set's magic sword (a mystic's one-handed weapon, a shield beside it) lets its wearer cast */
export const SPELL_CAST: Record<string, number> = { abyssal: 0.04, ashforged: 0.05, dragon: 0.06, glacial: 0.07, emerald: 0.085, infernal: 0.1 };

export interface ItemDef {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'consumable' | 'material' | 'currency' | 'chest';
  slot?: Slot;
  grade?: Grade;
  /** the grade its model is drawn as, when that differs from its grade (pieces re-graded for the level 78 cap keep their look) */
  look?: Grade;
  /** cosmetic: picks the model and the tooltip label, combat only reads the stats */
  weaponType?: 'sword' | 'staff' | 'blunt' | 'axe' | 'spear' | 'dagger' | 'bow' | 'dual' | 'pickaxe';
  /** a pair of swords (weaponType 'dual'): the sword it is two of, as a blacksmith joins them (its recipe) and as it is drawn */
  pair?: string;
  pAtk?: number; mAtk?: number; pDef?: number; mDef?: number; hp?: number; mp?: number;
  /** cooldown reduction for skills, as a fraction: 0.1 = 10% shorter (capped at 50% in total) */
  cdr?: number;
  /** a shield's chance to catch a physical hit, which then does half its damage (0.15 = 15%) */
  block?: number;
  /** how much faster its wearer runs, as a fraction: 0.03 = 3% (a cape's) */
  speed?: number;
  /** points of evasion, and how much faster its wearer attacks (a fraction: 0.02 = 2%): the light armour's */
  evasion?: number;
  atkSpd?: number;
  /** how much faster its wearer casts, as a fraction (0.1 = 10%): a magic sword's; enchanting does not change it */
  castSpd?: number;
  /** a weapon held in both hands: no shield with it */
  twoHanded?: boolean;
  price: number;
  stack?: boolean;
  use?: { hp?: number; mp?: number; escape?: boolean; cd: number };
  /** recipe: a merchant who lists this item in `craft` makes it for these materials and this much adena */
  craft?: { mats: [string, number][]; adena: number };
  /** enchant scroll: the kind of gear it works on (sacred: any piece, and it never fails) */
  enchant?: 'weapon' | 'armor' | 'sacred';
  icon: string;
  color: number;
  desc?: string;
}

/**
 * One full gear set. w: sword P.Atk (what a fighter needs to drop a same-level mob in ~12 hits,
 * see the balance_table test in server-rs/src/formulas.rs), a: plate P.Def, j: ring HP, price: base price.
 */
function tier(grade: Grade, p: string, sg: string, pl: string, w: number, a: number, j: number, price: number, color: number, mats?: [string, string], look?: Grade): ItemDef[] {
  const r = Math.round;
  // crafted tiers: 4 of each material per price step (a weapon is 24 + 24) and a third of the price in adena
  const craft = (k: number) => (mats ? { craft: { mats: mats.map((m) => [m, r(k * 4)] as [string, number]), adena: r((price * k) / 3) } } : {});
  const armor = (id: string, name: string, slot: Slot, icon: string, k: number, s: Partial<ItemDef>): ItemDef => ({ id: `${p}_${id}`, name, type: 'armor', slot, grade, ...(look && { look }), price: r(price * k), icon, color, ...s, ...craft(k) });
  return [
    { id: `${p}_blade`, name: `Hoja ${sg}`, type: 'weapon', slot: 'weapon', grade, ...(look && { look }), weaponType: 'sword', pAtk: w, mAtk: r(w * 0.55), price: price * 6, icon: '⚔️', color, ...craft(6) },
    { id: `${p}_staff`, name: `Báculo ${sg}`, type: 'weapon', slot: 'weapon', grade, ...(look && { look }), weaponType: 'staff', twoHanded: true, pAtk: r(w * 0.55), mAtk: r(w * 1.06), price: price * 6, icon: '🪄', color, ...craft(6) },
    // the mystic's other choice: a sword in one hand, a shield in the other, and quicker casting for a fifth less M.Atk
    { id: `${p}_spellblade`, name: `Espada Mágica ${sg}`, type: 'weapon', slot: 'weapon', grade, ...(look && { look }), weaponType: 'sword', pAtk: r(w * 0.55), mAtk: r(w * 1.06 * 0.8),
      castSpd: SPELL_CAST[p], price: price * 6, icon: '🗡️', color, ...craft(6), desc: 'Espada de místico: hechiza más rápido y deja la otra mano libre para un escudo.' },
    // a pair of its swords, one in each hand (the gladiator's): a blacksmith joins two of the blade
    { id: `${p}_duals`, name: `Hojas Duales ${pl}`, type: 'weapon', slot: 'weapon', grade, ...(look && { look }), weaponType: 'dual', pair: `${p}_blade`, twoHanded: true,
      pAtk: r(w * 1.25), mAtk: r(w * 0.55), price: r(price * 15), icon: '⚔️', color, craft: { mats: [[`${p}_blade`, 2]], adena: r(price * 3) } },
    // the archer's bow (at range, two hands) and the assassin's dagger (less of the sword's power, their skills make it up)
    { id: `${p}_bow`, name: `Arco ${sg}`, type: 'weapon', slot: 'weapon', grade, ...(look && { look }), weaponType: 'bow', twoHanded: true, pAtk: r(w * 0.95), mAtk: r(w * 0.4), price: price * 6, icon: '🏹', color, ...craft(6) },
    { id: `${p}_dagger`, name: `Daga ${sg}`, type: 'weapon', slot: 'weapon', grade, ...(look && { look }), weaponType: 'dagger', pAtk: r(w * 0.85), mAtk: r(w * 0.5), price: price * 5, icon: '🗡️', color, ...craft(5) },
    armor('helm', `Yelmo ${sg}`, 'head', '⛑️', 2, { pDef: r(a * 0.4), mDef: r(a * 0.12) }),
    // a mage's crown, gloves and shoes: less of the plate's P.Def, more M.Def and MP, as the robe has
    armor('circlet', `Diadema ${sg}`, 'head', '👑', 2, { pDef: r(a * 0.27), mDef: r(a * 0.25), mp: r(j * 0.6) }),
    armor('plate', `Coraza ${sg}`, 'chest', '🛡️', 4, { pDef: a, mDef: r(a * 0.15) }),
    armor('robe', `Túnica ${sg}`, 'chest', '👘', 4, { pDef: r(a * 0.67), mDef: r(a * 0.6), mp: j * 2 }),
    armor('shield', `Escudo ${sg}`, 'shield', '🛡️', 2, { block: SHIELD_BLOCK[grade] }),
    // a cape: a little of both defences and a quicker stride
    armor('cape', `Capa ${sg}`, 'cape', '🧥', 1.5, { pDef: r(a * 0.12), mDef: r(a * 0.12), speed: CAPE_SPEED[grade] }),
    armor('greaves', `Grebas ${pl}`, 'legs', '👖', 3, { pDef: r(a * 0.53), mDef: r(a * 0.1) }),
    armor('gauntlets', `Guanteletes ${pl}`, 'gloves', '🧤', 1.5, { pDef: r(a * 0.23), mDef: r(a * 0.05) }),
    armor('gloves', `Guantes ${pl}`, 'gloves', '🧤', 1.5, { pDef: r(a * 0.15), mDef: r(a * 0.14), mp: r(j * 0.4) }),
    armor('boots', `Botas ${pl}`, 'feet', '👢', 1.5, { pDef: r(a * 0.23), mDef: r(a * 0.05) }),
    armor('shoes', `Zapatos ${pl}`, 'feet', '🥿', 1.5, { pDef: r(a * 0.15), mDef: r(a * 0.14), mp: r(j * 0.4) }),
    // the light armour (the archer's and the assassin's): less of the plate's P.Def, more M.Def, and evasion and a
    // quicker hand in its place; a hood rather than a helm
    armor('hood', `Capucha ${sg}`, 'head', '🥷', 2, { pDef: r(a * 0.28), mDef: r(a * 0.16), evasion: r(2 * LIGHT_EDGE[grade]), atkSpd: +(0.01 * LIGHT_EDGE[grade]).toFixed(3) }),
    armor('jerkin', `Jubón ${sg}`, 'chest', '🦺', 4, { pDef: r(a * 0.7), mDef: r(a * 0.3), evasion: r(3 * LIGHT_EDGE[grade]), atkSpd: +(0.02 * LIGHT_EDGE[grade]).toFixed(3) }),
    armor('bracers', `Brazales ${pl}`, 'gloves', '🧤', 1.5, { pDef: r(a * 0.16), mDef: r(a * 0.08), evasion: r(1 * LIGHT_EDGE[grade]), atkSpd: +(0.015 * LIGHT_EDGE[grade]).toFixed(3) }),
    armor('leggings', `Calzas ${pl}`, 'legs', '👖', 3, { pDef: r(a * 0.37), mDef: r(a * 0.16), evasion: r(2 * LIGHT_EDGE[grade]), atkSpd: +(0.01 * LIGHT_EDGE[grade]).toFixed(3) }),
    armor('treads', `Botines ${pl}`, 'feet', '🥾', 1.5, { pDef: r(a * 0.16), mDef: r(a * 0.08), evasion: r(1 * LIGHT_EDGE[grade]), atkSpd: +(0.005 * LIGHT_EDGE[grade]).toFixed(3) }),
    armor('ring', `Anillo ${sg}`, 'ring', '💍', 2, { mDef: r(j * 0.15), hp: j }),
    armor('earring', `Pendiente ${sg}`, 'earring', '✨', 2, { mDef: r(j * 0.17), mp: r(j * 1.5) }),
    armor('necklace', `Collar ${sg}`, 'amulet', '📿', 3, { mDef: r(j * 0.2), hp: r(j * 1.4), mp: j }),
  ];
}

/** A pair of a plain sword: its look and grade, a quarter more of its power, two hands (no shield); a blacksmith joins two. */
function dualsOf(sword: string, name: string): ItemDef {
  const sw = SWORDS[sword];
  const r = Math.round;
  return { id: sword === 'sword_of_revolution' ? 'revolution_duals' : sword === 'samurai_longsword' ? 'samurai_duals' : `${sword}_duals`, name, type: 'weapon', slot: 'weapon',
    grade: sw.grade, ...(sw.look && { look: sw.look }), weaponType: 'dual', pair: sword, twoHanded: true, pAtk: r(sw.pAtk * 1.25), mAtk: sw.mAtk,
    price: r(sw.price * 2.5), icon: '⚔️', color: sw.color, craft: { mats: [[sword, 2]], adena: r(sw.price * 0.5) } };
}
/** the plain swords a pair is made of (filled from the list below, before the pairs are built) */
const SWORDS: Record<string, { grade: Grade; look?: Grade; pAtk: number; mAtk: number; price: number; color: number }> = {
  short_sword: { grade: 'NG', pAtk: 8, mAtk: 6, price: 80, color: 0xb8c4cc },
  broadsword: { grade: 'NG', pAtk: 11, mAtk: 7, price: 600, color: 0xc8d0d8 },
  sword_of_revolution: { grade: 'NG', look: 'D', pAtk: 20, mAtk: 12, price: 6000, color: 0x9ad0ff },
  samurai_longsword: { grade: 'D', look: 'C', pAtk: 33, mAtk: 18, price: 30000, color: 0xff6a6a },
};

const list: ItemDef[] = [
  { id: 'adena', name: 'Adena', type: 'currency', price: 1, stack: true, icon: '🪙', color: 0xffd34d },
  // Weapons
  { id: 'short_sword', name: 'Espada Corta', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'sword', pAtk: 8, mAtk: 6, price: 80, icon: '🗡️', color: 0xb8c4cc },
  { id: 'apprentice_wand', name: 'Varita de Aprendiz', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'staff', pAtk: 5, mAtk: 8, price: 80, icon: '🪄', color: 0x9b7b4a },
  { id: 'broadsword', name: 'Espada Ancha', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'sword', pAtk: 11, mAtk: 7, price: 600, icon: '⚔️', color: 0xc8d0d8 },
  { id: 'willow_staff', name: 'Báculo de Sauce', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'staff', twoHanded: true, pAtk: 7, mAtk: 12, price: 600, icon: '🪄', color: 0x7a9b4a, craft: { mats: [['wood_log', 10]], adena: 150 } },
  { id: 'iron_hammer', name: 'Martillo de Hierro', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'blunt', pAtk: 12, mAtk: 6, price: 750, icon: '🔨', color: 0x8a8f95, craft: { mats: [['iron_ore', 8], ['wood_log', 3]], adena: 180 } },
  { id: 'dagger', name: 'Daga', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'dagger', pAtk: 9, mAtk: 6, price: 250, icon: '🗡️', color: 0xb8c4cc },
  { id: 'hand_axe', name: 'Hacha de Mano', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'axe', pAtk: 11, mAtk: 6, price: 650, icon: '🪓', color: 0x9aa2aa, craft: { mats: [['iron_ore', 6], ['wood_log', 4]], adena: 150 } },
  // gathering tools: an axe fells trees, a pickaxe (or any hammer) mines rocks (shared/src/nodes.ts)
  { id: 'woodcutter_axe', name: 'Hacha de Leñador', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'axe', pAtk: 6, mAtk: 3, price: 120, icon: '🪓', color: 0x8a6a4a, desc: 'Sirve para talar árboles.' },
  { id: 'miner_pickaxe', name: 'Pico de Minero', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'pickaxe', pAtk: 6, mAtk: 3, price: 120, icon: '⛏️', color: 0x8a8f95, desc: 'Sirve para picar rocas.' },
  { id: 'spear', name: 'Lanza', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'spear', twoHanded: true, pAtk: 11, mAtk: 7, price: 650, icon: '🔱', color: 0xb8c4cc },
  // pairs of swords (the gladiator's), each joined by a blacksmith from two of its sword
  ...([['short_sword', 'Espadas Cortas Duales'], ['broadsword', 'Espadas Anchas Duales'], ['sword_of_revolution', 'Espadas de la Revolución Duales'],
    ['samurai_longsword', 'Espadas Samurái Duales']] as const).map(([sw, name]) => dualsOf(sw, name)),
  // bows: the archer's (any warrior can shoot one; the archer's skills ask for it)
  { id: 'short_bow', name: 'Arco Corto', type: 'weapon', slot: 'weapon', grade: 'NG', weaponType: 'bow', twoHanded: true, pAtk: 10, mAtk: 4, price: 600, icon: '🏹', color: 0x9a7a4a, craft: { mats: [['wood_log', 12]], adena: 150 } },
  { id: 'hunting_bow', name: 'Arco de Cazador', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'bow', twoHanded: true, pAtk: 20, mAtk: 8, price: 6000, icon: '🏹', color: 0x6a8a3a },
  { id: 'composite_bow', name: 'Arco Compuesto', type: 'weapon', slot: 'weapon', grade: 'D', look: 'C', weaponType: 'bow', twoHanded: true, pAtk: 32, mAtk: 12, price: 30000, icon: '🏹', color: 0xb05a2a },
  { id: 'stiletto', name: 'Estilete', type: 'weapon', slot: 'weapon', grade: 'D', look: 'C', weaponType: 'dagger', pAtk: 29, mAtk: 16, price: 26000, icon: '🗡️', color: 0x9a6ad8 },
  { id: 'assassin_dagger', name: 'Daga del Asesino', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'dagger', pAtk: 19, mAtk: 12, price: 5800, icon: '🗡️', color: 0x7adf6a },
  { id: 'battle_axe', name: 'Hacha de Batalla', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'axe', twoHanded: true, pAtk: 22, mAtk: 10, price: 6500, icon: '🪓', color: 0xffb060, craft: { mats: [['iron_ore', 40], ['wood_log', 20]], adena: 2000 } },
  { id: 'partisan', name: 'Partesana', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'spear', twoHanded: true, pAtk: 21, mAtk: 11, price: 6200, icon: '🔱', color: 0xa8d8e8 },
  { id: 'sword_of_revolution', name: 'Espada de la Revolución', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'sword', pAtk: 20, mAtk: 12, price: 6000, icon: '⚔️', color: 0x9ad0ff },
  { id: 'war_hammer', name: 'Martillo de Guerra Enano', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'blunt', twoHanded: true, pAtk: 22, mAtk: 10, price: 6500, icon: '🔨', color: 0xc08a50, craft: { mats: [['iron_ore', 45], ['wood_log', 15]], adena: 2000 } },
  { id: 'staff_of_life', name: 'Báculo de la Vida', type: 'weapon', slot: 'weapon', grade: 'NG', look: 'D', weaponType: 'staff', twoHanded: true, pAtk: 12, mAtk: 22, price: 6000, icon: '🪄', color: 0x6fe08a },
  { id: 'samurai_longsword', name: 'Espada Larga Samurái', type: 'weapon', slot: 'weapon', grade: 'D', look: 'C', weaponType: 'sword', twoHanded: true, pAtk: 33, mAtk: 18, price: 30000, icon: '⚔️', color: 0xff6a6a },
  { id: 'sages_staff', name: 'Báculo del Sabio', type: 'weapon', slot: 'weapon', grade: 'D', look: 'C', weaponType: 'staff', twoHanded: true, pAtk: 18, mAtk: 35, price: 30000, icon: '🪄', color: 0xb070ff },
  // Armor NG
  { id: 'leather_cap', name: 'Gorro de Cuero', type: 'armor', slot: 'head', grade: 'NG', pDef: 3, mDef: 1, price: 60, icon: '⛑️', color: 0x8b5a2b },
  // a buckler is small: it catches fewer blows than an NG shield proper
  { id: 'wooden_buckler', name: 'Rodela de Madera', type: 'armor', slot: 'shield', grade: 'NG', block: 0.12, price: 90, icon: '🛡️', color: 0x9a7048 },
  { id: 'wool_cape', name: 'Capa de Lana', type: 'armor', slot: 'cape', grade: 'NG', pDef: 1, mDef: 1, speed: 0.015, price: 80, icon: '🧥', color: 0x7a5a3a },
  { id: 'apprentice_tunic', name: 'Túnica de Aprendiz', type: 'armor', slot: 'chest', grade: 'NG', pDef: 7, mDef: 2, price: 50, icon: '👕', color: 0x8c7a5b },
  { id: 'apprentice_stockings', name: 'Calzas de Aprendiz', type: 'armor', slot: 'legs', grade: 'NG', pDef: 5, mDef: 1, price: 40, icon: '👖', color: 0x6b5a3b },
  { id: 'short_gloves', name: 'Guantes Cortos', type: 'armor', slot: 'gloves', grade: 'NG', pDef: 2, price: 40, icon: '🧤', color: 0x8b5a2b },
  { id: 'leather_sandals', name: 'Sandalias de Cuero', type: 'armor', slot: 'feet', grade: 'NG', pDef: 2, price: 40, icon: '👢', color: 0x8b5a2b },
  // Armor NG, once D
  { id: 'brigandine_helm', name: 'Yelmo de Brigantina', type: 'armor', slot: 'head', grade: 'NG', look: 'D', pDef: 6, mDef: 2, price: 1800, icon: '⛑️', color: 0x7c8a99 },
  { id: 'brigandine_shield', name: 'Escudo de Brigantina', type: 'armor', slot: 'shield', grade: 'NG', look: 'D', block: 0.15, price: 2200, icon: '🛡️', color: 0x7c8a99 },
  { id: 'hunter_cape', name: 'Capa de Cazador', type: 'armor', slot: 'cape', grade: 'NG', look: 'D', pDef: 2, mDef: 2, speed: 0.02, price: 1600, icon: '🧥', color: 0x2f4a2a },
  { id: 'karmian_hat', name: 'Sombrero Karmiano', type: 'armor', slot: 'head', grade: 'NG', look: 'D', pDef: 4, mDef: 4, mp: 15, price: 1800, icon: '🎩', color: 0x3c5aa8 },
  { id: 'brigandine_tunic', name: 'Túnica de Brigantina', type: 'armor', slot: 'chest', grade: 'NG', look: 'D', pDef: 15, mDef: 3, price: 4200, icon: '🛡️', color: 0x7c8a99 },
  { id: 'brigandine_gaiters', name: 'Grebas de Brigantina', type: 'armor', slot: 'legs', grade: 'NG', look: 'D', pDef: 10, mDef: 2, price: 3000, icon: '👖', color: 0x5f6b78 },
  { id: 'reinforced_gloves', name: 'Guantes de Cuero Reforzado', type: 'armor', slot: 'gloves', grade: 'NG', look: 'D', pDef: 4, mDef: 1, price: 1200, icon: '🧤', color: 0x6b4a2b },
  { id: 'reinforced_boots', name: 'Botas de Cuero Reforzado', type: 'armor', slot: 'feet', grade: 'NG', look: 'D', pDef: 4, mDef: 1, price: 1200, icon: '👢', color: 0x6b4a2b },
  { id: 'karmian_tunic', name: 'Túnica Karmiana', type: 'armor', slot: 'chest', grade: 'NG', look: 'D', pDef: 10, mDef: 8, mp: 40, price: 4200, icon: '👘', color: 0x3c5aa8 },
  { id: 'karmian_stockings', name: 'Calzas Karmianas', type: 'armor', slot: 'legs', grade: 'NG', look: 'D', pDef: 7, mDef: 5, mp: 20, price: 3000, icon: '👖', color: 0x2c4a88 },
  // Armor D, once C (drop only)
  { id: 'full_plate_helmet', name: 'Yelmo de Placas', type: 'armor', slot: 'head', grade: 'D', look: 'C', pDef: 9, mDef: 3, price: 9000, icon: '⛑️', color: 0xc0c8d0 },
  { id: 'full_plate_shield', name: 'Escudo de Placas', type: 'armor', slot: 'shield', grade: 'D', look: 'C', block: 0.18, price: 10000, icon: '🛡️', color: 0xc0c8d0 },
  { id: 'knight_cape', name: 'Capa de Caballero', type: 'armor', slot: 'cape', grade: 'D', look: 'C', pDef: 3, mDef: 3, speed: 0.025, price: 8000, icon: '🧥', color: 0x8a1f1f },
  { id: 'demons_circlet', name: 'Diadema del Demonio', type: 'armor', slot: 'head', grade: 'D', look: 'C', pDef: 6, mDef: 7, mp: 30, price: 9000, icon: '👑', color: 0x8a1f3a },
  { id: 'full_plate_armor', name: 'Armadura de Placas', type: 'armor', slot: 'chest', grade: 'D', look: 'C', pDef: 24, mDef: 4, price: 22000, icon: '🛡️', color: 0xc0c8d0 },
  { id: 'demons_tunic', name: 'Túnica del Demonio', type: 'armor', slot: 'chest', grade: 'D', look: 'C', pDef: 16, mDef: 14, mp: 80, price: 22000, icon: '👘', color: 0x8a1f3a },
  // Levels 20-50: the Abyssal set is sold in the Bastión del Ocaso; Ashforged and Dragon drop, or its smiths make them from
  // zone materials. They were B, A and S before the level 78 cap (look keeps how they are drawn); B, A and S are the 50-78 sets.
  ...tier('D', 'abyssal', 'Abisal', 'Abisales', 52, 30, 60, 8000, 0x4a8ab0, undefined, 'B'),
  ...tier('D', 'ashforged', 'de Ceniza', 'de Ceniza', 92, 38, 85, 20000, 0xc8501a, ['ember_shard', 'citadel_sigil'], 'A'),
  ...tier('C', 'dragon', 'del Dragón', 'del Dragón', 140, 48, 115, 45000, 0x8a1a2a, ['drake_scale', 'dragon_fang'], 'S'),
  // Levels 50-78, one set a region of the ring: Glacial (B) is sold in the Fuerte de Escarcha
  ...tier('B', 'glacial', 'Glacial', 'Glaciales', 195, 54, 145, 80000, 0x8ac8f0),
  // Emerald (A): Juncoverde's masters make it from the swamp's venom and the jungle's bark
  ...tier('A', 'emerald', 'Esmeralda', 'Esmeralda', 265, 62, 180, 140000, 0x3ac87a, ['swamp_venom', 'ancient_bark']),
  // Infernal (S): Brasaoscura's masters make it from magma cores and the essence the Abyss bleeds (its raid boss gives the most)
  ...tier('S', 'infernal', 'Infernal', 'Infernales', 350, 72, 225, 240000, 0xd8401a, ['magma_core', 'abyss_essence']),
  // Jewelry: armor without P.Def (the once-D ones sold in town, the once-C ones drop only)
  { id: 'ring_of_vigor', name: 'Anillo del Vigor', type: 'armor', slot: 'ring', grade: 'NG', look: 'D', mDef: 3, hp: 25, price: 2200, icon: '💍', color: 0xc0a040 },
  { id: 'earring_of_focus', name: 'Pendiente del Foco', type: 'armor', slot: 'earring', grade: 'NG', look: 'D', mDef: 4, mp: 30, price: 2600, icon: '✨', color: 0x6090d0 },
  { id: 'necklace_of_valor', name: 'Collar del Valor', type: 'armor', slot: 'amulet', grade: 'NG', look: 'D', mDef: 5, hp: 40, price: 3200, icon: '📿', color: 0xd06060 },
  { id: 'ring_of_the_wastes', name: 'Anillo del Páramo', type: 'armor', slot: 'ring', grade: 'D', look: 'C', mDef: 6, hp: 40, price: 9000, icon: '💍', color: 0x8a6ab0 },
  { id: 'earring_of_binding', name: 'Pendiente del Sello', type: 'armor', slot: 'earring', grade: 'D', look: 'C', mDef: 7, mp: 60, price: 9000, icon: '✨', color: 0x7a4ab0 },
  { id: 'necklace_of_the_ascended', name: 'Collar del Ascendido', type: 'armor', slot: 'amulet', grade: 'D', look: 'C', mDef: 9, hp: 60, mp: 40, price: 12000, icon: '📿', color: 0x8a2aaa },
  // Cooldown reduction: shorter skill recharge times
  { id: 'ring_of_swiftness', name: 'Anillo de Presteza', type: 'armor', slot: 'ring', grade: 'NG', look: 'D', mDef: 2, cdr: 0.05, price: 4000, icon: '💍', color: 0x60d0c0, desc: 'Recarga de habilidades -5%.' },
  { id: 'earring_of_clarity', name: 'Pendiente de la Claridad', type: 'armor', slot: 'earring', grade: 'D', look: 'C', mDef: 5, mp: 40, cdr: 0.08, price: 9500, icon: '✨', color: 0x80c8ff, desc: 'Recarga de habilidades -8%.' },
  { id: 'amulet_of_haste', name: 'Amuleto de Celeridad', type: 'armor', slot: 'amulet', grade: 'D', look: 'C', mDef: 6, hp: 50, cdr: 0.1, price: 13000, icon: '📿', color: 0xe0c060, desc: 'Recarga de habilidades -10%.' },
  // Consumables
  { id: 'lesser_healing_potion', name: 'Poción de Curación Menor', type: 'consumable', stack: true, price: 15, use: { hp: 60, cd: 5000 }, icon: '🧪', color: 0xd04040, desc: 'Recupera 60 de HP.' },
  { id: 'healing_potion', name: 'Poción de Curación', type: 'consumable', stack: true, price: 60, use: { hp: 160, cd: 5000 }, icon: '🧪', color: 0xff3030, desc: 'Recupera 160 de HP.', craft: { mats: [['wild_berries', 5]], adena: 15 } },
  { id: 'wild_berries', name: 'Bayas Silvestres', type: 'consumable', stack: true, price: 6, use: { hp: 35, cd: 2000 }, icon: '🫐', color: 0xb02a4a, desc: 'Recuperan 35 de HP. Con 5 te preparan una Poción de Curación.' },
  { id: 'mana_potion', name: 'Poción de Maná', type: 'consumable', stack: true, price: 80, use: { mp: 60, cd: 8000 }, icon: '🧪', color: 0x3060ff, desc: 'Recupera 60 de MP.' },
  { id: 'greater_healing_potion', name: 'Poción de Curación Mayor', type: 'consumable', stack: true, price: 250, use: { hp: 400, cd: 5000 }, icon: '🧪', color: 0xff5080, desc: 'Recupera 400 de HP.' },
  { id: 'greater_mana_potion', name: 'Poción de Maná Mayor', type: 'consumable', stack: true, price: 320, use: { mp: 180, cd: 8000 }, icon: '🧪', color: 0x50a0ff, desc: 'Recupera 180 de MP.' },
  // sold in the ring's towns (levels 50-78)
  { id: 'supreme_healing_potion', name: 'Poción de Curación Suprema', type: 'consumable', stack: true, price: 600, use: { hp: 750, cd: 5000 }, icon: '🧪', color: 0xff3a6a, desc: 'Recupera 750 de HP.' },
  { id: 'supreme_mana_potion', name: 'Poción de Maná Suprema', type: 'consumable', stack: true, price: 750, use: { mp: 350, cd: 8000 }, icon: '🧪', color: 0x3a8aff, desc: 'Recupera 350 de MP.' },
  { id: 'scroll_of_escape', name: 'Pergamino de Escape', type: 'consumable', stack: true, price: 200, use: { escape: true, cd: 3000 }, icon: '📜', color: 0xe8d8a0, desc: 'Te lleva de vuelta a la Aldea del Alba.' },
  { id: 'scroll_enchant_weapon', name: 'Pergamino: Encantar Arma', type: 'consumable', stack: true, price: 9000, enchant: 'weapon', icon: '📜', color: 0xff8a50, desc: 'Sube +1 un arma. Click derecho sobre el arma para usarlo.' },
  // dropped by the Avatar de la Guerra (Encrucijada Sangrienta): never fails
  { id: 'scroll_enchant_sacred', name: 'Pergamino Sagrado de Encantamiento', type: 'consumable', stack: true, price: 150000, enchant: 'sacred', icon: '📜', color: 0xffe9a0, desc: 'Sube +1 seguro cualquier arma, armadura o joya: no puede fallar ni romperla.' },
  { id: 'scroll_enchant_armor', name: 'Pergamino: Encantar Armadura', type: 'consumable', stack: true, price: 3500, enchant: 'armor', icon: '📜', color: 0x50a0ff, desc: 'Sube +1 una pieza de armadura o joya. Click derecho sobre la pieza para usarlo.' },
  // dropped in the Grieta de las Brasas: their grade is the only gear they enchant (server-rs inventory.rs enchant)
  { id: 'scroll_enchant_weapon_c', name: 'Pergamino: Encantar Arma (Grado C)', type: 'consumable', grade: 'C', stack: true, price: 9000, enchant: 'weapon', icon: '📜', color: 0xff8a50, desc: 'Sube +1 un arma de grado C (solo grado C). Click derecho sobre el arma para usarlo.' },
  { id: 'scroll_enchant_armor_c', name: 'Pergamino: Encantar Armadura (Grado C)', type: 'consumable', grade: 'C', stack: true, price: 3500, enchant: 'armor', icon: '📜', color: 0x50a0ff, desc: 'Sube +1 una pieza de armadura o joya de grado C (solo grado C). Click derecho sobre la pieza para usarlo.' },
  // dropped in the Hondonada de los Aullidos: they only enchant D-grade gear
  { id: 'scroll_enchant_weapon_d', name: 'Pergamino: Encantar Arma (Grado D)', type: 'consumable', grade: 'D', stack: true, price: 9000, enchant: 'weapon', icon: '📜', color: 0xff8a50, desc: 'Sube +1 un arma de grado D (solo grado D). Click derecho sobre el arma para usarlo.' },
  { id: 'scroll_enchant_armor_d', name: 'Pergamino: Encantar Armadura (Grado D)', type: 'consumable', grade: 'D', stack: true, price: 3500, enchant: 'armor', icon: '📜', color: 0x50a0ff, desc: 'Sube +1 una pieza de armadura o joya de grado D (solo grado D). Click derecho sobre la pieza para usarlo.' },
  // dropped in the Llanos de la Ventisca (B) and the Corazón de la Ciénaga (A): they only enchant their grade's gear
  { id: 'scroll_enchant_weapon_b', name: 'Pergamino: Encantar Arma (Grado B)', type: 'consumable', grade: 'B', stack: true, price: 9000, enchant: 'weapon', icon: '📜', color: 0xff8a50, desc: 'Sube +1 un arma de grado B (solo grado B). Click derecho sobre el arma para usarlo.' },
  { id: 'scroll_enchant_armor_b', name: 'Pergamino: Encantar Armadura (Grado B)', type: 'consumable', grade: 'B', stack: true, price: 3500, enchant: 'armor', icon: '📜', color: 0x50a0ff, desc: 'Sube +1 una pieza de armadura o joya de grado B (solo grado B). Click derecho sobre la pieza para usarlo.' },
  { id: 'scroll_enchant_weapon_a', name: 'Pergamino: Encantar Arma (Grado A)', type: 'consumable', grade: 'A', stack: true, price: 9000, enchant: 'weapon', icon: '📜', color: 0xff8a50, desc: 'Sube +1 un arma de grado A (solo grado A). Click derecho sobre el arma para usarlo.' },
  { id: 'scroll_enchant_armor_a', name: 'Pergamino: Encantar Armadura (Grado A)', type: 'consumable', grade: 'A', stack: true, price: 3500, enchant: 'armor', icon: '📜', color: 0x50a0ff, desc: 'Sube +1 una pieza de armadura o joya de grado A (solo grado A). Click derecho sobre la pieza para usarlo.' },
  // Materials (vendor trash)
  { id: 'animal_skin', name: 'Cuero de Animal', type: 'material', stack: true, price: 12, icon: '🟫', color: 0x8b6b4b },
  { id: 'animal_bone', name: 'Hueso de Animal', type: 'material', stack: true, price: 10, icon: '🦴', color: 0xeeeedd },
  { id: 'wolf_pelt', name: 'Piel de Lobo', type: 'material', stack: true, price: 35, icon: '🐺', color: 0x999999 },
  { id: 'goblin_ear', name: 'Oreja de Goblin', type: 'material', stack: true, price: 45, icon: '👂', color: 0x77aa55 },
  { id: 'orc_tusk', name: 'Colmillo de Orco', type: 'material', stack: true, price: 80, icon: '🦷', color: 0xeeeecc },
  { id: 'stone_fragment', name: 'Fragmento de Piedra', type: 'material', stack: true, price: 110, icon: '🪨', color: 0x888888 },
  // gathered in the world (shared/src/nodes.ts)
  { id: 'wood_log', name: 'Madera', type: 'material', stack: true, price: 8, icon: '🪵', color: 0x8a5a2a, desc: 'De talar árboles. Se usa para fabricar armas.' },
  { id: 'raw_stone', name: 'Piedra', type: 'material', stack: true, price: 5, icon: '🪨', color: 0x9a9a9a, desc: 'De picar rocas.' },
  { id: 'iron_ore', name: 'Mineral de Hierro', type: 'material', stack: true, price: 25, icon: '🪨', color: 0x8a7060, desc: 'De picar rocas, sobre todo en las colinas y el cuartel orco. Se usa para fabricar armas.' },
  { id: 'camp_chest', name: 'Cofre del Campamento', type: 'chest', price: 0, icon: '🧰', color: 0x8a5a2a, desc: 'Botín del campamento. Abrilo para quedarte con lo que tiene.' },
  { id: 'cursed_bone', name: 'Hueso Maldito', type: 'material', stack: true, price: 150, icon: '💀', color: 0xbbbbaa },
  { id: 'sea_pearl', name: 'Perla Marina', type: 'material', stack: true, price: 220, icon: '🫧', color: 0xd8e8f0 },
  { id: 'ruin_relic', name: 'Reliquia de las Ruinas', type: 'material', stack: true, price: 300, icon: '🏺', color: 0x8a9a8a },
  { id: 'ember_shard', name: 'Esquirla de Brasa', type: 'material', stack: true, price: 400, icon: '🔥', color: 0xe8601a },
  { id: 'citadel_sigil', name: 'Sello de la Ciudadela', type: 'material', stack: true, price: 520, icon: '🎖️', color: 0x8a2a2a },
  { id: 'drake_scale', name: 'Escama de Draco', type: 'material', stack: true, price: 660, icon: '🐉', color: 0x4a8a4a },
  { id: 'dragon_fang', name: 'Colmillo de Dragón', type: 'material', stack: true, price: 820, icon: '🦷', color: 0xf0e8d0 },
  // the frost region (50-60)
  { id: 'frost_pelt', name: 'Piel Gélida', type: 'material', stack: true, price: 1000, icon: '🐺', color: 0xc8dcec },
  { id: 'ice_crystal', name: 'Cristal de Hielo', type: 'material', stack: true, price: 1250, icon: '🧊', color: 0x8ad0f0 },
  // the swamp region (60-70)
  { id: 'swamp_venom', name: 'Veneno del Pantano', type: 'material', stack: true, price: 1500, icon: '☠️', color: 0x7ac83a, desc: 'Lo fabrican las criaturas del Pantano Ponzoñoso. Con él se forja el set Esmeralda.' },
  // the volcanic region (70-78)
  { id: 'magma_core', name: 'Núcleo de Magma', type: 'material', stack: true, price: 2200, icon: '🔥', color: 0xe8501a, desc: 'Late dentro de las criaturas de las Tierras Volcánicas. Con él se forja el set Infernal.' },
  { id: 'abyss_essence', name: 'Esencia del Abismo', type: 'material', stack: true, price: 2800, icon: '🌑', color: 0x8a40c8, desc: 'La sangran las criaturas del Abismo; su raid es la que más deja. Con ella se forja el set Infernal.' },
  { id: 'awakening_shard', name: 'Fragmento del Despertar', type: 'material', stack: true, price: 5000, icon: '💎', color: 0xb8a0ff, desc: 'Un fragmento de un poder antiguo. Veyra, en Brasaoscura, sabe qué hacer con él.' },
  { id: 'ancient_bark', name: 'Corteza Ancestral', type: 'material', stack: true, price: 1800, icon: '🪵', color: 0x8a6a3a, desc: 'De los árboles y las bestias de la Selva Antigua. Con ella se forja el set Esmeralda.' },
];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(list.map((i) => [i.id, i]));
/**
 * Enchanting: each +1 adds `weapon`/`armor` (a fraction) to the piece's stats. Safe up to +`safe`; after that every
 * attempt is `step` less likely, and a failed one destroys the piece (failDestroys) or sends it back to +0.
 */
/** As in L2: safe up to +3, then a flat chance for every step up to +16 (a failure destroys the piece). */
export const ENCHANT = { weapon: 0.08, armor: 0.05, safe: 3, chance: 0.66, max: 16, failDestroys: true };
export const enchantChance = (e: number) => (e < ENCHANT.safe ? 1 : ENCHANT.chance);
/** A stat of a piece at +e, as the tooltips show it (the server does the real math). */
export const enchanted = (d: ItemDef, k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef', e = 0) => Math.round((d[k] ?? 0) * (1 + (d.type === 'weapon' ? ENCHANT.weapon : ENCHANT.armor) * e));

/**
 * The level a character needs to wear each grade (as in L2). Pieces of the old S set (look: 'S') that existed before
 * this rule are "legacy" in the database and can be worn at any level (server-rs/src/db.rs).
 */
export const GRADE_LEVEL: Record<Grade, number> = { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 75 };
export const wearLevel = (d: ItemDef) => (d.grade ? GRADE_LEVEL[d.grade] : 0);
/** Whether a scroll enchants a piece: its kind (weapon or armour), and its grade when it has one (the Grieta de las
 * Brasas' C-grade scrolls; server-rs inventory.rs pick_scroll). */
export const scrollFits = (scroll: ItemDef, piece: ItemDef) =>
  scroll.enchant === (piece.type === 'weapon' ? 'weapon' : 'armor') && (!scroll.grade || scroll.grade === piece.grade);

/**
 * Masterwork: a piece of gear a master crafts for a dwarf comes out a Masterwork `dwarfChance` of the time; for anyone
 * else, `chance` (none: only the craftsmen make them, anyone can wear them). It gives `weapon` (a weapon) or `piece`
 * (armor, jewels) as the wearer's race says (RACES[r].mw), whatever its grade.
 */
export const MASTERWORK = { chance: 0, dwarfChance: 0.06, weapon: 0.06, piece: 0.01 };
export interface MasterworkBonus { atkSpd: number; castSpd: number; cdr: number }
/**
 * What one Masterwork piece gives a wearer (fractions: 0.06 = 6%). A speed the class does not use turns into the one it
 * does (a fighter's cast speed is attack speed, a mystic's attack speed is cast speed); a human gets half of it in
 * the class's speed and half in cooldown cut. Mirrored by masterwork_bonus in server-rs/src/formulas.rs.
 */
export function masterworkBonus(race: Race, cls: ClassType, isWeapon: boolean): MasterworkBonus {
  const v = isWeapon ? MASTERWORK.weapon : MASTERWORK.piece;
  const speed = (f: number): MasterworkBonus => (cls === 'mystic' ? { atkSpd: 0, castSpd: f, cdr: 0 } : { atkSpd: f, castSpd: 0, cdr: 0 });
  switch (RACES[race].mw) {
    case 'cdr': return { atkSpd: 0, castSpd: 0, cdr: v };
    case 'mix': return { ...speed(v / 2), cdr: v / 2 };
    default: return speed(v);
  }
}
/** The grade a piece is drawn as (render/models.ts). */
export const lookGrade = (d: ItemDef | null | undefined): Grade | undefined => (d ? d.look ?? d.grade : undefined);

export const GRADE_COLOR: Record<Grade, string> = { NG: '#c8c8c8', D: '#6fb2ff', C: '#ffd24d', B: '#b388ff', A: '#ff8a3d', S: '#ff4d6a' };
