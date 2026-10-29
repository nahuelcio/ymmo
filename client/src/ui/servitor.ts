// The summoner's servitor panel (L2's servitor window): a second click on one of our servitors (game.ts clickEnt) or on
// its row in the window under the status (ui/hud.ts) opens it on that one. With more than one out, a tab each picks the
// one shown, which is the one the orders go to (game.ts pet). Its name, level, HP and MP; its orders (ui/actions.ts
// PET_ACTIONS) and its own skills (data/servitors.ts), each used with a click (a tap) and dragging onto the bars as the
// character window's do, to be used from there with the slot's key.
import { PET_SKILLS, SERVITORS } from '../../../shared/src/data/servitors';
import { servitorDesc, servitorName } from '../../../shared/src/i18n';
import type { Game } from '../game';
import { lang, t as tx } from '../lang';
import { actionIcon, actionTip, PET_ACTIONS, runAction } from './actions';
import { toBar } from './bardrag';
import { bar, skillIcon, skillTip } from './common';
import { el, esc, setTip, Win } from './dom';
import { isTouchDevice } from './touch';

export class ServitorPanel {
  win: Win;
  /** the servitors it was built for, and the one shown: others build it again */
  private shape = '';
  private tabs!: HTMLDivElement;
  private head!: HTMLDivElement;
  private hp!: ReturnType<typeof bar>;
  private mp!: ReturnType<typeof bar>;
  private skills: { id: string; box: HTMLDivElement; cd: HTMLDivElement }[] = [];

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('servitor', tx('Servitor', 'Servitor'), 280, 150, 248, root);
    this.win.onShow = () => {
      this.shape = '';
      this.refresh();
    };
  }

  /** Shown while a servitor is out (none: nothing to show). */
  open() {
    if (this.g.pet) this.win.show();
    this.refresh();
  }

  /** Its bars every time we hear from the server (ui/index.ts onMe); all of it again for another servitor. Gone with them. */
  refresh() {
    if (!this.win.visible) return;
    const p = this.g.pet, pets = this.g.pets;
    if (!p) return this.win.hide();
    const shape = `${p.id}|${pets.map((q) => q.id).join()}`;
    if (shape !== this.shape) {
      this.shape = shape;
      this.build(p.def);
      for (const q of pets.length > 1 ? pets : []) {
        const tab = el('button', q === p ? 'tab active' : 'tab', this.tabs, servitorName(q.def, lang));
        tab.onclick = () => this.g.pickPet(q.id);
      }
    }
    const mode = p.mode === 'stay' ? tx('Quieto', 'Staying') : tx('Te sigue', 'Following');
    this.head.innerHTML = `<b>${esc(servitorName(p.def, lang))}</b> <span class="tt-dim">${tx('Nv', 'Lv')} ${p.lvl} · ${p.fighting ? tx('Peleando', 'Fighting') : mode}</span>`;
    this.hp.set(p.hp, p.maxHp);
    this.mp.set(p.mp, p.maxMp);
  }

  private build(def: string) {
    const b = this.win.body, touch = isTouchDevice();
    b.innerHTML = '';
    this.skills = [];
    this.tabs = el('div', 'tabs pet-tabs', b);
    this.head = el('div', 'pet-head', b);
    setTip(this.head, () => esc(servitorDesc(def, lang)));
    this.hp = bar(b, 'bar-hp', 'HP');
    this.mp = bar(b, 'bar-mp', 'MP');
    el('div', 'section', b, tx('Acciones', 'Actions'));
    const acts = el('div', 'skill-grid', b);
    for (const a of PET_ACTIONS) {
      const icon = actionIcon(a.id, acts);
      setTip(icon, () => actionTip(a.id));
      icon.onclick = () => runAction(this.g, a.id);
      toBar(this.g, icon, { type: 'action', id: a.id }, () => actionIcon(a.id));
    }
    el('div', 'section', b, tx('Habilidades', 'Skills'));
    const grid = el('div', 'skill-grid', b);
    for (const id of SERVITORS[def]?.skills ?? []) {
      if (!PET_SKILLS[id]) continue;
      const box = el('div', 'pet-skill', grid);
      const icon = skillIcon(id, box);
      const cd = el('div', 'cd', box);
      setTip(icon, () => skillTip(id));
      icon.onclick = () => this.g.petOrder('skill', id);
      toBar(this.g, icon, { type: 'pet', id }, () => skillIcon(id));
      this.skills.push({ id, box, cd });
    }
    el('div', 'hint', b, touch
      ? tx('Tocá una acción o una habilidad para usarla. Para ubicarla en la barra, mantenela presionada y arrastrala.',
        'Tap an action or a skill to use it. To place it on the bar, hold it and drag it there.')
      : tx('Click en una acción o una habilidad para usarla, o arrastrala a la barra para usarla con la tecla del casillero.',
        'Click an action or a skill to use it, or drag it onto the bar to use it with the slot\'s key.'));
  }

  /** Its skills' cooldown sweeps, and the ones its MP doesn't cover, every frame while it is open (ui/index.ts update). */
  update(now: number) {
    if (!this.win.visible) return;
    const p = this.g.pet;
    for (const s of this.skills) {
      const cd = this.g.cooldowns.get(`pet:${s.id}`), rem = cd ? cd.end - now : 0;
      s.cd.style.height = rem > 0 ? `${(rem / cd!.dur) * 100}%` : '0';
      s.box.classList.toggle('nomp', !!p && p.mp < (PET_SKILLS[s.id]?.mp ?? 0));
    }
  }
}
