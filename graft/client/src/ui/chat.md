# client/src/ui/chat.ts

- Ch · type · L7-L7 — type Ch = 'all' | 'shout' | 'party' | 'whisper' | 'sys' | 'announce' | 'log' | 'npc';
- Chat · class · L15-L150 — class Chat
- constructor · method · L28-L79 — constructor(private g: Game, root: HTMLElement)
- setNpc · function · L41-L50 — setNpc = (on: boolean)
- hidden · method · L81-L83 — get hidden()
- setHidden · method · L86-L95 — setHidden(h: boolean)
- renderToggle · method · L97-L102 — private renderToggle()
- setTab · method · L104-L109 — private setTab(id: string)
- shows · method · L111-L113 — private shows(ch: Ch)
- focus · method · L115-L118 — focus()
- prefill · method · L120-L124 — prefill(text: string)
- add · method · L126-L149 — add(ch: Ch, from: string, text: string)
