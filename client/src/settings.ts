// Player-side settings (graphics, post-processing, HUD, camera), saved per browser.

export type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQ = 'off' | 'low' | 'medium' | 'high';

export interface Settings {
  preset: Preset;
  // graphics
  renderScale: number; // multiplier on the (capped) device pixel ratio
  antialias: boolean; // MSAA (on the post-processing target when FX are on)
  shadows: ShadowQ;
  viewDistance: number; // fog end / camera far, world units
  fpsCap: number; // 0 = unlimited
  showFps: boolean;
  // post-processing shaders
  bloom: boolean;
  bloomStrength: number;
  ao: boolean; // ambient occlusion (GTAO)
  fxaa: boolean;
  colorGrade: boolean;
  saturation: number;
  contrast: number;
  vignette: number;
  // HUD
  uiScale: number;
  nameplates: boolean;
  hpBars: boolean;
  damageNumbers: boolean;
  minimap: boolean;
  chatOpacity: number;
  // camera
  camSensitivity: number;
  screenShake: boolean;
  invertY: boolean;
}

type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'viewDistance' | 'bloom' | 'ao' | 'fxaa' | 'colorGrade';

export const PRESETS: Record<Exclude<Preset, 'custom'>, Pick<Settings, GraphicsKeys>> = {
  low: { renderScale: 0.75, antialias: false, shadows: 'off', viewDistance: 220, bloom: false, ao: false, fxaa: false, colorGrade: false },
  medium: { renderScale: 1, antialias: false, shadows: 'low', viewDistance: 320, bloom: false, ao: false, fxaa: true, colorGrade: true },
  high: { renderScale: 1, antialias: true, shadows: 'medium', viewDistance: 420, bloom: true, ao: false, fxaa: false, colorGrade: true },
  ultra: { renderScale: 1.25, antialias: true, shadows: 'high', viewDistance: 600, bloom: true, ao: true, fxaa: false, colorGrade: true },
};

export const DEFAULTS: Settings = {
  preset: 'high',
  ...PRESETS.high,
  fpsCap: 0,
  showFps: false,
  bloomStrength: 0.35,
  saturation: 1.1,
  contrast: 1.05,
  vignette: 0.35,
  uiScale: 1,
  nameplates: true,
  hpBars: true,
  damageNumbers: true,
  minimap: true,
  chatOpacity: 0.82,
  camSensitivity: 1,
  screenShake: true,
  invertY: false,
};

const KEY = 'settings:v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable or corrupt */
  }
  // first run: weaker devices start on medium
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || /Mobi|Android/i.test(navigator.userAgent);
  return weak ? { ...DEFAULTS, preset: 'medium', ...PRESETS.medium } : { ...DEFAULTS };
}

type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

class Store {
  s: Settings = load();
  private listeners: Listener[] = [];

  on(l: Listener) {
    this.listeners.push(l);
  }

  set(patch: Partial<Settings>) {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => this.s[k] !== patch[k]);
    if (!changed.length) return;
    // touching a graphics option by hand turns the preset into "custom"
    if (!('preset' in patch) && changed.some((k) => k in PRESETS.low)) patch = { ...patch, preset: 'custom' };
    if (patch.preset && patch.preset !== 'custom' && patch.preset !== this.s.preset) patch = { ...patch, ...PRESETS[patch.preset] };
    const all = (Object.keys(patch) as (keyof Settings)[]).filter((k) => this.s[k] !== patch[k]);
    this.s = { ...this.s, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.s, all);
  }

  reset() {
    const keep = this.s;
    this.s = { ...DEFAULTS };
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    const all = (Object.keys(DEFAULTS) as (keyof Settings)[]).filter((k) => keep[k] !== this.s[k]);
    for (const l of this.listeners) l(this.s, all);
  }
}

export const settings = new Store();
