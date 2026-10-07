import * as THREE from 'three';

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
  pillar: new THREE.CylinderGeometry(0.9, 0.9, 1, 16, 1, true),
  spark: new THREE.OctahedronGeometry(0.08, 0),
};

/** Tiny effect system: projectiles, bursts, rings and pillars of light. */
export class FxManager {
  private list: Fx[] = [];
  constructor(private scene: THREE.Scene) {}

  private add(obj: THREE.Object3D, dur: number, update: (k: number) => void) {
    this.scene.add(obj);
    this.list.push({ obj, t0: performance.now(), dur, update });
  }

  private glow(color: number, opacity = 0.9) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  projectile(from: THREE.Vector3, to: () => THREE.Vector3, color: number, dur = 300, size = 0.25) {
    const m = new THREE.Mesh(GEO.orb, this.glow(color));
    m.scale.setScalar(size);
    const start = from.clone();
    this.add(m, dur, (k) => {
      m.position.lerpVectors(start, to(), k);
      m.position.y += Math.sin(k * Math.PI) * 0.6;
      m.rotation.x += 0.3;
    });
  }

  burst(pos: THREE.Vector3, color: number, size = 1, dur = 400) {
    const m = new THREE.Mesh(GEO.orb, this.glow(color, 0.8));
    m.position.copy(pos);
    this.add(m, dur, (k) => {
      m.scale.setScalar(size * (0.2 + k));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    });
  }

  ring(pos: THREE.Vector3, color: number, radius = 2, dur = 600) {
    const m = new THREE.Mesh(GEO.ring, this.glow(color));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).add(new THREE.Vector3(0, 0.1, 0));
    this.add(m, dur, (k) => {
      m.scale.setScalar(radius * (0.3 + k));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    });
  }

  pillar(pos: THREE.Vector3, color: number, dur = 1500, height = 6) {
    const m = new THREE.Mesh(GEO.pillar, this.glow(color, 0.5));
    m.scale.y = height;
    m.position.copy(pos).add(new THREE.Vector3(0, height / 2, 0));
    this.add(m, dur, (k) => {
      m.scale.set(1 - k * 0.6, height, 1 - k * 0.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
      m.rotation.y += 0.05;
    });
  }

  sparkles(pos: THREE.Vector3, color: number, dur = 900) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const mat = this.glow(color);
    const parts: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(GEO.spark, mat);
      const a = (i / 10) * Math.PI * 2;
      p.userData = { a, r: 0.5 + Math.random() * 0.4, s: 0.5 + Math.random() };
      parts.push(p);
      g.add(p);
    }
    this.add(g, dur, (k) => {
      for (const p of parts) {
        const { a, r, s } = p.userData as { a: number; r: number; s: number };
        p.position.set(Math.cos(a + k * 4) * r, k * 2.2 * s, Math.sin(a + k * 4) * r);
      }
      mat.opacity = 1 - k;
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
