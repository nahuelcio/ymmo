// Status effects (crowd control and damage over time). The server applies and
// ticks them; clients learn about them through entity flag bits.

export type StatusId = 'stun' | 'slow' | 'bleed' | 'poison' | 'wound' | 'burn' | 'frostbite';

export interface StatusDef { flag: number; icon: string; name: string; desc: string }

export const STATUSES: Record<StatusId, StatusDef> = {
  stun: { flag: 128, icon: '💫', name: 'Aturdido', desc: 'No se puede mover, atacar ni lanzar.' },
  slow: { flag: 256, icon: '🐌', name: 'Ralentizado', desc: 'Se mueve un 40% más lento.' },
  bleed: { flag: 512, icon: '🩸', name: 'Sangrando', desc: 'Pierde vida cada segundo.' },
  poison: { flag: 1024, icon: '☠️', name: 'Envenenado', desc: 'Pierde vida cada segundo.' },
  // the War Avatar's blows (data/mobs.ts): bit 8192, the first free one past F_GATHER (protocol.ts)
  wound: { flag: 8192, icon: '💔', name: 'Herida de Guerra', desc: 'Las curas que recibe rinden la mitad.' },
  // Ignaroth's blows (Grieta de las Brasas): bit 16384, the last but one the u16 flags hold
  burn: { flag: 16384, icon: '🔥', name: 'Quemadura', desc: 'Pierde vida cada segundo por el fuego.' },
  // Ymirak's blows (Llanos de la Ventisca): slowed like `slow` (server-rs ent.rs speed_mul) and losing health. Bit 32768,
  // the last one the u16 flags hold: another status needs wider flags (protocol.ts EntUpd, binary.ts)
  frostbite: { flag: 32768, icon: '❄️', name: 'Congelación', desc: 'Se mueve un 40% más lento y pierde vida cada segundo por el frío.' },
};

export const STATUS_IDS = Object.keys(STATUSES) as StatusId[];
export const STATUS_MASK = STATUS_IDS.reduce((m, id) => m | STATUSES[id].flag, 0);
export const SLOW_MUL = 0.6;

/** Something that applies a status: a skill or a mob's hits. */
export interface StatusApply {
  id: StatusId;
  ms: number;
  /** chance on hit (mob hits); for a skill's stun or slow, its base chance to land (server formulas.rs land_chance) */
  chance?: number;
  /** damage per second as a fraction of the triggering hit (bleed/poison/burn/frostbite) */
  dot?: number;
}

export function statusIcons(flags: number): StatusDef[] {
  return STATUS_IDS.filter((id) => flags & STATUSES[id].flag).map((id) => STATUSES[id]);
}
