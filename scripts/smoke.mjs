// Real-browser smoke test: loads the unpacked extension into Chrome for Testing,
// drives it over the DevTools protocol and checks core flows end to end.
// Keep browser-only integration and safety checks here; pure logic belongs in tests/.
// Colours, pixel sizes, icon alignment and hint timing are reviewed visually.
//
//   npm run smoke                          # auto-detects a Chrome for Testing / Chromium build
//   HEADLESS=1 npm run smoke               # no window; the in-page panel section cannot run there
//   CHROME=/path/to/Chromium npm run smoke
//
// Branded Google Chrome ignores --load-extension since v137, so a Chrome for Testing or
// Chromium binary is required (Playwright / Puppeteer caches are searched by default).
import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile, mkdtemp, cp, rm, writeFile, readdir, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const WWW_DIR = fileURLToPath(new URL('./smoke/', import.meta.url));
const PORT = 9333;
const CDP = `http://127.0.0.1:${PORT}`;
const WWW = 'http://127.0.0.1:8766';
const results = [];
let overlayInputTrace = null;
const pass = (name) => { results.push(['PASS', name]); console.log('PASS', name); };
const fail = (name, detail) => { results.push(['FAIL', name, detail]); console.log('FAIL', name, '—', detail); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright'), path.join(os.homedir(), '.cache/puppeteer/chrome')];
  const found = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && ['Google Chrome for Testing', 'Chromium'].includes(entry.name) && full.includes('/MacOS/')) found.push(full);
      else if (entry.isFile() && entry.name === 'chrome' && /chrome-linux/.test(full)) found.push(full);
      else if (entry.isDirectory()) await walk(full, depth + 1);
    }
  }
  for (const dir of roots) await walk(dir, 0);
  found.sort();
  if (!found.length) throw new Error('No Chrome for Testing / Chromium found. Set CHROME=/path/to/binary.');
  return found[found.length - 1];
}

// Smoke build: pre-grant hosts so adapter and web-shortcut paths run without a permission prompt.
// Chrome derives the unpacked extension id from the canonical path (macOS /var → /private/var).
import { buildAll, OUT_DIR } from './build.mjs';
await buildAll();
const EXT_DIR = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hiraishin-smoke-')));
await cp(OUT_DIR, EXT_DIR, { recursive: true });
// The harness drives the controller through the worker, which stays alive for the whole run.
// Routing through a page instead is unreliable: this popup lives in a background tab (a real one
// closes on blur), and a backgrounded renderer stops evaluating, which looks like a hang.
await writeFile(path.join(EXT_DIR, 'src/background.js'), await readFile(path.join(EXT_DIR, 'src/background.js'), 'utf8') +
  `\nglobalThis.__hiraishinTest = message => controller.handleMessage(message, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') })\n` +
  `  .then(result => ({ ok: true, ...(result ?? {}) }), error => ({ ok: false, error: error.message || '操作失败，请重试。' }));\n`);
// The assertions read the Chinese copy, and Chrome for Testing's UI language depends on the
// machine. Make Chinese the default preference in this copy only; a test that saves an explicit
// locale still switches, and one that saves settings without a locale gets Chinese back.
const settingsFile = path.join(EXT_DIR, 'src/settings.js');
const settingsSource = await readFile(settingsFile, 'utf8');
if (!settingsSource.includes("locale: 'auto',")) throw new Error('smoke: default locale marker not found in settings.js');
await writeFile(settingsFile, settingsSource.replace("locale: 'auto',", "locale: 'zh',"));
const manifest = JSON.parse(await readFile(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*', 'http://*/*', 'https://*/*'];
await writeFile(path.join(EXT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
const PROFILE = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hiraishin-profile-')));

const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(WWW_DIR, new URL(req.url, 'http://x').pathname.replace(/^\/+/, ''));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('not found'); }
});
await new Promise(r => server.listen(8766, '127.0.0.1', r));
// Last resort: never let a wedged browser hold the suite (or CI) open.
setTimeout(async () => { console.log('FAIL smoke watchdog — the run exceeded 8 minutes'); await cleanup().catch(() => {}); process.exit(1); }, 8 * 60 * 1000).unref();

// A Chrome left over from an earlier run keeps the debugging port, and this script would then
// drive that stale browser instead of the one it just launched: every tab assertion fails against
// somebody else's tabs. Refuse to start rather than produce a confusing red suite.
if (await fetch(`${CDP}/json/version`).then(() => true, () => false)) {
  server.close();
  throw new Error(`port ${PORT} is already serving a browser; close it first `
    + `(lsof -ti tcp:${PORT} | xargs kill -9)`);
}

const chromeBinary = await findChrome();
console.log('chrome:', chromeBinary);
const chrome = spawn(chromeBinary, [
  // Headful by default: dispatching input into a page wedges the headless renderer, which stops
  // answering the protocol entirely. HEADLESS=1 still forces it for anything that has no display.
  ...(process.env.HEADLESS ? ['--headless=new'] : []), '--disable-gpu', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  `--user-data-dir=${PROFILE}`, `--load-extension=${EXT_DIR}`, `--disable-extensions-except=${EXT_DIR}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
async function cleanup() {
  server.close();
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  chrome.kill('SIGTERM');
  await Promise.race([exited, sleep(3000).then(() => chrome.kill('SIGKILL'))]);
  await sleep(200);
  await rm(EXT_DIR, { recursive: true, force: true }).catch(() => {});
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {});
}
for (let i = 0; ; i++) {
  try { await fetch(`${CDP}/json/version`); break; } catch { await sleep(250); }
  if (i >= 80) { await cleanup(); throw new Error('Chrome did not open the DevTools port.'); }
}

function extensionId(dir) {
  const hex = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}
const EXT = extensionId(EXT_DIR);

class Session {
  constructor(url, label = 'page') {
    this.label = label; this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.events = []; this.exceptions = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = ({ data }) => { const msg = JSON.parse(data); if (msg.id) { const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
      else { this.events.push(msg); if (msg.method === 'Runtime.exceptionThrown') this.exceptions.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text); if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') this.exceptions.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' ')); } };
  }
  // A headless renderer can stop answering (a backgrounded page, a busy compositor). Every call
  // gets a deadline so that shows up as one named failure instead of a suite that hangs forever.
  send(method, params = {}, timeout = 25000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} timed out on ${this.label}`)); }, timeout).unref?.();
    });
  }
  async eval(expression, { userGesture = false, timeout = 25000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, timeout)
      .catch(error => { throw new Error(`${error.message} — ${expression.replace(/\s+/g, ' ').slice(0, 70)}`); });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  close() { this.ws.close(); }
}

async function targets() { return (await fetch(`${CDP}/json/list`)).json(); }
async function waitTarget(predicate, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const t = (await targets()).find(predicate); if (t) return t; await sleep(250); }
  throw new Error('target not found');
}
async function attach(target) { const s = new Session(target.webSocketDebuggerUrl, target.title || target.url); await s.ready; await s.send('Runtime.enable'); return s; }

/** Fail fast instead of hanging when a page stops answering (an action may have moved the tab). */
function withTimeout(promise, ms, what) {
  return Promise.race([promise, sleep(ms).then(() => { throw new Error(`timed out: ${what}`); })]);
}

/** Walk the page including closed shadow roots; page scripts cannot read one, the DOM domain can. */
async function piercedRows(session, match) {
  await session.send('DOM.enable');
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
  const rows = [];
  const walk = node => {
    const attributes = node.attributes ?? [];
    const entry = {};
    for (let i = 0; i < attributes.length; i += 2) entry[attributes[i]] = attributes[i + 1];
    if (match) { if (match(entry)) rows.push({ nodeId: node.nodeId, ...entry }); }
    else if (entry['data-action']) rows.push({ nodeId: node.nodeId, id: entry['data-action'], active: entry['data-active'] });
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []), ...(node.pseudoElements ?? [])]) walk(child);
    if (node.contentDocument) walk(node.contentDocument);
  };
  walk(root);
  return rows;
}

/** Measure the in-page wheel through one of its slots: where its centre is, how many sectors it
 *  drew, and how much room the centre leaves against each edge. */
async function wheelBox(session) {
  const rows = await piercedRows(session);
  if (!rows.length) return { sectors: 0, missing: true };
  const { object } = await session.send('DOM.resolveNode', { nodeId: rows[0].nodeId });
  const { result } = await session.send('Runtime.callFunctionOn', {
    objectId: object.objectId, returnByValue: true,
    functionDeclaration: `function () {
      const wheel = this.closest('.wheel');
      const r = wheel.getBoundingClientRect();
      return { sectors: wheel.querySelectorAll('.sector').length,
        filled: wheel.querySelectorAll('[data-action]').length,
        centerX: Math.round(r.left + r.width / 2), centerY: Math.round(r.top + r.height / 2),
        radius: Math.round(r.width / 2), viewWidth: window.innerWidth, viewHeight: window.innerHeight };
    }`,
  });
  return result.value;
}

/** Where one action's badge sits on screen. Flicking at it is what a person does, and it needs no
 *  assumption about where the wheel centred itself. */
async function slotPointOf(session, actionId) {
  const row = (await piercedRows(session)).find(item => item.id === actionId);
  if (!row) throw new Error(`no wheel slot for ${actionId}`);
  const { object } = await session.send('DOM.resolveNode', { nodeId: row.nodeId });
  const { result } = await session.send('Runtime.callFunctionOn', {
    objectId: object.objectId, returnByValue: true,
    functionDeclaration: `function () {
      const r = this.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }`,
  });
  return result.value;
}

/** Click through real browser input, so React sees a trusted event just as a user would. */
async function clickAt(session, selector) {
  const point = await session.eval(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('clickAt: no element for ' + ${JSON.stringify(selector)});
    const r = element.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const base = { ...point, button: 'left', buttons: 1, clickCount: 1 };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 0 });
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
}

/** A freshly opened page can race extension registration or stop answering while three content
 *  scripts are injected into it; reload until it answers, the same way extension pages are handled. */
async function waitRendered(session, selector, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready = await session.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, { timeout: 2500 }).catch(() => false);
    if (ready) return;
    await session.send('Page.enable').catch(() => {});
    await session.send('Page.reload', { ignoreCache: true }).catch(() => {});
    await sleep(900);
  }
  throw new Error(`page never rendered ${selector}`);
}
// Fixture pages must finish loading before tab URLs are visible and scripts can be injected.
let sw;
async function waitLoaded(windowId, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const tabs = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.map(x => [x.status, x.url]))`);
    if (tabs.length && tabs.every(([status, url]) => status === 'complete' && url)) return;
    await sleep(200);
  }
  throw new Error('fixture tabs did not finish loading');
}

// ------------------------------------------------------------------ service worker
await fetch(`${CDP}/json/new?chrome-extension://${EXT}/popup.html`, { method: 'PUT' }).catch(() => {});
let swTarget;
try { swTarget = await waitTarget(t => t.type === 'service_worker' && t.url.includes(`${EXT}/src/background.js`)); }
catch { console.log('targets:', (await targets()).map(t => t.type + ' ' + t.url).join('\n')); await cleanup(); throw new Error('service worker target missing'); }
sw = await attach(swTarget);
console.log('service worker attached', swTarget.url);

const swScript = (body) => `(async () => { const WWW = ${JSON.stringify(WWW)}; const sleep = ms => new Promise(r => setTimeout(r, ms)); ${body} })()`;
// The popup is attached for its own layout assertions; messages go through the worker (see msg).
const popupTarget = await waitTarget(t => t.type === 'page' && t.url === `chrome-extension://${EXT}/popup.html`);
const popup = await attach(popupTarget);
await popup.send('Page.enable').catch(() => {});
await popup.send('Page.bringToFront').catch(() => {});
await popup.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
await sleep(800);
await waitRendered(popup, '.popup-wheel-stage .sector');
// Transitions do not advance reliably in a headless page; assert target values, not animation frames.
await popup.eval(`(() => {
  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.append(style);
})()`);
const msg = async (m) => {
  const r = await sw.eval(`globalThis.__hiraishinTest(${JSON.stringify(m)})`);
  if (!r.ok) throw new Error(r.error);
  return r;
};

try {
  const popupSettings = await msg({ type: 'get-settings' });
  const popupWindow = await sw.eval(`chrome.tabs.query({ url: chrome.runtime.getURL('popup.html') }).then(t => t[0])`);
  await msg({ type: 'save-settings', settings: { ...popupSettings.settings, pinnedActions: [],
    overlay: { ...popupSettings.settings.overlay, enabled: false,
      slots: ['copy-links', ...popupSettings.settings.overlay.slots.slice(1)] } } });
  await popup.send('Page.reload');
  await waitRendered(popup, '.popup-wheel-stage .sector');
  const popupInfo = await popup.eval(`({
    actions: document.querySelectorAll('.sector[role="menuitem"]').length,
    settings: Boolean(document.querySelector('[aria-label="打开设置"]'))
  })`);
  (popupInfo.actions === popupSettings.settings.overlay.slots.length && popupInfo.settings)
    ? pass('popup renders the configured wheel with web gestures disabled')
    : fail('popup wheel', JSON.stringify(popupInfo));
  const popupClick = selector => clickAt(popup, selector);
  await popupClick('.slot[data-action="copy-links"]');
  await sleep(500);
  const popupCopy = await popup.eval(`document.querySelector('.status')?.textContent ?? ''`);
  popupCopy.includes('已复制') ? pass('clicking a popup sector executes its action') : fail('popup click execution', popupCopy);
  const popupCandidates = await sw.eval(`Promise.all([1, 2].map(i => chrome.tabs.create({ windowId: ${popupWindow.windowId},
    url: '${WWW}/fixture.html?title=PopupClose' + i, active: false }))).then(t => t.map(x => x.id))`);
  const popupRemaining = () => sw.eval(`chrome.tabs.query({ windowId: ${popupWindow.windowId} })
    .then(t => t.filter(x => ${JSON.stringify(popupCandidates)}.includes(x.id)).length)`);
  await sw.eval(`chrome.tabs.update(${popupWindow.id}, { active: true })`);
  await popup.send('Page.reload');
  await waitRendered(popup, '.popup-wheel-stage .sector');
  const preparePopup = async () => {
    await popupClick('.slot[data-action="close-right"]');
    await waitRendered(popup, '.confirmation-card');
    for (let i = 0; i < 30 && await popup.eval(`document.querySelector('.confirmation-close')?.disabled`); i++) await sleep(100);
  };
  await preparePopup();
  const popupConfirmation = await popup.eval(`(() => {
    const r = document.querySelector('.confirmation-card').getBoundingClientRect();
    const s = document.querySelector('.popup-wheel-stage').getBoundingClientRect();
    return { text: document.querySelector('.confirmation-card').textContent,
      focused: document.activeElement.textContent,
      centred: Math.abs((r.left+r.right-s.left-s.right)/2)<1 && Math.abs((r.top+r.bottom-s.top-s.bottom)/2)<1 };
  })()`);
  (popupConfirmation.centred && popupConfirmation.focused === '取消'
    && popupConfirmation.text.includes('将关闭右侧 2 个标签页') && await popupRemaining() === 2)
    ? pass('popup dangerous action opens a centred confirmation without closing tabs')
    : fail('popup close preview', JSON.stringify(popupConfirmation));
  await popup.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await popup.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  (await popupRemaining() === 2 && !await popup.eval(`Boolean(document.querySelector('.confirmation-card'))`))
    ? pass('Escape cancels popup close confirmation') : fail('popup Escape confirmation');
  await preparePopup();
  await popupClick('.confirmation-close');
  await sleep(500);
  await popupRemaining() === 0 ? pass('popup closes tabs only after explicit confirmation') : fail('popup confirmed close');
  await msg({ type: 'save-settings', settings: popupSettings.settings });

  // The popup's own assertions end here. A real popup closes on blur; left open in a background
  // tab it wedges the extension renderer, and every other extension page shares that process.
  await sw.eval(`chrome.tabs.query({ url: chrome.runtime.getURL('popup.html') }).then(t => Promise.all(t.map(x => chrome.tabs.remove(x.id))))`);
  popup.close();

  // Window with A, B, C
  const setup = await sw.eval(swScript(`
    const win = await chrome.windows.create({ url: WWW + '/fixture.html?title=A', focused: true });
    const a = win.tabs[0].id;
    await sleep(300);
    const b = (await chrome.tabs.create({ windowId: win.id, url: WWW + '/fixture.html?title=B', active: true })).id; await sleep(300);
    const c = (await chrome.tabs.create({ windowId: win.id, url: WWW + '/fixture.html?title=C', active: true })).id; await sleep(600);
    return { windowId: win.id, a, b, c };`));
  const { windowId, a, b, c } = setup;
  await waitLoaded(windowId);
  const state = async () => (await msg({ type: 'get-state', windowId })).state;
  const ids = s => s.entries.map(e => e.tabId).join();
  let s = await state();
  ids(s) === [a, b, c].join() ? pass('history records A → B → C') : fail('history records A → B → C', ids(s));
  await Promise.all([-1, -1, 1].map(direction => msg({ type: 'navigate', direction, windowId })));
  await sleep(300); s = await state();
  (s.cursor === 1 && s.canBack && s.canForward && ids(s) === [a, b, c].join()) ? pass('rapid back/back/forward keeps trail, cursor on B') : fail('rapid navigation', JSON.stringify({ cursor: s.cursor, ids: ids(s) }));

  // Chrome may leave lastAccessed unchanged for API activations in an unfocused window.
  // Assert the browser's reported MRU, then establish A explicitly for the independent move tests.
  const priorTabs = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.filter(x => !x.active)
    .map(x => ({ id: x.id, accessed: x.lastAccessed ?? 0 })))`);
  const latestAccess = Math.max(...priorTabs.map(tab => tab.accessed));
  const expectedPrevious = priorTabs.filter(tab => tab.accessed === latestAccess).map(tab => tab.id);
  let r = await msg({ type: 'run-action', id: 'switch-previous-tab', windowId }); await sleep(300);
  const activeIn = async w => sw.eval(`chrome.tabs.query({ windowId: ${w}, active: true }).then(t => t[0].id)`);
  const orderIn = async w => sw.eval(`chrome.tabs.query({ windowId: ${w} }).then(t => t.sort((x,y)=>x.index-y.index).map(x => x.id))`);
  let active = await activeIn(windowId);
  expectedPrevious.includes(active) ? pass('switch-previous-tab activates the most recently used other tab (lastAccessed)') : fail('switch-previous-tab', JSON.stringify({ r, active, expectedPrevious }));
  await sw.eval(`chrome.tabs.update(${a}, { active: true })`); await sleep(200);

  // duplicate-tab (source A)
  r = await msg({ type: 'run-action', id: 'duplicate-tab', windowId }); await sleep(500);
  let order = await orderIn(windowId); active = await activeIn(windowId);
  const dup = order[1];
  (order.length === 4 && order[0] === a && active === dup && order[2] === b) ? pass('duplicate-tab puts an active copy right of the source') : fail('duplicate-tab', JSON.stringify({ order, active, a }));

  // moves
  r = await msg({ type: 'run-action', id: 'move-tab-left', windowId }); await sleep(200);
  order = await orderIn(windowId);
  order.join() === [dup, a, b, c].join() ? pass('move-tab-left swaps with the left neighbour') : fail('move-tab-left', order.join());
  // Group B+C and move B-and-right to a new window. Boundary cases live in tab-ops.test.js.
  await sw.eval(`(async () => { const g = await chrome.tabs.group({ tabIds: [${b}, ${c}] }); await chrome.tabGroups.update(g, { title: 'Research', color: 'blue' }); })()`);
  await sw.eval(`chrome.tabs.update(${b}, { active: true })`); await sleep(200);
  r = await msg({ type: 'run-action', id: 'move-with-right-to-new-window', windowId }); await sleep(800);
  const win2 = r.windowId;
  const moved = await sw.eval(`(async () => { const tabs = await chrome.tabs.query({ windowId: ${win2} }); tabs.sort((x,y)=>x.index-y.index); const groups = [...new Set(tabs.map(t=>t.groupId).filter(g=>g>=0))]; const info = await Promise.all(groups.map(g => chrome.tabGroups.get(g))); return { ids: tabs.map(t=>t.id), groupIds: tabs.map(t=>t.groupId), info: info.map(i => [i.title, i.color]), active: tabs.find(t=>t.active)?.id, left: (await chrome.tabs.query({ windowId: ${windowId} })).sort((x,y)=>x.index-y.index).map(t=>t.id) }; })()`);
  (r.status === 'ok' && moved.ids.join() === [b, c].join() && moved.info.length === 1 && moved.info[0][0] === 'Research' && moved.groupIds[0] === moved.groupIds[1] && moved.groupIds[0] >= 0 && moved.active === b && moved.left.join() === [dup, a].join())
    ? pass('move-with-right-to-new-window keeps order, rebuilds the group and activates the source')
    : fail('move-with-right-to-new-window', JSON.stringify({ r, moved }));

  // close-right in the new window: [b, c, d] with b active and pinned a copy? keep simple: pin nothing
  const d = await sw.eval(`chrome.tabs.create({ windowId: ${win2}, url: '${WWW}/fixture.html?title=D', active: false }).then(t => t.id)`); await waitLoaded(win2);
  await sw.eval(`chrome.tabs.update(${b}, { active: true })`); await sleep(150);
  r = await msg({ type: 'run-action', id: 'close-right', windowId: win2 }); await sleep(300);
  const remaining = await orderIn(win2);
  (r.status === 'ok' && remaining.join() === String(b)) ? pass(`close-right closes tabs right of the anchor (${r.message})`) : fail('close-right', JSON.stringify({ r, remaining, d }));

  // copy links via offscreen
  r = await msg({ type: 'run-action', id: 'copy-links-markdown', windowId: win2 }).catch(e => ({ error: e.message }));
  r.status === 'ok' ? pass(`copy-links via offscreen document (${r.message})`) : fail('copy-links offscreen (may be a headless clipboard limitation)', JSON.stringify(r));

  // ---------------- custom target transfer (generic adapter), in the original window ----------------
  const fixtureTargets = [
    { id: 'fixture', name: 'Fixture Chat', openUrl: WWW + '/chat.html', match: [WWW + '/chat.html*'], capability: 'send', selectors: { input: '#prompt', submit: '#send' } },
    { id: 'fixture-fill', name: 'Fixture Fill', openUrl: WWW + '/chat.html', match: [WWW + '/chat.html*'], capability: 'fill', selectors: { input: '#prompt', submit: '' } },
  ];
  const settingsView = await msg({ type: 'save-settings', settings: { version: 2, returnAfterSend: false, defaultTargetId: 'fixture', targets: { custom: fixtureTargets } } });
  const fixtureTab = dup; // a duplicate of A: h1 reads "A"
  const select = async (tabId, selector) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sw.eval(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => { window.getSelection().selectAllChildren(document.querySelector(${JSON.stringify(selector)})); } })`);
      } catch (error) {
        if (attempt >= 4) throw error;
        await sleep(200);
      }
    }
  };
  // A duplicated tab can still be a lazy restored document; establish a committed fixture origin.
  await sw.eval(`chrome.tabs.update(${fixtureTab}, { url: '${WWW}/fixture.html?title=A', active: true })`);
  await waitLoaded(windowId);
  await select(fixtureTab, '#text');
  r = await msg({ type: 'run-action', id: 'target:send-fixture', windowId }); await sleep(500);
  const chat = await sw.eval(`(async () => { const tabs = await chrome.tabs.query({ windowId: ${windowId} }); tabs.sort((x,y)=>x.index-y.index); const t = tabs.find(x => x.url.includes('chat.html')); const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => ({ msgs: [...document.querySelectorAll('.msg')].map(m => m.textContent), prompt: document.getElementById('prompt').value }) }); return { tabId: t.id, index: t.index, fixtureIndex: tabs.find(x => x.id === ${fixtureTab}).index, active: tabs.find(x => x.active).id, ...result }; })()`);
  (r.status === 'sent' && chat.msgs.length === 1 && chat.msgs[0].includes('第一行内容\n第二行内容') && chat.index === chat.fixtureIndex + 1 && chat.active === chat.tabId)
    ? pass('send: new target right of source, selection keeps line breaks, stays on target')
    : fail('send to custom target', JSON.stringify({ r, chat }));
  const chatTab = chat.tabId;
  const promptOf = async () => sw.eval(`chrome.scripting.executeScript({ target: { tabId: ${chatTab} }, func: () => document.getElementById('prompt').value }).then(x => x[0].result)`);
  const setPrompt = async value => sw.eval(`chrome.scripting.executeScript({ target: { tabId: ${chatTab} }, func: v => { document.getElementById('prompt').value = v; }, args: [${JSON.stringify(value)}] })`);

  await setPrompt('my draft');
  await sw.eval(`chrome.tabs.update(${fixtureTab}, { active: true })`); await sleep(200);
  await select(fixtureTab, 'h1');
  r = await msg({ type: 'run-action', id: 'target:fill-fixture-fill', windowId }); await sleep(300);
  let promptValue = await promptOf();
  (r.status === 'filled' && promptValue === 'my draft\n\nA') ? pass('fill appends to an existing draft with a blank line') : fail('fill append', JSON.stringify({ r, promptValue }));
  await sw.eval(`chrome.tabs.update(${fixtureTab}, { active: true })`); await sleep(200);
  await select(fixtureTab, 'h1');
  r = await msg({ type: 'run-action', id: 'target:send-fixture', windowId }); await sleep(300);
  const tasks = (await msg({ type: 'list-tasks' })).tasks;
  (r.status === 'draft' && tasks.length === 1 && tasks[0].text === 'A') ? pass('send with a non-empty draft stops, keeps the draft and retains the selection as a task') : fail('draft handling', JSON.stringify({ r, tasks }));

  await msg({ type: 'save-settings', settings: { ...settingsView.settings, returnAfterSend: true } });
  await setPrompt('');
  await sw.eval(`chrome.tabs.update(${fixtureTab}, { active: true })`); await sleep(200);
  await select(fixtureTab, 'h1');
  r = await msg({ type: 'run-action', id: 'target:send-fixture', windowId }); await sleep(500);
  active = await activeIn(windowId);
  s = (await msg({ type: 'get-state', windowId })).state;
  const tail = s.entries.slice(-3).map(e => e.tabId).join();
  (r.status === 'sent' && r.returned === true && active === fixtureTab && tail === [fixtureTab, chatTab, fixtureTab].join())
    ? pass('return-after-send comes back to the source; history shows A → chat → A')
    : fail('return after send', JSON.stringify({ r, active, fixtureTab, entries: s.entries.map(e => e.tabId) }));

  r = await msg({ type: 'retry-task', taskId: tasks[0].id, windowId }); await sleep(300);
  promptValue = await promptOf();
  const pending = (await msg({ type: 'list-tasks' })).tasks;
  (r.status === 'filled' && promptValue === 'A' && pending.length === 0)
    ? pass('retry fills the saved selection and removes its pending task')
    : fail('retry task', JSON.stringify({ r, promptValue, pending }));

  // ---------------- in-page wheel (hold Option/Alt, flick, release) ----------------
  await msg({ type: 'save-settings', settings: { ...settingsView.settings, overlay: { enabled: true, holdCode: 'auto', holdMs: 0 } } });
  await sleep(700);
  const overlayTab = await sw.eval(`chrome.tabs.create({ windowId: ${windowId}, url: '${WWW}/fixture.html?title=Overlay', active: true }).then(t => t.id)`);
  await waitLoaded(windowId);
  const overlayTarget = await waitTarget(t => t.type === 'page' && t.url.includes('title=Overlay'));
  const overlayPage = await attach(overlayTarget);
  await overlayPage.send('Page.enable').catch(() => {});
  await overlayPage.send('Page.bringToFront').catch(() => {});
  await sleep(600);

  // The default gesture key is Option on macOS, Alt elsewhere. Chrome derives
  // event.metaKey / event.altKey from the modifiers bitmask, so it has to be set on the press.
  const mac = settingsView.status.platform === 'mac';
  await overlayPage.eval(`(() => {
    window.__inputTrace = [];
    for (const type of ['focus', 'blur', 'visibilitychange', 'keydown', 'keyup', 'mousemove', 'mousedown']) {
      window.addEventListener(type, event => {
        window.__inputTrace.push({ at: Math.round(performance.now()), type, key: event.key, code: event.code,
          alt: event.altKey, x: event.clientX, y: event.clientY, trusted: event.isTrusted,
          focused: document.hasFocus(), visible: document.visibilityState });
        if (window.__inputTrace.length > 150) window.__inputTrace.shift();
      }, true);
    }
  })()`);
  overlayInputTrace = () => overlayPage.eval('window.__inputTrace');
  const hold = { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 };
  let pointerModifiers = 0;
  const holdKey = async (type) => {
    pointerModifiers = type === 'keyDown' ? hold.modifiers : 0;
    return overlayPage.send('Input.dispatchKeyEvent', {
      type, key: hold.key, code: hold.code, windowsVirtualKeyCode: hold.windowsVirtualKeyCode,
      modifiers: pointerModifiers,
    });
  };
  // Real input events, the same ones a user produces. Building a MouseEvent inside an evaluate
  // wedges this headless renderer, and a synthetic event would not exercise the real path anyway.
  const movePointer = (x, y) => overlayPage.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, modifiers: pointerModifiers });
  const clickPointer = (x, y, button) => overlayPage.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x, y, button: button === 2 ? 'right' : 'left', buttons: button === 2 ? 2 : 1, clickCount: 1 });

  // Registering a dynamic content script and having it reach an open tab is asynchronous, so the
  // gesture is retried a few times before it counts as a failure.
  const readHost = () => overlayPage.eval(`(() => {
    const host = document.querySelector('[data-hiraishin-overlay]');
    return { present: Boolean(host), shown: host && host.style.display, closedShadow: host ? host.shadowRoot === null : null,
      hosts: document.querySelectorAll('[data-hiraishin-overlay]').length };
  })()`);
  const view = await overlayPage.eval('({ w: window.innerWidth, h: window.innerHeight })');
  const openSpace = { x: Math.round(view.w / 2), y: Math.round(view.h / 2) };
  /** Escape closes an open wheel without running whatever is under the pointer. */
  const pressEscape = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await overlayPage.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
  };

  /** Hold, then flick: holding alone is deliberately inert, so the reveal needs both. `to` is
   *  where the flick ends, which is also what picks a sector. Every attempt starts from a known
   *  state — nothing open, key released — because the whole gesture hinges on that. */
  const summon = async (at, to = { x: at.x + 10, y: at.y }) => {
    let host = { shown: 'none' };
    for (let attempt = 0; attempt < 3 && host.shown !== 'block'; attempt++) {
      await pressEscape();
      await holdKey('keyUp');
      await sleep(250);
      // Let the pointer move finish before the key: dispatching both in the same instant wedges
      // a headless renderer, and no real user produces them without a gap either.
      await movePointer(at.x, at.y);
      await sleep(250);
      await holdKey('keyDown');
      await sleep(400);
      await movePointer(to.x, to.y);
      await sleep(300);
      host = await readHost();
    }
    return host;
  };
  const summoned = await summon(openSpace);
  // Exactly one host: the script is injected on page load and again on every settings sync.
  (summoned.present && summoned.shown === 'block' && summoned.closedShadow && summoned.hosts === 1)
    ? pass('holding the key summons one in-page wheel inside a closed shadow root')
    : fail('overlay summon', JSON.stringify(summoned));

  // SHOT_OVERLAY=<path> captures the summoned wheel in a real page, for eyeballing the visuals.
  if (process.env.SHOT_OVERLAY) {
    // Flick on to a sector first: the wheel is worth looking at in its selected state.
    const shotAt = await withTimeout(slotPointOf(overlayPage, 'switch-previous-tab'), 5000, 'find a badge for the shot');
    await movePointer(shotAt.x, shotAt.y);
    await sleep(300);
    // A screencast frame rather than Page.captureScreenshot: the latter waits on this window's
    // compositor surface and never answers unless the window is frontmost, which it is not while
    // another one has focus. A diagnostic aid either way, so a failure here never fails the suite.
    await overlayPage.send('Page.bringToFront').catch(() => {});
    const shot = await withTimeout((async () => {
      const seen = overlayPage.events.length;
      await overlayPage.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      for (let i = 0; i < 60; i++) {
        const frame = overlayPage.events.slice(seen).find(event => event.method === 'Page.screencastFrame');
        if (frame) { await overlayPage.send('Page.stopScreencast').catch(() => {}); return frame.params.data; }
        await sleep(100);
      }
      await overlayPage.send('Page.stopScreencast').catch(() => {});
      return null;
    })(), 20000, 'screencast a frame').catch(error => {
      console.log('overlay screenshot skipped —', error.message);
      return null;
    });
    if (shot) {
      await writeFile(process.env.SHOT_OVERLAY, Buffer.from(shot, 'base64'));
      console.log('overlay screenshot →', process.env.SHOT_OVERLAY);
    }
    // Back to the middle, so the steps after this one start from the same state with or without
    // a screenshot: a release with a sector selected would run it.
    await movePointer(openSpace.x, openSpace.y);
    await sleep(250);
  }

  // One sector per configured slot, drawn around the pointer.
  const slots = settingsView.settings.overlay.slots;
  const wheel = await withTimeout(wheelBox(overlayPage), 5000, 'measure the wheel');
  (wheel.sectors === slots.length && wheel.filled === slots.filter(Boolean).length
    && Math.abs(wheel.centerX - openSpace.x) <= 2 && Math.abs(wheel.centerY - openSpace.y) <= 2)
    ? pass(`the wheel opens around the pointer with ${wheel.sectors} sectors`)
    : fail('overlay wheel', JSON.stringify({ wheel, slots, openSpace }));

  // Holding the key without touching the mouse must show nothing at all: that is what keeps the
  // gesture out of the way of ⌘-key shortcuts. Escape first, so the open wheel closes without
  // running whatever happens to be under the pointer.
  await pressEscape();
  await sleep(200);
  await holdKey('keyUp');
  await sleep(500);
  await holdKey('keyDown');
  await sleep(700);
  const stillHidden = await readHost();
  (stillHidden.shown === 'none')
    ? pass('holding the key without moving the mouse shows nothing')
    : fail('overlay idle hold', JSON.stringify(stillHidden));
  await holdKey('keyUp');
  await sleep(400);

  if (mac) {
    await overlayPage.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifiers: 4,
    });
    await movePointer(openSpace.x + 80, openSpace.y + 80);
    await sleep(300);
    const withCommand = await readHost();
    await overlayPage.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91, modifiers: 0,
    });
    withCommand.shown === 'none'
      ? pass('holding Command while moving the mouse does not trigger the default Option wheel')
      : fail('Command conflicts with the default wheel key', JSON.stringify(withCommand));
  }

  // A flick that never leaves the middle selects nothing, so releasing there must be a no-op.
  const tabsBefore = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.length)`);
  await summon(openSpace, { x: openSpace.x + 12, y: openSpace.y + 8 });
  const inDeadZone = (await withTimeout(piercedRows(overlayPage), 5000, 'read dead zone')).filter(row => row.active === 'true');
  await holdKey('keyUp');
  await sleep(800);
  const tabsAfterDeadZone = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.length)`);
  (inDeadZone.length === 0 && tabsAfterDeadZone === tabsBefore)
    ? pass('a flick that stays in the dead zone selects nothing and runs nothing')
    : fail('overlay dead zone', JSON.stringify({ inDeadZone, tabsBefore, tabsAfterDeadZone }));

  // Flick towards one sector, then release: that action, and only that one, must run.
  const wanted = slots.indexOf('duplicate-tab');
  // Reveal first, then aim at the badge this wheel actually drew: computing a target from where
  // the test believes the pointer was would make the assertion depend on input timing.
  const reopened = await summon(openSpace);
  if (reopened.shown !== 'block') fail('overlay re-summon', JSON.stringify(reopened));
  const aim = await withTimeout(slotPointOf(overlayPage, 'duplicate-tab'), 5000, 'find the duplicate badge');
  await movePointer(aim.x, aim.y);
  await sleep(300);
  const highlighted = (await withTimeout(piercedRows(overlayPage), 5000, 'read highlight')).filter(row => row.active === 'true');
  (highlighted.length === 1 && highlighted[0].id === 'duplicate-tab')
    ? pass('flicking towards a sector highlights that one action')
    : fail('overlay flick', JSON.stringify({ highlighted, wanted, aim }));
  await holdKey('keyUp');
  await sleep(900);
  const tabsAfter = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.length)`);
  const closed = await withTimeout(overlayPage.eval(`document.querySelector('[data-hiraishin-overlay]').style.display`), 5000, 'read overlay state')
    .catch(() => 'unreadable');
  (tabsAfter === tabsBefore + 1 && closed === 'none')
    ? pass('releasing the key runs the action the flick selected and closes the wheel')
    : fail('overlay release', JSON.stringify({ tabsBefore, tabsAfter, closed }));
  // Put the window back the way it was before the next steps.
  await sw.eval(`(async () => { const tabs = await chrome.tabs.query({ windowId: ${windowId} });
    const extra = tabs.filter(t => t.url.includes('title=Overlay'));
    if (extra.length > 1) await chrome.tabs.remove(extra[extra.length - 1].id);
    await chrome.tabs.update(${overlayTab}, { active: true }); })()`);
  await overlayPage.send('Page.bringToFront').catch(() => {});
  await sleep(400);

  // A destructive wheel gesture only opens a confirmation. Exercise both release and click,
  // then Escape, outside-click and tab-switch cancellation before explicitly approving it.
  const closeTargets = await sw.eval(`Promise.all([1, 2].map(i => chrome.tabs.create({ windowId: ${windowId},
    url: '${WWW}/fixture.html?title=CloseCandidate' + i, active: false }))).then(tabs => tabs.map(t => t.id))`);
  const remainingCloseTargets = () => sw.eval(`chrome.tabs.query({ windowId: ${windowId} })
    .then(tabs => tabs.filter(t => ${JSON.stringify(closeTargets)}.includes(t.id)).length)`);
  const confirmationBox = async () => {
    const [node] = await piercedRows(overlayPage, attrs => 'data-confirm-card' in attrs);
    if (!node) return null;
    const { object } = await overlayPage.send('DOM.resolveNode', { nodeId: node.nodeId });
    const { result } = await overlayPage.send('Runtime.callFunctionOn', {
      objectId: object.objectId, returnByValue: true,
      functionDeclaration: `function () {
        const button = this.querySelector('.confirmation-close');
        const rect = button.getBoundingClientRect();
        const card = this.getBoundingClientRect();
        return { text: this.textContent, disabled: button.disabled,
          bounds: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          focused: this.getRootNode().activeElement?.textContent,
          x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
          left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }`,
    });
    return result.value;
  };
  const fullClick = async (x, y) => {
    await movePointer(x, y);
    await clickPointer(x, y, 0);
    await overlayPage.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const prepareWheelClose = async (byClick = false) => {
    await summon(openSpace);
    const wheel = await wheelBox(overlayPage);
    const point = await slotPointOf(overlayPage, 'close-right');
    await movePointer(point.x, point.y);
    if (byClick) await fullClick(point.x, point.y);
    await holdKey('keyUp');
    let card;
    for (let i = 0; i < 20; i++) {
      card = await confirmationBox();
      if (card && !card.disabled) break;
      await sleep(100);
    }
    return { card, point, center: { x: wheel.centerX, y: wheel.centerY } };
  };
  let approval = await prepareWheelClose();
  if (approval.card) {
    const { bounds, viewport } = approval.card;
    const dx = Math.abs((bounds.left + bounds.right) / 2 - approval.center.x);
    const dy = Math.abs((bounds.top + bounds.bottom) / 2 - approval.center.y);
    (dx < 1 && dy < 1
      && bounds.left >= 16 && bounds.top >= 16
      && bounds.right <= viewport.width - 16 && bounds.bottom <= viewport.height - 16)
      ? pass('close confirmation shares the wheel centre and stays inside the viewport')
      : fail('close confirmation placement', JSON.stringify(approval));
  }
  (approval.card?.text.includes('将关闭右侧 2 个标签页') && approval.card.focused === '取消'
    && await remainingCloseTargets() === 2
    && !(approval.point.x >= approval.card.left && approval.point.x <= approval.card.right
      && approval.point.y >= approval.card.top && approval.point.y <= approval.card.bottom))
    ? pass('destructive release shows the count, focuses Cancel, and keeps Confirm away from the pointer')
    : fail('overlay close confirmation', JSON.stringify(approval));
  await pressEscape();
  ((await readHost()).shown === 'none' && await remainingCloseTargets() === 2)
    ? pass('Escape cancels a pending close without removing tabs') : fail('close Escape cancellation');

  approval = await prepareWheelClose(true);
  (approval.card && await remainingCloseTargets() === 2)
    ? pass('the click and key release opening confirmation cannot also approve it') : fail('close click-through protection');
  await fullClick(8, 8);
  ((await readHost()).shown === 'none' && await remainingCloseTargets() === 2)
    ? pass('clicking outside the confirmation cancels without removing tabs') : fail('close outside cancellation');

  await prepareWheelClose();
  await sw.eval(`chrome.tabs.update(${closeTargets[0]}, { active: true })`);
  await sleep(200);
  await sw.eval(`chrome.tabs.update(${overlayTab}, { active: true })`);
  await overlayPage.send('Page.bringToFront');
  ((await readHost()).shown === 'none' && await remainingCloseTargets() === 2)
    ? pass('switching tabs dismisses pending close confirmation') : fail('close blur cancellation');

  approval = await prepareWheelClose();
  if (process.env.SHOT_CONFIRM && approval.card) {
    const shot = await overlayPage.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.SHOT_CONFIRM, Buffer.from(shot.data, 'base64'));
  }
  if (!approval.card) throw new Error('missing close confirmation');
  await fullClick(approval.card.x, approval.card.y);
  await sleep(500);
  const afterApproval = { host: await readHost(), remaining: await remainingCloseTargets(), card: await confirmationBox() };
  (afterApproval.host.shown === 'none' && afterApproval.remaining === 0)
    ? pass('only an explicit confirmation closes the previewed tabs') : fail('close explicit confirmation', JSON.stringify(afterApproval));

  // Summoned in a corner, the centre moves inwards so a flick in any direction still has room.
  await summon({ x: 4, y: 4 });
  const corner = await withTimeout(wheelBox(overlayPage), 5000, 'measure the corner wheel');
  (corner.centerX >= corner.radius && corner.centerY >= corner.radius
    && corner.centerX <= corner.viewWidth - corner.radius && corner.centerY <= corner.viewHeight - corner.radius)
    ? pass('summoned at the very corner, the wheel keeps a full radius of room on every side')
    : fail('overlay clamp', JSON.stringify(corner));
  await clickPointer(150, 170, 2);
  await sleep(300);
  await holdKey('keyUp');
  await sleep(300);
  const afterCancel = await withTimeout(overlayPage.eval(`document.querySelector('[data-hiraishin-overlay]').style.display`), 5000, 'read cancel state');
  afterCancel === 'none' ? pass('right-click cancels the panel') : fail('overlay cancel', afterCancel);

  // A freshly opened page has never seen the mouse, so the position is unknown when the key goes
  // down. The wheel must open where the movement began, not at (0, 0) pushed into the top-left.
  const freshWheelTab = await sw.eval(`chrome.tabs.create({ windowId: ${windowId}, url: '${WWW}/fixture.html?title=FreshWheel', active: true }).then(t => t.id)`);
  const freshWheel = await attach(await waitTarget(t => t.type === 'page' && t.url.includes('title=FreshWheel')));
  await freshWheel.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (let i = 0; i < 40 && !(await freshWheel.eval(`Boolean(document.querySelector('[data-hiraishin-overlay]')) || document.readyState === 'complete'`)); i++) await sleep(100);
  await sleep(300);
  const freshKey = type => freshWheel.send('Input.dispatchKeyEvent', { type, key: hold.key, code: hold.code,
    windowsVirtualKeyCode: hold.windowsVirtualKeyCode, modifiers: type === 'keyDown' ? hold.modifiers : 0 });
  const freshMove = (x, y) => freshWheel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, modifiers: hold.modifiers });
  await freshKey('keyDown');
  await freshMove(openSpace.x, openSpace.y);
  await sleep(60);
  await freshMove(openSpace.x + 12, openSpace.y + 2);
  await sleep(400);
  const freshBox = await withTimeout(wheelBox(freshWheel), 5000, 'measure the fresh-page wheel');
  await freshWheel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: hold.modifiers });
  await freshKey('keyUp');
  (Math.abs(freshBox.centerX - openSpace.x) <= 3 && Math.abs(freshBox.centerY - openSpace.y) <= 3)
    ? pass('on a page the mouse has not moved over yet, the wheel opens where the flick began')
    : fail('fresh-page wheel origin', JSON.stringify({ freshBox, expected: openSpace }));
  // Close it through the protocol: awaiting chrome.tabs.remove from the worker hangs here.
  await freshWheel.send('Page.close', {}, 5000).catch(() => {});
  freshWheel.close();
  void freshWheelTab;
  await sw.eval(`chrome.tabs.update(${overlayTab}, { active: true })`);
  await overlayPage.send('Page.bringToFront');
  await sleep(300);

  // Modifier gestures work in editors, but holding without moving remains inert. Add the other
  // editing surfaces here so the shared fixture stays unchanged for the rest of the suite.
  // The blur/visibility cancellation checks above use real focus. Keep this editor-only section
  // focused, like the popup checks, so switching desktop apps cannot cancel a test gesture.
  await overlayPage.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await overlayPage.eval(`(() => {
    const textarea = document.createElement('textarea');
    textarea.id = 'wheel-textarea';
    const editable = document.createElement('div');
    editable.id = 'wheel-editable';
    editable.contentEditable = 'true';
    editable.textContent = 'Editable text';
    document.body.append(textarea, editable);
  })()`);
  const editors = ['input', '#wheel-textarea', '#wheel-editable'];
  for (const selector of editors) {
    await overlayPage.eval(`document.querySelector(${JSON.stringify(selector)}).focus({ preventScroll: true })`);
    await movePointer(openSpace.x, openSpace.y);
    // As in summon(), let the mouse event reach the page before capturing the gesture origin.
    await sleep(250);
    await holdKey('keyDown');
    await sleep(400);
    const held = await readHost();
    await movePointer(openSpace.x + 12, openSpace.y + 8);
    await sleep(400);
    const moved = await readHost();
    await pressEscape();
    await holdKey('keyUp');
    (held.shown === 'none' && moved.shown === 'block')
      ? pass(`Option/Alt opens the wheel in ${selector} only after moving the mouse`)
      : fail('modifier gesture in editor', JSON.stringify({ selector, held, moved }));
  }

  const pressOtherKey = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await overlayPage.send('Input.dispatchKeyEvent', {
        type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: hold.modifiers,
      });
    }
  };
  await overlayPage.eval(`document.querySelector('input').focus({ preventScroll: true })`);
  await movePointer(openSpace.x, openSpace.y);
  await sleep(250);
  await holdKey('keyDown');
  await pressOtherKey();
  await movePointer(openSpace.x + 80, openSpace.y + 80);
  await sleep(300);
  const comboBeforeOpen = await readHost();
  await pressEscape();
  await holdKey('keyUp');
  comboBeforeOpen.shown === 'none'
    ? pass('typing another key in an editor disarms the modifier gesture before it opens')
    : fail('editor shortcut disarms gesture', JSON.stringify(comboBeforeOpen));

  const tabsBeforeEditorCancel = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.length)`);
  await summon(openSpace);
  const editorDuplicate = await slotPointOf(overlayPage, 'duplicate-tab');
  await movePointer(editorDuplicate.x, editorDuplicate.y);
  const editorSelection = (await piercedRows(overlayPage)).filter(row => row.active === 'true');
  await pressOtherKey();
  const comboAfterOpen = await readHost();
  // Check cancellation before Escape, then clean up safely even if that assertion will fail.
  await pressEscape();
  await holdKey('keyUp');
  await sleep(400);
  const tabsAfterEditorCancel = await sw.eval(`chrome.tabs.query({ windowId: ${windowId} }).then(t => t.length)`);
  (editorSelection.length === 1 && editorSelection[0].id === 'duplicate-tab'
    && comboAfterOpen.shown === 'none' && tabsAfterEditorCancel === tabsBeforeEditorCancel)
    ? pass('typing another key closes an editor wheel without executing its selected action')
    : fail('editor shortcut cancels open wheel', JSON.stringify({ editorSelection, comboAfterOpen,
      tabsBeforeEditorCancel, tabsAfterEditorCancel }));

  // One printable trigger covers native typing in each editing surface and opening outside it.
  const trigger = { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 };
  await msg({ type: 'save-settings', settings: { ...settingsView.settings,
    overlay: { enabled: true, holdCode: trigger.code, holdMs: 0 } } });
  await sleep(700);
  const triggerKey = type => overlayPage.send('Input.dispatchKeyEvent', {
    type, ...trigger, modifiers: 0, ...(type === 'keyDown' ? { text: trigger.key, unmodifiedText: trigger.key } : {}),
  });
  for (const selector of editors) {
    await overlayPage.eval(`(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
      if (editor.isContentEditable) editor.textContent = ''; else editor.value = '';
      editor.focus({ preventScroll: true });
    })()`);
    await movePointer(openSpace.x, openSpace.y);
    await sleep(250);
    await triggerKey('keyDown');
    await sleep(250);
    await movePointer(openSpace.x + 80, openSpace.y + 80);
    await sleep(300);
    const host = await readHost();
    const typed = await overlayPage.eval(`(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
      return editor.isContentEditable ? editor.textContent : editor.value;
    })()`);
    await pressEscape();
    await triggerKey('keyUp');
    (host.shown === 'none' && typed === trigger.key)
      ? pass(`${trigger.code} types normally in ${selector} without opening the wheel`)
      : fail('printable trigger in editor', JSON.stringify({ selector, trigger, host, typed }));
  }
  await overlayPage.eval(`document.activeElement.blur()`);
  await movePointer(openSpace.x, openSpace.y);
  await sleep(250);
  await triggerKey('keyDown');
  await sleep(250);
  await movePointer(openSpace.x + 12, openSpace.y + 8);
  await sleep(400);
  const outsideEditor = await readHost();
  await pressEscape();
  await triggerKey('keyUp');
  outsideEditor.shown === 'block'
    ? pass(`${trigger.code} still opens the wheel outside an editor`)
    : fail('printable gesture outside editor', JSON.stringify({ trigger, outsideEditor }));
  await overlayPage.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  // Preserve diagnostics before detaching; reading a closed CDP session would time out.
  const inputTrace = await overlayInputTrace().catch(error => ({ error: String(error) }));
  overlayInputTrace = async () => inputTrace;
  overlayPage.close();
  await msg({ type: 'save-settings', settings: { ...settingsView.settings, overlay: { enabled: false, holdCode: 'auto', holdMs: 0 } } });

  // ---------------- web shortcuts end to end ----------------
  // The recorder produces the device-specific combo: the physical Control key is "MacCtrl" on macOS.
  const os = await sw.eval(`chrome.runtime.getPlatformInfo().then(i => i.os)`);
  const combo = os === 'mac' ? 'MacCtrl+Minus' : 'Ctrl+Minus';
  await msg({ type: 'set-web-binding', actionId: 'history-back', combo });
  await sw.eval(`chrome.tabs.update(${fixtureTab}, { active: true })`); await sleep(400);
  // Fresh page to make sure the registered script runs; dispatch a trusted Ctrl+- there.
  const freshTab = await sw.eval(`chrome.tabs.create({ windowId: ${windowId}, url: '${WWW}/fixture.html?title=Fresh', active: true }).then(t => t.id)`);
  await waitLoaded(windowId).catch(() => {});
  const freshTarget = await waitTarget(t => t.type === 'page' && t.url.includes('title=Fresh'));
  await sleep(500);
  const fresh = await attach(freshTarget);
  await fresh.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: '-', code: 'Minus', windowsVirtualKeyCode: 189 });
  await fresh.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: '-', code: 'Minus', windowsVirtualKeyCode: 189 });
  await sleep(600);
  active = await activeIn(windowId);
  active === fixtureTab ? pass('trusted Ctrl+- in the page navigates history back through the web shortcut') : fail('web shortcut keypress', JSON.stringify({ active, expected: fixtureTab, freshTab }));
  fresh.close();

  // ---------------- options page ----------------
  const optionsTab = await sw.eval(`chrome.tabs.create({ windowId: ${windowId}, url: chrome.runtime.getURL('options.html'), active: true }).then(t => t.id)`);
  await sleep(1200);
  const optTarget = await waitTarget(t => t.type === 'page' && t.url === `chrome-extension://${EXT}/options.html`);
  const opt = await attach(optTarget);
  await opt.send('Page.bringToFront').catch(() => {});
  await sleep(500);
  const optInfo = await opt.eval(`(() => {
    const table = document.querySelector('.shortcut-table');
    const rows = [...table.querySelectorAll('tbody tr:not(.group-row)')];
    return {
      rows: rows.length,
      webKbd: table.querySelector('tr[data-action-id="history-back"] td:last-child .kbd-button')?.textContent,
      // Keep the known table regression: flex th/td breaks colSpan and row alignment.
      fullSpan: [...table.querySelectorAll('.group-row th')].every(cell =>
        cell.getBoundingClientRect().width >= table.getBoundingClientRect().width * 0.95),
      aligned: rows.every(row => new Set([...row.children].map(cell =>
        Math.round(cell.getBoundingClientRect().bottom))).size === 1)
    };
  })()`);
  (optInfo.rows >= 20 && optInfo.fullSpan && optInfo.aligned
    && optInfo.webKbd === (os === 'mac' ? '⌃-' : 'Ctrl+-'))
    ? pass('options renders the saved web binding in an intact action table')
    : fail('options action table', JSON.stringify(optInfo));

  // Targets and send behaviour live in a dialog opened from the AI group row.
  const dialogInfo = await opt.eval(`(async () => {
    const trigger = document.querySelector('.group-row .group-action');
    if (!trigger) return { missing: true };
    trigger.click();
    await new Promise(r => setTimeout(r, 200));
    const dialog = document.querySelector('dialog[open]');
    const info = { open: Boolean(dialog), cards: dialog ? dialog.querySelectorAll('.target-card').length : 0,
      toggles: dialog ? dialog.querySelectorAll('.toggle input').length : 0,
      hasDefaultSelect: dialog ? dialog.querySelectorAll('select').length > 0 : false };
    dialog?.close();
    await new Promise(r => setTimeout(r, 150));
    return { ...info, closed: document.querySelectorAll('dialog[open]').length === 0 };
  })()`);
  (dialogInfo.open && dialogInfo.cards === 4 && dialogInfo.toggles === 1 && dialogInfo.hasDefaultSelect && dialogInfo.closed)
    ? pass(`the AI group row opens a dialog with ${dialogInfo.cards} targets and ${dialogInfo.toggles} behaviour toggles`)
    : fail('targets dialog', JSON.stringify(dialogInfo));
  const failedSave = await opt.eval(`(async () => {
    document.querySelector('.group-row .group-action').click();
    await new Promise(r => setTimeout(r, 150));
    const dialog = document.querySelector('dialog[open]');
    [...dialog.querySelectorAll('button')].find(button => button.textContent === '编辑').click();
    await new Promise(r => setTimeout(r, 150));
    const form = dialog.querySelector('form');
    const before = [...form.querySelectorAll('input, textarea')].map(input => input.value);
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = function(message, ...rest) {
      return message.type === 'save-settings' ? Promise.resolve({ ok: false, error: 'Simulated storage failure' }) : original.call(this, message, ...rest);
    };
    let result;
    try {
      form.requestSubmit();
      await new Promise(r => setTimeout(r, 200));
      result = { before, after: [...form.querySelectorAll('input, textarea')].map(input => input.value),
        error: dialog.querySelector('.form-error')?.textContent,
        open: dialog.querySelector('details.advanced').open,
        enabled: !form.querySelector('button[type=submit]').disabled };
    } finally { chrome.runtime.sendMessage = original; dialog.close(); }
    return result;
  })()`);
  (failedSave.open && failedSave.enabled && failedSave.error?.includes('内容已保留')
    && JSON.stringify(failedSave.before) === JSON.stringify(failedSave.after))
    ? pass('failed custom-target saves keep all form input and allow retry')
    : fail('failed target save recovery', JSON.stringify(failedSave));
  // The settings page renders the wheel component itself, not a drawing of it, and picking a
  // sector goes through the same sectorAt the gesture uses.
  const editor = await opt.eval(`(async () => {
    const toggle = document.querySelector('.overlay-toggle input');
    toggle.click();
    for (let i = 0; i < 30 && !document.querySelector('.wheel-stage'); i++) await new Promise(r => setTimeout(r, 100));
    const stage = document.querySelector('.wheel-stage');
    const box = stage.getBoundingClientRect();
    const angle = (120 * Math.PI) / 180;   // sector 2 of 6, clockwise from twelve o'clock
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true,
      clientX: box.left + box.width / 2 + 90 * Math.sin(angle),
      clientY: box.top + box.height / 2 - 90 * Math.cos(angle) }));
    await new Promise(r => setTimeout(r, 150));
    const info = { sectors: document.querySelectorAll('.wheel-stage .sector').length,
      chosen: document.querySelector('.action-picker-trigger')?.dataset.value ?? '' };
    // Replacing an early sector with an action used later, then changing it back, must not
    // leave a stale icon behind. Actions may repeat; the sector is the identity of a slot.
    const initial = [...document.querySelectorAll('.wheel-stage .slot')].map(node => node.dataset.action);
    const assign = async value => {
      document.querySelector('.action-picker-trigger').click();
      for (let i = 0; i < 30 && !document.querySelector('.action-picker-panel'); i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      const choices = [...document.querySelectorAll('.action-choice')];
      choices.find(node => node.dataset.value === value).click();
      for (let i = 0; i < 30 && document.querySelector('.action-picker-trigger')?.dataset.value !== value; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
    };
    await assign(initial[5]);
    info.repeatedActions = [...document.querySelectorAll('.wheel-stage .slot')].map(node => node.dataset.action);
    info.repeatedPositions = [...document.querySelectorAll('.shortcut-table tr[data-action-id]')]
      .find(row => row.dataset.actionId === initial[5]).querySelectorAll('.wheel-position').length;
    await assign(initial[2]);
    info.restoredActions = [...document.querySelectorAll('.wheel-stage .slot')].map(node => node.dataset.action);
    info.restoredPositions = [...document.querySelectorAll('.shortcut-table tr[data-action-id]')]
      .find(row => row.dataset.actionId === initial[5]).querySelectorAll('.wheel-position').length;
    info.initialActions = initial;
    info.iconPositions = [...document.querySelectorAll('.wheel-stage .slot')].map(node => node.style.left + ',' + node.style.top);
    toggle.click();
    for (let i = 0; i < 30 && document.querySelector('#wheel-settings'); i++) await new Promise(r => setTimeout(r, 100));
    info.gestureHidden = !document.querySelector('#wheel-settings');
    info.editorRemains = Boolean(document.querySelector('.wheel-stage'));
    return info;
  })()`);
  (editor.sectors === 6 && editor.chosen === 'switch-previous-tab' && editor.gestureHidden && editor.editorRemains)
    ? pass('the wheel editor keeps working with web gestures disabled')
    : fail('wheel editor', JSON.stringify(editor));
  const repeatedActions = [...editor.initialActions];
  repeatedActions[2] = repeatedActions[5];
  (JSON.stringify(editor.repeatedActions) === JSON.stringify(repeatedActions)
    && JSON.stringify(editor.restoredActions) === JSON.stringify(editor.initialActions)
    && new Set(editor.iconPositions).size === editor.iconPositions.length
    && editor.repeatedPositions === 2 && editor.restoredPositions === 1)
    ? pass('reassigning repeated actions updates list positions without duplicating wheel icons')
    : fail('wheel repeated action replacement', JSON.stringify(editor));
  const positionSettings = await msg({ type: 'get-settings' });
  const positionTabsBefore = await sw.eval('chrome.tabs.query({}).then(t => t.length)');
  const positionPicker = await opt.eval(`(async () => {
    const waitFor = async test => {
      for (let i = 0; i < 40; i++) { if (test()) return; await new Promise(r => setTimeout(r, 100)); }
      throw new Error('Position picker did not update');
    };
    const row = () => document.querySelector('tr[data-action-id="close-right"]');
    const open = async () => { row().querySelector('.wheel-position-button').click(); await waitFor(() => document.querySelector('.position-dialog[open]')); };
    const activate = async index => {
      const sector = document.querySelector('.position-dialog .sector[data-slot="' + index + '"]');
      sector.focus();
      sector.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitFor(() => !document.querySelector('.position-dialog'));
    };
    const before = row().querySelectorAll('.wheel-position').length;
    await open();
    const allSectors = document.querySelectorAll('.position-dialog .sector[role="menuitem"]').length;
    document.querySelector('.position-dialog .icon-close').click();
    await waitFor(() => !document.querySelector('.position-dialog'));
    const cancelUnchanged = row().querySelectorAll('.wheel-position').length === before;
    await open();
    await activate(0);
    const replaced = row().querySelectorAll('.wheel-position').length === before + 1;
    // Empty one sector with the existing editor, then fill it from the action's position column.
    document.querySelector('.action-picker-trigger').click();
    await waitFor(() => document.querySelector('.action-choice[data-value=""]'));
    document.querySelector('.action-choice[data-value=""]').click();
    await waitFor(() => document.querySelector('.action-picker-trigger').dataset.value === '');
    await open();
    const emptySelectable = document.querySelector('.position-dialog .sector[data-slot="2"]').getAttribute('role') === 'menuitem';
    await activate(2);
    const assignedEmpty = document.querySelector('.action-picker-trigger').dataset.value === 'close-right';
    return { allSectors, cancelUnchanged, replaced, emptySelectable, assignedEmpty };
  })()`);
  const positionTabsAfter = await sw.eval('chrome.tabs.query({}).then(t => t.length)');
  (positionPicker.allSectors === 6 && positionPicker.cancelUnchanged && positionPicker.replaced
    && positionPicker.emptySelectable && positionPicker.assignedEmpty
    && positionTabsBefore === positionTabsAfter)
    ? pass('dedicated position column assigns occupied and empty sectors, allows cancellation, and never executes dangerous actions')
    : fail('action position chooser', JSON.stringify(positionPicker));
  await msg({ type: 'save-settings', settings: positionSettings.settings });

  // Delay the first save response so a second control is changed while React still has the old
  // view. This reproduced the lost-edit bug before the options page serialized its mutations.
  const rapidSettings = await opt.eval(`(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    window.dispatchEvent(new Event('focus'));
    await sleep(300);
    const toggle = document.querySelector('.overlay-toggle input');
    if (!toggle.checked) toggle.click();
    for (let i = 0; i < 40 && !document.querySelector('.hold-select'); i++) await sleep(100);
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let delayed = false;
    chrome.runtime.sendMessage = async message => {
      const result = await send(message);
      if (message.type === 'save-settings' && !delayed) { delayed = true; await sleep(600); }
      return result;
    };
    try {
      const hold = document.querySelector('.hold-select');
      hold.value = 'Control'; hold.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('input[name="slot-count"][value="8"]').click();
      let saved;
      for (let i = 0; i < 40; i++) {
        saved = (await send({ type: 'get-settings' })).settings.overlay;
        if (saved.holdCode === 'Control' && saved.slots.length === 8
          && document.querySelectorAll('.wheel-preview .sector').length === 8) break;
        await sleep(100);
      }
      return saved;
    } finally { chrome.runtime.sendMessage = send; }
  })()`);
  (rapidSettings.holdCode === 'Control' && rapidSettings.slots.length === 8)
    ? pass('rapid changes to hold key and sector count both survive a delayed save')
    : fail('rapid settings edits', JSON.stringify(rapidSettings));

  await msg({ type: 'reset-usage' });
  const countedSuccess = await msg({ type: 'run-action', id: 'copy-links', windowId });
  const countedFailure = await msg({ type: 'retry-task', taskId: 'missing-smoke-task', windowId })
    .catch(error => ({ ok: false, error: error.message }));
  const usageUi = await opt.eval(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('.usage-stats summary').textContent.includes('2 次'); i++)
      await new Promise(resolve => setTimeout(resolve, 100));
    const area = document.querySelector('.usage-stats'); area.open = true;
    area.scrollIntoView({ block: 'start' });
    return { text: area.textContent, rows: [...area.querySelectorAll('tbody tr')].map(row => row.textContent),
      overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  (countedSuccess.status === 'ok' && countedFailure.ok === false && usageUi.rows.length === 2
    && usageUi.rows.includes('复制链接1') && usageUi.rows.includes('重试填入1') && !usageUi.overflow)
    ? pass('local statistics update live for successful and failed operations without layout overflow')
    : fail('usage UI', JSON.stringify({ countedSuccess, countedFailure, usageUi }));
  const usageReset = await opt.eval(`(async () => {
    const area = document.querySelector('.usage-stats');
    const button = text => [...area.querySelectorAll('button')].find(node => node.textContent === text);
    const wait = () => new Promise(resolve => setTimeout(resolve, 100));
    button('清空统计').click(); await wait();
    const before = (await chrome.runtime.sendMessage({ type: 'get-usage' })).usage.actions;
    button('取消').click(); await wait();
    const cancelled = (await chrome.runtime.sendMessage({ type: 'get-usage' })).usage.actions;
    button('清空统计').click(); await wait(); button('确认清空').click();
    for (let i = 0; i < 40 && !area.textContent.includes('还没有操作记录'); i++) await wait();
    return { before, cancelled, empty: area.textContent.includes('还没有操作记录'),
      stored: (await chrome.runtime.sendMessage({ type: 'get-usage' })).usage.actions };
  })()`);
  (Object.keys(usageReset.before).length === 2 && JSON.stringify(usageReset.before) === JSON.stringify(usageReset.cancelled)
    && usageReset.empty && Object.keys(usageReset.stored).length === 0)
    ? pass('clearing local statistics requires confirmation and immediately resets the UI')
    : fail('usage reset', JSON.stringify(usageReset));

  opt.exceptions.length === 0 ? pass('options page: no exceptions') : fail('options page exceptions', opt.exceptions.join(' | '));
  opt.close();

  // Language: a saved preference switches the popup, the service worker's action names, the
  // context menu and the page config the in-page wheel reads, in one save.
  const localeSettings = (await msg({ type: 'get-settings' })).settings;
  const localeResults = {};
  for (const [locale, label, action] of [['ja', '設定を開く', 'タブ履歴を戻る'], ['en', 'Open settings', 'Tab history back']]) {
    const view = await msg({ type: 'save-settings', settings: { ...localeSettings, locale } });
    // A fresh, foreground popup tab: the original one sits behind the overlay tests' pages by now,
    // and a backgrounded extension page stops answering the protocol.
    await sw.eval(`chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?locale=${locale}'), active: true })`);
    const localePopup = await attach(await waitTarget(t => t.type === 'page' && t.url.endsWith(`popup.html?locale=${locale}`)));
    await waitRendered(localePopup, '.popup-wheel-stage .sector');
    localeResults[locale] = {
      button: await localePopup.eval(`Boolean(document.querySelector('[aria-label=${JSON.stringify(label)}]'))`),
      lang: await localePopup.eval('document.documentElement.lang'),
      action: view.actions.find(item => item.id === 'history-back')?.name === action,
      page: (await sw.eval(`chrome.storage.local.get('pageConfig').then(r => r.pageConfig.locale)`)) === locale,
    };
    // Close through the protocol; awaiting chrome.tabs.remove from the worker can hang.
    await localePopup.send('Page.close', {}, 5000).catch(() => {});
    localePopup.close();
  }
  await msg({ type: 'save-settings', settings: localeSettings });
  const localeOk = Object.values(localeResults).every(result => result.button && result.action && result.page)
    && localeResults.ja.lang === 'ja' && localeResults.en.lang === 'en';
  localeOk ? pass('switching the language updates the popup, action names and the in-page wheel config')
    : fail('language switch', JSON.stringify(localeResults));
} catch (error) {
  fail('smoke aborted', error.stack ?? String(error));
  const snapshot = await sw.eval(`chrome.tabs.query({}).then(t => t.map(x => [x.id, x.windowId, x.index, x.active, x.status, x.url]))`).catch(e => String(e));
  console.log('tabs at failure:', JSON.stringify(snapshot));
}
if (results.some(result => result[0] === 'FAIL') && overlayInputTrace) {
  console.log('overlay input trace:', JSON.stringify(await overlayInputTrace().catch(error => ({ error: String(error) }))));
}
popup.exceptions.length === 0 ? pass('popup: no exceptions') : fail('popup exceptions', popup.exceptions.join(' | '));
sw.exceptions.length === 0 ? pass('service worker: no exceptions') : fail('service worker exceptions', sw.exceptions.join(' | '));
popup.close(); sw.close();
await cleanup();
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
