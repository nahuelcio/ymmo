# shared/src/data/items.ts

The shared item catalog for the game: it defines the slot/grade vocabulary and the ItemDef schema, builds the complete item list (hand-written NG–C gear, generated B/A/S tier sets, potions, enchant scrolls and materials), and publishes the enchanting rules and stat-preview math both client and server agree on.

- Slot · type · L1-L1 — Names the nine equipment slots an item can occupy, and (per the ponytail comment) encodes the simplification that one 'ring' slot means an item's slot is always where it is worn — a second ring would need ring1/ring2 plus a first-free-slot rule in equip.
- Grade · type · L4-L4 — Ranks gear quality into six tiers (NG→S) that drive each item's stats, price point, drop/sell availability and display color.
- ItemDef · interface · L6-L25 — The single schema every item must satisfy — identity, type/slot/grade, combat stats, price and stacking, consumable use effects, craft recipe, enchant-scroll affinity and presentation — so client and server share one canonical item format.
- tier · function · L31-L49 — Generates a whole 11-piece equipment set (sword+staff, plate and robe chests, helm/legs/gloves/boots, full jewelry) for one grade at levels 20–50, scaling every stat from a weapon-P.Atk / armor-P.Def / ring-HP baseline chosen so a fighter kills a same-level mob in ~12 hits, and attaching craft recipes when zone materials are supplied.
- craft · function · L34-L34 — Builds the crafting recipe attached to each tier piece — k×4 of each zone material (so a weapon costs 24+24 mats) plus a third of the scaled price in adena — and yields nothing for grades without zone materials.
- armor · function · L35-L35 — One-line factory that stamps out an armor or jewelry piece for the tier set, merging the id/name prefix, grade, k-scaled price, the caller's stats and the craft recipe into a single ItemDef.
- enchantChance · function · L133-L133 — Encodes the enchant risk curve: attempts are guaranteed to succeed up to the safe level (+3), then every further +1 loses 10% chance — the probability that makes enchanting a gamble above safe.
- enchanted · function · L135-L135 — Tooltip-only preview of a stat at +e: rounds the base stat times 1 + 0.08 (weapon) or 0.05 (armor) × e, mirroring but not replacing the server's authoritative enchant math.
