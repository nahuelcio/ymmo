// Procedural sound effects (Web Audio, no asset files). Each effect is a tiny
// recipe of oscillators / filtered noise with short envelopes.
import { settings } from './settings';
import { RAIDS } from '../../shared/src/data/raids';

export type Sfx =
  | 'hit' | 'crit' | 'miss' | 'hurt' | 'cast' | 'magic' | 'heal' | 'buff' | 'levelUp' | 'death'
  | 'coin' | 'pickup' | 'click' | 'warn' | 'slam' | 'dash' | 'stun' | 'dot';

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

function preloadSamples(c: AudioContext) {
  const files = new Set(Object.values(SAMPLES).flatMap((l) => l ?? []));
  for (const f of files) {
    fetch(`/audio/${f}`)
      .then((r) => r.arrayBuffer())
      .then((b) => c.decodeAudioData(b))
      .then((buf) => decoded.set(f, buf))
      .catch(() => {}); // no sample: the synth recipe still plays
  }
}

// browsers only allow audio after a user gesture
addEventListener('pointerdown', () => (void audio()?.resume(), syncLoops()), { capture: true });
addEventListener('keydown', () => (void audio()?.resume(), syncLoops()), { capture: true });

// Background loops (CC0 files, see public/audio/CREDITS.txt), streamed so they never hold up loading.
// ponytail: <audio loop> leaves a small gap at the seam (worst on the mp3) and cuts hard between
// worlds; decode into AudioBuffers and crossfade through gain nodes if that gets noticeable.
function loop(file: string, gain: number, dungeon: boolean) {
  const el = new Audio(`/audio/${file}`);
  el.loop = true;
  el.preload = 'none';
  return { el, gain, dungeon };
}
const LOOPS = [loop('exploration.ogg', 0.6, false), loop('forest.mp3', 0.5, false), loop('dungeon.ogg', 0.9, true)];
let inDungeon = false;

function syncLoops() {
  for (const l of LOOPS) {
    l.el.volume = settings.s.music * l.gain;
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
    return;
  }
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
