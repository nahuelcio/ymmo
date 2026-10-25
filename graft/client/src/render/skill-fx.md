# client/src/render/skill-fx.ts

- Ent · type · L5-L5 — type Ent = { pos: THREE.Vector3; height: number };
- VfxCtx · interface · L6-L6 — interface VfxCtx
- Vfx · type · L7-L7 — type Vfx = (c: VfxCtx) => void;
- feet · function · L10-L10 — feet = (e: Ent)
- chest · function · L11-L11 — chest = (e: Ent, k = 0.6)
- head · function · L12-L12 — head = (e: Ent)
- above · function · L13-L13 — above = (p: THREE.Vector3, h: number)
- later · function · L14-L14 — later = (ms: number, fn: () => void)
- at · function · L16-L16 — at = (e: Ent, k = 0.6)
- sonicBurst · function · L763-L767 — function sonicBurst(f: FxManager, p: THREE.Vector3, color: number, size: number)
- songFx · function · L770-L775 — function songFx({ f, s, color, aoe }: VfxCtx)
- danceFx · function · L777-L781 — function danceFx({ f, s, color, aoe }: VfxCtx)
- bladeDance · function · L783-L788 — function bladeDance({ f, s, color, aoe }: VfxCtx, trail: number)
- hot · function · L790-L792 — function hot(c: number)
