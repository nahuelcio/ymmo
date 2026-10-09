# client/src/render/post.ts

- PostFX · class · L55-L165 — class PostFX
- constructor · method · L66-L66 — constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera)
- needsRebuild · method · L68-L70 — static needsRebuild(changed: (keyof Settings)[])
- rebuild · method · L72-L115 — rebuild(s: Settings)
- tune · method · L118-L127 — tune(s: Settings)
- resize · method · L129-L140 — resize()
- setSun · method · L143-L147 — setSun(u: number, v: number, strength: number)
- render · method · L149-L152 — render()
- compileAsync · method · L158-L164 — compileAsync(o: THREE.Object3D): Promise<unknown>
