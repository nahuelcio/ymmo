# client/src/ui/hud.ts

- Slot · type · L16-L16 — Declares one hotbar cell as a skill reference, an item reference, or empty, so a single bar can mix abilities and consumables.
- Hud · class · L18-L393 — Encapsulates the whole on-screen interface, keeping vitals, target frame, shortcut-bar layout (persisted per character), cast bar, menus and quest tracker in sync with live game state.
- constructor · method · L48-L171 — Builds every HUD panel and wires user interaction: slot clicks, drag-and-drop rearrangement/assignment of skills and potions, menu window toggles, and the PvP on/off button.
- syncKey · function · L77-L77 — Re-renders the slot's key-cap label from the current key bindings so shortcuts display correctly after remapping.
- syncAtk · function · L115-L115 — syncAtk = ()
- btn · function · L142-L155 — Factory for the bottom-right menu buttons, giving each an icon, a label and a live key hint that re-syncs when the player rebinds keys.
- sync · function · L147-L151 — Refreshes a menu button's key hint and tooltip from the current key settings.
- setQuests · method · L173-L198 — Renders the quest tracker, showing each quest's progress (or a 'return to NPC' callout once the objective count is met) with a star button that toggles that quest's map hints.
- itemCount · method · L200-L202 — Counts how many of an item the player carries in total across inventory stacks, used for hotbar quantity badges and spent detection.
- onMe · method · L204-L236 — Refreshes the player's own display — name/level line, CP/HP/MP/XP bars, buff icons, PvP flag and karma badge — including the world greying out under 30% life and the trembling low-mana bar.
- barKey · method · L239-L241 — Namespaces the hotbar layout's localStorage key by character name so each character keeps its own bar arrangement.
- saveBar · method · L243-L250 — Persists the hotbar layout and the set of 'known' ids to localStorage (degrading gracefully to a session-only layout if storage is unavailable) and redraws the bar.
- refreshSlots · method · L252-L295 — Loads the saved bar layout once, automatically places newly learned skills and first-obtained consumables into free slots (each only once), then repaints icons, cooldown placeholders and the greyed-out 'spent' state only when something actually changed.
- activateSlot · method · L297-L308 — Triggers the slot's skill or item on click, refusing with a shake when a server-confirmed (not client-predicted) cooldown is still running.
- refreshTarget · method · L310-L312 — Invalidates the cached target snapshot key so the next update() forcibly repaints the target window.
- setStatuses · method · L315-L322 — Shows one icon per active status effect by filtering STATUS_IDS against the incoming flags bitmask, each with a name/description tooltip.
- banner · method · L324-L329 — Displays a temporary announcement banner (with an optional bigger style) that automatically hides itself after 2.6 seconds.
- update · method · L331-L392 — Per-frame HUD tick: animates hotbar and dash cooldown overlays plus the 'not enough mana' state, drives the cast bar fill, and repaints the target window — name colour by con level or red/purple flags, HP bar, party-invite/whisper actions — only when its composite data key changed.
