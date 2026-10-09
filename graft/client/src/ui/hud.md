# client/src/ui/hud.ts

Declares one hotbar cell as either a skill reference or an item reference, or null when the slot is empty.

- Slot · type · L16-L16 — Declares one hotbar cell as either a skill reference or an item reference, or null when the slot is empty.
- Hud · class · L18-L393 — Builds every HUD panel and wires its handlers, most importantly the 10-slot hotbar with drag-and-drop rearrangement (slots swap, moved skills trade places), right-click to empty, and click to activate.
- constructor · method · L48-L171 — Builds every HUD panel and wires its handlers, most importantly the 10-slot hotbar with drag-and-drop rearrangement (slots swap, moved skills trade places), right-click to empty, and click to activate.
- syncKey · function · L77-L77 — Re-renders the slot's key-cap label from the current key bindings so shortcuts display correctly after remapping.
- syncAtk · function · L115-L115 — Keeps the auto-attack button's keycap label showing the current attack keybind whenever key settings change.
- btn · function · L142-L155 — Factory for the bottom-right menu buttons, giving each an icon, a label and a live key hint that re-syncs when the player rebinds keys.
- sync · function · L147-L151 — Refreshes a menu button's key hint and tooltip from the current key settings.
- setQuests · method · L173-L198 — Renders the quest tracker, showing each quest's progress (or a 'return to NPC' callout once the objective count is met) with a star button that toggles that quest's map hints.
- itemCount · method · L200-L202 — Counts how many of an item the player carries in total across inventory stacks, used for hotbar quantity badges and spent detection.
- onMe · method · L204-L236 — Refreshes the player's own status panel from a state snapshot: name/level/race/class, CP/HP/MP/XP bars, buff icons, PvP/PK flag, plus the rules that the world drains to grey under 30% HP and the mana bar trembles under 30% MP.
- barKey · method · L239-L241 — Namespaces the hotbar layout's localStorage key by character name so each character keeps its own bar arrangement.
- saveBar · method · L243-L250 — Persists the hotbar layout and the set of 'known' ids to localStorage (degrading gracefully to a session-only layout if storage is unavailable) and redraws the bar.
- refreshSlots · method · L252-L295 — Keeps the hotbar truthful: loads the per-character saved layout once, auto-drops each newly learned skill or first-seen consumable into the first free slot exactly once, and re-renders icons, counts and greyed-out 'spent' state.
- activateSlot · method · L297-L308 — Activates a hotbar slot's skill or item, but refuses with a shake when the real (server-confirmed, non-predicted) cooldown is still running instead of sending a doomed request to the server.
- refreshTarget · method · L310-L312 — Invalidates the cached target snapshot key so the next update() forcibly repaints the target window.
- setStatuses · method · L315-L322 — Shows one icon per active status effect by filtering STATUS_IDS against the incoming flags bitmask, each with a name/description tooltip.
- banner · method · L324-L329 — Displays a temporary announcement banner (with an optional bigger style) that automatically hides itself after 2.6 seconds.
- update · method · L331-L392 — Per-frame HUD animation pass: renders cooldown sweeps and countdown numbers plus a no-mana state on hotbar slots, the attack and dash sweeps, cast-bar progress, and the target window's name and bars.
