/// <reference types="vite/client" />
import './style.css';
import * as THREE from 'three';
import {
  CLASSES, GENDERS, HAIR_COLORS, HAIR_STYLES, RACES, statMods, type ClassType, type Gender, type Look, type Race,
} from '../../shared/src/data/classes';
import { allSkillsFor } from '../../shared/src/data/skills';
import { animate, playerModel } from './render/models';
import type { CharSummary } from '../../shared/src/protocol';
import { Game } from './game';
import { Net } from './net';
import { el } from './ui/dom';

const screens = document.getElementById('screens')!;
const net = new Net();
let inGame = false;

/** Disposer for whatever the current screen owns (e.g. the 3D preview). */
let cleanup: (() => void) | null = null;

function screen(): HTMLDivElement {
  cleanup?.();
  cleanup = null;
  screens.innerHTML = '';
  screens.style.display = '';
  const wrap = el('div', 'screen', screens);
  const logo = el('div', 'logo', wrap);
  el('div', 'logo-title', logo, 'CLAUDI');
  el('div', 'logo-sub', logo, 'Crónica I · El Alba de Aden');
  return el('div', 'screen-box panel', wrap);
}

function errorLine(box: HTMLElement) {
  const e = el('div', 'form-error', box);
  return (msg: string) => (e.textContent = msg);
}

let showError: (m: string) => void = () => {};

function loginScreen() {
  const box = screen();
  el('h2', '', box, 'Ingresar');
  const user = el('input', 'field', box);
  user.placeholder = 'Cuenta';
  user.autocomplete = 'username';
  const pass = el('input', 'field', box);
  pass.placeholder = 'Contraseña';
  pass.type = 'password';
  pass.autocomplete = 'current-password';
  try {
    user.value = localStorage.getItem('lastUser') ?? '';
  } catch {
    /* ignore */
  }
  const row = el('div', 'row', box);
  const login = el('button', 'btn primary', row, 'Entrar');
  const reg = el('button', 'btn', row, 'Crear cuenta');
  showError = errorLine(box);
  const go = (register: boolean) => {
    try {
      localStorage.setItem('lastUser', user.value.trim());
    } catch {
      /* ignore */
    }
    net.send({ t: 'login', user: user.value.trim(), pass: pass.value, register });
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
  el('div', 'hint', box, '¿Primera vez? Elegí un nombre de cuenta y una contraseña, y tocá "Crear cuenta".');
}

function charScreen(list: CharSummary[]) {
  const box = screen();
  box.classList.add('wide');
  el('h2', '', box, 'Elegí tu personaje');
  const cols = el('div', 'char-cols', box);
  const left = el('div', 'char-list', cols);
  let selected = list[0]?.id ?? null;
  const renderList = () => {
    left.innerHTML = '';
    if (!list.length) el('div', 'tt-dim', left, 'Todavía no tenés personajes. Creá uno →');
    for (const c of list) {
      const card = el('div', `char-card${c.id === selected ? ' sel' : ''}`, left);
      card.innerHTML = `<b></b><br><span class="tt-dim">Nv ${c.level} ${GENDERS[c.look.g].name} ${RACES[c.race].name} ${CLASSES[c.cls].name}</span>`;
      card.querySelector('b')!.textContent = c.name;
      card.onclick = () => {
        selected = c.id;
        renderList();
      };
      card.ondblclick = () => net.send({ t: 'enter', id: c.id });
    }
    const row = el('div', 'row', left);
    const enter = el('button', 'btn primary', row, 'Entrar al mundo');
    enter.disabled = selected === null;
    enter.onclick = () => selected !== null && net.send({ t: 'enter', id: selected });
    const del = el('button', 'btn danger', row, 'Borrar');
    del.disabled = selected === null;
    del.onclick = () => {
      const c = list.find((x) => x.id === selected);
      if (c && confirm(`¿Borrar a ${c.name} para siempre?`)) net.send({ t: 'deleteChar', id: c.id });
    };
  };
  renderList();

  const right = el('div', 'char-create', cols);
  el('h3', '', right, 'Crear un personaje nuevo');
  const nameRow = el('div', 'name-row', right);
  const name = el('input', 'field', nameRow);
  name.placeholder = 'Nombre';
  name.maxLength = 16;
  const create = el('button', 'btn primary', nameRow, 'Crear');
  const studio = el('div', 'studio', right);
  const preview = el('div', 'char-preview', studio);
  const opts = el('div', 'studio-opts', studio);
  const label = (t: string) => el('div', 'pick-label', opts, t);
  label('Raza');
  const races = el('div', 'pick', opts);
  label('Clase');
  const classes = el('div', 'pick', opts);
  label('Género');
  const genders = el('div', 'pick', opts);
  label('Pelo');
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
    pickRow(races, (Object.keys(RACES) as Race[]).map((r) => [r, RACES[r].name]), race, (r) => {
      race = r;
      if (!RACES[r].classes.includes(cls)) cls = 'fighter';
    });
    pickRow(classes, (['fighter', 'mystic'] as ClassType[]).map((c) => [c, CLASSES[c].name]), cls, (c) => (cls = c), (c) => RACES[race].classes.includes(c));
    pickRow(genders, (['m', 'f'] as Gender[]).map((g) => [g, GENDERS[g].name]), look.g, (g) => (look.g = g));
    pickRow(styles, HAIR_STYLES.map((n, i) => [i, n]), look.hs, (i) => (look.hs = i));
    colors.innerHTML = '';
    HAIR_COLORS.forEach((c, i) => {
      const sw = el('button', `swatch${i === look.hc ? ' sel' : ''}`, colors);
      const hex = c >= 0 ? c : RACES[race].hair;
      sw.style.background = `#${hex.toString(16).padStart(6, '0')}`;
      sw.title = i === 0 ? 'Natural' : '';
      sw.onclick = () => {
        look.hc = i;
        renderPick();
      };
    });
    desc.textContent = `${RACES[race].desc} ${GENDERS[look.g].desc} ${cls === 'fighter' ? 'El guerrero se luce cuerpo a cuerpo, con golpes potentes.' : 'El místico usa magia: hechizos a distancia, curas y buffs.'}`;
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
    ['HP', pct(m.hp), '%'], ['MP', pct(m.mp), '%'], ['Atq.F', pct(m.pAtk), '%'], ['Atq.M', pct(m.mAtk), '%'],
    ['Def.F', pct(m.pDef), '%'], ['Def.M', pct(m.mDef), '%'], ['Velocidad', pct(m.speed), '%'], ['Vel.Atq', pct(m.atkSpd), '%'],
    ['Vel.Lanz', pct(m.castSpd), '%'], ['Evasión', m.evasion, ''], ['Precisión', m.accuracy, ''], ['Crítico', m.crit, ''],
  ];
  host.innerHTML = '';
  el('div', 'section', host, `${RACES[race].name} · ${GENDERS[g].name}: stats comparados con Humano Masculino`);
  const grid = el('div', 'diff-grid', host);
  for (const [k, v, u] of rows) {
    const cell = el('div', `diff-cell${v > 0 ? ' up' : v < 0 ? ' down' : ''}`, grid);
    el('span', '', cell, k);
    el('b', '', cell, v === 0 ? '—' : `${v > 0 ? '+' : ''}${v}${u}`);
  }
  el('div', 'section', host, 'Habilidades');
  const list = el('div', 'diff-skills', host);
  for (const s of allSkillsFor(cls, race, g)) {
    const tag = s.race ? RACES[s.race].name : s.gender ? GENDERS[s.gender].name : CLASSES[cls].name;
    const row = el('div', `diff-skill${s.race || s.gender ? ' special' : ''}`, list);
    row.innerHTML = `<span class="ds-icon">${s.icon}</span><span><b></b> <span class="tt-dim">Nv ${s.level} · ${tag}</span><br><span class="tt-dim ds-desc"></span></span>`;
    row.querySelector('b')!.textContent = s.name;
    row.querySelector('.ds-desc')!.textContent = s.desc;
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
      rig = playerModel(race, cls, start[0] ?? null, start[1] ?? null, look);
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
  const box = screen();
  el('div', 'tt-dim', box, 'Conectando con el servidor...');
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
  net.onClose = () => {
    const d = el('div', 'disconnected', document.body);
    d.innerHTML = '<div class="panel"><b>Se perdió la conexión con el servidor.</b><br><br></div>';
    const b = el('button', 'btn primary', d.firstElementChild as HTMLElement, 'Reconectar');
    b.onclick = () => location.reload();
  };
  net.on('error', (m) => {
    if (!inGame) showError(m.msg);
  });
  net.on('chars', (m) => charScreen(m.list));
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
  loginScreen();
}

boot();
