# client/src/render/terrainTex.ts

- TerrainTexQuality · type · L10-L10 — type TerrainTexQuality = 'off' | TextureQuality;
- TexUniforms · interface · L108-L115 — interface TexUniforms
- texturedMaterial · function · L117-L135 — function texturedMaterial(set: TextureSet, quality: TextureQuality, uniforms: TexUniforms): THREE.MeshLambertMaterial
- TerrainTextures · class · L141-L214 — class TerrainTextures
- constructor · method · L151-L157 — constructor( private terrain: THREE.Group, private plain: THREE.Material, private maxAnisotropy: number, /** compiles the textured shader off the critical path before it is swapped in */ private precompile?: (o: THREE.Object3D) => Promise<unknown>, )
- makeUniforms · method · L159-L169 — private makeUniforms(): TexUniforms
- setMaterial · method · L171-L173 — private setMaterial(m: THREE.Material)
- set · method · L175-L206 — set(q: TerrainTexQuality)
- update · method · L209-L213 — update(dt: number)
