# client/src/render/textures.ts

- TextureQuality · type · L10-L10 — type TextureQuality = 'low' | 'high';
- TextureSet · interface · L12-L20 — interface TextureSet
- getWorker · function · L33-L52 — function getWorker(): Worker | null
- openDb · function · L61-L76 — function openDb(): Promise<IDBDatabase | null>
- pruneOldVersions · function · L79-L89 — function pruneOldVersions(d: IDBDatabase)
- db · function · L92-L92 — db = ()
- cacheGet · function · L94-L106 — async function cacheGet(key: string): Promise<Uint8Array<ArrayBuffer> | null>
- cachePut · function · L108-L116 — async function cachePut(key: string, data: Uint8Array<ArrayBuffer>)
- paint · function · L119-L126 — async function paint(layers: readonly LayerName[], size: number): Promise<Uint8Array<ArrayBuffer>>
- paintFresh · function · L129-L137 — function paintFresh(layers: readonly LayerName[], size: number): Promise<Uint8Array<ArrayBuffer>>
- toArrayTexture · function · L139-L151 — function toArrayTexture(data: Uint8Array<ArrayBuffer>, size: number, depth: number, anisotropy: number): THREE.DataArrayTexture
- layerMeans · function · L154-L162 — function layerMeans(data: Uint8Array, size: number, depth: number): number[]
- bumpNormal · function · L168-L175 — bumpNormal = (h: string) => /* glsl */
- getTextureSet · function · L182-L198 — function getTextureSet(quality: TextureQuality, maxAnisotropy = 1): Promise<TextureSet>
- disposeTextureSets · function · L200-L207 — async function disposeTextureSets()
- textureSetBytes · function · L210-L214 — function textureSetBytes(quality: TextureQuality): number
- layerBytes · function · L212-L212 — layerBytes = (n: number)
- previewLayer · function · L217-L232 — function previewLayer(tex: THREE.DataArrayTexture, layer: number, channel: 0 | 1 = 0, tiles = 2): HTMLCanvasElement
