// Client soak benchmark runner: opens a real Chrome (GPU, not throttled when covered or in the background),
// logs a throwaway character into a local dev server and runs the in-page soak (client/src/soak.ts),
// then prints the samples and saves them as JSON. Needs the dev client (Vite) and a game server running.
//
//   npx tsx tools/scripts/soak.ts --minutes 10 --out bench-before.json
//   npx tsx tools/scripts/loadtest.ts --bots 30 --raid 0 --secs 1500   # in another shell: a crowd to stress it
//
// --url      the client (default http://localhost:5173)
// --minutes  how long to play (default 5)   --every  seconds between samples (default 15)
// --chrome   browser executable (default: Chrome, then Edge, in their usual Windows places)
// --profile  N: record a CPU profile over N seconds of play instead, and list the hottest functions
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL = arg('url', 'http://localhost:5173');
const MINUTES = +arg('minutes', '5');
const EVERY = +arg('every', '15');
const OUT = arg('out', '');
/** --profile N: instead of sampling, record a CPU profile for N seconds of play and list the hottest functions */
const PROFILE = +arg('profile', '0');
/** --eval "<js body>": run it in the page once in the world (window.game is there) and print what it returns */
/** --shot file.png: play for 20 s and save a screenshot instead */
const SHOT = arg('shot', '');
const EVAL =((e) => (e.startsWith('@') ? readFileSync(e.slice(1), 'utf8') : e))(arg('eval', '')); // @file reads it from a file
const PORT = 9333;
const CHROME = arg('chrome', [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p)) ?? 'chrome');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const profileDir = mkdtempSync(join(tmpdir(), 'claudi-soak-'));
const browser = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  // keep rendering at full speed even when the window is covered or unfocused
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  // exact heap numbers and a gc() to call before each sample, so the heap reads retained memory, not garbage
  '--enable-precise-memory-info', '--js-flags=--expose-gc', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore' });

async function target(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('Chrome did not open its debugging port');
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.once('open', r));
let seq = 0;
const pending = new Map<number, (v: { result?: { result?: { value?: unknown } }; error?: unknown }) => void>();
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.id) pending.get(m.id)?.(m), pending.delete(m.id);
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a: { value?: unknown }) => a.value).join(' ');
    if (text.startsWith('[soak]')) console.log(text);
  }
});
const send = (method: string, params: object = {}) =>
  new Promise<{ result?: { result?: { value?: unknown } }; error?: unknown }>((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
/** Run an async expression in the page and return its value. */
async function page<T>(expr: string): Promise<T> {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.error || (r.result as { exceptionDetails?: unknown })?.exceptionDetails) throw new Error(JSON.stringify(r));
  return r.result?.result?.value as T;
}

interface ProfNode { id: number; hitCount: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }

/** CPU profile while the soak plays for `secs`: prints the functions with the most self time. */
async function profile(secs: number) {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  void page(`window.soak({ minutes: ${secs / 60 + 1}, every: 1000 }); return 1;`);
  await sleep(3000);
  await send('Profiler.start');
  await sleep(secs * 1000);
  const r = (await send('Profiler.stop')) as { result?: { profile?: { nodes: ProfNode[] } } };
  const nodes = r.result!.profile!.nodes;
  const total = nodes.reduce((a, n) => a + n.hitCount, 0);
  const self = new Map<string, number>();
  for (const n of nodes) {
    const f = n.callFrame, file = f.url.replace(/^.*\/(src|node_modules)\//, '').replace(/\?.*$/, '');
    const key = `${f.functionName || '(anonymous)'}  ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + n.hitCount);
  }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`\nCPU profile, ${secs} s, self time:`);
  for (const [k, v] of top) console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  if (OUT) writeFileSync(OUT, JSON.stringify(top, null, 1));
}

try {
  await send('Runtime.enable');
  // the window counts as focused even when it isn't (the game drops to 30 fps without focus)
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: URL });
  await sleep(4000);
  // a fresh account and character each run (local dev server only)
  const user = `soak${Date.now().toString(36).slice(-6)}`;
  await page(`
    const wait = async (f, ms = 15000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 100)); } };
    const btn = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
    const input = (sel, v) => { const i = document.querySelector(sel); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
    await wait(() => btn('Crear cuenta') || btn('Create account'));
    input('input[placeholder="Cuenta"], input[placeholder="Account"]', '${user}');
    input('input[type=password]', 'soak-${user}');
    (btn('Crear cuenta') || btn('Create account')).click();
    await wait(() => document.querySelector('input[placeholder="Nombre"], input[placeholder="Name"]'));
    input('input[placeholder="Nombre"], input[placeholder="Name"]', 'S${user.slice(-8)}');
    (btn('Crear') || btn('Create')).click();
    await wait(() => btn('Entrar al mundo') && !btn('Entrar al mundo').disabled);
    btn('Entrar al mundo').click();
    await wait(() => window.soak && window.game?.self, 30000);
  `);
  await sleep(5000); // let the world finish streaming in
  if (SHOT) {
    // a look at the game after a little play (nameplates, effects): proof the optimizations didn't break the picture
    void page(`window.soak({ minutes: 1, every: 1000 }); return 1;`);
    await sleep(20000);
    const r = (await send('Page.captureScreenshot', { format: 'png' })) as { result?: { data?: string } };
    writeFileSync(SHOT, Buffer.from(r.result!.data!, 'base64'));
  } else if (EVAL) console.log(JSON.stringify(await page(EVAL), null, 1));
  else if (PROFILE) await profile(PROFILE);
  else {
    const samples = await page<object[]>(`return await window.soak({ minutes: ${MINUTES}, every: ${EVERY} });`);
    console.table(samples);
    if (OUT) writeFileSync(OUT, JSON.stringify(samples, null, 1));
  }
} finally {
  ws.close();
  browser.kill();
  await sleep(500);
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* Chrome may still hold a file for a moment */
  }
}
