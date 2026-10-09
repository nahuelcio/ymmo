# client/src/render/atmos.ts

- sunPhase · function · L19-L22 — function sunPhase(): number
- gameClock · function · L25-L28 — function gameClock(): string
- tickWind · function · L46-L49 — function tickWind(dt: number)
- sway · function · L56-L75 — function sway<T extends THREE.Material>(m: T, amp: number): T
- waterMaterial · function · L82-L151 — function waterMaterial(): THREE.ShaderMaterial
- Motes · class · L155-L202 — class Motes
- constructor · method · L162-L179 — constructor()
- update · method · L181-L201 — update(center: THREE.Vector3, dt: number, t: number)
- LightSource · interface · L205-L205 — interface LightSource
- LocalLights · class · L211-L250 — class LocalLights
- constructor · method · L217-L217 — constructor(private scene: THREE.Scene, private sources: LightSource[])
- update · method · L219-L249 — update(p: THREE.Vector3, t: number)
