// The glow of an enchanted weapon (+1 to +16): a ribbon of light along the blade and sparks circling it, blue that grows
// denser and more saturated with the level, red at +16. Hung under the weapon, so it follows every swing for free.
// Everything moves in the shaders off one shared clock (tickEnchantFx): no per-frame CPU work per weapon, and the
// materials and geometries are shared by every weapon of the same level.
import * as THREE from 'three';

/** What each level looks like. t: 0 at +1 .. 1 at +15; +16 is +15 in red. */
export function enchantLook(level: number) {
  const l = Math.max(1, Math.min(16, Math.round(level)));
  const t = (Math.min(l, 15) - 1) / 14;
  const red = l >= 16;
  // pale sky blue at +1, electric saturated blue at +15 (red at +16); past 1.0 the colour blooms
  const base = new THREE.Color(red ? 0xff1a1a : 0x8fb8ff).lerp(new THREE.Color(red ? 0xff1a1a : 0x1a4dff), red ? 1 : t);
  const hdr = 1.4 + 2.1 * Math.pow(red ? 1 : t, 1.2);
  return {
    level: l,
    sparks: Math.round(3 + 21 * t),
    beam: 0.5 + 0.5 * Math.pow(t, 0.9),
    width: 0.035 + 0.075 * t,
    radius: 0.09 + 0.08 * t,
    spin: 1.8 + 2.2 * t,
    // tiny glints, barely there: dust of light rather than stars
    size: 0.012 + 0.008 * t,
    color: base,
    hdr,
  };
}

/** One clock for every enchanted weapon, and the drawing buffer's height (for the sparks' size on screen). */
const shared = { uTime: { value: 0 }, uViewH: { value: 800 } };

/**
 * Additive, as THREE.AdditiveBlending, but with the alpha the shader writes added as it is: a glow writes only as much
 * alpha as it has light. The sun's light shafts (atmos.ts GodRaysShader) take alpha 0 for sky, so a glow at alpha 1
 * over its whole plane cut a box out of them round the weapon (and round a Hero, hero-fx.ts).
 */
export const GLOW_BLEND = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor } as const;

export function tickEnchantFx(seconds: number, viewHeight: number) {
  shared.uTime.value = seconds;
  shared.uViewH.value = viewHeight;
}

/**
 * One plane along +Y, 0..1 (scaled to the blade's length), 1 wide. The vertex shader turns it to face the camera round
 * the blade's axis: a fixed plane (there were two, crossed) seen face-on mid-swing read as a flat card beside the blade.
 */
const beamGeo = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);

const cache = new Map<number, { beam: THREE.ShaderMaterial; sparks: THREE.ShaderMaterial; geo: THREE.BufferGeometry }>();

function materials(level: number) {
  let m = cache.get(level);
  if (m) return m;
  const L = enchantLook(level);
  const col = L.color.clone().multiplyScalar(L.hdr);
  const beam = new THREE.ShaderMaterial({
    uniforms: { ...shared, uColor: { value: col }, uPower: { value: L.beam }, uWidth: { value: L.width } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // a point on the blade's axis, then sideways across the view: the ribbon always shows its face
        vec4 c = modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0);
        vec3 axis = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 side = cross(axis, normalize(c.xyz));
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0); // looking straight down the blade
        // the group is scaled to the blade's length: the halo's width is a fraction of it (the plane is 1 wide)
        c.xyz += side * position.x * uWidth * 2.0 * length(modelViewMatrix[0].xyz);
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPower, uTime;
      varying vec2 vUv;
      void main() {
        float x = abs(vUv.x - 0.5) * 2.0;               // 0 at the blade, 1 at the halo's edge
        // the halo has gone to nothing by the plane's edge: cut off there, the bright blues of +10 and up drew a box round the blade
        float halo = exp(-x * x * 5.0) * (1.0 - smoothstep(0.65, 1.0, x)), core = exp(-x * x * 60.0);
        float ends = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        // light running up the blade
        float flow = 0.75 + 0.25 * sin(vUv.y * 14.0 - uTime * 6.0);
        float a = (halo * 0.55 + core) * ends * flow * uPower;
        gl_FragColor = vec4(uColor * a + vec3(core * ends * uPower * 0.6), min(a, 1.0));
      }`,
    transparent: true,
    ...GLOW_BLEND,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // sparks: each its own phase, orbit radius, height and speed; they spiral up the blade and wrap round
  const n = L.sparks;
  const seed = (i: number, k: number) => {
    const s = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const pos = new Float32Array(n * 3), att = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    att.set([seed(i, 1) * Math.PI * 2, seed(i, 2), 0.7 + seed(i, 3) * 0.6, 0.7 + seed(i, 4) * 0.6], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(att, 4));
  const sparks = new THREE.ShaderMaterial({
    uniforms: { ...shared, uColor: { value: col.clone().lerp(new THREE.Color(1, 1, 1).multiplyScalar(L.hdr), 0.35) }, uRadius: { value: L.radius }, uSpin: { value: L.spin }, uSize: { value: L.size } },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; // phase, height, speed, size
      uniform float uTime, uRadius, uSpin, uSize, uViewH;
      varying float vTwinkle;
      void main() {
        float a = aSeed.x + uTime * uSpin * aSeed.z;
        float h = fract(aSeed.y + uTime * 0.18 * aSeed.z);
        float r = uRadius * (0.8 + 0.35 * sin(a * 0.7 + aSeed.y * 9.0));
        vec4 mv = modelViewMatrix * vec4(cos(a) * r, h, sin(a) * r, 1.0);
        gl_Position = projectionMatrix * mv;
        // the group is scaled to the blade's length: so are the sparks
        float scale = length(modelViewMatrix[0].xyz);
        vTwinkle = (0.55 + 0.45 * sin(uTime * 9.0 + aSeed.x * 7.0)) * smoothstep(0.0, 0.1, h) * smoothstep(1.0, 0.85, h);
        gl_PointSize = uSize * aSeed.w * scale * projectionMatrix[1][1] * uViewH * 0.5 / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vTwinkle;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float glow = exp(-r2 * 6.0);
        float a = glow * vTwinkle * 1.6;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * a, min(a, 1.0));
      }`,
    transparent: true,
    ...GLOW_BLEND,
    depthWrite: false,
  });
  m = { beam, sparks, geo };
  cache.set(level, m);
  return m;
}

/** The box of `obj`'s meshes in its own space. */
function localBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const box = new THREE.Box3(), b = new THREE.Box3(), m = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.geometry) return;
    o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    box.union(b);
  });
  return box;
}

/**
 * The glow for a weapon at +level (null at +0), to add under the weapon itself. It runs along the weapon's longest
 * axis, from near the grip (the end closer to the weapon's origin, where the hand holds it) to the tip.
 */
export function enchantFx(level: number, weapon: THREE.Object3D): THREE.Object3D | null {
  if (!(level > 0)) return null;
  const box = localBox(weapon);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const lo = box.min.getComponent(axis), hi = box.max.getComponent(axis);
  // the tip is the end farther from the origin (the grip)
  const tipHi = Math.abs(hi) >= Math.abs(lo);
  const len = hi - lo;
  const from = tipHi ? lo + len * 0.18 : hi - len * 0.18, to = tipHi ? hi : lo;
  const dir = new THREE.Vector3().setComponent(axis, Math.sign(to - from) || 1);
  const g = new THREE.Group();
  g.name = 'enchant-fx';
  g.position.copy(centre).setComponent(axis, from);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // sized by the blade: widths, orbit and sparks are fractions of its length, whatever units the model uses
  g.scale.setScalar(Math.abs(to - from));
  const mats = materials(Math.min(16, Math.round(level)));
  const beam = new THREE.Mesh(beamGeo, mats.beam);
  const sparks = new THREE.Points(mats.geo, mats.sparks);
  for (const o of [beam, sparks]) {
    o.frustumCulled = false;
    o.castShadow = false;
    o.receiveShadow = false;
    o.renderOrder = 5;
    g.add(o);
  }
  return g;
}
