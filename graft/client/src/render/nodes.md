# client/src/render/nodes.ts

- Fall · interface · L13-L13 — interface Fall
- NodeVisuals · class · L15-L173 — class NodeVisuals
- constructor · method · L26-L64 — constructor(private scene: THREE.Scene)
- isGone · method · L66-L68 — isGone(id: number)
- setGone · method · L71-L106 — setGone(id: number, gone: boolean, animate = false)
- setBerries · method · L108-L114 — private setBerries(n: NodeDef, on: boolean)
- showStump · method · L116-L131 — private showStump(n: NodeDef, on: boolean)
- fall · method · L134-L154 — private fall(n: NodeDef, inst: { mesh: THREE.InstancedMesh; i: number }[])
- update · method · L157-L172 — update()
- setAt · function · L177-L180 — function setAt(mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4)
- mergeAll · function · L182-L197 — function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry
