// An Olympiad Hero's aura (game.ts, the player record's `he`): the light of an enchanted weapon (enchant-fx.ts) in
// gold, round the whole body. A soft column of light behind the body, flowing upwards, and golden glints circling it
// and spiralling up from the knees to above the head (some burning orange), each leaving a faint streak of light where
// it just was.
// Everything moves in the shaders off one clock, set as it is drawn (no per-frame CPU work), and the materials are
// shared by every Hero of the same look.
// A Hero chooses its look in the character window (ui/panels.ts). The dev gallery shows them side by side: ?fx=1&hero=1
// (render/fx-gallery.ts).
import * as THREE from 'three';

/** halo: the column of light and glints round it; spiral: glints in three arms winding up the body, over a fainter
 * column. The order is the player record's `he` (1 + the index): server-rs olympiad.rs HERO_LOOKS keeps the same. */
export type HeroLook = 'halo' | 'spiral';
export const HERO_LOOKS: HeroLook[] = ['halo', 'spiral'];
/** what a Hero wears until it chooses */
export const HERO_LOOK: HeroLook = 'halo';
/** The look in a player record's `he`. */
export const heroLookOf = (he: number | null | undefined): HeroLook => HERO_LOOKS[(he ?? 1) - 1] ?? HERO_LOOK;

interface Look { halo: number; sparks: number; arms: number; radius: number; size: number; rise: number }
const LOOKS: Record<HeroLook, Look> = {
  halo: { halo: 1, sparks: 34, arms: 0, radius: 0.32, size: 0.03, rise: 0.16 },
  spiral: { halo: 0.6, sparks: 54, arms: 3, radius: 0.3, size: 0.028, rise: 0.2 },
};

/** A glint's streak: this many fainter copies of it where it was, one every TRAIL_STEP seconds back. */
const TRAIL = 18;
const TRAIL_STEP = 0.022;

/** gold, bright enough to bloom, and its glints a little whiter */
const GOLD = new THREE.Color(1.0, 0.62, 0.18).multiplyScalar(1.6);
const GLINT = new THREE.Color(1.0, 0.7, 0.25).multiplyScalar(1.7);
/** some glints burn orange instead: this share of them, part of the way to EMBER (half to all of it) */
const WARM_SHARE = 0.4;
const EMBER = new THREE.Color(1.0, 0.38, 0.06).multiplyScalar(1.8);

const shared = { uTime: { value: 0 }, uViewH: { value: 800 } };
const viewSize = new THREE.Vector2();
const tick = (renderer: THREE.WebGLRenderer) => {
  shared.uTime.value = performance.now() / 1000;
  shared.uViewH.value = renderer.getDrawingBufferSize(viewSize).y;
};

/** One plane, 0..1 up and 1 wide: turned to face the camera round the body's upright axis, a little behind the body. */
const haloGeo = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);

const cache = new Map<string, { halo: THREE.ShaderMaterial; sparks: THREE.ShaderMaterial; geo: THREE.BufferGeometry }>();

function materials(look: HeroLook, trail: boolean) {
  const key = `${look}:${trail}`;
  let m = cache.get(key);
  if (m) return m;
  const L = LOOKS[look];
  const halo = new THREE.ShaderMaterial({
    uniforms: { ...shared, uColor: { value: GOLD }, uPower: { value: L.halo } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // a point on the body's axis, then sideways across the view (the light always shows its face), and pushed back
        // from the camera so the body stands in front of it
        float s = length(modelViewMatrix[0].xyz);
        vec4 c = modelViewMatrix * vec4(0.0, position.y * 1.15 - 0.05, 0.0, 1.0);
        vec3 axis = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 side = cross(axis, normalize(c.xyz));
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
        c.xyz += side * position.x * 0.85 * s + normalize(c.xyz) * 0.22 * s;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower, uTime;
      varying vec2 vUv;
      void main() {
        // a soft oval of light round the body, brightest at the chest and fading to nothing well before the plane's
        // edges: no card, no box round the body
        vec2 q = (vUv - 0.5) * 2.0;
        float d = dot(q, q);
        float shape = exp(-d * 3.5) * (1.0 - smoothstep(0.5, 1.0, d));
        // light running up the body, in slow wavering bands
        float flow = 0.65 + 0.35 * sin(vUv.y * 11.0 - uTime * 2.6 + sin(vUv.x * 6.0 + uTime) * 1.2);
        float a = shape * flow * uPower * 0.3;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // glints: each its own phase, height, speed and size; they circle the body and climb it, fading at both ends. Each
  // is drawn once where it is and, with a trail, TRAIL more times where it was (aLag: how many steps back)
  const n = L.sparks, copies = trail ? TRAIL + 1 : 1;
  const seed = (i: number, k: number) => {
    const s = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const att = new Float32Array(n * copies * 4), lag = new Float32Array(n * copies), warm = new Float32Array(n * copies);
  for (let i = 0; i < n; i++) {
    // in arms: the phase is the arm's, the glints spread along it (their height)
    const phase = L.arms ? ((i % L.arms) / L.arms) * Math.PI * 2 : seed(i, 1) * Math.PI * 2;
    // a glint's streak is its own colour
    const w = seed(i, 5) < WARM_SHARE ? 0.5 + 0.5 * seed(i, 6) : 0;
    for (let k = 0; k < copies; k++) {
      att.set([phase, seed(i, 2), 0.75 + seed(i, 3) * 0.5, 0.6 + seed(i, 4) * 0.8], (i * copies + k) * 4);
      lag[i * copies + k] = k;
      warm[i * copies + k] = w;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * copies * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(att, 4));
  geo.setAttribute('aLag', new THREE.BufferAttribute(lag, 1));
  geo.setAttribute('aWarm', new THREE.BufferAttribute(warm, 1));
  const sparks = new THREE.ShaderMaterial({
    uniforms: {
      ...shared, uColor: { value: GLINT }, uEmber: { value: EMBER }, uRadius: { value: L.radius }, uSize: { value: L.size }, uRise: { value: L.rise }, uArms: { value: L.arms },
      uTrail: { value: TRAIL }, uStep: { value: TRAIL_STEP },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; // phase, height, speed, size
      attribute float aLag;
      attribute float aWarm;
      uniform float uTime, uRadius, uSize, uRise, uArms, uViewH, uTrail, uStep;
      varying float vTwinkle;
      varying float vTail;
      varying float vWarm;
      void main() {
        vWarm = aWarm;
        // a streak's copy is the glint as it was, aLag steps ago: the same path, a moment behind
        float t = uTime - aLag * uStep;
        float h = fract(aSeed.y + t * uRise * (uArms > 0.0 ? 1.0 : aSeed.z));
        // free glints circle at their own pace; an arm's wind round the body as they climb it
        float a = uArms > 0.0 ? aSeed.x + h * 7.0 + t * 0.9 : aSeed.x + t * 1.3 * aSeed.z;
        float r = uRadius * (0.85 + 0.25 * sin(a * 0.6 + aSeed.y * 11.0)) * (1.0 - 0.25 * h);
        vec4 mv = modelViewMatrix * vec4(cos(a) * r, 0.12 + h * 1.0, sin(a) * r, 1.0);
        gl_Position = projectionMatrix * mv;
        float scale = length(modelViewMatrix[0].xyz);
        // the streak fades and thins away behind the glint; it keeps the twinkle the glint had then
        float back = aLag / (uTrail + 1.0);
        vTail = aLag > 0.0 ? 1.0 : 0.0;
        float fade = aLag > 0.0 ? pow(1.0 - back, 1.8) * 0.4 : 1.0;
        vTwinkle = (0.5 + 0.5 * sin(t * 7.0 + aSeed.x * 13.0 + aSeed.y * 5.0)) * smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.75, h) * fade;
        gl_PointSize = uSize * aSeed.w * (aLag > 0.0 ? 0.9 - 0.45 * back : 1.0) * scale * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uEmber;
      varying float vTwinkle;
      varying float vTail;
      varying float vWarm;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        // a bright core in a wider halo, as the weapon's glints; the streak only a soft glow, so it reads as light left
        // behind rather than more glints
        float r2 = dot(d, d) * 4.0;
        float glow = vTail > 0.5 ? exp(-r2 * 3.5) : exp(-r2 * 7.0) + 0.35 * exp(-r2 * 2.0);
        float a = glow * vTwinkle * 1.3;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(uColor, uEmber, vWarm) * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  m = { halo, sparks, geo };
  cache.set(key, m);
  return m;
}

/** A Hero's aura for a body `height` metres tall, to add under the entity's root (a new model keeps it); `trail`:
 * the glints' streaks (the gallery turns them off, to compare). */
export function heroAura(height: number, look: HeroLook = HERO_LOOK, trail = true): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'hero-aura';
  // sized by the body: the column, the orbit and the glints are fractions of its height
  g.scale.setScalar(height);
  const mats = materials(look, trail);
  const parts: THREE.Object3D[] = [new THREE.Points(mats.geo, mats.sparks)];
  if (LOOKS[look].halo > 0) parts.unshift(new THREE.Mesh(haloGeo, mats.halo));
  for (const o of parts) {
    o.frustumCulled = false; // it moves in the shaders: the geometry's bounds mean nothing
    o.renderOrder = 5;
    o.onBeforeRender = tick;
    g.add(o);
  }
  return g;
}
