import { t as tx } from './lang';
// Player-side settings (graphics, post-processing, HUD, camera), saved per browser.

export type Preset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQ = 'off' | 'low' | 'medium' | 'high';
export type LookPreset = 'off' | 'natural' | 'vivid' | 'aden' | 'cinematic' | 'noir' | 'custom';

const SLOT_N = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
type SlotAction = `slot${(typeof SLOT_N)[number]}`;
/** Things a key can be bound to. F1-F10 (skill bar too), Enter, Esc and the arrow keys are fixed. */
export const ACTIONS = {
  attack: tx('Atacar al objetivo', 'Attack target'),
  stop: tx('Frenar: dejar de moverse y de atacar', 'Stop: quit moving and attacking'),
  nextTarget: tx('Siguiente objetivo', 'Next target'),
  dash: tx('Rodar', 'Roll'),
  loot: tx('Juntar lo más cercano', 'Pick up nearest'),
  inventory: tx('Inventario', 'Inventory'),
  character: tx('Personaje', 'Character'),
  map: tx('Mapa', 'Map'),
  party: 'Party',
  help: tx('Ayuda', 'Help'),
  settings: tx('Opciones', 'Options'),
  camLeft: tx('Girar cámara a la izquierda', 'Rotate camera left'),
  camRight: tx('Girar cámara a la derecha', 'Rotate camera right'),
  ...(Object.fromEntries(SLOT_N.map((n) => [`slot${n}`, tx(`Barra de habilidades: casillero ${n}`, `Skill bar: slot ${n}`)])) as Record<SlotAction, string>),
};
export type Action = keyof typeof ACTIONS;
/** keys as KeyboardEvent.key, lower-cased (' ' is the space bar) */
export const DEFAULT_KEYS: Record<Action, string> = {
  attack: ' ', stop: 's', nextTarget: 'tab', dash: 'shift', loot: 'z', inventory: 'i', character: 'c', map: 'm', party: 'p', help: 'h', settings: 'o', camLeft: 'q', camRight: 'e',
  ...(Object.fromEntries(SLOT_N.map((n) => [`slot${n}`, String(n % 10)])) as Record<SlotAction, string>),
};
export const keyLabel = (k: string) => (k === ' ' ? tx('Espacio', 'Space') : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1));

export interface Settings {
  preset: Preset;
  // graphics
  renderScale: number; // multiplier on the (capped) device pixel ratio
  antialias: boolean; // MSAA (on the post-processing target when FX are on)
  shadows: ShadowQ;
  viewDistance: number; // fog end / camera far, world units
  fpsCap: number; // 0 = unlimited
  showFps: boolean;
  foliage: boolean;
  // post-processing shaders
  look: LookPreset;
  toneMapping: boolean; // ACES filmic
  exposure: number;
  warmth: number; // -1 cold .. +1 warm
  sharpen: number;
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
  // gameplay
  autoLoot: boolean;
  volume: number;
  music: number; // background music + ambience
  keys: Record<Action, string>;
}

type GraphicsKeys = 'renderScale' | 'antialias' | 'shadows' | 'viewDistance' | 'ao' | 'fxaa' | 'foliage';

export const PRESETS: Record<Exclude<Preset, 'custom'>, Pick<Settings, GraphicsKeys>> = {
  low: { renderScale: 0.75, antialias: false, shadows: 'off', viewDistance: 220, ao: false, fxaa: false, foliage: false },
  medium: { renderScale: 1, antialias: false, shadows: 'low', viewDistance: 320, ao: false, fxaa: true, foliage: true },
  high: { renderScale: 1, antialias: true, shadows: 'medium', viewDistance: 420, ao: false, fxaa: false, foliage: true },
  ultra: { renderScale: 1.25, antialias: true, shadows: 'high', viewDistance: 600, ao: true, fxaa: false, foliage: true },
};

type LookKeys = 'bloom' | 'bloomStrength' | 'colorGrade' | 'saturation' | 'contrast' | 'vignette' | 'toneMapping' | 'exposure' | 'warmth' | 'sharpen';

/** Visual styles: a bundle of shader values. */
export const LOOKS: Record<Exclude<LookPreset, 'custom'>, { name: string; desc: string; v: Pick<Settings, LookKeys> }> = {
  off: { name: tx('Sin efectos', 'No effects'), desc: tx('Colores crudos, sin post-procesado.', 'Raw colors, no post-processing.'),
    v: { bloom: false, bloomStrength: 0.35, colorGrade: false, saturation: 1, contrast: 1, vignette: 0, toneMapping: false, exposure: 1, warmth: 0, sharpen: 0 } },
  natural: { name: 'Natural', desc: tx('Tone mapping cinematográfico, brillo suave y un toque de nitidez.', 'Cinematic tone mapping, soft glow and a touch of sharpening.'),
    v: { bloom: true, bloomStrength: 0.25, colorGrade: true, saturation: 1.08, contrast: 1.04, vignette: 0.2, toneMapping: true, exposure: 1.15, warmth: 0.05, sharpen: 0.25 } },
  vivid: { name: tx('Vívido', 'Vivid'), desc: tx('Colores saturados y bordes bien nítidos.', 'Saturated colors and crisp edges.'),
    v: { bloom: true, bloomStrength: 0.4, colorGrade: true, saturation: 1.35, contrast: 1.1, vignette: 0.25, toneMapping: true, exposure: 1.2, warmth: 0.05, sharpen: 0.4 } },
  aden: { name: tx('Aden (fantasía)', 'Aden (fantasy)'), desc: tx('Luz dorada y cálida con mucho brillo, fantasía MMO clásica.', 'Warm golden light with lots of glow, classic MMO fantasy.'),
    v: { bloom: true, bloomStrength: 0.65, colorGrade: true, saturation: 1.18, contrast: 1.08, vignette: 0.35, toneMapping: true, exposure: 1.2, warmth: 0.3, sharpen: 0.2 } },
  cinematic: { name: tx('Cine', 'Cinematic'), desc: tx('Apagado, con contraste y viñeta marcada.', 'Muted, contrasty, heavy vignette.'),
    v: { bloom: true, bloomStrength: 0.5, colorGrade: true, saturation: 0.85, contrast: 1.18, vignette: 0.6, toneMapping: true, exposure: 1.05, warmth: 0.12, sharpen: 0.15 } },
  noir: { name: 'Noir', desc: tx('Blanco y negro.', 'Black and white.'),
    v: { bloom: true, bloomStrength: 0.3, colorGrade: true, saturation: 0, contrast: 1.3, vignette: 0.65, toneMapping: true, exposure: 1.1, warmth: 0, sharpen: 0.3 } },
};

export const DEFAULTS: Settings = {
  preset: 'high',
  ...PRESETS.high,
  fpsCap: 0,
  showFps: false,
  look: 'natural',
  ...LOOKS.natural.v,
  uiScale: 1,
  nameplates: true,
  hpBars: true,
  damageNumbers: true,
  minimap: true,
  chatOpacity: 0.82,
  camSensitivity: 1,
  screenShake: true,
  invertY: false,
  autoLoot: false,
  volume: 0.5,
  music: 0.35,
  keys: DEFAULT_KEYS,
};

const KEY = 'settings:v2';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      // actions added after these settings were saved keep their default key
      return { ...DEFAULTS, ...saved, keys: { ...DEFAULT_KEYS, ...saved.keys } };
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  // first run: weaker devices start on medium
  const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || /Mobi|Android/i.test(navigator.userAgent);
  return weak ? { ...DEFAULTS, preset: 'medium', ...PRESETS.medium, look: 'off', ...LOOKS.off.v } : { ...DEFAULTS };
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
    if (!('look' in patch) && changed.some((k) => k in LOOKS.off.v)) patch = { ...patch, look: 'custom' };
    if (patch.preset && patch.preset !== 'custom' && patch.preset !== this.s.preset) patch = { ...patch, ...PRESETS[patch.preset] };
    if (patch.look && patch.look !== 'custom' && patch.look !== this.s.look) patch = { ...patch, ...LOOKS[patch.look].v };
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
