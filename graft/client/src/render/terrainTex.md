# client/src/render/terrainTex.ts

- TerrainTexQuality · type · L9-L9 — type TerrainTexQuality = 'off' | TextureQuality;
- TexUniforms · interface · L103-L109 — interface TexUniforms
- texturedMaterial · function · L111-L127 — function texturedMaterial(set: TextureSet, quality: TextureQuality, uniforms: TexUniforms): THREE.MeshLambertMaterial
- TerrainTextures · class · L133-L205 — class TerrainTextures
- constructor · method · L143-L149 — constructor( private terrain: THREE.Group, private plain: THREE.Material, private maxAnisotropy: number, /** compiles the textured shader off the critical path before it is swapped in */ private precompile?: (o: THREE.Object3D) => Promise<unknown>, )
- makeUniforms · method · L151-L160 — private makeUniforms(): TexUniforms
- setMaterial · method · L162-L164 — private setMaterial(m: THREE.Material)
- set · method · L166-L197 — set(q: TerrainTexQuality)
- update · method · L200-L204 — update(dt: number)
