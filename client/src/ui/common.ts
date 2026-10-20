import { ENCHANT, enchanted, GRADE_COLOR, ITEMS, masterworkBonus, type MasterworkBonus, type Slot, wearLevel } from '../../../shared/src/data/items';
import { RACES, type ClassType, type Race } from '../../../shared/src/data/classes';
import { SKILLS } from '../../../shared/src/data/skills';
import { el, esc } from './dom';
import { lang, t as tx } from '../lang';
import { itemDesc, itemName, raceName, skillDesc, skillName } from '../../../shared/src/i18n';
export const SLOT_NAME: Record<Slot, string> = { head: tx('Cabeza', 'Head'), weapon: tx('Arma', 'Weapon'), shield: tx('Escudo', 'Shield'), chest: tx('Torso', 'Chest'), cape: tx('Capa', 'Cape'), gloves: tx('Guantes', 'Gloves'), legs: tx('Piernas', 'Legs'), feet: tx('Pies', 'Feet'), amulet: tx('Collar', 'Necklace'), earring: tx('Pendiente', 'Earring'), ring: tx('Anillo', 'Ring') };
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
  robe: 'demons_tunic', greaves: 'brigandine_gaiters', gauntlets: 'reinforced_gloves', boots: 'reinforced_boots', shield: 'shield', buckler: 'shield',
  circlet: 'demons_circlet', gloves: 'short_gloves', shoes: 'leather_sandals', cape: 'cape', duals: 'duals',
  pelt: 'wolf_pelt', healing: 'greater_healing_potion', mana: 'greater_mana_potion',
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

/** The player's level, for the "requires level" line of item tooltips (game.ts sets it). */
let myLevel = () => 0;
export const setTipLevel = (f: () => number) => (myLevel = f);
/** The player's race and class, for what a Masterwork piece gives them (game.ts sets it). */
let mySelf = (): { race: Race; cls: ClassType } | null => null;
export const setTipSelf = (f: () => { race: Race; cls: ClassType } | null) => (mySelf = f);

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
/** "Vel.Atq +6%, Recarga -3%" */
export const mwText = (b: MasterworkBonus) => [
  b.atkSpd && `${tx('Vel.Atq', 'Atk.Spd')} +${pct(b.atkSpd)}`,
  b.castSpd && `${tx('Vel.Casteo', 'Cast.Spd')} +${pct(b.castSpd)}`,
  b.cdr && `${tx('Recarga', 'Cooldown')} -${pct(b.cdr)}`,
].filter(Boolean).join(', ');

/** What a Masterwork piece gives: you, then every other race ("speed" being the class's own, attack or cast). */
function masterworkLines(isWeapon: boolean): string[] {
  const me = mySelf();
  const out = [`<span class="tt-mw">★ ${tx('Obra Maestra', 'Masterwork')}</span>`];
  if (me) out.push(`${tx('Para vos', 'For you')}: <span class="tt-up">${mwText(masterworkBonus(me.race, me.cls, isWeapon))}</span>`);
  const others = (Object.keys(RACES) as Race[]).filter((r) => r !== me?.race).map((r) => {
    const b = masterworkBonus(r, 'fighter', isWeapon);
    const v = [b.atkSpd && `${tx('velocidad', 'speed')} +${pct(b.atkSpd)}`, b.cdr && `${tx('recarga', 'cooldown')} -${pct(b.cdr)}`].filter(Boolean).join(', ');
    return `${raceName(r, lang).replace(/ /g, '&nbsp;')}: ${v}`;
  });
  out.push(`<span class="tt-dim">${others.join(' · ')}<br>${tx('La velocidad es de ataque para guerreros y de casteo para místicos.', 'Speed is attack speed for fighters and cast speed for mystics.')}</span>`);
  return out;
}

/** A shield's block chance at +e, in % (each +1 adds as much as it adds to a piece's defence; server-rs compute_stats) */
export const blockPct = (d: { block?: number }, e = 0) => Math.round((d.block ?? 0) * (1 + ENCHANT.armor * e) * 1000) / 10;
/** How much faster a piece (a cape) lets its wearer run, in %; enchanting does not change it (server-rs compute_stats) */
export const speedPct = (d: { speed?: number }) => Math.round((d.speed ?? 0) * 1000) / 10;

export function itemTip(itemId: string, count = 1, ench = 0, legacy = false, mw = false): string {
  const d = ITEMS[itemId];
  if (!d) return '';
  const lines: string[] = [];
  const gradeTxt = d.grade ? ` <span style="color:${GRADE_COLOR[d.grade]}">[${d.grade === 'NG' ? tx('Sin grado', 'No grade') : tx('Grado ', 'Grade ') + d.grade}]</span>` : '';
  const name = `${ench ? `+${ench} ` : ''}${esc(itemName(itemId, lang))}`;
  lines.push(`<div class="tt-title">${mw ? `<span class="tt-mw">${name}</span>` : name}${count > 1 ? ` (${count})` : ''}${gradeTxt}</div>`);
  const st = (k: 'pAtk' | 'mAtk' | 'pDef' | 'mDef') => enchanted(d, k, ench);
  if (d.type === 'weapon') lines.push(`${tx('Atq.F', 'P.Atk')} ${st('pAtk')} &nbsp; ${tx('Atq.M', 'M.Atk')} ${st('mAtk')}<br><span class="tt-dim">${WEAPON_TYPE[d.weaponType ?? 'sword']}${d.twoHanded ? tx(' · a dos manos, sin escudo', ' · two-handed, no shield') : ''}</span>`);
  if (d.type === 'armor') lines.push(`${[d.pDef && `${tx('Def.F', 'P.Def')} ${st('pDef')}`, d.mDef && `${tx('Def.M', 'M.Def')} ${st('mDef')}`, d.hp && `HP +${d.hp}`, d.mp && `MP +${d.mp}`, d.cdr && `${tx('Recarga', 'CDR')} -${Math.round(d.cdr * 100)}%`, d.block && `${tx('Bloqueo', 'Block')} ${blockPct(d, ench)}%`, d.speed && `${tx('Velocidad', 'Speed')} +${speedPct(d)}%`, d.evasion && `${tx('Evasión', 'Evasion')} +${d.evasion}`, d.atkSpd && `${tx('Vel.Atq', 'Atk.Spd')} +${pct(d.atkSpd)}`].filter(Boolean).join(' &nbsp; ')}<br><span class="tt-dim">${SLOT_NAME[d.slot!]}</span>`);
  if (d.block) lines.push(`<span class="tt-dim">${tx('Un golpe físico bloqueado hace la mitad de daño.', 'A blocked physical hit does half its damage.')}</span>`);
  if (d.slot && mw) lines.push(...masterworkLines(d.type === 'weapon'));
  const need = wearLevel(d);
  if (d.slot && legacy) lines.push(`<span class="tt-up">${tx('Equipo heredado: sin requisito de nivel', 'Legacy gear: no level requirement')}</span>`);
  else if (d.slot && need > 0) lines.push(`<span class="${myLevel() >= need ? 'tt-dim' : 'tt-down'}">${tx(`Requiere nivel ${need}`, `Requires level ${need}`)}</span>`);
  if (d.desc) lines.push(esc(itemDesc(itemId, lang) ?? ""));
  if (d.type !== 'currency') lines.push(`<span class="tt-dim">${tx(`Valor: ${d.price} de adena`, `Value: ${d.price} adena`)}</span>`);
  return lines.join('<br>');
}

export function skillTip(skillId: string): string {
  const s = SKILLS[skillId];
  if (!s) return '';
  const need = [
    s.weapon === 'bow' ? tx('Requiere un arco.', 'Needs a bow.') : s.weapon === 'dagger' ? tx('Requiere una daga.', 'Needs a dagger.') : s.weapon === 'dual' ? tx('Requiere un par de espadas.', 'Needs a pair of swords.') : '',
    s.spend ? tx(`Gasta ${s.spend} ${s.spend === 1 ? 'carga' : 'cargas'} de fuerza.`, `Spends ${s.spend} Force ${s.spend === 1 ? 'charge' : 'charges'}.`) : '',
    s.charge ? (s.charge >= 99 ? tx('Llena las cargas de fuerza.', 'Fills the Force charges.') : tx(`Junta ${s.charge} ${s.charge === 1 ? 'carga' : 'cargas'} de fuerza.`, `Gathers ${s.charge} Force ${s.charge === 1 ? 'charge' : 'charges'}.`)) : '',
  ].filter(Boolean).join(' ');
  return `<div class="tt-title">${esc(skillName(skillId, lang))} <span class="tt-dim">${tx('Nv', 'Lv')} ${s.level}</span></div>${esc(skillDesc(skillId, lang))}<br>${need ? `<span class="tt-dim">${need}</span><br>` : ''}
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
