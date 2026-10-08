# client/src/settings.ts

- Preset · type · L4-L4 — type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
- ShadowQ · type · L5-L5 — type ShadowQ = 'off' | 'low' | 'medium' | 'high';
- LookPreset · type · L6-L6 — type LookPreset = 'off' | 'natural' | 'vivid' | 'aden' | 'cinematic' | 'noir' | 'custom';
- SlotAction · type · L9-L9 — type SlotAction = `slot${(typeof SLOT_N)[number]}`;
- Action · type · L28-L28 — type Action = keyof typeof ACTIONS;
- keyLabel · function · L34-L34 — keyLabel = (k: string)
- Settings · interface · L36-L87 — interface Settings
- GraphicsKeys · type · L89-L89 — type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'viewDistance' | 'ao' | 'fxaa' | 'foliage';
- LookKeys · type · L98-L98 — type LookKeys = 'bloom' | 'bloomStrength' | 'colorGrade' | 'saturation' | 'contrast' | 'vignette' | 'toneMapping' | 'exposure' | 'warmth' | 'sharpen';
- load · function · L150-L169 — function load(): Settings
- Listener · type · L171-L171 — type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
- Store · class · L173-L210 — class Store
- on · method · L177-L179 — on(l: Listener)
- set · method · L181-L197 — set(patch: Partial<Settings>)
- reset · method · L199-L209 — reset()
