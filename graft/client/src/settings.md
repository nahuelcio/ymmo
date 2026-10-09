# client/src/settings.ts

- Preset · type · L4-L4 — type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
- ShadowQ · type · L5-L5 — type ShadowQ = 'off' | 'low' | 'medium' | 'high';
- LookPreset · type · L6-L6 — type LookPreset = 'off' | 'natural' | 'vivid' | 'aden' | 'cinematic' | 'noir' | 'custom';
- SlotAction · type · L9-L9 — type SlotAction = `slot${(typeof SLOT_N)[number]}`;
- Action · type · L28-L28 — type Action = keyof typeof ACTIONS;
- keyLabel · function · L34-L34 — keyLabel = (k: string)
- Settings · interface · L36-L88 — interface Settings
- GraphicsKeys · type · L90-L90 — type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'viewDistance' | 'ao' | 'fxaa' | 'foliage';
- LookKeys · type · L99-L99 — type LookKeys = 'bloom' | 'bloomStrength' | 'colorGrade' | 'saturation' | 'contrast' | 'vignette' | 'toneMapping' | 'exposure' | 'warmth' | 'sharpen';
- load · function · L152-L171 — function load(): Settings
- Listener · type · L173-L173 — type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
- Store · class · L175-L212 — class Store
- on · method · L179-L181 — on(l: Listener)
- set · method · L183-L199 — set(patch: Partial<Settings>)
- reset · method · L201-L211 — reset()
- textureQuality · function · L220-L222 — function textureQuality(s: Settings): 'off' | 'low' | 'high'
