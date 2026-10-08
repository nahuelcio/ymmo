# server/src/systems/combat.ts

- Fighter · type · L14-L14 — type Fighter = Player | Mob;
- setPvpMode · function · L19-L29 — function setPvpMode(w: World, p: Player, on: boolean)
- canAttack · function · L31-L45 — function canAttack(_w: World, p: Player, t: Entity, force: boolean, now: number): string | null
- defStats · function · L47-L49 — function defStats(t: Fighter): { pDef: number; mDef: number; evasion: number }
- sendMiss · function · L51-L55 — function sendMiss(src: Fighter, t: Fighter)
- autoAttack · function · L57-L64 — function autoAttack(w: World, p: Player, t: Fighter, now: number)
- mobAttack · function · L66-L74 — function mobAttack(w: World, m: Mob, t: Player, now: number)
- applyStatus · function · L77-L88 — function applyStatus(w: World, src: Fighter, t: Fighter, sa: StatusApply, hitDmg: number, now: number)
- tickStatuses · function · L91-L103 — function tickStatuses(w: World, e: Fighter, now: number)
- applyDamage · function · L105-L139 — function applyDamage(w: World, src: Fighter, t: Fighter, dmg: number, now: number, crit = false, dot = false)
- gainXp · function · L141-L168 — function gainXp(w: World, p: Player, amount: number)
- killMob · function · L170-L227 — function killMob(w: World, m: Mob, now: number)
- killPlayer · function · L229-L262 — function killPlayer(w: World, t: Player, killer: Fighter, now: number)
- respawnPlayer · function · L264-L272 — function respawnPlayer(w: World, p: Player)
- requestSkill · function · L274-L293 — function requestSkill(w: World, p: Player, skillId: string, force: boolean, now: number)
- processSkillIntent · function · L295-L321 — function processSkillIntent(w: World, p: Player, it: Extract<Intent, { type: 'skill' }>, dt: number, now: number)
- finishCast · function · L323-L401 — function finishCast(w: World, p: Player, now: number)
- addThreat · function · L403-L405 — function addThreat(m: Mob, id: number, v: number)
