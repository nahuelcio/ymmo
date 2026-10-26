// The Olympiad, after L2's: one-on-one fights in an arena of their own between awakened characters (classes.ts
// SPECS with a parent), each with their real gear. A fight takes points from the loser. Every month, the character
// with the most points in each class line (the specialization it awakened from: 8 lines) is its Hero for the next
// month, with a title and an aura.
// The server reads these from server-rs/data/game.json (tools/scripts/export-data.ts).
import { SPECS, type Spec } from './classes';

export const OLYMPIAD = {
  /** who may fight: this level, with an awakened specialization */
  minLevel: 76,
  /** a fight: the pause to get ready (no blows, buffs allowed), how long it lasts, the wait before everyone goes back
   * (ms); the arena's radius and how far apart the two start (m) */
  prepMs: 10_000,
  fightMs: 180_000,
  endMs: 3_000,
  radius: 20,
  gap: 16,
  /** the queue pairs the two who waited longest every so often (ms); at most this many fights a day with one rival */
  matchEvery: 5_000,
  perRival: 3,
  /** points: everyone's start each month, and the share of the loser's points the winner takes (at least 1) */
  startPoints: 20,
  take: 0.2,
  /** to be a line's Hero: at least this many fights and this many wins in the month */
  heroFights: 5,
  heroWins: 1,
};

/** The class line a specialization belongs to (the one it awakened from), if it is awakened: who fights whom for Hero. */
export function olympiadLine(spec: Spec | null | undefined): Spec | undefined {
  return spec ? SPECS[spec]?.parent : undefined;
}

/** What a fight moves: the winner takes this from the loser (server-rs olympiad.rs points_won: the same). */
export const pointsWon = (loser: number) => Math.max(1, Math.round(loser * OLYMPIAD.take));
