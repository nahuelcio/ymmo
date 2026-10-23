// Cumulus clouds: each a cluster of soft textured quads (impostors) from the particle atlas, lit by the sun
// in the shader (lit tops, darker bellies, a silver lining against the sun) and fading into the haze far
// off. All of them are one instanced draw. They drift in world space and wrap around the camera, so the
// patches of shade they cast on the ground (cloudShadow) stay under them while the player walks. When the sky
// clouds over (atmos.ts cloudCover) they grow, sink and darken, and low storm clouds gather in between, one by one.
import * as THREE from 'three';
import { mulberry32 } from '../../../shared/src/terrain';
import { settings } from '../settings';
import { CELLS, particleAtlas } from './particles';

/** fair-weather clouds (the ones that cast shade) */
const N = 40;
/** storm clouds, only there under cover */
const STORM_N = 24;
/** clouds live within ±SPAN of the camera on each axis, wrapping round as it moves */
const SPAN = 600;
/** m/s of drift along +x (faster in a storm) */
const WIND = 1.5;
/** under full cover a fair-weather cloud is this much bigger, and this many metres lower */
const GROW = 0.6, SINK = 30;

/** storm: the cover a storm cloud starts to gather at, -1 for a fair-weather cloud */
interface Cloud { x: number; z: number; y: number; r: number; storm: number }
const rng = mulberry32(31);
const CLOUDS: Cloud[] = Array.from({ length: N }, () => {
  const big = rng();
  return { x: (rng() * 2 - 1) * SPAN, z: (rng() * 2 - 1) * SPAN, y: 115 + rng() * 40, r: big < 0.2 ? 46 + rng() * 14 : big < 0.6 ? 32 + rng() * 10 : 20 + rng() * 8, storm: -1 };
});
// big, low and flat; each gathers at its own point of the cover, so they come in one after another
const stormRng = mulberry32(83);
for (let i = 0; i < STORM_N; i++)
  CLOUDS.push({ x: (stormRng() * 2 - 1) * SPAN, z: (stormRng() * 2 - 1) * SPAN, y: 85 + stormRng() * 20, r: 50 + stormRng() * 30, storm: (i / STORM_N) * 0.6 });
/** height of a cloud's belly over its radius: flat bottoms, domed tops */
const FLAT = 0.42;

const VERT = /* glsl */ `
  uniform float uDrift;
  uniform vec2 uCam;
  uniform float uCover;
  attribute vec4 aCloud;  // x, z, height, radius
  attribute vec3 aOff;    // offset in the cloud, metres
  attribute vec3 aSpr;    // size, rotation, atlas cell
  attribute float aStorm; // the cover a storm cloud gathers at, -1 for a fair-weather cloud
  varying vec2 vUv;
  varying float vCell;
  varying vec3 vN;
  varying float vH;
  varying vec3 vWorld;
  varying float vEdge;
  varying float vFade;
  void main() {
    // a storm cloud fades in and swells over its own stretch of the cover; until then it draws nothing
    vFade = aStorm < 0.0 ? 1.0 : smoothstep(aStorm, aStorm + 0.3, uCover);
    if (vFade < 0.001) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    float grow = aStorm < 0.0 ? 1.0 + ${GROW.toFixed(2)} * uCover : 0.6 + 0.4 * vFade;
    vUv = uv;
    vCell = aSpr.z;
    // world-anchored, wrapped to stay within the span around the camera
    vec2 c = aCloud.xy + vec2(uDrift, 0.0);
    c = uCam + mod(c - uCam + ${SPAN.toFixed(1)}, ${(SPAN * 2).toFixed(1)}) - ${SPAN.toFixed(1)};
    vec3 centre = vec3(c.x, aCloud.z - (aStorm < 0.0 ? ${SINK.toFixed(1)} * uCover : 0.0), c.y);
    vec3 p = centre + aOff * grow;
    vN = normalize(aOff / vec3(aCloud.w, aCloud.w * ${FLAT.toFixed(2)}, aCloud.w) + vec3(0.0, 0.25, 0.0));
    vH = aOff.y / (aCloud.w * ${FLAT.toFixed(2)});
    vWorld = p;
    // fade out before a cloud wraps round to the other side
    vec2 rel = abs(c - uCam);
    vEdge = 1.0 - smoothstep(${(SPAN * 0.72).toFixed(1)}, ${(SPAN * 0.97).toFixed(1)}, max(rel.x, rel.y));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float cs = cos(aSpr.y), sn = sin(aSpr.y);
    vec2 q = position.xy;
    mv.xy += vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * aSpr.x * grow;
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec3 uSun;      // toward the light (sun, or moon at night)
  uniform vec3 uLit;      // a cloud's sunlit side
  uniform vec3 uShade;    // its belly and the side away from the light
  uniform vec3 uRim;      // silver lining colour
  uniform vec3 uHaze;     // the horizon, to fade into far away
  uniform float uCover;   // how overcast, 0..1: heavier, darker clouds
  varying vec2 vUv;
  varying float vCell;
  varying vec3 vN;
  varying float vH;
  varying vec3 vWorld;
  varying float vEdge;
  varying float vFade;
  void main() {
    float col = mod(vCell, 4.0), row = floor(vCell / 4.0 + 0.01);
    vec2 uv = clamp(vUv, 0.01, 0.99);
    float m = texture2D(atlas, vec2((col + uv.x) * 0.25, 1.0 - (row + 1.0 - uv.y) * 0.25)).r;
    float a = smoothstep(0.04, 0.6, m) * vEdge * vFade;
    if (a < 0.01) discard;
    float ndl = dot(vN, uSun) * 0.5 + 0.5;
    vec3 c = mix(uShade, uLit, ndl);
    c *= mix(0.7 - 0.25 * uCover, 1.0, smoothstep(-1.0, 0.5, vH)); // darker bellies (darker still in a storm)
    vec3 v = normalize(vWorld - cameraPosition);
    float fwd = pow(max(dot(v, uSun), 0.0), 5.0);
    c += uRim * fwd * (1.0 - smoothstep(0.2, 0.8, m)) * 0.8 * (1.0 - 0.7 * uCover); // thin edges glow against the sun
    c = mix(c, uHaze, smoothstep(260.0, ${(SPAN * 0.95).toFixed(1)}, length(vWorld.xz - cameraPosition.xz)) * 0.7);
    gl_FragColor = vec4(c, a * mix(0.92, 1.0, uCover));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Where each cloud's shade falls on the ground (x, z, radius, strength), for the terrain shader. */
const shadowUniforms = {
  uCloudShadow: { value: Array.from({ length: N }, () => new THREE.Vector4()) },
  uCloudShadowK: { value: 0 },
};

/**
 * Darkens the direct sunlight under the clouds' shade on a lit material (the terrain): the sky light stays,
 * so the patches read as soft and blue rather than black.
 */
export function cloudShadow(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
  Object.assign(shader.uniforms, shadowUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vCloudW;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudW = (modelMatrix * vec4(transformed, 1.0)).xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec2 vCloudW;\nuniform vec4 uCloudShadow[${N}];\nuniform float uCloudShadowK;`)
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       if (uCloudShadowK > 0.0) {
         float shade = 0.0;
         for (int i = 0; i < ${N}; i++) {
           vec4 s = uCloudShadow[i];
           shade += s.w * (1.0 - smoothstep(s.z * 0.3, s.z, length(vCloudW - s.xy)));
         }
         reflectedLight.directDiffuse *= 1.0 - min(shade, 1.0) * uCloudShadowK;
       }`,
    );
}

export class Clouds {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  /** per cloud, its quads' attribute slices, so the draw order can follow the clouds' distance */
  private parts: { cloud: number; data: Float32Array }[] = [];
  private order: number[] = [];
  private sortedAt = 0;
  private aCloud: THREE.InstancedBufferAttribute;
  private aOff: THREE.InstancedBufferAttribute;
  private aSpr: THREE.InstancedBufferAttribute;
  private aStorm: THREE.InstancedBufferAttribute;
  private count = 0;
  private drift = 0;
  private lastAt = performance.now();

  constructor() {
    const r = mulberry32(57);
    const puff = CELLS.indexOf('puff'), smoke = CELLS.indexOf('smoke');
    const rows: number[][] = [];
    CLOUDS.forEach((cl, ci) => {
      // quads: big soft ones filling the middle, smaller ones on the rim and the domed top; a storm cloud's are
      // flatter and mostly smoke, for ragged edges
      const storm = cl.storm >= 0, flat = storm ? 0.6 : 1, puffy = storm ? 0.35 : 0.6;
      const n = Math.round(10 + cl.r * 0.3);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * cl.r * 0.75;
        const ox = Math.cos(a) * d, oz = Math.sin(a) * d * 0.8;
        const dome = 1 - (d / cl.r) ** 2;
        const oy = (r() * 0.9 - 0.25) * cl.r * FLAT * dome * flat;
        const size = cl.r * (0.55 + 0.5 * dome) * (0.8 + r() * 0.4);
        rows.push([ci, cl.x, cl.z, cl.y, cl.r, ox, oy, oz, size, r() * Math.PI * 2, r() < puffy ? puff : smoke, cl.storm]);
      }
    });
    this.count = rows.length;
    for (let ci = 0; ci < CLOUDS.length; ci++) {
      const mine = rows.filter((w) => w[0] === ci);
      // bottom quads first, so the lit tops are drawn over the bellies
      mine.sort((p, q) => p[6] - q[6]);
      this.parts.push({ cloud: ci, data: new Float32Array(mine.flatMap((w) => w.slice(1))) });
      this.order.push(ci);
    }
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aCloud = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 4), 4);
    this.aOff = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
    this.aSpr = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3), 3);
    this.aStorm = new THREE.InstancedBufferAttribute(new Float32Array(this.count), 1);
    geo.setAttribute('aCloud', this.aCloud);
    geo.setAttribute('aOff', this.aOff);
    geo.setAttribute('aSpr', this.aSpr);
    geo.setAttribute('aStorm', this.aStorm);
    this.writeOrder();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        atlas: { value: particleAtlas() }, uDrift: { value: 0 }, uCam: { value: new THREE.Vector2() }, uCover: { value: 0 },
        uSun: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.75) },
        uRim: { value: new THREE.Color(1, 0.95, 0.85) }, uHaze: { value: new THREE.Color(0.75, 0.82, 0.9) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -0.5; // after the sky dome, before the world's transparent things
  }

  /** Fills the attributes cloud by cloud, in this.order (farthest first). */
  private writeOrder() {
    const c = this.aCloud.array as Float32Array, o = this.aOff.array as Float32Array, s = this.aSpr.array as Float32Array;
    const st = this.aStorm.array as Float32Array;
    let i = 0;
    const half = settings.s.particles ? 1 : 2; // every other quad with the Particles setting off
    for (const ci of this.order) {
      const d = this.parts[ci].data;
      for (let k = 0, q = 0; k < d.length; k += 11, q++) {
        if (q % half) continue;
        c.set(d.subarray(k, k + 4), i * 4);
        o.set(d.subarray(k + 4, k + 7), i * 3);
        s.set(d.subarray(k + 7, k + 10), i * 3);
        st[i] = d[k + 10];
        i++;
      }
    }
    this.geo.instanceCount = i;
    this.aCloud.needsUpdate = this.aOff.needsUpdate = this.aSpr.needsUpdate = this.aStorm.needsUpdate = true;
  }

  /** Where cloud ci is now (world x, z), the same wrap as the shader. */
  private at(ci: number, drift: number, cam: THREE.Vector3, out: { x: number; z: number }) {
    const wrap = (v: number, c: number) => c + ((((v - c + SPAN) % (2 * SPAN)) + 2 * SPAN) % (2 * SPAN)) - SPAN;
    out.x = wrap(CLOUDS[ci].x + drift, cam.x);
    out.z = wrap(CLOUDS[ci].z, cam.z);
  }

  /**
   * Every frame: drift, light and colours, and where the shade falls. sun points toward the light; lit, shade
   * and rim are this hour's cloud colours; day is 0 at night .. 1 by day (shadows only while the sun is up);
   * cover is how overcast the sky is, 0..1 (atmos.ts cloudCover).
   */
  update(cam: THREE.Vector3, sun: THREE.Vector3, lit: THREE.Color, shade: THREE.Color, rim: THREE.Color, haze: THREE.Color, day: number, cover: number) {
    // the wind picks up as the storm comes in: summed frame by frame, so it speeds up without a jump
    const now = performance.now();
    this.drift += ((now - this.lastAt) / 1000) * WIND * (1 + 1.5 * cover);
    this.lastAt = now;
    const drift = this.drift;
    const u = this.mat.uniforms;
    u.uDrift.value = drift;
    u.uCover.value = cover;
    (u.uCam.value as THREE.Vector2).set(cam.x, cam.z);
    (u.uSun.value as THREE.Vector3).copy(sun);
    (u.uLit.value as THREE.Color).copy(lit);
    (u.uShade.value as THREE.Color).copy(shade);
    (u.uRim.value as THREE.Color).copy(rim);
    (u.uHaze.value as THREE.Color).copy(haze);
    const p = { x: 0, z: 0 };
    // shade on the ground: each cloud's centre carried down along the sunlight
    const sy = Math.max(0.25, sun.y);
    const k = settings.s.shadows === 'off' ? 0 : 0.5 * Math.max(0, Math.min(1, (sun.y - 0.12) / 0.25)) * day;
    shadowUniforms.uCloudShadowK.value = k;
    // (the fair-weather clouds only: under a storm the sun is already dimmed)
    for (let ci = 0; ci < N; ci++) {
      const cl = CLOUDS[ci];
      this.at(ci, drift, cam, p);
      const h = cl.y - SINK * cover - 5;
      shadowUniforms.uCloudShadow.value[ci].set(p.x - (sun.x / sy) * h, p.z - (sun.z / sy) * h, cl.r * 0.95 * (1 + GROW * cover), 0.9);
    }
    // farthest clouds first, re-sorted now and then (they move slowly)
    if (now - this.sortedAt > 700) {
      this.sortedAt = now;
      const dist = this.order.map((ci) => {
        this.at(ci, drift, cam, p);
        return (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 + (CLOUDS[ci].y - cam.y) ** 2;
      });
      const next = this.order.map((ci, i) => [ci, dist[i]] as const).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
      if (next.some((ci, i) => ci !== this.order[i])) {
        this.order = next;
        this.writeOrder();
      }
    }
  }
}
