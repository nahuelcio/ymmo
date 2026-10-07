// Status effects (crowd control and damage over time). The server applies and
// ticks them; clients learn about them through entity flag bits.

export type StatusId = 'stun' | 'slow' | 'bleed' | 'poison';

export interface StatusDef { flag: number; icon: string; name: string; desc: string }

export const STATUSES: Record<StatusId, StatusDef> = {
  stun: { flag: 128, icon: '💫', name: 'Aturdido', desc: 'No se puede mover, atacar ni lanzar.' },
  slow: { flag: 256, icon: '🐌', name: 'Ralentizado', desc: 'Se mueve un 40% más lento.' },
  bleed: { flag: 512, icon: '🩸', name: 'Sangrando', desc: 'Pierde vida cada segundo.' },
  poison: { flag: 1024, icon: '☠️', name: 'Envenenado', desc: 'Pierde vida cada segundo.' },
};

export const STATUS_IDS = Object.keys(STATUSES) as StatusId[];
export const STATUS_MASK = STATUS_IDS.reduce((m, id) => m | STATUSES[id].flag, 0);
export const SLOW_MUL = 0.6;

/** Something that applies a status: a skill or a mob's hits. */
export interface StatusApply {
  id: StatusId;
  ms: number;
  /** chance on hit (mob hits); skills always apply */
  chance?: number;
  /** damage per second as a fraction of the triggering hit (bleed/poison) */
  dot?: number;
}

export function statusIcons(flags: number): StatusDef[] {
  return STATUS_IDS.filter((id) => flags & STATUSES[id].flag).map((id) => STATUSES[id]);
}
