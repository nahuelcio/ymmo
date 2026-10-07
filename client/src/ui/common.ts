import { GRADE_COLOR, ITEMS } from '../../../shared/src/data/items';
import { SKILLS } from '../../../shared/src/data/skills';
import { el, esc } from './dom';

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function itemIcon(itemId: string, parent?: HTMLElement, count?: number): HTMLDivElement {
  const def = ITEMS[itemId];
  const d = el('div', 'icon', parent);
  d.textContent = def?.icon ?? '?';
  d.style.background = `radial-gradient(circle at 35% 30%, ${hex(def?.color ?? 0x666666)}aa, #14161f 80%)`;
  if (def?.grade) d.style.borderColor = GRADE_COLOR[def.grade];
  if (count && count > 1) el('span', 'icon-count', d, count > 9999 ? `${Math.floor(count / 1000)}k` : String(count));
  return d;
}

export function skillIcon(skillId: string, parent?: HTMLElement): HTMLDivElement {
  const def = SKILLS[skillId];
  const d = el('div', 'icon skill', parent);
  d.textContent = def?.icon ?? '?';
  d.style.background = `radial-gradient(circle at 35% 30%, ${hex(def?.color ?? 0x666666)}, #14161f 85%)`;
  return d;
}

export function itemTip(itemId: string, count = 1): string {
  const d = ITEMS[itemId];
  if (!d) return '';
  const lines: string[] = [];
  const gradeTxt = d.grade ? ` <span style="color:${GRADE_COLOR[d.grade]}">[${d.grade === 'NG' ? 'No Grade' : d.grade + '-Grade'}]</span>` : '';
  lines.push(`<div class="tt-title">${esc(d.name)}${count > 1 ? ` (${count})` : ''}${gradeTxt}</div>`);
  if (d.type === 'weapon') lines.push(`P.Atk ${d.pAtk} &nbsp; M.Atk ${d.mAtk}<br><span class="tt-dim">${d.weaponType}</span>`);
  if (d.type === 'armor') lines.push(`P.Def ${d.pDef ?? 0}${d.mDef ? ` &nbsp; M.Def ${d.mDef}` : ''}${d.mp ? ` &nbsp; MP +${d.mp}` : ''}<br><span class="tt-dim">${d.slot}</span>`);
  if (d.desc) lines.push(esc(d.desc));
  if (d.type !== 'currency') lines.push(`<span class="tt-dim">Value: ${d.price} adena</span>`);
  return lines.join('<br>');
}

export function skillTip(skillId: string): string {
  const s = SKILLS[skillId];
  if (!s) return '';
  return `<div class="tt-title">${esc(s.name)} <span class="tt-dim">Lv ${s.level}</span></div>${esc(s.desc)}<br>
    <span class="tt-dim">MP ${s.mp} · Cast ${(s.cast / 1000).toFixed(1)}s · Reuse ${(s.cooldown / 1000).toFixed(0)}s${s.range > 3 ? ` · Range ${s.range}` : ''}</span>`;
}

export function bar(parent: HTMLElement, cls: string): { root: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement; set(cur: number, max: number): void } {
  const root = el('div', `bar ${cls}`, parent);
  const fill = el('div', 'bar-fill', root);
  const text = el('span', 'bar-text', root);
  let lastKey = '';
  return {
    root, fill, text,
    set(cur: number, max: number) {
      const key = `${cur}/${max}`;
      if (key === lastKey) return;
      lastKey = key;
      fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0}%`;
      text.textContent = key;
    },
  };
}
