# client/src/ui/common.ts

Shared client UI toolkit: renders game icons, localized item/skill tooltips, and progress bars consistently across every screen, backed by preloaded SVG icons and bilingual label maps.

- glyph · function · L18-L24 — Renders a custom SVG from client/src/icons as a mask element that CSS can color, falling back to a plain text span when no icon file exists for that id.
- hydrate · function · L27-L32 — Post-processes HTML-string-generated markup by replacing every <i data-gi="kind/id"> placeholder with its real icon element after it is inserted into the DOM.
- hex · function · L34-L36 — Converts a numeric RGB color value into a zero-padded #rrggbb string for use in inline CSS gradients and borders.
- itemIconId · function · L45-L45 — itemIconId = (id: string)
- itemIcon · function · L47-L56 — Builds an item icon tile whose gradient is tinted by the item's color, border colored by its grade, and overlaid with a stack-count badge (with 'k' abbreviation for large counts).
- skillIcon · function · L58-L64 — Builds a skill icon tile whose radial-gradient background is tinted by the skill's defined color so skills are visually distinguishable.
- myLevel · function · L67-L67 — myLevel = ()
- setTipLevel · function · L68-L68 — setTipLevel = (f: () => number)
- mySelf · function · L70-L70 — mySelf = (): { race: Race; cls: ClassType } | null
- setTipSelf · function · L71-L71 — setTipSelf = (f: () => { race: Race; cls: ClassType } | null)
- pct · function · L73-L73 — pct = (v: number)
- mwText · function · L75-L79 — mwText = (b: MasterworkBonus)
- masterworkLines · function · L82-L93 — function masterworkLines(isWeapon: boolean): string[]
- itemTip · function · L95-L112 — Generates the localized HTML tooltip for an item — title with grade tag, weapon or armor stat line depending on item type, description, and adena value.
- st · function · L102-L102 — st = (k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef')
- skillTip · function · L114-L119 — Generates the localized HTML tooltip for a skill — name and level, description, and an MP/cast-time/cooldown/range line with range shown only when it exceeds 3.
- bar · function · L121-L137 — Creates a labeled progress-bar widget (root, fill, text) exposing a set() that updates fill width and label while skipping redundant renders — used for HP/MP/XP-style gauges.
- set · method · L129-L135 — Updates the bar's fill percentage (clamped to 0–100%) and its cur/max text, but no-ops when the value pair is unchanged to avoid needless DOM writes.
