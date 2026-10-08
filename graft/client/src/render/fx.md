# client/src/render/fx.ts

A self-contained three.js visual-effects layer for the game client that spawns, animates, and cleans up short-lived spell visuals (projectiles, impacts, slashes, shockwaves, light pillars, sparkles, attack telegraphs).

- Fx · interface · L4-L9 — Plain data holder describing one live effect: its scene object, start time, duration, and the per-frame animation callback driven by normalized progress k.
- out · function · L24-L24 — Ease-out cubic helper so every expansion starts fast and settles softly, making effects read as an impact rather than a slow inflate.
- FxManager · class · L28-L220 — Owns the full effect lifecycle: builders spawn glowing spell visuals into the scene, and the per-frame ticker advances them, expiring and disposing finished ones.
- constructor · method · L30-L30 — Simply stores the scene that all spawned effects will be added to and later removed from.
- add · method · L32-L35 — Registers a freshly built effect object with the scene and the ticking list, stamping its start time so progress can be derived each frame.
- glow · method · L37-L39 — Creates the additive-blended, transparent, non-depth-writing material style that gives every effect its luminous unlit glow.
- projectile · method · L42-L65 — Spawns a homing glowing bolt — colored halo around a white core plus a fading trail — that arcs from a start point toward a live target position each frame.
- at · function · L50-L53 — Interpolates a point along the bolt's flight path and lifts it with a sine arc, so both the core and each lagging trail node follow the same curved trajectory.
- burst · method · L68-L92 — Plays an impact at a position: a quick white flash, an expanding colored halo, and sparks thrown in random directions that fall under gravity as they fade.
- slash · method · L95-L106 — Draws a crescent arc sweeping across a target, oriented to face the attacker and given a random tilt so each swing reads differently.
- ring · method · L109-L126 — Plays a ground shockwave of two rings chasing each other outward over a fading disc of light, the second ring delayed a quarter of the duration for a pulse effect.
- pillar · method · L129-L161 — Summons a column of light that shoots up instantly then narrows away, with a brighter inner core, an expanding ring at its foot, and white motes spiralling up inside it.
- sparkles · method · L164-L185 — Surrounds a character with twinkling motes that spiral upward at individual speeds and radii, then fade out.
- telegraph · method · L188-L203 — Warns players of an incoming area attack with a fixed red ground outline whose fill disc grows to full radius exactly when the hit lands, while the edge pulses.
- update · method · L205-L219 — Advances every live effect each frame, and once an effect's duration is up removes it from the scene and disposes its materials to avoid leaks.
