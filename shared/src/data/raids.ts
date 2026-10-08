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
  /** quest the party leader must have completed to open it */
  quest?: string;
  /** the instance closes this long after the boss dies */
  closeAfterKill: number;
}

export const RAIDS: Record<string, RaidDef> = {
  kaim: { id: 'kaim', name: 'Guarida de Kaim', nameEn: "Kaim's Lair", boss: 'kaim_ascended', x: -20, z: 260, entry: { x: -20, z: 232 }, maxPlayers: 9, minLevel: 1, closeAfterKill: 90000 },
  // entered with `/raid nest`
  nest: { id: 'nest', name: 'Corazón del Nido', nameEn: 'Heart of the Nest', boss: 'vharion', x: -340, z: 130, entry: { x: -340, z: 100 }, maxPlayers: 9, minLevel: 45, quest: 'ancient_drakes', closeAfterKill: 90000 },
};

/** Boss HP multiplier for a raid of n players (a solo try is still possible, just very long). */
export const raidHpScale = (n: number) => 0.35 + 0.65 * Math.max(1, n);
