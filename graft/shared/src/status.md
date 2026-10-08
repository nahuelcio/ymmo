# shared/src/status.ts · [[entity-flag-bitmask]] [[shared-cross-process-contract]] [[status-effect-registry]]

Defines the shared catalog of status effects (stun, slow, bleed, poison) — their client-facing flag bits, icons, and server-side application parameters — so the server ticks effects while clients render them purely from entity flag bits.

- StatusId · type · L4-L4 — Names the four status effects the game supports so skills and mob hits can reference a status by a typed id.
- StatusDef · interface · L6-L6 — Holds each status's display metadata — the entity flag bit, icon, name, and description — that connects server-side flag bits to client UI rendering.
- StatusApply · interface · L20-L27 — Describes how an inflictor (a skill or a mob's hit) applies a status: its id, duration, optional on-hit chance for mobs, and optional damage-per-second fraction for bleed/poison.
- statusIcons · function · L29-L31 — Decodes an entity's flag-bit mask into the list of active status definitions so clients can display the matching icons and tooltips.
