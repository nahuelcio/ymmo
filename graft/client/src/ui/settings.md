# client/src/ui/settings.ts

- Opt · type · L6-L6 — type Opt<T> = [T, string];
- SettingsPanel · class · L9-L196 — class SettingsPanel
- constructor · method · L17-L26 — constructor(root: HTMLElement)
- render · method · L28-L108 — private render()
- lookCards · method · L111-L120 — private lookCards()
- keys · method · L123-L150 — private keys()
- grab · function · L131-L144 — grab = (e: KeyboardEvent)
- row · method · L152-L156 — private row(label: string)
- check · method · L158-L164 — private check(label: string, key: keyof Settings)
- range · method · L166-L181 — private range(label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string)
- select · method · L183-L195 — private select<T extends string | number>(label: string, key: keyof Settings, opts: Opt<T>[])
