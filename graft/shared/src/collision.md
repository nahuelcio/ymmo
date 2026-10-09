# shared/src/collision.ts

Shared static-world collision and pathfinding module that keeps players and mobs out of the map's trees, rocks, town and camps and computes walkable paths, so authoritative server movement and client prediction agree exactly.

- Obstacle · type · L7-L9 — Discriminated union describing every static blocker on the map as either a circle or a rotated box (with precomputed cos/sin), the single shape vocabulary shared by collision resolution and the nav grid.
- circle · function · L14-L14 — Convenience factory that wraps a point-and-radius hitbox into a circle Obstacle for prop placement.
- obb · function · L15-L16 — Convenience factory that wraps a rotated rectangular hitbox into an oriented-box Obstacle, baking cos/sin into the record so later collision tests skip trigonometry.
- buildObstacles · function · L18-L47 — Gathers every static prop from the world layout (trees, rocks, town houses/walls/gates/fountain, zone props, bandit camps) into the single obstacle list the collision and nav systems consume.
- bound · function · L49-L49 — Computes a conservative world-space bounding radius for any obstacle (circle radius or box diagonal) used for coarse spatial-hash seeding and nav rasterization bounds.
- hkey · function · L55-L55 — Packs two grid-cell coordinates into one unique numeric Map key for the spatial hash.
- ensure · function · L57-L71 — Lazily builds the obstacle list and the 8-unit spatial hash on the first collision query, seeding each obstacle into every cell its inflated bounding radius overlaps.
- getObstacles · function · L73-L76 — Grants systems (e.g. renderers) access to the full static obstacle list, building it on first use.
- pushOut · function · L79-L123 — The core movement rule: resolves a walking body out of any overlapping static obstacle using up to three passes over its spatial-hash cell, which makes bodies slide naturally along walls.
- toCell · function · L130-L130 — Converts a world coordinate to a nav grid cell index, clamped to the grid bounds.
- toWorld · function · L131-L131 — Converts a nav cell index back to its world-space coordinate.
- navGrid · function · L133-L155 — Rasterizes all obstacles into a walkable/blocked bitmap, inflating each obstacle by the walker radius so any grid path is automatically safe for a body of default size.
- blockedCell · function · L157-L157 — Single source of truth for "can a walker occupy this cell": false when the cell is off-grid or flagged blocked.
- lineClear · function · L160-L168 — Reports whether a walker can move in a straight line between two points by sampling the segment every half cell and checking each nav cell — used to skip A* and to simplify paths.
- nearestFree · function · L170-L179 — Finds the closest walkable nav cell to a requested one via an expanding ring scan, so paths requested from or toward a spot inside an obstacle degrade gracefully instead of failing.
- scratch · function · L185-L191 — Lazily allocates one set of typed-array buffers reused by every A* search, eliminating per-query allocation and GC pressure.
- findPath · function · L198-L320 — Produces walk waypoints from a start to a target around static obstacles — straight line when clear, otherwise A* over the nav grid plus string-pulling simplification, falling back to the closest reachable point when the goal is walled off.
- push · function · L219-L237 — Binary min-heap insert ordered by A* f-score (heap doubles when full) that keeps the open set cheap to extend.
- pop · function · L238-L254 — Removes and returns the lowest-f-score node from the binary heap via sift-down, implementing the A* "expand best node" step.
- h · function · L256-L259 — Octile-distance heuristic that estimates remaining cost on the 8-connected grid so A* stays admissible and fast.
- free · function · L260-L260 — Checks that a cell is in bounds and not marked blocked, guarding neighbor expansion.
- dashEnd · function · L324-L332 — Simulates the full length of a dodge roll by stepping in 0.5m increments and stopping early when collision resolution blocks movement, exported so client prediction matches the server exactly.
