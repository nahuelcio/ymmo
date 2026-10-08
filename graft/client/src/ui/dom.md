# client/src/ui/dom.ts

UI utility module providing one-call element creation, instant hover tooltips (replacing slow native titles and suppressed on touch), HTML escaping, and persisted draggable L2-style windows.

- el · function · L1-L7 — One-call DOM factory so UI code can create, style, fill, and attach an element in a single expression.
- tipBox · function · L10-L13 — Lazily creates the single shared tooltip node in the body so every tooltip reuses one element.
- touching · function · L25-L25 — Reports whether a finger touched the screen within the last 1.5 s so hover tooltips do not pop up on taps.
- setTip · function · L27-L46 — Attaches a mouse-driven tooltip to an element, skipping the pop when a touch just happened and repositioning it inside the viewport.
- move · function · L28-L34 — Keeps the tooltip just below/right of the cursor while clamping it within the window edges.
- hideTip · function · L48-L50 — Conceals the shared tooltip element (no-op if it was never shown).
- esc · function · L78-L80 — Escapes HTML-sensitive characters in game strings so they can be safely embedded in tooltip markup.
- loadPos · function · L82-L89 — Restores a window's last saved screen position from localStorage, returning null when storage is unavailable or corrupt.
- savePos · function · L91-L97 — Persists a window's position across sessions, silently ignoring storage failures.
- Win · class · L100-L168 — Draggable, closable L2-style window with z-order stacking, position persistence, and a one-window-at-a-time rule on small touch screens.
- constructor · method · L107-L132 — Builds the window chrome (title bar, close button, body), restores its saved position, and wires pointer-based dragging.
- mv · function · L123-L123 — One-line drag step that repositions the window to follow the pointer by delegating to place().
- up · function · L124-L128 — Ends a drag by detaching the move/up listeners and saving the window's final position.
- place · method · L134-L138 — Clamps a window position to the viewport, interpreting negative x as an offset from the right edge.
- visible · method · L140-L142 — Getter telling whether the window is currently displayed.
- front · method · L144-L148 — Raises the window to the top of the shared z-order stack and reassigns every window's z-index.
- show · method · L150-L156 — Reveals the window, brings it to the front, and enforces the phones-only rule that hides all other windows.
- hide · method · L158-L162 — Conceals the window, drops it from the z-order stack, and dismisses any tooltip.
- toggle · method · L164-L167 — Flips the window between shown and hidden states.
