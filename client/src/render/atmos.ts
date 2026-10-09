// Atmosphere: the things that make the same low-poly world read differently by the hour.
// Day/night state, wind sway, shader water, drifting motes, pooled local lights and the
// screen-space light shafts / tilt-shift shaders. Every piece has its own switch in Options.
import * as THREE from 'three';
import { settings } from '../settings';
import { heightAt, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
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
  const N = 384, data = new Uint8Array(N * N);
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
      uniform float uRippleLayer, uRippleOn;
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
        vec3 c = mix(body, sky, 0.10 + 0.55 * fres);
        c += sunColor * pow(max(dot(r, sunDir), 0.0), 160.0) * 1.6;
        // no shore foam: the baked depth is ~2.5 m per texel, far too coarse for a crisp line on a small pond
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
export class Motes {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private mat: THREE.PointsMaterial;
  private readonly N = 70;
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
    for (let i = 0; i < this.N; i++) {
      const o = i * 3;
      // Each one meanders on its own, in world space. Only those left behind (or too high / low) are
      // recycled to the far side, so the cloud never appears to travel with the player.
      p[o] += (Math.sin(t * 0.4 + i) * 0.5 + 0.35) * dt;
      p[o + 1] += Math.sin(t * 0.7 + i * 1.7) * 0.25 * dt;
      p[o + 2] += Math.cos(t * 0.33 + i * 0.6) * 0.45 * dt;
      const dx = p[o] - center.x, dy = p[o + 1] - (center.y + 7.5), dz = p[o + 2] - center.z;
      if (Math.abs(dx) > B) p[o] -= Math.sign(dx) * 2 * B;
      if (Math.abs(dz) > B) p[o + 2] -= Math.sign(dz) * 2 * B;
      if (Math.abs(dy) > 7) p[o + 1] -= Math.sign(dy) * 14;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.mat.color.setRGB(1 - night * 0.2, 0.96, 0.82 - night * 0.45);
    this.mat.size = 0.14 + night * 0.08;
    this.mat.opacity = 0.25 + night * (0.35 + 0.15 * Math.sin(t * 3));
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

  constructor(private scene: THREE.Scene, private sources: LightSource[]) {}

  update(p: THREE.Vector3, t: number) {
    const on = settings.s.localLights;
    if (on !== this.pool.length > 0) {
      // adding or removing lights recompiles the lit shaders, so the pool keeps a fixed size while on
      if (on) for (let i = 0; i < LocalLights.SIZE; i++) this.scene.add(this.pool[this.pool.push(new THREE.PointLight(0xffa050, 0, 24, 1.6)) - 1]);
      else for (const l of this.pool.splice(0)) this.scene.remove(l), l.dispose();
    }
    if (!on) return;
    const night = 1 - ATMOS.day;
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
      const s = near[i];
      if (!s) return void (l.intensity = 0);
      l.position.set(s.x, s.y, s.z);
      l.color.set(s.fire ? 0xff8a3a : 0xffc878);
      const flicker = s.fire ? 0.88 + 0.12 * Math.sin(t * 11 + i * 2.1) * Math.sin(t * 5.3 + i) : 1;
      // modest: a light sits close to walls and the ground, and bloom multiplies whatever blows out
      l.intensity = (s.fire ? 26 * (0.4 + 0.6 * night) : 16 * night) * flicker;
    });
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
          vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
          acc += s * smoothstep(0.9, 1.9, max(max(s.r, s.g), s.b)) * decay;
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
