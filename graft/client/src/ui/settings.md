# client/src/ui/settings.ts

- Opt · type · L6-L6 — type Opt<T> = [T, string];
- SettingsPanel · class · L9-L199 — class SettingsPanel
- constructor · method · L17-L26 — constructor(root: HTMLElement)
- render · method · L28-L111 — private render()
- lookCards · method · L114-L123 — private lookCards()
- keys · method · L126-L153 — private keys()
- grab · function · L134-L147 — grab = (e: KeyboardEvent)
- row · method · L155-L159 — private row(label: string)
- check · method · L161-L167 — private check(label: string, key: keyof Settings)
- range · method · L169-L184 — private range(label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string)
- select · method · L186-L198 — private select<T extends string | number>(label: string, key: keyof Settings, opts: Opt<T>[])
