# scripts/loadtest.ts

Spawns a swarm of WebSocket bot clients that register, form parties, enter raids, fight/dodge the boss (or wander the overworld), and periodically prints a load-test scorecard including p50/p95/p99 server reply latency.

- arg · function · L11-L14 — Reads a named --flag value from process.argv with a fallback default, letting the run be tuned (server URL, bot count, raid size, duration) without a CLI parser dependency.
- Bot · interface · L24-L34 — Plain state holder for one simulated player: its socket, identity, position, current boss target, raid membership flag, and a send helper that only writes on an open socket.
- startBot · function · L37-L123 — Drives one bot's full lifecycle: open socket and register, create/enter a character, have every RAIDth bot act as leader to invite its peers and trigger '/raid', then loop attacking and dodging the boss (or wandering) while probing reply latency with '/who'.
- pct · function · L127-L130 — Returns a requested latency percentile (e.g. p50/p95/p99) from the collected samples, or '-' when no samples exist yet.
- report · function · L131-L132 — Prints the rolling load-test scorecard — entered/in-raid/hits/deaths/errors plus reply-latency percentiles — every 10 seconds and once more at shutdown.
