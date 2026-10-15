import * as THREE from 'three';
import { SKILLS } from '../../../shared/src/data/skills';
import { PRESETS, settings } from '../settings';
import { LocalLights } from './atmos';
import { FxManager } from './fx';
import { animate, mobModel, playerModel, type Rig } from './models';
import { tickEnchantFx } from './enchant-fx';
import { loadMobs } from './mobs';
import { PostFX } from './post';
import { loadQ } from './quaternius';
import { GENERIC_VFX, SKILL_VFX } from './skill-fx';

/**
 * Dev gallery (?fx=1): a caster and an orc, one button per skill effect (and the generic ones), day or night,
 * with the game's bloom and tone mapping. No server needed.
 * ?skill=<id> fires it on load (and every ?every ms), ?night, ?ry=<radians> turn the view, ?zoom, ?nobar for screenshots.
 * In the console: fxFire(id), fxBench(id, n) = CPU ms per frame with n copies of an effect alive.
 * ?preset=<name> applies a graphics preset first (e.g. ultra, for ambient occlusion).
 * ?enchant=N (1-16): a fighter alone holding a weapon at +N (?weapon=<item id>, default broadsword), for the enchantment
 * glow (render/enchant-fx.ts); setEnchant(n) in the console swaps the level. ?look=<height> aims the camera (default 1.4), ?elev=<k> raises it (default 0.42; ~1.2 looks down like the game).
 */
export async function mountFxGallery(host: HTMLElement): Promise<() => void> {
  host.innerHTML = '';
  const p = new URLSearchParams(location.search);
  // ?preset=low|medium|high|ultra|cine: that graphics preset (AO, shadows...) for this visit, as the settings window applies it
  const preset = p.get('preset') as keyof typeof PRESETS | null;
  if (preset && PRESETS[preset]) settings.set({ preset, ...PRESETS[preset] });
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;z-index:10;display:flex;gap:4px;flex-wrap:wrap;font:11px sans-serif';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = settings.s.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = settings.s.exposure;
  renderer.domElement.style.cssText = 'position:fixed;inset:0';
  host.append(renderer.domElement, bar);
  if (p.has('nobar')) bar.style.display = 'none';

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a35, 2);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sun.position.set(4, 8, 5);
  scene.add(hemi, sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshLambertMaterial({ color: 0x55663a }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  let night = p.has('night');
  const lighting = () => {
    scene.background = new THREE.Color(night ? 0x0a1020 : 0x9ec4e8);
    hemi.intensity = night ? 0.35 : 2;
    sun.intensity = night ? 0.15 : 2.2;
    fx?.p.setShade(night ? 0.25 : 1);
  };
  let fx: FxManager | null = null;
  lighting();

  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const post = new PostFX(renderer, scene, cam);
  const zoom = Number(p.get('zoom')) || 1, ry = Number(p.get('ry')) || 0.35, look = Number(p.get('look')) || 1.4, elev = Number(p.get('elev')) || 0.42;
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    const d = 15 / zoom / Math.min(1, cam.aspect / 1.4);
    cam.position.set(Math.sin(ry) * d, d * elev, Math.cos(ry) * d);
    cam.position.y += look - 1.4;
    cam.lookAt(0, look, 0);
    cam.updateProjectionMatrix();
    post.resize();
  };
  post.rebuild(settings.s);
  resize();
  addEventListener('resize', resize);
  await Promise.all([loadQ().catch(() => {}), loadMobs().catch(() => {})]);

  type Ent = { pos: THREE.Vector3; height: number; rig: Rig; atkAt: number; castUntil: number };
  const ent = (rig: Rig, x: number, face: number): Ent => {
    rig.root.position.set(x, 0, 0);
    rig.root.rotation.y = face;
    scene.add(rig.root);
    return { pos: rig.root.position, height: rig.height, rig, atkAt: -1e9, castUntil: 0 };
  };
  const enchant = p.has('enchant') ? Number(p.get('enchant')) || 0 : -1;
  const knight = (lvl: number) => playerModel('human', 'fighter', p.get('weapon') || 'broadsword', 'full_plate_armor', { g: 'm', hs: 0, hc: 0 }, [], lvl);
  const s = enchant >= 0 ? ent(knight(enchant), 0, 0.5) : ent(playerModel('human', 'mystic', 'sages_staff', 'karmian_tunic', { g: 'f', hs: 1, hc: 0 }), -3.5, Math.PI / 2);
  const t = ent(mobModel('orc_warrior'), 3.5, -Math.PI / 2);
  if (enchant >= 0) t.rig.root.visible = false;
  (window as unknown as { setEnchant: (n: number) => void }).setEnchant = (n: number) => {
    scene.remove(s.rig.root);
    const rig = knight(n);
    rig.root.position.copy(s.rig.root.position);
    rig.root.rotation.copy(s.rig.root.rotation);
    scene.add(rig.root);
    s.rig = rig;
    s.pos = rig.root.position;
  };

  fx = new FxManager(scene);
  lighting();
  const lights = new LocalLights(scene, []);
  fx.onLight = (at, color, power, range, ms) => lights.flash(at, color, power, range, ms);
  const fire = (id: string) => {
    const now = performance.now();
    const def = SKILLS[id];
    if (def) {
      const vfx = SKILL_VFX[id];
      const self = def.target === 'self' || def.target === 'friend';
      if (def.kind === 'phys' || def.kind === 'taunt') s.atkAt = now;
      else s.castUntil = now + 500;
      vfx?.({ f: fx, s, t: self ? s : t, color: def.color, aoe: def.aoe ?? 6 });
    } else GENERIC_VFX[id]?.({ f: fx, s, t, color: 0xffffff, aoe: 6 });
  };
  const w = window as unknown as { fxFire: (id: string) => void; fxBench: (id: string, n: number) => number };
  w.fxFire = fire;
  (window as unknown as { fxMgr: FxManager }).fxMgr = fx; // for poking at from the console

  const btn = (label: string, title: string, fn: () => void, bg = '#16202e') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = `padding:4px 7px;border-radius:6px;border:1px solid #445;background:${bg};color:#dfe9f5;cursor:pointer`;
    b.onclick = fn;
    bar.appendChild(b);
  };
  btn(night ? 'Día' : 'Noche', '', function (this: void) {
    night = !night;
    lighting();
  }, '#2a3a20');
  for (const id of Object.keys(GENERIC_VFX)) btn(id, id, () => fire(id), '#3a2a20');
  for (const def of Object.values(SKILLS)) btn(`${def.icon} ${def.name}`, def.id, () => fire(def.id));

  const frame = (now: number) => {
    tickEnchantFx(now / 1000, renderer.domElement.height);
    for (const e of [s, t])
      animate(e.rig, { moving: false, casting: now < e.castUntil, atkAge: now - e.atkAt, deadAge: -1, t: now / 1000 });
    fx.update();
    lights.update(cam.position, now / 1000);
    post.render();
  };
  /** CPU ms per frame (effect update + draw submission) with n copies of `id` alive */
  w.fxBench = (id: string, n: number) => {
    for (let i = 0; i < n; i++) fire(id);
    const t0 = performance.now();
    let frames = 0;
    while (performance.now() - t0 < 400) frame(performance.now()), frames++;
    return (performance.now() - t0) / frames;
  };
  renderer.setAnimationLoop(frame);
  const auto = p.get('skill');
  let timer = 0;
  if (auto) {
    setTimeout(() => fire(auto), 600);
    if (p.get('every')) timer = window.setInterval(() => fire(auto), Number(p.get('every')));
  }
  return () => {
    clearInterval(timer);
    removeEventListener('resize', resize);
    renderer.setAnimationLoop(null);
    fx.p.dispose();
    renderer.dispose();
    host.innerHTML = '';
  };
}
