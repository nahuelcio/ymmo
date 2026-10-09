# client/src/render/propTex.ts

- Surface · type · L12-L12 — type Surface = 'wood' | 'stone' | 'roof' | 'plaster' | 'bark' | 'leaves' | 'rock';
- PropTexQuality · type · L13-L13 — type PropTexQuality = 'off' | TextureQuality;
- SurfaceDef · interface · L15-L29 — interface SurfaceDef
- P · function · L31-L31 — P = (l: (typeof PROP_LAYERS)[number])
- addSurface · function · L160-L181 — function addSurface(m: THREE.MeshLambertMaterial, surface: Surface): THREE.MeshLambertMaterial
- definesFor · function · L183-L196 — function definesFor(m: THREE.Material, q: PropTexQuality): Record<string, string>
- Precompile · type · L199-L199 — type Precompile = (o: THREE.Object3D) => Promise<unknown>;
- warm · function · L207-L234 — async function warm(q: PropTexQuality, precompile?: Precompile): Promise<() => void>
- afterFrames · function · L237-L237 — afterFrames = (fn: () => void)
- setPropTextures · function · L240-L273 — function setPropTextures(q: PropTexQuality, maxAnisotropy: number, precompile?: Precompile)
- apply · function · L242-L250 — apply = ()
- updatePropTextures · function · L276-L278 — function updatePropTextures(dt: number)
