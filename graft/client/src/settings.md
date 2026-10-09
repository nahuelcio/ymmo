# client/src/settings.ts

Central player-settings module that defines quality/look presets, all tunable graphics/HUD/gameplay options, and a persisted, observable store that other client modules subscribe to.

- Preset · type · L4-L4 — Names the bundled graphics-quality tiers (low/medium/high/ultra) plus 'custom', which marks settings the player has hand-tuned instead of a preset.
- ShadowQ · type · L5-L5 — Enumerates the four shadow quality levels (off/low/medium/high) used by the graphics presets and the shadow setting.
- LookPreset · type · L6-L6 — Enumerates the available visual post-processing styles plus 'custom' for hand-tuned shader values.
- SlotAction · type · L9-L9 — Template-literal type naming the ten skill-bar key bindings (slot1..slot10) generated from SLOT_N.
- Action · type · L28-L28 — Union of every bindable in-game action, derived from the ACTIONS label table so bindings and their descriptions stay in sync.
- keyLabel · function · L34-L34 — Formats a bound key for display in the UI (e.g. ' ' shown as 'Space', single letters upper-cased).
- Settings · interface · L36-L91 — The complete schema of per-browser player settings spanning graphics, post-processing, atmosphere, HUD, camera, gameplay audio/behavior and key bindings.
- GraphicsKeys · type · L93-L93 — Lists the subset of settings fields that a quality preset (low..ultra) is allowed to override.
- LookKeys · type · L104-L104 — Lists the shader/post-processing fields that a look preset (natural, vivid, noir, etc.) bundles together.
- load · function · L158-L177 — Builds the initial settings: merges a saved localStorage snapshot over defaults (preserving default keys for actions added later, and un-colliding the old Tab-cycle binding), or gives weak/mobile devices a lighter first-run configuration.
- Listener · type · L179-L179 — Callback contract for settings subscribers, receiving the new settings plus exactly which fields changed so listeners can re-apply selectively.
- Store · class · L181-L218 — Observable singleton store that holds the current settings, persists them to localStorage, and notifies listeners of field-level changes.
- on · method · L185-L187 — Registers a listener that will be invoked on every subsequent settings change.
- set · method · L189-L205 — Applies a settings patch: downgrades preset/look to 'custom' when their member fields are tweaked by hand, expands a newly chosen preset or look into its bundled values, then persists and notifies listeners of only the fields that actually changed.
- reset · method · L207-L217 — Restores factory defaults and clears the saved snapshot from localStorage, then tells listeners which fields flipped back.
- textureQuality · function · L226-L228 — function textureQuality(s: Settings): 'off' | 'low' | 'high'
