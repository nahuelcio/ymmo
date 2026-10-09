# client/src/render/fx.ts

- Fx · interface · L4-L9 — interface Fx
- out · function · L24-L24 — out = (k: number)
- FxManager · class · L28-L220 — class FxManager
- constructor · method · L30-L30 — constructor(private scene: THREE.Scene)
- add · method · L32-L35 — private add(obj: THREE.Object3D, dur: number, update: (k: number) => void)
- glow · method · L37-L39 — private glow(color: number, opacity = 0.9, side: THREE.Side = THREE.FrontSide)
- projectile · method · L42-L65 — projectile(from: THREE.Vector3, to: () => THREE.Vector3, color: number, dur = 300, size = 0.25)
- at · function · L50-L53 — at = (v: THREE.Vector3, k: number)
- burst · method · L68-L92 — burst(pos: THREE.Vector3, color: number, size = 1, dur = 400)
- slash · method · L95-L106 — slash(pos: THREE.Vector3, from: THREE.Vector3, color: number, size = 1.2, dur = 260)
- ring · method · L109-L126 — ring(pos: THREE.Vector3, color: number, radius = 2, dur = 600)
- pillar · method · L129-L161 — pillar(pos: THREE.Vector3, color: number, dur = 1500, height = 6)
- sparkles · method · L164-L185 — sparkles(pos: THREE.Vector3, color: number, dur = 900)
- telegraph · method · L188-L203 — telegraph(x: number, z: number, r: number, ms: number)
- update · method · L205-L219 — update()
