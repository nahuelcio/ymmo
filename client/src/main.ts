/// <reference types="vite/client" />
import './style.css';
import { CLASSES, RACES, type ClassType, type Race } from '../../shared/src/data/classes';
import type { CharSummary } from '../../shared/src/protocol';
import { Game } from './game';
import { Net } from './net';
import { el } from './ui/dom';

const screens = document.getElementById('screens')!;
const net = new Net();
let inGame = false;

function screen(): HTMLDivElement {
  screens.innerHTML = '';
  screens.style.display = '';
  const wrap = el('div', 'screen', screens);
  const logo = el('div', 'logo', wrap);
  el('div', 'logo-title', logo, 'CLAUDI');
  el('div', 'logo-sub', logo, 'Chronicle I · Dawn of Aden');
  return el('div', 'screen-box panel', wrap);
}

function errorLine(box: HTMLElement) {
  const e = el('div', 'form-error', box);
  return (msg: string) => (e.textContent = msg);
}

let showError: (m: string) => void = () => {};

function loginScreen() {
  const box = screen();
  el('h2', '', box, 'Login');
  const user = el('input', 'field', box);
  user.placeholder = 'Account';
  user.autocomplete = 'username';
  const pass = el('input', 'field', box);
  pass.placeholder = 'Password';
  pass.type = 'password';
  pass.autocomplete = 'current-password';
  try {
    user.value = localStorage.getItem('lastUser') ?? '';
  } catch {
    /* ignore */
  }
  const row = el('div', 'row', box);
  const login = el('button', 'btn primary', row, 'Login');
  const reg = el('button', 'btn', row, 'Create account');
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
  el('div', 'hint', box, 'New here? Type an account name and password, then "Create account".');
}

function charScreen(list: CharSummary[]) {
  const box = screen();
  box.classList.add('wide');
  el('h2', '', box, 'Select your character');
  const cols = el('div', 'char-cols', box);
  const left = el('div', 'char-list', cols);
  let selected = list[0]?.id ?? null;
  const renderList = () => {
    left.innerHTML = '';
    if (!list.length) el('div', 'tt-dim', left, 'No characters yet. Create one →');
    for (const c of list) {
      const card = el('div', `char-card${c.id === selected ? ' sel' : ''}`, left);
      card.innerHTML = `<b></b><br><span class="tt-dim">Lv ${c.level} ${RACES[c.race].name} ${CLASSES[c.cls].name}</span>`;
      card.querySelector('b')!.textContent = c.name;
      card.onclick = () => {
        selected = c.id;
        renderList();
      };
      card.ondblclick = () => net.send({ t: 'enter', id: c.id });
    }
    const row = el('div', 'row', left);
    const enter = el('button', 'btn primary', row, 'Enter world');
    enter.disabled = selected === null;
    enter.onclick = () => selected !== null && net.send({ t: 'enter', id: selected });
    const del = el('button', 'btn danger', row, 'Delete');
    del.disabled = selected === null;
    del.onclick = () => {
      const c = list.find((x) => x.id === selected);
      if (c && confirm(`Delete ${c.name} forever?`)) net.send({ t: 'deleteChar', id: c.id });
    };
  };
  renderList();

  const right = el('div', 'char-create', cols);
  el('h3', '', right, 'Create a new character');
  const name = el('input', 'field', right);
  name.placeholder = 'Name';
  name.maxLength = 16;
  const races = el('div', 'pick', right);
  const classes = el('div', 'pick', right);
  const desc = el('div', 'tt-dim race-desc', right);
  let race: Race = 'human', cls: ClassType = 'fighter';
  const renderPick = () => {
    races.innerHTML = '';
    for (const r of Object.keys(RACES) as Race[]) {
      const b = el('button', `pick-btn${r === race ? ' sel' : ''}`, races, RACES[r].name);
      b.onclick = () => {
        race = r;
        if (!RACES[r].classes.includes(cls)) cls = 'fighter';
        renderPick();
      };
    }
    classes.innerHTML = '';
    for (const c of ['fighter', 'mystic'] as ClassType[]) {
      const b = el('button', `pick-btn${c === cls ? ' sel' : ''}`, classes, CLASSES[c].name);
      b.disabled = !RACES[race].classes.includes(c);
      b.onclick = () => {
        cls = c;
        renderPick();
      };
    }
    desc.textContent = `${RACES[race].desc} ${cls === 'fighter' ? 'Fighters excel in melee combat with powerful strikes.' : 'Mystics wield magic: ranged spells, healing and buffs.'}`;
  };
  renderPick();
  const create = el('button', 'btn primary', right, 'Create');
  create.onclick = () => net.send({ t: 'createChar', name: name.value.trim(), race, cls });
  showError = errorLine(box);
}

async function boot() {
  const box = screen();
  el('div', 'tt-dim', box, 'Connecting to the server...');
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
    d.innerHTML = '<div class="panel"><b>Disconnected from the server.</b><br><br></div>';
    const b = el('button', 'btn primary', d.firstElementChild as HTMLElement, 'Reconnect');
    b.onclick = () => location.reload();
  };
  net.on('error', (m) => {
    if (!inGame) showError(m.msg);
  });
  net.on('chars', (m) => charScreen(m.list));
  net.on('enter', (m) => {
    if (inGame) return;
    inGame = true;
    screens.innerHTML = '';
    screens.style.display = 'none';
    const game = new Game(net, m);
    if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
  });
  loginScreen();
}

boot();
