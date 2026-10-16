import { ITEMS } from '../../../shared/src/data/items';
import { itemName } from '../../../shared/src/i18n';
import type { S2C, TradeOffer } from '../../../shared/src/protocol';
import type { Game } from '../game';
import { lang, t as tx } from '../lang';
import { itemIcon, itemTip } from './common';
import { el, setTip, Win } from './dom';

type TradeMsg = Extract<S2C, { t: 'trade' }>;
type Shown = { i: string; c: number; e?: number; l?: boolean; m?: boolean };

/**
 * The trade window (server-rs/src/trade.rs), as in Lineage 2: the other player's offer on top, yours under it, then
 * your bag (what can still go in) and your adena. A click puts an item in; a stack asks how many first. Nothing put in
 * comes back out, and once either side has confirmed nothing more goes in. Closing the window cancels the trade.
 */
export class TradePanel {
  win: Win;
  private m: TradeMsg | null = null;

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('trade', tx('Comercio', 'Trade'), 300, 90, 420, root);
    // closed by hand (× or Esc) it cancels; a phone hiding it for another window does not (the next change shows it again)
    this.win.onClose = () => this.m && this.g.net.send({ t: 'tradeCancel' });
  }

  get active() {
    return !!this.m;
  }

  set(m: TradeMsg) {
    this.m = m;
    this.win.titleEl.textContent = tx(`Comercio con ${m.with}`, `Trade with ${m.with}`);
    this.win.show();
    this.render();
  }

  end() {
    this.m = null;
    this.win.hide();
  }

  /** the bag changed: what is left to offer */
  onInv() {
    if (this.m && this.win.visible) this.render();
  }

  private row(list: HTMLElement, it: Shown) {
    const r = el('div', 'shop-row', list);
    itemIcon(it.i, r, it.c, it.e);
    el('div', it.m ? 'grow tt-mw' : 'grow', r).textContent = `${it.e ? `+${it.e} ` : ''}${itemName(it.i, lang)}${it.c > 1 ? ` ×${it.c}` : ''}`;
    setTip(r, () => itemTip(it.i, it.c, it.e ?? 0, !!it.l, !!it.m));
    return r;
  }

  private offer(b: HTMLElement, title: string, o: TradeOffer) {
    const head = el('div', 'trade-head', b);
    el('span', 'grow', head, title);
    el('span', o.ok ? 'trade-ok' : 'tt-dim', head, o.ok ? tx('✓ Confirmado', '✓ Confirmed') : tx('Sin confirmar', 'Not confirmed'));
    const list = el('div', 'trade-list', b);
    for (const it of o.items) this.row(list, it);
    if (o.adena > 0) el('div', 'shop-row adena trade-adena', list, `${o.adena.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR')} Adena`);
    if (!o.items.length && !o.adena) el('div', 'tt-dim', list, tx('Nada todavía.', 'Nothing yet.'));
  }

  private render() {
    const m = this.m;
    if (!m) return;
    const b = this.win.body;
    b.innerHTML = '';
    this.offer(b, tx(`Oferta de ${m.with}`, `${m.with}'s offer`), m.theirs);
    this.offer(b, tx('Tu oferta', 'Your offer'), m.mine);
    const locked = m.mine.ok || m.theirs.ok;
    if (locked) {
      el('div', 'tt-dim trade-note', b, tx('Con el comercio confirmado ya no se pueden agregar objetos.', 'With the trade confirmed no more items can go in.'));
    } else {
      // what can still go in: the bag minus what is worn and what is already offered
      el('div', 'trade-head', b, tx('Tu inventario: tocá un objeto para ofrecerlo', 'Your bag: click an item to offer it'));
      const list = el('div', 'trade-list trade-bag', b);
      const offered = (u: number) => m.mine.items.filter((x) => x.u === u).reduce((a, x) => a + x.c, 0);
      for (const it of this.g.inv) {
        const def = ITEMS[it.i];
        if (it.s || !def || def.type === 'currency' || def.type === 'chest') continue;
        const left = it.c - offered(it.u);
        if (left <= 0) continue;
        const r = this.row(list, { i: it.i, c: left, e: it.e, l: it.l, m: it.m });
        let qty: HTMLInputElement | null = null;
        if (left > 1) {
          qty = el('input', 'qty', r);
          qty.type = 'number';
          qty.min = '1';
          qty.max = String(left);
          qty.value = String(left);
          qty.addEventListener('keydown', (e) => e.stopPropagation());
          qty.onclick = (e) => e.stopPropagation();
        }
        const put = el('button', 'btn small', r, tx('Ofrecer', 'Offer'));
        const send = () => this.g.net.send({ t: 'tradeAdd', u: it.u, c: qty ? Math.min(left, Math.max(1, Math.floor(+qty.value || 1))) : 1 });
        put.onclick = (e) => (e.stopPropagation(), send());
        // the whole row offers it too (one of a kind at once, a stack with the amount typed)
        r.onclick = send;
      }
      if (!list.children.length) el('div', 'tt-dim', list, tx('No te queda nada para ofrecer.', 'You have nothing left to offer.'));
      const left = this.g.adena - m.mine.adena;
      const ar = el('div', 'row trade-adena-row', b);
      el('span', 'adena grow', ar, `${left.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR')} Adena`);
      const amt = el('input', 'qty', ar);
      amt.type = 'number';
      amt.min = '1';
      amt.placeholder = 'Adena';
      amt.addEventListener('keydown', (e) => e.stopPropagation());
      const add = el('button', 'btn small', ar, tx('Agregar', 'Add'));
      add.onclick = () => +amt.value > 0 && this.g.net.send({ t: 'tradeAdena', amount: Math.min(left, Math.floor(+amt.value)) });
    }
    const btns = el('div', 'dialog-btns trade-btns', b);
    const ok = el('button', 'btn primary', btns, m.mine.ok ? tx('Confirmado', 'Confirmed') : tx('Confirmar', 'Confirm'));
    ok.disabled = m.mine.ok;
    ok.onclick = () => this.g.net.send({ t: 'tradeConfirm' });
    const cancel = el('button', 'btn', btns, tx('Cancelar', 'Cancel'));
    cancel.onclick = () => this.g.net.send({ t: 'tradeCancel' });
  }
}
