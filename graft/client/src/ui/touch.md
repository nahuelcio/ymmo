# client/src/ui/touch.ts

Provides the mobile control layer for the game, gating it via coarse-pointer detection and offering a virtual joystick, big combat action buttons, and a combat-focus toggle that hides non-essential HUD.

- isTouchDevice · function · L8-L10 — Decides whether the device is a phone/tablet (coarse pointer or touch without a fine pointer) so the touch UI is only mounted on mobile.
- hudFocus · function · L16-L23 — function hudFocus(saved = false): boolean
- setHudFocus · function · L24-L31 — function setHudFocus(on: boolean)
- TouchControls · class · L34-L103 — Builds the mobile HUD: a left-side virtual joystick for movement, right-side attack/roll/target buttons wired to game actions, plus a persisted combat-focus toggle, and turns on auto-loot by default for phones.
- constructor · method · L35-L65 — Initializes the touch UI by flagging the body as touch, creating the joystick and action buttons, and enforcing the rule that phones loot automatically by default (one-time localStorage flag, still switchable in Options).
- btn · function · L39-L51 — Factory that creates a large labeled touch button mapping a press to a game action (attack/dash/target) with visual pressed feedback.
- up · function · L48-L48 — Clears the button's pressed styling once the touch ends or is cancelled.
- joystick · method · L67-L102 — Implements the drag-to-move virtual joystick: captures the pointer, tracks its travel within the base, and resets movement input on release.
- move · function · L72-L81 — Clamps the knob offset to the joystick radius and feeds the game a normalized direction vector so speed is consistent at the edge.
- release · function · L94-L99 — Stops the joystick for the pointer that owned it, recentering the knob and zeroing movement input.
