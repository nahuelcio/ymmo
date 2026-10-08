import * as THREE from 'three';
import { heightAt } from '../../../shared/src/terrain';

interface Fx {
  obj: THREE.Object3D;
  t0: number;
  dur: number;
  update: (k: number) => void;
}

// Effect geometries are shared by every effect instance; only materials are per-effect.
const GEO = {
  orb: new THREE.IcosahedronGeometry(1, 1),
  ring: new THREE.RingGeometry(0.8, 1, 32),
  thin: new THREE.RingGeometry(0.93, 1, 40),
  pillar: new THREE.CylinderGeometry(0.9, 0.9, 1, 16, 1, true),
  spark: new THREE.OctahedronGeometry(0.08, 0),
  disc: new THREE.CircleGeometry(1, 40),
  edge: new THREE.RingGeometry(0.96, 1, 64),
  arc: new THREE.RingGeometry(0.72, 1, 20, 1, -Math.PI * 0.42, Math.PI * 0.84),
};

/** fast start, soft landing: expansions read as an impact instead of a slow inflate */
const out = (k: number) => 1 - (1 - k) ** 3;
const UP = new THREE.Vector3(0, 0.1, 0);

/** Tiny effect system: projectiles with trails, bursts with sparks, slashes, rings and pillars of light. */
export class FxManager {
  private list: Fx[] = [];
  constructor(private scene: THREE.Scene) {}

  private add(obj: THREE.Object3D, dur: number, update: (k: number) => void) {
    this.scene.add(obj);
    this.list.push({ obj, t0: performance.now(), dur, update });
  }

  private glow(color: number, opacity = 0.9, side: THREE.Side = THREE.FrontSide) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side });
  }

  /** A glowing bolt with a white core and a fading trail. */
  projectile(from: THREE.Vector3, to: () => THREE.Vector3, color: number, dur = 300, size = 0.25) {
    const g = new THREE.Group();
    const halo = new THREE.Mesh(GEO.orb, this.glow(color, 0.75));
    const core = new THREE.Mesh(GEO.orb, this.glow(0xffffff, 0.95));
    const trailMat = this.glow(color, 0.4);
    const trail = Array.from({ length: 5 }, () => new THREE.Mesh(GEO.orb, trailMat));
    g.add(halo, core, ...trail);
    const start = from.clone();
    const at = (v: THREE.Vector3, k: number) => {
      v.lerpVectors(start, to(), k);
      v.y += Math.sin(k * Math.PI) * 0.6;
    };
    this.add(g, dur, (k) => {
      at(halo.position, k);
      core.position.copy(halo.position);
      halo.scale.setScalar(size * (1 + Math.sin(k * 40) * 0.12));
      core.scale.setScalar(size * 0.5);
      halo.rotation.x += 0.3;
      trail.forEach((p, i) => {
        at(p.position, Math.max(0, k - (i + 1) * 0.06));
        p.scale.setScalar(size * (0.8 - i * 0.13));
      });
    });
  }

  /** An impact: a flash, an expanding glow and sparks thrown outwards. */
  burst(pos: THREE.Vector3, color: number, size = 1, dur = 400) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const halo = new THREE.Mesh(GEO.orb, this.glow(color, 0.8));
    const flash = new THREE.Mesh(GEO.orb, this.glow(0xffffff, 0.9));
    const sparkMat = this.glow(color);
    const sparks = Array.from({ length: 6 }, () => {
      const p = new THREE.Mesh(GEO.spark, sparkMat);
      p.userData.dir = new THREE.Vector3().randomDirection().multiplyScalar(0.7 + Math.random() * 0.6);
      return p;
    });
    g.add(halo, flash, ...sparks);
    this.add(g, dur, (k) => {
      const e = out(k);
      halo.scale.setScalar(size * (0.2 + e));
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      flash.scale.setScalar(size * 0.45 * Math.max(0, 1 - k * 3));
      for (const p of sparks) {
        p.position.copy(p.userData.dir as THREE.Vector3).multiplyScalar(size * 1.6 * e);
        p.position.y -= k * k * size * 0.5; // they fall as they fade
        p.scale.setScalar(Math.max(0.3, size) * 1.6 * (1 - k));
      }
      sparkMat.opacity = 1 - k * k;
    });
  }

  /** A crescent sweeping across the target, facing whoever swung. */
  slash(pos: THREE.Vector3, from: THREE.Vector3, color: number, size = 1.2, dur = 260) {
    const m = new THREE.Mesh(GEO.arc, this.glow(color, 0.95, THREE.DoubleSide));
    m.position.copy(pos);
    m.lookAt(from);
    m.rotateX(-0.6); // leaning, so it still reads when seen from the side or from above
    const tilt = (Math.random() - 0.5) * 1.6;
    this.add(m, dur, (k) => {
      m.rotation.z = tilt + (out(k) - 0.5) * 2.2;
      m.scale.setScalar(size * (0.7 + out(k) * 0.5));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * Math.sin(Math.min(1, k * 1.15) * Math.PI);
    });
  }

  /** A shockwave on the ground: two rings chasing each other over a fading wash of light. */
  ring(pos: THREE.Vector3, color: number, radius = 2, dur = 600) {
    const g = new THREE.Group();
    g.position.copy(pos).add(UP);
    g.rotation.x = -Math.PI / 2;
    const a = new THREE.Mesh(GEO.ring, this.glow(color));
    const b = new THREE.Mesh(GEO.thin, this.glow(color, 0.7));
    const wash = new THREE.Mesh(GEO.disc, this.glow(color, 0.2));
    g.add(wash, a, b);
    this.add(g, dur, (k) => {
      const k2 = Math.max(0, (k - 0.25) / 0.75);
      a.scale.setScalar(radius * (0.3 + out(k) * 0.7));
      b.scale.setScalar(radius * (0.2 + out(k2) * 0.65));
      wash.scale.setScalar(radius * (0.3 + out(k) * 0.7));
      (a.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      (b.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k2) * (k > 0.25 ? 1 : 0);
      (wash.material as THREE.MeshBasicMaterial).opacity = 0.2 * (1 - k) ** 2;
    });
  }

  /** A column of light with a bright core, a ring at its foot and motes rising inside it. */
  pillar(pos: THREE.Vector3, color: number, dur = 1500, height = 6) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const outer = new THREE.Mesh(GEO.pillar, this.glow(color, 0.4, THREE.DoubleSide));
    const core = new THREE.Mesh(GEO.pillar, this.glow(color, 0.6, THREE.DoubleSide));
    const foot = new THREE.Mesh(GEO.ring, this.glow(color, 0.8));
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = 0.1;
    const moteMat = this.glow(0xffffff, 0.9);
    const motes = Array.from({ length: 8 }, (_, i) => {
      const p = new THREE.Mesh(GEO.spark, moteMat);
      p.userData = { a: (i / 8) * Math.PI * 2, o: Math.random() };
      return p;
    });
    g.add(outer, core, foot, ...motes);
    this.add(g, dur, (k) => {
      const w = 1 - k * 0.6, grow = Math.min(1, k * 8); // shoots up, then narrows away
      for (const [m, r] of [[outer, 1], [core, 0.4]] as const) {
        m.scale.set(w * r, height * grow, w * r);
        m.position.y = (height * grow) / 2;
        m.rotation.y += 0.05 * (r === 1 ? 1 : -2);
      }
      (outer.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - k);
      (core.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
      foot.scale.setScalar(1.1 + out(k) * 0.5);
      (foot.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      for (const p of motes) {
        const { a, o } = p.userData as { a: number; o: number }, h = (k * 1.6 + o) % 1;
        p.position.set(Math.cos(a + k * 3) * 0.6 * w, h * height, Math.sin(a + k * 3) * 0.6 * w);
      }
      moteMat.opacity = 0.9 * (1 - k);
    });
  }

  /** Twinkling motes spiralling up around a character. */
  sparkles(pos: THREE.Vector3, color: number, dur = 900) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const mat = this.glow(color);
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(GEO.spark, mat);
      const a = (i / 14) * Math.PI * 2;
      p.userData = { a, r: 0.45 + Math.random() * 0.45, s: 0.5 + Math.random(), i };
      parts.push(p);
      g.add(p);
    }
    this.add(g, dur, (k) => {
      for (const p of parts) {
        const { a, r, s, i } = p.userData as { a: number; r: number; s: number; i: number };
        p.position.set(Math.cos(a + k * 4) * r * (1 - k * 0.3), k * 2.2 * s, Math.sin(a + k * 4) * r * (1 - k * 0.3));
        p.scale.setScalar((0.7 + 0.5 * Math.sin(k * 30 + i * 2)) * (0.6 + s * 0.5));
        p.rotation.y += 0.2;
      }
      mat.opacity = 1 - k * k;
    });
  }

  /** Telegraphed area attack: red outline plus a disc that fills up until it lands. */
  telegraph(x: number, z: number, r: number, ms: number) {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z) + 0.15, z);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.9, depthWrite: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xff3a20, transparent: true, opacity: 0.28, depthWrite: false });
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
    this.list = this.list.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) {
        this.scene.remove(f.obj);
        f.obj.traverse((o) => {
          if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
        });
        return false;
      }
      f.update(k);
      return true;
    });
  }
}
