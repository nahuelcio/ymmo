# client/src/ui/common.ts

Shared client UI toolkit: renders game icons, localized item/skill tooltips, and progress bars consistently across every screen, backed by preloaded SVG icons and bilingual label maps.

- glyph · function · L17-L23 — Renders a custom SVG from client/src/icons as a mask element that CSS can color, falling back to a plain text span when no icon file exists for that id.
- hydrate · function · L26-L31 — Post-processes HTML-string-generated markup by replacing every <i data-gi="kind/id"> placeholder with its real icon element after it is inserted into the DOM.
- hex · function · L33-L35 — Converts a numeric RGB color value into a zero-padded #rrggbb string for use in inline CSS gradients and borders.
- itemIcon · function · L37-L46 — Builds an item icon tile whose gradient is tinted by the item's color, border colored by its grade, and overlaid with a stack-count badge (with 'k' abbreviation for large counts).
- skillIcon · function · L48-L54 — Builds a skill icon tile whose radial-gradient background is tinted by the skill's defined color so skills are visually distinguishable.
- itemTip · function · L56-L68 — Generates the localized HTML tooltip for an item — title with grade tag, weapon or armor stat line depending on item type, description, and adena value.
- st · function · L62-L62 — st = (k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef')
- skillTip · function · L70-L75 — Generates the localized HTML tooltip for a skill — name and level, description, and an MP/cast-time/cooldown/range line with range shown only when it exceeds 3.
- bar · function · L77-L93 — Creates a labeled progress-bar widget (root, fill, text) exposing a set() that updates fill width and label while skipping redundant renders — used for HP/MP/XP-style gauges.
- set · method · L85-L91 — Updates the bar's fill percentage (clamped to 0–100%) and its cur/max text, but no-ops when the value pair is unchanged to avoid needless DOM writes.
