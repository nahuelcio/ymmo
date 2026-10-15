// Instanced raids: every group gets its own copy of the arena, run in its own worker thread.
import { RAID_FLOORS } from '../terrain';

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
  // the ring's raids sit on their own flat floors (terrain.ts RAID_FLOORS): `/raid frost`
  frost: { id: 'frost', name: 'Trono de Escarcha', nameEn: 'Frost Throne', boss: 'hrimgar', x: RAID_FLOORS.frost.x, z: RAID_FLOORS.frost.z, entry: { x: RAID_FLOORS.frost.x, z: RAID_FLOORS.frost.z + 20 }, maxPlayers: 9, minLevel: 58, quest: 'giant_slayer', closeAfterKill: 90000 },
  swamp: { id: 'swamp', name: 'Templo del Pantano', nameEn: 'Swamp Temple', boss: 'ssithra', x: RAID_FLOORS.swamp.x, z: RAID_FLOORS.swamp.z, entry: { x: RAID_FLOORS.swamp.x, z: RAID_FLOORS.swamp.z + 20 }, maxPlayers: 9, minLevel: 68, quest: 'ent_purge', closeAfterKill: 90000 },
};

/** Boss HP multiplier for a raid of n players (a solo try is still possible, just very long). */
export const raidHpScale = (n: number) => 0.35 + 0.65 * Math.max(1, n);
