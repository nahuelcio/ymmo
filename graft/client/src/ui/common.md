# client/src/ui/common.ts

- glyph · function · L17-L23 — function glyph(kind: 'skill' | 'item' | 'status' | 'ui', id: string, fallback = '', parent?: HTMLElement): HTMLElement
- hydrate · function · L26-L31 — function hydrate(root: HTMLElement)
- hex · function · L33-L35 — function hex(c: number): string
- itemIconId · function · L43-L43 — itemIconId = (id: string)
- itemIcon · function · L45-L54 — function itemIcon(itemId: string, parent?: HTMLElement, count?: number, ench = 0): HTMLDivElement
- skillIcon · function · L56-L62 — function skillIcon(skillId: string, parent?: HTMLElement): HTMLDivElement
- itemTip · function · L64-L76 — function itemTip(itemId: string, count = 1, ench = 0): string
- st · function · L70-L70 — st = (k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef')
- skillTip · function · L78-L83 — function skillTip(skillId: string): string
- bar · function · L85-L101 — function bar(parent: HTMLElement, cls: string, label?: string): { root: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement; set(cur: number, max: number): void }
- set · method · L93-L99 — set(cur: number, max: number)
