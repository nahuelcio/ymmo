# client/src/ui/chat.ts

Client-side chat panel widget that renders game chat lines into collapsible tabs (All/Party/Whispers/System), with duplicate-line folding, NPC-line muting, an unread badge, and an Enter-to-send input.

- Ch · type · L8-L8 — Channel taxonomy that tags each chat line so tabs can filter it, including client-only categories 'log' (routine system lines) and 'npc' (villager chatter that can be muted).
- Chat · class · L18-L156 — The chat UI component that owns the tab bar, collapsible log, and input, enforcing which channels are visible per tab and folding repeated identical lines into a ×N counter.
- constructor · method · L31-L85 — Builds the chat panel — tab buttons, NPC mute toggle, collapse toggle, scrollable log, and the input whose Enter handler routes text to the network (auto-prefixing '#' on the Party tab) — restoring persisted hidden/NPC state.
- setNpc · function · L45-L54 — Flips the show-NPC preference, immediately re-applies the current tab filter so NPC lines appear or disappear, and persists the choice in localStorage.
- hidden · method · L87-L89 — Trivial getter reporting whether the chat panel is currently collapsed to its tab bar.
- setHidden · method · L92-L101 — Collapses or expands the chat to just its tab bar, clearing the unread counter when reopened and persisting the state per browser.
- renderToggle · method · L103-L108 — Repaints the collapse button, showing an unread-message count badge (capped at 99+) while the chat is collapsed.
- setTab · method · L110-L115 — Switches the active chat tab, highlighting its button and re-applying visibility to every cached line, then snaps the log to the bottom.
- shows · method · L117-L119 — The single visibility rule for a line: its channel must be listed in the active tab, and NPC lines additionally require the NPC toggle to be on.
- focus · method · L121-L124 — Trivial helper that expands the chat and focuses its input so keyboard chat can start immediately.
- prefill · method · L126-L130 — Trivial helper that expands the chat, drops a prepared string into the input, and focuses it — e.g. for command- or reply-style shortcuts.
- add · method · L132-L155 — Appends a chat line, folding an identical consecutive line into a ×N counter on the previous one, then trims the buffer to 250 lines, autoscrolls only if already at the bottom, banners announcements, and bumps the unread badge for non-system lines while collapsed.
