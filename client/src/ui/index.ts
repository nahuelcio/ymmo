import type { Game } from '../game';
import { Chat } from './chat';
import { Win } from './dom';
import { Hud } from './hud';
import { Minimap } from './minimap';
import { CharacterPanel, createHelp, Dialogs, InventoryPanel, NpcPanel, PartyPanel } from './panels';

export class UI {
  root: HTMLElement;
  hud: Hud;
  chat: Chat;
  inventory: InventoryPanel;
  character: CharacterPanel;
  npc: NpcPanel;
  party: PartyPanel;
  minimap: Minimap;
  dialogs: Dialogs;
  help: Win;

  constructor(private g: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    this.hud = new Hud(g, this.root);
    this.party = new PartyPanel(g, this.root);
    this.chat = new Chat(g, this.root);
    this.inventory = new InventoryPanel(g, this.root);
    this.character = new CharacterPanel(g, this.root);
    this.npc = new NpcPanel(g, this.root);
    this.minimap = new Minimap(g, this.root);
    this.dialogs = new Dialogs(g, this.root);
    this.help = createHelp(this.root);
    let seen = false;
    try {
      seen = localStorage.getItem('helpSeen') === '1';
      localStorage.setItem('helpSeen', '1');
    } catch {
      /* storage unavailable */
    }
    if (!seen) this.help.show();
  }

  partyIds(): number[] {
    return this.party.members?.map((m) => m.id) ?? [];
  }

  onMe() {
    this.hud.onMe();
    this.character.refresh();
  }

  onInv() {
    this.inventory.refresh();
    this.hud.refreshSlots();
    this.npc.refresh();
  }

  onTargetChanged() {
    this.hud.refreshTarget();
  }

  update(now: number) {
    this.hud.update(now);
    this.minimap.update(now);
  }

  /** Close the top-most window/dialog. Returns true if something was closed. */
  closeTop(): boolean {
    if (this.dialogs.open && !this.g.me.hp) return false;
    if (this.dialogs.open) {
      this.dialogs.close();
      return true;
    }
    const top = Win.stack[Win.stack.length - 1];
    if (top) {
      top.hide();
      return true;
    }
    return false;
  }
}
