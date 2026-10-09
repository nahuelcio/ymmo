# client/src/render/village.ts

- chunkKey · function · L13-L13 — chunkKey = (x: number, z: number)
- Prim · interface · L15-L15 — interface Prim
- vReady · function · L23-L23 — vReady = ()
- bakePiece · function · L25-L42 — function bakePiece(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry
- texKey · function · L44-L48 — function texKey(map: THREE.Texture | null): string
- rememberTex · function · L50-L54 — function rememberTex(map: THREE.Texture | null)
- lambert · function · L56-L62 — function lambert(map: THREE.Texture | null, color = 0xffffff): THREE.MeshLambertMaterial
- CurtainKind · type · L72-L72 — type CurtainKind = CurtainDraw['kind'];
- curtainMap · function · L79-L85 — function curtainMap(color: number): THREE.Texture | null
- curtainLambert · function · L92-L117 — function curtainLambert(map: THREE.Texture): THREE.MeshLambertMaterial
- flatPrims · function · L119-L131 — function flatPrims(root: THREE.Object3D, skip?: (mesh: THREE.Mesh) => boolean): { geo: THREE.BufferGeometry; color: number }[]
- dropFlagpoles · function · L134-L151 — function dropFlagpoles(geo: THREE.BufferGeometry): THREE.BufferGeometry
- pole · function · L140-L143 — pole = (i: number)
- loadV · function · L153-L204 — function loadV(): Promise<void>
- buildVillage · function · L207-L282 — function buildVillage(): THREE.Group
