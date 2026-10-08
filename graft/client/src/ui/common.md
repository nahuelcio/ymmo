# client/src/ui/common.ts

- glyph · function · L17-L23 — function glyph(kind: 'skill' | 'item' | 'status' | 'ui', id: string, fallback = '', parent?: HTMLElement): HTMLElement
- hydrate · function · L26-L31 — function hydrate(root: HTMLElement)
- hex · function · L33-L35 — function hex(c: number): string
- itemIcon · function · L37-L45 — function itemIcon(itemId: string, parent?: HTMLElement, count?: number): HTMLDivElement
- skillIcon · function · L47-L53 — function skillIcon(skillId: string, parent?: HTMLElement): HTMLDivElement
- itemTip · function · L55-L66 — function itemTip(itemId: string, count = 1): string
- skillTip · function · L68-L73 — function skillTip(skillId: string): string
- bar · function · L75-L91 — function bar(parent: HTMLElement, cls: string, label?: string): { root: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement; set(cur: number, max: number): void }
- set · method · L83-L89 — set(cur: number, max: number)
