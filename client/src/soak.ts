// Soak benchmark (dev builds only): plays on its own for a while — wandering, fighting whatever is near —
// and samples memory and frame cost every few seconds, so leaks show up as a slope instead of a feeling.
//
//   await soak({ minutes: 10 })        // in the browser console, once in the world
//
// Each sample: JS heap (Chromium only), GPU objects three.js holds (geometries, textures, shader programs),
// DOM nodes, scene objects, entities, JS time per frame and the frame rate (median and 95th percentile).
import * as THREE from 'three';
import type { Game } from './game';

export interface SoakSample {
  t: number; heapMB: number; geometries: number; textures: number; programs: number;
  dom: number; sceneObjs: number; ents: number; cpuMs: number; fps: number; p95ms: number;
  /** share of the main thread the game's frames take (JS time per frame x frames per second) */
  busyPct: number;
}

export async function soak(g: Game, { minutes = 5, every = 15, radius = 45 } = {}): Promise<SoakSample[]> {
  const samples: SoakSample[] = [];
  const self = g.self;
  if (!self) throw new Error('enter the world first');
  const home = self.pos.clone();
  // the game's own frames (only those it renders, after its fps cap), not every animation-frame tick
  const frames: number[] = [];
  g.benchHook = (ms) => frames.push(ms);

  // gameplay: fight anything in reach, otherwise walk somewhere new around the start
  const play = setInterval(() => {
    const me = g.self;
    if (!me) return;
    if (g.me.hp <= 0) return g.net.send({ t: 'respawn' });
    let mob = false;
    for (const c of g.ents.values()) if (c.rec.k === 'm' && c.pos.distanceTo(me.pos) < 20 && c.hp > 0) mob = true;
    if (mob && Math.random() < 0.7) g.attackTarget();
    else {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      g.moveTo(new THREE.Vector3(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r), true);
    }
  }, 2500);

  const t0 = performance.now();
  const sample = () => {
    (window as unknown as { gc?: () => void }).gc?.(); // runner starts Chrome with --expose-gc: measure what is retained
    const r = g.renderer.info, mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let sceneObjs = 0;
    g.world.scene.traverse(() => sceneObjs++);
    const f = frames.splice(0).sort((a, b) => a - b);
    const med = f[f.length >> 1] ?? 0;
    const s: SoakSample = {
      t: Math.round((performance.now() - t0) / 1000),
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : -1,
      geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? -1,
      dom: document.getElementsByTagName('*').length, sceneObjs, ents: g.ents.size,
      cpuMs: +(g as unknown as { cpuMs: number }).cpuMs.toFixed(2),
      fps: med ? Math.round(1000 / med) : 0, p95ms: +(f[Math.floor(f.length * 0.95)] ?? 0).toFixed(1), busyPct: 0,
    };
    s.busyPct = Math.round((s.cpuMs * s.fps) / 10);
    samples.push(s);
    console.log('[soak]', JSON.stringify(s));
  };
  sample();
  await new Promise<void>((done) => {
    const timer = setInterval(() => {
      sample();
      if (performance.now() - t0 >= minutes * 60000) {
        clearInterval(timer);
        done();
      }
    }, every * 1000);
  });
  g.benchHook = null;
  clearInterval(play);
  (window as unknown as { soakResult: SoakSample[] }).soakResult = samples;
  const a = samples[0], b = samples[samples.length - 1];
  console.log(`[soak] ${minutes} min: heap ${a.heapMB} -> ${b.heapMB} MB, geometries ${a.geometries} -> ${b.geometries}, ` +
    `textures ${a.textures} -> ${b.textures}, programs ${a.programs} -> ${b.programs}, DOM ${a.dom} -> ${b.dom}, scene ${a.sceneObjs} -> ${b.sceneObjs}`);
  return samples;
}
