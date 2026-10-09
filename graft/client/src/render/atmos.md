# client/src/render/atmos.ts

Atmosphere module that makes the world read differently by the hour: a wall-clock-driven day/night cycle, wind sway for materials, a shader water surface, drifting dust/firefly motes, a pooled set of local point lights, and optional screen-space light-shaft and tilt-shift passes, each individually toggleable in Options.

- sunPhase · function · L19-L22 — Converts the shared wall clock into the sun's angle in its 2π round, compressing the night into the remaining 20% of the cycle so every player sees the same in-game hour without a server.
- gameClock · function · L25-L28 — Renders the current sun phase as an in-game HH:MM clock where sunrise reads 06:00 and sunset 18:00, rounded to ten minutes.
- tickWind · function · L46-L49 — Advances the shared wind-time uniform each frame and flips the wind on/off switch to match the user's wind setting.
- sway · function · L56-L75 — Patches a material's vertex shader so its vertices lean in the wind with the square of their height, keeping roots planted while grass blades and canopies sway.
- waterMaterial · function · L82-L163 — Builds the animated water shader: travelling ripple normals, sky reflection by fresnel, a sun glint, and a baked terrain-depth texture that makes shallows clearer and shallower-looking than deep water.
- Motes · class · L167-L214 — A cloud of ~70 additive points that meanders in world space near the player, reading as dust in daylight and fireflies at night.
- constructor · method · L174-L191 — Creates the mote geometry with random starting positions and a hand-drawn soft round sprite texture so the points glow as dots instead of squares.
- update · method · L193-L213 — Drifts each mote on its own sine path in world space, wrapping only those left behind (or too high/low) back into the box around the player, then restyles color, size, and opacity for firefly-like blinking at night.
- LightSource · interface · L217-L217 — Plain record of a world-space local light (a lamp post or campfire) plus a flag for whether it should flicker like fire.
- LocalLights · class · L223-L262 — Keeps a small fixed pool of real point lights in the scene and reassigns them each frame to the sources nearest the player, since real point lights are too expensive to give every light source in view.
- constructor · method · L229-L229 — One-line constructor that just stores the scene and the list of light sources for later updates.
- update · method · L231-L261 — Syncs the pool's existence with the local-lights setting (recompiles happen only on that switch), then hands each pooled light to the nearest source within range and sets its color, fire flicker, and night-scaled intensity.
