import * as THREE from 'three';
import { SKILLS } from '../../../shared/src/data/skills';
import { PRESETS, settings } from '../settings';
import { LocalLights } from './atmos';
import { FxManager } from './fx';
import { animate, mobModel, playerModel, type Rig } from './models';
import { tickEnchantFx } from './enchant-fx';
import { HERO_LOOK, HERO_LOOKS, heroAura, type HeroLook } from './hero-fx';
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
 * ?hero=1: the Olympiad Hero's aura (render/hero-fx.ts), its looks side by side on knights in the Infernal set, or one
 * alone (?hero=<look>); buttons swap the look, turn the glints' streaks on and off (?notrail: off to begin with), light
 * the weapons to +16 to compare, and turn the camera round them.
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
  const heroMode = p.has('hero');
  let zoom = Number(p.get('zoom')) || (heroMode ? 1.9 : 1), ry = Number(p.get('ry')) || (heroMode ? 0.25 : 0.35);
  const look = Number(p.get('look')) || (heroMode ? 1.15 : 1.4), elev = Number(p.get('elev')) || (heroMode ? 0.3 : 0.42);
  const aim = () => {
    const d = 15 / zoom / Math.min(1, cam.aspect / 1.4);
    cam.position.set(Math.sin(ry) * d, d * elev, Math.cos(ry) * d);
    cam.position.y += look - 1.4;
    cam.lookAt(0, look, 0);
  };
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    aim();
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
  // ?hero: knights in the Infernal set wearing the Hero's aura, each look side by side (or one alone)
  const heroes: { look: HeroLook; e: Ent; label: HTMLDivElement }[] = [];
  let heroWeapon = 0, orbit = false, heroTrail = !p.has('notrail'), solo: HeroLook | null = (HERO_LOOKS as string[]).includes(p.get('hero') ?? '') ? (p.get('hero') as HeroLook) : null;
  const heroKnight = () => playerModel('human', 'fighter', 'infernal_blade', 'infernal_plate', { g: 'm', hs: 0, hc: 0 },
    ['infernal_helm', 'infernal_gauntlets', 'infernal_greaves', 'infernal_boots', null, 'infernal_cape'], heroWeapon);
  // the one a Hero wears until it chooses is marked
  const LOOK_NAME = Object.fromEntries(HERO_LOOKS.map((lk) => [lk, ({ halo: 'Halo', spiral: 'Espiral' } as const)[lk] + (lk === HERO_LOOK ? ' (por defecto)' : '')])) as Record<HeroLook, string>;
  const placeHeroes = () => {
    for (const h of heroes) { scene.remove(h.e.rig.root); h.label.remove(); }
    heroes.length = 0;
    const shown = solo ? [solo] : HERO_LOOKS;
    shown.forEach((lk, i) => {
      const rig = heroKnight();
      rig.root.add(heroAura(rig.height, lk, heroTrail));
      const e = ent(rig, (i - (shown.length - 1) / 2) * 2.4, 0);
      const label = document.createElement('div');
      label.textContent = LOOK_NAME[lk];
      label.style.cssText = 'position:fixed;transform:translate(-50%,-100%);color:#ffd45a;font:bold 13px Georgia,serif;text-shadow:0 0 6px #000,0 0 3px #000;pointer-events:none;z-index:5';
      host.appendChild(label);
      heroes.push({ look: lk, e, label });
    });
    zoom = Number(p.get('zoom')) || (solo ? 3.2 : 1.9);
    aim();
  };
  if (heroMode) {
    s.rig.root.visible = false;
    t.rig.root.visible = false;
    placeHeroes();
    // the Infernal set's models load the first time it is worn (quaternius.ts): dressed again once they are in
    addEventListener('gear-loaded', placeHeroes);
  }
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
  if (heroMode) {
    btn('Todas', 'Las tres lado a lado', () => ((solo = null), placeHeroes()), '#3a3016');
    for (const lk of HERO_LOOKS) btn(LOOK_NAME[lk], `Solo esta (?hero=${lk})`, () => ((solo = lk), placeHeroes()), '#3a3016');
    btn('Estela', 'Prende o apaga la estela de luz de las chispas (?notrail la empieza apagada)', () => ((heroTrail = !heroTrail), placeHeroes()), '#3a3016');
    btn('Armas +16', 'Prende o apaga el brillo de las armas, para comparar', () => ((heroWeapon = heroWeapon ? 0 : 16), placeHeroes()), '#16202e');
    btn('Girar', 'La cámara da vueltas alrededor', () => (orbit = !orbit), '#16202e');
  } else {
    for (const id of Object.keys(GENERIC_VFX)) btn(id, id, () => fire(id), '#3a2a20');
    for (const def of Object.values(SKILLS)) btn(`${def.icon} ${def.name}`, def.id, () => fire(def.id));
  }

  let last = performance.now();
  const v = new THREE.Vector3();
  const frame = (now: number) => {
    tickEnchantFx(now / 1000, renderer.domElement.height);
    for (const e of [s, t, ...heroes.map((h) => h.e)])
      animate(e.rig, { moving: false, casting: now < e.castUntil, atkAge: now - e.atkAt, deadAge: -1, t: now / 1000 });
    if (orbit) {
      ry += (now - last) / 1000 * 0.35;
      aim();
    }
    last = now;
    // each look's name over its knight's head
    for (const h of heroes) {
      v.set(h.e.pos.x, h.e.height + 0.45, h.e.pos.z).project(cam);
      h.label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      h.label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      h.label.style.display = v.z < 1 ? '' : 'none'; // behind the camera as it turns
    }
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
    removeEventListener('gear-loaded', placeHeroes);
    renderer.setAnimationLoop(null);
    fx.p.dispose();
    renderer.dispose();
    host.innerHTML = '';
  };
}
