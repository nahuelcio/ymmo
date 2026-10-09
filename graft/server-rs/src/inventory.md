# server-rs/src/inventory.rs

The bag/economy module of the game server: granting and removing items, equipment slots, consumables, NPC shops, gatekeeper teleports, and ground-item loot (adena and drops) with owner locks and auto-loot.

- INV_MAX · constant · L10-L10 — Caps a player's bag at 80 slots, which gates purchases, loot, and pickups once the bag is full.
- NPC_RANGE · constant · L11-L11 — Anti-distance-cheat radius (8 units) a player must stand within to buy, sell, or teleport from an NPC.
- AUTOLOOT_RANGE · constant · L12-L12 — Maximum distance (40 units) a party member with auto-loot enabled can stand from a kill and still receive its drops.
- qty_prefix · function · L14-L14 — Formats the "N × " prefix shown in buy/sell/loot chat messages only when more than one item is involved.
- add_item · function · L16-L43 — Single entry point for granting items to a bag: adena is added to the currency pool, stackables merge into one slot, and normal items occupy one slot per copy, all capped at INV_MAX.
- count_item · function · L45-L45 — Tells callers (costs, quests, spending checks) how many unequipped copies of an item the player currently holds.
- take_items · function · L47-L61 — Atomically spends N copies of an item (crafting/payment), refusing the operation unless the player has enough, and deletes emptied slots from the back of the bag.
- consume · function · L63-L68 — Shared decrement helper behind using/selling/destroying: reduces one specific bag slot by uid and removes the stack entirely when it hits zero.
- equip · function · L71-L84 — Puts an item into its equipment slot, automatically un-equipping whatever occupied that slot before, then recomputes stats.
- unequip · function · L86-L96 — Frees an equipment slot and recomputes the player's stats without the item's bonuses.
- use_item · function · L98-L132 — Dispatches an item use: wearable items toggle equip/unequip, while consumables apply HP/MP/escape effects under a per-item cooldown and are then consumed.
- destroy_item · function · L134-L141 — Lets a player permanently delete an unequipped item from their bag.
- enchant · function · L144-L174 — pub fn enchant(&mut self, pid: u32, uid: u32)
- npc_in_range · function · L176-L185 — Resolves an NPC's definition only if the player stands within interaction range, otherwise rejects the trade with a 'too far' message.
- open_npc · function · L187-L205 — Sends the player the NPC dialog payload: a random chatter line or scripted greeting, plus the shop listing or teleport destinations depending on the NPC kind.
- buy · function · L207-L221 — Executes a shop purchase, enforcing shop stock, quantity caps (999 stackable / 10 per-item), adena cost, and bag space before charging the player.
- craft · function · L224-L237 — pub fn craft(&mut self, pid: u32, nid: u32, item: &str)
- sell · function · L239-L252 — Pays the player half the item's price for unequipped copies, removing them from the bag and crediting adena.
- gatekeeper · function · L254-L263 — Charges the adena fee for the chosen teleport destination and moves the player there with a small random position jitter.
- spawn_ground · function · L265-L272 — Creates a ground-item entity scattered at a random nearby offset, with a 15-second owner lock and a 60-second expiry before it despawns.
- auto_looter · function · L275-L280 — Chooses which living, nearby (within AUTOLOOT_RANGE) drop-owner with auto-loot enabled receives a mob drop directly.
- open_chest · function · L283-L308 — Rolls a camp chest's adena and chance-based loot straight into the opener's bag, spilling any loot that doesn't fit onto the ground as owner-locked items.
- drop_loot · function · L310-L324 — On mob death, rolls the template's adena range and per-drop chances, spawning ground items that an auto-looting nearby owner immediately tries to pick up (a full bag leaves the item on the ground).
- drop_from_player · function · L326-L339 — Enforces the death penalty by removing one random item from the victim's bag and dropping it on the ground, refreshing stats if it was equipped.
- pickup · function · L341-L359 — Grants a ground item to the player after enforcing the 15-second owner lock, routing camp chests to open_chest instead, and rejecting the pickup when the bag is full.
