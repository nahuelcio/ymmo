// Textured particles for spell effects: camera-facing quads (or flat on the ground) drawn from one atlas of
// Kenney's Particle Pack (client/public/p, tools/scripts/p-assets.mjs). Every particle in the world is one
// instance of one of two meshes (additive glow, normal-blended smoke and dirt): two draw calls in all.
// Simulated on the CPU in fixed typed arrays: emitting and dying allocate nothing.
import * as THREE from 'three';
import { settings } from '../settings';

/** Atlas cells, in the order of FILES (and of tools/scripts/p-assets.mjs). */
export const CELLS = ['glow', 'streak', 'flare', 'star', 'fire', 'flame', 'smoke', 'puff', 'rune', 'ring', 'bolt', 'debris', 'slash', 'swirl', 'burst', 'halo'] as const;
export type Cell = (typeof CELLS)[number];
const FILES = ['circle_05', 'trace_01', 'star_06', 'star_05', 'fire_01', 'flame_02', 'smoke_04', 'smoke_07',
  'magic_02', 'circle_03', 'spark_05', 'dirt_02', 'slash_01', 'twirl_01', 'scorch_01', 'light_01'];

const MAX = 4096;

export interface Emit {
  cell: Cell;
  n: number;
  at: THREE.Vector3;
  /** where in the shape they start: a point, inside a sphere or disc of radius r, on a ring of radius r, along a line to `to` */
  shape?: 'point' | 'sphere' | 'disc' | 'ring' | 'line';
  r?: number;
  to?: THREE.Vector3;
  /** speed range (m/s); direction: around `dir` within `cone` radians (default: any), or away from the centre (`outward`) */
  speed?: number | [number, number];
  dir?: THREE.Vector3;
  cone?: number;
  outward?: boolean;
  /** extra upward speed */
  up?: number;
  /** lifetime range, ms */
  life?: number | [number, number];
  /** size at birth and at death (m), with a random spread of +-jitter (share) */
  size?: number | [number, number];
  jitter?: number;
  color: number;
  /** colour at death (default: the same) */
  color1?: number;
  /** multiplies the colour: above 1 blooms */
  bright?: number;
  alpha?: number;
  /** share of the life spent fading in */
  fadeIn?: number;
  /** keep full alpha until death (particles redrawn every frame: projectile heads, beams) */
  hold?: boolean;
  gravity?: number;
  drag?: number;
  /** spin (rad/s, random sign) and a random starting angle unless rot is given */
  spin?: number;
  rot?: number;
  /** stretched along their screen-space velocity: streaks, sparks; the value scales the length */
  stretch?: number;
  /** lie flat on the ground instead of facing the camera */
  flat?: boolean;
  /** normal blending (smoke, dirt) instead of additive glow */
  solid?: boolean;
  /** stay where they were born (velocity only orients a stretched quad) */
  still?: boolean;
  /** exact velocity instead of speed/dir (with still: the direction and length of a stretched quad) */
  vel?: THREE.Vector3;
  /** bounce on this height (debris) */
  floor?: number;
}

const rnd = (r: number | [number, number] | undefined, d: number) => (r === undefined ? d : typeof r === 'number' ? r : r[0] + Math.random() * (r[1] - r[0]));
const tmpC = new THREE.Color(), tmpC1 = new THREE.Color(), tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const Y = new THREE.Vector3(0, 1, 0);

const VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec2 iSize;
  attribute vec4 iColor;
  attribute vec3 iCell;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vCell;
  void main() {
    vUv = uv;
    vColor = iColor;
    vCell = iCell.x;
    vec2 q = position.xy;
    float c = cos(iSize.y), s = sin(iSize.y);
    vec2 rq = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * iSize.x;
    vec4 mv;
    if (iCell.z > 0.5) {
      mv = viewMatrix * vec4(iPos + vec3(rq.x, 0.0, rq.y), 1.0);
    } else {
      mv = viewMatrix * vec4(iPos, 1.0);
      if (iCell.y > 0.0) {
        // along the screen-space velocity, longer the faster it goes
        vec2 vv = (viewMatrix * vec4(iVel, 0.0)).xy;
        float len = length(vv);
        vec2 d = len > 1e-4 ? vv / len : vec2(0.0, 1.0);
        // (d.y, -d.x) keeps the quad facing the camera: the other perpendicular mirrors it and back-face culling drops it
        mv.xy += vec2(d.y, -d.x) * q.x * iSize.x + d * q.y * (iSize.x + len * iCell.y);
      } else mv.xy += rq;
    }
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  uniform sampler2D atlas;
  uniform float shade;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vCell;
  void main() {
    float col = mod(vCell, 4.0), row = floor(vCell / 4.0 + 0.01);
    vec2 uv = clamp(vUv, 0.01, 0.99);
    float m = texture2D(atlas, vec2((col + uv.x) * 0.25, 1.0 - (row + 1.0 - uv.y) * 0.25)).r;
    float a = vColor.a * m;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb * shade, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The atlas: drawn into a canvas as the cells arrive, so effects work (blank) before it loads. */
function makeAtlas(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // a mask, not a colour
  const loader = new THREE.ImageLoader();
  FILES.forEach((f, i) =>
    loader.load(`p/${f}.webp`, (img) => {
      ctx.drawImage(img, (i % 4) * 128, Math.floor(i / 4) * 128, 128, 128);
      tex.needsUpdate = true;
    }),
  );
  return tex;
}

/** One blend mode's particles: struct-of-arrays state, packed (dead ones swapped out), drawn instanced. */
class Pool {
  count = 0;
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  // state
  private p = new Float32Array(MAX * 3);
  private v: Float32Array<ArrayBuffer> = new Float32Array(MAX * 3);
  private c0 = new Float32Array(MAX * 3);
  private c1 = new Float32Array(MAX * 3);
  /** age, life, size0, size1, rot, spin, alpha, gravity, drag, fadeIn, floor, flags (1 hold, 2 still) */
  private f = new Float32Array(MAX * 12);
  /** cell, stretch, flat (straight into the GPU attribute) */
  private cell: Float32Array<ArrayBuffer>;
  // GPU attributes
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aCell: THREE.InstancedBufferAttribute;
  private attrs: THREE.InstancedBufferAttribute[];

  constructor(scene: THREE.Scene, atlas: THREE.Texture, solid: boolean) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const attr = (name: string, size: number, arr: Float32Array<ArrayBuffer> = new Float32Array(MAX * size)) => {
      const a = new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.aPos = attr('iPos', 3);
    this.aVel = attr('iVel', 3, this.v); // the velocity is used as is for stretched quads
    this.aSize = attr('iSize', 2);
    this.aColor = attr('iColor', 4);
    this.cell = new Float32Array(MAX * 3);
    this.aCell = attr('iCell', 3, this.cell);
    this.attrs = [this.aPos, this.aVel, this.aSize, this.aColor, this.aCell];
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: atlas }, shade: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: solid ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = solid ? 2 : 3; // glow over smoke
    scene.add(this.mesh);
  }

  add(o: Emit, n: number) {
    tmpC.set(o.color).multiplyScalar(o.bright ?? 1);
    tmpC1.set(o.color1 ?? o.color).multiplyScalar(o.bright ?? 1);
    const shape = o.shape ?? 'point', r = o.r ?? 0, cone = o.cone ?? Math.PI, jit = o.jitter ?? 0.3;
    const [s0, s1] = typeof o.size === 'number' ? [o.size, o.size] : o.size ?? [0.4, 0.1];
    if (o.dir) tmpQ.setFromUnitVectors(Y, tmpD.copy(o.dir).normalize());
    for (let k = 0; k < n && this.count < MAX; k++) {
      const i = this.count++, i3 = i * 3, i12 = i * 12;
      // start
      const t = n > 1 ? k / (n - 1) : 0.5;
      if (shape === 'line' && o.to) tmpV.lerpVectors(o.at, o.to, Math.random());
      else if (shape === 'ring' || shape === 'disc') {
        const a = shape === 'ring' ? t * Math.PI * 2 + Math.random() * 0.3 : Math.random() * Math.PI * 2;
        const d = shape === 'ring' ? r : r * Math.sqrt(Math.random());
        tmpV.set(o.at.x + Math.cos(a) * d, o.at.y, o.at.z + Math.sin(a) * d);
      } else if (shape === 'sphere') tmpV.randomDirection().multiplyScalar(r * Math.cbrt(Math.random())).add(o.at);
      else tmpV.copy(o.at);
      this.p[i3] = tmpV.x;
      this.p[i3 + 1] = tmpV.y;
      this.p[i3 + 2] = tmpV.z;
      // velocity
      const sp = rnd(o.speed, 0);
      if (o.outward) tmpD.set(tmpV.x - o.at.x, shape === 'sphere' ? tmpV.y - o.at.y : 0, tmpV.z - o.at.z).normalize();
      else {
        // within `cone` of +Y, then turned onto dir
        const th = Math.acos(1 - Math.random() * (1 - Math.cos(cone))), ph = Math.random() * Math.PI * 2;
        tmpD.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        if (o.dir) tmpD.applyQuaternion(tmpQ);
      }
      this.v[i3] = tmpD.x * sp;
      this.v[i3 + 1] = tmpD.y * sp + (o.up ?? 0);
      this.v[i3 + 2] = tmpD.z * sp;
      if (o.vel) (this.v[i3] = o.vel.x), (this.v[i3 + 1] = o.vel.y), (this.v[i3 + 2] = o.vel.z);
      // look
      const js = 1 + (Math.random() * 2 - 1) * jit;
      const f = this.f;
      f[i12] = 0;
      f[i12 + 1] = rnd(o.life, 600) / 1000;
      f[i12 + 2] = s0 * js;
      f[i12 + 3] = s1 * js;
      f[i12 + 4] = o.rot ?? Math.random() * Math.PI * 2;
      f[i12 + 5] = (o.spin ?? 0) * (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8);
      f[i12 + 6] = o.alpha ?? 1;
      f[i12 + 7] = o.gravity ?? 0;
      f[i12 + 8] = o.drag ?? 0;
      f[i12 + 9] = o.fadeIn ?? 0.1;
      f[i12 + 10] = o.floor ?? -1e9;
      f[i12 + 11] = (o.hold ? 1 : 0) | (o.still ? 2 : 0);
      this.c0[i3] = tmpC.r;
      this.c0[i3 + 1] = tmpC.g;
      this.c0[i3 + 2] = tmpC.b;
      this.c1[i3] = tmpC1.r;
      this.c1[i3 + 1] = tmpC1.g;
      this.c1[i3 + 2] = tmpC1.b;
      this.cell[i3] = CELLS.indexOf(o.cell);
      this.cell[i3 + 1] = o.stretch ?? 0;
      this.cell[i3 + 2] = o.flat ? 1 : 0;
    }
  }

  /** Copies particle j over i (i dies). */
  private move(i: number, j: number) {
    const a = i * 3, b = j * 3;
    this.p.copyWithin(a, b, b + 3);
    this.v.copyWithin(a, b, b + 3);
    this.c0.copyWithin(a, b, b + 3);
    this.c1.copyWithin(a, b, b + 3);
    this.cell.copyWithin(a, b, b + 3);
    this.f.copyWithin(i * 12, j * 12, j * 12 + 12);
  }

  update(dt: number) {
    const p = this.p, v = this.v, f = this.f, pos = this.aPos.array as Float32Array, size = this.aSize.array as Float32Array, col = this.aColor.array as Float32Array;
    for (let i = 0; i < this.count; ) {
      const i3 = i * 3, i12 = i * 12;
      const age = (f[i12] += dt), life = f[i12 + 1];
      if (age >= life) {
        this.move(i, --this.count);
        continue;
      }
      const k = age / life, flags = f[i12 + 11];
      if (!(flags & 2)) {
        const drag = Math.max(0, 1 - f[i12 + 8] * dt);
        v[i3] *= drag;
        v[i3 + 1] = (v[i3 + 1] - f[i12 + 7] * dt) * drag;
        v[i3 + 2] *= drag;
        p[i3] += v[i3] * dt;
        p[i3 + 1] += v[i3 + 1] * dt;
        p[i3 + 2] += v[i3 + 2] * dt;
        if (p[i3 + 1] < f[i12 + 10]) {
          // bounce, losing most of the speed
          p[i3 + 1] = f[i12 + 10];
          v[i3 + 1] *= -0.3;
          v[i3] *= 0.5;
          v[i3 + 2] *= 0.5;
        }
      }
      pos[i3] = p[i3];
      pos[i3 + 1] = p[i3 + 1];
      pos[i3 + 2] = p[i3 + 2];
      size[i * 2] = f[i12 + 2] + (f[i12 + 3] - f[i12 + 2]) * k;
      size[i * 2 + 1] = f[i12 + 4] += f[i12 + 5] * dt;
      const fin = f[i12 + 9];
      const a = f[i12 + 6] * (fin > 0 ? Math.min(1, k / fin) : 1) * (flags & 1 ? 1 : (1 - k) * (2 - (1 - k)));
      const c0 = this.c0, c1 = this.c1;
      col[i * 4] = c0[i3] + (c1[i3] - c0[i3]) * k;
      col[i * 4 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * k;
      col[i * 4 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * k;
      col[i * 4 + 3] = a;
      i++;
    }
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class Particles {
  private glow: Pool;
  private solid: Pool;
  private atlas = makeAtlas();

  constructor(scene: THREE.Scene) {
    this.glow = new Pool(scene, this.atlas, false);
    this.solid = new Pool(scene, this.atlas, true);
  }

  /** Spawns o.n particles (a quarter with the Particles setting off, so spells still read). */
  emit(o: Emit) {
    const n = settings.s.particles ? o.n : Math.ceil(o.n * 0.25);
    (o.solid ? this.solid : this.glow).add(o, n);
  }

  update(dt: number) {
    this.glow.update(dt);
    this.solid.update(dt);
  }

  get count() {
    return this.glow.count + this.solid.count;
  }

  /** How lit smoke and dirt are (1 by day, darker at night): they aren't lit by the scene, glow is its own light. */
  setShade(k: number) {
    ((this.solid.mesh.material as THREE.ShaderMaterial).uniforms.shade.value as number) = k;
  }

  dispose() {
    this.glow.dispose();
    this.solid.dispose();
    this.atlas.dispose();
  }
}
