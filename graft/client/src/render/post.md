# client/src/render/post.ts

- PostFX · class · L54-L157 — class PostFX
- constructor · method · L62-L62 — constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera)
- needsRebuild · method · L64-L66 — static needsRebuild(changed: (keyof Settings)[])
- rebuild · method · L68-L107 — rebuild(s: Settings)
- tune · method · L110-L119 — tune(s: Settings)
- resize · method · L121-L132 — resize()
- setSun · method · L135-L139 — setSun(u: number, v: number, strength: number)
- render · method · L141-L144 — render()
- compileAsync · method · L150-L156 — compileAsync(o: THREE.Object3D): Promise<unknown>
