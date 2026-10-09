# client/src/ui/chat.ts

- Ch · type · L7-L7 — type Ch = 'all' | 'shout' | 'party' | 'whisper' | 'sys' | 'announce' | 'log' | 'npc';
- Chat · class · L15-L151 — class Chat
- constructor · method · L28-L80 — constructor(private g: Game, root: HTMLElement)
- setNpc · function · L41-L50 — setNpc = (on: boolean)
- hidden · method · L82-L84 — get hidden()
- setHidden · method · L87-L96 — setHidden(h: boolean)
- renderToggle · method · L98-L103 — private renderToggle()
- setTab · method · L105-L110 — private setTab(id: string)
- shows · method · L112-L114 — private shows(ch: Ch)
- focus · method · L116-L119 — focus()
- prefill · method · L121-L125 — prefill(text: string)
- add · method · L127-L150 — add(ch: Ch, from: string, text: string)
