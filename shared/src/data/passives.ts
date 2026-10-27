// Passive skills: always on, learned by level as the skills are (a base class's at 10, a specialization's at 20, 40
// and 60, its evolution's at 76, which keeps its parent's). Each is a never-ending buff (server-rs formulas.rs
// passive_mods, folded in Player::recalc beside the Legend's); a `weapon` one counts only while that is equipped.
// The size of each: a few percent, a whole specialization about what one or two clan skills give.
import { SPECS, type ClassType, type Spec } from './classes';
import type { BuffMods } from './skills';

export interface PassiveDef {
  id: string;
  name: string;
  nameEn: string;
  /** the base class's (every specialization of it has it), or a specialization's */
  cls?: ClassType;
  spec?: Spec;
  level: number;
  /** it counts only with this in hand: a shield, a pair of swords, a bow or a dagger */
  weapon?: 'shield' | 'dual' | 'bow' | 'dagger';
  mods: BuffMods;
  icon: string;
  color: number;
  desc: string;
  descEn: string;
}

const list: PassiveDef[] = [
  // the base classes
  { id: 'hardened_body', name: 'Cuerpo Curtido', nameEn: 'Hardened Body', cls: 'fighter', level: 10, mods: { maxHp: 1.05, hpRegen: 1.1 }, icon: '🫀', color: 0xc8a070,
    desc: 'Años de combate te endurecieron.', descEn: 'Years of fighting have toughened you.' },
  { id: 'serene_mind', name: 'Mente Serena', nameEn: 'Serene Mind', cls: 'mystic', level: 10, mods: { maxMp: 1.05, mpRegen: 1.1 }, icon: '🧘', color: 0x8ab0ff,
    desc: 'Tu mente en calma guarda y recupera más maná.', descEn: 'A calm mind holds and recovers more mana.' },
  // Knight and Phoenix Paladin
  { id: 'shield_mastery', name: 'Maestría con Escudo', nameEn: 'Shield Mastery', spec: 'knight', level: 20, weapon: 'shield', mods: { pDef: 1.06, mDef: 1.04 }, icon: '🛡️', color: 0x9aa8c0,
    desc: 'Sabés poner el escudo donde va el golpe.', descEn: 'You know where to put the shield before the blow lands.' },
  { id: 'iron_skin', name: 'Piel de Hierro', nameEn: 'Iron Skin', spec: 'knight', level: 40, mods: { maxHp: 1.06 }, icon: '🪨', color: 0x8a96a8,
    desc: 'Aguantás más que nadie.', descEn: 'You take more than anyone.' },
  { id: 'retribution', name: 'Represalia', nameEn: 'Retribution', spec: 'knight', level: 60, mods: { reflect: 0.04 }, icon: '↩️', color: 0xc0d0e8,
    desc: 'Cada golpe que recibís le cuesta algo al que lo da.', descEn: 'Every blow you take costs the one who deals it.' },
  { id: 'phoenix_flame', name: 'Llama del Fénix', nameEn: 'Phoenix Flame', spec: 'phoenix_knight', level: 76, mods: { hpRegen: 1.3, mDef: 1.05 }, icon: '🔥', color: 0xff8a3a,
    desc: 'El fuego del fénix cierra tus heridas.', descEn: "The phoenix's fire closes your wounds." },
  // Gladiator and Duelist
  { id: 'dual_mastery', name: 'Maestría con Dos Espadas', nameEn: 'Dual Sword Mastery', spec: 'gladiator', level: 20, weapon: 'dual', mods: { pAtk: 1.05 }, icon: '⚔️', color: 0xd0d8e8,
    desc: 'Las dos espadas son una sola en tus manos.', descEn: 'Two swords move as one in your hands.' },
  { id: 'bloodlust', name: 'Sed de Sangre', nameEn: 'Bloodlust', spec: 'gladiator', level: 40, mods: { vampire: 0.03 }, icon: '🩸', color: 0xb02020,
    desc: 'El daño que hacés te cura un poco.', descEn: 'The damage you deal heals you a little.' },
  { id: 'sonic_edge', name: 'Filo Sónico', nameEn: 'Sonic Edge', spec: 'gladiator', level: 60, mods: { critDmg: 1.1 }, icon: '〰️', color: 0x9ad0ff,
    desc: 'Tus golpes críticos cortan más hondo.', descEn: 'Your critical hits cut deeper.' },
  { id: 'steel_waltz', name: 'Vals de Acero', nameEn: 'Steel Waltz', spec: 'duelist', level: 76, weapon: 'dual', mods: { atkSpd: 1.05, crit: 2 }, icon: '🌀', color: 0xe0e8ff,
    desc: 'Tus dos espadas bailan más rápido y buscan el punto débil.', descEn: 'Your two swords dance faster and seek the weak spot.' },
  // Archer and Sharpshooter
  { id: 'bow_mastery', name: 'Maestría con Arco', nameEn: 'Bow Mastery', spec: 'archer', level: 20, weapon: 'bow', mods: { pAtk: 1.05 }, icon: '🏹', color: 0xa8c060,
    desc: 'Tensás el arco más fuerte que nadie.', descEn: 'You draw the bow harder than anyone.' },
  { id: 'hawk_eye', name: 'Ojo de Halcón', nameEn: 'Hawk Eye', spec: 'archer', level: 40, mods: { accuracy: 3, crit: 2 }, icon: '🦅', color: 0xc8a050,
    desc: 'Ves el blanco y su punto débil.', descEn: 'You see the target and its weak spot.' },
  { id: 'light_feet', name: 'Pies Ligeros', nameEn: 'Light Feet', spec: 'archer', level: 60, mods: { speed: 1.04, evasion: 2 }, icon: '🪶', color: 0xd8f0c0,
    desc: 'Te movés rápido y cuesta alcanzarte.', descEn: 'You move fast and are hard to catch.' },
  { id: 'lethal_shot', name: 'Tiro Letal', nameEn: 'Lethal Shot', spec: 'sharpshooter', level: 76, weapon: 'bow', mods: { critDmg: 1.12 }, icon: '🎯', color: 0xff6a4a,
    desc: 'Tus flechas críticas no perdonan.', descEn: 'Your critical arrows show no mercy.' },
  // Assassin and Shade
  { id: 'dagger_mastery', name: 'Maestría con Daga', nameEn: 'Dagger Mastery', spec: 'assassin', level: 20, weapon: 'dagger', mods: { critDmg: 1.1 }, icon: '🗡️', color: 0x9a8ab0,
    desc: 'Tu daga sabe dónde duele.', descEn: 'Your dagger knows where it hurts.' },
  { id: 'reflexes', name: 'Reflejos', nameEn: 'Reflexes', spec: 'assassin', level: 40, mods: { evasion: 3 }, icon: '💨', color: 0xb0b8c8,
    desc: 'Esquivás antes de que el golpe llegue.', descEn: 'You dodge before the blow arrives.' },
  { id: 'precise_strike', name: 'Golpe Preciso', nameEn: 'Precise Strike', spec: 'assassin', level: 60, mods: { accuracy: 3, atkSpd: 1.04 }, icon: '✴️', color: 0xd0c0ff,
    desc: 'Golpes rápidos que no fallan.', descEn: 'Quick blows that do not miss.' },
  { id: 'shadow_step', name: 'Paso Sombrío', nameEn: 'Shadow Step', spec: 'shade', level: 76, mods: { speed: 1.05, evasion: 2 }, icon: '🌑', color: 0x4a3a6a,
    desc: 'Te movés entre las sombras.', descEn: 'You move among the shadows.' },
  // Swordsinger and Sword Muse
  { id: 'clear_voice', name: 'Voz Clara', nameEn: 'Clear Voice', spec: 'swordsinger', level: 20, mods: { tune: 1.25 }, icon: '🎶', color: 0xffd88a,
    desc: 'Tus canciones duran un 25% más.', descEn: 'Your songs last 25% longer.' },
  { id: 'singer_guard', name: 'Guardia del Cantor', nameEn: "Singer's Guard", spec: 'swordsinger', level: 40, weapon: 'shield', mods: { pDef: 1.05, maxHp: 1.03 }, icon: '🛡️', color: 0xc8b070,
    desc: 'Cantás detrás de tu escudo.', descEn: 'You sing behind your shield.' },
  { id: 'deep_breath', name: 'Aliento Profundo', nameEn: 'Deep Breath', spec: 'swordsinger', level: 60, mods: { mpRegen: 1.2, cdr: 0.03 }, icon: '🌬️', color: 0xa8e0ff,
    desc: 'Recuperás el aliento y el maná antes.', descEn: 'You get your breath and your mana back sooner.' },
  { id: 'resonance', name: 'Resonancia', nameEn: 'Resonance', spec: 'sword_muse', level: 76, mods: { tune: 1.2, mDef: 1.04 }, icon: '🎼', color: 0xffe8a0,
    desc: 'Tus canciones resuenan todavía más: un 50% más que al principio.', descEn: 'Your songs ring on longer still: 50% longer than at first.' },
  // Bladedancer and Spectral Dancer
  { id: 'sure_step', name: 'Paso Firme', nameEn: 'Sure Step', spec: 'bladedancer', level: 20, mods: { tune: 1.25 }, icon: '💃', color: 0xff9ad0,
    desc: 'Tus danzas duran un 25% más.', descEn: 'Your dances last 25% longer.' },
  { id: 'fierce_rhythm', name: 'Ritmo Feroz', nameEn: 'Fierce Rhythm', spec: 'bladedancer', level: 40, weapon: 'dual', mods: { atkSpd: 1.04, pAtk: 1.03 }, icon: '🥁', color: 0xe86a6a,
    desc: 'Tus dos espadas siguen el ritmo de la danza.', descEn: 'Your two swords keep the beat of the dance.' },
  { id: 'dancer_grace', name: 'Gracia del Danzante', nameEn: "Dancer's Grace", spec: 'bladedancer', level: 60, mods: { evasion: 3, speed: 1.03 }, icon: '🦢', color: 0xf0d0ff,
    desc: 'Te movés como en una danza.', descEn: 'You move as if dancing.' },
  { id: 'endless_dance', name: 'Danza Eterna', nameEn: 'Endless Dance', spec: 'spectral_dancer', level: 76, mods: { tune: 1.2, critDmg: 1.06 }, icon: '👻', color: 0xb0a0ff,
    desc: 'Tus danzas siguen todavía más: un 50% más que al principio.', descEn: 'Your dances go on longer still: 50% longer than at first.' },
  // Sorcerer and Archmage
  { id: 'arcane_affinity', name: 'Afinidad Arcana', nameEn: 'Arcane Affinity', spec: 'sorcerer', level: 20, mods: { mAtk: 1.05 }, icon: '🔮', color: 0x9a6aff,
    desc: 'La magia te responde con más fuerza.', descEn: 'Magic answers you with more force.' },
  { id: 'focus_mind', name: 'Concentración', nameEn: 'Concentration', spec: 'sorcerer', level: 40, mods: { castSpd: 1.05 }, icon: '🎐', color: 0x7ab0ff,
    desc: 'Lanzás tus hechizos más rápido.', descEn: 'You cast your spells faster.' },
  { id: 'mana_well', name: 'Pozo de Maná', nameEn: 'Mana Well', spec: 'sorcerer', level: 60, mods: { maxMp: 1.08, mpRegen: 1.15 }, icon: '🫧', color: 0x5a8aff,
    desc: 'Guardás y recuperás más maná.', descEn: 'You hold and recover more mana.' },
  { id: 'arcane_dominion', name: 'Dominio Arcano', nameEn: 'Arcane Dominion', spec: 'archmage', level: 76, mods: { mAtk: 1.04, cdr: 0.04 }, icon: '🌌', color: 0xc080ff,
    desc: 'Dominás todas las escuelas de magia.', descEn: 'You master every school of magic.' },
  // Cleric and Hierophant
  { id: 'healing_hands', name: 'Manos Sanadoras', nameEn: 'Healing Hands', spec: 'cleric', level: 20, mods: { heal: 1.08 }, icon: '🤲', color: 0xffee88,
    desc: 'Tus curaciones y recargas de maná rinden un 8% más.', descEn: 'Your heals and mana recharges give 8% more.' },
  { id: 'serene_faith', name: 'Fe Serena', nameEn: 'Serene Faith', spec: 'cleric', level: 40, mods: { mpRegen: 1.25 }, icon: '🕯️', color: 0xfff0c0,
    desc: 'Tu fe te devuelve el maná más rápido.', descEn: 'Your faith gives your mana back faster.' },
  { id: 'holy_aura', name: 'Aura Sagrada', nameEn: 'Holy Aura', spec: 'cleric', level: 60, mods: { mDef: 1.06, maxHp: 1.04 }, icon: '😇', color: 0xffffd0,
    desc: 'Una luz te protege.', descEn: 'A light protects you.' },
  { id: 'lasting_grace', name: 'Gracia Perdurable', nameEn: 'Lasting Grace', spec: 'hierophant', level: 76, mods: { heal: 1.08, cdr: 0.04 }, icon: '✨', color: 0xfff8d0,
    desc: 'Tus curaciones y recargas rinden otro 8% más, y tus habilidades se recargan antes.', descEn: 'Your heals and recharges give another 8%, and your skills come back sooner.' },
];

export const PASSIVES: Record<string, PassiveDef> = Object.fromEntries(list.map((p) => [p.id, p]));

/** Every passive of this class (and specialization, once picked; an evolution keeps its parent's), by level: the
 * learned ones and those to come. */
export function passivesFor(cls: ClassType, spec?: Spec | null): PassiveDef[] {
  const specs = spec ? [spec, SPECS[spec]?.parent] : [];
  return list.filter((p) => (p.cls ? p.cls === cls : !!p.spec && specs.includes(p.spec))).sort((a, b) => a.level - b.level);
}
