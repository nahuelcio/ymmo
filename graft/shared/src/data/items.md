# shared/src/data/items.ts

The shared item catalog for the game: it defines the slot/grade vocabulary and the ItemDef schema, builds the complete item list (hand-written NG–C gear, generated B/A/S tier sets, potions, enchant scrolls and materials), and publishes the enchanting rules and stat-preview math both client and server agree on.

- Slot · type · L3-L3 — Names the nine equipment slots an item can occupy, and (per the ponytail comment) encodes the simplification that one 'ring' slot means an item's slot is always where it is worn — a second ring would need ring1/ring2 plus a first-free-slot rule in equip.
- Grade · type · L6-L6 — Ranks gear quality into six tiers (NG→S) that drive each item's stats, price point, drop/sell availability and display color.
- ItemDef · interface · L8-L31 — The single schema every item must satisfy — identity, type/slot/grade, combat stats, price and stacking, consumable use effects, craft recipe, enchant-scroll affinity and presentation — so client and server share one canonical item format.
- tier · function · L37-L55 — Generates a whole 11-piece equipment set (sword+staff, plate and robe chests, helm/legs/gloves/boots, full jewelry) for one grade at levels 20–50, scaling every stat from a weapon-P.Atk / armor-P.Def / ring-HP baseline chosen so a fighter kills a same-level mob in ~12 hits, and attaching craft recipes when zone materials are supplied.
- craft · function · L40-L40 — Builds the crafting recipe attached to each tier piece — k×4 of each zone material (so a weapon costs 24+24 mats) plus a third of the scaled price in adena — and yields nothing for grades without zone materials.
- armor · function · L41-L41 — One-line factory that stamps out an armor or jewelry piece for the tier set, merging the id/name prefix, grade, k-scaled price, the caller's stats and the craft recipe into a single ItemDef.
- enchantChance · function · L172-L172 — Encodes the enchant risk curve: attempts are guaranteed to succeed up to the safe level (+3), then every further +1 loses 10% chance — the probability that makes enchanting a gamble above safe.
- enchanted · function · L174-L174 — Tooltip-only preview of a stat at +e: rounds the base stat times 1 + 0.08 (weapon) or 0.05 (armor) × e, mirroring but not replacing the server's authoritative enchant math.
- wearLevel · function · L181-L181 — wearLevel = (d: ItemDef)
- MasterworkBonus · interface · L189-L189 — interface MasterworkBonus
- masterworkBonus · function · L195-L203 — function masterworkBonus(race: Race, cls: ClassType, isWeapon: boolean): MasterworkBonus
- speed · function · L197-L197 — speed = (f: number): MasterworkBonus
- lookGrade · function · L205-L205 — lookGrade = (d: ItemDef | null | undefined): Grade | undefined
