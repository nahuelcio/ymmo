# client/src/render/wildlife.ts

- Species · type · L12-L12 — type Species = 'stag' | 'horse' | 'donkey' | 'alpaca' | 'bull' | 'cow';
- Model · interface · L25-L25 — interface Model
- loadWildlife · function · L29-L47 — function loadWildlife(): Promise<void>
- Animal · interface · L49-L53 — interface Animal
- Wildlife · class · L58-L142 — class Wildlife
- pick · method · L62-L67 — private pick(x: number, z: number): Species | null
- spawn · method · L69-L88 — private spawn(center: THREE.Vector3): void
- play · method · L90-L98 — private play(an: Animal, name: string)
- drop · method · L100-L105 — private drop(i: number)
- update · method · L107-L141 — update(center: THREE.Vector3, dt: number, now: number)
