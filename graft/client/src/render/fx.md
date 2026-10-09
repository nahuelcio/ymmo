# client/src/render/fx.ts

A self-contained three.js visual-effects layer for the game client that spawns, animates, and cleans up short-lived spell visuals (projectiles, impacts, slashes, shockwaves, light pillars, sparkles, attack telegraphs).

- Fx · interface · L4-L10 — Plain data holder describing one live effect: its scene object, start time, duration, and the per-frame animation callback driven by normalized progress k.
- out · function · L25-L25 — Ease-out cubic helper so every expansion starts fast and settles softly, making effects read as an impact rather than a slow inflate.
- FxManager · class · L29-L241 — Owns the full effect lifecycle: builders spawn glowing spell visuals into the scene, and the per-frame ticker advances them, expiring and disposing finished ones.
- constructor · method · L31-L31 — Simply stores the scene that all spawned effects will be added to and later removed from.
- add · method · L33-L36 — Registers a freshly built effect object with the scene and the ticking list, stamping its start time so progress can be derived each frame.
- glow · method · L38-L40 — Creates the additive-blended, transparent, non-depth-writing material style that gives every effect its luminous unlit glow.
- projectile · method · L43-L66 — Spawns a homing glowing bolt — colored halo around a white core plus a fading trail — that arcs from a start point toward a live target position each frame.
- at · function · L51-L54 — Interpolates a point along the bolt's flight path and lifts it with a sine arc, so both the core and each lagging trail node follow the same curved trajectory.
- burst · method · L69-L93 — Plays an impact at a position: a quick white flash, an expanding colored halo, and sparks thrown in random directions that fall under gravity as they fade.
- slash · method · L96-L107 — Draws a crescent arc sweeping across a target, oriented to face the attacker and given a random tilt so each swing reads differently.
- ring · method · L110-L127 — Plays a ground shockwave of two rings chasing each other outward over a fading disc of light, the second ring delayed a quarter of the duration for a pulse effect.
- pillar · method · L130-L162 — Summons a column of light that shoots up instantly then narrows away, with a brighter inner core, an expanding ring at its foot, and white motes spiralling up inside it.
- sparkles · method · L165-L186 — Surrounds a character with twinkling motes that spiral upward at individual speeds and radii, then fade out.
- dust · method · L189-L206 — dust(pos: THREE.Vector3, dur = 450)
- telegraph · method · L209-L224 — Warns players of an incoming area attack with a fixed red ground outline whose fill disc grows to full radius exactly when the hit lands, while the edge pulses.
- update · method · L226-L240 — Advances every live effect each frame, and once an effect's duration is up removes it from the scene and disposes its materials to avoid leaks.
