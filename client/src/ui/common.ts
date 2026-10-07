import { GRADE_COLOR, ITEMS, type Slot } from '../../../shared/src/data/items';
import { SKILLS } from '../../../shared/src/data/skills';
import { el, esc } from './dom';
import { lang, t as tx } from '../lang';
import { itemDesc, itemName, skillDesc, skillName } from '../../../shared/src/i18n';
export const SLOT_NAME: Record<Slot, string> = { head: tx('Cabeza', 'Head'), weapon: tx('Arma', 'Weapon'), chest: tx('Torso', 'Chest'), gloves: tx('Guantes', 'Gloves'), legs: tx('Piernas', 'Legs'), feet: tx('Pies', 'Feet') };
export const WEAPON_TYPE: Record<string, string> = { sword: tx('Espada', 'Sword'), staff: tx('Báculo', 'Staff'), blunt: tx('Contundente', 'Blunt') };

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
  const gradeTxt = d.grade ? ` <span style="color:${GRADE_COLOR[d.grade]}">[${d.grade === 'NG' ? tx('Sin grado', 'No grade') : tx('Grado ', 'Grade ') + d.grade}]</span>` : '';
  lines.push(`<div class="tt-title">${esc(itemName(itemId, lang))}${count > 1 ? ` (${count})` : ''}${gradeTxt}</div>`);
  if (d.type === 'weapon') lines.push(`${tx('Atq.F', 'P.Atk')} ${d.pAtk} &nbsp; ${tx('Atq.M', 'M.Atk')} ${d.mAtk}<br><span class="tt-dim">${WEAPON_TYPE[d.weaponType ?? 'sword']}</span>`);
  if (d.type === 'armor') lines.push(`${tx('Def.F', 'P.Def')} ${d.pDef ?? 0}${d.mDef ? ` &nbsp; ${tx('Def.M', 'M.Def')} ${d.mDef}` : ''}${d.mp ? ` &nbsp; MP +${d.mp}` : ''}<br><span class="tt-dim">${SLOT_NAME[d.slot!]}</span>`);
  if (d.desc) lines.push(esc(itemDesc(itemId, lang) ?? ""));
  if (d.type !== 'currency') lines.push(`<span class="tt-dim">${tx(`Valor: ${d.price} de adena`, `Value: ${d.price} adena`)}</span>`);
  return lines.join('<br>');
}

export function skillTip(skillId: string): string {
  const s = SKILLS[skillId];
  if (!s) return '';
  return `<div class="tt-title">${esc(skillName(skillId, lang))} <span class="tt-dim">${tx('Nv', 'Lv')} ${s.level}</span></div>${esc(skillDesc(skillId, lang))}<br>
    <span class="tt-dim">MP ${s.mp} · ${tx('Lanzamiento', 'Cast')} ${(s.cast / 1000).toFixed(1)} s · ${tx('Recarga', 'Cooldown')} ${(s.cooldown / 1000).toFixed(0)} s${s.range > 3 ? ` · ${tx('Alcance', 'Range')} ${s.range}` : ''}</span>`;
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
