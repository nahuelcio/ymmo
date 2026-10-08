# client/src/render/post.ts

Post-processing module that assembles an optional Three.js EffectComposer stack (GTAO, bloom, god rays, tone-map output, color grade, tilt-shift, FXAA) and renders straight to the canvas at zero cost when every effect is off.

- PostFX · class · L54-L145 — Owns the toggleable post-processing pipeline so the game can enable/disable effects from settings, rebuilding the pass chain only when needed and falling back to a plain renderer.render otherwise.
- constructor · method · L62-L62 — Stores the renderer, scene and camera it will later use to build the composer pipeline.
- needsRebuild · method · L64-L66 — Tells the settings layer whether a changed setting is one of the pipeline-affecting keys, so effects can be live-tuned instead of forcing a full pipeline rebuild.
- rebuild · method · L68-L107 — Disposes and reassembles the entire pass chain from the current settings, skipping the composer entirely when every effect (and MSAA) is off so rendering costs nothing.
- tune · method · L110-L119 — Pushes live-adjustable values (bloom strength and the grade pass's saturation/contrast/vignette/warmth/sharpen) into the existing passes without a rebuild.
- resize · method · L121-L132 — Keeps the composer's size/pixel ratio and the per-pixel uniforms (grade/tilt texel size, FXAA resolution) in sync with the canvas so screen-space effects stay correct.
- setSun · method · L135-L139 — Feeds the god-rays pass this frame's sun screen position (which may be off screen) and shaft strength.
- render · method · L141-L144 — Draws the frame through the composer when a pipeline exists, otherwise straight to the canvas via renderer.render.
