import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, HISTORY_KEY, SETTINGS_KEY, PAGE_ORIGINS } from '../src/controller.js';
import { PAGE_CONFIG_KEY, SHORTCUT_SCRIPT_ID } from '../src/shortcuts.js';
import { createFakeChrome, tab } from './fake-chrome.js';
import { USAGE_KEY } from '../src/usage.js';

const clone = value => structuredClone(value);

// The fake preserves Chrome's important ordering: update changes the active tab, and its
// event never waits for the controller's serialized work to finish.
function browser({ histories = {}, settings = {}, ...options } = {}) {
  const env = createFakeChrome({
    session: { [HISTORY_KEY]: { version: 1, windows: clone(histories) } }, local: { [SETTINGS_KEY]: clone(settings) }, ...options,
  });
  let controller = createController(env.api);
  env.data.onActivated = info => controller.onActivated(info);
  env.data.onRemoved = (id, windowId) => controller.removeTab(id, windowId);
  return {
    env, data: env.data, api: env.api,
    get controller() { return controller; },
    ready: () => controller.ready(),
    reboot: async () => { controller = createController(env.api); await controller.ready(); },
    visit: async id => { const target = env.setActive(id); await controller.onActivated({ tabId: id, windowId: target.windowId }); },
    active: env.active,
    history: windowId => clone(env.data.session[HISTORY_KEY].windows[windowId]),
    message: (type, options = {}, sender) => controller.handleMessage({ type, ...options }, sender),
    flushEvents: env.flushEvents,
  };
}
const popupSender = { id: 'ext', url: 'chrome-extension://ext/popup.html' };
const usageOf = async env => (await env.message('get-usage', {}, popupSender)).usage;
const pageSender = tabId => ({ id: 'ext', url: 'https://example.com/page', tab: { id: tabId }, frameId: 0 });
const optionsSender = { id: 'ext', url: 'chrome-extension://ext/options.html', tab: { id: 77, windowId: 1 } };

for (const activationMode of ['sync', 'microtask', 'deferred']) {
  test(`history navigation ignores its own ${activationMode} activation event`, async () => {
    const env = browser({ activationMode });
    await env.ready();
    await env.visit(2);
    await env.visit(3);
    assert.deepEqual(await env.message('navigate', { windowId: 1, direction: -1 }), { changed: true });
    await env.flushEvents();
    assert.equal(env.active(1), 2);
    assert.deepEqual(env.history(1), { entries: [1, 2, 3], cursor: 1 });
    await env.message('navigate', { windowId: 1, direction: 1 });
    await env.flushEvents();
    assert.equal(env.active(1), 3);
    assert.deepEqual(env.history(1), { entries: [1, 2, 3], cursor: 2 });
  });

  test(`rapid queued back/back/forward retains history with ${activationMode} events`, async () => {
    const env = browser({ activationMode, tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2), tab(4, 1, 3)] });
    await env.ready();
    for (const id of [2, 3, 4]) await env.visit(id);
    await Promise.all([-1, -1, 1].map(direction => env.message('navigate', { windowId: 1, direction })));
    await env.flushEvents();
    assert.equal(env.active(1), 3);
    assert.deepEqual(env.data.updates, [3, 2, 3]);
    assert.deepEqual(env.history(1), { entries: [1, 2, 3, 4], cursor: 2 });
  });
}

test('a manual visit branches history and each window keeps its own trail', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2), tab(4, 1, 3), tab(10, 2, 0, true), tab(11, 2, 1)] });
  await env.ready();
  await env.visit(2);
  await env.visit(11);
  await env.visit(3);
  await env.message('navigate', { windowId: 1, direction: -1 });
  await env.visit(4);
  assert.deepEqual(env.history(1), { entries: [1, 2, 4], cursor: 2 });
  assert.deepEqual(env.history(2), { entries: [10, 11], cursor: 1 });
  assert.deepEqual(await env.message('navigate', { windowId: 1, direction: 1 }), { changed: false });
  const result = await env.controller.onCommand('history-back', { id: 11, windowId: 2 });
  assert.equal(result.status, 'ok');
  assert.equal(env.active(2), 10);
  assert.equal(env.active(1), 4);
});

test('a service worker restart retains the cursor and forward history', async () => {
  const env = browser();
  await env.ready();
  await env.visit(2);
  await env.visit(3);
  await env.message('navigate', { windowId: 1, direction: -1 });
  await env.flushEvents();
  await env.reboot();
  assert.deepEqual(env.history(1), { entries: [1, 2, 3], cursor: 1 });
  const { state } = await env.message('get-state', { windowId: 1 });
  assert.equal(state.canBack, true);
  assert.equal(state.canForward, true);
  assert.equal(state.entries[state.cursor].tabId, 2);
  await env.message('navigate', { windowId: 1, direction: 1 });
  assert.equal(env.active(1), 3);
});

test('activation events buffered during worker wakeup retain their original order', async () => {
  const env = browser({ tabs: [tab(1, 1, 0), tab(2, 1, 1), tab(3, 1, 2, true)], histories: { 1: { entries: [1], cursor: 0 } } });
  await Promise.all([
    env.controller.onActivated({ tabId: 2, windowId: 1 }),
    env.controller.onActivated({ tabId: 3, windowId: 1 }),
  ]);
  assert.deepEqual(env.history(1), { entries: [1, 2, 3], cursor: 2 });
});

test('an unrelated user activation does not consume a pending navigation marker', async () => {
  const env = browser({ activationMode: 'deferred', tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2), tab(4, 1, 3)] });
  await env.ready();
  for (const id of [2, 3, 4]) await env.visit(id);
  await env.message('navigate', { windowId: 1, direction: -1 });
  await env.visit(1);
  await env.flushEvents();
  assert.equal(env.active(1), 1);
  assert.deepEqual(env.history(1), { entries: [1, 2, 3, 1], cursor: 3 });
});

test('jump rejects a stale row whose cursor now identifies a different tab', async () => {
  const env = browser();
  await env.ready();
  await env.visit(2);
  await env.visit(3);
  const { state } = await env.message('get-state', { windowId: 1 });
  const selectedRow = state.entries[1];
  env.data.tabs = env.data.tabs.filter(item => item.id !== 1);
  await env.controller.removeTab(1, 1);
  await assert.rejects(env.message('jump', { windowId: 1, cursor: selectedRow.cursor, tabId: selectedRow.tabId }), /记录已变化/);
  assert.deepEqual(env.data.updates, []);
  assert.equal(env.active(1), 3);
  await env.message('jump', { windowId: 1, cursor: 0, tabId: 2 });
  assert.equal(env.active(1), 2);
  assert.deepEqual(env.history(1), { entries: [2, 3], cursor: 0 });
});

test('jumping between repeated visits to the active tab moves only the history cursor', async () => {
  const env = browser();
  await env.ready();
  for (const id of [2, 1, 3]) await env.visit(id);
  await env.message('jump', { windowId: 1, cursor: 0, tabId: 1 });
  assert.deepEqual(env.data.updates, [1]);
  await env.message('jump', { windowId: 1, cursor: 2, tabId: 1 });
  assert.deepEqual(env.data.updates, [1]);
  assert.deepEqual(env.history(1), { entries: [1, 2, 1, 3], cursor: 2 });
});

test('stale saved tabs are pruned and a missed active-tab event is reconciled', async () => {
  const env = browser({ histories: { 1: { entries: [99, 1, 98, 2, 3], cursor: 1 }, 9: { entries: [90], cursor: 0 } } });
  await env.ready();
  assert.deepEqual(env.history(1), { entries: [1, 2, 3], cursor: 0 });
  assert.equal(env.history(9), undefined);
  env.data.tabs.find(item => item.id === 1).active = false;
  env.data.tabs.find(item => item.id === 3).active = true;
  const { state } = await env.message('get-state', { windowId: 1 });
  assert.deepEqual(state.entries.map(item => item.tabId), [1, 3]);
  assert.equal(state.cursor, 1);
});

test('closed historical tabs are skipped even before their removal event arrives', async () => {
  const env = browser();
  await env.ready();
  await env.visit(2);
  await env.visit(3);
  env.data.tabs = env.data.tabs.filter(item => item.id !== 2);
  await env.message('navigate', { windowId: 1, direction: -1 });
  assert.equal(env.active(1), 1);
  assert.deepEqual(env.history(1), { entries: [1, 3], cursor: 0 });
});

test('a target that disappears during activation reports failure and the queue recovers', async () => {
  const env = browser();
  await env.ready();
  await env.visit(2);
  await env.visit(3);
  env.data.beforeUpdate = id => { env.data.tabs = env.data.tabs.filter(item => item.id !== id); env.data.beforeUpdate = null; };
  await assert.rejects(env.message('navigate', { windowId: 1, direction: -1 }), /No tab/);
  assert.equal(env.active(1), 3);
  assert.deepEqual(env.history(1), { entries: [1, 2, 3], cursor: 2 });
  await env.message('navigate', { windowId: 1, direction: -1 });
  assert.equal(env.active(1), 1);
});

test('close-right respects the active anchor, pinned tabs, and window boundaries', async () => {
  const env = browser({ tabs: [tab(1, 1, 0), tab(2, 1, 1, true), tab(3, 1, 2, false, { pinned: true }), tab(4, 1, 3), tab(5, 1, 4), tab(10, 2, 0, true), tab(11, 2, 1)] });
  await env.ready();
  const { state } = await env.message('get-state', { windowId: 1 });
  assert.equal(state.rightCount, 2);
  assert.deepEqual(await env.message('close-right', { windowId: 1 }), { closedCount: 2 });
  await env.flushEvents();
  assert.deepEqual(env.data.removed, [4, 5]);
  assert.deepEqual(env.data.tabs.map(item => item.id).sort(), [1, 10, 11, 2, 3]);
  assert.equal(env.active(1), 2);
});

test('close-right rechecks candidates and stops if its anchor moves to another window', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2), tab(10, 2, 0, true)] });
  await env.ready();
  env.data.beforeGet = id => {
    if (id === 2) env.data.tabs.find(item => item.id === 2).windowId = 2;
    if (id === 3) env.data.tabs.find(item => item.id === 3).index = -1;
  };
  assert.deepEqual(await env.message('close-right', { windowId: 1 }), { closedCount: 0 });
  env.data.beforeGet = id => { if (id === 1) env.data.tabs.find(item => item.id === 1).windowId = 2; };
  assert.deepEqual(await env.message('close-right', { windowId: 1 }), { closedCount: 0 });
  assert.deepEqual(env.data.removed, []);
});

test('wheel close only prepares a count; explicit confirmation closes the approved tabs once', async () => {
  const env = browser({ settings: { overlay: { enabled: true } },
    tabs: [tab(1, 1, 0, true), tab(2, 1, 1, false, { pinned: true }), tab(3, 1, 2), tab(4, 1, 3), tab(10, 2, 0, true)] });
  await env.ready();
  const preview = await env.message('overlay-action', { id: 'close-right' }, pageSender(1));
  assert.equal(preview.status, 'confirmation-required');
  assert.equal(preview.confirmation.count, 2);
  assert.deepEqual(env.data.removed, []);
  const approval = { id: 'close-right', token: preview.confirmation.token };
  await assert.rejects(env.message('overlay-confirm-action', { ...approval, token: 'wrong' }, pageSender(1)), /确认已失效/);
  await assert.rejects(env.message('overlay-confirm-action', approval, { ...pageSender(1), frameId: 2 }), /确认已失效/);
  assert.deepEqual(env.data.removed, []);
  assert.equal((await env.message('overlay-confirm-action', approval, pageSender(1))).status, 'ok');
  assert.deepEqual(env.data.removed, [3, 4]);
  await assert.rejects(env.message('overlay-confirm-action', approval, pageSender(1)), /确认已失效/);
  assert.deepEqual(env.data.tabs.map(item => item.id), [1, 2, 10]);
});

for (const change of ['new-tab', 'replacement', 'pinned', 'moved-left']) {
  test(`wheel confirmation refuses a changed set of tabs: ${change}`, async () => {
    const env = browser({ settings: { overlay: { enabled: true } } });
    await env.ready();
    const { confirmation } = await env.message('overlay-action', { id: 'close-right' }, pageSender(1));
    if (change === 'new-tab') env.data.tabs.push(tab(4, 1, 3));
    if (change === 'replacement') env.data.tabs[2].id = 4;
    if (change === 'pinned') env.data.tabs[2].pinned = true;
    if (change === 'moved-left') env.data.tabs[2].index = -1;
    const approval = { id: 'close-right', token: confirmation.token };
    await assert.rejects(env.message('overlay-confirm-action', approval, pageSender(1)), /标签页已变化/);
    assert.deepEqual(env.data.removed, []);
    await assert.rejects(env.message('overlay-confirm-action', approval, pageSender(1)), /确认已失效/);
  });
}

test('wheel confirmation expires and cannot survive a worker restart or a newer preview', async t => {
  const env = browser({ settings: { overlay: { enabled: true } } });
  await env.ready();
  const prepare = async () => (await env.message('overlay-action', { id: 'close-right' }, pageSender(1))).confirmation.token;
  const confirm = token => env.message('overlay-confirm-action', { id: 'close-right', token }, pageSender(1));
  const first = await prepare();
  const second = await prepare();
  await assert.rejects(confirm(first), /确认已失效/);
  await env.reboot();
  await assert.rejects(confirm(second), /确认已失效/);
  const third = await prepare();
  const future = Date.now() + 120001;
  t.mock.method(Date, 'now', () => future);
  await assert.rejects(confirm(third), /确认已失效/);
  assert.deepEqual(env.data.removed, []);
});

test('wheel confirmation requires the source tab to still be active and the wheel enabled', async () => {
  const env = browser({ settings: { overlay: { enabled: true } } });
  await env.ready();
  const { confirmation } = await env.message('overlay-action', { id: 'close-right' }, pageSender(1));
  const approval = { id: 'close-right', token: confirmation.token };
  await env.visit(2);
  assert.equal((await env.message('overlay-confirm-action', approval, pageSender(1))).status, 'ignored');
  await env.visit(1);
  const { settings } = await env.message('get-settings');
  await env.message('save-settings', { settings: { ...settings, overlay: { ...settings.overlay, enabled: false } } });
  assert.equal((await env.message('overlay-confirm-action', approval, pageSender(1))).status, 'ignored');
  assert.deepEqual(env.data.removed, []);
});

test('popup close requires a single-use confirmation even with web gestures disabled', async () => {
  const env = browser({ settings: { overlay: { enabled: false } },
    tabs: [tab(1, 1, 0, true), tab(2, 1, 1, false, { pinned: true }), tab(3, 1, 2), tab(10, 2, 0, true)] });
  await env.ready();
  const { confirmation } = await env.message('popup-close-preview', { windowId: 1 });
  assert.equal(confirmation.count, 1);
  assert.deepEqual(env.data.removed, []);
  await assert.rejects(env.message('popup-close-confirm', { windowId: 2, token: confirmation.token }), /确认已失效/);
  await assert.rejects(env.message('popup-close-confirm', { windowId: 1, token: 'wrong' }), /确认已失效/);
  await assert.rejects(env.message('popup-close-confirm', { windowId: 1, token: confirmation.token }, pageSender(1)), /只能在扩展面板/);
  assert.equal((await env.message('popup-close-confirm', { windowId: 1, token: confirmation.token })).status, 'ok');
  assert.deepEqual(env.data.removed, [3]);
  await assert.rejects(env.message('popup-close-confirm', { windowId: 1, token: confirmation.token }), /确认已失效/);
});

for (const change of ['new-tab', 'anchor', 'pinned']) {
  test(`popup close refuses changed tabs: ${change}`, async () => {
    const env = browser();
    await env.ready();
    const { confirmation } = await env.message('popup-close-preview', { windowId: 1 });
    if (change === 'new-tab') env.data.tabs.push(tab(4, 1, 3));
    if (change === 'anchor') await env.visit(2);
    if (change === 'pinned') env.data.tabs[2].pinned = true;
    await assert.rejects(env.message('popup-close-confirm', { windowId: 1, token: confirmation.token }), /标签页已变化/);
    assert.deepEqual(env.data.removed, []);
  });
}

test('popup close previews expire, are superseded, and do not survive a worker restart', async t => {
  const env = browser();
  await env.ready();
  const prepare = async () => (await env.message('popup-close-preview', { windowId: 1 })).confirmation.token;
  const confirm = token => env.message('popup-close-confirm', { windowId: 1, token });
  const first = await prepare();
  const second = await prepare();
  await assert.rejects(confirm(first), /确认已失效/);
  await env.reboot();
  await assert.rejects(confirm(second), /确认已失效/);
  const third = await prepare();
  const future = Date.now() + 120001;
  t.mock.method(Date, 'now', () => future);
  await assert.rejects(confirm(third), /确认已失效/);
  assert.deepEqual(env.data.removed, []);
});

test('ordinary wheel actions still run immediately', async () => {
  const env = browser({ settings: { overlay: { enabled: true } } });
  await env.ready();
  const reply = await env.message('overlay-action', { id: 'duplicate-tab' }, pageSender(1));
  assert.equal(reply.status, 'ok');
  assert.equal(env.data.tabs.length, 4);
});

test('moving an active tab removes it from its old window and records the destination', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(10, 2, 0, true)] });
  await env.ready();
  await env.visit(2);
  const moved = env.data.tabs.find(item => item.id === 2);
  moved.windowId = 2;
  moved.index = 1;
  env.data.tabs.find(item => item.id === 10).active = false;
  env.data.tabs.find(item => item.id === 1).active = true;
  await env.controller.removeTab(2, 1);
  await env.controller.onAttached(2, { newWindowId: 2 });
  assert.deepEqual(env.history(1), { entries: [1], cursor: 0 });
  assert.deepEqual(env.history(2), { entries: [10, 2], cursor: 1 });
  await env.message('navigate', { windowId: 2, direction: -1 });
  assert.equal(env.active(2), 10);
});

test('a tab moved after querying cannot be activated from the old window history', async () => {
  const env = browser();
  await env.ready();
  await env.visit(2);
  await env.visit(3);
  env.data.beforeGet = id => { if (id === 2) env.data.tabs.find(item => item.id === 2).windowId = 2; };
  await assert.rejects(env.message('navigate', { windowId: 1, direction: -1 }), /另一个窗口/);
  assert.deepEqual(env.data.updates, []);
  assert.equal(env.active(1), 3);
});

// ---------------------------------------------------------------- actions, entry points, boundaries

test('AI jumps and history navigation are recorded differently (spec §7.5)', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true, { url: 'https://docs.example/a' }), tab(2, 1, 1, false, { url: 'https://claude.ai/new' })] });
  env.data.grantedOrigins.add('https://claude.ai/*');
  env.data.adapter = async op => ({ probe: { state: 'ready', draft: '' }, fill: { ok: true }, submit: { submitted: true }, focus: { ok: true } }[op]);
  env.data.selectionText = 'hello';
  await env.ready();
  await env.message('save-settings', { settings: { version: 2, returnAfterSend: true } }, popupSender);
  const result = await env.controller.onCommand('send-claude', { id: 1, windowId: 1 });
  assert.equal(result.status, 'sent');
  await env.flushEvents();
  assert.equal(env.active(1), 1);
  assert.deepEqual(env.history(1), { entries: [1, 2, 1], cursor: 2 }, 'A → B → A is a real trail');
  await env.message('navigate', { windowId: 1, direction: -1 });
  await env.flushEvents();
  assert.equal(env.active(1), 2);
  assert.deepEqual(env.history(1), { entries: [1, 2, 1], cursor: 1 }, 'navigation moves the cursor only');
  assert.equal(env.data.notifications.length, 0, 'success is silent');
});

test('commands notify on failure states and no-ops; panel calls do not', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true)] });
  await env.ready();
  const fromCommand = await env.controller.onCommand('close-right', { id: 1, windowId: 1 });
  assert.equal(fromCommand.status, 'noop');
  assert.equal(env.data.notifications.length, 1);
  assert.match(env.data.notifications[0].message, /没有可关闭/);
  const fromPanel = await env.message('run-action', { id: 'close-right', windowId: 1 }, popupSender);
  assert.equal(fromPanel.status, 'noop');
  assert.equal(env.data.notifications.length, 1);
  const boundary = await env.controller.onCommand('move-tab-left', { id: 1, windowId: 1 });
  assert.equal(boundary.status, 'noop');
  assert.equal(env.data.notifications.length, 1, 'boundaries stay silent');
  await assert.rejects(env.controller.onCommand('not-a-command', { id: 1, windowId: 1 }), /未知动作/);
});

test('copy links goes through the offscreen document and reports the count', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true), tab(2, 1, 1, false, { highlighted: true })] });
  await env.ready();
  const result = await env.message('run-action', { id: 'copy-links', windowId: 1 }, popupSender);
  assert.equal(result.status, 'ok');
  assert.match(result.message, /2 个链接/);
  assert.deepEqual(env.data.messages.at(-1), { type: 'offscreen-copy', text: 'https://example.com/1\nhttps://example.com/2' });
  assert.equal(env.data.offscreenOpen, false);
});

test('content scripts may only trigger the web shortcut they are bound to, from the active tab', async () => {
  const env = browser({ granted: true, settings: { version: 2, webShortcuts: { bindings: { 'close-right': 'Ctrl+Shift+W', 'history-back': 'Ctrl+Minus' } } },
    tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2)] });
  await env.ready();
  for (const type of ['get-state', 'close-right', 'save-settings', 'jump', 'run-action']) {
    await assert.rejects(env.message(type, { id: 'close-right', windowId: 1 }, pageSender(1)), /扩展面板/);
  }
  assert.equal((await env.message('get-settings', {}, optionsSender)).settings.version, 4, 'the options page lives in a tab but is trusted');
  assert.deepEqual(await env.message('web-shortcut', { actionId: 'close-right', combo: 'Ctrl+W' }, pageSender(1)), { status: 'ignored', message: '' }, 'combo must match the saved binding');
  assert.deepEqual(await env.message('web-shortcut', { actionId: 'close-right', combo: 'Ctrl+Shift+W' }, pageSender(2)), { status: 'ignored', message: '' }, 'inactive sender tab');
  const result = await env.message('web-shortcut', { actionId: 'close-right', combo: 'Ctrl+Shift+W' }, pageSender(1));
  assert.equal(result.status, 'ok');
  await env.flushEvents();
  assert.deepEqual(env.data.removed, [2, 3]);
  await assert.rejects(env.message('web-shortcut', { actionId: 'move-tab-to-index', combo: 'Ctrl+I' }, pageSender(1)).then(r => { if (r.status === 'ignored') throw new Error('ignored'); }), /ignored/);
});

test('a web binding shadowed by a native command is not executed twice', async () => {
  const env = browser({ granted: true, platform: 'win', nativeCommands: [{ name: 'history-back', shortcut: 'Ctrl+Comma' }],
    settings: { version: 2, webShortcuts: { bindings: { 'history-back': 'Ctrl+Comma' } } } });
  await env.ready();
  assert.deepEqual(env.data.local[PAGE_CONFIG_KEY].keymap, {});
  assert.deepEqual(await env.message('web-shortcut', { actionId: 'history-back', combo: 'Ctrl+Comma' }, pageSender(1)), { status: 'ignored', message: '' });
});

test('the v1 minus toggle keeps working after upgrade: bindings migrate and the script registers', async () => {
  const env = browser({ granted: true, settings: { minusShortcuts: true }, tabs: [tab(1, 1, 0, true), tab(2, 1, 1)] });
  await env.ready();
  assert.equal(env.data.scripts.has(SHORTCUT_SCRIPT_ID), true);
  assert.deepEqual(Object.keys(env.data.local[PAGE_CONFIG_KEY].keymap), ['Ctrl+Minus', 'Ctrl+Shift+Minus']);
  await env.visit(2);
  const result = await env.message('web-shortcut', { actionId: 'history-back', combo: 'Ctrl+Minus' }, pageSender(2));
  assert.equal(result.status, 'ok');
  assert.equal(env.active(1), 1);
});

test('settings changes rebuild context menus and republish the page config', async () => {
  const env = browser({ granted: true });
  await env.ready();
  assert.deepEqual(env.data.menus.map(menu => menu.id), ['hiraishin-root', 'send:chatgpt', 'send:claude']);
  const view = await env.message('save-settings', { settings: {
    version: 2, floatingButton: true, defaultTargetId: 'notes',
    targets: { enabled: { chatgpt: 'fill' }, custom: [{ id: 'notes', name: 'Notes', openUrl: 'https://notes.example/', capability: 'navigate' }] },
  } }, popupSender);
  assert.deepEqual(env.data.menus.map(menu => menu.id), ['hiraishin-root', 'fill:chatgpt', 'send:claude'], 'fill-only targets still get a menu entry');
  assert.equal(env.data.local[PAGE_CONFIG_KEY].floating, null);
  assert.equal('floatingButton' in view.settings, false);
  assert.equal(view.targets.find(target => target.id === 'notes').granted, true);
  assert.equal(view.actions.some(action => action.id === 'target:go-to-notes'), true);
  await env.api.permissions.remove({ origins: PAGE_ORIGINS });
  await env.controller.onPermissionsChanged();
  assert.equal(env.data.local[PAGE_CONFIG_KEY].floating, null);
});

test('save-settings adds targets beyond the former limit and ignores legacy plans', async () => {
  const env = browser();
  await env.ready();
  const custom = n => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `T${i}`, openUrl: `https://t${i}.example/` }));
  for (const plan of ['free', 'pro', undefined]) {
    const view = await env.message('save-settings', { settings: { version: 4, plan, defaultTargetId: 't4', targets: { custom: custom(5) } } }, popupSender);
    assert.equal(view.settings.targets.custom.length, 5);
    assert.equal(view.settings.defaultTargetId, 't4');
    assert.equal('plan' in view.settings, false);
    assert.equal('entitlements' in view, false);
    assert.equal(view.actions.some(action => action.id === 'target:go-to-t4'), true);
    const reloaded = await env.message('get-settings', {}, popupSender);
    assert.deepEqual(reloaded.settings.targets.custom, view.settings.targets.custom);
  }
});

test('context menu and wheel selections still send while retired floating-button requests are rejected', async () => {
  const env = browser({ granted: true, settings: { version: 2, floatingButton: true },
    tabs: [tab(1, 1, 0, true, { url: 'https://docs.example/a' }), tab(2, 1, 1, false, { url: 'https://claude.ai/new' })] });
  const calls = [];
  env.data.adapter = async (op, payload) => { calls.push({ op, text: payload.text }); return { probe: { state: 'ready', draft: '' }, fill: { ok: true }, submit: { submitted: true } }[op]; };
  env.data.selectionText = '';
  await env.ready();
  const menu = await env.controller.onMenuClicked({ menuItemId: 'fill:claude', selectionText: 'from menu', frameId: 0 }, { id: 1, windowId: 1 });
  assert.equal(menu.status, 'filled');
  assert.equal(calls.at(-1).text, 'from menu');
  env.env.setActive(1);
  const before = calls.length;
  await assert.rejects(env.message('floating-transfer', { mode: 'send', targetId: 'chatgpt', text: 'from button' }, pageSender(1)), /此操作只能在扩展面板中执行/);
  assert.equal(calls.length, before, 'a legacy content script cannot initiate a transfer');
  env.data.selectionText = 'from wheel';
  const wheel = await env.message('overlay-action', { id: 'send-default-target' }, pageSender(1));
  assert.equal(wheel.status, 'sent');
  assert.equal(calls.filter(call => call.op === 'fill').at(-1).text, 'from wheel');
  assert.equal(await env.controller.onMenuClicked({ menuItemId: 'hiraishin-root' }, { id: 1, windowId: 1 }), null);
});

test('get-state exposes pinned actions with bindings, tasks and page readiness', async () => {
  const env = browser({ granted: true, nativeCommands: [{ name: 'history-back', shortcut: 'Ctrl+Comma' }], pingReply: { ready: true },
    settings: { version: 2, webShortcuts: { bindings: { 'close-right': 'Ctrl+Shift+W' } } },
    tabs: [tab(1, 1, 0, true, { lastAccessed: 3 }), tab(2, 1, 1, false, { lastAccessed: 2 }), tab(3, 1, 2, false, { lastAccessed: 1 })] });
  await env.ready();
  const { state } = await env.message('get-state', { windowId: 1 }, popupSender);
  const back = state.actions.find(action => action.id === 'history-back');
  assert.equal(back.native, 'Ctrl+Comma');
  assert.equal(back.nativeCombo, 'Ctrl+Comma');
  assert.equal(back.suggested, 'Ctrl+Comma');
  assert.equal(state.actions.find(action => action.id === 'history-forward').suggested, 'Ctrl+Period', 'default key reported even when Chrome shows none');
  assert.equal(state.actions.find(action => action.id === 'close-right').webBinding, 'Ctrl+Shift+W');
  assert.equal(state.mru, undefined, 'the recent-tabs list was dropped from the panel');
  assert.equal(state.shortcuts.pageReady, true);
  assert.equal(state.shortcuts.webActive, true);
  assert.deepEqual(state.tasks, []);
  assert.equal(state.targets.length, 2);
  assert.equal(state.tabCount, 3);
});

test('usage counts every entry, including failure and no-op, exactly once', async () => {
  const env = browser({ granted: true, settings: { version: 4,
    overlay: { slots: ['copy-links', null, null, null] },
    webShortcuts: { bindings: { 'copy-links': 'Ctrl+Shift+C' } },
  } });
  await env.ready();
  assert.deepEqual((await usageOf(env)).actions, {});
  await env.controller.onCommand('copy-links', { id: 1, windowId: 1 });
  await env.message('run-action', { id: 'copy-links', windowId: 1 }, popupSender);
  await env.message('web-shortcut', { actionId: 'copy-links', combo: 'Ctrl+Shift+C' }, pageSender(1));
  await env.message('overlay-state', {}, pageSender(1));
  await env.message('overlay-action', { id: 'copy-links' }, pageSender(1));
  env.data.runtimeReply = { ok: false };
  await assert.rejects(env.message('run-action', { id: 'copy-links', windowId: 1 }, popupSender), /复制到剪贴板失败/);
  await env.controller.onCommand('history-back', { id: 1, windowId: 1 });
  const empty = await env.controller.onMenuClicked({ menuItemId: 'send:claude' }, { id: 1, windowId: 1 });
  assert.equal(empty.status, 'no-selection');
  await assert.rejects(env.message('retry-task', { taskId: 'missing', windowId: 1 }, popupSender), /已不存在/);
  assert.deepEqual((await usageOf(env)).actions, {
    'copy-links': { overlay: 1, popup: 2, command: 1, web: 1 },
    'history-back': { command: 1 }, 'send-claude': { menu: 1 }, 'retry-transfer': { retry: 1 },
  });
  await assert.rejects(env.message('get-usage', {}, pageSender(1)), /只能在扩展面板/);
  await assert.rejects(env.message('reset-usage', {}, pageSender(1)), /只能在扩展面板/);
  assert.deepEqual((await env.message('reset-usage', {}, popupSender)).usage.actions, {});
});

test('close previews do not count; confirmation counts one operation for the whole batch', async () => {
  for (const origin of ['popup', 'overlay']) {
    const env = browser();
    await env.ready();
    const preview = () => origin === 'popup'
      ? env.message('popup-close-preview', { windowId: 1 }, popupSender)
      : env.message('overlay-action', { id: 'close-right' }, pageSender(1));
    await preview();
    const { confirmation } = await preview();
    assert.deepEqual((await usageOf(env)).actions, {});
    const confirm = () => origin === 'popup'
      ? env.message('popup-close-confirm', { windowId: 1, token: confirmation.token }, popupSender)
      : env.message('overlay-confirm-action', { id: 'close-right', token: confirmation.token }, pageSender(1));
    await confirm();
    assert.equal(env.data.removed.length, 2);
    await assert.rejects(confirm(), /已失效/);
    assert.deepEqual((await usageOf(env)).actions, { 'close-right': { [origin]: 1 } });
  }
});

test('statistics storage failure cannot prevent an action', async t => {
  const env = browser();
  await env.ready();
  const set = env.api.storage.local.set;
  t.mock.method(console, 'warn', () => {});
  env.api.storage.local.set = async values => {
    if (USAGE_KEY in values) throw new Error('storage unavailable');
    return set(values);
  };
  assert.equal((await env.message('run-action', { id: 'copy-links', windowId: 1 }, popupSender)).status, 'ok');
});

test('simultaneous binding writes retain both actions', async () => {
  const env = browser();
  await Promise.all([
    env.message('set-web-binding', { actionId: 'copy-links', combo: 'Ctrl+Shift+C' }),
    env.message('set-web-binding', { actionId: 'duplicate-tab', combo: 'Ctrl+Shift+D' }),
  ]);
  assert.deepEqual((await env.message('get-settings')).settings.webShortcuts.bindings, {
    'copy-links': 'Ctrl+Shift+C', 'duplicate-tab': 'Ctrl+Shift+D',
  });
});
