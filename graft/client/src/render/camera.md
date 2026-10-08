# client/src/render/camera.ts

Implements the game's L2-style third-person orbit camera: input handlers turn mouse/touch/keyboard gestures into yaw, pitch and zoom state, and each frame the camera is placed on a sphere around the focus point while being clamped above the terrain and shaken on impacts.

- CameraController · class · L6-L121 — Owns the orbit-camera state (yaw, pitch, smoothed distance, focus point, shake amount) and enforces the camera rules: right-drag/wheel/touch/keys adjust the orbit, the camera smoothly follows the player, never dips below the terrain, and decays any requested shake.
- shake · method · L19-L21 — Requests a short screen shake (e.g. on a critical hit) by ratcheting the shake intensity up, which update() later decays.
- constructor · method · L30-L94 — Wires the DOM input layer that drives the camera: right-button drag orbits, mouse wheel zooms (clamped 4-40), one-finger touch drag orbits and two-finger pinch zooms, with context menu suppressed and pointer capture taken on drag.
- end · function · L65-L68 — Touch-gesture cleanup handler that forgets a lifted or cancelled pointer and resets pinch state once fewer than two fingers remain.
- snap · method · L96-L98 — Instantly teleports the camera focus to a point (e.g. respawn or level load), bypassing the smooth lerp used by update().
- update · method · L100-L120 — Per-frame camera tick: applies keyboard orbit, eases zoom and follow distance, converts yaw/pitch/dist into a camera position clamped above the terrain, applies decaying shake, and looks at the focus.
