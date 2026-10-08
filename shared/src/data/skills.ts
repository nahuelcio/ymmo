import type { ClassType, Gender, Race, Spec } from './classes';
import type { StatusApply } from '../status';

export interface BuffMods { pAtk?: number; pDef?: number; mAtk?: number; mDef?: number; speed?: number; atkSpd?: number }

export interface SkillDef {
  id: string;
  name: string;
  /** class-restricted skill; racial / gender skills have no class */
  cls?: ClassType;
  /** only for characters who picked this specialization */
  spec?: Spec;
  race?: Race;
  gender?: Gender;
  level: number;
  kind: 'phys' | 'magic' | 'heal' | 'buff' | 'drain' | 'taunt';
  target: 'enemy' | 'self' | 'friend';
  /** damage multiplier for phys/magic/drain, flat heal amount for heal */
  power: number;
  mp: number;
  cooldown: number; // ms
  cast: number; // ms
  range: number;
  aoe?: number;
  aoeOnSelf?: boolean;
  buff?: { dur: number; mods: BuffMods };
  /** status effect applied to each target hit */
  status?: StatusApply;
  icon: string;
  color: number;
  desc: string;
}

const list: SkillDef[] = [
  // Fighter
  { id: 'power_strike', name: 'Golpe Potente', cls: 'fighter', level: 1, kind: 'phys', target: 'enemy', power: 1.8, mp: 8, cooldown: 5000, cast: 300, range: 2.6, icon: '💥', color: 0xffaa33, desc: 'Un golpe con todo. 180% de daño.' },
  { id: 'provoke', name: 'Provocar', cls: 'fighter', level: 4, kind: 'taunt', target: 'enemy', power: 0, mp: 10, cooldown: 15000, cast: 200, range: 12, aoe: 8, icon: '📣', color: 0xff8844, desc: 'Le gritás a todo lo que está cerca del objetivo: te pasan a pegar a vos durante 4 s y te tienen mucha más bronca.' },
  { id: 'mortal_blow', name: 'Golpe Mortal', cls: 'fighter', level: 5, kind: 'phys', target: 'enemy', power: 2.6, mp: 12, cooldown: 8000, cast: 400, range: 2.6, status: { id: 'bleed', ms: 6000, dot: 0.15 }, icon: '🩸', color: 0xff3344, desc: 'Un tajo despiadado. 260% de daño y sangrado durante 6 s.' },
  { id: 'rage', name: 'Furia', cls: 'fighter', level: 8, kind: 'buff', target: 'self', power: 0, mp: 15, cooldown: 120000, cast: 500, range: 0, buff: { dur: 60000, mods: { pAtk: 1.2, atkSpd: 1.15 } }, icon: '😡', color: 0xff5522, desc: 'Atq.F +20% y Vel.Atq +15% durante 60 s.' },
  { id: 'whirlwind', name: 'Torbellino', cls: 'fighter', level: 11, kind: 'phys', target: 'enemy', power: 1.5, mp: 20, cooldown: 12000, cast: 500, range: 2.6, aoe: 5, aoeOnSelf: true, status: { id: 'slow', ms: 2500 }, icon: '🌀', color: 0xdddddd, desc: 'Golpea a todos los enemigos a tu alrededor. 150% de daño y los ralentiza.' },
  { id: 'iron_will', name: 'Voluntad de Hierro', cls: 'fighter', level: 14, kind: 'buff', target: 'self', power: 0, mp: 18, cooldown: 90000, cast: 500, range: 0, buff: { dur: 60000, mods: { pDef: 1.35, mDef: 1.2 } }, icon: '🛡️', color: 0x88aaff, desc: 'Def.F +35% y Def.M +20% durante 60 s.' },
  { id: 'power_smash', name: 'Aplastamiento', cls: 'fighter', level: 17, kind: 'phys', target: 'enemy', power: 3.4, mp: 25, cooldown: 10000, cast: 600, range: 2.6, status: { id: 'stun', ms: 1500 }, icon: '🔥', color: 0xff7700, desc: 'Golpe demoledor. 340% de daño y aturde 1,5 s.' },
  // Mystic
  { id: 'wind_strike', name: 'Golpe de Viento', cls: 'mystic', level: 1, kind: 'magic', target: 'enemy', power: 1.6, mp: 9, cooldown: 2500, cast: 1000, range: 20, icon: '🌪️', color: 0x9ae8ff, desc: 'Ataca con una cuchilla de viento.' },
  { id: 'heal', name: 'Curar', cls: 'mystic', level: 1, kind: 'heal', target: 'friend', power: 70, mp: 12, cooldown: 4000, cast: 1200, range: 20, icon: '💚', color: 0x55ff77, desc: 'Te cura a vos o a un aliado.' },
  { id: 'ice_bolt', name: 'Saeta de Hielo', cls: 'mystic', level: 5, kind: 'magic', target: 'enemy', power: 2.1, mp: 14, cooldown: 3000, cast: 1300, range: 20, status: { id: 'slow', ms: 3000 }, icon: '❄️', color: 0x66aaff, desc: 'Lanza una esquirla de hielo que ralentiza 3 s.' },
  { id: 'vampiric_touch', name: 'Toque Vampírico', cls: 'mystic', level: 8, kind: 'drain', target: 'enemy', power: 1.5, mp: 16, cooldown: 6000, cast: 1200, range: 12, icon: '🦇', color: 0xaa2266, desc: 'Le roba vida al objetivo. Te curás el 50% del daño.' },
  { id: 'blessing', name: 'Bendición', cls: 'mystic', level: 11, kind: 'buff', target: 'friend', power: 0, mp: 20, cooldown: 10000, cast: 1500, range: 20, buff: { dur: 180000, mods: { pAtk: 1.12, pDef: 1.15, mAtk: 1.12 } }, icon: '✨', color: 0xffee88, desc: 'Atq.F +12%, Def.F +15% y Atq.M +12% durante 3 min.' },
  { id: 'aura_flare', name: 'Estallido de Aura', cls: 'mystic', level: 14, kind: 'magic', target: 'enemy', power: 1.8, mp: 30, cooldown: 8000, cast: 1500, range: 20, aoe: 6, icon: '☄️', color: 0xff66ff, desc: 'Explota sobre el objetivo y alcanza a los enemigos cercanos.' },
  { id: 'greater_heal', name: 'Curación Mayor', cls: 'mystic', level: 17, kind: 'heal', target: 'friend', power: 240, mp: 35, cooldown: 6000, cast: 2000, range: 20, icon: '💖', color: 0x88ffaa, desc: 'Recupera mucha vida.' },
  // Knight
  { id: 'shield_bash', name: 'Golpe de Escudo', spec: 'knight', level: 20, kind: 'phys', target: 'enemy', power: 2.2, mp: 22, cooldown: 9000, cast: 300, range: 2.6, status: { id: 'stun', ms: 2500 }, icon: '🛡️', color: 0xb0c4de, desc: '220% de daño y aturde 2,5 s.' },
  { id: 'challenge', name: 'Desafío', spec: 'knight', level: 25, kind: 'taunt', target: 'enemy', power: 0, mp: 20, cooldown: 12000, cast: 200, range: 14, aoe: 12, icon: '📯', color: 0xffaa55, desc: 'Provocación de área grande: todo lo que rodea al objetivo va por vos.' },
  { id: 'fortress', name: 'Fortaleza', spec: 'knight', level: 30, kind: 'buff', target: 'self', power: 0, mp: 30, cooldown: 90000, cast: 400, range: 0, buff: { dur: 30000, mods: { pDef: 1.5, mDef: 1.3 } }, icon: '🏰', color: 0x8899bb, desc: 'Def.F +50% y Def.M +30% durante 30 s.' },
  { id: 'holy_strike', name: 'Golpe Sagrado', spec: 'knight', level: 35, kind: 'phys', target: 'enemy', power: 3.2, mp: 30, cooldown: 8000, cast: 400, range: 2.6, status: { id: 'slow', ms: 4000 }, icon: '✝️', color: 0xfff0a0, desc: '320% de daño y ralentiza 4 s.' },
  { id: 'guardian_aura', name: 'Aura del Guardián', spec: 'knight', level: 40, kind: 'buff', target: 'friend', power: 0, mp: 35, cooldown: 10000, cast: 800, range: 20, buff: { dur: 120000, mods: { pDef: 1.25, mDef: 1.25 } }, icon: '🔰', color: 0x66ccff, desc: 'Def.F y Def.M +25% a vos o a un aliado durante 2 min.' },
  { id: 'earthquake', name: 'Terremoto', spec: 'knight', level: 45, kind: 'phys', target: 'enemy', power: 2.4, mp: 45, cooldown: 20000, cast: 600, range: 2.6, aoe: 7, aoeOnSelf: true, status: { id: 'stun', ms: 1500 }, icon: '🌋', color: 0xaa7744, desc: '240% de daño a todo lo que te rodea y lo aturde 1,5 s.' },
  { id: 'last_stand', name: 'Última Resistencia', spec: 'knight', level: 50, kind: 'heal', target: 'self', power: 600, mp: 40, cooldown: 180000, cast: 200, range: 0, icon: '❤️‍🔥', color: 0xff5566, desc: 'Recuperás 600 de HP al instante.' },
  // Gladiator
  { id: 'double_slash', name: 'Doble Tajo', spec: 'gladiator', level: 20, kind: 'phys', target: 'enemy', power: 3, mp: 20, cooldown: 6000, cast: 300, range: 2.6, icon: '⚔️', color: 0xffcc66, desc: 'Dos cortes seguidos. 300% de daño.' },
  { id: 'hamstring', name: 'Desjarretar', spec: 'gladiator', level: 25, kind: 'phys', target: 'enemy', power: 2, mp: 18, cooldown: 10000, cast: 300, range: 2.6, status: { id: 'slow', ms: 5000 }, icon: '🦵', color: 0xcc8866, desc: '200% de daño y ralentiza 5 s.' },
  { id: 'bloodlust', name: 'Sed de Sangre', spec: 'gladiator', level: 30, kind: 'buff', target: 'self', power: 0, mp: 30, cooldown: 120000, cast: 400, range: 0, buff: { dur: 45000, mods: { pAtk: 1.3, atkSpd: 1.25 } }, icon: '🩸', color: 0xcc1122, desc: 'Atq.F +30% y Vel.Atq +25% durante 45 s.' },
  { id: 'rend', name: 'Desgarrar', spec: 'gladiator', level: 35, kind: 'phys', target: 'enemy', power: 3, mp: 28, cooldown: 12000, cast: 400, range: 2.6, status: { id: 'bleed', ms: 8000, dot: 0.3 }, icon: '🪓', color: 0xff3344, desc: '300% de daño y un sangrado fuerte durante 8 s.' },
  { id: 'blade_storm', name: 'Tormenta de Acero', spec: 'gladiator', level: 40, kind: 'phys', target: 'enemy', power: 2.6, mp: 40, cooldown: 14000, cast: 500, range: 2.6, aoe: 6, aoeOnSelf: true, icon: '🌪️', color: 0xdddddd, desc: '260% de daño a todos los enemigos a tu alrededor.' },
  { id: 'war_cry', name: 'Grito de Guerra', spec: 'gladiator', level: 45, kind: 'buff', target: 'self', power: 0, mp: 30, cooldown: 90000, cast: 300, range: 0, buff: { dur: 30000, mods: { pAtk: 1.15, speed: 1.2 } }, icon: '🗯️', color: 0xff8833, desc: 'Atq.F +15% y Velocidad +20% durante 30 s.' },
  { id: 'execute', name: 'Ejecución', spec: 'gladiator', level: 50, kind: 'phys', target: 'enemy', power: 5.5, mp: 50, cooldown: 20000, cast: 700, range: 2.6, icon: '💀', color: 0x990000, desc: 'Un golpe para terminar la pelea. 550% de daño.' },
  // Sorcerer
  { id: 'fireball', name: 'Bola de Fuego', spec: 'sorcerer', level: 20, kind: 'magic', target: 'enemy', power: 2.8, mp: 28, cooldown: 4000, cast: 1500, range: 20, icon: '🔥', color: 0xff6622, desc: 'Una bola de fuego. 280% de daño.' },
  { id: 'frost_nova', name: 'Nova de Hielo', spec: 'sorcerer', level: 25, kind: 'magic', target: 'enemy', power: 1.8, mp: 32, cooldown: 12000, cast: 600, range: 2.6, aoe: 7, aoeOnSelf: true, status: { id: 'slow', ms: 4000 }, icon: '🧊', color: 0x99ddff, desc: 'Congela a todo lo que te rodea: 180% de daño y ralentiza 4 s.' },
  { id: 'arcane_power', name: 'Poder Arcano', spec: 'sorcerer', level: 30, kind: 'buff', target: 'self', power: 0, mp: 35, cooldown: 120000, cast: 500, range: 0, buff: { dur: 60000, mods: { mAtk: 1.3 } }, icon: '🔮', color: 0xaa66ff, desc: 'Atq.M +30% durante 60 s.' },
  { id: 'lightning', name: 'Rayo', spec: 'sorcerer', level: 35, kind: 'magic', target: 'enemy', power: 3.2, mp: 40, cooldown: 10000, cast: 1200, range: 20, status: { id: 'stun', ms: 1500 }, icon: '⚡', color: 0xffff66, desc: '320% de daño y aturde 1,5 s.' },
  { id: 'meteor', name: 'Meteoro', spec: 'sorcerer', level: 40, kind: 'magic', target: 'enemy', power: 3, mp: 60, cooldown: 15000, cast: 2500, range: 20, aoe: 8, icon: '☄️', color: 0xff4400, desc: 'Cae sobre el objetivo y todo lo que tiene cerca. 300% de daño.' },
  { id: 'soul_drain', name: 'Drenar Alma', spec: 'sorcerer', level: 45, kind: 'drain', target: 'enemy', power: 2.6, mp: 45, cooldown: 10000, cast: 1500, range: 14, icon: '👻', color: 0x8844aa, desc: '260% de daño y te curás la mitad.' },
  { id: 'inferno', name: 'Infierno', spec: 'sorcerer', level: 50, kind: 'magic', target: 'enemy', power: 4.2, mp: 90, cooldown: 30000, cast: 3000, range: 20, aoe: 9, status: { id: 'bleed', ms: 6000, dot: 0.2 }, icon: '🌋', color: 0xff2200, desc: '420% de daño en un área enorme, y sigue quemando 6 s.' },
  // Cleric
  { id: 'divine_heal', name: 'Curación Divina', spec: 'cleric', level: 20, kind: 'heal', target: 'friend', power: 400, mp: 45, cooldown: 5000, cast: 1800, range: 20, icon: '💛', color: 0xffee66, desc: 'Recupera 400 de HP.' },
  { id: 'holy_shield', name: 'Escudo Sagrado', spec: 'cleric', level: 25, kind: 'buff', target: 'friend', power: 0, mp: 30, cooldown: 8000, cast: 1200, range: 20, buff: { dur: 180000, mods: { pDef: 1.3, mDef: 1.3 } }, icon: '🛡️', color: 0xffffaa, desc: 'Def.F y Def.M +30% durante 3 min.' },
  { id: 'smite', name: 'Castigo', spec: 'cleric', level: 30, kind: 'magic', target: 'enemy', power: 2.6, mp: 30, cooldown: 5000, cast: 1200, range: 20, status: { id: 'stun', ms: 1000 }, icon: '🌟', color: 0xfff088, desc: '260% de daño y aturde 1 s.' },
  { id: 'might', name: 'Poderío', spec: 'cleric', level: 35, kind: 'buff', target: 'friend', power: 0, mp: 35, cooldown: 8000, cast: 1200, range: 20, buff: { dur: 180000, mods: { pAtk: 1.2, mAtk: 1.2, atkSpd: 1.1 } }, icon: '💪', color: 0xffbb44, desc: 'Atq.F y Atq.M +20%, Vel.Atq +10% durante 3 min.' },
  { id: 'restoration', name: 'Restauración', spec: 'cleric', level: 40, kind: 'heal', target: 'friend', power: 700, mp: 70, cooldown: 7000, cast: 2000, range: 20, icon: '💗', color: 0xff99cc, desc: 'Recupera 700 de HP.' },
  { id: 'haste', name: 'Celeridad', spec: 'cleric', level: 45, kind: 'buff', target: 'friend', power: 0, mp: 40, cooldown: 8000, cast: 1200, range: 20, buff: { dur: 120000, mods: { speed: 1.2, atkSpd: 1.2 } }, icon: '🪽', color: 0xaaffee, desc: 'Velocidad y Vel.Atq +20% durante 2 min.' },
  { id: 'miracle', name: 'Milagro', spec: 'cleric', level: 50, kind: 'heal', target: 'friend', power: 1500, mp: 120, cooldown: 60000, cast: 2500, range: 20, icon: '🌈', color: 0xffffff, desc: 'Recupera 1500 de HP.' },
  // Racial (any class)
  { id: 'second_wind', name: 'Segundo Aire', race: 'human', level: 3, kind: 'heal', target: 'self', power: 90, mp: 10, cooldown: 60000, cast: 300, range: 0, icon: '🌬️', color: 0xffffcc, desc: 'Humano. Recuperás el aliento: +90 de HP.' },
  { id: 'wind_walk', name: 'Paso del Viento', race: 'elf', level: 3, kind: 'buff', target: 'self', power: 0, mp: 12, cooldown: 60000, cast: 300, range: 0, buff: { dur: 20000, mods: { speed: 1.25 } }, icon: '🍃', color: 0x99ffaa, desc: 'Elfo. Velocidad +25% durante 20 s.' },
  { id: 'shadow_bite', name: 'Mordida Sombría', race: 'darkelf', level: 3, kind: 'drain', target: 'enemy', power: 1.3, mp: 12, cooldown: 20000, cast: 400, range: 10, status: { id: 'poison', ms: 6000, dot: 0.2 }, icon: '🌑', color: 0x7a3aaa, desc: 'Elfo Oscuro. Le roba vida al objetivo (130%) y lo envenena 6 s.' },
  { id: 'battle_roar', name: 'Rugido de Guerra', race: 'orc', level: 3, kind: 'buff', target: 'self', power: 0, mp: 12, cooldown: 60000, cast: 300, range: 0, buff: { dur: 20000, mods: { pAtk: 1.15, mAtk: 1.15 } }, icon: '🐗', color: 0xcc4422, desc: 'Orco. Atq.F y Atq.M +15% durante 20 s.' },
  { id: 'stone_skin', name: 'Piel de Piedra', race: 'dwarf', level: 3, kind: 'buff', target: 'self', power: 0, mp: 12, cooldown: 60000, cast: 300, range: 0, buff: { dur: 20000, mods: { pDef: 1.3, mDef: 1.15 } }, icon: '🪨', color: 0xaa8866, desc: 'Enano. Def.F +30% y Def.M +15% durante 20 s.' },
  // Gender (any class)
  { id: 'endure', name: 'Aguante', gender: 'm', level: 6, kind: 'buff', target: 'self', power: 0, mp: 10, cooldown: 90000, cast: 200, range: 0, buff: { dur: 15000, mods: { pDef: 1.2 } }, icon: '💪', color: 0xd0a060, desc: 'Masculino. Def.F +20% durante 15 s.' },
  { id: 'grace', name: 'Gracia', gender: 'f', level: 6, kind: 'buff', target: 'self', power: 0, mp: 10, cooldown: 90000, cast: 200, range: 0, buff: { dur: 15000, mods: { atkSpd: 1.12, speed: 1.08 } }, icon: '🦋', color: 0xff99dd, desc: 'Femenino. Vel.Atq +12% y Velocidad +8% durante 15 s.' },
];

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(list.map((s) => [s.id, s]));

/** Every skill a character of this class/race/gender (and specialization, once picked) gets, by level. */
export function allSkillsFor(cls: ClassType, race: Race, gender: Gender, spec?: Spec | null): SkillDef[] {
  return list.filter((s) => (!s.cls || s.cls === cls) && (!s.spec || s.spec === spec) && (!s.race || s.race === race) && (!s.gender || s.gender === gender))
    .sort((a, b) => a.level - b.level);
}
