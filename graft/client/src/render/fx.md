# client/src/render/fx.ts

A self-contained three.js visual-effects layer for the game client that spawns, animates, and cleans up short-lived spell visuals (projectiles, impacts, slashes, shockwaves, light pillars, sparkles, attack telegraphs).

- Fx · interface · L4-L10 — Plain data holder describing one live effect: its scene object, start time, duration, and the per-frame animation callback driven by normalized progress k.
- out · function · L26-L26 — Ease-out cubic helper so every expansion starts fast and settles softly, making effects read as an impact rather than a slow inflate.
- FxManager · class · L30-L313 — Owns the full effect lifecycle: builders spawn glowing spell visuals into the scene, and the per-frame ticker advances them, expiring and disposing finished ones.
- constructor · method · L32-L32 — Simply stores the scene that all spawned effects will be added to and later removed from.
- add · method · L34-L37 — Registers a freshly built effect object with the scene and the ticking list, stamping its start time so progress can be derived each frame.
- glow · method · L39-L41 — Creates the additive-blended, transparent, non-depth-writing material style that gives every effect its luminous unlit glow.
- projectile · method · L44-L67 — Spawns a homing glowing bolt — colored halo around a white core plus a fading trail — that arcs from a start point toward a live target position each frame.
- at · function · L52-L55 — Interpolates a point along the bolt's flight path and lifts it with a sine arc, so both the core and each lagging trail node follow the same curved trajectory.
- burst · method · L70-L94 — Plays an impact at a position: a quick white flash, an expanding colored halo, and sparks thrown in random directions that fall under gravity as they fade.
- slash · method · L97-L108 — Draws a crescent arc sweeping across a target, oriented to face the attacker and given a random tilt so each swing reads differently.
- ring · method · L111-L128 — Plays a ground shockwave of two rings chasing each other outward over a fading disc of light, the second ring delayed a quarter of the duration for a pulse effect.
- pillar · method · L131-L163 — Summons a column of light that shoots up instantly then narrows away, with a brighter inner core, an expanding ring at its foot, and white motes spiralling up inside it.
- motes · method · L166-L187 — motes(pos: THREE.Vector3, color: number, dur = 900, o: { n?: number; r?: number; spin?: number; rise?: number; fall?: number; size?: number } = {})
- sparkles · method · L190-L192 — Surrounds a character with twinkling motes that spiral upward at individual speeds and radii, then fade out.
- shards · method · L195-L217 — shards(pos: THREE.Vector3, color: number, n = 10, spread = 1.5, dur = 700)
- dome · method · L220-L233 — dome(pos: THREE.Vector3, color: number, r = 1.5, dur = 800)
- bolt · method · L236-L257 — bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, dur = 250)
- mk · function · L241-L241 — mk = (c: number)
- dust · method · L260-L277 — dust(pos: THREE.Vector3, dur = 450)
- telegraph · method · L280-L295 — Warns players of an incoming area attack with a fixed red ground outline whose fill disc grows to full radius exactly when the hit lands, while the edge pulses.
- update · method · L297-L312 — Advances every live effect each frame, and once an effect's duration is up removes it from the scene and disposes its materials to avoid leaks.
