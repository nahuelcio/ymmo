# scripts/export-data.ts

Build script that serializes the shared game data (items, mobs, skills, quests, NPCs, world geometry, character options) into server-rs/data/game.json so the Rust server and client share one source of truth, with English display names pre-resolved so Rust needs no i18n overlay logic.

_No extracted symbols in this file._
