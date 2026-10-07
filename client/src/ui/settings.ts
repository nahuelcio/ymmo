import { LOOKS, settings, type LookPreset, type Preset, type Settings, type ShadowQ } from '../settings';
import { el, Win } from './dom';

type Opt<T> = [T, string];

/** Settings window: graphics, post-processing shaders, HUD and camera. */
export class SettingsPanel {
  win: Win;
  private tab = 'graphics';
  private tabs: HTMLDivElement;
  private body: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.win = new Win('settings', 'Opciones', 260, 60, 440, root);
    this.tabs = el('div', 'set-tabs', this.win.body);
    this.body = el('div', 'set-body', this.win.body);
    const foot = el('div', 'row set-foot', this.win.body);
    const reset = el('button', 'btn small', foot, 'Restaurar valores');
    reset.onclick = () => settings.reset();
    this.win.onShow = () => this.render();
    settings.on(() => this.win.visible && this.render());
  }

  private render() {
    const s = settings.s;
    this.tabs.innerHTML = '';
    for (const [id, label] of [['graphics', 'Gráficos'], ['shaders', 'Shaders'], ['hud', 'Juego e interfaz'], ['camera', 'Cámara']]) {
      const b = el('button', `chat-tab${id === this.tab ? ' active' : ''}`, this.tabs, label);
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
    }
    const b = this.body;
    b.innerHTML = '';
    if (this.tab === 'graphics') {
      this.select<Preset>('Calidad', 'preset', [['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta'], ['ultra', 'Ultra'], ['custom', 'Personalizada']]);
      this.range('Escala de resolución', 'renderScale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.select<ShadowQ>('Sombras', 'shadows', [['off', 'No'], ['low', 'Bajas'], ['medium', 'Medias'], ['high', 'Altas (suaves)']]);
      this.range('Distancia de visión', 'viewDistance', 150, 700, 10, (v) => `${v} m`);
      this.check('Antialiasing (MSAA)', 'antialias');
      this.select<number>('Límite de FPS', 'fpsCap', [[0, 'Sin límite'], [30, '30'], [60, '60'], [120, '120'], [144, '144']]);
      this.check('Mostrar FPS', 'showFps');
    } else if (this.tab === 'shaders') {
      this.lookCards();
      this.check('Tone mapping cinematográfico (ACES)', 'toneMapping');
      if (s.toneMapping) this.range('Exposición', 'exposure', 0.6, 1.8, 0.05, (v) => v.toFixed(2));
      this.check('Bloom (brillo en zonas claras)', 'bloom');
      if (s.bloom) this.range('Intensidad del bloom', 'bloomStrength', 0, 1.5, 0.05, (v) => v.toFixed(2));
      this.check('Oclusión ambiental (GTAO, pesada)', 'ao');
      this.check('FXAA (antialiasing liviano)', 'fxaa');
      this.check('Corrección de color', 'colorGrade');
      if (s.colorGrade) {
        this.range('Saturación', 'saturation', 0, 2, 0.05, (v) => v.toFixed(2));
        this.range('Contraste', 'contrast', 0.5, 1.5, 0.05, (v) => v.toFixed(2));
        this.range('Viñeta', 'vignette', 0, 1, 0.05, (v) => v.toFixed(2));
        this.range('Temperatura', 'warmth', -1, 1, 0.05, (v) => (v > 0 ? '+' : '') + v.toFixed(2));
        this.range('Nitidez', 'sharpen', 0, 1, 0.05, (v) => v.toFixed(2));
      }
      el('div', 'tt-dim set-hint', b, 'El post-procesado solo corre si hay al menos un shader (o MSAA) activado.');
    } else if (this.tab === 'hud') {
      this.range('Volumen de efectos', 'volume', 0, 1, 0.05, (v) => (v ? `${Math.round(v * 100)}%` : 'Mudo'));
      this.check('Auto-loot (el botín va directo al inventario)', 'autoLoot');
      this.range('Tamaño de la interfaz', 'uiScale', 0.7, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.check('Nombres sobre los personajes', 'nameplates');
      this.check('Barras de vida bajo los nombres', 'hpBars');
      this.check('Números de daño', 'damageNumbers');
      this.check('Minimapa', 'minimap');
      this.range('Opacidad del fondo del chat', 'chatOpacity', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    } else {
      this.range('Sensibilidad al girar', 'camSensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2));
      this.check('Invertir giro vertical', 'invertY');
      this.check('Sacudida de pantalla al pegar', 'screenShake');
    }
  }

  /** One-click visual styles. */
  private lookCards() {
    const wrap = el('div', 'look-cards', this.body);
    for (const [id, l] of Object.entries(LOOKS) as [Exclude<LookPreset, 'custom'>, (typeof LOOKS)['off']][]) {
      const c = el('button', `look-card look-${id}${settings.s.look === id ? ' sel' : ''}`, wrap);
      el('b', '', c, l.name);
      el('span', '', c, l.desc);
      c.onclick = () => settings.set({ look: id });
    }
    if (settings.s.look === 'custom') el('div', 'tt-dim set-hint', this.body, 'Look personalizado (tocaste los valores de abajo).');
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
