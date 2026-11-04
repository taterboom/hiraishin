// Chrome Web Store screenshots, 1280×800, one set per listing language:
//   docs/store-assets/01-settings-<lang>.png   the settings page
//   docs/store-assets/02-wheel-<lang>.png      the in-page wheel, summoned over our own home page
//   npm run store:shots
// Runs the release build with its manifest untouched, in a fresh headless profile: what a new user
// sees right after installing, with no site access granted by hand. Nothing in a shot is staged.
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, cp, rm, writeFile, readdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAll, OUT_DIR } from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(root, 'docs/store-assets');
const SITE = path.join(root, 'site');
const PORT = 9445;
const WWW_PORT = 8767;
const WIDTH = 1280;
const HEIGHT = 800;
/** Listing language → our own home page in that language; the privacy page opens beside it. */
const LANGS = { zh: '/zh/', ja: '/ja/', en: '/' };
/** The wheel is shot with this sector selected: by far the most used flick. */
const SELECTED = 'switch-previous-tab';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
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
  await walk(path.join(os.homedir(), 'Library/Caches/ms-playwright'), 0);
  if (!found.length) throw new Error('No Chrome for Testing found. Set CHROME=/path/to/binary.');
  return found.sort().at(-1);
}

await buildAll();
// Chrome derives the unpacked extension id from the canonical path (macOS /var → /private/var).
const EXT_DIR = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hiraishin-store-')));
await cp(OUT_DIR, EXT_DIR, { recursive: true });
const PROFILE = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hiraishin-store-p-')));
const hex = createHash('sha256').update(EXT_DIR).digest('hex').slice(0, 32);
const EXT = [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

const server = http.createServer(async (req, res) => {
  let file = path.join(SITE, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (file.endsWith('/')) file += 'index.html';
  // The live site serves clean URLs (/privacy → privacy.html), and its pages link that way.
  const body = await readFile(file).catch(() => readFile(`${file}.html`)).catch(() => null);
  if (!body) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8');
  res.end(body);
});
await new Promise(resolve => server.listen(WWW_PORT, '127.0.0.1', resolve));

const chrome = spawn(await findChrome(), ['--headless=new', `--window-size=${WIDTH},${HEIGHT}`, '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT_DIR}`, `--disable-extensions-except=${EXT_DIR}`, '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
async function cleanup() {
  server.close();
  chrome.kill('SIGTERM');
  await sleep(500);
  await rm(EXT_DIR, { recursive: true, force: true }).catch(() => {});
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
setTimeout(async () => { console.error('store-shots: gave up after 3 minutes'); await cleanup(); process.exit(1); }, 180_000).unref();
for (let i = 0; ; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); }
  if (i > 80) { await cleanup(); throw new Error('Chrome did not open the DevTools port.'); }
}

/** One DevTools connection, to the browser or to a page. */
async function connect(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  let loaded = () => {};
  let framed = () => {};
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Page.loadEventFired') loaded();
    if (message.method === 'Page.screencastFrame') framed(message.params.data);
    if (!message.id) return;
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  // A headless renderer that stops answering would otherwise hang the run without saying where.
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => reject(new Error(`${method} did not answer on ${label}`)), 15_000);
    pending.set(callId, message => {
      clearTimeout(timer);
      message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const nextLoad = () => new Promise(resolve => { loaded = resolve; });
  const nextFrame = () => new Promise(resolve => { framed = resolve; });
  return { send, evaluate, nextLoad, nextFrame, ws };
}
const browser = await connect((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl, 'browser');

/** A page opened as a foreground tab, all in the one window so tabs sit side by side. Headless
 *  Chrome composites only the tab in front, so `activate` before shooting a page opened earlier. */
async function openPage(url) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', background: false });
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(item => item.id === targetId);
  const page = await connect(target.webSocketDebuggerUrl, url);
  await page.send('Page.enable');
  // Screencast frames are the real window, so size the window, not an emulated viewport.
  const { windowId, bounds } = await browser.send('Browser.getWindowForTarget', { targetId });
  const view = await page.evaluate('({ w: innerWidth, h: innerHeight })');
  if (view.w !== WIDTH || view.h !== HEIGHT) {
    await browser.send('Browser.setWindowBounds', { windowId,
      bounds: { width: bounds.width + WIDTH - view.w, height: bounds.height + HEIGHT - view.h } });
  }
  const load = page.nextLoad();
  await page.send('Page.navigate', { url });
  await Promise.race([load, sleep(10_000)]);
  const activate = () => browser.send('Target.activateTarget', { targetId });
  const close = async () => {
    page.ws.close();
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  };
  return { send: page.send, evaluate: page.evaluate, nextFrame: page.nextFrame, activate, close };
}
// A screencast frame, not Page.captureScreenshot: the latter waits on the window's compositor
// surface and, headless, intermittently never answers once a second tab or window exists.
async function shoot(page, file) {
  const frame = page.nextFrame();
  await page.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  const data = await Promise.race([frame, sleep(15_000).then(() => { throw new Error(`no frame for ${file}`); })]);
  await page.send('Page.stopScreencast');
  const png = Buffer.from(data, 'base64');
  // The store accepts 1280×800 or 640×400 only; the PNG header holds the size.
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== WIDTH || height !== HEIGHT) throw new Error(`${file} is ${width}×${height}, not ${WIDTH}×${HEIGHT}`);
  await writeFile(path.join(OUT, file), png);
  console.log('wrote', path.relative(root, path.join(OUT, file)));
}

/** Where one action's badge sits, found through the wheel's closed shadow root. */
async function badgeOf(page, actionId) {
  const { root: doc } = await page.send('DOM.getDocument', { depth: -1, pierce: true });
  let nodeId = null;
  const walk = node => {
    const attributes = node.attributes ?? [];
    for (let i = 0; i < attributes.length; i += 2) {
      if (attributes[i] === 'data-action' && attributes[i + 1] === actionId) nodeId = node.nodeId;
    }
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(child);
  };
  walk(doc);
  if (!nodeId) return null;
  const { model } = await page.send('DOM.getBoxModel', { nodeId });
  const [x1, y1, , , x3, y3] = model.content;
  return { x: Math.round((x1 + x3) / 2), y: Math.round((y1 + y3) / 2) };
}

const optionsUrl = `chrome-extension://${EXT}/options.html`;
async function withOptions(work) {
  const options = await openPage(optionsUrl);
  await sleep(1500);
  try { return await work(options, message => options.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(message)})`)); }
  finally { await options.close(); }
}

try {
  const view = await withOptions((options, send) => send({ type: 'get-settings' }));
  if (!view?.settings) throw new Error(`settings did not load: ${JSON.stringify(view)}`);
  const mac = view.status.platform === 'mac';
  // Option on macOS and Alt elsewhere are the same key to CDP; modifiers sets event.altKey.
  const ALT = { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 };

  for (const [lang, home] of Object.entries(LANGS)) {
    await withOptions((options, send) => send({ type: 'save-settings', settings: { ...view.settings, locale: lang } }));
    await withOptions(options => shoot(options, `01-settings-${lang}.png`));

    // Two tabs, the home page left of its privacy page, the privacy page visited last: the wheel
    // then shows real targets for switching back, moving right and closing to the right instead of
    // the greyed-out slots of a lone tab.
    const page = await openPage(`http://127.0.0.1:${WWW_PORT}${home}`);
    const beside = await openPage(`http://127.0.0.1:${WWW_PORT}${home}privacy`);
    await sleep(800);
    await page.send('DOM.enable');
    await page.activate();
    await sleep(1500);
    const at = { x: Math.round(WIDTH / 2), y: Math.round(HEIGHT / 2) + 40 };
    const move = (x, y, modifiers) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, modifiers });
    let badge = null;
    // Registration reaches a new tab asynchronously, as it does for a real install: retry a little.
    for (let attempt = 0; attempt < 5 && !badge; attempt++) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ALT, modifiers: 0 });
      await move(at.x, at.y, 0);
      await sleep(250);
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ALT });
      await sleep(300);
      await move(at.x + 12, at.y, ALT.modifiers);
      await sleep(400);
      badge = await badgeOf(page, SELECTED);
      if (!badge) await sleep(800);
    }
    if (!badge) throw new Error(`${lang}: the wheel did not open on a fresh install (${mac ? 'Option' : 'Alt'} + flick)`);
    await move(badge.x, badge.y, ALT.modifiers);
    // Resting on a sector names it in the hub after HINT_DELAY (ui/overlay/main.tsx): show that.
    await sleep(2600);
    await shoot(page, `02-wheel-${lang}.png`);
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await beside.close();
    await page.close();
  }
} finally {
  await cleanup();
}
