import { enchanted, GRADE_COLOR, ITEMS, type Slot } from '../../../shared/src/data/items';
import { SKILLS } from '../../../shared/src/data/skills';
import { el, esc } from './dom';
import { lang, t as tx } from '../lang';
import { itemDesc, itemName, skillDesc, skillName } from '../../../shared/src/i18n';
export const SLOT_NAME: Record<Slot, string> = { head: tx('Cabeza', 'Head'), weapon: tx('Arma', 'Weapon'), chest: tx('Torso', 'Chest'), gloves: tx('Guantes', 'Gloves'), legs: tx('Piernas', 'Legs'), feet: tx('Pies', 'Feet'), amulet: tx('Collar', 'Necklace'), earring: tx('Pendiente', 'Earring'), ring: tx('Anillo', 'Ring') };
export const WEAPON_TYPE: Record<string, string> = { sword: tx('Espada', 'Sword'), staff: tx('Báculo', 'Staff'), blunt: tx('Contundente', 'Blunt'), axe: tx('Hacha', 'Axe'), spear: tx('Lanza', 'Spear'), dagger: tx('Daga', 'Dagger') };

const ICONS = import.meta.glob('../icons/**/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
// the coin next to every adena amount (.adena::before)
document.documentElement.style.setProperty('--gi-adena', `url("${ICONS['../icons/item/adena.svg']}")`);

/**
 * A custom icon from client/src/icons/<kind>/<id>.svg (see icons/CREDITS.txt), drawn as a mask so CSS
 * picks its colour. Anything without a file falls back to the given text.
 */
export function glyph(kind: 'skill' | 'item' | 'status' | 'ui', id: string, fallback = '', parent?: HTMLElement): HTMLElement {
  const url = ICONS[`../icons/${kind}/${id}.svg`];
  if (!url) return el('span', '', parent, fallback);
  const g = el('i', 'gi', parent);
  g.style.setProperty('--gi', `url("${url}")`);
  return g;
}

/** Swap every `<i data-gi="kind/id">` placeholder under root for its icon (for markup written as an HTML string). */
export function hydrate(root: HTMLElement) {
  for (const ph of root.querySelectorAll<HTMLElement>('[data-gi]')) {
    const [kind, id] = ph.dataset.gi!.split('/');
    ph.replaceWith(glyph(kind as 'ui', id));
  }
}

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Pieces of a set share the drawing of their kind: the icon's colour and border tell the sets apart. */
const SHARED_ICON: Record<string, string> = {
  ring: 'ring', earring: 'earring', necklace: 'necklace', blade: 'samurai_longsword', staff: 'sages_staff', helm: 'full_plate_helmet', plate: 'full_plate_armor',
  robe: 'demons_tunic', greaves: 'brigandine_gaiters', gauntlets: 'reinforced_gloves', boots: 'reinforced_boots',
};
/** The icon file an item uses: its own, or the one for its kind (abyssal_ring and ring_of_vigor both draw `ring`). */
export const itemIconId = (id: string) => (ICONS[`../icons/item/${id}.svg`] ? id : SHARED_ICON[id.split('_').find((w) => w in SHARED_ICON) ?? ''] ?? id);

export function itemIcon(itemId: string, parent?: HTMLElement, count?: number, ench = 0): HTMLDivElement {
  const def = ITEMS[itemId];
  const d = el('div', 'icon', parent);
  glyph('item', itemIconId(itemId), def?.icon ?? '?', d);
  d.style.background = `radial-gradient(circle at 35% 30%, ${hex(def?.color ?? 0x666666)}aa, #14161f 80%)`;
  if (def?.grade) d.style.borderColor = GRADE_COLOR[def.grade];
  if (count && count > 1) el('span', 'icon-count', d, count > 9999 ? `${Math.floor(count / 1000)}k` : String(count));
  if (ench > 0) el('span', `icon-ench${ench >= 8 ? ' hi' : ench >= 4 ? ' mid' : ''}`, d, `+${ench}`);
  return d;
}

export function skillIcon(skillId: string, parent?: HTMLElement): HTMLDivElement {
  const def = SKILLS[skillId];
  const d = el('div', 'icon skill', parent);
  glyph('skill', skillId, def?.icon ?? '?', d);
  d.style.background = `radial-gradient(circle at 35% 30%, ${hex(def?.color ?? 0x666666)}, #14161f 85%)`;
  return d;
}

export function itemTip(itemId: string, count = 1, ench = 0): string {
  const d = ITEMS[itemId];
  if (!d) return '';
  const lines: string[] = [];
  const gradeTxt = d.grade ? ` <span style="color:${GRADE_COLOR[d.grade]}">[${d.grade === 'NG' ? tx('Sin grado', 'No grade') : tx('Grado ', 'Grade ') + d.grade}]</span>` : '';
  lines.push(`<div class="tt-title">${ench ? `+${ench} ` : ''}${esc(itemName(itemId, lang))}${count > 1 ? ` (${count})` : ''}${gradeTxt}</div>`);
  const st = (k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef') => enchanted(d, k, ench);
  if (d.type === 'weapon') lines.push(`${tx('Atq.F', 'P.Atk')} ${st('pAtk')} &nbsp; ${tx('Atq.M', 'M.Atk')} ${st('mAtk')}<br><span class="tt-dim">${WEAPON_TYPE[d.weaponType ?? 'sword']}</span>`);
  if (d.type === 'armor') lines.push(`${[d.pDef && `${tx('Def.F', 'P.Def')} ${st('pDef')}`, d.mDef && `${tx('Def.M', 'M.Def')} ${st('mDef')}`, d.hp && `HP +${d.hp}`, d.mp && `MP +${d.mp}`].filter(Boolean).join(' &nbsp; ')}<br><span class="tt-dim">${SLOT_NAME[d.slot!]}</span>`);
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

export function bar(parent: HTMLElement, cls: string, label?: string): { root: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement; set(cur: number, max: number): void } {
  const root = el('div', `bar ${cls}`, parent);
  const fill = el('div', 'bar-fill', root);
  if (label) el('span', 'bar-label', root, label);
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
