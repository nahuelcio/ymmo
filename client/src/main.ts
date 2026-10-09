/// <reference types="vite/client" />
import './style.css';
import * as THREE from 'three';
import {
  CLASSES, GENDERS, HAIR_COLORS, HAIR_STYLES, RACES, statMods, type ClassType, type Gender, type Look, type Race,
} from '../../shared/src/data/classes';
import { allSkillsFor } from '../../shared/src/data/skills';
import { className, genderDesc, genderName, hairStyle, LANGS, raceDesc, raceName, skillDesc, skillName } from '../../shared/src/i18n';
import { lang, setLang, t } from './lang';
import { animate, playerModel } from './render/models';
import { loadQ, mountQuaterniusPreview } from './render/quaternius';
import { loadV } from './render/village';
import type { CharSummary } from '../../shared/src/protocol';
import { Game } from './game';
import { Net } from './net';
import { el } from './ui/dom';
import { glyph } from './ui/common';

const screens = document.getElementById('screens')!;
const net = new Net();
let inGame = false;

// Per-tab memory of who is playing, so a dropped connection can walk straight back into the world.
const tab = {
  get(k: string): string | null {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

function enterWorld(id: number) {
  tab.set('char', String(id));
  net.send({ t: 'enter', id });
}

/**
 * The connection dropped: keep knocking until the server answers, then reload. With a saved session
 * the reload resumes it and, if we were in the world, re-enters with the same character.
 * ponytail: reloads the page instead of rebuilding the game in place; fine while loading takes a second.
 */
function reconnect() {
  const d = el('div', 'disconnected', document.body);
  const box = el('div', 'panel', d);
  const msg = el('b', '', box, t('Se perdió la conexión. Reconectando…', 'Connection lost. Reconnecting…'));
  el('br', '', box);
  el('br', '', box);
  // re-enter the world after the reload, unless we already did so moments ago (two tabs fighting
  // over one account would otherwise kick each other forever)
  const again = Date.now() - Number(tab.get('rejoinAt') ?? 0) < 20000;
  if (inGame && !again) tab.set('rejoin', tab.get('char'));
  let tries = 0, timer = 0;
  const knock = () => {
    clearTimeout(timer);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const probe = new WebSocket(`${proto}://${location.host}/ws`);
    probe.onopen = () => location.reload();
    probe.onerror = () => {
      tries++;
      msg.textContent = t(`Se perdió la conexión. Reintentando… (${tries})`, `Connection lost. Retrying… (${tries})`);
      timer = window.setTimeout(knock, Math.min(5000, 1000 * tries));
    };
  };
  el('button', 'btn primary', box, t('Reintentar ahora', 'Retry now')).onclick = knock;
  timer = window.setTimeout(knock, 800);
}

/** Disposer for whatever the current screen owns (e.g. the 3D preview). */
let cleanup: (() => void) | null = null;

function screen(): HTMLDivElement {
  cleanup?.();
  cleanup = null;
  screens.innerHTML = '';
  screens.style.display = '';
  const wrap = el('div', 'screen', screens);
  // language picker (reloads the page in the chosen language): first in the column, so it scrolls with the screen
  const lp = el('div', 'lang-pick', wrap);
  for (const L of LANGS) {
    const b = el('button', `lang-btn${L.id === lang ? ' sel' : ''}`, lp, L.label);
    b.onclick = () => setLang(L.id);
  }
  const logo = el('div', 'logo', wrap);
  el('div', 'logo-title', logo, 'CLAUDI');
  el('div', 'logo-sub', logo, t('Crónica I · El Alba de Aden', 'Chronicle I · Dawn of Aden'));
  return el('div', 'screen-box panel', wrap);
}

function errorLine(box: HTMLElement) {
  const e = el('div', 'form-error', box);
  return (msg: string) => (e.textContent = msg);
}

let showError: (m: string) => void = () => {};

/** localStorage that never throws (private mode, blocked storage). */
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

function loginScreen() {
  const box = screen();
  el('h2', '', box, t('Ingresar', 'Login'));
  const user = el('input', 'field', box);
  user.placeholder = t('Cuenta', 'Account');
  user.autocomplete = 'username';
  const pass = el('input', 'field', box);
  pass.placeholder = t('Contraseña', 'Password');
  pass.type = 'password';
  pass.autocomplete = 'current-password';
  try {
    user.value = localStorage.getItem('lastUser') ?? '';
  } catch {
    /* ignore */
  }
  const rem = el('label', 'remember', box);
  const remBox = el('input', '', rem);
  remBox.type = 'checkbox';
  remBox.checked = store.get('remember') !== '0';
  el('span', '', rem, t('Recordarme en este dispositivo', 'Remember me on this device'));
  const row = el('div', 'row', box);
  const login = el('button', 'btn primary', row, t('Entrar', 'Login'));
  const reg = el('button', 'btn', row, t('Crear cuenta', 'Create account'));
  showError = errorLine(box);
  const go = (register: boolean) => {
    try {
      localStorage.setItem('lastUser', user.value.trim());
    } catch {
      /* ignore */
    }
    store.set('remember', remBox.checked ? '1' : '0');
    net.send({ t: 'login', user: user.value.trim(), pass: pass.value, register, remember: remBox.checked });
  };
  login.onclick = () => go(false);
  reg.onclick = () => go(true);
  pass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(false);
  });
  user.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pass.focus();
  });
  (user.value ? pass : user).focus();
  el('div', 'hint', box, t('¿Primera vez? Elegí un nombre de cuenta y una contraseña, y tocá "Crear cuenta".', 'New here? Type an account name and password, then "Create account".'));
}

function charScreen(list: CharSummary[]) {
  const box = screen();
  box.classList.add('wide');
  el('h2', '', box, t('Elegí tu personaje', 'Select your character'));
  const cols = el('div', 'char-cols', box);
  const left = el('div', 'char-list', cols);
  let selected = list[0]?.id ?? null;
  const renderList = () => {
    left.innerHTML = '';
    if (!list.length) el('div', 'tt-dim', left, t('Todavía no tenés personajes. Creá uno →', 'No characters yet. Create one →'));
    for (const c of list) {
      const card = el('div', `char-card${c.id === selected ? ' sel' : ''}`, left);
      card.innerHTML = `<b></b><br><span class="tt-dim">${t('Nv', 'Lv')} ${c.level} ${genderName(c.look.g, lang)} ${raceName(c.race, lang)} ${className(c.cls, lang, c.spec)}</span>`;
      card.querySelector('b')!.textContent = c.name;
      card.onclick = () => {
        selected = c.id;
        renderList();
      };
      card.ondblclick = () => enterWorld(c.id);
    }
    const row = el('div', 'row', left);
    const enter = el('button', 'btn primary', row, t('Entrar al mundo', 'Enter world'));
    enter.disabled = selected === null;
    enter.onclick = () => selected !== null && enterWorld(selected);
    const del = el('button', 'btn danger', row, t('Borrar', 'Delete'));
    del.disabled = selected === null;
    del.onclick = () => {
      const c = list.find((x) => x.id === selected);
      if (c && confirm(t(`¿Borrar a ${c.name} para siempre?`, `Delete ${c.name} forever?`))) net.send({ t: 'deleteChar', id: c.id });
    };
    const out = el('button', 'btn', row, t('Cerrar sesión', 'Log out'));
    out.onclick = () => {
      const tok = store.get('session');
      if (tok) net.send({ t: 'logout', token: tok });
      store.set('session', null);
      loginScreen();
    };
  };
  renderList();

  const right = el('div', 'char-create', cols);
  el('h3', '', right, t('Crear un personaje nuevo', 'Create a new character'));
  const nameRow = el('div', 'name-row', right);
  const name = el('input', 'field', nameRow);
  name.placeholder = t('Nombre', 'Name');
  name.maxLength = 16;
  const create = el('button', 'btn primary', nameRow, t('Crear', 'Create'));
  const studio = el('div', 'studio', right);
  const preview = el('div', 'char-preview', studio);
  const opts = el('div', 'studio-opts', studio);
  const label = (t: string) => el('div', 'pick-label', opts, t);
  label(t('Raza', 'Race'));
  const races = el('div', 'pick', opts);
  label(t('Clase', 'Class'));
  const classes = el('div', 'pick', opts);
  label(t('Género', 'Gender'));
  const genders = el('div', 'pick', opts);
  label(t('Pelo', 'Hair'));
  const styles = el('div', 'pick', opts);
  const colors = el('div', 'pick swatches', opts);
  const desc = el('div', 'tt-dim race-desc', right);
  const diff = el('div', 'char-diff', right);
  let race: Race = 'human', cls: ClassType = 'fighter';
  const look: Look = { g: 'm', hs: 0, hc: 0 };
  const stopPreview = previewRenderer(preview, () => ({ race, cls, look }));

  const pickRow = <T,>(host: HTMLElement, items: [T, string][], cur: T, set: (v: T) => void, enabled: (v: T) => boolean = () => true) => {
    host.innerHTML = '';
    for (const [v, text] of items) {
      const b = el('button', `pick-btn${v === cur ? ' sel' : ''}`, host, text);
      b.disabled = !enabled(v);
      b.onclick = () => {
        set(v);
        renderPick();
      };
    }
  };
  const renderPick = () => {
    pickRow(races, (Object.keys(RACES) as Race[]).map((r) => [r, raceName(r, lang)]), race, (r) => {
      race = r;
      if (!RACES[r].classes.includes(cls)) cls = 'fighter';
    });
    pickRow(classes, (['fighter', 'mystic'] as ClassType[]).map((c) => [c, className(c, lang)]), cls, (c) => (cls = c), (c) => RACES[race].classes.includes(c));
    pickRow(genders, (['m', 'f'] as Gender[]).map((g) => [g, genderName(g, lang)]), look.g, (g) => (look.g = g));
    pickRow(styles, HAIR_STYLES.map((_, i) => [i, hairStyle(i, lang)]), look.hs, (i) => (look.hs = i));
    colors.innerHTML = '';
    HAIR_COLORS.forEach((c, i) => {
      const sw = el('button', `swatch${i === look.hc ? ' sel' : ''}`, colors);
      const hex = c >= 0 ? c : RACES[race].hair;
      sw.style.background = `#${hex.toString(16).padStart(6, '0')}`;
      sw.title = i === 0 ? t('Natural', 'Natural') : '';
      sw.onclick = () => {
        look.hc = i;
        renderPick();
      };
    });
    desc.textContent = `${raceDesc(race, lang)} ${genderDesc(look.g, lang)} ${cls === 'fighter' ? t('El guerrero se luce cuerpo a cuerpo, con golpes potentes.', 'Fighters excel in melee combat with powerful strikes.') : t('El místico usa magia: hechizos a distancia, curas y buffs.', 'Mystics wield magic: ranged spells, healing and buffs.')}`;
    renderDiff(diff, race, cls, look.g);
  };
  renderPick();
  create.onclick = () => net.send({ t: 'createChar', name: name.value.trim(), race, cls, look });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create.click();
  });
  cleanup = stopPreview;
  showError = errorLine(right);
  right.insertBefore(right.lastElementChild!, studio);
}

/** Stat differences of race × gender vs. the baseline (Human male), plus the skills you get. */
function renderDiff(host: HTMLElement, race: Race, cls: ClassType, g: Gender) {
  const m = statMods(race, g);
  const pct = (v: number) => Math.round((v - 1) * 100);
  const rows: [string, number, string][] = [
    ['HP', pct(m.hp), '%'], ['MP', pct(m.mp), '%'], [t('Atq.F', 'P.Atk'), pct(m.pAtk), '%'], [t('Atq.M', 'M.Atk'), pct(m.mAtk), '%'],
    [t('Def.F', 'P.Def'), pct(m.pDef), '%'], [t('Def.M', 'M.Def'), pct(m.mDef), '%'], [t('Velocidad', 'Speed'), pct(m.speed), '%'], [t('Vel.Atq', 'Atk.Spd'), pct(m.atkSpd), '%'],
    [t('Vel.Lanz', 'Cast.Spd'), pct(m.castSpd), '%'], [t('Evasión', 'Evasion'), m.evasion, ''], [t('Precisión', 'Accuracy'), m.accuracy, ''], [t('Crítico', 'Critical'), m.crit, ''],
  ];
  host.innerHTML = '';
  el('div', 'section', host, t(`${raceName(race, lang)} · ${genderName(g, lang)}: stats comparados con Humano Masculino`, `${raceName(race, lang)} ${genderName(g, lang)} — stats vs. Human Male`));
  const grid = el('div', 'diff-grid', host);
  for (const [k, v, u] of rows) {
    const cell = el('div', `diff-cell${v > 0 ? ' up' : v < 0 ? ' down' : ''}`, grid);
    el('span', '', cell, k);
    el('b', '', cell, v === 0 ? '—' : `${v > 0 ? '+' : ''}${v}${u}`);
  }
  el('div', 'section', host, t('Habilidades', 'Skills'));
  const list = el('div', 'diff-skills', host);
  for (const s of allSkillsFor(cls, race, g)) {
    const tag = s.race ? raceName(s.race, lang) : s.gender ? genderName(s.gender, lang) : className(cls, lang);
    const row = el('div', `diff-skill${s.race || s.gender ? ' special' : ''}`, list);
    row.innerHTML = `<span class="ds-icon"></span><span><b></b> <span class="tt-dim">${t('Nv', 'Lv')} ${s.level} · ${tag}</span><br><span class="tt-dim ds-desc"></span></span>`;
    glyph('skill', s.id, s.icon, row.querySelector<HTMLElement>('.ds-icon')!);
    row.querySelector('b')!.textContent = skillName(s.id, lang);
    row.querySelector('.ds-desc')!.textContent = skillDesc(s.id, lang);
  }
}

/** Small rotating 3D preview of the character being created. Returns a disposer. */
function previewRenderer(host: HTMLElement, get: () => { race: Race; cls: ClassType; look: Look }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 2));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  cam.position.set(0, 1.4, 5);
  cam.lookAt(0, 1, 0);
  let key = '', model: THREE.Object3D | null = null, rig: ReturnType<typeof playerModel> | null = null;
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    const { race, cls, look } = get();
    const k = `${race}|${cls}|${look.g}|${look.hs}|${look.hc}`;
    if (k !== key) {
      key = k;
      if (model) scene.remove(model);
      const start = CLASSES[cls].startItems.filter((i) => i[2]).map((i) => i[0]);
      rig = playerModel(race, cls, start[0] ?? null, start[1] ?? null, look, [null, null, start[2] ?? null, null]);
      model = rig.root;
      scene.add(model);
    }
    const w = host.clientWidth, h = host.clientHeight;
    if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    const t = (performance.now() - t0) / 1000;
    if (model) model.rotation.y = t * 0.6;
    if (rig) animate(rig, { moving: false, atkAge: Infinity, casting: false, deadAge: -1, t });
    renderer.render(scene, cam);
  });
  return () => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
  };
}

async function boot() {
  // ?q=1: character gallery only (no server needed)
  if (new URLSearchParams(location.search).has('q')) {
    cleanup = await mountQuaterniusPreview(document.body);
    return;
  }
  const box = screen();
  el('div', 'tt-dim', box, t('Conectando con el servidor...', 'Connecting to the server...'));
  // character models download while we connect; without them players fall back to the procedural rig
  const models = Promise.all([
    loadQ().catch((err) => console.warn('quaternius', err)),
    loadV().catch((err) => console.warn('village', err)),
  ]);
  for (let attempt = 1; ; attempt++) {
    try {
      await net.connect();
      break;
    } catch (e) {
      if (attempt >= 8) {
        box.textContent = (e as Error).message;
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await models;
  net.onClose = reconnect;
  net.on('error', (m) => {
    if (!inGame) showError(m.msg);
  });
  net.on('chars', (m) => {
    if (m.token) store.set('session', m.token);
    // back from a dropped connection: straight into the world with the character we were playing
    const rejoin = Number(tab.get('rejoin'));
    tab.set('rejoin', null);
    if (rejoin && m.list.some((c) => c.id === rejoin)) {
      tab.set('rejoinAt', String(Date.now()));
      return enterWorld(rejoin);
    }
    charScreen(m.list);
  });
  net.on('resumeFail', () => {
    store.set('session', null);
    loginScreen();
  });
  net.on('enter', (m) => {
    if (inGame) return;
    inGame = true;
    cleanup?.();
    cleanup = null;
    screens.innerHTML = '';
    screens.style.display = 'none';
    const game = new Game(net, m);
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  });
  const token = store.get('session');
  if (token) net.send({ t: 'resume', token });
  else loginScreen();
}

boot();
