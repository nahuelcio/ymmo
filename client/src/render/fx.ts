import * as THREE from 'three';
import { heightAt } from '../../../shared/src/terrain';
import { Particles, type Cell } from './particles';

interface Fx {
  obj: THREE.Object3D | null;
  t0: number;
  dur: number;
  update: (k: number, dt: number) => void;
}

// Mesh geometries (pillars, domes, telegraphs) are shared by every effect instance; only materials are per-effect.
const GEO = {
  pillar: new THREE.CylinderGeometry(0.9, 0.9, 1, 16, 1, true),
  disc: new THREE.CircleGeometry(1, 40),
  edge: new THREE.RingGeometry(0.96, 1, 64),
  dome: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
};

/** fast start, soft landing: expansions read as an impact instead of a slow inflate */
const out = (k: number) => 1 - (1 - k) ** 3;
const V = () => new THREE.Vector3();
/** a colour pulled toward white: the hot core of a glow */
const hot = (c: number, k = 0.6) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();
const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
export type Trail = 'magic' | 'fire' | 'ice' | 'dark' | 'holy' | 'none';

/**
 * Spell and combat effects: textured particles (render/particles.ts) for glow, sparks, fire, smoke and dirt,
 * a few meshes where a solid shape reads better (columns of light, wards, telegraphs), and short flashes
 * of real light (game.ts wires onLight to the lamp pool, render/atmos.ts LocalLights.flash).
 */
export class FxManager {
  private list: Fx[] = [];
  readonly p: Particles;
  /** a brief point light: position, colour, power, range (m), duration (ms) */
  onLight: ((at: THREE.Vector3, color: number, power: number, range: number, ms: number) => void) | null = null;
  private last = performance.now();
  private dustAt: number[] = [];
  /**
   * Finished mesh effects hand their materials back here instead of disposing them: a fresh material costs the
   * renderer a shader lookup on its first draw. Keyed by blending; colour and opacity are set on every reuse.
   */
  private pool = new Map<string, THREE.MeshBasicMaterial[]>();

  constructor(private scene: THREE.Scene) {
    this.p = new Particles(scene);
  }

  private basic(color: number, opacity: number, side: THREE.Side, blending: THREE.Blending): THREE.MeshBasicMaterial {
    const key = `${side}|${blending}`;
    const m = this.pool.get(key)?.pop() ?? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side, blending });
    m.userData.pool = key;
    m.color.set(color);
    m.opacity = opacity;
    return m;
  }
  private glow(color: number, opacity = 0.9, side: THREE.Side = THREE.FrontSide) {
    return this.basic(color, opacity, side, THREE.AdditiveBlending);
  }

  /** Runs update(k, dt) every frame for dur ms; obj (if any) is in the scene meanwhile. */
  private add(obj: THREE.Object3D | null, dur: number, update: (k: number, dt: number) => void) {
    if (obj) this.scene.add(obj);
    this.list.push({ obj, t0: performance.now(), dur, update });
  }
  /** emits `perSec` particles a second over an effect's frames, whatever the frame rate */
  private rate(perSec: number) {
    let acc = 0;
    return (dt: number) => {
      acc += perSec * dt;
      const n = Math.floor(acc);
      acc -= n;
      return n;
    };
  }
  light(at: THREE.Vector3, color: number, power: number, range: number, ms: number) {
    this.onLight?.(at, color, power, range, ms);
  }

  // ---------------------------------------------------------------- building blocks

  /** A blinding point: white core, coloured glow and a little light. */
  flash(at: THREE.Vector3, color: number, r = 1, light = true) {
    this.p.emit({ cell: 'glow', n: 1, at, size: [r * 2, r * 2.8], life: 150, color: 0xffffff, bright: 1.25, fadeIn: 0 });
    this.p.emit({ cell: 'flare', n: 1, at, size: [r * 3, r * 1.5], life: 220, color: hot(color, 0.3), bright: 1.4, fadeIn: 0 });
    this.p.emit({ cell: 'glow', n: 1, at, size: [r * 3, r * 4.5], life: 420, color, alpha: 0.6, fadeIn: 0 });
    if (light) this.light(at, color, 10 * r, 8 * r, 380);
  }

  /** A glowing bolt with a hot core, a halo and a trail (magic sparkles, fire and smoke, frost, shadow or light). */
  projectile(from: THREE.Vector3, to: () => THREE.Vector3, color: number, dur = 300, size = 0.25, trail: Trail = 'magic') {
    const start = from.clone(), cur = V(), prev = from.clone(), vel = V();
    const at = (v: THREE.Vector3, k: number) => {
      v.lerpVectors(start, to(), k);
      v.y += Math.sin(k * Math.PI) * 0.6;
    };
    const tr = this.rate(trail === 'none' ? 0 : 110 * Math.max(0.6, size * 3));
    this.add(null, dur, (k, dt) => {
      at(cur, k);
      vel.subVectors(cur, prev).divideScalar(Math.max(dt, 1e-3));
      const life = Math.max(45, dt * 2600);
      this.p.emit({ cell: 'glow', n: 1, at: cur, size: size * 3.2, life, color, bright: 1.5, hold: true, jitter: 0.1 });
      this.p.emit({ cell: 'glow', n: 1, at: cur, size: size * 1.3, life, color: 0xffffff, bright: 1.4, hold: true, jitter: 0.1 });
      this.p.emit({ cell: trail === 'fire' ? 'fire' : 'flare', n: 1, at: cur, size: size * 3, life, color: hot(color, 0.2), alpha: 0.8, hold: true, spin: 6 });
      const n = tr(dt);
      for (let i = 0; i < n; i++) {
        const p = V().lerpVectors(prev, cur, Math.random());
        if (trail === 'fire') {
          this.p.emit({ cell: 'fire', n: 1, at: p, shape: 'sphere', r: size * 0.4, size: [size * 2.6, size * 0.6], life: [220, 380], color: 0xffc040, color1: 0xb02008, bright: 1.3, spin: 3, speed: 0.4 });
          if (i % 3 === 0) this.p.emit({ cell: 'puff', n: 1, at: p, size: [size * 1.2, size * 2.6], life: [450, 700], color: 0x4a4440, alpha: 0.16, solid: true, up: 0.5, spin: 1 });
        } else if (trail === 'dark') {
          this.p.emit({ cell: 'smoke', n: 1, at: p, shape: 'sphere', r: size * 0.5, size: [size * 2.4, size * 3.6], life: [380, 600], color: darker(color, 0.35), alpha: 0.55, solid: true, spin: 2 });
          this.p.emit({ cell: 'glow', n: 1, at: p, size: [size * 1.4, 0], life: 300, color, alpha: 0.7 });
        } else if (trail === 'ice') {
          this.p.emit({ cell: 'star', n: 1, at: p, shape: 'sphere', r: size * 0.6, size: [size * 1.6, 0], life: [300, 500], color: 0xdff4ff, bright: 1.3, gravity: 1.5, spin: 4 });
          if (i % 2 === 0) this.p.emit({ cell: 'puff', n: 1, at: p, size: [size * 1.5, size * 3.5], life: 700, color: 0xcfe8ff, alpha: 0.18, solid: true });
        } else {
          this.p.emit({ cell: 'glow', n: 1, at: p, shape: 'sphere', r: size * 0.3, size: [size * 2, 0], life: [220, 360], color, bright: 1.2 });
          if (i % 3 === 0) this.p.emit({ cell: trail === 'holy' ? 'flare' : 'star', n: 1, at: p, size: [size * 1.4, 0], life: 420, color: hot(color), spin: 5, speed: 0.6 });
        }
      }
      prev.copy(cur);
    });
  }

  /** An impact: a flash, an expanding glow, sparks thrown outwards and a puff of smoke. */
  burst(pos: THREE.Vector3, color: number, size = 1, dur = 400) {
    this.flash(pos, color, Math.min(size * 0.6, 0.8), size >= 0.5);
    this.p.emit({ cell: 'burst', n: 1, at: pos, size: [size * 1.4, size * 2.8], life: dur, color, bright: 1.15, fadeIn: 0 });
    this.p.emit({ cell: 'streak', n: Math.round(6 + 8 * size), at: pos, speed: [3 * size + 2, 7 * size + 3], size: 0.35 + size * 0.15, life: [220, 480], color: hot(color, 0.4), bright: 1.6, stretch: 0.05, gravity: 7, drag: 2.5 });
    if (size >= 0.5) this.p.emit({ cell: 'puff', n: 3, at: pos, shape: 'sphere', r: size * 0.3, speed: 0.6, up: 0.5, size: [size * 0.8, size * 1.8], life: [600, 900], color: 0x5a5450, alpha: 0.22, solid: true, spin: 1 });
  }

  /** A crescent sweeping across the target, sparks flying off along the swing. */
  slash(pos: THREE.Vector3, from: THREE.Vector3, color: number, size = 1.2, dur = 260) {
    const tilt = (Math.random() - 0.5) * 1.6;
    this.p.emit({ cell: 'slash', n: 1, at: pos, size: [size * 1.8, size * 2.6], rot: tilt, spin: 0, life: dur, color, bright: 1.6, fadeIn: 0.05, jitter: 0 });
    this.p.emit({ cell: 'slash', n: 1, at: pos, size: [size * 1.4, size * 2.2], rot: tilt + 0.15, spin: 0, life: dur * 0.8, color: 0xffffff, alpha: 0.8, fadeIn: 0.05, jitter: 0 });
    const dir = V().subVectors(pos, from).setY(0).normalize();
    this.p.emit({ cell: 'streak', n: 8, at: pos, dir, cone: 0.8, speed: [4, 8], size: 0.3, life: [180, 340], color: hot(color, 0.5), bright: 1.5, stretch: 0.045, gravity: 6, drag: 3 });
  }

  /** A shockwave on the ground: a ring of light racing out over a wash of glow, kicking up dust. */
  ring(pos: THREE.Vector3, color: number, radius = 2, dur = 600) {
    const at = pos.clone().setY(pos.y + 0.12);
    this.p.emit({ cell: 'ring', n: 1, at, flat: true, size: [radius * 0.5, radius * 2.15], life: dur, color, bright: 1.4, fadeIn: 0, jitter: 0 });
    this.p.emit({ cell: 'ring', n: 1, at, flat: true, size: [radius * 0.3, radius * 1.6], life: dur * 0.8, color: hot(color), alpha: 0.6, fadeIn: 0.2, jitter: 0 });
    this.p.emit({ cell: 'glow', n: 1, at, flat: true, size: [radius * 1.2, radius * 2.4], life: dur * 0.7, color, alpha: 0.35, fadeIn: 0 });
    this.p.emit({ cell: 'glow', n: Math.round(10 + radius * 4), at, shape: 'ring', r: radius * 0.25, outward: true, speed: radius * 2.4, drag: 3, size: [0.25, 0.05], life: dur * 0.7, color: hot(color, 0.3), bright: 1.3 });
    if (radius >= 1.2) this.p.emit({ cell: 'puff', n: Math.round(6 + radius * 2), at: at.clone().setY(at.y + 0.35), shape: 'ring', r: radius * 0.3, outward: true, speed: radius * 1.5, drag: 3, up: 0.4, size: [0.4, 1], life: [500, 800], color: 0xa89a80, alpha: 0.22, solid: true, spin: 1 });
  }

  /** A column of light with a bright core, a rune at its foot, motes rising inside it and a glow on the ground around. */
  pillar(pos: THREE.Vector3, color: number, dur = 1500, height = 6) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const outer = new THREE.Mesh(GEO.pillar, this.glow(color, 0.35, THREE.DoubleSide));
    const core = new THREE.Mesh(GEO.pillar, this.glow(hot(color, 0.5), 0.55, THREE.DoubleSide));
    g.add(outer, core);
    this.rune(pos, 1.5, color, dur);
    this.p.emit({ cell: 'flare', n: 1, at: pos.clone().setY(pos.y + 0.3), size: [3, 1], life: 400, color: hot(color), bright: 1.5, fadeIn: 0 });
    this.light(pos.clone().setY(pos.y + 1.5), color, 12, 10, Math.min(dur, 1200));
    const motes = this.rate(40);
    this.add(g, dur, (k, dt) => {
      const w = 1 - k * 0.6, grow = Math.min(1, k * 8); // shoots up, then narrows away
      for (const [m, r] of [[outer, 1], [core, 0.4]] as const) {
        m.scale.set(w * r, height * grow, w * r);
        m.position.y = (height * grow) / 2;
        m.rotation.y += 0.05 * (r === 1 ? 1 : -2);
      }
      (outer.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
      (core.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
      if (k < 0.75) this.p.emit({ cell: 'star', n: motes(dt), at: pos, shape: 'disc', r: 0.7 * w, up: height * 0.7, speed: 0.3, size: [0.25, 0.05], life: [700, 1100], color: hot(color, 0.5), bright: 1.4, spin: 3 });
    });
  }

  /** A magic circle on the ground, turning while it fades in and out. */
  rune(pos: THREE.Vector3, r: number, color: number, dur = 1000) {
    const at = pos.clone().setY(pos.y + 0.1);
    this.p.emit({ cell: 'rune', n: 1, at, flat: true, size: [r * 2.1, r * 2.3], spin: 1.2, life: dur, color, bright: 1.3, fadeIn: 0.15, jitter: 0 });
    this.p.emit({ cell: 'ring', n: 1, at, flat: true, size: [r * 2.3, r * 2.4], life: dur, color: hot(color, 0.3), alpha: 0.5, fadeIn: 0.2, jitter: 0 });
    this.p.emit({ cell: 'glow', n: 1, at, flat: true, size: [r * 2.6, r * 2.6], life: dur, color, alpha: 0.3, fadeIn: 0.2, jitter: 0 });
  }

  /** Motes around a point. spin = how fast they circle, rise/fall = how they drift up or drip down, r = max radius. */
  motes(pos: THREE.Vector3, color: number, dur = 900, o: { n?: number; r?: number; spin?: number; rise?: number; fall?: number; size?: number; cell?: Cell } = {}) {
    const { n = 14, r = 0.9, spin = 4, rise = 2.2, fall = 0, size = 1, cell = 'star' } = o;
    const seeds = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2, r: r * (0.5 + Math.random() * 0.5), s: 0.5 + Math.random(), i }));
    const p = V(), trail = this.rate(n * 18), col = hot(color, 0.35);
    this.add(null, dur, (k, dt) => {
      const life = Math.max(45, dt * 2600), fade = 1 - k * k;
      let t = trail(dt);
      for (const m of seeds) {
        p.set(pos.x + Math.cos(m.a + k * spin) * m.r * (1 - k * 0.3), pos.y + k * rise * m.s - fall * k * k, pos.z + Math.sin(m.a + k * spin) * m.r * (1 - k * 0.3));
        const tw = (0.7 + 0.5 * Math.sin(k * 30 + m.i * 2)) * (0.6 + m.s * 0.5) * size;
        this.p.emit({ cell, n: 1, at: p, size: 0.32 * tw, life, color: col, alpha: fade, bright: 1.4, hold: true, rot: k * 6 + m.i, jitter: 0 });
        if (t-- > 0) this.p.emit({ cell: 'glow', n: 1, at: p, size: [0.22 * size, 0], life: 320, color, alpha: 0.7 * fade });
      }
    });
  }

  /** Twinkling motes spiralling up around a character. */
  sparkles(pos: THREE.Vector3, color: number, dur = 900) {
    this.motes(pos, color, dur);
  }

  /** Chunks blasted outwards and thrown up, bouncing on the ground, with glowing sparks among them. */
  shards(pos: THREE.Vector3, color: number, n = 10, spread = 1.5, dur = 700) {
    const floor = heightAt(pos.x, pos.z) + 0.05;
    this.p.emit({ cell: 'debris', n: Math.ceil(n * 0.6), at: pos, cone: 1.1, speed: [spread * 1.5, spread * 3], up: spread * 1.2, size: [0.35, 0.25], life: [dur, dur * 1.6], color: darker(color, 0.75), solid: true, gravity: 14, spin: 8, floor, fadeIn: 0 });
    this.p.emit({ cell: 'streak', n, at: pos, cone: 1.2, speed: [spread * 2, spread * 4], up: spread, size: 0.4, life: [dur * 0.5, dur], color: hot(color, 0.4), bright: 1.5, stretch: 0.05, gravity: 10, floor, fadeIn: 0 });
  }

  /** Rocks and dirt kicked up from the ground (earthquakes, heavy blows). */
  debris(pos: THREE.Vector3, color = 0x8a7a60, n = 12, spread = 2) {
    const floor = heightAt(pos.x, pos.z) + 0.05;
    this.p.emit({ cell: 'debris', n, at: pos, shape: 'disc', r: spread * 0.4, cone: 0.6, speed: [3, 6], size: [0.4, 0.3], life: [900, 1400], color, solid: true, gravity: 16, spin: 6, floor, fadeIn: 0 });
    this.smoke(pos, spread * 0.6, 1200, 0x8a7a64, Math.round(4 + spread * 2));
  }

  /** A translucent hemisphere that swells over a spot, like a ward or a shield, with a rune turning under it. */
  dome(pos: THREE.Vector3, color: number, r = 1.5, dur = 800) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const shell = new THREE.Mesh(GEO.dome, this.glow(color, 0.25, THREE.DoubleSide));
    const rim = new THREE.Mesh(GEO.edge, this.glow(hot(color), 0.8));
    rim.rotation.x = -Math.PI / 2;
    g.add(shell, rim);
    this.rune(pos, r * 0.9, color, dur);
    this.p.emit({ cell: 'halo', n: 1, at: pos.clone().setY(pos.y + r * 0.5), size: [r * 1.5, r * 2.6], life: dur * 0.6, color, alpha: 0.5, fadeIn: 0 });
    const sm = shell.material as THREE.MeshBasicMaterial, rm = rim.material as THREE.MeshBasicMaterial;
    const sp = this.rate(26 * r);
    this.add(g, dur, (k, dt) => {
      g.scale.setScalar(r * (0.3 + out(k) * 0.7));
      sm.opacity = 0.25 * (1 - k) * (0.85 + 0.15 * Math.sin(k * 40));
      rm.opacity = 0.8 * (1 - k);
      if (k < 0.7) this.p.emit({ cell: 'star', n: sp(dt), at: pos, shape: 'ring', r: r * (0.3 + out(k) * 0.7), up: 1.2, size: [0.18, 0], life: 600, color: hot(color), bright: 1.3 });
    });
  }

  /** Forked lightning that crackles between two points while it lasts, lighting up the spot it strikes. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color: number, dur = 250) {
    const N = 10, pts = Array.from({ length: N }, V), seg = V(), mid = V();
    const len = from.distanceTo(to);
    this.light(to, color, 16, Math.max(10, len), dur + 200);
    this.flash(to, color, 0.8, false);
    const chain = (a: THREE.Vector3[], life: number, w: number) => {
      for (let i = 0; i < a.length - 1; i++) {
        seg.subVectors(a[i + 1], a[i]);
        mid.addVectors(a[i], a[i + 1]).multiplyScalar(0.5);
        this.p.emit({ cell: 'glow', n: 1, at: mid, vel: seg, still: true, stretch: 1, size: w * 4, life, color, bright: 1.5, hold: true, jitter: 0 });
        this.p.emit({ cell: 'glow', n: 1, at: mid, vel: seg, still: true, stretch: 1, size: w * 1.6, life, color: 0xffffff, bright: 1.6, hold: true, jitter: 0 });
      }
    };
    this.add(null, dur, (k, dt) => {
      const j = Math.sin(k * Math.PI) * 0.12 * len + 0.2; // pinned at both ends, crackling in between
      for (let i = 0; i < N; i++) {
        pts[i].lerpVectors(from, to, i / (N - 1));
        if (i && i < N - 1) pts[i].add(V().randomDirection().multiplyScalar(Math.random() * j));
      }
      const life = Math.max(45, dt * 2600), flick = Math.random() < 0.85 ? 1 : 0.4;
      chain(pts, life, 0.14 * flick);
      // two forks off the middle
      for (const b of [3, 6]) {
        const fork = [pts[b].clone()];
        for (let i = 0; i < 3; i++) fork.push(fork[i].clone().add(V().randomDirection().multiplyScalar(len * 0.07)).lerp(to, 0.08));
        chain(fork, life, 0.07 * flick);
      }
    });
    this.p.emit({ cell: 'streak', n: 10, at: to, cone: 1.3, speed: [3, 7], size: 0.3, life: [200, 400], color: hot(color), bright: 1.6, stretch: 0.05, gravity: 8 });
  }

  /** A stream from one point to another (drains, healing links): a wavering ribbon and motes travelling along it. */
  beam(from: () => THREE.Vector3, to: () => THREE.Vector3, color: number, dur = 600, travel = true) {
    const N = 8, a = V(), b = V(), p = V(), q = V(), seg = V(), mid = V();
    const mote = this.rate(45);
    this.add(null, dur, (k, dt) => {
      a.copy(from());
      b.copy(to());
      const life = Math.max(45, dt * 2600), fade = Math.sin(Math.min(1, k * 1.2) * Math.PI);
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        p.lerpVectors(a, b, t0).y += Math.sin(t0 * Math.PI) * (0.35 + Math.sin(k * 20 + t0 * 9) * 0.12);
        q.lerpVectors(a, b, t1).y += Math.sin(t1 * Math.PI) * (0.35 + Math.sin(k * 20 + t1 * 9) * 0.12);
        seg.subVectors(q, p);
        mid.addVectors(p, q).multiplyScalar(0.5);
        this.p.emit({ cell: 'glow', n: 1, at: mid, vel: seg, still: true, stretch: 1, size: 0.45, life, color, alpha: 0.8 * fade, bright: 1.3, hold: true, jitter: 0 });
      }
      if (travel) this.p.emit({ cell: 'glow', n: mote(dt), at: a, vel: V().subVectors(b, a).divideScalar(0.35).setY((b.y - a.y) / 0.35 + 1), gravity: 5.7, size: [0.3, 0.15], life: 350, color: hot(color, 0.3), bright: 1.4 });
    });
  }

  /** Flames licking up from a spot, with smoke rising above them and a flickering light. */
  flame(pos: THREE.Vector3, r = 1, dur = 1000, color = 0xff8a2a) {
    const fire = this.rate(45 * Math.sqrt(r)), smoke = this.rate(7 * Math.sqrt(r));
    const base = pos.clone().setY(pos.y + 0.35 * Math.min(r, 1.5)); // a flame quad half in the ground shows a hard edge
    this.light(pos.clone().setY(pos.y + 1), color, 12 * Math.min(r, 2), 9 * r, dur);
    this.add(null, dur, (k, dt) => {
      const tail = k < 0.8 ? 1 : (1 - k) / 0.2;
      this.p.emit({ cell: 'flame', n: Math.ceil(fire(dt) * tail), at: base, shape: 'disc', r: r * 0.7, up: 2.2, speed: 0.3, size: [0.9 + r * 0.35, 0.35], life: [400, 650], color: 0xffa83a, color1: darker(color, 0.4), bright: 1.2, alpha: 0.9, spin: 0.6, fadeIn: 0.15 });
      if (k < 0.85) this.p.emit({ cell: 'glow', n: Math.ceil(fire(dt) * 0.25), at: base, shape: 'disc', r: r * 0.6, up: 1.2, size: [0.8 + r * 0.4, 0.3], life: 350, color: 0xff6a1a, alpha: 0.5 });
      this.p.emit({ cell: 'puff', n: smoke(dt), at: base.clone().setY(base.y + 1.4), shape: 'disc', r: r * 0.5, up: 1.3, size: [0.8, 2 + r * 0.4], life: [1200, 1700], color: 0x3a3532, alpha: 0.3, solid: true, spin: 0.8, fadeIn: 0.2 });
    });
  }

  /** A cloud of smoke or dust swelling out from a spot (raised off the ground: a puff cut by the ground shows a hard edge). */
  smoke(pos: THREE.Vector3, r = 1, dur = 1200, color = 0x5a5550, n = 8) {
    this.p.emit({ cell: 'puff', n, at: pos.clone().setY(pos.y + r * 0.7), shape: 'sphere', r: r * 0.5, outward: true, speed: r * 0.9, drag: 1.5, up: 0.45, size: [r * 0.7, r * 1.6], life: [dur * 0.7, dur], color, alpha: 0.3, solid: true, spin: 0.8, fadeIn: 0.15 });
  }

  /** Cold mist lying on the ground (flat, so it never cuts into it), with glints of frost. */
  frost(pos: THREE.Vector3, r = 2, dur = 1600) {
    this.p.emit({ cell: 'puff', n: Math.round(5 + r * 2), at: pos.clone().setY(pos.y + 0.15), shape: 'disc', r: r * 0.8, flat: true, speed: 0.25, size: [r * 0.7, r * 1.3], life: [dur * 0.7, dur], color: 0xe2f4ff, alpha: 0.32, solid: true, spin: 0.3, fadeIn: 0.25 });
    this.p.emit({ cell: 'star', n: Math.round(6 + r * 4), at: pos.clone().setY(pos.y + 0.3), shape: 'disc', r, up: 0.2, size: [0.25, 0], life: [dur * 0.4, dur * 0.8], color: 0xf0faff, bright: 1.5, spin: 3, fadeIn: 0.3 });
  }

  /** Stars circling over a stunned head. */
  stun(pos: THREE.Vector3, dur = 1500) {
    this.motes(pos, 0xffe066, dur, { n: 4, r: 0.45, spin: 5, rise: 0, size: 1.3, cell: 'flare' });
  }

  /** A small puff of dust at the feet (rolls, footsteps). At most 8 in any 450 ms, so fast steps stay cheap. */
  dust(pos: THREE.Vector3, dur = 450) {
    const now = performance.now();
    this.dustAt = this.dustAt.filter((t) => now - t < 450);
    if (this.dustAt.length >= 8) return;
    this.dustAt.push(now);
    this.p.emit({ cell: 'puff', n: 3, at: pos.clone().setY(pos.y + 0.1), shape: 'disc', r: 0.2, outward: true, speed: 0.6, drag: 3, up: 0.25, size: [0.25, 0.8], life: [dur, dur * 1.6], color: 0xc8b48e, alpha: 0.35, solid: true, spin: 1, fadeIn: 0.1 });
  }

  /** Telegraphed area attack: red outline plus a disc that fills up until it lands. */
  telegraph(x: number, z: number, r: number, ms: number) {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z) + 0.15, z);
    const edgeMat = this.basic(0xff2a1a, 0.9, THREE.FrontSide, THREE.NormalBlending);
    const fillMat = this.basic(0xff3a20, 0.28, THREE.FrontSide, THREE.NormalBlending);
    const edge = new THREE.Mesh(GEO.edge, edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.scale.setScalar(r);
    const fill = new THREE.Mesh(GEO.disc, fillMat);
    fill.rotation.x = -Math.PI / 2;
    g.add(edge, fill);
    this.add(g, ms, (k) => {
      fill.scale.setScalar(r * Math.max(0.02, k));
      edgeMat.opacity = 0.6 + 0.35 * Math.sin(k * Math.PI * 8);
    });
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.list = this.list.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) {
        if (f.obj) this.release(f.obj);
        return false;
      }
      f.update(k, dt);
      return true;
    });
    this.p.update(dt);
  }

  private release(obj: THREE.Object3D) {
    this.scene.remove(obj);
    const mats = new Set<THREE.Material>();
    obj.traverse((o) => o instanceof THREE.Mesh && mats.add(o.material as THREE.Material));
    for (const m of mats) {
      const key = m.userData.pool as string | undefined, free = key !== undefined ? this.pool.get(key) ?? [] : null;
      if (free && free.length < 64) {
        this.pool.set(key!, free);
        free.push(m as THREE.MeshBasicMaterial);
      } else m.dispose();
    }
  }
}
