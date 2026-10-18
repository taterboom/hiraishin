// Records real footage of the in-page wheel for the store promo video.
// Loads the built extension into Chromium, opens three demo tabs, performs the gestures through real
// DevTools input (hold Alt, flick, release) and saves screencast frames plus a log of the pointer,
// the key and the tab strip, so promo.html can lay a cursor and tab bar over the footage.
//
//   npm run build && node scripts/promo/record.mjs
//   CHROME=/path/to/chromium node scripts/promo/record.mjs
//
// Output: .artifacts/promo/footage/{000123.jpg, log.json}. Needs Chrome for Testing / Chromium
// (branded Chrome ignores --load-extension). Opens a visible window for about 20 seconds.
import http from 'node:http';
import { readFile, mkdtemp, cp, rm, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(root, '.artifacts/promo/footage');
const PORT = 9555, CDP = `http://127.0.0.1:${PORT}`, WWW_PORT = 8777, WWW = `http://127.0.0.1:${WWW_PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Date.now() / 1000;   // same clock as Page.screencastFrame metadata.timestamp

async function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [path.join(os.homedir(), 'AppData/Local/ms-playwright'), path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
  const found = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && (e.name === 'chrome.exe' && /chrome-win/.test(full) || e.name === 'Google Chrome for Testing' || e.name === 'Chromium' || e.name === 'chrome' && /chrome-linux/.test(full))) found.push(full);
      else if (e.isDirectory() && !/headless_shell/.test(e.name)) await walk(full, depth + 1);
    }
  }
  for (const dir of roots) await walk(dir, 0);
  if (!found.length) throw new Error('No Chromium found. Set CHROME=/path/to/binary.');
  return found.sort().at(-1);
}

// ---- extension copy with the same test hook and host access the smoke test uses
const EXT_DIR = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hiraishin-promo-')));
await cp(path.join(root, 'dist/hiraishin'), EXT_DIR, { recursive: true });
await writeFile(path.join(EXT_DIR, 'src/background.js'), await readFile(path.join(EXT_DIR, 'src/background.js'), 'utf8') +
  `\nglobalThis.__hiraishinTest = message => controller.handleMessage(message, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') })\n` +
  `  .then(result => ({ ok: true, ...(result ?? {}) }), error => ({ ok: false, error: error.message }));\n`);
const manifest = JSON.parse(await readFile(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*', 'http://*/*', 'https://*/*'];
await writeFile(path.join(EXT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
const PROFILE = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hiraishin-promo-profile-')));

// ---- demo pages: two made-up documents and the real Chinese landing page
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = p.startsWith('/site/') ? path.join(root, p) : path.join(root, 'scripts/promo/pages', path.basename(p));
  try { const body = await readFile(file.endsWith('/') || !path.extname(file) ? path.join(file, 'index.html') : file); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(body); }
  catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(r => server.listen(WWW_PORT, '127.0.0.1', r));

const chrome = spawn(await findChrome(), [
  `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT_DIR}`, `--disable-extensions-except=${EXT_DIR}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1100,700', '--window-position=40,40', '--lang=zh-CN', '--force-device-scale-factor=2',
  '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore' });
async function cleanup() {
  server.close(); chrome.kill(); await sleep(800);
  await rm(EXT_DIR, { recursive: true, force: true }).catch(() => {});
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
for (let i = 0; ; i++) { try { await fetch(`${CDP}/json/version`); break; } catch { await sleep(250); } if (i > 80) { await cleanup(); throw new Error('Chromium did not start'); } }

class Session {
  constructor(url, label) {
    this.label = label; this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.onEvent = null;
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(`${label}: ${JSON.stringify(m.error)}`)) : p.resolve(m.result); }
      else this.onEvent?.(m);
    };
  }
  send(method, params = {}, timeout = 8000) {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out on ${this.label}`)); }, timeout).unref?.();
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}
const targets = async () => (await fetch(`${CDP}/json/list`)).json();
async function waitTarget(pred, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const t = (await targets()).find(pred); if (t) return t; await sleep(200); }
  throw new Error('target not found');
}
async function attach(t, label) { const s = new Session(t.webSocketDebuggerUrl, label); await s.ready; await s.send('Runtime.enable'); return s; }

/** Walk the page including the wheel's closed shadow root and return the centre of one element. */
async function pointOf(session, match) {
  await session.send('DOM.enable');
  const { root: doc } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  let hit = null;
  const walk = node => {
    if (hit) return;
    const a = {}; const at = node.attributes ?? [];
    for (let i = 0; i < at.length; i += 2) a[at[i]] = at[i + 1];
    if (match(a, node)) { hit = node; return; }
    for (const c of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(c);
  };
  walk(doc);
  if (!hit) return null;
  const { object } = await session.send('DOM.resolveNode', { nodeId: hit.nodeId });
  const { result } = await session.send('Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true,
    functionDeclaration: 'function () { const r = this.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: Boolean(this.disabled), text: this.textContent }; }' });
  return result.value;
}

let recording = false, activeNow = 'doc';
const log = { frames: [], pointer: [], keys: [], tabs: [], captions: [], view: null };
let frameNo = 0;
await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true });

try {
  // ---- service worker and settings
  const sw = await attach(await waitTarget(t => t.type === 'service_worker' && t.url.endsWith('/src/background.js')), 'worker');
  for (let i = 0; i < 40 && !await sw.eval('typeof globalThis.__hiraishinTest === "function"'); i++) await sleep(250);
  console.log('worker ready');
  const msg = async m => { const r = await sw.eval(`globalThis.__hiraishinTest(${JSON.stringify(m)})`); if (!r.ok) throw new Error(r.error); return r; };
  const current = await msg({ type: 'get-settings' });
  await msg({ type: 'save-settings', settings: { ...current.settings, locale: 'zh', overlay: { ...current.settings.overlay, enabled: true, holdMs: 0 } } });
  await sleep(900);

  // ---- three tabs in strip order: doc, report, landing page. Visit report, then doc, so
  //      "switch to previous tab" from doc lands on report.
  const windowId = await sw.eval('chrome.windows.getLastFocused().then(w => w.id)');
  const URLS = { doc: `${WWW}/doc.html`, report: `${WWW}/report.html`, site: `${WWW}/site/zh/` };
  const ids = {};
  for (const [key, url] of Object.entries(URLS)) ids[key] = await sw.eval(`chrome.tabs.create({ windowId: ${windowId}, url: ${JSON.stringify(url)}, active: true }).then(t => t.id)`);
  await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(ts => Promise.all(ts.filter(t => ![${Object.values(ids)}].includes(t.id)).map(t => chrome.tabs.remove(t.id))))`);
  await sleep(1500);
  await sw.eval(`chrome.tabs.update(${ids.report}, { active: true })`); await sleep(700);
  await sw.eval(`chrome.tabs.update(${ids.doc}, { active: true })`); await sleep(900);

  // ---- one session per tab, each screencasting; only the visible tab paints
  console.log('tabs open');
  const sessions = {};
  for (const [key, url] of Object.entries(URLS)) {
    const s = await attach(await waitTarget(t => t.type === 'page' && t.url.startsWith(url)), key);
    await s.send('Page.enable');
    await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    s.onEvent = m => {
      if (m.method !== 'Page.screencastFrame') return;
      s.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
      // Keep only the tab that is on screen; the others keep painting because backgrounding is off.
      if (!recording || activeNow !== key) return;
      const file = `${String(frameNo++).padStart(6, '0')}.jpg`;
      log.frames.push({ t: m.params.metadata.timestamp, tab: key, file });
      writeFile(path.join(OUT, file), Buffer.from(m.params.data, 'base64'));
    };
    // The screencast only sends a frame when the compositor draws one. A near-invisible pixel that
    // moves every animation frame keeps it drawing, so a tab switch or a still page is never missed.
    await s.eval(`(() => { const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:.004;background:#000;z-index:2147483647';
      document.documentElement.append(d); let i = 0; (function tick() { d.style.transform = 'translateX(' + (i++ % 2) + 'px)'; requestAnimationFrame(tick); })(); })()`);
    sessions[key] = s;
  }
  log.view = await sessions.doc.eval('({ w: innerWidth, h: innerHeight })');

  // ---- tab strip log
  const titles = { doc: '产品设计文档 · 新版结账流程', report: '周报 · 第 42 周', site: '飛雷神 Hiraishin' };
  const keyOf = id => Object.keys(ids).find(k => ids[k] === id);
  let polling = true;
  (async () => {
    while (polling) {
      const tabs = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(ts => ts.map(t => [t.id, t.active]))`).catch(() => null);
      if (tabs) activeNow = keyOf((tabs.find(([, a]) => a) ?? [])[0]) ?? activeNow;
      if (tabs) log.tabs.push({ t: now(), tabs: tabs.map(([id, active]) => ({ key: keyOf(id), title: titles[keyOf(id)], active })) });
      await sleep(80);
    }
  })();


  let active = 'doc';
  const page = () => sessions[active];
  let mods = 0, at = { x: 0, y: 0 };
  const key = async down => {
    mods = down ? 1 : 0; log.keys.push({ t: now(), down });
    await page().send('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: mods });
  };
  const move = async (x, y) => {
    at = { x, y }; log.pointer.push({ t: now(), x, y });
    await page().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, modifiers: mods });
  };
  /** Glide the pointer with an ease-out, the way a hand flicks. */
  const glide = async (x, y, ms, steps = Math.max(4, Math.round(ms / 16))) => {
    const from = { ...at };
    for (let i = 1; i <= steps; i++) {
      const p = 1 - Math.pow(1 - i / steps, 3);
      await move(Math.round(from.x + (x - from.x) * p), Math.round(from.y + (y - from.y) * p));
      await sleep(ms / steps);
    }
  };
  const click = async (x, y) => {
    await page().send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(90);
    await page().send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    log.keys.push({ t: now(), click: true, x, y });
  };
  const caption = text => log.captions.push({ t: now(), text });
  const slot = id => pointOf(page(), a => a['data-action'] === id);

  /** Hold Alt, nudge to reveal the wheel, flick to one action, rest on it, release. */
  async function flick(actionId, from) {
    console.log('flick', actionId, active);
    await glide(from.x, from.y, 500);
    await sleep(350);
    await key(true);
    await sleep(250);
    await glide(from.x + 14, from.y - 6, 90);
    let target = null;
    for (let i = 0; i < 20 && !target; i++) { target = await slot(actionId); if (!target) await sleep(100); }
    if (!target) throw new Error(`wheel did not show ${actionId}`);
    await sleep(380);
    await glide(target.x, target.y, 220);
    await sleep(650);
    await key(false);
  }
  const switchTo = async k => {
    const prev = at;
    for (let i = 0; i < 30; i++) {
      const isActive = await sw.eval(`chrome.tabs.get(${ids[k]}).then(t => t.active)`);
      if (isActive) break;
      await sleep(80);
    }
    active = k;
    // The pointer stays where it was on screen; the new page has to learn that too.
    await page().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: prev.x, y: prev.y, buttons: 0, modifiers: 0 });
  };

  for (const s of Object.values(sessions)) await s.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 2 });
  const W = log.view.w, H = log.view.h;
  await move(Math.round(W * 0.72), Math.round(H * 0.78));
  await sleep(600);
  console.log('recording');
  recording = true;
  log.start = now();
  await sleep(900);

  // 1. switch to the previous tab
  caption('切回上一个标签页');
  await flick('switch-previous-tab', { x: Math.round(W * 0.55), y: Math.round(H * 0.52) });
  await switchTo('report');
  await sleep(1500);

  console.log('step 1 done');
  // 2. history back
  caption('访问历史后退');
  await flick('history-back', { x: Math.round(W * 0.5), y: Math.round(H * 0.5) });
  await switchTo('doc');
  await sleep(1500);

  console.log('step 2 done');
  // 3. close the tabs to the right, with confirmation
  caption('关闭右侧标签页，先确认再关');
  await flick('close-right', { x: Math.round(W * 0.48), y: Math.round(H * 0.5) });
  console.log('waiting for confirmation');
  let button = null;
  for (let i = 0; i < 30; i++) { button = await pointOf(page(), a => (a.class ?? '').split(' ').includes('confirmation-close')); if (button && !button.disabled) break; await sleep(100); }
  if (!button || button.disabled) throw new Error('confirmation did not become ready');
  await sleep(700);
  await glide(button.x, button.y, 450);
  await sleep(450);
  console.log('confirm at', button);
  await click(button.x, button.y);
  await sleep(1800);
  log.end = now();
  recording = false; polling = false;
  for (const s of Object.values(sessions)) await s.send('Page.stopScreencast').catch(() => {});
  await sleep(300);
  await writeFile(path.join(OUT, 'log.json'), JSON.stringify(log));
  console.log(`recorded ${log.frames.length} frames, ${(log.end - log.start).toFixed(1)} s → ${path.relative(root, OUT)}`);
} finally {
  await cleanup();
}
