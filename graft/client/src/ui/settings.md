# client/src/ui/settings.ts

- Opt · type · L6-L6 — type Opt<T> = [T, string];
- SettingsPanel · class · L9-L195 — class SettingsPanel
- constructor · method · L17-L26 — constructor(root: HTMLElement)
- render · method · L28-L107 — private render()
- lookCards · method · L110-L119 — private lookCards()
- keys · method · L122-L149 — private keys()
- grab · function · L130-L143 — grab = (e: KeyboardEvent)
- row · method · L151-L155 — private row(label: string)
- check · method · L157-L163 — private check(label: string, key: keyof Settings)
- range · method · L165-L180 — private range(label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string)
- select · method · L182-L194 — private select<T extends string | number>(label: string, key: keyof Settings, opts: Opt<T>[])
