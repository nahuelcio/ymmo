# client/src/settings.ts

- Preset · type · L4-L4 — type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'cine' | 'custom';
- ShadowQ · type · L5-L5 — type ShadowQ = 'off' | 'low' | 'medium' | 'high';
- LookPreset · type · L6-L6 — type LookPreset = 'off' | 'natural' | 'vivid' | 'aden' | 'cinematic' | 'noir' | 'custom';
- SlotAction · type · L9-L9 — type SlotAction = `slot${(typeof SLOT_N)[number]}`;
- Action · type · L28-L28 — type Action = keyof typeof ACTIONS;
- keyLabel · function · L34-L34 — keyLabel = (k: string)
- Settings · interface · L36-L91 — interface Settings
- GraphicsKeys · type · L93-L93 — type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'viewDistance' | 'ao' | 'fxaa' | 'foliage' | 'volumetric' | 'reflections';
- LookKeys · type · L104-L104 — type LookKeys = 'bloom' | 'bloomStrength' | 'colorGrade' | 'saturation' | 'contrast' | 'vignette' | 'toneMapping' | 'exposure' | 'warmth' | 'sharpen';
- load · function · L158-L177 — function load(): Settings
- Listener · type · L179-L179 — type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
- Store · class · L181-L218 — class Store
- on · method · L185-L187 — on(l: Listener)
- set · method · L189-L205 — set(patch: Partial<Settings>)
- reset · method · L207-L217 — reset()
- textureQuality · function · L226-L228 — function textureQuality(s: Settings): 'off' | 'low' | 'high'
