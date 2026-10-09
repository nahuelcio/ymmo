# client/src/render/village.ts

- chunkKey · function · L14-L14 — chunkKey = (x: number, z: number)
- Prim · interface · L16-L16 — interface Prim
- vReady · function · L24-L24 — vReady = ()
- bakePiece · function · L26-L43 — function bakePiece(geo: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry
- texKey · function · L45-L49 — function texKey(map: THREE.Texture | null): string
- rememberTex · function · L51-L55 — function rememberTex(map: THREE.Texture | null)
- kitRelief · function · L61-L73 — function kitRelief(shader: Parameters<THREE.Material['onBeforeCompile']>[0])
- kitFloor · function · L83-L96 — function kitFloor(shader: Parameters<THREE.Material['onBeforeCompile']>[0])
- lambert · function · L98-L111 — function lambert(map: THREE.Texture | null, color = 0xffffff, floor = false): THREE.MeshLambertMaterial
- CurtainKind · type · L121-L121 — type CurtainKind = CurtainDraw['kind'];
- curtainMap · function · L128-L134 — function curtainMap(color: number): THREE.Texture | null
- curtainLambert · function · L141-L167 — function curtainLambert(map: THREE.Texture): THREE.MeshLambertMaterial
- flatPrims · function · L169-L181 — function flatPrims(root: THREE.Object3D, skip?: (mesh: THREE.Mesh) => boolean): { geo: THREE.BufferGeometry; color: number }[]
- dropFlagpoles · function · L184-L201 — function dropFlagpoles(geo: THREE.BufferGeometry): THREE.BufferGeometry
- pole · function · L190-L193 — pole = (i: number)
- loadV · function · L203-L254 — function loadV(): Promise<void>
- buildVillage · function · L257-L332 — function buildVillage(): THREE.Group
