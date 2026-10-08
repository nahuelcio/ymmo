# client/src/ui/settings.ts

The in-game settings window: a tabbed panel (graphics, atmosphere, shaders, game & UI, camera, controls) that binds every slider, checkbox and dropdown to the shared settings store so players can tune performance, visuals and gameplay options.

- Opt · type · L6-L6 — Declares the [value, label] tuple shape used to define each dropdown option in the settings UI.
- SettingsPanel · class · L9-L195 — Builds and maintains the tabbed settings window, re-rendering the active tab's controls from the settings store whenever it is shown or a setting changes, and applying edits back via settings.set.
- constructor · method · L17-L26 — Creates the settings window with its tab strip and body, wires the reset-to-defaults button, and makes the panel re-render whenever it is shown or any setting changes elsewhere in the app.
- render · method · L28-L107 — Rebuilds the tab bar and the control set (benchmark entry, sliders, checkboxes, dropdowns) for the currently selected tab, wiring each control to persist into the settings store.
- lookCards · method · L110-L119 — Presents the one-click visual style presets as selectable cards, applies the chosen look on click, and hints when the player has drifted into a custom look.
- keys · method · L122-L149 — Lists one row per remappable action showing its current key binding, and switches the button into key-capture mode when the player clicks it.
- grab · function · L130-L143 — The capture-mode keydown handler: it swallows the pressed key, bails out on reserved keys (Esc, Enter, F-keys, arrows, modifiers), and otherwise assigns the key to the action — swapping it away from any action that already used it.
- row · method · L151-L155 — Trivial helper that creates a labeled row container for other control builders to append their input into.
- check · method · L157-L163 — Adds a checkbox control whose state is read from the settings store and whose change immediately persists the new boolean value.
- range · method · L165-L180 — Adds a slider control whose edits apply live for cheap options but only on release for heavy ones (render scale, view distance), so expensive renderer reconfigurations aren't triggered on every tick.
- select · method · L182-L194 — Adds a dropdown that preselects the stored value and persists the chosen option's typed value (string or number, e.g. quality preset or FPS cap) on change.
