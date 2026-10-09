# client/src/render/fx.ts

- Fx · interface · L4-L10 — interface Fx
- out · function · L25-L25 — out = (k: number)
- FxManager · class · L29-L241 — class FxManager
- constructor · method · L31-L31 — constructor(private scene: THREE.Scene)
- add · method · L33-L36 — private add(obj: THREE.Object3D, dur: number, update: (k: number) => void, dust = false)
- glow · method · L38-L40 — private glow(color: number, opacity = 0.9, side: THREE.Side = THREE.FrontSide)
- projectile · method · L43-L66 — projectile(from: THREE.Vector3, to: () => THREE.Vector3, color: number, dur = 300, size = 0.25)
- at · function · L51-L54 — at = (v: THREE.Vector3, k: number)
- burst · method · L69-L93 — burst(pos: THREE.Vector3, color: number, size = 1, dur = 400)
- slash · method · L96-L107 — slash(pos: THREE.Vector3, from: THREE.Vector3, color: number, size = 1.2, dur = 260)
- ring · method · L110-L127 — ring(pos: THREE.Vector3, color: number, radius = 2, dur = 600)
- pillar · method · L130-L162 — pillar(pos: THREE.Vector3, color: number, dur = 1500, height = 6)
- sparkles · method · L165-L186 — sparkles(pos: THREE.Vector3, color: number, dur = 900)
- dust · method · L189-L206 — dust(pos: THREE.Vector3, dur = 450)
- telegraph · method · L209-L224 — telegraph(x: number, z: number, r: number, ms: number)
- update · method · L226-L240 — update()
