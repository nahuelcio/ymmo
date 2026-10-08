# graft — repo map

Small markdown nodes summarising this repo. `grep` any term, symbol, or
filename here, or run `graft ask "<task>"`. Each node carries prose plus exact
`file:line`; open a source file only to edit the named span.

The same graph is queryable as MCP tools (`graft_find_code`, `graft_find_all`,
`graft_trace_calls`, `graft_file_api`, `graft_repo_map`) where a host exposes them, and
as the `graft` CLI everywhere else. Edges — who calls what — live only in the
graph, not in these files: `graft callers <symbol>` is the only way to read them.

## Concepts

- [delta-snapshot-bandwidth-model](delta-snapshot-bandwidth-model.md) — Delta snapshot bandwidth model · shared/src/protocol.ts
- [deterministic-procedural-terrain](deterministic-procedural-terrain.md) — Deterministic procedural terrain · shared/src/terrain.ts
- [entity-flag-bitmask](entity-flag-bitmask.md) — Entity flag bitmask · shared/src/protocol.ts, shared/src/status.ts
- [shared-cross-process-contract](shared-cross-process-contract.md) — Shared cross-process contract · shared/src/protocol.ts, shared/src/status.ts, shared/src/terrain.ts
- [status-effect-registry](status-effect-registry.md) — Status effect registry · shared/src/status.ts
- [wire-protocol-entity-schema](wire-protocol-entity-schema.md) — Wire protocol & entity schema · shared/src/protocol.ts

## Files

65 per-file wiring cards mirror the source tree under `graft/` (61 carry extracted symbols). They are deliberately not enumerated here —
`grep` a symbol or `find`/`ls` a filename under `graft/` to land on the card for that file.
