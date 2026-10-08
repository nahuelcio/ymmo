# art/blender/characters.py

One-shot Blender build script that assembles the two playable gender rigs (bodies, tintable clothing shells, elf/orc race features, fitted hair, gear sockets) and exports them as the single client-loaded characters.glb.

- import_gltf · function · L55-L62 — Imports a glTF kit asset and hands back only the newly created objects, discarding the stray Icosphere the kit ships with.
- activate · function · L65-L69 — Makes an object the sole selected, active object so subsequent Blender operators act on it.
- attach · function · L72-L80 — Parents a prop (tusks, hair, socket empty) to a skeleton bone while pinning it at its world placement, so it rides that bone at runtime.
- material · function · L83-L90 — Creates a flat-shaded colour material used for the named colour roles (skin, eyes, top, belt, ivory, ...).
- strip_maps · function · L93-L105 — Enforces the game's Lambert-style look by severing every shader input except Base Colour and deleting the orphaned normal/roughness texture nodes.
- base_tex · function · L108-L113 — Walks a material's node graph upstream from Base Colour to find the actual image texture node feeding it.
- neutralise · function · L116-L125 — Normalises a skin/hair texture by resizing it and dividing out its average hue, so the client can tint per race by simple multiplication.
- dominant_groups · function · L128-L134 — Classifies every body vertex by its highest-weighted vertex group, which is what lets the clothing cutter tell head, limb and torso polygons apart.
- build · function · L139-L332 — Builds one full gender rig: imports the skinned body, neutralises the skin texture, cuts tintable clothing shells, drops the arms from T-pose to the game's rest pose, and adds ears, tusks, fitted hair and gear sockets.
- hair_mat · function · L168-L181 — Provides one cached, tintable material per hair colour role by neutralising the kit's hair texture once and reusing it for every hairstyle.
- front_y · function · L258-L260 — Finds the frontmost head surface at a given height and lateral offset so orc tusks sit on the jaw instead of inside the head.
- render_preview · function · L337-L368 — Stages both finished characters side by side with per-gender visibility (which hair, tusks, gloves show) and renders the documentation preview image.
- main · function · L371-L382 — Entry point that wipes the Blender scene, builds the male and female rigs, exports them to the GLB the client loads, and optionally renders the preview.
