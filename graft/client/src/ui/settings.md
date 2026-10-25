# client/src/ui/settings.ts

- Opt · type · L8-L8 — type Opt<T> = [T, string];
- SettingsPanel · class · L11-L218 — class SettingsPanel
- constructor · method · L19-L28 — constructor(root: HTMLElement)
- render · method · L30-L124 — private render()
- lookCards · method · L127-L136 — private lookCards()
- keys · method · L139-L172 — private keys()
- grab · function · L153-L166 — grab = (e: KeyboardEvent)
- row · method · L174-L178 — private row(label: string)
- check · method · L180-L186 — private check(label: string, key: keyof Settings)
- range · method · L188-L203 — private range(label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string)
- select · method · L205-L217 — private select<T extends string | number>(label: string, key: keyof Settings, opts: Opt<T>[])
