# client/src/main.ts

Client entry point that boots the login/character-select flow, wires the websocket lifecycle (session resume, error display, automatic reconnection that reloads and re-enters the world with the same character), and swaps the menu screens for the in-game Game once 'enter' arrives.

- get · method · L26-L32 — Reads a per-tab value from sessionStorage, tolerating browsers where storage access throws (private mode).
- set · method · L33-L40 — Writes or removes a per-tab sessionStorage value, silently ignoring blocked-storage errors.
- enterWorld · function · L43-L46 — Remembers which character is being played (so a drop can re-enter it) and tells the server to bring that character into the world.
- rejoinInPlace · function · L57-L78 — function rejoinInPlace()
- knock · function · L65-L76 — knock = async ()
- giveUp · function · L81-L85 — function giveUp()
- reconnect · function · L92-L116 — Shows a 'connection lost' overlay that keeps probing the server and reloads the page once it's back, so the saved session resumes and the last character re-enters — unless it just re-entered, avoiding two tabs kicking each other forever.
- knock · function · L103-L113 — Opens a probe WebSocket to the server; reloads the page when it connects, otherwise retries with a capped backoff.
- screen · function · L121-L137 — Tears down the previous menu screen (and its 3D preview) and mounts a fresh shell with language picker, logo, and the content panel for the next screen.
- errorLine · function · L139-L142 — Adds an error-message line to a form panel and returns the setter used to display validation/server errors there.
- showError · function · L144-L144 — No-op placeholder for the active screen's error display until a screen installs its own.
- get · method · L148-L154 — Reads a device-persistent value from localStorage, tolerating blocked or unavailable storage.
- set · method · L155-L162 — Writes or removes a localStorage value (session token, remember flag), silently ignoring storage errors.
- loginScreen · function · L165-L208 — Builds the account login/registration form with remembered username and a remember-me checkbox, submitting credentials to the server.
- go · function · L189-L197 — Persists the typed username and remember-me choice, then sends the login-or-register message to the server.
- charScreen · function · L210-L317 — Builds the combined character-select / character-creation screen: an editable list of saved characters (enter, delete, logout) plus a creation studio whose race/class/gender/hair pickers keep the chosen class valid for the chosen race and drive a live 3D preview and a stat-difference panel.
- renderList · function · L217-L247 — Re-renders the saved-character list on every selection change, wiring each card's click to selection and double-click to entering the world, plus the Enter/Delete/Logout buttons underneath.
- label · function · L260-L260 — Adds a small heading above one creation-option group in the studio.
- pickRow · function · L276-L286 — Renders one toggle-button option group (race, class, gender, hair style), disabling choices an availability rule rejects and re-rendering on pick.
- renderPick · function · L287-L308 — Re-renders every creation option row, hair color swatches, and the stat/skill diff, resetting the class to fighter when the chosen race doesn't allow it.
- renderDiff · function · L320-L346 — Shows how the chosen race×gender combo's stats compare to the Human Male baseline and lists every skill the combo grants, tagged by source.
- pct · function · L322-L322 — Converts a stat multiplier into a signed percentage delta for the diff display.
- previewRenderer · function · L349-L389 — Runs a rotating WebGL preview of the character being created, rebuilding the rigged model whenever race, class, or look changes; returns a disposer for screen teardown.
- boot · function · L391-L463 — Starts the client: optional gallery-only mode, model preloading, a resilient connect loop, message handlers (including re-entry after a drop), and then session resume or the login screen.
