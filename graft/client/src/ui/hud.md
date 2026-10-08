# client/src/ui/hud.ts

- Slot · type · L16-L16 — type Slot = { type: 'skill' | 'item'; id: string } | null;
- Hud · class · L18-L373 — class Hud
- constructor · method · L46-L156 — constructor(private g: Game, root: HTMLElement)
- syncKey · function · L75-L75 — syncKey = ()
- btn · function · L127-L140 — btn = (icon: Action, label: string, fn: () => void)
- sync · function · L132-L136 — sync = ()
- setQuests · method · L158-L183 — setQuests(list: { id: string; progress: number }[])
- itemCount · method · L185-L187 — private itemCount(id: string)
- onMe · method · L189-L221 — onMe()
- barKey · method · L224-L226 — private get barKey()
- saveBar · method · L228-L235 — private saveBar()
- refreshSlots · method · L237-L278 — refreshSlots()
- activateSlot · method · L280-L291 — activateSlot(i: number)
- refreshTarget · method · L293-L295 — refreshTarget()
- setStatuses · method · L298-L305 — setStatuses(flags: number)
- banner · method · L307-L312 — banner(text: string, big = false)
- update · method · L314-L372 — update(now: number)
