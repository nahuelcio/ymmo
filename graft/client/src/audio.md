# client/src/audio.ts

Self-contained game audio engine that synthesizes every sound effect procedurally via Web Audio (no asset files) and streams zone-based background music loops, gating everything behind lazy context creation and user-gesture unlock.

- Sfx · type · L6-L8 — Enumerates the named sound effects the game can request (combat feedback, pickups, UI clicks, status effects), serving as the contract between gameplay code and the procedural synthesizer in play().
- audio · function · L14-L28 — Lazily creates the shared AudioContext, master gain node, and one second of random white noise (reused by all hiss-style effects), returning null on browsers where audio is unavailable so the game degrades silently.
- preloadSamples · function · L59-L68 — function preloadSamples(c: AudioContext)
- loop · function · L77-L82 — Factory that describes one background music track as a looping HTML audio element tagged with its relative volume and whether it belongs to dungeon zones; the element isn't played here, just configured for syncLoops to manage.
- syncLoops · function · L86-L93 — Keeps background music in step with settings and the current zone: applies the music volume to every loop, then plays only the track matching the current zone type (retrying play() after user gesture) and pauses the rest.
- ambience · function · L97-L100 — Switches the background music bed when the player enters a zone, treating raid instances as dungeons so they get the dungeon loop instead of surface music.
- tone · function · L102-L114 — Schedules one oscillator note with a pitch glide and exponential attack/decay envelope — the melodic building block that every pitched effect (hits, heals, coins, level-ups) is composed from.
- hiss · function · L116-L129 — Schedules a burst of the shared white-noise buffer through a sweepable filter with a fast decay — the percussive/textural building block for whooshes, impacts, and magic shimmer.
- play · function · L132-L223 — The single entry point gameplay uses to play a named effect: it computes the scaled volume, bails out when muted or the audio context isn't running, adds slight random pitch variety so repeated sounds don't feel mechanical, and dispatches to the per-effect recipes of tone()/hiss() calls.
