# client/src/render/atmos.ts

- sunPhase · function · L18-L21 — function sunPhase(): number
- gameClock · function · L24-L27 — function gameClock(): string
- tickWind · function · L45-L48 — function tickWind(dt: number)
- sway · function · L55-L74 — function sway<T extends THREE.Material>(m: T, amp: number): T
- waterMaterial · function · L81-L134 — function waterMaterial(): THREE.ShaderMaterial
- Motes · class · L138-L185 — class Motes
- constructor · method · L145-L162 — constructor()
- update · method · L164-L184 — update(center: THREE.Vector3, dt: number, t: number)
- LightSource · interface · L188-L188 — interface LightSource
- LocalLights · class · L194-L223 — class LocalLights
- constructor · method · L198-L198 — constructor(private scene: THREE.Scene, private sources: LightSource[])
- update · method · L200-L222 — update(p: THREE.Vector3, t: number)
