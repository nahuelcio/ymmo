// Benchmark: stages a crowd around the player, measures the real frame rate tier by tier from the
// heaviest settings down, and recommends the heaviest tier this machine holds. Nothing is kept
// unless the player presses Apply.
import * as THREE from 'three';
import type { Game } from './game';
import { LOOKS, PRESETS, settings, type Settings } from './settings';
import { animate, mobModel, type Rig } from './render/models';
import { heightAt } from '../../shared/src/terrain';
import { el } from './ui/dom';
import { t as tx } from './lang';

interface Tier { name: string; patch: Partial<Settings> }
const TIERS: Tier[] = [
  { name: 'Ultra', patch: { preset: 'ultra', ...PRESETS.ultra, fancyWater: true, godRays: true, localLights: true, particles: true, softShadows: true, wind: true, shadowRange: 140 } },
  { name: tx('Alto', 'High'), patch: { preset: 'high', ...PRESETS.high, fancyWater: true, godRays: true, localLights: true, particles: true, softShadows: true, wind: true, shadowRange: 90 } },
  { name: tx('Medio', 'Medium'), patch: { preset: 'medium', ...PRESETS.medium, fancyWater: true, godRays: false, localLights: false, particles: true, softShadows: false, wind: true, shadowRange: 60 } },
  { name: tx('Bajo', 'Low'), patch: { preset: 'low', ...PRESETS.low, look: 'off', ...LOOKS.off.v, fancyWater: false, godRays: false, localLights: false, particles: false, softShadows: false, wind: false, shadowRange: 60 } },
];
/** A tier holds when it averages this many frames per second and its worst 5% stays above the floor. */
const TARGET_FPS = 55, FLOOR_FPS = 40;
/** Atmosphere effects, cheapest first, that the second pass tries to switch on one at a time. */
const EFFECTS: [keyof Settings, string][] = [
  ['wind', tx('Viento', 'Wind')], ['particles', tx('Partículas', 'Particles')], ['fancyWater', tx('Agua con reflejos', 'Reflective water')],
  ['softShadows', tx('Sombras suaves', 'Soft shadows')], ['localLights', tx('Luces locales', 'Local lights')], ['godRays', tx('Rayos de luz', 'Light shafts')],
];
const CROWD = ['wolf', 'goblin_scout', 'orc_warrior', 'skeleton', 'keltir', 'stone_golem'];
const CROWD_SIZE = 48;

let running = false;

export async function runBenchmark(g: Game) {
  const self = g.self;
  if (running || !self) return;
  running = true;
  const before = { ...settings.s };

  // the crowd: a busy fight's worth of animated monsters ringed around the player
  const rigs: Rig[] = [];
  const crowd = new THREE.Group();
  for (let i = 0; i < CROWD_SIZE; i++) {
    const rig = mobModel(CROWD[i % CROWD.length]);
    const a = i * 2.4, r = 5 + (i % 8) * 2.2;
    const x = self.pos.x + Math.cos(a) * r, z = self.pos.z + Math.sin(a) * r;
    rig.root.position.set(x, heightAt(x, z), z);
    rig.root.rotation.y = a;
    crowd.add(rig.root);
    rigs.push(rig);
  }
  g.world.scene.add(crowd);

  const box = el('div', 'dialog bench', document.getElementById('ui'));
  const title = el('b', '', box, tx('Midiendo el rendimiento…', 'Measuring performance…'));
  const note = el('div', 'tt-dim', box, tx('No toques nada unos segundos.', 'Hands off for a few seconds.'));

  /** Run for `ms` and return every frame's duration. */
  const sample = (ms: number) =>
    new Promise<number[]>((done) => {
      const log: number[] = [], t0 = performance.now();
      g.benchHook = (frameMs, t) => {
        rigs.forEach((rig, i) => animate(rig, { moving: true, atkAge: Infinity, casting: false, deadAge: -1, t: t + i }));
        if (performance.now() - t0 < ms) return void log.push(frameMs);
        g.benchHook = null;
        done(log);
      };
    });

  /** Apply a patch, let it settle, then measure: average and worst-5% frames per second. */
  const measure = async (patch: Partial<Settings>, ms: number) => {
    settings.set({ ...patch, fpsCap: 0 });
    await sample(1200); // warm-up: shaders recompile and shadow maps reallocate on a settings change
    const log = (await sample(ms)).sort((a, b) => a - b);
    const steady = log.slice(0, Math.max(1, Math.floor(log.length * 0.98))); // a stray hitch isn't the frame rate
    const avg = 1000 / (steady.reduce((s, v) => s + v, 0) / steady.length);
    const low = 1000 / (log[Math.floor(log.length * 0.95)] ?? 1000);
    return { avg, low, ok: avg >= TARGET_FPS && low >= FLOOR_FPS };
  };

  // first pass: quality tiers, each with the atmosphere effects that belong to it
  const results: { tier: Tier; avg: number; low: number; ok: boolean }[] = [];
  for (const [i, tier] of TIERS.entries()) {
    note.textContent = `${tier.name} (${i + 1}/${TIERS.length})`;
    const m = await measure(tier.patch, 2200);
    results.push({ tier, ...m });
    if (m.ok) break; // the heaviest tier that holds is the answer: lighter ones only run faster
  }
  // second pass: on top of that tier, try each atmosphere effect it leaves off and keep the ones that still hold
  let patch = { ...results[results.length - 1].tier.patch };
  const extras: { label: string; on: boolean; avg: number }[] = [];
  if (results[results.length - 1].ok)
    for (const [key, label] of EFFECTS) {
      if (patch[key]) continue;
      note.textContent = `${tx('Ambiente', 'Atmosphere')}: ${label}`;
      const m = await measure({ ...patch, [key]: true }, 1500);
      if (m.ok) patch = { ...patch, [key]: true };
      extras.push({ label, on: m.ok, avg: m.avg });
    }

  g.world.scene.remove(crowd);
  crowd.traverse((o) => o instanceof THREE.Mesh && o.userData.baked && o.geometry.dispose());
  settings.set(before);
  running = false;

  const pick = results[results.length - 1];
  title.textContent = pick.ok
    ? tx(`Recomendado para esta PC: ${pick.tier.name}`, `Recommended for this PC: ${pick.tier.name}`)
    : tx(`Ni en ${pick.tier.name} llega a ${TARGET_FPS} FPS; es lo más liviano que hay.`, `Even ${pick.tier.name} misses ${TARGET_FPS} FPS; it is the lightest there is.`);
  note.textContent = tx(`Con ${CROWD_SIZE} monstruos animados en pantalla. Promedio / peor 5% de los cuadros:`, `With ${CROWD_SIZE} animated monsters on screen. Average / worst 5% of frames:`);
  const table = el('div', 'bench-rows', box);
  for (const r of results) {
    const row = el('div', `bench-row${r === pick ? ' pick' : ''}`, table);
    el('span', '', row, r.tier.name);
    el('span', r.ok ? 'tt-up' : 'tt-down', row, `${Math.round(r.avg)} / ${Math.round(r.low)} FPS`);
  }
  for (const x of extras) {
    const row = el('div', 'bench-row', table);
    el('span', '', row, `+ ${x.label}`);
    el('span', x.on ? 'tt-up' : 'tt-down', row, `${x.on ? tx('sí', 'yes') : tx('no', 'no')} · ${Math.round(x.avg)} FPS`);
  }
  const btns = el('div', 'dialog-btns', box);
  el('button', 'btn primary', btns, tx(`Aplicar ${pick.tier.name}`, `Apply ${pick.tier.name}`)).onclick = () => {
    settings.set(patch);
    box.remove();
  };
  el('button', 'btn', btns, tx('Dejar como estaba', 'Keep what I had')).onclick = () => box.remove();
}
