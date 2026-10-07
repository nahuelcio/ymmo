import type { Game } from '../game';
import { el } from './dom';

type Ch = 'all' | 'shout' | 'party' | 'whisper' | 'sys' | 'announce';
const TABS: { id: string; label: string; show: Ch[] }[] = [
  { id: 'all', label: 'Todo', show: ['all', 'shout', 'party', 'whisper', 'sys', 'announce'] },
  { id: 'party', label: 'Party', show: ['party', 'announce'] },
  { id: 'whisper', label: 'Susurros', show: ['whisper', 'announce'] },
  { id: 'sys', label: 'Sistema', show: ['sys', 'announce'] },
];

export class Chat {
  private log: HTMLDivElement;
  private input: HTMLInputElement;
  private tab = TABS[0];
  private lines: { ch: Ch; node: HTMLDivElement }[] = [];
  private tabEls: HTMLButtonElement[] = [];

  constructor(private g: Game, root: HTMLElement) {
    const box = el('div', 'panel chat', root);
    const tabs = el('div', 'chat-tabs', box);
    for (const t of TABS) {
      const b = el('button', 'chat-tab', tabs, t.label);
      b.onclick = () => this.setTab(t.id);
      this.tabEls.push(b);
    }
    this.log = el('div', 'chat-log', box);
    this.input = el('input', 'chat-input', box);
    this.input.maxLength = 200;
    this.input.placeholder = 'Enter para chatear — !grito  #party  "nombre susurro  /help';
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
  }

  private setTab(id: string) {
    this.tab = TABS.find((t) => t.id === id)!;
    this.tabEls.forEach((b, i) => b.classList.toggle('active', TABS[i] === this.tab));
    for (const l of this.lines) l.node.style.display = this.tab.show.includes(l.ch) ? '' : 'none';
    this.log.scrollTop = this.log.scrollHeight;
  }

  focus() {
    this.input.focus();
  }

  prefill(text: string) {
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
  }
}
