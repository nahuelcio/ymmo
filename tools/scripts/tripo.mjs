// Generates a gear set's pieces with Tripo (tripo3d.ai, paid API: the models are ours to use and change): for each
// piece a concept image (text to image), then the model from it (image to model), textured, downloaded to
// tools/art/ai/out/<set>/ for tools/art/blender/ai_gear.py to bring into the game.
// Usage: node tools/scripts/tripo.mjs tools/art/ai/<set>.json [--only blade,helm] [--variants 3] [--start 1] [--dry]
//                                     [--concepts] [--from hood_c2,robe_c1] [--multiview] [--cheap] [--max-credits 300]
//   --only: just these pieces; --variants: how many of each (default 3), numbered from --start; --dry: print the plan
//   and its cost, call nothing;
//   --concepts: only the concept images, <piece>_c<n>.png (5 credits each, against a model's 30 to 60): to choose from
//   before paying for a model;
//   --from: a concept made before (each piece the one named for it), uploaded, instead of a new one;
//   --multiview: the model from four views of the concept (front, sides, back: Tripo draws the others), so its back is
//   made rather than guessed (a cuirass from its front alone comes without one);
//   --cheap: the standard texture and Tripo's own triangle count (ai_gear.py cuts each piece to its budget anyway),
//   not the detailed texture and smart low-poly (30 credits a model against 50);
//   --max-credits: starts nothing that would take the run past this many credits.
// Credits: 1 = USD 0.01; each task's real charge is read back and kept in the manifest, the account's balance printed.
// The key is TRIPO_API_KEY, from the environment or the repo's .env (never committed); it goes nowhere but Tripo.
// Pieces already downloaded are skipped, so a run that stopped halfway picks up where it was.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const SPEC = args.find((a) => a.endsWith('.json'));
if (!SPEC || !fs.existsSync(SPEC)) throw new Error('usage: node tools/scripts/tripo.mjs tools/art/ai/<set>.json [--only a,b] [--variants n] [--dry]');
const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
const ONLY = opt('only', '').split(',').filter(Boolean);
const VARIANTS = +opt('variants', '3');
const START = +opt('start', '1');
const FROM = opt('from', '').split(',').filter(Boolean);
const fromFor = (name) => FROM.find((f) => f.startsWith(`${name}_`));
const CONCEPTS = args.includes('--concepts');
const MULTIVIEW = args.includes('--multiview');
const CHEAP = args.includes('--cheap');
const MAX = +opt('max-credits', 'Infinity');
const DRY = args.includes('--dry');
const OUT = path.resolve('tools/art/ai/out', spec.set);
const API = 'https://openapi.tripo3d.ai/v3'; // the global platform (tripo3d.com is the China one)
// what a job is expected to cost (developers.tripo3d.ai/en/pricing): its concept, then its model (image to model with a
// standard texture 30; the detailed texture and smart low-poly 10 each; the four views 10)
const cost = (name) => (CONCEPTS ? 5 : (fromFor(name) ? 0 : 5) + (CHEAP ? 30 : 50) + (MULTIVIEW ? 10 : 0));

function key() {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY;
  const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const m = /^TRIPO_API_KEY=(.+)$/m.exec(env);
  if (!m) throw new Error('no TRIPO_API_KEY: put it in the environment or in .env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, route, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + route, {
      method,
      headers: { Authorization: `Bearer ${key()}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.code === 0) return j.data;
    // busy or throttled: wait longer each time; anything else is a mistake to report
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      await sleep(Math.min(60000, 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${method} ${route}: ${res.status} ${j.message ?? ''} ${j.suggestion ?? ''}`.trim());
  }
}

let spent = 0;
/** Waits for a task to end; the finished task (its output, what it was charged). */
async function done(id) {
  for (;;) {
    const t = await call('GET', `/tasks/${id}`);
    if (t.status === 'success') {
      spent += t.credits_consumed ?? 0;
      return t;
    }
    if (t.status === 'failed' || t.status === 'cancelled') throw new Error(`task ${id} ${t.status}: ${t.error_message ?? ''}`);
    await sleep(3000);
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${file}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const target = (name, n) => path.join(OUT, CONCEPTS ? `${name}_c${n}.png` : `${name}_${n}.glb`);
const jobs = Object.entries(spec.pieces)
  .filter(([name]) => !ONLY.length || ONLY.includes(name))
  .flatMap(([name, p]) => Array.from({ length: VARIANTS }, (_, i) => ({ name, p, n: START + i })))
  .filter(({ name, n }) => !fs.existsSync(target(name, n)));
const credits = jobs.reduce((s, j) => s + cost(j.name), 0);
console.log(`[tripo] ${spec.set}: ${jobs.length} ${CONCEPTS ? 'concepts' : 'models'} to make (${jobs.map((j) => `${j.name}_${CONCEPTS ? 'c' : ''}${j.n}`).join(', ') || 'none'}), `
  + `~${credits} credits (USD ${(credits / 100).toFixed(2)})${MAX < Infinity ? `, at most ${MAX}` : ''}`);
if (DRY || !jobs.length) process.exit(0);
const balance = async () => (await call('GET', '/account/balance')).balance;
const before = await balance();
console.log(`[tripo] balance ${before} credits`);

fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const save = () => fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));

/** An image of ours sent to Tripo: its file token. */
async function upload(file) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
  const res = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.code !== 0) throw new Error(`upload ${file}: ${res.status} ${j.message ?? ''}`);
  return j.data.file_token;
}

async function concept(prompt, file) {
  const img = await call('POST', '/generation/text-to-image', { prompt, model: spec.image_model ?? 'seedream_v5', size: '2K' });
  const t = await done(img.task_id);
  await download(t.output.generated_image_url, file);
  return { task: img.task_id, url: t.output.generated_image_url, credits: t.credits_consumed ?? 0 };
}

async function make({ name, p, n }) {
  const prompt = `${p.prompt} ${spec.style} ${spec.frame}`;
  if (CONCEPTS) {
    const c = await concept(prompt, target(name, n));
    manifest[`${name}_c${n}`] = { prompt, image_task: c.task, credits: c.credits, at: new Date().toISOString() };
    save();
    console.log(`[tripo] ${name}_c${n}`);
    return;
  }
  const base = path.join(OUT, `${name}_${n}`);
  const from = fromFor(name);
  // the concept: a new one, or one made before (uploaded again)
  let input, url, charged = 0;
  if (from) {
    fs.copyFileSync(path.join(OUT, `${from}.png`), `${base}.png`);
    input = await upload(`${base}.png`);
  } else {
    const c = await concept(prompt, `${base}.png`);
    [input, url, charged] = [c.task, c.url, c.credits]; // the model is made from the image task itself
  }
  const opts = { model: 'v3.1-20260211', pbr: true, ...(CHEAP ? { face_limit: p.faces * 4 } : { texture_quality: 'detailed', smart_low_poly: true, face_limit: p.faces }) };
  let mod;
  if (MULTIVIEW) {
    const mv = await call('POST', '/generation/image-to-multiview', { input: from ? input : url });
    const views = await done(mv.task_id);
    charged += views.credits_consumed ?? 0;
    mod = await call('POST', '/generation/multiview-to-model', { inputs: [{ task_id: mv.task_id }], ...opts });
  } else mod = await call('POST', '/generation/image-to-model', { input, ...opts });
  const t = await done(mod.task_id);
  charged += t.credits_consumed ?? 0;
  if (t.output.rendered_image_url) await download(t.output.rendered_image_url, `${base}_render.webp`).catch(() => {});
  await download(t.output.model_url, `${base}.glb`);
  manifest[`${name}_${n}`] = { prompt, from, multiview: MULTIVIEW || undefined, cheap: CHEAP || undefined, model_task: mod.task_id, faces: p.faces, credits: charged,
    at: new Date().toISOString() };
  save();
  console.log(`[tripo] ${name}_${n}: ${(fs.statSync(`${base}.glb`).size / 1024) | 0} KB, ${charged} credits`);
}

// two at a time, none started that could take the run past --max-credits
const queue = [...jobs];
const failed = [], skipped = [];
let committed = 0;
await Promise.all([0, 1].map(async () => {
  for (let j; (j = queue.shift());) {
    if (committed + cost(j.name) > MAX) {
      skipped.push(`${j.name}_${j.n}`);
      continue;
    }
    committed += cost(j.name);
    await make(j).catch((e) => {
      failed.push(`${j.name}_${j.n}`);
      console.warn(`[tripo] ${j.name}_${j.n} failed: ${e.message}`);
    });
  }
}));
const after = await balance();
console.log(`[tripo] done: ${spent} credits charged by the tasks, balance ${before} -> ${after}`
  + `${failed.length ? `; failed: ${failed.join(', ')} (run again to retry them)` : ''}${skipped.length ? `; over the limit, not started: ${skipped.join(', ')}` : ''}`);
