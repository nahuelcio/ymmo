# scripts/q-assets.mjs

Build script that regenerates the client's public/q asset pack from the unzipped Quaternius CC0 packs: it strips models down to BaseColor textures, re-encodes textures as shared 1024px WebP, extracts only the six animation clips the game plays (rotations plus pelvis translation so bodies keep their own proportions), and meshopt-compresses every output model.

- walk · function · L16-L22 — Recursively gathers every file path under the unzipped pack directory so the script can find all models and textures to process.
- webp · function · L24-L24 — Maps a model's texture URI to the name of the shared 1024px WebP file that replaces it, so many models can point at one copy of each texture.
- compress · function · L26-L31 — Shrinks an output model in place with the gltf-transform quantize/meshopt pipeline while copying back only non-WebP files so the pre-generated 1024px textures aren't clobbered.
- keep · function · L76-L84 — Copies one accessor's raw animation bytes into the output anims.bin and rebuilds its accessor/bufferView entries so the trimmed clip data stays a valid glTF buffer.
