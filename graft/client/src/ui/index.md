# client/src/ui/index.ts

Owns every panel of the game interface and fans game-state notifications (stats, inventory, target, per-frame ticks, window closing) out to the right panels.

- UI · class · L12-L113 — class UI
- constructor · method · L26-L64 — Builds all UI panels into the #ui root, wires the settings-panel benchmark action, enables touch controls with a folded chat on touch devices, and shows the help window on first launch.
- partyIds · method · L68-L70 — Supplies the current party member ids (an empty list when no party exists) so game logic can query the player's group roster.
- onMe · method · L72-L82 — Refreshes the HUD, character sheet, and inventory stats after the player's own stats change.
- onInv · method · L84-L88 — Refreshes the inventory, HUD slots, and NPC trade panel after the player's items change.
- onTargetChanged · method · L90-L92 — Updates the HUD's target display when the player's selected target changes.
- update · method · L94-L97 — Ticks the per-frame UI elements (HUD and minimap) once per game frame so time-driven displays stay current.
- closeTop · method · L100-L112 — Implements 'dismiss the top-most window' (e.g. Escape key) by closing an open dialog or hiding the top window in the Win stack, refusing to close while the player is dead with a dialog open.
