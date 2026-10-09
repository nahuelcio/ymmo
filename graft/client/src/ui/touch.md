# client/src/ui/touch.ts

Provides the mobile control layer for the game, gating it via coarse-pointer detection and offering a virtual joystick, big combat action buttons, and a combat-focus toggle that hides non-essential HUD.

- isTouchDevice · function · L8-L10 — Decides whether the device is a phone/tablet (coarse pointer or touch without a fine pointer) so the touch UI is only mounted on mobile.
- TouchControls · class · L13-L109 — Builds the mobile HUD: a left-side virtual joystick for movement, right-side attack/roll/target buttons wired to game actions, plus a persisted combat-focus toggle, and turns on auto-loot by default for phones.
- constructor · method · L14-L44 — Initializes the touch UI by flagging the body as touch, creating the joystick and action buttons, and enforcing the rule that phones loot automatically by default (one-time localStorage flag, still switchable in Options).
- btn · function · L18-L30 — Factory that creates a large labeled touch button mapping a press to a game action (attack/dash/target) with visual pressed feedback.
- up · function · L27-L27 — Clears the button's pressed styling once the touch ends or is cancelled.
- focusToggle · method · L47-L71 — Adds the combat-focus button that hides non-essential HUD (menu, chat, quests) during fights and remembers the player's choice across sessions.
- set · function · L49-L58 — Applies or removes the hud-focus state on the body, updates the button glyph and accessibility label, and persists the choice to localStorage.
- joystick · method · L73-L108 — Implements the drag-to-move virtual joystick: captures the pointer, tracks its travel within the base, and resets movement input on release.
- move · function · L78-L87 — Clamps the knob offset to the joystick radius and feeds the game a normalized direction vector so speed is consistent at the edge.
- release · function · L100-L105 — Stops the joystick for the pointer that owned it, recentering the knob and zeroing movement input.
