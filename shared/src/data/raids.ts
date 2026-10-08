// Instanced raids: every group gets its own copy of the arena, run in its own worker thread.

export interface RaidDef {
  id: string;
  name: string;
  nameEn: string;
  boss: string;
  /** arena centre (boss spawn) and where players appear */
  x: number;
  z: number;
  entry: { x: number; z: number };
  maxPlayers: number;
  minLevel: number;
  /** the instance closes this long after the boss dies */
  closeAfterKill: number;
}

export const RAIDS: Record<string, RaidDef> = {
  kaim: { id: 'kaim', name: 'Guarida de Kaim', nameEn: "Kaim's Lair", boss: 'kaim_ascended', x: -20, z: 260, entry: { x: -20, z: 232 }, maxPlayers: 9, minLevel: 1, closeAfterKill: 90000 },
};

/** Boss HP multiplier for a raid of n players (a solo try is still possible, just very long). */
export const raidHpScale = (n: number) => 0.35 + 0.65 * Math.max(1, n);
