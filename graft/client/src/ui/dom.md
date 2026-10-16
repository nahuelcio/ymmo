# client/src/ui/dom.ts

UI utility module providing one-call element creation, instant hover tooltips (replacing slow native titles and suppressed on touch), HTML escaping, and persisted draggable L2-style windows.

- el · function · L1-L7 — One-call DOM factory so UI code can create, style, fill, and attach an element in a single expression.
- tipBox · function · L10-L13 — Lazily creates the single shared tooltip node in the body so every tooltip reuses one element.
- touching · function · L25-L25 — Reports whether a finger touched the screen within the last 1.5 s so hover tooltips do not pop up on taps.
- setTip · function · L27-L46 — Attaches a mouse-driven tooltip to an element, skipping the pop when a touch just happened and repositioning it inside the viewport.
- move · function · L28-L34 — Keeps the tooltip just below/right of the cursor while clamping it within the window edges.
- hideTip · function · L48-L50 — Conceals the shared tooltip element (no-op if it was never shown).
- showTipAt · function · L56-L62 — function showTipAt(text: string, x: number, y: number)
- esc · function · L90-L92 — Escapes HTML-sensitive characters in game strings so they can be safely embedded in tooltip markup.
- loadPos · function · L94-L101 — Restores a window's last saved screen position from localStorage, returning null when storage is unavailable or corrupt.
- savePos · function · L103-L109 — Persists a window's position across sessions, silently ignoring storage failures.
- Win · class · L112-L198 — Draggable, closable L2-style window with z-order stacking, position persistence, and a one-window-at-a-time rule on small touch screens.
- constructor · method · L123-L150 — Builds the window chrome (title bar, close button, body), restores its saved position, and wires pointer-based dragging.
- mv · function · L141-L141 — One-line drag step that repositions the window to follow the pointer by delegating to place().
- up · function · L142-L146 — Ends a drag by detaching the move/up listeners and saving the window's final position.
- place · method · L152-L156 — Clamps a window position to the viewport, interpreting negative x as an offset from the right edge.
- visible · method · L158-L160 — Getter telling whether the window is currently displayed.
- resetAll · method · L163-L172 — static resetAll()
- front · method · L174-L178 — Raises the window to the top of the shared z-order stack and reassigns every window's z-index.
- show · method · L180-L186 — Reveals the window, brings it to the front, and enforces the phones-only rule that hides all other windows.
- hide · method · L188-L192 — Conceals the window, drops it from the z-order stack, and dismisses any tooltip.
- toggle · method · L194-L197 — Flips the window between shown and hidden states.
