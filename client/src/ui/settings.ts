import { settings, type Preset, type Settings, type ShadowQ } from '../settings';
import { el, Win } from './dom';

type Opt<T> = [T, string];

/** Settings window: graphics, post-processing shaders, HUD and camera. */
export class SettingsPanel {
  win: Win;
  private tab = 'graphics';
  private tabs: HTMLDivElement;
  private body: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.win = new Win('settings', 'Settings', 260, 70, 400, root);
    this.tabs = el('div', 'set-tabs', this.win.body);
    this.body = el('div', 'set-body', this.win.body);
    const foot = el('div', 'row set-foot', this.win.body);
    const reset = el('button', 'btn small', foot, 'Reset to defaults');
    reset.onclick = () => settings.reset();
    this.win.onShow = () => this.render();
    settings.on(() => this.win.visible && this.render());
  }

  private render() {
    const s = settings.s;
    this.tabs.innerHTML = '';
    for (const [id, label] of [['graphics', 'Graphics'], ['shaders', 'Shaders'], ['hud', 'HUD'], ['camera', 'Camera']]) {
      const b = el('button', `chat-tab${id === this.tab ? ' active' : ''}`, this.tabs, label);
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
    }
    const b = this.body;
    b.innerHTML = '';
    if (this.tab === 'graphics') {
      this.select<Preset>('Quality preset', 'preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']]);
      this.range('Resolution scale', 'renderScale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.select<ShadowQ>('Shadows', 'shadows', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High (soft)']]);
      this.range('View distance', 'viewDistance', 150, 700, 10, (v) => `${v} m`);
      this.check('Anti-aliasing (MSAA)', 'antialias');
      this.select<number>('FPS limit', 'fpsCap', [[0, 'Unlimited'], [30, '30'], [60, '60'], [120, '120'], [144, '144']]);
      this.check('Show FPS counter', 'showFps');
    } else if (this.tab === 'shaders') {
      this.check('Bloom (glow on bright spots)', 'bloom');
      if (s.bloom) this.range('Bloom strength', 'bloomStrength', 0, 1.5, 0.05, (v) => v.toFixed(2));
      this.check('Ambient occlusion (GTAO, heavy)', 'ao');
      this.check('FXAA (cheap anti-aliasing)', 'fxaa');
      this.check('Color grading', 'colorGrade');
      if (s.colorGrade) {
        this.range('Saturation', 'saturation', 0, 2, 0.05, (v) => v.toFixed(2));
        this.range('Contrast', 'contrast', 0.5, 1.5, 0.05, (v) => v.toFixed(2));
        this.range('Vignette', 'vignette', 0, 1, 0.05, (v) => v.toFixed(2));
      }
      el('div', 'tt-dim set-hint', b, 'Post-processing runs only while at least one shader (or MSAA) is enabled.');
    } else if (this.tab === 'hud') {
      this.range('Interface scale', 'uiScale', 0.7, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.check('Nameplates', 'nameplates');
      this.check('HP bars on nameplates', 'hpBars');
      this.check('Floating damage numbers', 'damageNumbers');
      this.check('Minimap', 'minimap');
      this.range('Chat background opacity', 'chatOpacity', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    } else {
      this.range('Rotation sensitivity', 'camSensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2));
      this.check('Invert vertical rotation', 'invertY');
      this.check('Screen shake on hits', 'screenShake');
    }
  }

  private row(label: string) {
    const r = el('label', 'set-row', this.body);
    el('span', 'set-label', r, label);
    return r;
  }

  private check(label: string, key: keyof Settings) {
    const r = this.row(label);
    const c = el('input', '', r);
    c.type = 'checkbox';
    c.checked = settings.s[key] as boolean;
    c.onchange = () => settings.set({ [key]: c.checked });
  }

  private range(label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) {
    const r = this.row(label);
    const wrap = el('span', 'set-range', r);
    const i = el('input', '', wrap);
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(settings.s[key]);
    const out = el('span', 'set-val', wrap, fmt(settings.s[key] as number));
    i.oninput = () => (out.textContent = fmt(+i.value));
    // apply on release for heavy options, live for cheap ones
    const live = key !== 'renderScale' && key !== 'viewDistance';
    if (live) i.addEventListener('input', () => settings.set({ [key]: +i.value }));
    i.onchange = () => settings.set({ [key]: +i.value });
  }

  private select<T extends string | number>(label: string, key: keyof Settings, opts: Opt<T>[]) {
    const r = this.row(label);
    const sel = el('select', 'set-select', r);
    for (const [v, text] of opts) {
      const o = el('option', '', sel, text);
      o.value = String(v);
      if (settings.s[key] === v) o.selected = true;
    }
    sel.onchange = () => {
      const v = opts.find(([x]) => String(x) === sel.value)![0];
      settings.set({ [key]: v });
    };
  }
}
