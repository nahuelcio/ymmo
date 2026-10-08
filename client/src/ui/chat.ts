import type { Game } from '../game';
import { el } from './dom';
import { lang, t as tx } from '../lang';

// 'log' is client-side: routine system lines (gains, "not ready") that only the System tab lists
type Ch = 'all' | 'shout' | 'party' | 'whisper' | 'sys' | 'announce' | 'log';
const TABS: { id: string; label: string; show: Ch[] }[] = [
  { id: 'all', label: tx('Todo', 'All'), show: ['all', 'shout', 'party', 'whisper', 'sys', 'announce'] },
  { id: 'party', label: 'Party', show: ['party', 'announce'] },
  { id: 'whisper', label: tx('Susurros', 'Whispers'), show: ['whisper', 'announce'] },
  { id: 'sys', label: tx('Sistema', 'System'), show: ['sys', 'log', 'announce'] },
];

export class Chat {
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private tab = TABS[0];
  private lines: { ch: Ch; node: HTMLDivElement }[] = [];
  private tabEls: HTMLButtonElement[] = [];
  private box!: HTMLDivElement;
  private toggleBtn!: HTMLButtonElement;
  private unread = 0;

  constructor(private g: Game, root: HTMLElement) {
    const box = (this.box = el('div', 'panel chat', root));
    const tabs = el('div', 'chat-tabs', box);
    for (const t of TABS) {
      const b = el('button', 'chat-tab', tabs, t.label);
      b.onclick = () => {
        this.setTab(t.id);
        this.setHidden(false);
      };
      this.tabEls.push(b);
    }
    this.toggleBtn = el('button', 'chat-toggle', tabs);
    this.toggleBtn.onclick = () => this.setHidden(!this.hidden);
    this.log = el('div', 'chat-log', box);
    this.input = el('input', 'chat-input', box);
    this.input.maxLength = 200;
    this.input.placeholder = tx('Enter para chatear — !grito  #party  "nombre susurro  /help', 'Enter to chat — !shout  #party  "name whisper  /help');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        let text = this.input.value.trim();
        if (text) {
          if (this.tab.id === 'party' && !/^[!#"/]/.test(text)) text = `#${text}`;
          this.g.net.send({ t: 'chat', text });
        }
        this.input.value = '';
        this.input.blur();
      } else if (e.key === 'Escape') this.input.blur();
    });
    this.setTab('all');
    let hidden = false;
    try {
      hidden = localStorage.getItem('chatHidden') === '1';
    } catch {
      /* storage unavailable */
    }
    this.setHidden(hidden);
  }

  get hidden() {
    return this.box.classList.contains('collapsed');
  }

  /** Collapse the chat to just its tab bar (remembered per browser). */
  setHidden(h: boolean) {
    this.box.classList.toggle('collapsed', h);
    if (!h) this.unread = 0;
    this.renderToggle();
    try {
      localStorage.setItem('chatHidden', h ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  private renderToggle() {
    const h = this.hidden;
    this.toggleBtn.textContent = h ? (this.unread ? `▲ ${this.unread > 99 ? '99+' : this.unread}` : '▲') : '▼';
    this.toggleBtn.title = h ? tx('Mostrar chat', 'Show chat') : tx('Ocultar chat', 'Hide chat');
    this.toggleBtn.classList.toggle('has-unread', h && this.unread > 0);
  }

  private setTab(id: string) {
    this.tab = TABS.find((t) => t.id === id)!;
    this.tabEls.forEach((b, i) => b.classList.toggle('active', TABS[i] === this.tab));
    for (const l of this.lines) l.node.style.display = this.tab.show.includes(l.ch) ? '' : 'none';
    this.log.scrollTop = this.log.scrollHeight;
  }

  focus() {
    this.setHidden(false);
    this.input.focus();
  }

  prefill(text: string) {
    this.setHidden(false);
    this.input.value = text;
    this.input.focus();
  }

  add(ch: Ch, from: string, text: string) {
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 30;
    const line = el('div', `chat-line ch-${ch}`, this.log);
    if (from) el('span', 'chat-from', line, `${ch === 'shout' ? '!' : ch === 'party' ? '#' : ''}${from}: `);
    line.appendChild(document.createTextNode(text));
    line.style.display = this.tab.show.includes(ch) ? '' : 'none';
    this.lines.push({ ch, node: line });
    if (this.lines.length > 250) this.lines.shift()!.node.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
    if (ch === 'announce') this.g.ui.hud.banner(text);
    if (this.hidden && ch !== 'sys' && ch !== 'log') {
      this.unread++;
      this.renderToggle();
    }
  }
}
