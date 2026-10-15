// Clans, after Lineage 2 (Interlude). Shared so the client shows the same costs and limits the server checks.
// The server reads these from server-rs/data/game.json (tools/scripts/export-data.ts).

/** What a clan of each level allows, and what it takes to reach it from the one below (level 0: to found it). */
export interface ClanLevel {
  members: number;
  adena: number;
  mats: [string, number][];
  /** clan reputation spent on the way up */
  rep: number;
}

export const CLAN_LEVELS: ClanLevel[] = [
  { members: 10, adena: 10_000, mats: [], rep: 0 },
  { members: 15, adena: 50_000, mats: [['wood_log', 20], ['iron_ore', 10]], rep: 0 },
  { members: 20, adena: 200_000, mats: [['stone_fragment', 20], ['orc_tusk', 20]], rep: 0 },
  { members: 30, adena: 600_000, mats: [['cursed_bone', 15], ['ruin_relic', 10]], rep: 0 },
  { members: 40, adena: 1_500_000, mats: [['ember_shard', 10], ['citadel_sigil', 10]], rep: 0 },
  { members: 40, adena: 3_000_000, mats: [['drake_scale', 10], ['dragon_fang', 5]], rep: 5_000 },
];
export const MAX_CLAN_LEVEL = CLAN_LEVELS.length - 1;

export const CLAN = {
  /** a character must be at least this level to found a clan */
  foundLevel: 10,
  /** clan level at which each feature opens */
  crestLevel: 1,
  warehouseLevel: 1,
  warLevel: 3,
  allyLevel: 5,
  skillLevel: 5,
  /** names: letters and digits, this long */
  nameMin: 2,
  nameMax: 16,
  titleMax: 16,
  /** penalties (ms): a member who left or was dismissed may not join another clan, a clan that dismissed may not
   * invite, a leader who dissolved may not found another */
  leaveMs: 24 * 3600_000,
  kickMs: 24 * 3600_000,
  dissolveMs: 10 * 24 * 3600_000,
  /** an invitation stands this long */
  inviteMs: 30_000,
  /** crest: width × height in pixels, and the most bytes its PNG may take */
  crestW: 16,
  crestH: 12,
  crestBytes: 2048,
  /** wars: how many a clan may have declared at once, and how long before declaring again on a clan it stopped fighting */
  maxWars: 30,
  warCooldownMs: 24 * 3600_000,
  /** alliances: how many clans, the alliance crest's size, and the waits after leaving / being expelled (a clan may
   * not join another alliance, the alliance may not invite) and after dissolving (the leading clan may not found another) */
  allyMax: 3,
  allyCrestW: 8,
  allyCrestH: 12,
  allyLeaveMs: 24 * 3600_000,
  allyDissolveMs: 24 * 3600_000,
  /** clan warehouse: how many different stacks / pieces it holds, and how many log lines the window shows */
  whSlots: 100,
  whLog: 30,
};

/** Power grades: 1 is the leader (every privilege), 2-5 get what the leader grants. */
export const CLAN_GRADES = 5;
/** Privileges, as bits of a grade's mask. */
export const CLAN_PRIV = {
  invite: 1,
  dismiss: 2,
  title: 4,
  warehouse: 8,
  crest: 16,
  war: 32,
  ranks: 64,
} as const;
export type ClanPriv = keyof typeof CLAN_PRIV;
/** What grades 2-5 start with: officers invite and title, members nothing. */
export const CLAN_DEFAULT_PRIVS = [0, 0x7f, CLAN_PRIV.invite | CLAN_PRIV.title | CLAN_PRIV.warehouse, CLAN_PRIV.invite, 0, 0];
/** Clan levels at which grades open up (as in L2, the lower ranks come with a bigger clan). */
export const CLAN_GRADE_LEVEL = [0, 0, 0, 2, 2, 0];

/** A stat a clan skill raises (as a fraction: 0.05 = +5%). */
export type ClanSkillStat = 'maxHp' | 'maxMp' | 'pDef' | 'mDef' | 'pAtk' | 'mAtk' | 'speed' | 'mpRegen';
/** Clan skills (L2's, passive): the leader buys each level with clan reputation at the clan master; they count for
 * every member while they are online. bonus and rep: by level (1-3). */
export interface ClanSkill { id: string; name: string; nameEn: string; stat: ClanSkillStat; bonus: number[]; rep: number[] }
export const CLAN_SKILLS: ClanSkill[] = [
  { id: 'clan_vitality', name: 'Vitalidad del Clan', nameEn: 'Clan Vitality', stat: 'maxHp', bonus: [0.03, 0.06, 0.09], rep: [1000, 2000, 4000] },
  { id: 'clan_spirituality', name: 'Espiritualidad del Clan', nameEn: 'Clan Spirituality', stat: 'maxMp', bonus: [0.03, 0.06, 0.09], rep: [1000, 2000, 4000] },
  { id: 'clan_aegis', name: 'Égida del Clan', nameEn: 'Clan Aegis', stat: 'pDef', bonus: [0.03, 0.06, 0.09], rep: [1000, 2000, 4000] },
  { id: 'clan_magic_protection', name: 'Protección Mágica del Clan', nameEn: 'Clan Magic Protection', stat: 'mDef', bonus: [0.03, 0.06, 0.09], rep: [1000, 2000, 4000] },
  { id: 'clan_might', name: 'Poderío del Clan', nameEn: 'Clan Might', stat: 'pAtk', bonus: [0.02, 0.04, 0.06], rep: [1500, 3000, 6000] },
  { id: 'clan_empowering', name: 'Potencia del Clan', nameEn: 'Clan Empowering', stat: 'mAtk', bonus: [0.02, 0.04, 0.06], rep: [1500, 3000, 6000] },
  { id: 'clan_march', name: 'Marcha del Clan', nameEn: 'Clan March', stat: 'speed', bonus: [0.02, 0.04, 0.06], rep: [1500, 3000, 6000] },
  { id: 'clan_clarity', name: 'Claridad del Clan', nameEn: 'Clan Clarity', stat: 'mpRegen', bonus: [0.1, 0.2, 0.3], rep: [1000, 2000, 4000] },
];

/** Clan reputation: what clan members' deeds earn the clan. */
export const CLAN_REP = {
  raidBoss: 500,
  campClear: 50,
  warKill: 20,
  warDeath: -10,
};
