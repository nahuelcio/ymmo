import type { Game } from '../game';
import { Chat } from './chat';
import { Win } from './dom';
import { Hud } from './hud';
import { Minimap } from './minimap';
import { SettingsPanel } from './settings';
import { isTouchDevice, TouchControls } from './touch';
import { AdminPanel, CharacterPanel, createHelp, Dialogs, InventoryPanel, NpcPanel, PartyPanel } from './panels';
import { SPEC_LEVEL } from '../../../shared/src/data/classes';

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
  settings: SettingsPanel;
  admin: AdminPanel;

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
    this.settings = new SettingsPanel(this.root);
    this.admin = new AdminPanel(g, this.root);
    this.settings.onBenchmark = () => {
      this.settings.win.hide();
      void import('../bench').then((b) => b.runBenchmark(g)); // loaded on demand
    };
    if (isTouchDevice()) {
      new TouchControls(g, this.root);
      // small screens: start with the chat folded away (the player can open it with ▲)
      try {
        if (localStorage.getItem('touchChatInit') === null) {
          localStorage.setItem('touchChatInit', '1');
          this.chat.setHidden(true);
        }
      } catch {
        this.chat.setHidden(true);
      }
    }
    let seen = false;
    try {
      seen = localStorage.getItem('helpSeen') === '1';
      localStorage.setItem('helpSeen', '1');
    } catch {
      /* storage unavailable */
    }
    if (!seen) this.help.show();
  }

  private specPrompted = false;

  partyIds(): number[] {
    return this.party.members?.map((m) => m.id) ?? [];
  }

  onMe() {
    // time to pick a specialization: bring the character sheet up, once per session
    const m = this.g.me;
    if (m.lvl >= SPEC_LEVEL && !m.spec && !this.specPrompted) {
      this.specPrompted = true;
      this.character.win.show();
    }
    this.hud.onMe();
    this.character.refresh();
    this.inventory.refreshStats();
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
