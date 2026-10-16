# client/src/render/nodes.ts

- Fall · interface · L13-L13 — interface Fall
- NodeVisuals · class · L15-L168 — class NodeVisuals
- constructor · method · L26-L60 — constructor(private scene: THREE.Scene)
- isGone · method · L62-L64 — isGone(id: number)
- setGone · method · L67-L102 — setGone(id: number, gone: boolean, animate = false)
- setBerries · method · L104-L110 — private setBerries(n: NodeDef, on: boolean)
- showStump · method · L112-L126 — private showStump(n: NodeDef, on: boolean)
- fall · method · L129-L149 — private fall(n: NodeDef, inst: { mesh: THREE.InstancedMesh; i: number }[])
- update · method · L152-L167 — update()
- setAt · function · L172-L175 — function setAt(mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4)
- mergeAll · function · L177-L192 — function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry
