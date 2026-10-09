# server-rs/src/raid.rs

Houses the per-world thread machinery: the overworld and one thread per raid instance, each driven by a 20 Hz command/tick loop that reports back to a central hub.

- hp_scale · function · L13-L13 — Computes the boss HP multiplier for a raid of n players, keeping group encounters challenging while making a solo attempt possible, just very long.
- WorldCmd · enum · L15-L23 — The set of commands clients (via the hub) can send to a world thread: join, in-game message, quit, language change, or shutdown.
- HubMsg · enum · L25-L31 — The messages a world thread sends back to the hub: gameplay events, notification that the world thread ended, and periodic performance stats.
- run_world · function · L34-L107 — The body of a world thread: panic-guarded loop that dispatches player commands, ticks the world at 20 Hz with catch-up protection, autosaves every second, reports perf every 5 s, and stops on shutdown/disconnect or when a raid empties out.
