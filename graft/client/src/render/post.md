# client/src/render/post.ts

- GTAO · class · L19-L34 — class GTAO extends GTAOPass
- _overrideVisibility · method · L20-L33 — _overrideVisibility()
- seeThrough · function · L23-L23 — seeThrough = (m: THREE.Material)
- PostFX · class · L78-L194 — class PostFX
- constructor · method · L89-L89 — constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera)
- needsRebuild · method · L91-L93 — static needsRebuild(changed: (keyof Settings)[])
- rebuild · method · L95-L142 — rebuild(s: Settings)
- tune · method · L145-L154 — tune(s: Settings)
- resize · method · L156-L167 — resize()
- setSun · method · L170-L176 — setSun(u: number, v: number, strength: number)
- render · method · L178-L181 — render()
- compileAsync · method · L187-L193 — compileAsync(o: THREE.Object3D): Promise<unknown>
