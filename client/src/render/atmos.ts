// Atmosphere: the things that make the same low-poly world read differently by the hour.
// Day/night state, wind sway, shader water, drifting motes, pooled local lights and the
// screen-space light shafts / tilt-shift shaders. Every piece has its own switch in Options.
import * as THREE from 'three';
import { settings } from '../settings';
import { biomeWeight, heightAt, regionAt, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { waterRipple } from './propTex';

/** Length of a full day. It runs off the wall clock, so every player sees the same hour without the server. */
export const DAY_MS = 20 * 60 * 1000;

/** Share of the cycle the sun spends above the horizon: nights are short, about 4 of the 20 minutes. */
const DAY_SHARE = 0.8;

/**
 * Where the sun is in its round: 0 = sunrise, π = sunset, 2π = the next sunrise. The day half is
 * stretched and the night half squeezed, so the in-game clock simply runs faster after dark.
 */
export function sunPhase(): number {
  const fixed = (globalThis as { __sunPhase?: number }).__sunPhase; // a fixed hour for dev views (?town=…&hour=)
  if (fixed !== undefined) return fixed;
  const f = ((Date.now() % DAY_MS) / DAY_MS + 0.2) % 1; // offset so a fresh cycle starts mid-morning
  return f < DAY_SHARE ? (f / DAY_SHARE) * Math.PI : Math.PI + ((f - DAY_SHARE) / (1 - DAY_SHARE)) * Math.PI;
}

/** In-game time as HH:MM (sunrise 06:00, sunset 18:00), to the nearest ten minutes. */
export function gameClock(): string {
  const m = Math.round((((sunPhase() / (2 * Math.PI)) * 24 + 6) % 24) * 6) * 10;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** What the sky decided this frame, for everything else that reacts to it. */
export const ATMOS = {
  /** 0 = deep night .. 1 = full day */
  day: 1,
  /** toward the sun (it goes below the horizon at night) */
  sunDir: new THREE.Vector3(0.45, 0.8, 0.3).normalize(),
  /** toward the light that is actually shining: the sun, or the moon at night */
  lightDir: new THREE.Vector3(0.45, 0.8, 0.3).normalize(),
  lightColor: new THREE.Color(0xfff0d0),
  top: new THREE.Color(0x4a86d0),
  horizon: new THREE.Color(0xb8d4ec),
};

// ---------------------------------------------------------------- wind
const WIND = { value: 0 }, WIND_ON = { value: 1 };

export function tickWind(dt: number) {
  WIND.value += dt;
  WIND_ON.value = settings.s.wind ? 1 : 0;
}

/**
 * Make a material sway in the wind: vertices lean with the square of their height, so roots stay put.
 * `amp` is the lean per metre² (grass ≈ 0.4, tree canopies ≈ 0.008).
 * ponytail: shadows don't sway with it (the depth pass uses the still geometry); needs a custom depth material if it shows.
 */
export function sway<T extends THREE.Material>(m: T, amp: number): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.uniforms.uWindOn = WIND_ON;
    sh.uniforms.uSway = { value: amp };
    sh.vertexShader = `uniform float uWind, uWindOn, uSway;\n${sh.vertexShader}`.replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
      {
        float h = max(position.y, 0.0);
        #ifdef USE_INSTANCING
          vec2 ph = instanceMatrix[3].xz;
        #else
          vec2 ph = position.xz;
        #endif
        float k = uSway * uWindOn * h * h;
        transformed.x += sin(uWind * 1.7 + ph.x * 0.31 + ph.y * 0.17) * k;
        transformed.z += cos(uWind * 1.3 + ph.x * 0.23 - ph.y * 0.29) * k * 0.7;
      }`);
  };
  return m;
}

// ---------------------------------------------------------------- water
/**
 * Rippling water that mirrors the sky and glints under the sun, clearer in the shallows. The depth it
 * needs comes from a texture baked once out of the terrain heights.
 */
export function waterMaterial(): THREE.ShaderMaterial {
  const N = Math.round((384 * WORLD_HALF) / 500), data = new Uint8Array(N * N); // ~2.6 m a texel
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 * WORLD_HALF - WORLD_HALF, z = ((j + 0.5) / N) * 2 * WORLD_HALF - WORLD_HALF;
      data[j * N + i] = Math.max(0, Math.min(255, ((WATER_LEVEL - heightAt(x, z)) / 4) * 255));
    }
  const depth = new THREE.DataTexture(data, N, N, THREE.RedFormat);
  depth.magFilter = depth.minFilter = THREE.LinearFilter;
  depth.needsUpdate = true;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 }, depthTex: { value: depth }, worldHalf: { value: WORLD_HALF }, day: { value: 1 },
      sunDir: { value: ATMOS.lightDir }, sunColor: { value: ATMOS.lightColor }, top: { value: ATMOS.top }, horizon: { value: ATMOS.horizon },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 90 }, fogFar: { value: 420 },
      // planar reflection of the world (render/reflect.ts, Cinematic preset); off: the analytic sky
      reflTex: { value: null as THREE.Texture | null }, reflMat: { value: new THREE.Matrix4() }, reflOn: { value: 0 },
      // textured ripples on top of the analytic ones (propTex.ts turns them on with the textures)
      ...waterRipple,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time, worldHalf, day, fogNear, fogFar;
      uniform sampler2D depthTex;
      uniform highp sampler2DArray uRippleTex;
      uniform float uRippleLayer, uRippleOn, reflOn;
      uniform sampler2D reflTex;
      uniform mat4 reflMat;
      uniform vec3 sunDir, sunColor, top, horizon, fogColor;
      varying vec3 vWorld;
      // height of two ripple fields drifting in different directions (G channel of the ripple layer)
      float rippleH(vec2 p) {
        vec2 a = p * 0.09 + vec2(time * 0.021, time * 0.013);
        vec2 b = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.14 - vec2(time * 0.017, -time * 0.024);
        return texture(uRippleTex, vec3(a, uRippleLayer)).g + texture(uRippleTex, vec3(b, uRippleLayer)).g * 0.6;
      }
      void main() {
        vec2 p = vWorld.xz;
        // two sets of travelling ripples, as slopes
        vec2 g = 0.35 * vec2(cos(p.x * 0.9 + time * 1.3), cos(p.y * 1.1 - time * 1.1))
               + 0.22 * vec2(cos((p.x + p.y) * 1.7 - time * 1.9), cos((p.x - p.y) * 1.5 + time * 1.6))
               + 0.10 * vec2(cos(p.x * 3.7 + time * 2.7), cos(p.y * 4.1 + time * 2.3));
        if (uRippleOn > 0.5) {
          // irregular swell from the texture breaks up the regular sine pattern
          const float e = 0.35;
          float h0 = rippleH(p);
          g += vec2(rippleH(p + vec2(e, 0.0)) - h0, rippleH(p + vec2(0.0, e)) - h0) / e * 1.6;
        }
        vec3 n = normalize(vec3(-g.x * 0.22, 1.0, -g.y * 0.22));
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 r = reflect(-v, n);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        float d = texture2D(depthTex, p / (2.0 * worldHalf) + 0.5).r; // 0..1 = 0..4 m of water
        vec3 body = mix(vec3(0.15, 0.50, 0.60), vec3(0.04, 0.19, 0.36), smoothstep(0.0, 0.45, d)) * mix(0.22, 1.0, day);
        vec3 sky = mix(horizon, top, smoothstep(0.0, 0.6, r.y));
        if (reflOn > 0.5) {
          // the mirrored world, displaced by the ripples; the mirror image already contains the sky
          vec4 rc = reflMat * vec4(vWorld, 1.0);
          sky = texture2D(reflTex, clamp(rc.xy / rc.w + n.xz * 0.035, 0.001, 0.999)).rgb;
        }
        vec3 c = mix(body, sky, 0.10 + 0.55 * fres);
        c += sunColor * pow(max(dot(r, sunDir), 0.0), 160.0) * 1.6;
        // soft shore foam: the depth is coarse (~2.5 m a texel), so no crisp line; a moving churn mask breaks the band up
        float churn = 0.5 + 0.5 * sin((p.x + p.y) * 2.3 + time * 2.1) * cos(p.x * 1.9 - time * 1.7 + p.y * 2.6);
        float foam = (1.0 - smoothstep(0.03, 0.14, d)) * smoothstep(0.35, 0.9, churn);
        c = mix(c, mix(vec3(1.0), horizon, 0.25) * mix(0.4, 1.0, day), foam * 0.45);
        float a = mix(0.62, 0.95, smoothstep(0.0, 0.35, d));
        c = mix(c, fogColor, smoothstep(fogNear, fogFar, length(cameraPosition - vWorld)));
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- motes
/** Dust in the daylight, fireflies after dark: a small cloud of points that stays around the player. */
const tint = new THREE.Color();
export class Motes {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private mat: THREE.PointsMaterial;
  private readonly N = 260;
  private readonly BOX = 34;

  constructor() {
    this.pos = new Float32Array(this.N * 3);
    for (let i = 0; i < this.pos.length; i++) this.pos[i] = (Math.random() * 2 - 1) * (i % 3 === 1 ? 7 : this.BOX);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    // a soft round dot instead of the default square
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const cx = cv.getContext('2d')!, grad = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 32, 32);
    this.mat = new THREE.PointsMaterial({ size: 0.12, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  update(center: THREE.Vector3, dt: number, t: number) {
    this.points.visible = settings.s.particles;
    if (!this.points.visible) return;
    const p = this.pos, B = this.BOX, night = 1 - ATMOS.day;
    // snow over the frost lands, ash over the volcanic ones: the cloud thickens and falls; elsewhere only 70 drift
    const snow = biomeWeight('frost', center.x, center.z), ash = biomeWeight('ash', center.x, center.z), fall = Math.max(snow, ash);
    const n = Math.round(70 + (this.N - 70) * fall);
    this.points.geometry.setDrawRange(0, n);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // Each one meanders on its own, in world space. Only those left behind (or too high / low) are
      // recycled to the far side, so the cloud never appears to travel with the player.
      p[o] += (Math.sin(t * 0.4 + i) * 0.5 + 0.35) * dt;
      p[o + 1] += (Math.sin(t * 0.7 + i * 1.7) * 0.25 - fall * (1.2 + (i % 5) * 0.2)) * dt;
      p[o + 2] += Math.cos(t * 0.33 + i * 0.6) * 0.45 * dt;
      const dx = p[o] - center.x, dy = p[o + 1] - (center.y + 7.5), dz = p[o + 2] - center.z;
      if (Math.abs(dx) > B) p[o] -= Math.sign(dx) * 2 * B;
      if (Math.abs(dz) > B) p[o + 2] -= Math.sign(dz) * 2 * B;
      if (Math.abs(dy) > 7) p[o + 1] -= Math.sign(dy) * 14;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.mat.color.setRGB(1 - night * 0.2, 0.96, 0.82 - night * 0.45).lerp(tint.setRGB(0.95, 0.97, 1), snow).lerp(tint.setRGB(0.45, 0.4, 0.38), ash);
    // ash and snow are not additive light: switch to normal blending under them
    this.mat.blending = fall > 0.3 ? THREE.NormalBlending : THREE.AdditiveBlending;
    this.mat.size = 0.14 + night * 0.08 + fall * 0.1;
    this.mat.opacity = 0.25 + night * (0.35 + 0.15 * Math.sin(t * 3)) + fall * 0.45;
  }
}

// ---------------------------------------------------------------- weather
/** How often each region rains (share of the time). Frost snows and ash rains ash already (Motes). */
const RAIN_SHARE: Record<string, number> = { dawn: 0.08, dusk: 0.1, heart: 0.14, dragon: 0.08, swamp: 0.3 };
/**
 * Rain at (x, z) now, 0..1. It runs off the wall clock like the day, so everyone in a region sees the
 * same shower; each region has its own phase, so it can pour in the swamp while the Heart is dry.
 * ponytail: a fixed wave per region, no fronts moving across the map; a server-sent weather state is the upgrade.
 */
export function rainAt(x: number, z: number, now = Date.now()): number {
  const forced = (globalThis as { __rain?: number }).__rain; // a fixed shower for dev views and tests
  if (forced !== undefined) return forced;
  const wet = wetness(x, z, now);
  return wet === null ? 0 : Math.min(1, Math.max(0, wet / 0.12));
}

/**
 * How overcast the sky is at (x, z) now, 0..1: the clouds gather off the same wave as the rain, but sooner, so
 * the sky closes in a few minutes before the first drop (about 0.4 by then) and breaks up as long after the last.
 */
export function cloudCover(x: number, z: number, now = Date.now()): number {
  const g = globalThis as { __rain?: number; __cover?: number }; // dev views: a fixed cover, or the one a forced shower has
  if (g.__cover !== undefined) return g.__cover;
  if (g.__rain !== undefined) return g.__rain > 0 ? 0.45 + 0.55 * g.__rain : 0;
  const wet = wetness(x, z, now);
  return wet === null ? 0 : Math.min(1, Math.max(0, (wet + 0.08) / 0.2));
}

/** The region's weather wave over its rain threshold (it rains above 0), or null where it never rains. */
function wetness(x: number, z: number, now: number): number | null {
  const r = regionAt(x, z) ?? 'dawn', share = RAIN_SHARE[r] ?? 0;
  if (!share) return null;
  const k = r.length * 1.7 + r.charCodeAt(0) * 0.13, t = now / 420000; // a 7-minute beat
  const w = 0.5 + 0.35 * Math.sin(t + k) + 0.15 * Math.sin(t * 2.3 + k * 3.1);
  return w - (1 - share);
}

/** Lightning falls only in a downpour: rainAt above this. */
export const STORM_RAIN = 0.6;
const STRIKE_CELL = 300;
/** chance a cell gets a strike in a given second: with the 9 cells around the player, one every ~15 s in a downpour */
const STRIKE_P = 1 / 135;
const hash01 = (a: number, b: number, c: number, salt: number) => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/**
 * The lightning strikes of second `sec` (wall clock) around (x, z). The world is cut into 300 m cells and each cell
 * draws its own strikes from the clock, like rainAt: everyone near a cell sees the same bolt at the same moment.
 */
export function stormStrikes(x: number, z: number, sec: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const cx0 = Math.floor(x / STRIKE_CELL), cz0 = Math.floor(z / STRIKE_CELL);
  for (let cx = cx0 - 1; cx <= cx0 + 1; cx++)
    for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) {
      if (hash01(cx, cz, sec, 1) >= STRIKE_P) continue;
      const sx = (cx + hash01(cx, cz, sec, 2)) * STRIKE_CELL, sz = (cz + hash01(cx, cz, sec, 3)) * STRIKE_CELL;
      if (rainAt(sx, sz, sec * 1000) >= STORM_RAIN) out.push({ x: sx, z: sz });
    }
  return out;
}

/** Rain streaks around the player: a box of short lines falling fast, recycled to the top. */
export class Rain {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private readonly N = 1400;
  private readonly BOX = 28;

  constructor() {
    this.pos = new Float32Array(this.N * 6);
    for (let i = 0; i < this.N; i++) {
      const x = (Math.random() * 2 - 1) * this.BOX, y = Math.random() * 24, z = (Math.random() * 2 - 1) * this.BOX;
      this.pos.set([x, y, z, x + 0.05, y + 0.7, z + 0.03], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
  }

  update(center: THREE.Vector3, dt: number) {
    const rain = settings.s.particles ? rainAt(center.x, center.z) : 0;
    this.lines.visible = rain > 0.01;
    if (!this.lines.visible) return;
    this.lines.geometry.setDrawRange(0, Math.round(this.N * rain) * 2);
    this.lines.position.set(center.x, center.y - 4, center.z);
    const p = this.pos, fall = 22 * dt;
    for (let i = 0; i < this.N * 6; i += 6) {
      p[i + 1] -= fall;
      p[i + 4] -= fall;
      if (p[i + 1] < 0) (p[i + 1] += 24), (p[i + 4] += 24);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.mat.opacity = 0.35 * rain;
  }
}

// ---------------------------------------------------------------- critters
/** One wing: a flat quad hinged on the body (x = 0), pointing +x, nose towards +z. */
function wingGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 1, 0, 0.45, 0.85, 0, -0.5, 0, 0, 0.35, 0.85, 0, -0.5, 0, 0, -0.3], 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Butterflies over the grass by day and a few birds wheeling overhead: things that move, so the land
 * never looks frozen. Each critter is two instanced wings flapped through its matrix.
 * ponytail: purely cosmetic and local (every player sees their own); no shadows, no collision.
 */
export class Critters {
  readonly group = new THREE.Group();
  private bfL: THREE.InstancedMesh;
  private bfR: THREE.InstancedMesh;
  private bdL: THREE.InstancedMesh;
  private bdR: THREE.InstancedMesh;
  private region: string | null | undefined = undefined;
  private bf = Array.from({ length: 22 }, (_, i) => ({ x: 0, z: 0, yaw: 0, ph: i * 2.39, live: false }));
  private birds = Array.from({ length: 7 }, (_, i) => ({ a: i * 0.9, r: 14 + (i % 3) * 7, h: 24 + (i % 4) * 5, ph: i * 1.7, cx: 0, cz: 0, live: false }));
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    const geo = wingGeo();
    const bfMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: 0x222222 });
    const birdMat = new THREE.MeshLambertMaterial({ color: 0x2a2622, side: THREE.DoubleSide });
    this.bfL = new THREE.InstancedMesh(geo, bfMat, this.bf.length);
    this.bfR = new THREE.InstancedMesh(geo, bfMat, this.bf.length);
    this.bdL = new THREE.InstancedMesh(geo, birdMat, this.birds.length);
    this.bdR = new THREE.InstancedMesh(geo, birdMat, this.birds.length);
    const hues = [0xffd23a, 0xffffff, 0xff8a3d, 0x6fb8ff, 0xd88cff, 0xff5a7a];
    const c = new THREE.Color();
    this.bf.forEach((_, i) => {
      c.setHex(hues[i % hues.length]);
      this.bfL.setColorAt(i, c);
      this.bfR.setColorAt(i, c);
    });
    for (const im of [this.bfL, this.bfR, this.bdL, this.bdR]) (im.frustumCulled = false), this.group.add(im);
  }

  private put(im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, flap: number, sc: number, side: 1 | -1) {
    this.q.setFromEuler(this.e.set(0, yaw, flap * side, 'YXZ'));
    im.setMatrixAt(i, this.m.compose(this.v.set(x, y, z), this.q, this.s.set(sc * side, sc, sc)));
  }

  update(center: THREE.Vector3, dt: number, t: number) {
    const on = settings.s.particles;
    this.group.visible = on;
    if (!on) return;
    const harsh = Math.max(biomeWeight('frost', center.x, center.z), biomeWeight('ash', center.x, center.z));
    // butterflies: only in daylight and away from snow and ash; each zig-zags and is recycled ahead of the player once left behind
    const region = regionAt(center.x, center.z), wet = rainAt(center.x, center.z);
    const swampy = region === 'swamp', night = ATMOS.day < 0.3;
    // the region's fauna: dragonflies over the swamp, butterflies elsewhere (in daylight, dry weather, off the snow and ash)
    const bfOn = ATMOS.day > 0.45 && harsh < 0.4 && wet < 0.3;
    if (region !== this.region) {
      this.region = region;
      const pal = swampy ? [0x3fd0c0, 0x4a90ff, 0x9ae05a]
        : region === 'dusk' ? [0xff8a3d, 0xffc23a, 0xc84a2a, 0xfff0c0]
        : region === 'heart' ? [0x6fb8ff, 0xd88cff, 0xffffff, 0xff5a7a]
        : [0xffd23a, 0xffffff, 0xff8a3d, 0x6fb8ff, 0xd88cff, 0xff5a7a];
      const c = new THREE.Color();
      this.bf.forEach((_, i) => {
        c.setHex(pal[i % pal.length]);
        this.bfL.setColorAt(i, c);
        this.bfR.setColorAt(i, c);
      });
      this.bfL.instanceColor!.needsUpdate = this.bfR.instanceColor!.needsUpdate = true;
      // overhead: gulls in the Heart's river country, crows over the dragon's land and the ash, pale birds in the frost
      (this.bdL.material as THREE.MeshLambertMaterial).color.setHex(region === 'frost' ? 0xe8eef4 : region === 'heart' ? 0xf4f4f0 : region === 'dragon' || region === 'ash' ? 0x141214 : 0x2a2622);
    }
    // bats at night: small, fast and fluttering instead of gliding
    const birdSc = night ? 0.3 : region === 'dragon' ? 0.9 : 0.55, flapHz = night ? 16 : 7, birdLow = night ? 0.45 : 1;
    this.bfL.visible = this.bfR.visible = bfOn;
    if (bfOn) {
      this.bf.forEach((b, i) => {
        if (!b.live || Math.hypot(b.x - center.x, b.z - center.z) > 26) {
          const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 18;
          Object.assign(b, { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, yaw: Math.random() * 6.3, live: true });
        }
        b.yaw += Math.sin(t * 1.3 + b.ph) * 2.2 * dt;
        const sp = swampy ? 3.2 : 1.3;
        b.x += Math.sin(b.yaw) * sp * dt;
        b.z += Math.cos(b.yaw) * sp * dt;
        const g = heightAt(b.x, b.z);
        if (g < WATER_LEVEL) b.live = false;
        const y = g + (swampy ? 0.7 : 0.5) + Math.abs(Math.sin(t * 1.1 + b.ph)) * (swampy ? 0.3 : 0.9);
        const flap = swampy ? 0.2 + Math.sin(t * 60 + b.ph) * 0.25 : Math.sin(t * 22 + b.ph) * 1.1;
        this.put(this.bfR, i, b.x, y, b.z, b.yaw, flap, 0.11, 1);
        this.put(this.bfL, i, b.x, y, b.z, b.yaw, flap, 0.11, -1);
      });
      this.bfL.instanceMatrix.needsUpdate = this.bfR.instanceMatrix.needsUpdate = true;
    }
    // birds: a loose flock circling over a spot near the player, flapping then gliding
    this.birds.forEach((b, i) => {
      if (!b.live || Math.hypot(b.cx - center.x, b.cz - center.z) > 90) Object.assign(b, { cx: center.x + (Math.random() - 0.5) * 60, cz: center.z + (Math.random() - 0.5) * 60, live: true });
      b.a += (6 / b.r) * dt;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      const glide = night ? 1 : Math.sin(t * 0.45 + b.ph) > 0.2 ? 0.12 : 1;
      const flap = 0.15 + Math.sin(t * flapHz + b.ph) * 0.6 * glide;
      const y = Math.max(heightAt(b.cx, b.cz), WATER_LEVEL) + b.h * birdLow + Math.sin(t * (night ? 2.1 : 0.3) + b.ph) * 2;
      const yaw = Math.atan2(-Math.sin(b.a), Math.cos(b.a));
      this.put(this.bdR, i, x, y, z, yaw, flap, birdSc, 1);
      this.put(this.bdL, i, x, y, z, yaw, flap, birdSc, -1);
    });
    this.bdL.instanceMatrix.needsUpdate = this.bdR.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- local lights
export interface LightSource { x: number; y: number; z: number; fire: boolean }

/**
 * Lamp posts, campfires and the forge light what is near them. Real point lights are expensive for
 * every material in view, so a small pool follows the player and takes the nearest sources.
 */
export class LocalLights {
  private pool: THREE.PointLight[] = [];
  private static readonly SIZE = 4;
  private near: (LightSource | null)[] = new Array(LocalLights.SIZE).fill(null);
  private nearD = new Float64Array(LocalLights.SIZE);
  /** what each pool slot is currently shining on, and its 0..1 fade (crossfade instead of a pop when the ranking changes) */
  private slotSrc: (LightSource | null)[] = new Array(LocalLights.SIZE).fill(null);
  private fade = new Float64Array(LocalLights.SIZE);
  private lastT = 0;
  /** spell flashes (fx.ts): they borrow the pool's last slots while they last, lamps fade back in after */
  private flashes = Array.from({ length: LocalLights.SIZE }, () => ({ x: 0, y: 0, z: 0, color: 0, power: 0, range: 0, t0: 0, ms: 0 }));

  constructor(private scene: THREE.Scene, private sources: LightSource[]) {}

  /** A short light at a spell's impact (only with the Local lights setting). The oldest flash gives way to a new one. */
  flash(p: THREE.Vector3, color: number, power: number, range: number, ms: number) {
    if (!settings.s.localLights) return;
    const now = performance.now();
    const f = this.flashes.reduce((a, b) => (b.t0 + b.ms < a.t0 + a.ms ? b : a));
    Object.assign(f, { x: p.x, y: p.y, z: p.z, color, power, range, t0: now, ms });
  }

  update(p: THREE.Vector3, t: number) {
    const on = settings.s.localLights;
    if (on !== this.pool.length > 0) {
      // adding or removing lights recompiles the lit shaders, so the pool keeps a fixed size while on
      if (on) for (let i = 0; i < LocalLights.SIZE; i++) this.scene.add(this.pool[this.pool.push(new THREE.PointLight(0xffa050, 0, 24, 1.6)) - 1]);
      else for (const l of this.pool.splice(0)) this.scene.remove(l), l.dispose();
    }
    if (!on) return;
    const night = 1 - ATMOS.day;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    // nearest SIZE sources within 60 m, by insertion into fixed slots: no per-frame arrays to collect
    const near = this.near, nd = this.nearD;
    near.fill(null);
    nd.fill(60 * 60);
    for (const s of this.sources) {
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d >= nd[nd.length - 1]) continue;
      let j = nd.length - 1;
      for (; j > 0 && nd[j - 1] > d; j--) (nd[j] = nd[j - 1]), (near[j] = near[j - 1]);
      nd[j] = d;
      near[j] = s;
    }
    this.pool.forEach((l, i) => {
      const want = near[i];
      // a dark slot may pick up its new source: position and colour move while invisible
      if (this.slotSrc[i] !== want && this.fade[i] <= 0) this.slotSrc[i] = want;
      const s = this.slotSrc[i];
      const goal = s && want === s ? 1 : 0; // fade out when another slot's source took this rank
      const speed = dt * 2.5; // ~0.4 s for a full fade
      this.fade[i] = goal > this.fade[i] ? Math.min(this.fade[i] + speed, goal) : Math.max(this.fade[i] - speed, goal);
      if (!s || this.fade[i] <= 0) return void (l.intensity = 0);
      l.position.set(s.x, s.y, s.z);
      l.distance = 24;
      l.color.set(s.fire ? 0xff8a3a : 0xffc878);
      const flicker = s.fire ? 0.88 + 0.12 * Math.sin(t * 11 + i * 2.1) * Math.sin(t * 5.3 + i) : 1;
      // modest: a light sits close to walls and the ground, and bloom multiplies whatever blows out
      l.intensity = (s.fire ? 26 * (0.4 + 0.6 * night) : 16 * night) * flicker * this.fade[i];
    });
    // live flashes take the last slots, brightest first: a quick rise, then a falloff
    const now = performance.now();
    let slot = this.pool.length - 1;
    for (const f of this.flashes) {
      const k = (now - f.t0) / f.ms;
      if (k < 0 || k >= 1 || slot < 0) continue;
      const l = this.pool[slot];
      l.position.set(f.x, f.y, f.z);
      l.color.set(f.color);
      l.distance = f.range;
      l.intensity = f.power * Math.min(1, k * 8) * (1 - k) ** 2;
      // the lamp this slot lit comes back with a fade rather than a pop
      this.fade[slot] = 0;
      this.slotSrc[slot] = null;
      slot--;
    }
  }
}

// ---------------------------------------------------------------- screen-space passes
/** Light shafts: bright sky smeared away from the sun's place on screen. */
export const GodRaysShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, sunPos: { value: new THREE.Vector2(0.5, 1.2) }, strength: { value: 0 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunPos;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (strength > 0.001) {
        vec2 step = (sunPos - vUv) / 28.0;
        vec2 uv = vUv;
        float decay = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 28; i++) {
          uv += step;
          vec4 t = texture2D(tDiffuse, clamp(uv, 0.0, 1.0));
          vec3 s = t.rgb;
          // Only the sky's light: the sky dome writes alpha 0 and everything solid 1 (clouds and glows part of it), so
          // a campfire, a spell or an enchantment's glow - as bright as the sun - no longer streaks away from it as if
          // it were one, and what stands or floats in front of the sun cuts its shafts.
          acc += s * smoothstep(0.9, 1.9, max(max(s.r, s.g), s.b)) * (1.0 - clamp(t.a, 0.0, 1.0)) * decay;
          decay *= 0.95;
        }
        base.rgb += acc / 28.0 * strength;
      }
      gl_FragColor = base;
    }`,
};

/** Tilt-shift: the top and bottom of the screen fall out of focus, like a miniature. */
export const TiltShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, texel: { value: new THREE.Vector2(1 / 1280, 1 / 720) } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    varying vec2 vUv;
    void main() {
      float r = smoothstep(0.22, 0.5, abs(vUv.y - 0.52)) * 3.5;
      vec4 c = texture2D(tDiffuse, vUv);
      if (r > 0.05) {
        vec4 a = c;
        for (int i = 0; i < 8; i++) {
          float an = float(i) * 0.7854;
          a += texture2D(tDiffuse, vUv + vec2(cos(an), sin(an)) * texel * r) + texture2D(tDiffuse, vUv + vec2(cos(an + 0.39), sin(an + 0.39)) * texel * r * 2.0);
        }
        c = a / 17.0;
      }
      gl_FragColor = c;
    }`,
};
