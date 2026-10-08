# shared/src/i18n/index.ts

The localization hub that lets the game present every entity, quest, and NPC text in English while the underlying data is natively Argentine Spanish, with Spanish as the universal fallback when no English string exists.

- Lang · type · L14-L14 — Identifies which of the two supported UI languages (Argentine Spanish or English) all text lookups should resolve to.
- isLang · function · L19-L19 — Type guard that validates untrusted values (e.g. a saved preference or URL param) as one of the two supported language ids before use.
- Dict · type · L21-L21 — Shape declaration for the English overlay dictionary so each category of translated text is type-checked against what the lookups expect.
- pick · function · L30-L30 — Enforces the module's single language-selection rule: show the English string when the reader wants English and a translation exists, otherwise fall back to the native Spanish data.
- itemName · function · L32-L32 — Localized display name for an item as seen in inventories, shops, and drop messages.
- itemDesc · function · L33-L33 — Localized description text that explains what an item does.
- mobName · function · L34-L34 — Localized monster name used in combat text and quest objectives.
- skillName · function · L35-L35 — Localized skill name shown in ability lists and tooltips.
- skillDesc · function · L36-L36 — Localized skill description that explains a skill's effect.
- raceName · function · L37-L37 — Localized playable race name shown during character creation and on character sheets.
- raceDesc · function · L38-L38 — Localized description of a race's traits for character creation.
- className · function · L39-L39 — Localized playable class name shown in character creation and class UI.
- genderName · function · L40-L40 — Localized gender label shown during character creation.
- genderDesc · function · L41-L41 — Localized description accompanying a gender choice in character creation.
- hairStyle · function · L42-L42 — Localized label for a hairstyle option in the character creator.
- campName · function · L43-L43 — Localized name of a camp/battlefield as displayed on its entry UI.
- statusName · function · L44-L44 — Localized name of a buff or debuff status effect.
- statusDesc · function · L45-L45 — Localized explanation of what a status effect does to the player or mob.
- teleportName · function · L46-L46 — Localized name of a teleport destination as shown on the travel menu.
- npcText · function · L48-L51 — Localized NPC dialogue title or greeting shown when interacting with an NPC.
- npcLines · function · L52-L55 — Localized list of an NPC's dialogue lines, falling back to the greeting when the NPC has no dedicated line list.
- zoneName · function · L58-L65 — Translates zone names that arrive as raw Spanish text (from the terrain, raid, and world data) into the reader's language, special-casing the town, raids, and the wilds and keeping Spanish as the last resort.
- questField · function · L67-L69 — Localized quest text field (name, story, offer, busy, ready, or done) used wherever quest dialogue is rendered.
- questName · function · L70-L70 — Localized quest title looked up by quest id for quest logs and trackers.
- tr · function · L73-L73 — Lets callers inline ad-hoc Spanish/English string pairs without registering them in the dictionaries.
- questSummaryL · function · L76-L80 — Renders a quest objective as a compact progress line like "Kill 8 × Keltir" or "Bring 5 × Wolf Pelt" in the reader's language.
- questLineL · function · L82-L85 — Produces the NPC's quest dialogue line appropriate to the quest's current state: a level-gate message when locked, otherwise the offer/busy/ready/done text.
