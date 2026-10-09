# client/src/render/atmos.ts

- sunPhase · function · L19-L22 — function sunPhase(): number
- gameClock · function · L25-L28 — function gameClock(): string
- tickWind · function · L46-L49 — function tickWind(dt: number)
- sway · function · L56-L75 — function sway<T extends THREE.Material>(m: T, amp: number): T
- waterMaterial · function · L82-L163 — function waterMaterial(): THREE.ShaderMaterial
- Motes · class · L167-L214 — class Motes
- constructor · method · L174-L191 — constructor()
- update · method · L193-L213 — update(center: THREE.Vector3, dt: number, t: number)
- LightSource · interface · L217-L217 — interface LightSource
- LocalLights · class · L223-L262 — class LocalLights
- constructor · method · L229-L229 — constructor(private scene: THREE.Scene, private sources: LightSource[])
- update · method · L231-L261 — update(p: THREE.Vector3, t: number)
