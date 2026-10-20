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
  // a Force charge gathered by a hit with a pair of swords
  charge: ({ f, s }) => {
    f.p.emit({ cell: 'flare', n: 1, at: chest(s, 0.55), size: [0.3, 1.1], life: 320, color: 0x6ab8ff, bright: 1.6, spin: 6 });
    f.motes(chest(s, 0.35), 0x6ab8ff, 500, { n: 6, r: 0.5, spin: 6, rise: 0.8, cell: 'glow' });
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

  // ---- gladiator: a pair of swords and its Force charges; the sonic skills throw blue shockwaves
  sonic_focus: ({ f, s, color }) => {
    // the force drawn in round the body, then held: one more charge
    f.motes(feet(s), color, 800, { n: 16, r: 1, spin: 8, rise: 1.4, cell: 'glow' });
    f.ring(feet(s), color, 1.2, 400);
    later(380, () => f.burst(chest(s, 0.55), color, 0.55, 300));
  },
  triple_slash: ({ f, s, t, color }) => {
    // right, left, then both blades together: three cuts crossing on the target
    f.slash(chest(t), chest(s).add(new THREE.Vector3(1, 0.7, 0)), color, 1.6, 240);
    later(120, () => f.slash(chest(t), chest(s).add(new THREE.Vector3(-1, 0.7, 0)), color, 1.6, 240));
    later(240, () => {
      f.slash(chest(t, 0.5), chest(s), 0xffffff, 2, 280);
      f.burst(chest(t), color, 0.8, 300);
    });
  },
  double_sonic_slash: ({ f, s, t, color }) => {
    f.slash(chest(t), chest(s).add(new THREE.Vector3(1, 0.7, 0)), color, 1.9, 280);
    later(130, () => f.slash(chest(t), chest(s).add(new THREE.Vector3(-1, 0.7, 0)), color, 1.9, 280));
    later(130, () => sonicBurst(f, chest(t), color, 1));
  },
  sonic_blaster: ({ f, s, t, color }) => {
    // a crescent of force flung from the blades at the target
    f.slash(chest(s, 0.55).add(new THREE.Vector3(0, 0.2, 0)), chest(s), color, 1.2, 200);
    f.projectile(chest(s, 0.55), at(t), color, 320, 0.45, 'ice');
    later(320, () => sonicBurst(f, chest(t), color, 0.9));
  },
  war_roar: ({ f, s, color }) => {
    f.p.emit({ cell: 'burst', n: 1, at: head(s), size: [1, 3], life: 450, color, bright: 1.4 }); // the roar
    f.ring(feet(s), color, 1.6, 400);
    later(160, () => f.ring(feet(s), color, 3.2, 600));
    f.flame(feet(s), 0.6, 1000, color);
    f.smoke(feet(s), 1.2, 900, 0x9a8a70, 5);
  },
  sonic_storm: ({ f, s, t, color, aoe }) => {
    // waves thrown at the spot, bursting over the whole area
    f.projectile(chest(s, 0.55), at(t), color, 340, 0.5, 'ice');
    later(340, () => {
      sonicBurst(f, chest(t, 0.4), color, 1.2);
      f.ring(feet(t), color, aoe, 600);
      later(140, () => f.ring(feet(t), 0xcfeaff, aoe * 0.6, 500));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.random(), r = aoe * (0.3 + Math.random() * 0.4);
        later(i * 70, () => sonicBurst(f, chest(t, 0.4).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), color, 0.6));
      }
    });
  },
  sonic_guard: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.4, 800);
    f.p.emit({ cell: 'slash', n: 4, at: chest(s, 0.55), shape: 'ring', r: 0.9, size: [1, 1.4], spin: 14, life: 500, color, bright: 1.3 }); // the blades whirling to guard
    f.ring(feet(s), color, 1.6, 400);
  },
  triple_sonic_slash: ({ f, s, t, color }) => {
    [[1, 0.7], [-1, 0.7], [0, 1.4]].forEach(([x, y], i) => later(i * 110, () => f.slash(chest(t), chest(s).add(new THREE.Vector3(x, y, 0)), color, 2.1, 280)));
    later(330, () => {
      sonicBurst(f, chest(t), color, 1.3);
      f.shards(chest(t), 0xcfeaff, 12, 1.4, 700);
    });
  },
  sonic_buster: ({ f, s, t, color }) => {
    // both blades down at once: the wave hammers the target to the ground
    f.slash(chest(t), above(chest(s), 1.2), color, 2.2, 300);
    later(120, () => {
      sonicBurst(f, chest(t, 0.5), color, 1.2);
      f.ring(feet(t), color, 2.2, 500);
      f.debris(feet(t), 0x8a7a60, 10, 1.4);
      f.stun(head(t));
    });
  },
  sonic_move: ({ f, s, color }) => {
    f.ring(feet(s), color, 1.6, 350);
    f.p.emit({ cell: 'swirl', n: 1, at: chest(s, 0.4), size: [1.2, 2.2], spin: 8, life: 400, color, alpha: 0.7 });
    f.motes(feet(s), color, 900, { n: 12, r: 0.6, spin: 4, rise: 0.4, cell: 'streak' });
    f.dust(feet(s), 500);
  },
  dual_blade_dance: ({ f, s, color, aoe }) => {
    // spinning with both blades out: cuts all round, and the blood they draw
    f.p.emit({ cell: 'slash', n: 6, at: chest(s, 0.5), shape: 'ring', r: aoe * 0.35, size: [1.2, 1.8], spin: 12, life: 500, color, bright: 1.3 });
    for (let i = 0; i < 2; i++) later(i * 160, () => f.p.emit({ cell: 'swirl', n: 1, at: chest(s, 0.4), flat: true, size: [aoe * 0.7, aoe * 1.6], spin: 14, life: 380, color, bright: 1.3 }));
    f.ring(feet(s), color, aoe, 500);
    later(200, () => f.shards(chest(s, 0.5), BLOOD, 16, aoe * 0.6, 700));
  },
  sonic_rage: ({ f, s, color }) => {
    // every charge at once: the force flares up round the body
    f.pillar(feet(s), color, 900, 3.5);
    f.p.emit({ cell: 'burst', n: 1, at: chest(s), size: [1, 2.8], life: 420, color, bright: 1.5 });
    f.motes(feet(s), color, 1200, { n: 22, r: 0.9, spin: 9, rise: 2.4, cell: 'flare' });
    f.light(chest(s), color, 10, 6, 600);
  },
  storm_slash: ({ f, s, t, color }) => {
    // the blades crossed and swept down: a storm of force on one target
    f.slash(chest(t), chest(s).add(new THREE.Vector3(1.2, 1, 0)), color, 2.4, 320);
    f.slash(chest(t), chest(s).add(new THREE.Vector3(-1.2, 1, 0)), color, 2.4, 320);
    later(150, () => {
      sonicBurst(f, chest(t), color, 1.5);
      f.bolt(above(feet(t), 6), chest(t), 0xcfeaff, 260);
      f.flash(chest(t), 0xcfeaff, 1.2);
    });
  },

  // ---- Duelist (76-78)
  duelist_spirit: ({ f, s, color }) => {
    f.flame(feet(s), 0.6, 1100, color);
    f.p.emit({ cell: 'halo', n: 1, at: chest(s), size: [1.2, 2.6], life: 800, color, alpha: 0.7 });
    f.motes(feet(s), color, 1200, { n: 16, r: 0.8, spin: 5, rise: 2.4, cell: 'flare' });
    f.ring(feet(s), color, 2.2, 500);
  },
  sonic_barrier: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.7, 1000);
    later(150, () => f.dome(feet(s), 0xcfeaff, 1.4, 800));
    f.ring(feet(s), color, 2, 500);
    f.p.emit({ cell: 'flare', n: 6, at: feet(s), shape: 'ring', r: 1.6, up: 1.5, size: [0.6, 0.1], life: 900, color: 0xffffff, bright: 1.3 });
  },
  thousand_sonic_slashes: ({ f, s, t, color }) => {
    // cut after cut, faster than the eye, then every charge let go at once
    for (let k = 0; k < 10; k++) {
      later(k * 55, () => {
        const a = k * 1.9, spot = chest(t).add(new THREE.Vector3(Math.cos(a) * 0.25, ((k % 3) - 1) * 0.3, Math.sin(a) * 0.25));
        f.slash(spot, chest(s).add(new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a))), k % 2 ? 0xffffff : color, 1.7, 220);
      });
    }
    later(560, () => {
      sonicBurst(f, chest(t), color, 1.8);
      f.ring(feet(t), color, 3, 600);
      f.light(chest(t), color, 18, 10, 700);
      f.stun(head(t), 2000);
    });
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

  // ---- knight 55-75
  aegis_charge: ({ f, s, t, color }) => {
    f.projectile(chest(s, 0.5), at(t, 0.5), color, 180, 0.55, 'none'); // the shield, thrown forward with the body behind it
    later(180, () => {
      f.burst(chest(t), color, 1.3, 350);
      f.ring(feet(t), color, 2.2, 450);
      f.shards(chest(t), 0xffffff, 10, 1.4, 500);
      f.stun(head(t), 2000);
    });
  },
  iron_bulwark: ({ f, s, color }) => {
    f.dome(feet(s), color, 1.6, 1200);
    f.ring(feet(s), color, 1.4, 600);
    later(150, () => f.ring(feet(s), color, 2, 700));
    f.motes(chest(s, 0.5), 0x9aa8bc, 1100, { n: 6, r: 1.1, spin: 2, rise: 0, size: 1.4, cell: 'debris' }); // iron plates closing in
  },
  judgment: ({ f, t, color, aoe }) => {
    f.pillar(feet(t), HOLY, 500, 8);
    later(200, () => {
      f.flash(chest(t), color, 1.2);
      f.burst(chest(t), GOLD, 1.4, 450);
      f.rune(feet(t), aoe * 0.6, color, 900);
      f.ring(feet(t), color, aoe, 700);
    });
  },
  shield_of_faith: ({ f, t, color, aoe }) => {
    f.dome(feet(t), color, 1.8, 1200);
    f.rune(feet(t), 1.6, color, 1200);
    f.ring(feet(t), color, aoe * 0.7, 900); // reaching the party around
    f.motes(feet(t), color, 1200, { n: 16, r: 1.2, spin: 1.5, rise: 2.4, size: 0.8 });
  },
  titan_slam: ({ f, s, t, color, aoe }) => {
    f.burst(feet(s), color, 1.6, 500);
    f.ring(feet(s), 0xd8c090, aoe, 700);
    later(120, () => f.ring(feet(s), color, aoe * 0.6, 600));
    f.debris(feet(s), 0x6a5a40, 24, aoe * 0.6);
    f.smoke(feet(s), aoe * 0.5, 1400, 0x8a7a64, 10);
    f.light(chest(s, 0.3), 0xffd090, 12, aoe * 2, 500);
    f.stun(head(t), 2000);
  },

  // ---- sorcerer 55-75
  chain_lightning: ({ f, s, t, color, aoe }) => {
    f.bolt(above(chest(s), 0.5), chest(t), color, 260);
    later(140, () => {
      // it forks on to whatever stands near the target
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + 0.4, end = chest(t).add(new THREE.Vector3(Math.cos(a) * aoe * 0.6, -0.3, Math.sin(a) * aoe * 0.6));
        f.bolt(chest(t), end, color, 220);
        f.burst(end, color, 0.5, 250);
      }
      f.stun(head(t), 1000);
    });
    f.light(chest(t), color, 10, 8, 400);
  },
  blizzard: ({ f, t, color, aoe }) => {
    f.p.emit({ cell: 'smoke', n: 8, at: above(feet(t), 7), shape: 'disc', r: aoe * 0.7, size: [3, 4.5], life: 2000, color: 0x8aa0b8, alpha: 0.5, solid: true, fadeIn: 0.3 }); // the storm cloud
    f.p.emit({ cell: 'streak', n: 110, at: above(feet(t), 6), shape: 'disc', r: aoe * 0.8, dir: new THREE.Vector3(0.2, -1, 0.1), speed: [8, 12], size: 0.4, life: [600, 1000], color: 0xeaf6ff, bright: 1.4, stretch: 0.06 });
    f.p.emit({ cell: 'puff', n: 14, at: above(feet(t), 0.6), shape: 'disc', r: aoe * 0.7, size: [1.6, 2.6], life: [900, 1500], color: 0xdff0ff, alpha: 0.55 }); // swirling snow at the ground
    later(200, () => {
      f.frost(feet(t), aoe * 0.8, 2600);
      f.ring(feet(t), color, aoe, 900);
    });
  },
  mana_surge: ({ f, s, color }) => {
    f.pillar(feet(s), color, 900, 5);
    f.rune(feet(s), 1.6, color, 1200);
    f.motes(feet(s), color, 1200, { n: 20, r: 1.3, spin: 6, rise: 2.2, size: 0.8 });
    f.p.emit({ cell: 'halo', n: 1, at: chest(s), size: [1, 2.6], life: 800, color, alpha: 0.6 });
  },
  void_bolt: ({ f, s, t, color }) => {
    f.projectile(chest(s), at(t), color, 450, 0.45, 'dark');
    later(450, () => {
      f.burst(chest(t), 0x2a0a4a, 1.2, 500);
      f.p.emit({ cell: 'swirl', n: 2, at: chest(t), size: [0.6, 2.2], spin: -9, life: 600, color, alpha: 0.8 });
      f.flash(chest(t), color, 0.8);
    });
  },
  apocalypse: ({ f, t, color, aoe }) => {
    f.rune(feet(t), aoe * 0.6, FIRE, 1400);
    // meteors fall all over the area, one after another
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4, r = aoe * 0.75 * Math.sqrt((k + 0.5) / 7), spot = feet(t).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      later(200 + k * 170, () => {
        f.projectile(above(spot, 14).add(new THREE.Vector3(2, 0, 1)), () => spot, color, 600, 0.6, 'fire');
        later(600, () => {
          f.burst(above(spot, 0.4), FIRE, 1.2, 450);
          f.flame(spot, 1.2, 1400, FIRE);
          f.debris(spot, 0x4a3a30, 8, 1.2);
        });
      });
    }
    later(800, () => f.light(chest(t), FIRE, 26, aoe * 3, 2000));
    later(1400, () => f.smoke(feet(t), aoe * 0.5, 2400, 0x2a2420, 10));
  },

  // ---- cleric 55-75
  mass_heal: ({ f, t, color, aoe }) => {
    f.ring(feet(t), color, aoe * 0.6, 900);
    f.dome(feet(t), hot(color), 1.4, 1000);
    f.motes(feet(t), color, 1500, { n: 30, r: aoe * 0.4, spin: 1, rise: 2.5, size: 0.9 });
    f.p.emit({ cell: 'glow', n: 24, at: feet(t), shape: 'disc', r: aoe * 0.4, up: 1.6, size: [0.3, 0], life: [800, 1300], color, bright: 1.2 });
  },
  sanctuary: ({ f, t, color }) => {
    f.dome(feet(t), color, 1.8, 1400);
    f.rune(feet(t), 1.8, HOLY, 1400);
    f.pillar(feet(t), HOLY, 900, 4);
    f.light(chest(t), HOLY, 8, 6, 900);
  },
  holy_nova: ({ f, s, t, color, aoe }) => {
    f.flash(chest(s), color, 1.5);
    f.ring(feet(s), HOLY, aoe, 600);
    later(120, () => f.ring(feet(s), 0xffffff, aoe * 0.6, 500));
    f.p.emit({ cell: 'streak', n: 24, at: chest(s, 0.5), shape: 'sphere', r: 0.3, outward: true, speed: [10, 14], size: 0.4, life: 400, color, bright: 1.4, stretch: 0.06 });
    f.stun(head(t), 1000);
  },
  blessing_of_ages: ({ f, t, color, aoe }) => {
    f.p.emit({ cell: 'halo', n: 1, at: above(head(t), 0.5), size: [1, 2], life: 1200, color, bright: 1.3 });
    f.ring(feet(t), color, aoe * 0.5, 900);
    later(200, () => f.ring(feet(t), color, aoe * 0.75, 900));
    f.motes(feet(t), GOLD, 1400, { n: 20, r: 1.2, spin: 2, rise: 3, size: 0.8, cell: 'star' });
  },
  divine_light: ({ f, t }) => {
    f.pillar(feet(t), 0xffffff, 1400, 10);
    f.flash(chest(t), 0xffffff, 1.4);
    f.p.emit({ cell: 'flare', n: 1, at: above(head(t), 2.5), size: [3, 1.2], life: 1000, color: 0xffffff, bright: 1.6 });
    f.motes(above(head(t), 1), HOLY, 1300, { n: 18, r: 0.9, spin: 1, rise: 0, fall: 1.6, cell: 'glow' });
    f.light(chest(t), HOLY, 18, 12, 1400);
  },

  // ---- Phoenix Paladin (76-78)
  phoenix_ward: ({ f, s, color }) => {
    f.flame(feet(s), 1.2, 1600, 0xff7a1a);
    f.dome(feet(s), color, 1.6, 1400);
    f.motes(feet(s), 0xffc060, 1600, { n: 22, r: 1.1, spin: 3, rise: 3, size: 0.8, cell: 'flare' });
    f.light(chest(s), FIRE, 14, 8, 1600);
  },
  phoenix_strike: ({ f, s, t, color, aoe }) => {
    f.projectile(above(chest(s), 3), at(t), color, 350, 0.7, 'fire'); // the firebird dives
    later(350, () => {
      f.burst(chest(t), FIRE, 1.6, 500);
      f.ring(feet(t), 0xffaa33, aoe, 700);
      f.flame(feet(t), aoe * 0.4, 1600, color);
      f.p.emit({ cell: 'swirl', n: 3, at: chest(t), size: [1, 3], spin: 7, life: 700, color: 0xffb050, alpha: 0.8 });
      f.light(chest(t), FIRE, 18, aoe * 2.5, 900);
    });
  },
  rebirth: ({ f, s }) => {
    f.pillar(feet(s), 0xff8a2a, 1800, 9);
    f.flame(feet(s), 1.5, 2000, FIRE);
    f.ring(feet(s), FIRE, 3, 900);
    later(300, () => f.ring(feet(s), 0xffd080, 4.5, 1000));
    f.motes(feet(s), 0xffd080, 2000, { n: 30, r: 1.4, spin: 2.5, rise: 4, size: 1, cell: 'flare' });
    f.light(chest(s), FIRE, 24, 14, 1800);
    f.p.emit({ cell: 'flare', n: 1, at: above(head(s), 2.5), size: [4, 1.5], life: 1200, color: 0xffb040, bright: 1.6 });
  },

  // ---- Archmage (76-78)
  arcane_mastery: ({ f, s, color }) => {
    f.rune(feet(s), 2.2, color, 1600);
    later(150, () => f.rune(feet(s), 1.4, hot(color), 1400));
    f.pillar(feet(s), color, 1200, 7);
    f.motes(chest(s, 0.5), color, 1600, { n: 10, r: 1.4, spin: 3, rise: 0, size: 1.2, cell: 'star' }); // stars in orbit
    f.p.emit({ cell: 'halo', n: 1, at: chest(s), size: [1.2, 2.8], life: 900, color, alpha: 0.6 });
  },
  star_fall: ({ f, t, color, aoe }) => {
    f.rune(feet(t), aoe * 0.6, color, 1800);
    for (let k = 0; k < 10; k++) {
      const a = k * 2.4, r = aoe * 0.75 * Math.sqrt((k + 0.5) / 10), spot = feet(t).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      later(k * 140, () => {
        f.projectile(above(spot, 16).add(new THREE.Vector3(-3, 0, 2)), () => spot, 0xd0e0ff, 500, 0.35, 'magic');
        later(500, () => {
          f.burst(above(spot, 0.3), color, 0.9, 400);
          f.ring(spot, color, 1.6, 400);
        });
      });
    }
    later(600, () => f.light(chest(t), color, 16, aoe * 2.5, 1600));
  },
  oblivion: ({ f, t, color }) => {
    f.p.emit({ cell: 'swirl', n: 3, at: chest(t), size: [2.4, 0.4], spin: -12, life: 900, color, alpha: 0.9 }); // a vortex closing on itself
    f.dome(feet(t), 0x1a0a2a, 1.4, 900);
    later(800, () => {
      f.flash(chest(t), 0xc080ff, 1.6);
      f.burst(chest(t), 0x2a0a3a, 1.8, 600);
      f.ring(feet(t), color, 3, 600);
      f.stun(head(t), 2000);
    });
  },

  // ---- Hierophant (76-78)
  divine_grace: ({ f, t, color, aoe }) => {
    f.pillar(feet(t), 0xfff4c0, 1200, 7);
    f.ring(feet(t), color, aoe * 0.6, 1000);
    later(250, () => f.ring(feet(t), color, aoe * 0.85, 1000));
    f.motes(above(head(t), 1), 0xffffff, 1600, { n: 24, r: 1.6, spin: 1, rise: 0, fall: 1.6, cell: 'glow' }); // feathers drifting down
    f.p.emit({ cell: 'halo', n: 1, at: above(head(t), 0.5), size: [1.2, 2.4], life: 1400, color, bright: 1.3 });
  },
  sacred_judgment: ({ f, t, color, aoe }) => {
    f.p.emit({ cell: 'smoke', n: 5, at: above(chest(t), 8), shape: 'disc', r: aoe * 0.5, size: [2.5, 3.5], life: 1000, color: 0xd8c890, alpha: 0.45, solid: true, fadeIn: 0.3 }); // the sky opens
    later(200, () => {
      for (let k = 0; k < 5; k++) {
        const a = k * 1.256, spot = feet(t).add(new THREE.Vector3(Math.cos(a) * aoe * 0.5, 0, Math.sin(a) * aoe * 0.5));
        f.pillar(spot, HOLY, 600, 9);
      }
      f.pillar(feet(t), 0xffffff, 700, 10);
      f.flash(chest(t), color, 1.4);
      f.ring(feet(t), color, aoe, 700);
      f.stun(head(t), 1500);
    });
  },
  grand_miracle: ({ f, t, aoe }) => {
    f.pillar(feet(t), 0xffffff, 2200, 12);
    f.rune(feet(t), aoe * 0.4, 0xfff0b0, 2200);
    f.ring(feet(t), 0xfff0b0, aoe * 0.5, 1000);
    later(250, () => f.ring(feet(t), 0xffb0e0, aoe * 0.8, 1200));
    later(500, () => f.ring(feet(t), 0xb0e0ff, aoe, 1400));
    f.motes(feet(t), 0xffffff, 2200, { n: 40, r: aoe * 0.4, spin: 2, rise: 4 });
    f.light(chest(t), HOLY, 26, 18, 2000);
    f.p.emit({ cell: 'flare', n: 1, at: above(head(t), 3.5), size: [5, 2], life: 1400, color: 0xffffff, bright: 1.7 });
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

/** Where a sonic wave lands: a ring of force bursting outwards, white at its heart. */
function sonicBurst(f: FxManager, p: THREE.Vector3, color: number, size: number) {
  f.burst(p, color, size, 380);
  f.p.emit({ cell: 'ring', n: 1, at: p, size: [size * 0.4, size * 2.6], life: 380, color: 0xcfeaff, bright: 1.4, fadeIn: 0 });
  f.p.emit({ cell: 'ring', n: 1, at: p, flat: true, size: [size * 0.5, size * 3], life: 450, color, bright: 1.3, fadeIn: 0 });
}

function hot(c: number) {
  return new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.5).getHex();
}
