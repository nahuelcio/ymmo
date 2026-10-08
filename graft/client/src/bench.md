# client/src/bench.ts

Benchmark harness that stress-tests the game with a 48-monster animated crowd, sweeps quality tiers from heaviest down, and recommends the heaviest settings this machine sustains — committed only if the player presses Apply.

- Tier · interface · L12-L12 — Named bundle of a preset name plus concrete settings overrides defining one quality level the benchmark tries.
- runBenchmark · function · L31-L125 — Orchestrates the benchmark: rings animated monsters around the player, measures each quality tier then retries the atmosphere effects it leaves off, restores the player's original settings, and shows a results dialog whose Apply button commits the winning patch.
- sample · function · L56-L65 — Collects every frame's duration for a fixed time window by animating the staged crowd through the game's bench hook, resolving once the window elapses.
- measure · function · L68-L76 — Applies a settings patch, discards a warm-up and the worst 2% hitches, then passes the tier only if average FPS reaches 55 and the worst-5% floor stays above 40.
