// Renders an extension page in Chrome for Testing and screenshots one element at 3x, so visual
// details can be judged by eye instead of guessed at.
//
//   npm run shot                                     popup .app
//   npm run shot -- options .shortcut-table out.png  any page, selector and output path
//
// Requires `npm run build` first; needs Chrome for Testing (branded Chrome ignores --load-extension).
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, cp, rm, writeFile, readdir, realpath, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const page = process.argv[2] ?? 'popup';
const selector = process.argv[3] ?? '.app';
const outFile = path.resolve(process.argv[4] ?? `.artifacts/${page}.png`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9444;

async function findChrome() {
  const roots = [path.join(os.homedir(), 'Library/Caches/ms-playwright')];
  const found = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'Google Chrome for Testing' && full.includes('/MacOS/')) found.push(full);
      else if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  for (const dir of roots) await walk(dir, 0);
  found.sort();
  return found.at(-1);
}

const EXT_DIR = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hira-shot-')));
await cp(path.join(root, 'dist/hiraishin'), EXT_DIR, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://*/*', 'https://*/*'];
await writeFile(path.join(EXT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
const PROFILE = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hira-shot-p-')));
const chrome = spawn(await findChrome(), ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  '--remote-allow-origins=*', `--user-data-dir=${PROFILE}`, `--load-extension=${EXT_DIR}`,
  `--disable-extensions-except=${EXT_DIR}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; ; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } if (i > 80) throw new Error('no port'); }

const hex = createHash('sha256').update(EXT_DIR).digest('hex').slice(0, 32);
const EXT = [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${EXT}/${page}.html`, { method: 'PUT' });
await sleep(1500);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find(t => t.url.endsWith(`/${page}.html`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) pending.get(m.id)?.(m); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('DOM.enable');
await send('CSS.enable');
await send('Emulation.setDeviceMetricsOverride', { width: page === 'popup' ? 384 : 1040, height: page === 'popup' ? 700 : 1400, deviceScaleFactor: 3, mobile: false });
await sleep(1200);
if (process.env.SHOT_PRE) {
  await send('Runtime.evaluate', { expression: process.env.SHOT_PRE, awaitPromise: true });
  await sleep(300);
}
// SHOT_RELOAD=1 reloads after SHOT_PRE, so settings written there are picked up on a fresh render.
if (process.env.SHOT_RELOAD) {
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);
}
// SHOT_ACTIVE=<selector> forces the real :active state, the way DevTools does, so pressed
// styling can be captured without adding a test-only class to production CSS.
if (process.env.SHOT_ACTIVE) {
  const document = (await send('DOM.getDocument', { depth: 0 })).result.root;
  const nodeId = (await send('DOM.querySelector', { nodeId: document.nodeId, selector: process.env.SHOT_ACTIVE })).result.nodeId;
  if (!nodeId) throw new Error(`SHOT_ACTIVE selector not found: ${process.env.SHOT_ACTIVE}`);
  await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
  await sleep(300);
}
if (process.env.SHOT_MEASURE) {
  const measured = await send('Runtime.evaluate', { expression: process.env.SHOT_MEASURE, awaitPromise: true, returnByValue: true });
  console.log('MEASURE', JSON.stringify(measured.result.result.value));
}
const rect = (await send('Runtime.evaluate', {
  expression: `(() => { const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('selector not found: ' + ${JSON.stringify(selector)});
    const r = element.getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, Math.floor(r.x) - 8), y: Math.max(0, Math.floor(r.y) - 8), width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 }); })()`,
  returnByValue: true,
})).result.result.value;
const clip = { ...JSON.parse(rect), scale: 3 };
const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', outFile);
ws.close();
chrome.kill('SIGTERM');
await sleep(300);
await rm(EXT_DIR, { recursive: true, force: true });
await rm(PROFILE, { recursive: true, force: true });
