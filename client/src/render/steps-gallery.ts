import * as THREE from 'three';
import { preloadSteps, setStepFiles, step, stepFiles, stepGrains } from '../audio';
import { animate, playerModel } from './models';
import { loadQ } from './quaternius';
import type { Footing } from './scene';

const GROUNDS: Footing[] = ['grass', 'leaves', 'dirt', 'stone', 'gravel', 'sand', 'snow', 'mud', 'water'];
/**
 * The recordings to choose from for each ground: what plays now first. To try others, add them here as further
 * options (put the files in client/public/audio/steps-try, which stays out of the repo).
 */
const OPTIONS = Object.fromEntries(GROUNDS.map((k) => [k, [['en uso', stepFiles(k)]]])) as Record<Footing, [string, string[]][]>;
const NAMES: Record<Footing, string> = { grass: 'pasto', leaves: 'hojas (bosque)', dirt: 'tierra / camino / pueblo', stone: 'piedra', gravel: 'grava (volcán)', sand: 'arena', snow: 'nieve', mud: 'barro', water: 'agua baja' };

/**
 * Dev gallery (?steps=1): a character jogging on the spot, its footsteps sounding as its feet land (the game's own
 * footfalls), and for each ground the recordings to choose from. Pick one per ground by ear; the line at the bottom
 * sums up the choice. No server needed.
 */
export async function mountStepsGallery(host: HTMLElement): Promise<() => void> {
  host.innerHTML = '';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x1a2230);
  renderer.domElement.style.cssText = 'position:fixed;inset:0';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 2));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    // the character stands left of the middle, clear of the panel on the right
    cam.position.set(1.6, 1.2, 5.5);
    cam.lookAt(1.6, 0.9, 0);
    cam.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  await loadQ().catch(() => {});
  const rig = playerModel('human', 'fighter', null, null, { g: 'm', hs: 0, hc: 0 }, []);
  rig.root.rotation.y = Math.PI / 2; // side on, so the feet show
  scene.add(rig.root);

  // the choice: one option per ground, and the ground being walked on
  const pick = Object.fromEntries(Object.keys(OPTIONS).map((k) => [k, 0])) as Record<Footing, number>;
  let on: Footing = 'dirt', walking = true, fell = 0;
  for (const k of Object.keys(OPTIONS) as Footing[]) setStepFiles(k, OPTIONS[k][0][1]);
  // every candidate loads on the first click (the browser allows no sound before one)
  const all = [...new Set(Object.values(OPTIONS).flatMap((o) => o.flatMap(([, f]) => f)))];
  addEventListener('pointerdown', () => preloadSteps(all), { once: true });

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:8px;right:8px;bottom:8px;width:min(560px,60vw);overflow:auto;z-index:10;font:12px sans-serif;color:#e8e2d0;background:rgba(10,14,20,.85);padding:10px;border-radius:6px';
  host.appendChild(panel);
  const head = document.createElement('div');
  head.innerHTML = '<b>Pasos</b>: elegí una opción por suelo (el personaje camina sobre el suelo marcado con ●). Hacé clic en cualquier lado primero: el navegador no deja sonar nada antes.';
  panel.appendChild(head);
  const toggle = document.createElement('button');
  toggle.textContent = '⏸ parar';
  toggle.style.margin = '6px 0';
  toggle.onclick = () => {
    walking = !walking;
    toggle.textContent = walking ? '⏸ parar' : '▶ caminar';
  };
  panel.appendChild(toggle);
  const summary = document.createElement('pre');
  summary.style.cssText = 'white-space:pre-wrap;background:#0006;padding:6px;margin-top:8px';
  const counts: { k: Footing; i: number; el: HTMLSpanElement }[] = [];
  const rows: Record<string, HTMLDivElement> = {};
  const refresh = () => {
    for (const [k, row] of Object.entries(rows)) row.style.outline = k === on ? '1px solid #e8c060' : 'none';
    for (const c of counts) {
      const g = stepGrains(OPTIONS[c.k][c.i][1]);
      c.el.textContent = g.some((n) => n === null) ? ' (cargando)' : g.some((n) => n === -1) ? ' (no carga)' : ` (${g.reduce<number>((a, n) => a + (n ?? 0), 0)} pasos)`;
    }
    summary.textContent = 'Elegido:\n' + (Object.keys(OPTIONS) as Footing[]).map((k) => `${NAMES[k]}: ${String.fromCharCode(65 + pick[k])} — ${OPTIONS[k][pick[k]][0]}`).join('\n');
  };
  for (const k of Object.keys(OPTIONS) as Footing[]) {
    const row = (rows[k] = document.createElement('div'));
    row.style.cssText = 'margin:6px 0;padding:4px;border-radius:4px';
    const title = document.createElement('div');
    const go = document.createElement('button');
    go.textContent = '● caminar acá';
    go.onclick = () => {
      on = k;
      refresh();
    };
    title.append(Object.assign(document.createElement('b'), { textContent: `${NAMES[k]} ` }), go);
    row.appendChild(title);
    OPTIONS[k].forEach(([label, files], i) => {
      const line = document.createElement('label');
      line.style.cssText = 'display:block;margin-left:10px;cursor:pointer';
      const radio = Object.assign(document.createElement('input'), { type: 'radio', name: k, checked: i === 0 });
      radio.onchange = () => {
        pick[k] = i;
        on = k;
        setStepFiles(k, files);
        refresh();
      };
      const one = document.createElement('button');
      one.textContent = '▶ uno';
      one.style.marginLeft = '6px';
      one.onclick = (e) => {
        e.preventDefault();
        setStepFiles(k, files);
        step(k);
        setStepFiles(k, OPTIONS[k][pick[k]][1]);
      };
      const cnt = document.createElement('span');
      cnt.style.opacity = '0.7';
      counts.push({ k, i, el: cnt });
      line.append(radio, ` ${String.fromCharCode(65 + i)}: ${label}`, cnt, one);
      row.appendChild(line);
    });
    panel.appendChild(row);
  }
  panel.appendChild(summary);
  refresh();
  const tick = setInterval(refresh, 1000);

  const t0 = performance.now();
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    const landed = animate(rig, { moving: walking, atkAge: Infinity, casting: false, deadAge: -1, t });
    if (landed) {
      fell += landed;
      step(on);
    }
    renderer.render(scene, cam);
  };
  renderer.setAnimationLoop(frame);
  (globalThis as { stepsFell?: () => number }).stepsFell = () => fell;
  return () => {
    clearInterval(tick);
    renderer.setAnimationLoop(null);
    removeEventListener('resize', resize);
    renderer.dispose();
  };
}
