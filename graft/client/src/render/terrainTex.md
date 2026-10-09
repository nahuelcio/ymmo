# client/src/render/terrainTex.ts

- TerrainTexQuality · type · L9-L9 — type TerrainTexQuality = 'off' | TextureQuality;
- TexUniforms · interface · L107-L114 — interface TexUniforms
- texturedMaterial · function · L116-L133 — function texturedMaterial(set: TextureSet, quality: TextureQuality, uniforms: TexUniforms): THREE.MeshLambertMaterial
- TerrainTextures · class · L139-L212 — class TerrainTextures
- constructor · method · L149-L155 — constructor( private terrain: THREE.Group, private plain: THREE.Material, private maxAnisotropy: number, /** compiles the textured shader off the critical path before it is swapped in */ private precompile?: (o: THREE.Object3D) => Promise<unknown>, )
- makeUniforms · method · L157-L167 — private makeUniforms(): TexUniforms
- setMaterial · method · L169-L171 — private setMaterial(m: THREE.Material)
- set · method · L173-L204 — set(q: TerrainTexQuality)
- update · method · L207-L211 — update(dt: number)
