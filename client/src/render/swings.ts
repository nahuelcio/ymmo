// A player's basic attack, weapon by weapon: the blows it chains while the swings keep coming, each from the CC0
// libraries (UAL1 and UAL2 on this rig, KayKit's retargeted by tools/scripts/q-assets.mjs). quaternius.ts animateQ plays
// them; game.ts times the hit to the blow (its impact) and the swish just before it.
//
// Clip times are seconds into each clip, measured where its weapon hand moves fastest (the impact) and where its
// follow-through settles (done): a swing plays at least up to done before the next may cut in.

export type SwingKind = 'sword' | 'axe' | 'spear' | 'staff' | 'dagger' | 'dual' | 'fists';
export interface Swing {
  clip: string;
  /** where the blow lands, and where its follow-through settles (clip seconds) */
  impact: number;
  done: number;
  /** the way back to the plain stance when no blow follows (UAL2's cuts end crouched, ready for the next) */
  rec?: string;
}
export interface SwingSet {
  swings: Swing[];
  /** held between blows and for a while after the last (the two-handed guard), instead of the plain idle */
  stance?: string;
}

export const SWINGS: Record<SwingKind, SwingSet> = {
  // UAL2's chain: a lunging cut, a backhand, and a wide finisher that stands back up
  sword: {
    swings: [
      { clip: 'Sword_Regular_A', impact: 0.24, done: 0.43, rec: 'Sword_Regular_A_Rec' },
      { clip: 'Sword_Regular_B', impact: 0.27, done: 0.53, rec: 'Sword_Regular_B_Rec' },
      { clip: 'Sword_Regular_C', impact: 0.64, done: 0.8 },
    ],
  },
  // heavy blows: a wide diagonal swing, then a chop from overhead
  axe: { swings: [{ clip: 'Sword_Attack', impact: 0.38, done: 0.6 }, { clip: 'KK_1H_Chop', impact: 0.65, done: 0.82 }] },
  // two hands on the haft: a cut, then the thrust (the cut first: it is the one a skill's cast holds, and the thrust's
  // wind-up turns the head of this spear down)
  spear: { swings: [{ clip: 'KK_2H_Slice', impact: 0.38, done: 0.6 }, { clip: 'KK_2H_Stab', impact: 0.4, done: 0.58 }], stance: 'KK_2H_Idle' },
  staff: { swings: [{ clip: 'KK_2H_Slice', impact: 0.38, done: 0.6 }, { clip: 'KK_2H_Chop', impact: 0.67, done: 0.9 }], stance: 'KK_2H_Idle' },
  // a thrust from the guard (the cross, the blade turned along the forearm: quaternius.ts stabGrip), then a lunging cut
  // (a dagger skill's swing is always the thrust: STAB below)
  dagger: { swings: [{ clip: 'Punch_Cross', impact: 0.17, done: 0.35 }, { clip: 'Sword_Regular_A', impact: 0.24, done: 0.43, rec: 'Sword_Regular_A_Rec' }] },
  // both blades: crossed and cut outwards, then both down
  dual: { swings: [{ clip: 'KK_Dual_Slice', impact: 0.55, done: 0.75 }, { clip: 'KK_Dual_Chop', impact: 0.54, done: 0.75 }] },
  // the jab and the cross, from the same guard
  fists: { swings: [{ clip: 'Punch_Jab', impact: 0.14, done: 0.3 }, { clip: 'Punch_Cross', impact: 0.17, done: 0.35 }] },
};
/** The dagger's thrust, for the swings a skill makes a stab (atkStab). */
export const STAB = SWINGS.dagger.swings[0];

/** A swing follows on from the last one (the next blow of the chain) if it starts this soon after it; else it starts over. */
export const CHAIN_MS = 1600;
/** How long the end of a blow is held, ready for the next, before the way back (rec) or the guard. */
export const HOLD_MS = 350;
/** How long after the last blow the fight's guard (stance) stays. */
export const COMBAT_MS = 3000;
/** The swing interval assumed until two swings in a row tell the real one. */
export const DEFAULT_INTERVAL = 900;

/** Which set a weapon swings (a shield in the other hand rules out the two-handed ones; a wand, too short for two
 * hands, swings as a one-handed weapon). */
export function swingKind(weaponType: string | undefined, armed: boolean, shield = false): SwingKind {
  if (!armed) return 'fists';
  switch (weaponType) {
    case 'dagger': return 'dagger';
    case 'dual': return 'dual';
    case 'axe': case 'blunt': case 'pickaxe': case 'wand': return 'axe';
    case 'spear': return shield ? 'axe' : 'spear';
    case 'staff': return shield ? 'axe' : 'staff';
    default: return 'sword';
  }
}

/** The blow of swing number `step` (they count up while chained), or the stab a skill asked for. */
export function swingOf(kind: SwingKind, step: number, stab?: boolean): Swing {
  if (stab && kind === 'dagger') return STAB;
  const s = SWINGS[kind].swings;
  return s[((step % s.length) + s.length) % s.length];
}

/**
 * How a swing plays with this long between swings: at its own pace when it fits (at least up to its settled
 * follow-through within 85% of the interval), faster when the swings come quicker, never more than twice as fast.
 * impactMs and doneMs: when the blow lands and settles, ms into the swing.
 */
export function swingTiming(s: Swing, intervalMs = DEFAULT_INTERVAL): { speed: number; impactMs: number; doneMs: number } {
  const speed = Math.min(2, Math.max(1, s.done / ((intervalMs * 0.85) / 1000)));
  return { speed, impactMs: (s.impact / speed) * 1000, doneMs: (s.done / speed) * 1000 };
}

/** Where a skill's blow is held while it is cast (clip seconds): most of the way through its wind-up. */
export function windup(s: Swing): number {
  return s.impact * 0.7;
}
