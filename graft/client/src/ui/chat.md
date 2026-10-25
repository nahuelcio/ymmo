# client/src/ui/chat.ts

- Ch · type · L8-L8 — type Ch = 'all' | 'shout' | 'party' | 'clan' | 'ally' | 'whisper' | 'sys' | 'announce' | 'log' | 'npc';
- Chat · class · L18-L157 — class Chat
- constructor · method · L31-L86 — constructor(private g: Game, root: HTMLElement)
- setNpc · function · L46-L55 — setNpc = (on: boolean)
- hidden · method · L88-L90 — get hidden()
- setHidden · method · L93-L102 — setHidden(h: boolean)
- renderToggle · method · L104-L109 — private renderToggle()
- setTab · method · L111-L116 — private setTab(id: string)
- shows · method · L118-L120 — private shows(ch: Ch)
- focus · method · L122-L125 — focus()
- prefill · method · L127-L131 — prefill(text: string)
- add · method · L133-L156 — add(ch: Ch, from: string, text: string)
