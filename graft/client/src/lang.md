# client/src/lang.ts

Client-side language management: it resolves the player's language once at startup (saved preference first, then browser language) and exposes translation and number-formatting helpers around that choice, with a change applied by persisting and reloading the page.

- detect · function · L5-L13 — Resolves the player's starting language by honoring a previously saved choice from localStorage and falling back to the browser language (Spanish → 'es', otherwise 'en') on first visit or when storage is unavailable.
- t · function · L18-L18 — Lets UI code request bilingual text by passing the Spanish and English strings, which it delegates to the shared translator using the player's resolved language.
- setLang · function · L20-L28 — Applies a language switch by saving the new language to localStorage and reloading the page so all text is rebuilt in that language (no-op if it's already active).
- fmt · function · L31-L31 — Formats numbers for display according to the player's language, using the Spanish (es-AR) or English (en-US) locale.
