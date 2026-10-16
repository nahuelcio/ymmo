// Sound (Web Audio): recorded effects, footsteps and weather beds where we have them (public/audio, CC0 / CC-BY,
// see CREDITS.txt), and for every one a tiny recipe of oscillators / filtered noise that plays when its file won't load.
import { versioned } from './assets';
import { settings } from './settings';
import { RAIDS } from '../../shared/src/data/raids';
import type { Footing } from './render/scene';

export type Sfx =
  | 'hit' | 'crit' | 'miss' | 'hurt' | 'cast' | 'magic' | 'heal' | 'buff' | 'levelUp' | 'death'
  | 'coin' | 'pickup' | 'click' | 'warn' | 'slam' | 'dash' | 'stun' | 'dot'
  // world interactions (shared/src/nodes.ts)
  | 'chop' | 'mine' | 'rustle' | 'treeFall' | 'splash';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  preloadSamples(ctx);
  return ctx;
}

// Real recordings for combat cues (CC0, see public/audio/CREDITS.txt). An effect with no decoded sample yet falls back to its synth recipe below.
// paths under /audio/ (see public/audio/CREDITS.txt)
const SAMPLES: Partial<Record<Sfx, string[]>> = {
  hit: ['combat/hit1.wav', 'combat/hit2.wav', 'combat/hit3.wav', 'combat/hit4.wav', 'combat/hit5.wav'],
  crit: ['combat/crit1.wav', 'combat/crit2.wav', 'combat/crit3.wav', 'combat/crit4.wav', 'combat/crit5.wav', 'combat/clash1.wav', 'combat/clash2.wav', 'combat/clash3.wav', 'combat/clash4.wav', 'combat/clash5.wav'],
  miss: ['combat/miss1.wav', 'combat/miss2.wav', 'combat/miss3.wav', 'combat/miss4.wav'],
  magic: ['combat/spell-fire1.wav', 'combat/spell-fire2.wav', 'combat/spell-fire3.wav', 'combat/spell-fire4.wav', 'combat/spell-fire5.wav', 'combat/spell-ice1.wav', 'combat/spell-ice2.wav', 'combat/spell-ice3.wav', 'combat/spell-ice4.wav', 'combat/spell-ice5.wav', 'combat/spell-lightning1.wav', 'combat/spell-lightning2.wav', 'combat/spell-lightning3.wav', 'combat/spell-lightning4.wav', 'combat/spell-lightning5.wav'],
  cast: ['combat/spell-water1.wav', 'combat/spell-water2.wav', 'combat/spell-water3.wav', 'combat/spell-water4.wav', 'combat/spell-water5.wav'],
  hurt: ['combat/hurt1.wav', 'combat/hurt2.wav'],
  death: ['combat/death1.wav', 'combat/death2.wav'],
  slam: ['combat/slam1.wav', 'combat/slam2.wav'],
  dot: ['combat/dot1.wav', 'combat/dot2.wav', 'combat/dot3.wav'],
};
// Per-effect loudness and length for the samples above: gain scales them, max (seconds) cuts them with a short fade.
// Starting points, not measured: tune these by ear.
const TUNE: Partial<Record<Sfx, { gain: number; max: number }>> = {
  hit: { gain: 0.8, max: 0.5 },
  crit: { gain: 1, max: 0.8 },
  miss: { gain: 0.5, max: 0.45 },
  hurt: { gain: 0.8, max: 0.5 },
  death: { gain: 0.9, max: 0.9 },
  magic: { gain: 0.6, max: 1.2 },
  cast: { gain: 0.5, max: 0.9 },
  heal: { gain: 0.6, max: 1.2 },
  slam: { gain: 1, max: 0.8 },
  dot: { gain: 0.4, max: 0.3 },
};
const decoded = new Map<string, AudioBuffer>();
const asked = new Set<string>();
/** files that would not load or decode: their synth recipe plays instead */
const failed = new Set<string>();

/** Fetch and decode a sample once (decoded holds it when it's ready). */
function want(f: string) {
  if (asked.has(f) || !ctx) return;
  asked.add(f);
  const c = ctx;
  fetch(versioned(`/audio/${f}`))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => c.decodeAudioData(b))
    .then((buf) => {
      decoded.set(f, buf);
      if (f.startsWith('steps')) grains.set(f, grainsOf(buf));
    })
    .catch(() => failed.add(f)); // no sample: the synth recipe still plays
}

/** each footstep file's footfalls: where each one strikes and how long it rings (grainsOf) */
const grains = new Map<string, { at: number; dur: number }[]>();
/**
 * The footfalls in a recording, from its loudness in 5 ms steps: a footfall strikes where the sound jumps to 3x the
 * quietest it was over the last 150 ms (and to a fifth of the loudest in the file), at least 0.25 s after the last
 * one. A single step comes out with the silence before it cut off, so it sounds the moment the foot lands; a
 * recording of someone walking comes out as many single steps.
 */
function grainsOf(buf: AudioBuffer): { at: number; dur: number }[] {
  const d = buf.getChannelData(0), hop = Math.max(1, Math.round(buf.sampleRate * 0.005)), env: number[] = [];
  for (let i = 0; i < d.length; i += hop) {
    let m = 0;
    for (let j = i, e = Math.min(d.length, i + hop); j < e; j++) m = Math.max(m, Math.abs(d[j]));
    env.push(m);
  }
  const peak = env.reduce((a, b) => Math.max(a, b), 0), at: number[] = [];
  let last = -Infinity;
  for (let k = 0; k < env.length; k++) {
    if (env[k] < peak * 0.2 || k - last < 50) continue;
    let low = env[k];
    for (let j = Math.max(0, k - 30); j < k; j++) low = Math.min(low, env[j]);
    if (k === 0 || env[k] >= low * 3) {
      at.push(Math.max(0, (k * hop) / buf.sampleRate - 0.005));
      last = k;
    }
  }
  return at.map((a, i) => ({ at: a, dur: Math.min(0.35, (at[i + 1] ?? buf.duration) - a) }));
}

function preloadSamples(_c: AudioContext) {
  // combat cues and footsteps are small and wanted at once; the weather beds and thunder load when first needed
  for (const f of new Set([...Object.values(SAMPLES).flatMap((l) => l ?? []), ...Object.values(STEPS).flatMap((s) => s.files)])) want(f);
}

// browsers only allow audio after a user gesture
addEventListener('pointerdown', () => (void audio()?.resume(), syncLoops()), { capture: true });
addEventListener('keydown', () => (void audio()?.resume(), syncLoops()), { capture: true });

// Background loops (CC0 files, see public/audio/CREDITS.txt), streamed so they never hold up loading.
// ponytail: <audio loop> leaves a small gap at the seam (worst on the mp3) and cuts hard between
// worlds; decode into AudioBuffers and crossfade through gain nodes if that gets noticeable.
function loop(file: string, gain: number, dungeon: boolean) {
  const el = new Audio(versioned(`/audio/${file}`));
  el.loop = true;
  el.preload = 'none';
  return { el, gain, dungeon };
}
const LOOPS = [loop('exploration.ogg', 0.6, false), loop('forest.mp3', 0.5, false), loop('dungeon.ogg', 0.9, true)];
const FOREST = LOOPS[1];
let inDungeon = false;
/** the forest's birds fall quiet in the rain, the snow and the ash (setWeather) */
let forestDuck = 1;

function syncLoops() {
  for (const l of LOOPS) {
    l.el.volume = settings.s.music * l.gain * (l === FOREST ? forestDuck : 1);
    // play() rejects until the first user gesture (and on browsers without Ogg): the gesture listeners retry
    if (l.el.volume > 0 && l.dungeon === inDungeon) void l.el.play().catch(() => {});
    else l.el.pause();
  }
}
settings.on(syncLoops);

/** Pick the background loops for the zone the player is in (raid instances get the dungeon bed). */
export function ambience(zone: string) {
  inDungeon = Object.values(RAIDS).some((r) => r.name === zone);
  syncLoops();
}

/** In a raid instance, which is indoors: no weather there. */
export const indoors = () => inDungeon;

function tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, vol: number, out: AudioNode) {
  const c = ctx!;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function hiss(t0: number, dur: number, vol: number, f0: number, f1: number, q: number, out: AudioNode, type: BiquadFilterType = 'bandpass') {
  const c = ctx!;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noise;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t0, Math.random() * 0.5);
  s.stop(t0 + dur + 0.02);
}

/** Play an effect. `gain` scales it (e.g. by distance from the listener). */
export function play(name: Sfx, gain = 1) {
  const vol = settings.s.volume * gain;
  if (vol <= 0.001) return;
  const c = audio();
  if (!c || c.state !== 'running' || !master) return;
  const out = c.createGain();
  out.gain.value = vol;
  out.connect(master);
  // every effect gets its own output node: unplug it once the sound is over, or each one stays wired to the master
  const unplug = (ms: number) => setTimeout(() => out.disconnect(), ms);
  const t = c.currentTime + 0.005;
  const r = 0.94 + Math.random() * 0.12; // a little pitch variety
  const ready = (SAMPLES[name] ?? []).filter((f) => decoded.has(f));
  if (ready.length) {
    const src = c.createBufferSource();
    const tune = TUNE[name] ?? { gain: 1, max: 1 };
    const g = c.createGain();
    src.buffer = decoded.get(ready[Math.floor(Math.random() * ready.length)])!;
    src.playbackRate.value = r;
    g.gain.setValueAtTime(tune.gain, t + tune.max - 0.08);
    g.gain.linearRampToValueAtTime(0, t + tune.max);
    src.connect(g).connect(out);
    src.start(t, 0, tune.max);
    src.onended = () => out.disconnect();
    return;
  }
  unplug(4000); // longer than any synthesized effect
  switch (name) {
    case 'hit':
      hiss(t, 0.09, 0.5, 2200 * r, 600, 1.2, out);
      tone('triangle', 140 * r, 60, t, 0.1, 0.5, out);
      break;
    case 'crit':
      hiss(t, 0.14, 0.7, 3000 * r, 500, 1, out);
      tone('triangle', 110 * r, 45, t, 0.18, 0.8, out);
      tone('square', 1400 * r, 900, t + 0.01, 0.12, 0.08, out);
      break;
    case 'hurt':
      hiss(t, 0.12, 0.45, 1200 * r, 300, 1, out, 'lowpass');
      tone('sawtooth', 180 * r, 80, t, 0.14, 0.18, out);
      break;
    case 'miss':
      hiss(t, 0.16, 0.25, 600, 3000, 2, out);
      break;
    case 'cast':
      tone('sine', 300 * r, 700, t, 0.35, 0.12, out);
      tone('sine', 450 * r, 1050, t + 0.05, 0.3, 0.08, out);
      break;
    case 'magic':
      hiss(t, 0.3, 0.45, 4000, 400, 3, out);
      tone('sine', 900 * r, 200, t, 0.28, 0.2, out);
      break;
    case 'heal':
      [523, 659, 784].forEach((f, i) => tone('sine', f * r, f * r, t + i * 0.07, 0.35, 0.14, out));
      break;
    case 'buff':
      [392, 523, 659, 784].forEach((f, i) => tone('triangle', f, f, t + i * 0.05, 0.25, 0.1, out));
      break;
    case 'levelUp':
      [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, t + i * 0.11, 0.5, 0.18, out));
      tone('sine', 1568, 1568, t + 0.44, 0.7, 0.1, out);
      break;
    case 'death':
      tone('sawtooth', 220, 55, t, 0.6, 0.18, out);
      hiss(t, 0.5, 0.2, 800, 100, 1, out, 'lowpass');
      break;
    case 'coin':
      tone('square', 1300, 1300, t, 0.06, 0.06, out);
      tone('square', 1750, 1750, t + 0.06, 0.12, 0.06, out);
      break;
    case 'pickup':
      tone('triangle', 500, 900, t, 0.12, 0.15, out);
      break;
    case 'click':
      tone('square', 900, 700, t, 0.03, 0.05, out);
      break;
    case 'warn':
      tone('sawtooth', 90, 70, t, 0.5, 0.2, out);
      tone('sine', 180, 140, t, 0.5, 0.15, out);
      break;
    case 'slam':
      tone('sine', 90, 30, t, 0.45, 0.9, out);
      hiss(t, 0.35, 0.6, 900, 80, 0.8, out, 'lowpass');
      break;
    case 'chop': // axe into wood: a dull knock with a woody crack
      tone('triangle', 180 * r, 90, t, 0.12, 0.6, out);
      hiss(t, 0.08, 0.45, 1600 * r, 500, 2, out);
      break;
    case 'mine': // pick on stone: a bright clink
      tone('square', 1900 * r, 1500, t, 0.07, 0.12, out);
      tone('triangle', 3200 * r, 2600, t, 0.12, 0.08, out);
      hiss(t, 0.06, 0.35, 4000, 2000, 1.5, out);
      break;
    case 'rustle': // leaves
      hiss(t, 0.35, 0.25, 2500 * r, 5000, 0.7, out);
      break;
    case 'treeFall': // creak, then the crash
      tone('sawtooth', 70 * r, 45, t, 0.6, 0.15, out);
      hiss(t + 0.55, 0.6, 0.6, 1200, 120, 0.6, out, 'lowpass');
      tone('sine', 70, 30, t + 0.55, 0.5, 0.8, out);
      break;
    case 'splash':
      hiss(t, 0.3, 0.3, 900 * r, 2400, 0.9, out);
      break;
    case 'dash':
      hiss(t, 0.25, 0.35, 400, 2500, 1.5, out);
      break;
    case 'stun':
      tone('sine', 1200, 600, t, 0.15, 0.15, out);
      tone('sine', 1500, 750, t + 0.08, 0.15, 0.1, out);
      break;
    case 'dot':
      hiss(t, 0.06, 0.15, 1500, 800, 2, out);
      break;
  }
}

// ---------------------------------------------------------------- footsteps
const steps = (name: string, n: number) => Array.from({ length: n }, (_, i) => `steps/${name}${i + 1}.ogg`);
/** Footfalls per ground (CC0 recordings, see public/audio/CREDITS.txt): the files, how loud, and their pitch. */
const STEPS: Record<Footing, { files: string[]; gain: number; rate?: number }> = {
  grass: { files: steps('grass', 5), gain: 0.45 },
  leaves: { files: [...steps('leaves', 2), 'steps/grass1.ogg', 'steps/grass3.ogg'], gain: 0.45 },
  dirt: { files: [...steps('dirt', 2), ...steps('soft', 5)], gain: 0.5 },
  stone: { files: steps('stone', 6), gain: 0.4 },
  gravel: { files: ['steps/gravel1.ogg', ...steps('stone', 3)], gain: 0.45, rate: 0.9 },
  sand: { files: steps('soft', 5), gain: 0.4, rate: 0.85 },
  snow: { files: steps('snow', 5), gain: 0.5 },
  mud: { files: steps('mud', 4), gain: 0.5 },
  water: { files: steps('water', 4), gain: 0.22, rate: 1.25 },
};

/** The footfall gallery (?steps=1): swap the recordings a ground uses, to try them by ear. */
export function setStepFiles(on: Footing, files: string[]) {
  STEPS[on].files = files;
  for (const f of files) want(f);
}
/** Load these footstep files now (the gallery's candidates), once the sound is allowed to start. */
export function preloadSteps(files: string[]) {
  if (!audio()) return;
  for (const f of files) want(f);
}
/** How many footfalls were found in each file (grainsOf), or null while it loads; -1 if it would not load. */
export const stepGrains = (files: string[]) => files.map((f) => (failed.has(f) ? -1 : grains.get(f)?.length ?? null));

/** One footfall on `on` (render/scene.ts footingAt). gain: by distance and body size; rate: pitch (big bodies lower). */
export function step(on: Footing, gain = 1, rate = 1) {
  const s = STEPS[on], vol = settings.s.volume * gain * s.gain;
  if (vol <= 0.001) return;
  const c = audio();
  if (!c || c.state !== 'running' || !master) return;
  const out = c.createGain();
  out.gain.value = vol;
  out.connect(master);
  const t = c.currentTime + 0.005, r = rate * (s.rate ?? 1) * (0.95 + Math.random() * 0.1);
  const ready = s.files.filter((f) => decoded.has(f));
  if (ready.length) {
    // one footfall out of one of the files, from its strike (grainsOf)
    const f = ready[Math.floor(Math.random() * ready.length)], buf = decoded.get(f)!, gs = grains.get(f);
    const gr = gs?.length ? gs[Math.floor(Math.random() * gs.length)] : { at: 0, dur: 0.35 };
    const dur = Math.min(gr.dur, on === 'water' ? 0.45 : 0.35) / r;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = r;
    g.gain.setValueAtTime(1, t + Math.max(0, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g).connect(out);
    src.start(t, gr.at, dur * r);
    src.onended = () => out.disconnect();
    return;
  }
  setTimeout(() => out.disconnect(), 1000);
  switch (on) {
    case 'grass':
    case 'leaves':
      hiss(t, 0.08, 0.3, 2400 * r, 1200, 0.8, out);
      if (on === 'leaves') hiss(t + 0.02, 0.1, 0.15, 5000 * r, 3000, 1.5, out);
      break;
    case 'dirt':
    case 'sand':
      tone('triangle', 90 * r, 50, t, 0.06, 0.25, out);
      hiss(t, on === 'sand' ? 0.1 : 0.06, 0.2, 900 * r, 400, 1, out, 'lowpass');
      break;
    case 'stone':
    case 'gravel':
      tone('triangle', 160 * r, 90, t, 0.04, 0.3, out);
      hiss(t, on === 'gravel' ? 0.11 : 0.04, 0.25, 3000 * r, 1800, 1.5, out);
      break;
    case 'snow':
      hiss(t, 0.14, 0.3, 1200 * r, 3000, 1.2, out);
      break;
    case 'mud':
      tone('sine', 120 * r, 60, t, 0.1, 0.3, out);
      hiss(t, 0.12, 0.2, 700 * r, 300, 2, out, 'lowpass');
      break;
    case 'water':
      hiss(t, 0.18, 0.25, 900 * r, 2400, 0.9, out);
      break;
  }
}

// ---------------------------------------------------------------- weather
/**
 * Weather beds: CC0 loops (see public/audio/CREDITS.txt) under the music & ambience volume, like the forest. Light
 * and heavy rain are two recordings crossfaded by how hard it rains. A bed whose file won't load plays filtered noise.
 */
type Bed = { file: string; level: number; gain: GainNode | null; src: AudioScheduledSourceNode | null; target: number; quietSince: number; synth: (c: AudioContext, out: AudioNode) => AudioScheduledSourceNode };
const noiseLoop = (c: AudioContext) => {
  const s = c.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  return s;
};
const bed = (file: string, level: number, synth: Bed['synth']): Bed => ({ file, level, synth, gain: null, src: null, target: 0, quietSince: 0 });
const BEDS: Record<'rainLight' | 'rainHeavy' | 'wind', Bed> = {
  rainLight: bed('weather/rain-light.ogg', 0.5, (c, out) => {
    const s = noiseLoop(c), f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3500;
    f.Q.value = 0.4;
    s.connect(f).connect(out);
    return s;
  }),
  rainHeavy: bed('weather/rain-heavy.ogg', 0.6, (c, out) => {
    const s = noiseLoop(c), f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    s.connect(f).connect(out);
    return s;
  }),
  wind: bed('weather/wind.ogg', 0.5, (c, out) => {
    // low noise whose cutoff drifts slowly: gusts
    const s = noiseLoop(c), f = c.createBiquadFilter(), lfo = c.createOscillator(), depth = c.createGain();
    f.type = 'lowpass';
    f.frequency.value = 450;
    lfo.frequency.value = 0.13;
    depth.gain.value = 250;
    lfo.connect(depth).connect(f.frequency);
    lfo.start();
    s.onended = () => lfo.stop();
    s.connect(f).connect(out);
    return s;
  }),
};
let ambient: GainNode | null = null;
/** thunder-long.ogg is 44 s of rain with one long roll from 21 s, fading by 37 s: only that part plays */
const THUNDER = [{ file: 'weather/thunder1.ogg', at: 0, dur: 6 }, { file: 'weather/thunder-long.ogg', at: 20.6, dur: 16 }];

function startBed(b: Bed, c: AudioContext) {
  const buf = decoded.get(b.file);
  if (!buf && !failed.has(b.file)) return want(b.file); // still loading: quiet until it arrives
  if (!b.gain) {
    b.gain = c.createGain();
    b.gain.gain.value = 0;
    b.gain.connect(ambient!);
  }
  if (buf) {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(b.gain);
    s.start(0, Math.random() * buf.duration); // not every player's shower starts on the same bar
    b.src = s;
  } else (b.src = b.synth(c, b.gain)).start();
}

/**
 * Per frame, where the player stands: rain 0..1 (atmos.ts rainAt), wind 0..1, and harsh 0..1 (snow or ash in the
 * air). The beds ease toward them; the forest's birds fall quiet under them. Raids are indoors: no weather there.
 */
export function setWeather(rain: number, wind: number, harsh: number) {
  const duck = (1 - rain * 0.7) * (1 - harsh * 0.8);
  if (Math.abs(duck - forestDuck) > 0.02) {
    forestDuck = duck;
    FOREST.el.volume = settings.s.music * FOREST.gain * duck;
  }
  const c = ctx;
  if (!c || c.state !== 'running' || !master) return;
  if (!ambient) (ambient = c.createGain()).connect(master);
  // the music & ambience volume, not the effects one (master carries no volume of its own)
  ambient.gain.value = settings.s.music;
  const on = inDungeon ? 0 : 1, now = performance.now();
  const heavy = Math.min(1, Math.max(0, (rain - 0.4) / 0.5));
  const levels = { rainLight: on * Math.min(1, rain * 2.5) * (1 - heavy * 0.6), rainHeavy: on * heavy, wind: on * wind };
  for (const [k, b] of Object.entries(BEDS) as [keyof typeof BEDS, Bed][]) {
    const target = levels[k] * b.level;
    if (target > 0.001) {
      b.quietSince = 0;
      if (!b.src) startBed(b, c);
    } else if (!b.quietSince) b.quietSince = now;
    else if (b.src && now - b.quietSince > 15000) {
      // silent for a while: stop playing a loop nobody hears
      b.src.stop();
      b.src = null;
    }
    if (b.gain && Math.abs(target - b.target) > 0.004) {
      b.target = target;
      b.gain.gain.setTargetAtTime(target, c.currentTime, 0.6);
    }
  }
  if (rain > 0.4) for (const s of THUNDER) want(s.file); // a storm may be coming: have the thunder ready
}

/** Thunder from a strike `dist` metres away: late by the sound's travel, quieter and duller the farther it fell. */
export function thunder(dist: number) {
  const vol = settings.s.volume * Math.max(0.12, 1 - dist / 700);
  if (vol <= 0.001) return;
  const c = audio();
  if (!c || c.state !== 'running' || !master) return;
  const t = c.currentTime + Math.min(6, dist / 343);
  const lp = c.createBiquadFilter(), out = c.createGain();
  lp.type = 'lowpass';
  lp.frequency.value = 500 + 7000 * Math.max(0, 1 - dist / 500);
  out.gain.value = vol;
  lp.connect(out).connect(master);
  const ready = THUNDER.filter((s) => decoded.has(s.file));
  if (ready.length) {
    const s = ready[Math.floor(Math.random() * ready.length)], buf = decoded.get(s.file)!;
    const at = Math.min(s.at, Math.max(0, buf.duration - 1)), dur = Math.min(s.dur, buf.duration - at);
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    g.gain.setValueAtTime(1, t + Math.max(0, dur - 1.5));
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g).connect(lp);
    src.start(t, at, dur);
    src.onended = () => out.disconnect();
    return;
  }
  for (const s of THUNDER) want(s.file);
  // synth: a crack when it is close, then a long low rumble
  if (dist < 200) hiss(t, 0.25, 0.6, 3000, 600, 0.7, lp);
  const s = noiseLoop(c), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'lowpass';
  f.frequency.value = 220;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
  s.connect(f).connect(g).connect(lp);
  s.start(t);
  s.stop(t + 3.6);
  s.onended = () => out.disconnect();
}
