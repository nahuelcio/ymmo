import * as THREE from 'three';
import { heightAt, TOWN } from '../../../shared/src/terrain';
import { FORTS } from '../../../shared/src/village';
import { settings } from '../settings';
import { ATMOS, LocalLights, Motes } from './atmos';
import { FxManager } from './fx';
import { loadNature } from './nature';
import { PostFX } from './post';
import { BRAZIER_FIRES, createWorldScene, lightSources } from './scene';
import { loadV } from './village';

/**
 * Dev view (?town=alba, or a fort: dusk, frost...): the real world scene around a town, with an orbiting camera.
 * No server needed. ?hour=0..24 fixes the time of day (21 = night), ?ry=<radians> stops the orbit there,
 * ?dist and ?pitch (radians) frame it, ?at=x,z looks at another point (any spot of the world), ?ty=<height> raises it (the sky).
 */
export async function mountTownGallery(host: HTMLElement): Promise<() => void> {
  host.innerHTML = '';
  const p = new URLSearchParams(location.search);
  const town = p.get('town') === 'alba' ? TOWN : (FORTS.find((f) => f.id === p.get('town')) ?? FORTS[0]).town;
  const hour = p.get('hour');
  // sunPhase() reads this hook: 06:00 is sunrise (0), 18:00 sunset (π)
  if (hour !== null) (globalThis as { __sunPhase?: number }).__sunPhase = ((((Number(hour) - 6 + 24) % 24) / 24) * Math.PI * 2);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = settings.s.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = settings.s.exposure;
  renderer.domElement.style.cssText = 'position:fixed;inset:0';
  host.append(renderer.domElement);
  await Promise.all([loadV().catch(() => {}), loadNature().catch(() => {})]);

  const cam = new THREE.PerspectiveCamera(55, 1, 0.3, 700);
  const world = createWorldScene({ maxAnisotropy: renderer.capabilities.getMaxAnisotropy(), renderer });
  const post = new PostFX(renderer, world.scene, cam);
  post.sun = world.sun;
  post.rebuild(settings.s);
  const lights = new LocalLights(world.scene, lightSources());
  const fx = new FxManager(world.scene);
  fx.onLight = (at, color, power, range, ms) => lights.flash(at, color, power, range, ms);
  for (const b of BRAZIER_FIRES) fx.hearth(new THREE.Vector3(b.x, b.y, b.z), 1.1);
  const [ax, az] = (p.get('at') ?? `${town.x},${town.z}`).split(',').map(Number);
  const target = new THREE.Vector3(ax, Number(p.get('ty')) || heightAt(ax, az) + 2, az);
  const motes = new Motes();
  world.scene.add(motes.points);
  const dist = Number(p.get('dist')) || town.r * 2.1, pitch = Number(p.get('pitch')) || 0.55;
  const fixed = p.get('ry');
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    post.resize();
  };
  resize();
  addEventListener('resize', resize);
  Object.assign(window, { townFx: fx, townWorld: world }); // dev hooks: effects, and the sky (townWorld.flashSky)

  let last = performance.now();
  const sunScreen = new THREE.Vector3();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const a = fixed !== null ? Number(fixed) : now / 9000;
    cam.position.set(target.x + Math.sin(a) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(a) * Math.cos(pitch) * dist);
    cam.lookAt(target);
    world.updateSky(cam, cam.far, dt);
    // the sun's light shafts, as the game sets them (game.ts frame)
    const sv = sunScreen.copy(cam.position).addScaledVector(ATMOS.sunDir, 500).project(cam);
    const off = Math.max(Math.abs(sv.x), Math.abs(sv.y));
    post.setSun(sv.x * 0.5 + 0.5, sv.y * 0.5 + 0.5, sv.z < 1 ? (1 - Math.min(1, Math.max(0, (off - 1) / 1.4))) * Math.min(1, Math.max(0, ATMOS.sunDir.y * 6)) * 0.9 : 0);
    world.follow(target);
    lights.update(target, now / 1000);
    motes.update(target, dt, now / 1000);
    fx.p.setShade(0.25 + 0.75 * ATMOS.day);
    fx.update(target);
    post.render();
  });
  return () => {
    removeEventListener('resize', resize);
    renderer.setAnimationLoop(null);
    world.dispose();
    renderer.dispose();
    host.innerHTML = '';
  };
}
