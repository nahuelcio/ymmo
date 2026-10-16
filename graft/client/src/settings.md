# client/src/settings.ts

Central player-settings module that defines quality/look presets, all tunable graphics/HUD/gameplay options, and a persisted, observable store that other client modules subscribe to.

- Preset · type · L4-L4 — Names the bundled graphics-quality tiers (low/medium/high/ultra) plus 'custom', which marks settings the player has hand-tuned instead of a preset.
- ShadowQ · type · L5-L5 — Enumerates the four shadow quality levels (off/low/medium/high) used by the graphics presets and the shadow setting.
- LookPreset · type · L6-L6 — Enumerates the available visual post-processing styles plus 'custom' for hand-tuned shader values.
- SlotAction · type · L9-L9 — Template-literal type naming the ten skill-bar key bindings (slot1..slot10) generated from SLOT_N.
- XSlotAction · type · L12-L12 — type XSlotAction = `slot${(typeof XSLOT_N)[number]}`;
- Action · type · L35-L35 — Union of every bindable in-game action, derived from the ACTIONS label table so bindings and their descriptions stay in sync.
- keyLabel · function · L45-L45 — Formats a bound key for display in the UI (e.g. ' ' shown as 'Space', single letters upper-cased).
- Settings · interface · L47-L103 — The complete schema of per-browser player settings spanning graphics, post-processing, atmosphere, HUD, camera, gameplay audio/behavior and key bindings.
- GraphicsKeys · type · L105-L105 — Lists the subset of settings fields that a quality preset (low..ultra) is allowed to override.
- LookKeys · type · L116-L116 — Lists the shader/post-processing fields that a look preset (natural, vivid, noir, etc.) bundles together.
- load · function · L172-L194 — Builds the initial settings: merges a saved localStorage snapshot over defaults (preserving default keys for actions added later, and un-colliding the old Tab-cycle binding), or gives weak/mobile devices a lighter first-run configuration.
- Listener · type · L196-L196 — Callback contract for settings subscribers, receiving the new settings plus exactly which fields changed so listeners can re-apply selectively.
- Store · class · L198-L235 — Observable singleton store that holds the current settings, persists them to localStorage, and notifies listeners of field-level changes.
- on · method · L202-L204 — Registers a listener that will be invoked on every subsequent settings change.
- set · method · L206-L222 — Applies a settings patch: downgrades preset/look to 'custom' when their member fields are tweaked by hand, expands a newly chosen preset or look into its bundled values, then persists and notifies listeners of only the fields that actually changed.
- reset · method · L224-L234 — Restores factory defaults and clears the saved snapshot from localStorage, then tells listeners which fields flipped back.
- textureQuality · function · L243-L245 — function textureQuality(s: Settings): 'off' | 'low' | 'high'
