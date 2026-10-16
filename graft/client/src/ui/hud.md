# client/src/ui/hud.ts

Declares one hotbar cell as either a skill reference or an item reference, or null when the slot is empty.

- Slot · type · L18-L18 — Declares one hotbar cell as either a skill reference or an item reference, or null when the slot is empty.
- BarState · interface · L26-L26 — interface BarState
- emptyBar · function · L27-L27 — emptyBar = (b: number)
- slotAction · function · L32-L32 — slotAction = (b: number, i: number)
- Hud · class · L34-L603 — Builds every HUD panel and wires its handlers, most importantly the 10-slot hotbar with drag-and-drop rearrangement (slots swap, moved skills trade places), right-click to empty, and click to activate.
- constructor · method · L67-L187 — Builds every HUD panel and wires its handlers, most importantly the 10-slot hotbar with drag-and-drop rearrangement (slots swap, moved skills trade places), right-click to empty, and click to activate.
- syncAtk · function · L121-L121 — Keeps the auto-attack button's keycap label showing the current attack keybind whenever key settings change.
- btn · function · L150-L163 — Factory for the bottom-right menu buttons, giving each an icon, a label and a live key hint that re-syncs when the player rebinds keys.
- sync · function · L155-L159 — Refreshes a menu button's key hint and tooltip from the current key settings.
- makeStatusMovable · method · L193-L259 — private makeStatusMovable(st: HTMLDivElement)
- apply · function · L205-L219 — apply = ()
- save · function · L220-L227 — save = ()
- drag · function · L228-L244 — drag = (e: PointerEvent, move: (dx: number, dy: number, from: { x: number; y: number; w: number }) => void)
- mv · function · L233-L236 — mv = (ev: PointerEvent)
- up · function · L237-L241 — up = ()
- placeCast · method · L262-L269 — private placeCast()
- setQuests · method · L271-L296 — Renders the quest tracker, showing each quest's progress (or a 'return to NPC' callout once the objective count is met) with a star button that toggles that quest's map hints.
- itemCount · method · L298-L300 — Counts how many of an item the player carries in total across inventory stacks, used for hotbar quantity badges and spent detection.
- onMe · method · L302-L334 — Refreshes the player's own status panel from a state snapshot: name/level/race/class, CP/HP/MP/XP bars, buff icons, PvP/PK flag, plus the rules that the world drains to grey under 30% HP and the mana bar trembles under 30% MP.
- buildSlots · method · L337-L380 — private buildSlots(b: number, parent: HTMLElement): HTMLDivElement[]
- syncKey · function · L343-L343 — syncKey = ()
- loadBars · method · L383-L412 — private loadBars(): BarState
- fix · function · L384-L394 — fix = (v: Partial<BarState> | null): BarState | null
- flags · function · L392-L392 — flags = (a: unknown, n: number)
- queueSave · method · L415-L418 — private queueSave(st: BarState)
- sendBar · method · L424-L430 — sendBar(st = this.st)
- saveBar · method · L432-L435 — Persists the hotbar layout and the set of 'known' ids to localStorage (degrading gracefully to a session-only layout if storage is unavailable) and redraws the bar.
- toggleBarsMenu · method · L438-L458 — toggleBarsMenu()
- refreshSlots · method · L460-L503 — Keeps the hotbar truthful: loads the per-character saved layout once, auto-drops each newly learned skill or first-seen consumable into the first free slot exactly once, and re-renders icons, counts and greyed-out 'spent' state.
- activateSlot · method · L505-L517 — Activates a hotbar slot's skill or item, but refuses with a shake when the real (server-confirmed, non-predicted) cooldown is still running instead of sending a doomed request to the server.
- refreshTarget · method · L519-L521 — Invalidates the cached target snapshot key so the next update() forcibly repaints the target window.
- setStatuses · method · L524-L531 — Shows one icon per active status effect by filtering STATUS_IDS against the incoming flags bitmask, each with a name/description tooltip.
- banner · method · L533-L538 — Displays a temporary announcement banner (with an optional bigger style) that automatically hides itself after 2.6 seconds.
- update · method · L540-L602 — Per-frame HUD animation pass: renders cooldown sweeps and countdown numbers plus a no-mana state on hotbar slots, the attack and dash sweeps, cast-bar progress, and the target window's name and bars.
