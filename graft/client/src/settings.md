# client/src/settings.ts

- Preset · type · L4-L4 — type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'cine' | 'custom';
- ShadowQ · type · L5-L5 — type ShadowQ = 'off' | 'low' | 'medium' | 'high';
- LookPreset · type · L6-L6 — type LookPreset = 'off' | 'natural' | 'vivid' | 'aden' | 'cinematic' | 'noir' | 'custom';
- SlotAction · type · L9-L9 — type SlotAction = `slot${(typeof SLOT_N)[number]}`;
- XSlotAction · type · L12-L12 — type XSlotAction = `slot${(typeof XSLOT_N)[number]}`;
- Action · type · L35-L35 — type Action = keyof typeof ACTIONS;
- keyLabel · function · L45-L45 — keyLabel = (k: string)
- Settings · interface · L47-L107 — interface Settings
- GraphicsKeys · type · L109-L109 — type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'viewDistance' | 'ao' | 'fxaa' | 'foliage' | 'volumetric' | 'reflections';
- LookKeys · type · L120-L120 — type LookKeys = 'bloom' | 'bloomStrength' | 'colorGrade' | 'saturation' | 'contrast' | 'vignette' | 'toneMapping' | 'exposure' | 'warmth' | 'sharpen';
- load · function · L178-L200 — function load(): Settings
- Listener · type · L202-L202 — type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
- Store · class · L204-L241 — class Store
- on · method · L208-L210 — on(l: Listener)
- set · method · L212-L228 — set(patch: Partial<Settings>)
- reset · method · L230-L240 — reset()
- textureQuality · function · L249-L251 — function textureQuality(s: Settings): 'off' | 'low' | 'high'
