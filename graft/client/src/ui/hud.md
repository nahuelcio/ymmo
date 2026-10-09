# client/src/ui/hud.ts

- Slot · type · L16-L16 — type Slot = { type: 'skill' | 'item'; id: string } | null;
- Hud · class · L18-L393 — class Hud
- constructor · method · L48-L171 — constructor(private g: Game, root: HTMLElement)
- syncKey · function · L77-L77 — syncKey = ()
- syncAtk · function · L115-L115 — syncAtk = ()
- btn · function · L142-L155 — btn = (icon: Action, label: string, fn: () => void)
- sync · function · L147-L151 — sync = ()
- setQuests · method · L173-L198 — setQuests(list: { id: string; progress: number }[])
- itemCount · method · L200-L202 — private itemCount(id: string)
- onMe · method · L204-L236 — onMe()
- barKey · method · L239-L241 — private get barKey()
- saveBar · method · L243-L250 — private saveBar()
- refreshSlots · method · L252-L295 — refreshSlots()
- activateSlot · method · L297-L308 — activateSlot(i: number)
- refreshTarget · method · L310-L312 — refreshTarget()
- setStatuses · method · L315-L322 — setStatuses(flags: number)
- banner · method · L324-L329 — banner(text: string, big = false)
- update · method · L331-L392 — update(now: number)
