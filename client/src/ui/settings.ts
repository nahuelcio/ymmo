import { ACTIONS, keyLabel, LOOKS, settings, type Action, type LookPreset, type Preset, type Settings, type ShadowQ } from '../settings';
import { el, Win } from './dom';
import { LANGS } from '../../../shared/src/i18n';
import { lang, setLang, t as tx } from '../lang';

type Opt<T> = [T, string];

/** Settings window: graphics, post-processing shaders, HUD and camera. */
export class SettingsPanel {
  win: Win;
  private tab = 'graphics';
  private tabs: HTMLDivElement;
  private body: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.win = new Win('settings', tx('Opciones', 'Options'), 260, 60, 440, root);
    this.tabs = el('div', 'set-tabs', this.win.body);
    this.body = el('div', 'set-body', this.win.body);
    const foot = el('div', 'row set-foot', this.win.body);
    const reset = el('button', 'btn small', foot, tx('Restaurar valores', 'Reset to defaults'));
    reset.onclick = () => settings.reset();
    this.win.onShow = () => this.render();
    settings.on(() => this.win.visible && this.render());
  }

  private render() {
    const s = settings.s;
    this.tabs.innerHTML = '';
    for (const [id, label] of [['graphics', tx('Gráficos', 'Graphics')], ['atmos', tx('Ambiente', 'Atmosphere')], ['shaders', 'Shaders'], ['hud', tx('Juego e interfaz', 'Game & UI')], ['camera', tx('Cámara', 'Camera')], ['keys', tx('Controles', 'Controls')]]) {
      const b = el('button', `chat-tab${id === this.tab ? ' active' : ''}`, this.tabs, label);
      b.onclick = () => {
        this.tab = id;
        this.render();
      };
    }
    const b = this.body;
    b.innerHTML = '';
    if (this.tab === 'graphics') {
      this.select<Preset>(tx('Calidad', 'Quality'), 'preset', [['low', tx('Baja', 'Low')], ['medium', tx('Media', 'Medium')], ['high', tx('Alta', 'High')], ['ultra', 'Ultra'], ['custom', tx('Personalizada', 'Custom')]]);
      this.range(tx('Escala de resolución', 'Render scale'), 'renderScale', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.select<ShadowQ>(tx('Sombras', 'Shadows'), 'shadows', [['off', tx('No', 'Off')], ['low', tx('Bajas', 'Low')], ['medium', tx('Medias', 'Medium')], ['high', tx('Altas (suaves)', 'High (soft)')]]);
      this.range(tx('Distancia de visión', 'View distance'), 'viewDistance', 150, 700, 10, (v) => `${v} m`);
      this.check('Antialiasing (MSAA)', 'antialias');
      this.check(tx('Pasto y flores', 'Grass and flowers'), 'foliage');
      this.select<number>(tx('Límite de FPS', 'FPS cap'), 'fpsCap', [[0, tx('Sin límite', 'Unlimited')], [30, '30'], [60, '60'], [120, '120'], [144, '144']]);
      this.check(tx('Mostrar FPS', 'Show FPS'), 'showFps');
    } else if (this.tab === 'atmos') {
      this.check(tx('Ciclo de día y noche (16 min de día, 4 de noche; igual para todos)', 'Day and night cycle (16 min of day, 4 of night; the same for everyone)'), 'dayNight');
      this.range(tx('Brillo de la noche', 'Night brightness'), 'nightBrightness', 0.3, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.check(tx('Agua con olas y reflejos', 'Water with ripples and reflections'), 'fancyWater');
      this.check(tx('Viento en el pasto y los árboles', 'Wind in the grass and trees'), 'wind');
      this.check(tx('Rayos de luz del sol', 'Sun light shafts'), 'godRays');
      this.check(tx('Luz de faroles, fogatas y la fragua', 'Light from lamps, campfires and the forge'), 'localLights');
      this.check(tx('Polvo en el aire y luciérnagas', 'Dust in the air and fireflies'), 'particles');
      this.check(tx('Sombras de borde suave', 'Soft-edged shadows'), 'softShadows');
      this.select<number>(tx('Alcance de las sombras', 'Shadow range'), 'shadowRange', [[60, tx('Corto', 'Short')], [90, tx('Medio', 'Medium')], [140, tx('Largo', 'Long')]]);
      this.check(tx('Desenfoque de maqueta (arriba y abajo)', 'Miniature blur (top and bottom)'), 'tiltShift');
      el('div', 'hint set-hint', b, tx('Los más pesados son el agua, los rayos de luz y las luces. Las sombras se activan en Gráficos.',
        'The heavy ones are water, light shafts and lights. Shadows are turned on under Graphics.'));
    } else if (this.tab === 'shaders') {
      this.lookCards();
      this.check(tx('Tone mapping cinematográfico (ACES)', 'Cinematic tone mapping (ACES)'), 'toneMapping');
      if (s.toneMapping) this.range(tx('Exposición', 'Exposure'), 'exposure', 0.6, 1.8, 0.05, (v) => v.toFixed(2));
      this.check(tx('Bloom (brillo en zonas claras)', 'Bloom (glow on bright areas)'), 'bloom');
      if (s.bloom) this.range(tx('Intensidad del bloom', 'Bloom intensity'), 'bloomStrength', 0, 1.5, 0.05, (v) => v.toFixed(2));
      this.check(tx('Oclusión ambiental (GTAO, pesada)', 'Ambient occlusion (GTAO, heavy)'), 'ao');
      this.check(tx('FXAA (antialiasing liviano)', 'FXAA (light antialiasing)'), 'fxaa');
      this.check(tx('Corrección de color', 'Color grading'), 'colorGrade');
      if (s.colorGrade) {
        this.range(tx('Saturación', 'Saturation'), 'saturation', 0, 2, 0.05, (v) => v.toFixed(2));
        this.range(tx('Contraste', 'Contrast'), 'contrast', 0.5, 1.5, 0.05, (v) => v.toFixed(2));
        this.range(tx('Viñeta', 'Vignette'), 'vignette', 0, 1, 0.05, (v) => v.toFixed(2));
        this.range(tx('Temperatura', 'Warmth'), 'warmth', -1, 1, 0.05, (v) => (v > 0 ? '+' : '') + v.toFixed(2));
        this.range(tx('Nitidez', 'Sharpness'), 'sharpen', 0, 1, 0.05, (v) => v.toFixed(2));
      }
      el('div', 'tt-dim set-hint', b, tx('El post-procesado solo corre si hay al menos un shader (o MSAA) activado.', 'Post-processing only runs when at least one shader (or MSAA) is on.'));
    } else if (this.tab === 'hud') {
      const r = this.row(tx('Idioma', 'Language'));
      const sel = el('select', 'set-select', r);
      for (const l of LANGS) {
        const o = el('option', '', sel, l.label);
        o.value = l.id;
        o.selected = l.id === lang;
      }
      sel.onchange = () => setLang(sel.value as typeof lang);
      this.range(tx('Volumen de efectos', 'Effects volume'), 'volume', 0, 1, 0.05, (v) => (v ? `${Math.round(v * 100)}%` : tx('Mudo', 'Muted')));
      this.range(tx('Volumen de música y ambiente', 'Music & ambience volume'), 'music', 0, 1, 0.05, (v) => (v ? `${Math.round(v * 100)}%` : tx('Mudo', 'Muted')));
      this.check(tx('Auto-loot (el botín va directo al inventario)', 'Auto-loot (loot goes straight to your bag)'), 'autoLoot');
      this.range(tx('Tamaño de la interfaz', 'UI scale'), 'uiScale', 0.7, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
      this.check(tx('Nombres sobre los personajes', 'Names above characters'), 'nameplates');
      this.check(tx('Barras de vida bajo los nombres', 'Health bars under names'), 'hpBars');
      this.check(tx('Números de daño', 'Damage numbers'), 'damageNumbers');
      this.check(tx('Minimapa', 'Minimap'), 'minimap');
      this.range(tx('Opacidad del fondo del chat', 'Chat background opacity'), 'chatOpacity', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    } else if (this.tab === 'keys') this.keys();
    else {
      this.range(tx('Sensibilidad al girar', 'Rotation sensitivity'), 'camSensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2));
      this.check(tx('Invertir giro vertical', 'Invert vertical rotation'), 'invertY');
      this.check(tx('Sacudida de pantalla al pegar', 'Screen shake on hit'), 'screenShake');
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
    if (settings.s.look === 'custom') el('div', 'tt-dim set-hint', this.body, tx('Look personalizado (tocaste los valores de abajo).', 'Custom look (you tweaked the values below).'));
  }

  /** One row per action; click its key, then press the new one (Esc cancels). A key already in use swaps. */
  private keys() {
    for (const a of Object.keys(ACTIONS) as Action[]) {
      const r = this.row(ACTIONS[a]);
      const b = el('button', 'btn small set-key', r, keyLabel(settings.s.keys[a]));
      b.onclick = (ev) => {
        ev.preventDefault();
        b.textContent = tx('Apretá una tecla…', 'Press a key…');
        b.classList.add('primary');
        const grab = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          removeEventListener('keydown', grab, true);
          const k = e.key.toLowerCase();
          const fixed = k === 'escape' || k === 'enter' || /^(f\d+|arrow.*|control|alt|meta)$/.test(k);
          if (fixed) return this.render();
          const keys = { ...settings.s.keys };
          const other = (Object.keys(keys) as Action[]).find((x) => keys[x] === k);
          if (other) keys[other] = keys[a];
          keys[a] = k;
          settings.set({ keys });
          this.render();
        };
        addEventListener('keydown', grab, true);
      };
    }
    el('div', 'hint set-hint', this.body, tx('Fijas: F1-F10 también usan la barra de habilidades, Enter abre el chat, Esc cierra y las flechas mueven la cámara. Se guarda en este navegador.',
      'Fixed: F1-F10 also use the skill bar, Enter opens chat, Esc closes and the arrows move the camera. Saved in this browser.'));
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
