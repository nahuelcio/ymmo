# client/src/ui/index.ts

Owns every panel of the game interface and fans game-state notifications (stats, inventory, target, per-frame ticks, window closing) out to the right panels.

- UI · class · L11-L112 — class UI
- constructor · method · L25-L63 — Builds all UI panels into the #ui root, wires the settings-panel benchmark action, enables touch controls with a folded chat on touch devices, and shows the help window on first launch.
- partyIds · method · L67-L69 — Supplies the current party member ids (an empty list when no party exists) so game logic can query the player's group roster.
- onMe · method · L71-L81 — Refreshes the HUD, character sheet, and inventory stats after the player's own stats change.
- onInv · method · L83-L87 — Refreshes the inventory, HUD slots, and NPC trade panel after the player's items change.
- onTargetChanged · method · L89-L91 — Updates the HUD's target display when the player's selected target changes.
- update · method · L93-L96 — Ticks the per-frame UI elements (HUD and minimap) once per game frame so time-driven displays stay current.
- closeTop · method · L99-L111 — Implements 'dismiss the top-most window' (e.g. Escape key) by closing an open dialog or hiding the top window in the Win stack, refusing to close while the player is dead with a dialog open.
