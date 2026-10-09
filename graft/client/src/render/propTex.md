# client/src/render/propTex.ts

- Surface · type · L12-L12 — type Surface = 'wood' | 'stone' | 'roof' | 'plaster' | 'bark' | 'leaves' | 'rock';
- PropTexQuality · type · L13-L13 — type PropTexQuality = 'off' | TextureQuality;
- SurfaceDef · interface · L15-L29 — interface SurfaceDef
- P · function · L31-L31 — P = (l: (typeof PROP_LAYERS)[number])
- addSurface · function · L148-L168 — function addSurface(m: THREE.MeshLambertMaterial, surface: Surface): THREE.MeshLambertMaterial
- definesFor · function · L170-L183 — function definesFor(m: THREE.Material, q: PropTexQuality): Record<string, string>
- Precompile · type · L186-L186 — type Precompile = (o: THREE.Object3D) => Promise<unknown>;
- warm · function · L194-L221 — async function warm(q: PropTexQuality, precompile?: Precompile): Promise<() => void>
- afterFrames · function · L224-L224 — afterFrames = (fn: () => void)
- setPropTextures · function · L227-L260 — function setPropTextures(q: PropTexQuality, maxAnisotropy: number, precompile?: Precompile)
- apply · function · L229-L237 — apply = ()
- updatePropTextures · function · L263-L265 — function updatePropTextures(dt: number)
