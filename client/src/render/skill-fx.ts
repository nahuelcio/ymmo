import * as THREE from 'three';
import type { FxManager } from './fx';

/** Anything with a feet position and a height (CEnt fits). */
type Ent = { pos: THREE.Vector3; height: number };
export interface VfxCtx { f: FxManager; s: Ent; t: Ent; color: number; aoe: number }
type Vfx = (c: VfxCtx) => void;

// Points on a body: feet, chest, head. Effects anchor to these so each one reads on the right part.
const feet = (e: Ent) => e.pos.clone();
const chest = (e: Ent, k = 0.6) => e.pos.clone().setY(e.pos.y + e.height * k);
const head = (e: Ent) => chest(e, 1.05);
const above = (p: THREE.Vector3, h: number) => p.clone().setY(p.y + h);
const later = (ms: number, fn: () => void) => setTimeout(fn, ms);

/** One visual signature per skill id. Unknown ids fall back to the generic per-kind effect in game.ts. */
export const SKILL_VFX: Record<string, Vfx> = {
  // ---- fighter
  power_strike: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), color, 1.8, 320);
    f.burst(chest(t), color, 1.0, 300);
  },
  provoke: ({ f, s, t, color, aoe }) => {
    f.ring(feet(s), color, 1.2, 300);
    later(120, () => {
      f.ring(feet(t), color, aoe, 650);
      f.ring(feet(t), color, aoe * 0.55, 450);
    });
    f.motes(feet(t), color, 700, { n: 10, r: 1.2, spin: 3, rise: 0.8 });
  },
  mortal_blow: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), 0xaa0010, 1.5, 300);
    f.motes(chest(t, 0.9), color, 1100, { n: 12, r: 0.25, spin: 0, rise: 0, fall: 1.4, size: 1.1 }); // blood dripping
  },
  rage: ({ f, s, color }) => {
    f.pillar(feet(s), color, 900, 3);
    f.motes(feet(s), color, 1200, { n: 20, r: 0.7, spin: 6, rise: 2.4 });
  },
  whirlwind: ({ f, s, color, aoe }) => {
    f.motes(feet(s), color, 900, { n: 26, r: aoe * 0.8, spin: 9, rise: 1.5, size: 0.9 });
    f.ring(feet(s), color, aoe, 500);
  },
  iron_will: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.6, 900);
    f.ring(feet(s), color, 1.8, 500);
  },
  power_smash: ({ f, t, color }) => {
    f.burst(chest(t), color, 1.2, 380);
    f.ring(feet(t), color, 2.2, 550);
    f.shards(feet(t), color, 8, 2.2);
    f.motes(head(t), 0xffe066, 1500, { n: 4, r: 0.45, spin: 5, rise: 0 }); // stun stars
  },

  // ---- knight
  shield_bash: ({ f, t, color }) => {
    f.dome(chest(t, 0.45), 0xdfe9ff, 0.9, 300);
    f.burst(chest(t), color, 0.8, 260);
    f.motes(head(t), 0xffe066, 1500, { n: 4, r: 0.45, spin: 5, rise: 0 });
  },
  challenge: ({ f, t, color, aoe }) => {
    f.pillar(feet(t), color, 1000, 5);
    f.ring(feet(t), color, aoe, 800);
    f.motes(feet(t), color, 900, { n: 16, r: aoe * 0.6, spin: 2, rise: 1.2 });
  },
  fortress: ({ f, s, color }) => {
    f.dome(feet(s), color, 2.4, 1000);
    f.ring(feet(s), color, 2.4, 700);
    later(200, () => f.ring(feet(s), color, 3.2, 600));
  },
  holy_strike: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), color, 1.6, 300);
    f.pillar(feet(t), color, 700, 5);
  },
  guardian_aura: ({ f, t, color }) => {
    f.ring(feet(t), color, 1.8, 500);
    f.motes(feet(t), color, 1100, { n: 14, r: 1.6, spin: 2.5, rise: 0.4, size: 0.9 });
  },
  earthquake: ({ f, s, color, aoe }) => {
    f.ring(feet(s), color, aoe, 500);
    f.ring(feet(s), 0xffcc88, aoe * 0.6, 400);
    f.shards(feet(s), color, 14, aoe * 0.5, 800);
  },
  last_stand: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.2, 900);
    f.motes(feet(s), 0xffaaaa, 1200, { n: 18, r: 0.6, spin: 1, rise: 2.6 });
  },

  // ---- gladiator
  double_slash: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), color, 1.3, 220);
    later(130, () => f.slash(chest(t, 0.45), chest(s), 0xffe9a0, 1.3, 220));
  },
  hamstring: ({ f, s, t, color }) => {
    f.slash(chest(t, 0.25), chest(s, 0.3), color, 1.1, 260); // low cut at the legs
    f.ring(feet(t), color, 1.3, 600);
  },
  bloodlust: ({ f, s, color }) => {
    f.motes(feet(s), color, 1200, { n: 24, r: 0.9, spin: 10, rise: 1.8 });
    f.dome(feet(s), color, 1.3, 800);
  },
  rend: ({ f, s, t, color }) => {
    [-0.35, 0, 0.35].forEach((dy, i) => later(i * 90, () => f.slash(chest(t, 0.6 + dy), chest(s), color, 1.2, 240)));
  },
  blade_storm: ({ f, s, color, aoe }) => {
    for (let i = 0; i < 4; i++) {
      later(i * 110, () => {
        const a = (i / 4) * Math.PI * 2;
        const p = chest(s, 0.5).add(new THREE.Vector3(Math.cos(a) * aoe * 0.6, 0, Math.sin(a) * aoe * 0.6));
        f.slash(p, chest(s, 0.5), color, 1.2, 240);
      });
    }
  },
  war_cry: ({ f, s, color, aoe }) => {
    f.ring(feet(s), color, 1.5, 400);
    later(180, () => f.ring(feet(s), color, aoe * 0.8, 600));
    later(360, () => f.ring(feet(s), color, aoe, 800));
  },
  execute: ({ f, t, color }) => {
    f.pillar(feet(t), color, 1000, 4);
    f.burst(chest(t), color, 1.6, 500);
    f.motes(chest(t, 0.9), 0x550000, 1000, { n: 12, r: 0.3, rise: 0, fall: 1.6, size: 1.2 });
  },

  // ---- mystic
  wind_strike: ({ f, s, t, color }) => {
    f.projectile(chest(s), () => chest(t), color, 320, 0.18);
    later(320, () => {
      f.slash(chest(t), chest(s), color, 1.1, 200);
      f.motes(chest(t), color, 500, { n: 10, r: 0.9, spin: 12, rise: 0.5 });
    });
  },
  heal: ({ f, t, color }) => {
    f.motes(feet(t), color, 900, { n: 16, r: 0.7, spin: 3, rise: 2.4 });
    f.ring(feet(t), color, 1.2, 500);
  },
  ice_bolt: ({ f, s, t, color }) => {
    f.projectile(chest(s), () => chest(t), color, 300, 0.22);
    later(300, () => {
      f.shards(chest(t), 0xbfe6ff, 10, 1.4, 700);
      f.ring(feet(t), color, 1.4, 500);
    });
  },
  vampiric_touch: ({ f, s, t }) => {
    f.bolt(chest(t), chest(s), 0xaa2266, 420);
    f.motes(chest(s), 0xff5577, 600, { n: 8, r: 0.5, rise: 1.2 }); // the stolen life coming back to you
  },
  blessing: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.4, 1000);
    f.motes(feet(t), 0xffffff, 1100, { n: 12, r: 0.8, spin: 1.5, rise: 1.8, size: 0.8 });
  },
  aura_flare: ({ f, s, t, color, aoe }) => {
    f.projectile(chest(s), () => chest(t), color, 300, 0.35);
    later(300, () => {
      f.burst(chest(t), color, 1.6, 500);
      f.ring(feet(t), color, aoe, 650);
      later(160, () => f.ring(feet(t), 0xffffff, aoe * 0.6, 450));
    });
  },
  greater_heal: ({ f, t, color }) => {
    f.pillar(feet(t), color, 1000, 5);
    f.motes(feet(t), 0xffffff, 1000, { n: 22, r: 0.5, spin: 2, rise: 3.2, size: 0.8 });
  },

  // ---- sorcerer
  fireball: ({ f, s, t, color }) => {
    f.projectile(chest(s), () => chest(t), color, 320, 0.45);
    later(320, () => {
      f.burst(chest(t), color, 1.1, 380);
      f.motes(chest(t), 0xffcc66, 800, { n: 12, r: 0.8, rise: 0.5, fall: 1.2, size: 0.8 }); // embers
    });
  },
  frost_nova: ({ f, s, color, aoe }) => {
    f.ring(feet(s), color, aoe, 550);
    f.shards(feet(s), 0xd8f4ff, 16, aoe * 0.7, 800);
    f.dome(feet(s), color, aoe * 0.9, 600);
  },
  arcane_power: ({ f, s, color }) => {
    f.ring(feet(s), color, 1.3, 600);
    later(150, () => f.ring(feet(s), color, 1.9, 700));
    f.motes(feet(s), color, 1200, { n: 12, r: 1.1, spin: 2.5, rise: 2.0, size: 0.7 });
  },
  lightning: ({ f, t, color }) => {
    f.bolt(above(chest(t), 9), chest(t), color, 260);
    later(260, () => {
      f.burst(chest(t), 0xffffff, 0.7, 250);
      f.motes(head(t), color, 1400, { n: 4, r: 0.45, spin: 5, rise: 0 });
    });
  },
  meteor: ({ f, t, color, aoe }) => {
    f.projectile(above(chest(t), 14), () => chest(t), color, 700, 0.9);
    later(700, () => {
      f.burst(feet(t), color, 2.2, 600);
      f.ring(feet(t), 0xffaa33, aoe, 700);
      f.shards(feet(t), 0xff7733, 10, 3, 800);
      f.motes(feet(t), 0xff7733, 900, { n: 16, r: aoe * 0.5, rise: 2 });
    });
  },
  soul_drain: ({ f, s, t, color }) => {
    f.projectile(chest(t), () => chest(s), color, 500, 0.3);
    f.motes(feet(t), color, 900, { n: 14, r: 0.6, spin: 4, rise: 2.2, size: 0.8 });
  },
  inferno: ({ f, t, color, aoe }) => {
    f.pillar(feet(t), color, 1200, 7);
    f.burst(chest(t), color, 1.8, 500);
    f.ring(feet(t), 0xffaa00, aoe, 800);
    f.motes(feet(t), 0xff8800, 1500, { n: 30, r: aoe * 0.8, rise: 3, size: 1.1 });
  },

  // ---- cleric
  divine_heal: ({ f, t, color }) => {
    f.ring(head(t), color, 1.0, 700);
    f.motes(head(t), color, 900, { n: 14, r: 0.9, spin: 1, rise: 0, fall: 0.8 }); // petals drifting down
  },
  holy_shield: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.5, 1000);
    f.ring(feet(t), color, 1.6, 600);
  },
  smite: ({ f, t, color }) => {
    f.pillar(feet(t), color, 350, 2.5);
    f.burst(chest(t), color, 1, 300);
    f.motes(head(t), color, 1000, { n: 4, r: 0.45, spin: 5, rise: 0 });
  },
  might: ({ f, t, color }) => {
    f.ring(feet(t), color, 1.4, 400);
    later(120, () => f.ring(feet(t), color, 2.2, 500));
    f.motes(feet(t), color, 600, { n: 12, r: 0.5, spin: 0, rise: 0.8, size: 1.2 });
  },
  restoration: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.3, 900);
    f.motes(feet(t), color, 1500, { n: 18, r: 1.2, spin: 1, rise: 2.8, size: 0.9 });
  },
  haste: ({ f, t, color }) => {
    f.motes(feet(t), color, 900, { n: 18, r: 1.0, spin: 14, rise: 0.4 });
    f.ring(feet(t), color, 1.5, 350);
  },
  miracle: ({ f, t }) => {
    f.pillar(feet(t), 0xffffff, 1800, 9);
    f.ring(feet(t), 0xfff0b0, 3, 900);
    later(200, () => f.ring(feet(t), 0xffb0e0, 4, 1100));
    f.motes(feet(t), 0xffffff, 1800, { n: 30, r: 1.4, spin: 2, rise: 3.5 });
  },

  // ---- racial and gender
  second_wind: ({ f, s, color }) => {
    f.ring(feet(s), color, 1.2, 350);
    f.motes(feet(s), color, 700, { n: 10, r: 1.2, spin: 6, rise: 1.2 });
  },
  wind_walk: ({ f, s, color }) => {
    f.ring(feet(s), color, 1.3, 300);
    f.motes(feet(s), color, 800, { n: 12, r: 1.0, spin: 12, rise: 0.2, size: 0.6 });
  },
  shadow_bite: ({ f, s, t, color }) => {
    f.projectile(chest(t), () => chest(s), color, 400, 0.25);
    f.motes(feet(t), 0x88ff66, 1000, { n: 10, r: 0.5, rise: 2.2, size: 0.9 }); // poison bubbles
  },
  battle_roar: ({ f, s, color }) => {
    f.burst(chest(s), color, 0.9, 350);
    f.ring(feet(s), color, 2.5, 500);
    later(160, () => f.ring(feet(s), color, 4, 600));
  },
  stone_skin: ({ f, s, color }) => {
    f.motes(chest(s, 0.5), color, 1000, { n: 8, r: 1.0, spin: 3, rise: 0, size: 1.6 }); // orbiting rocks
    f.dome(feet(s), 0xaa8866, 1.2, 900);
  },
  endure: ({ f, s, color }) => {
    f.burst(chest(s), color, 0.8, 300);
    f.ring(feet(s), color, 1.6, 500);
  },
  grace: ({ f, s, color }) => {
    f.motes(feet(s), color, 1200, { n: 16, r: 0.8, spin: 1.5, rise: 1.5, size: 0.9 });
    f.dome(feet(s), color, 1.1, 800);
  },
};
