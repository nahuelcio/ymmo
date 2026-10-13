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
/** follows a moving body (projectiles and beams aim at where it is now, not where it was) */
const at = (e: Ent, k = 0.6) => () => chest(e, k);

const GOLD = 0xffd24d, BLOOD = 0xa01020, FIRE = 0xff7a1a, FROST = 0x9fdcff, HOLY = 0xfff0b0;

/** Effects that aren't skills: hits, crits, level-up, chests, potions, dodges. game.ts and the gallery share them. */
export const GENERIC_VFX: Record<string, Vfx> = {
  hit: ({ f, t }) => f.burst(chest(t, 0.55), 0xffffff, 0.35, 220),
  crit: ({ f, s, t }) => {
    f.burst(chest(t, 0.55), 0xffcc33, 0.7, 320);
    f.slash(chest(t, 0.55), chest(s), 0xffcc33, 1.3);
  },
  levelup: ({ f, s }) => {
    f.pillar(feet(s), GOLD, 1500, 6);
    f.ring(feet(s), GOLD, 3, 900);
    later(250, () => f.ring(feet(s), 0xfff6c0, 4.5, 900));
    f.motes(feet(s), GOLD, 1600, { n: 24, r: 1.2, spin: 3, rise: 4 });
  },
  chest: ({ f, s }) => {
    f.pillar(feet(s), GOLD, 1000, 3);
    f.motes(feet(s), GOLD, 1200, { n: 18, r: 0.8, rise: 2.4 });
    f.burst(chest(s, 0.3), GOLD, 0.8, 400);
  },
  potion: ({ f, s }) => {
    f.motes(feet(s), 0xff5555, 800, { n: 12, r: 0.6, spin: 3, rise: 2 });
    f.p.emit({ cell: 'glow', n: 10, at: chest(s, 0.4), shape: 'sphere', r: 0.4, up: 1.4, size: [0.35, 0.05], life: [500, 800], color: 0xff6a6a, bright: 1.3 });
  },
  dash: ({ f, s }) => {
    f.ring(feet(s), 0xcfe6ff, 1.6, 350);
    f.p.emit({ cell: 'swirl', n: 1, at: chest(s, 0.4), size: [1.2, 2.2], spin: 8, life: 350, color: 0xcfe6ff, alpha: 0.7 });
  },
  escape: ({ f, s }) => {
    f.pillar(feet(s), 0x66aaff, 3000, 4);
    f.rune(feet(s), 1.6, 0x66aaff, 3000);
    f.motes(feet(s), 0x9fd0ff, 3000, { n: 18, r: 1, spin: 2, rise: 3.5 });
  },
};

/** One visual signature per skill id. Unknown ids fall back to the generic per-kind effect in game.ts. */
export const SKILL_VFX: Record<string, Vfx> = {
  // ---- fighter
  power_strike: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), color, 1.9, 320);
    f.burst(chest(t), color, 1.0, 320);
    f.shards(chest(t, 0.4), color, 8, 1.2, 600);
  },
  provoke: ({ f, s, t, color, aoe }) => {
    f.ring(feet(s), color, 1.2, 300);
    f.p.emit({ cell: 'burst', n: 1, at: head(s), size: [0.8, 2], life: 350, color, bright: 1.3 }); // the shout
    later(120, () => {
      f.ring(feet(t), color, aoe, 650);
      f.ring(feet(t), color, aoe * 0.55, 450);
      f.rune(feet(t), aoe * 0.4, color, 800);
    });
    f.motes(feet(t), color, 700, { n: 10, r: 1.2, spin: 3, rise: 0.8 });
  },
  mortal_blow: ({ f, s, t }) => {
    f.slash(chest(t), chest(s), 0xff2a3a, 1.6, 300);
    later(60, () => f.slash(chest(t, 0.5), chest(s), BLOOD, 1.3, 260));
    f.p.emit({ cell: 'glow', n: 14, at: chest(t, 0.7), cone: 1.2, speed: [1.5, 3.5], gravity: 9, size: [0.16, 0.08], life: [500, 900], color: BLOOD, bright: 0.9, floor: t.pos.y + 0.05 }); // blood
  },
  rage: ({ f, s, color }) => {
    f.flame(feet(s), 0.6, 1100, color);
    f.ring(feet(s), color, 2, 500);
    f.p.emit({ cell: 'burst', n: 1, at: chest(s), size: [1, 2.6], life: 400, color, bright: 1.4 });
    f.motes(feet(s), color, 1200, { n: 18, r: 0.7, spin: 6, rise: 2.4, cell: 'glow' });
  },
  whirlwind: ({ f, s, color, aoe }) => {
    f.ring(feet(s), color, aoe, 500);
    for (let i = 0; i < 3; i++) later(i * 120, () => f.p.emit({ cell: 'swirl', n: 1, at: chest(s, 0.4), flat: true, size: [aoe * 0.8, aoe * 1.9], spin: 14, life: 380, color, bright: 1.4 }));
    f.p.emit({ cell: 'streak', n: 24, at: chest(s, 0.4), shape: 'ring', r: 0.6, outward: true, speed: [5, 9], drag: 2, size: 0.35, life: [250, 450], color: 0xffffff, bright: 1.4, stretch: 0.05 });
    f.smoke(feet(s), aoe * 0.3, 800, 0xa89a80, 4);
  },
  iron_will: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.6, 900);
    f.ring(feet(s), color, 1.8, 500);
    f.p.emit({ cell: 'halo', n: 1, at: chest(s), size: [1.4, 2.4], life: 600, color, alpha: 0.6 });
  },
  power_smash: ({ f, t, color }) => {
    f.burst(chest(t), color, 1.2, 380);
    f.ring(feet(t), color, 2.4, 550);
    f.debris(feet(t), 0x8a7a60, 12, 1.8);
    f.stun(head(t));
  },

  // ---- knight
  shield_bash: ({ f, t, color }) => {
    f.dome(chest(t, 0.45), 0xdfe9ff, 0.9, 300);
    f.burst(chest(t), color, 0.8, 260);
    f.stun(head(t));
  },
  challenge: ({ f, t, color, aoe }) => {
    f.pillar(feet(t), color, 1000, 5);
    f.ring(feet(t), color, aoe, 800);
    f.rune(feet(t), aoe * 0.5, color, 1000);
    f.motes(feet(t), color, 900, { n: 16, r: aoe * 0.6, spin: 2, rise: 1.2 });
  },
  fortress: ({ f, s, color }) => {
    f.dome(feet(s), color, 2.4, 1100);
    f.ring(feet(s), color, 2.4, 700);
    later(200, () => f.ring(feet(s), color, 3.2, 600));
    f.p.emit({ cell: 'flare', n: 6, at: feet(s), shape: 'ring', r: 2.2, up: 1.5, size: [0.6, 0.1], life: 900, color: 0xffffff, bright: 1.3 });
  },
  holy_strike: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), color, 1.7, 300);
    f.pillar(feet(t), HOLY, 700, 5);
    f.flash(chest(t), HOLY, 0.9);
  },
  guardian_aura: ({ f, t, color }) => {
    f.rune(feet(t), 1.4, color, 1200);
    f.ring(feet(t), color, 1.8, 500);
    f.motes(feet(t), color, 1100, { n: 14, r: 1.6, spin: 2.5, rise: 0.4, size: 0.9 });
  },
  earthquake: ({ f, s, color, aoe }) => {
    f.ring(feet(s), color, aoe, 600);
    later(150, () => f.ring(feet(s), 0xffcc88, aoe * 0.6, 450));
    f.debris(feet(s), 0x7a6a50, 22, aoe * 0.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      later(i * 60, () => f.debris(feet(s).add(new THREE.Vector3(Math.cos(a) * aoe * 0.5, 0, Math.sin(a) * aoe * 0.5)), 0x7a6a50, 5, 0.8));
    }
    f.light(chest(s, 0.2), 0xffaa66, 8, aoe * 1.5, 500);
  },
  last_stand: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.2, 900);
    f.flame(feet(s), 0.5, 1000, 0xff5544);
    f.motes(feet(s), 0xffaaaa, 1200, { n: 18, r: 0.6, spin: 1, rise: 2.6 });
  },

  // ---- gladiator
  double_slash: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), color, 1.4, 220);
    later(130, () => f.slash(chest(t, 0.45), chest(s), 0xffe9a0, 1.4, 220));
    later(130, () => f.burst(chest(t, 0.5), color, 0.5, 220));
  },
  hamstring: ({ f, s, t, color }) => {
    f.slash(chest(t, 0.25), chest(s, 0.3), color, 1.2, 260); // low cut at the legs
    f.ring(feet(t), color, 1.3, 600);
    f.p.emit({ cell: 'glow', n: 8, at: chest(t, 0.25), cone: 1, speed: [1, 2.5], gravity: 9, size: [0.14, 0.07], life: [400, 700], color: BLOOD, floor: t.pos.y + 0.05 });
  },
  bloodlust: ({ f, s, color }) => {
    f.motes(feet(s), color, 1200, { n: 22, r: 0.9, spin: 10, rise: 1.8, cell: 'glow' });
    f.dome(feet(s), color, 1.3, 800);
    f.p.emit({ cell: 'smoke', n: 6, at: chest(s, 0.4), shape: 'sphere', r: 0.5, up: 0.8, size: [0.8, 1.6], life: 1000, color: 0x5a0a10, alpha: 0.45, solid: true, spin: 1 });
  },
  rend: ({ f, s, t, color }) => {
    [-0.35, 0, 0.35].forEach((dy, i) => later(i * 90, () => f.slash(chest(t, 0.6 + dy), chest(s), color, 1.3, 240)));
    later(270, () => f.p.emit({ cell: 'glow', n: 12, at: chest(t, 0.6), cone: 1.3, speed: [1.5, 3], gravity: 9, size: [0.15, 0.08], life: [500, 800], color: BLOOD, floor: t.pos.y + 0.05 }));
  },
  blade_storm: ({ f, s, color, aoe }) => {
    for (let i = 0; i < 6; i++) {
      later(i * 90, () => {
        const a = (i / 6) * Math.PI * 2;
        const p = chest(s, 0.5).add(new THREE.Vector3(Math.cos(a) * aoe * 0.6, 0, Math.sin(a) * aoe * 0.6));
        f.slash(p, chest(s, 0.5), color, 1.3, 240);
      });
    }
    f.p.emit({ cell: 'swirl', n: 1, at: feet(s).setY(s.pos.y + 0.3), flat: true, size: [aoe, aoe * 2], spin: 12, life: 600, color, bright: 1.3 });
    f.ring(feet(s), color, aoe, 600);
  },
  war_cry: ({ f, s, color, aoe }) => {
    f.p.emit({ cell: 'burst', n: 1, at: head(s), size: [1, 3], life: 450, color, bright: 1.4 });
    f.ring(feet(s), color, 1.5, 400);
    later(180, () => f.ring(feet(s), color, aoe * 0.8, 600));
    later(360, () => f.ring(feet(s), color, aoe, 800));
    f.smoke(feet(s), 1.4, 900, 0x9a8a70, 6);
  },
  execute: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s), 0xffffff, 2.2, 340);
    f.pillar(feet(t), color, 1000, 4);
    f.burst(chest(t), color, 1.6, 500);
    f.p.emit({ cell: 'glow', n: 18, at: chest(t, 0.8), cone: 1.4, speed: [2, 4], gravity: 9, size: [0.18, 0.08], life: [600, 1000], color: 0x6a0010, floor: t.pos.y + 0.05 });
  },

  // ---- mystic
  wind_strike: ({ f, s, t, color }) => {
    f.projectile(chest(s), at(t), color, 320, 0.18);
    f.p.emit({ cell: 'swirl', n: 1, at: chest(s), size: [0.6, 1.6], spin: 10, life: 300, color, alpha: 0.7 });
    later(320, () => {
      f.slash(chest(t), chest(s), color, 1.1, 200);
      f.p.emit({ cell: 'swirl', n: 2, at: chest(t), size: [0.8, 2.2], spin: 12, life: 450, color, alpha: 0.8 });
      f.motes(chest(t), color, 500, { n: 10, r: 0.9, spin: 12, rise: 0.5, cell: 'glow' });
    });
  },
  heal: ({ f, t, color }) => {
    f.rune(feet(t), 0.9, color, 900);
    f.motes(feet(t), color, 900, { n: 16, r: 0.7, spin: 3, rise: 2.4 });
    f.light(chest(t), color, 6, 5, 600);
  },
  ice_bolt: ({ f, s, t, color }) => {
    f.projectile(chest(s), at(t), color, 300, 0.24, 'ice');
    later(300, () => {
      f.flash(chest(t), FROST, 0.6);
      f.shards(chest(t), 0xbfe6ff, 12, 1.4, 700);
      f.frost(feet(t), 1.2, 1400);
    });
  },
  vampiric_touch: ({ f, s, t }) => {
    f.beam(at(t), at(s), 0xaa2266, 700);
    f.p.emit({ cell: 'smoke', n: 6, at: chest(t), shape: 'sphere', r: 0.4, up: 0.5, size: [0.6, 1.4], life: 800, color: 0x3a0a20, alpha: 0.5, solid: true });
    later(500, () => f.motes(chest(s), 0xff5577, 600, { n: 8, r: 0.5, rise: 1.2, cell: 'glow' })); // the stolen life coming back to you
  },
  blessing: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.4, 1000);
    f.p.emit({ cell: 'halo', n: 1, at: above(head(t), 0.25), size: [0.6, 0.9], life: 1000, color: HOLY, bright: 1.3, fadeIn: 0.2 });
    f.motes(feet(t), 0xffffff, 1100, { n: 12, r: 0.8, spin: 1.5, rise: 1.8, size: 0.8 });
  },
  aura_flare: ({ f, s, t, color, aoe }) => {
    f.projectile(chest(s), at(t), color, 300, 0.35);
    later(300, () => {
      f.burst(chest(t), color, 1.6, 500);
      f.ring(feet(t), color, aoe, 650);
      later(160, () => f.ring(feet(t), 0xffffff, aoe * 0.6, 450));
    });
  },
  greater_heal: ({ f, t, color }) => {
    f.pillar(feet(t), color, 1100, 5);
    f.rune(feet(t), 1.3, color, 1100);
    f.motes(feet(t), 0xffffff, 1000, { n: 22, r: 0.5, spin: 2, rise: 3.2, size: 0.8 });
  },

  // ---- sorcerer
  fireball: ({ f, s, t, color }) => {
    f.projectile(chest(s), at(t), color, 340, 0.42, 'fire');
    later(340, () => {
      f.burst(chest(t), FIRE, 1.3, 420);
      f.light(chest(t), FIRE, 18, 10, 500);
      f.p.emit({ cell: 'flame', n: 10, at: chest(t), shape: 'sphere', r: 0.4, outward: true, speed: 2.5, drag: 3, up: 1, size: [1.1, 0.4], life: [300, 550], color: 0xffb040, color1: 0xa01808, bright: 1.3, spin: 1 });
      f.smoke(chest(t, 0.3), 0.7, 1100, 0x3a3532, 5);
      f.p.emit({ cell: 'glow', n: 14, at: chest(t), speed: [2, 5], gravity: 4, drag: 1, size: [0.12, 0.04], life: [600, 1100], color: 0xffaa40, bright: 1.6 }); // embers
    });
  },
  frost_nova: ({ f, s, color, aoe }) => {
    f.flash(chest(s, 0.4), FROST, 1);
    f.ring(feet(s), color, aoe, 550);
    f.shards(feet(s), 0xd8f4ff, 18, aoe * 0.7, 800);
    f.dome(feet(s), color, aoe * 0.9, 600);
    f.frost(feet(s), aoe * 0.9, 2200);
  },
  arcane_power: ({ f, s, color }) => {
    f.rune(feet(s), 1.4, color, 1300);
    f.ring(feet(s), color, 1.3, 600);
    later(150, () => f.ring(feet(s), color, 1.9, 700));
    f.motes(feet(s), color, 1200, { n: 12, r: 1.1, spin: 2.5, rise: 2.0, size: 0.7 });
    f.p.emit({ cell: 'halo', n: 1, at: chest(s), size: [1, 2.4], life: 700, color, alpha: 0.6 });
  },
  lightning: ({ f, t, color }) => {
    f.p.emit({ cell: 'smoke', n: 5, at: above(chest(t), 8), shape: 'disc', r: 1.5, size: [2.5, 3.5], life: 900, color: 0x30303a, alpha: 0.5, solid: true, fadeIn: 0.3 }); // the cloud it falls from
    later(120, () => {
      f.bolt(above(chest(t), 9), chest(t), color, 280);
      later(280, () => {
        f.burst(chest(t), 0xffffff, 0.8, 260);
        f.stun(head(t), 1400);
      });
    });
  },
  meteor: ({ f, t, color, aoe }) => {
    f.rune(feet(t), aoe * 0.6, 0xff5522, 900); // where it will land
    f.projectile(above(chest(t), 14).add(new THREE.Vector3(3, 0, 2)), at(t, 0.1), color, 800, 0.9, 'fire');
    later(800, () => {
      f.burst(chest(t, 0.3), FIRE, 1.5, 650);
      f.light(chest(t, 0.4), FIRE, 22, aoe * 3, 900);
      f.ring(feet(t), 0xffaa33, aoe, 700);
      f.debris(feet(t), 0x4a3a30, 18, aoe * 0.5);
      f.flame(feet(t), aoe * 0.4, 1500, FIRE);
      f.p.emit({ cell: 'burst', n: 1, at: feet(t).setY(t.pos.y + 0.1), flat: true, size: [aoe, aoe * 1.4], life: 2500, color: 0x1a1008, alpha: 0.8, solid: true, fadeIn: 0 }); // scorch mark
      f.smoke(feet(t), aoe * 0.45, 2000, 0x2e2a28, 9);
    });
  },
  soul_drain: ({ f, s, t, color }) => {
    f.beam(at(t), at(s), color, 900);
    f.projectile(chest(t), at(s), color, 600, 0.3, 'dark');
    f.motes(feet(t), color, 900, { n: 14, r: 0.6, spin: 4, rise: 2.2, size: 0.8 });
  },
  inferno: ({ f, t, color, aoe }) => {
    f.rune(feet(t), aoe * 0.5, FIRE, 600);
    later(250, () => {
      f.flame(feet(t), aoe * 0.45, 1800, color);
      f.pillar(feet(t), color, 1200, 7);
      f.burst(chest(t), color, 1.8, 500);
      f.ring(feet(t), 0xffaa00, aoe, 800);
      f.light(chest(t), FIRE, 24, aoe * 2.5, 1600);
      f.smoke(above(feet(t), 2), aoe * 0.5, 2400, 0x242020, 10);
    });
  },

  // ---- cleric
  divine_heal: ({ f, t, color }) => {
    f.p.emit({ cell: 'halo', n: 1, at: above(head(t), 0.4), size: [0.8, 1.6], life: 900, color: HOLY, bright: 1.3, fadeIn: 0.2 });
    f.ring(head(t), color, 1.0, 700);
    f.motes(above(head(t), 0.6), color, 1100, { n: 16, r: 0.9, spin: 1, rise: 0, fall: 1.4, cell: 'glow' }); // petals drifting down
    f.light(chest(t), HOLY, 6, 5, 700);
  },
  holy_shield: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.5, 1100);
    f.ring(feet(t), color, 1.6, 600);
  },
  smite: ({ f, t, color }) => {
    f.pillar(feet(t), HOLY, 380, 4);
    f.flash(chest(t), color, 1);
    f.burst(chest(t), color, 1, 300);
    f.stun(head(t), 1000);
  },
  might: ({ f, t, color }) => {
    f.ring(feet(t), color, 1.4, 400);
    later(120, () => f.ring(feet(t), color, 2.2, 500));
    f.p.emit({ cell: 'burst', n: 1, at: chest(t), size: [0.8, 2.2], life: 400, color, bright: 1.4 });
    f.motes(feet(t), color, 600, { n: 12, r: 0.5, spin: 0, rise: 1.2, size: 1.2, cell: 'flare' });
  },
  restoration: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.3, 1000);
    f.motes(feet(t), color, 1500, { n: 18, r: 1.2, spin: 1, rise: 2.8, size: 0.9 });
    f.p.emit({ cell: 'glow', n: 20, at: feet(t), shape: 'disc', r: 1.1, up: 1.5, size: [0.3, 0], life: [800, 1300], color: hot(color), bright: 1.2 });
  },
  haste: ({ f, t, color }) => {
    f.motes(feet(t), color, 900, { n: 18, r: 1.0, spin: 14, rise: 0.4, cell: 'glow' });
    f.ring(feet(t), color, 1.5, 350);
    f.p.emit({ cell: 'streak', n: 14, at: feet(t), shape: 'disc', r: 0.7, up: 5, size: 0.35, life: 450, color: 0xffffff, bright: 1.4, stretch: 0.05 });
  },
  miracle: ({ f, t }) => {
    f.pillar(feet(t), 0xffffff, 1800, 9);
    f.rune(feet(t), 2.4, 0xfff0b0, 1800);
    f.ring(feet(t), 0xfff0b0, 3, 900);
    later(200, () => f.ring(feet(t), 0xffb0e0, 4, 1100));
    f.motes(feet(t), 0xffffff, 1800, { n: 30, r: 1.4, spin: 2, rise: 3.5 });
    f.light(chest(t), HOLY, 20, 14, 1600);
    f.p.emit({ cell: 'flare', n: 1, at: above(head(t), 3), size: [4, 1.5], life: 1200, color: 0xffffff, bright: 1.6 });
  },

  // ---- racial and gender
  second_wind: ({ f, s, color }) => {
    f.ring(feet(s), color, 1.2, 350);
    f.p.emit({ cell: 'swirl', n: 2, at: chest(s, 0.4), size: [0.8, 2], spin: 9, life: 500, color, alpha: 0.7 });
    f.motes(feet(s), color, 700, { n: 10, r: 1.2, spin: 6, rise: 1.2 });
  },
  wind_walk: ({ f, s, color }) => {
    f.ring(feet(s), color, 1.3, 300);
    f.p.emit({ cell: 'swirl', n: 3, at: feet(s).setY(s.pos.y + 0.2), flat: true, size: [0.8, 2.4], spin: 10, life: 600, color, alpha: 0.7 });
    f.motes(feet(s), color, 800, { n: 12, r: 1.0, spin: 12, rise: 0.2, size: 0.6, cell: 'glow' });
  },
  shadow_bite: ({ f, s, t, color }) => {
    f.projectile(chest(t), at(s), color, 400, 0.25, 'dark');
    f.p.emit({ cell: 'glow', n: 12, at: feet(t), shape: 'disc', r: 0.5, up: 1.6, size: [0.2, 0.32], life: [600, 1100], color: 0x88ff66, bright: 1.1 }); // poison bubbles
  },
  battle_roar: ({ f, s, color }) => {
    f.burst(chest(s), color, 0.9, 350);
    f.ring(feet(s), color, 2.5, 500);
    later(160, () => f.ring(feet(s), color, 4, 600));
    f.smoke(feet(s), 1.5, 900, 0x9a8a70, 8);
  },
  stone_skin: ({ f, s, color }) => {
    f.motes(chest(s, 0.5), color, 1000, { n: 8, r: 1.0, spin: 3, rise: 0, size: 1.6, cell: 'debris' }); // orbiting rocks
    f.dome(feet(s), 0xaa8866, 1.2, 900);
    f.smoke(feet(s), 0.8, 800, 0x8a7a64, 5);
  },
  endure: ({ f, s, color }) => {
    f.burst(chest(s), color, 0.8, 300);
    f.ring(feet(s), color, 1.6, 500);
    f.p.emit({ cell: 'halo', n: 1, at: chest(s), size: [1, 2], life: 500, color, alpha: 0.6 });
  },
  grace: ({ f, s, color }) => {
    f.motes(feet(s), color, 1200, { n: 16, r: 0.8, spin: 1.5, rise: 1.5, size: 0.9 });
    f.dome(feet(s), color, 1.1, 800);
  },
};

function hot(c: number) {
  return new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.5).getHex();
}
