// Fire on a character: flames licking up from its shoulders, fists and helm, a ring of fire round its feet and embers
// drifting up, for the world raid's Avatar de la Guerra (render/mobs.ts MOB_KNIGHT). Points under the bones, so the
// flames follow every move; everything moves in the shaders (one clock, set as they are drawn), the flames always rise
// straight up in the world however the bone turns, and their geometries and materials are shared by every burning rig.
import * as THREE from 'three';

/** How an emitter burns: a disc (or a ring) of `radius` at the bone, flames rising `rise` metres for `life` seconds */
interface Burn { count: number; radius: number; ring?: boolean; rise: number; size: number; life: number; sway: number; embers?: boolean }
type Kind = 'shoulder' | 'fist' | 'crown' | 'ring' | 'embers';
const KINDS: Record<Kind, Burn> = {
  shoulder: { count: 70, radius: 0.12, rise: 0.75, size: 0.2, life: 0.9, sway: 0.08 },
  fist: { count: 45, radius: 0.07, rise: 0.5, size: 0.15, life: 0.7, sway: 0.05 },
  crown: { count: 60, radius: 0.1, rise: 0.6, size: 0.17, life: 0.8, sway: 0.06 },
  ring: { count: 180, radius: 0.75, ring: true, rise: 0.55, size: 0.22, life: 1.0, sway: 0.07 },
  embers: { count: 70, radius: 0.8, rise: 2.6, size: 0.035, life: 2.6, sway: 0.3, embers: true },
};

const shared = { uTime: { value: 0 }, uViewH: { value: 800 } };
const viewSize = new THREE.Vector2();

const geos = new Map<Kind, THREE.BufferGeometry>();
const mats = new Map<Kind, THREE.ShaderMaterial>();

function geometry(kind: Kind): THREE.BufferGeometry {
  let g = geos.get(kind);
  if (g) return g;
  const n = KINDS[kind].count;
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // a spot on the disc (or the ring), a random size and its own moment in the cycle
    const a = Math.random() * Math.PI * 2, r = KINDS[kind].ring ? 0.85 + Math.random() * 0.15 : Math.sqrt(Math.random());
    seed.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), Math.random()], i * 4);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geos.set(kind, g);
  return g;
}

function material(kind: Kind): THREE.ShaderMaterial {
  let m = mats.get(kind);
  if (m) return m;
  const b: Burn = KINDS[kind];
  m = new THREE.ShaderMaterial({
    uniforms: { ...shared, uRadius: { value: b.radius }, uRise: { value: b.rise }, uSize: { value: b.size }, uLife: { value: b.life }, uSway: { value: b.sway } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uViewH, uRadius, uRise, uSize, uLife, uSway;
      varying float vLife;
      varying float vHue;
      void main() {
        float life = fract(uTime / uLife + aSeed.w);
        vLife = life;
        vHue = aSeed.z;
        // where it starts, in the bone's frame, drawn in as it burns up (a flame tapers to its tip)
        vec3 p = vec3(aSeed.x, 0.0, aSeed.y) * uRadius * (1.0 - life * 0.55);
        vec4 w = modelMatrix * vec4(p, 1.0);
        float s = length(modelMatrix[0].xyz);
        // up in the world, licking from side to side
        float t = uTime * 2.7 + aSeed.z * 31.0;
        w.xyz += vec3(sin(t + life * 6.0), 0.0, cos(t * 0.8 + life * 5.0)) * uSway * s * life;
        w.y += life * uRise * s;
        vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        float size = uSize * s * (1.0 - life * 0.65) * (0.65 + 0.7 * aSeed.z);
        gl_PointSize = size * projectionMatrix[1][1] * uViewH * 0.5 / max(0.1, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying float vLife;
      varying float vHue;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float soft = pow(1.0 - r, ${b.embers ? '0.6' : '1.6'});
        // white-yellow at the root, orange, then a deep red as it dies away
        vec3 hot = vec3(1.0, 0.92, 0.55), mid = vec3(1.0, 0.42 + 0.12 * vHue, 0.06), cool = vec3(0.75, 0.07, 0.02);
        vec3 col = vLife < 0.3 ? mix(hot, mid, vLife / 0.3) : mix(mid, cool, (vLife - 0.3) / 0.7);
        float a = soft * smoothstep(0.0, 0.1, vLife) * (1.0 - vLife) * ${b.embers ? '1.4' : '0.9'};
        gl_FragColor = vec4(col * ${b.embers ? '3.0' : '1.8'} * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mats.set(kind, m);
  return m;
}

function points(kind: Kind): THREE.Points {
  const p = new THREE.Points(geometry(kind), material(kind));
  p.frustumCulled = false; // the points move in the shader: the geometry's bounds mean nothing
  p.renderOrder = 2;
  // the clock and the screen's height, set as it is drawn: nothing to tick from outside
  p.onBeforeRender = (renderer) => {
    shared.uTime.value = performance.now() / 1000;
    shared.uViewH.value = renderer.getDrawingBufferSize(viewSize).y;
  };
  return p;
}

/** An emitter on a bone, `up` metres above it in the world as the rig stands at rest (bones have arbitrary axes). */
function onBone(bone: THREE.Object3D | undefined, kind: Kind, up = 0) {
  if (!bone) return;
  const p = points(kind);
  if (up) {
    bone.updateWorldMatrix(true, false);
    const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert(), s = bone.getWorldScale(new THREE.Vector3()).y;
    p.position.set(0, up / s, 0).applyQuaternion(q);
  }
  bone.add(p);
}

/** Set a character on fire (a rig from qPlayer, at rest, before it is scaled). */
export function addFlames(rig: { root: THREE.Object3D }) {
  const bone = (n: string) => rig.root.getObjectByName(n);
  onBone(bone('upperarm_l'), 'shoulder', 0.06);
  onBone(bone('upperarm_r'), 'shoulder', 0.06);
  onBone(bone('hand_l'), 'fist');
  onBone(bone('hand_r'), 'fist');
  onBone(bone('Head'), 'crown', 0.3);
  rig.root.add(points('ring'));
  rig.root.add(points('embers'));
}

/** A fire beast (render/mobs.ts GlbLook.fire): the ring of fire round its feet and the embers, `scale` times a man's,
 * and flames dripping from its jaw (`mouth`, one of the model's bones). */
export function addBeastFlames(root: THREE.Object3D, scale: number, mouth?: THREE.Object3D) {
  const g = new THREE.Group();
  g.scale.setScalar(scale);
  g.add(points('ring'), points('embers'));
  root.add(g);
  onBone(mouth, 'fist');
}
