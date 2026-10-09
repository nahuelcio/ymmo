# server-rs/src/collision.rs

Server-authoritative static collision and pathfinding for the game world: a lazily built obstacle spatial hash and walkability nav grid, circle-vs-obstacle push-out, line-of-walk sampling, A* waypoint routing with string pulling, and dodge-roll endpoint prediction kept identical to the client's.

- CELL · constant · L6-L6 — Spatial-hash bucket size (8 m) that partitions the world so push_out only examines obstacles near the queried point.
- RES · constant · L7-L7 — Nav-grid resolution (1 m per cell) that all walkability marking and A* search math operates at.
- MAX_NODES · constant · L8-L8 — Hard cap on A* node expansions so a pathological path request can never stall a server tick.
- DASH_DIST · constant · L9-L9 — Dodge-roll travel distance (6 m) shared with the client so both sides predict the same landing spot.
- P · struct · L12-L12 — Minimal 2D world point (x,z) used as the return type for resolved positions, waypoints, and dash endpoints.
- Geo · struct · L14-L19 — Immutable global cache bundling the obstacle spatial hash, the walkability nav grid, and the playable half-extent, built once for the whole server lifetime.
- bound · function · L21-L23 — Computes an obstacle's conservative bounding radius (circle radius, or box half-diagonal) used to inflate hash cells and nav-grid stamping areas.
- pos · function · L24-L26 — Extracts an obstacle's center coordinates regardless of whether it is a circle or a box.
- GEO · constant · L28-L28 — OnceLock slot holding the lazily constructed global Geo so the grids exist as a single shared instance.
- geo · function · L30-L71 — Lazily builds, exactly once, the obstacle spatial hash and a nav grid that marks every 1 m cell a player-radius body cannot overlap (circle and rotated-box tests inflated by walk radius).
- warm · function · L74-L74 — Forces the expensive grid/nav build at startup time instead of paying for it on the first movement or path query.
- push_out · function · L76-L122 — Keeps entities out of static geometry by ejecting an overlapping circle along the shortest escape vector (circle surface or box face), iterating up to three passes through nearby hash cells until it settles.
- to_cell · function · L124-L127 — Maps a world coordinate to a clamped nav-grid column/row index for grid lookups.
- to_world · function · L128-L128 — Inverse mapping from a nav-grid index back to world coordinates when turning path cells into waypoints.
- blocked · function · L130-L133 — The single walkability rule for pathing: a cell is impassable if it falls outside the grid or was stamped unwalkable by the nav build.
- line_clear · function · L135-L143 — Decides whether a straight segment is walkable by sampling points roughly every 0.5 m along it and rejecting the segment if any sample is blocked — the shortcut test for both direct paths and string pulling.
- nearest_free · function · L145-L156 — Recovers a usable path endpoint by expanding concentric rings around a blocked cell until the closest walkable cell is found (giving up after radius 12).
- Node · struct · L159-L159 — Binary-heap entry pairing an A* f-score with a cell index for the open set.
- partial_cmp · function · L161-L161 — Required trait shim that forwards Node's partial ordering to its Ord implementation so the heap can compare NaN-free floats.
- cmp · function · L164-L164 — Reverses the f-score comparison so Rust's max-heap BinaryHeap pops the lowest-f node first, i.e. behaves as a min-heap.
- Scratch · struct · L167-L167 — Reusable per-thread A* working arrays (g-scores, parent links, seen/closed stamps) that avoid reallocating megabytes of state on every path query.
- find_path · function · L174-L268 — Plans walking waypoints between two world points: returns a direct path when the line is clear, otherwise runs grid A* (8-way, diagonal cost 1.414, no corner cutting, node-capped, best-effort fallback) over stamp-cleared scratch buffers and then simplifies the route via string pulling.
- dash_end · function · L271-L279 — Predicts a dodge roll's final position by repeatedly stepping 0.5 m along the roll direction and stopping as soon as push_out stops the body from advancing, mirroring the client's own prediction.
