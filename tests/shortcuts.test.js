import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveKeymap, createShortcutService, SHORTCUT_SCRIPT_ID, OVERLAY_SCRIPT_ID, PAGE_CONFIG_KEY } from '../src/shortcuts.js';
import { listActions } from '../src/actions.js';
import { createSettingsStore, SETTINGS_KEY } from '../src/settings.js';
import { createFakeChrome, tab } from './fake-chrome.js';

test('a web binding covered by a native command is shadowed; duplicate combos conflict', () => {
  const bindings = { 'history-back': 'Command+Comma', 'close-right': 'Ctrl+Shift+W', 'duplicate-tab': 'Ctrl+Shift+W', 'move-tab-to-index': 'Ctrl+I' };
  const native = [{ name: 'history-back', shortcut: 'Ctrl+Comma' }];
  const result = effectiveKeymap(bindings, native, 'mac', listActions());
  assert.deepEqual(result.map, { 'Ctrl+Shift+W': 'close-right' });
  assert.deepEqual(result.shadowed, { 'history-back': 'Command+Comma' });
  assert.deepEqual(result.conflicts, { 'duplicate-tab': 'Ctrl+Shift+W' });
});

test('sync publishes the page config and registers scripts only when permitted', async () => {
  const env = createFakeChrome({ local: { [SETTINGS_KEY]: { minusShortcuts: true } }, granted: false });
  env.data.scripts.set('hiraishin-minus', { id: 'hiraishin-minus' });
  const store = createSettingsStore(env.api);
  const service = createShortcutService(env.api, { settingsStore: store, listActionsFor: listActions });
  let wanted = await service.sync();
  assert.equal(wanted.shortcuts, false);
  assert.equal(wanted.overlay, false, 'default-on still requires website permission');
  assert.equal((await store.get()).overlay.enabled, true, 'permission state does not overwrite the preference');
  assert.equal(env.data.local[PAGE_CONFIG_KEY].overlay.enabled, false);
  assert.equal(env.data.scripts.size, 0, 'legacy script removed and nothing registered without permission');
  assert.deepEqual(env.data.local[PAGE_CONFIG_KEY].keymap, {});

  await env.api.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
  wanted = await service.sync();
  assert.equal(wanted.shortcuts, true);
  assert.equal(wanted.overlay, true, 'granting website access activates the default wheel');
  assert.equal(env.data.scripts.get(OVERLAY_SCRIPT_ID).js[0], 'ui/overlay.js');
  assert.equal(env.data.local[PAGE_CONFIG_KEY].overlay.enabled, true);
  assert.deepEqual(env.data.local[PAGE_CONFIG_KEY].keymap, {
    'Ctrl+Minus': { id: 'history-back', repeat: 'allow' }, 'Ctrl+Shift+Minus': { id: 'history-forward', repeat: 'allow' },
  });
  assert.equal(env.data.scripts.get(SHORTCUT_SCRIPT_ID).js[0], 'src/page-shortcuts.js');
  assert.equal(env.data.scripts.has('hiraishin-selection-button'), false);

  await store.update(settings => { settings.webShortcuts.bindings = {}; return settings; });
  wanted = await service.sync();
  assert.equal(wanted.shortcuts, false);
  assert.equal(env.data.scripts.has(SHORTCUT_SCRIPT_ID), false);
  assert.equal(env.data.local[PAGE_CONFIG_KEY].floating, null);
  await store.update(settings => { settings.overlay.enabled = false; return settings; });
  wanted = await service.sync();
  assert.equal(wanted.overlay, false);
  assert.equal(env.data.scripts.has(OVERLAY_SCRIPT_ID), false, 'an explicit opt-out unregisters the wheel');
});

test('existing http pages get the wanted scripts injected immediately', async () => {
  const env = createFakeChrome({ granted: true, tabs: [tab(1, 1, 0, true), tab(2, 1, 1, false, { url: 'chrome://extensions' }), tab(3, 2, 0, true)] });
  const service = createShortcutService(env.api, { settingsStore: createSettingsStore(env.api), listActionsFor: listActions });
  const injected = await service.injectExisting({ shortcuts: true });
  assert.equal(injected, 2);
  assert.deepEqual(env.data.executed.map(item => item.target.tabId), [1, 3]);
  assert.equal(await service.injectExisting({ shortcuts: false }), 0);
  assert.equal(await service.pingTab(1), false);
  env.data.pingReply = { ready: true };
  assert.equal(await service.pingTab(1), true);
});


test('upgrading disables and unregisters an enabled legacy selection button without disturbing the wheel', async () => {
  const env = createFakeChrome({ granted: true, tabs: [tab(1, 1, 0, true)], local: {
    [SETTINGS_KEY]: { version: 2, floatingButton: true },
    [PAGE_CONFIG_KEY]: { floating: { targetId: 'chatgpt', targetName: 'ChatGPT', capability: 'send' } },
  } });
  env.data.scripts.set('hiraishin-selection-button', { id: 'hiraishin-selection-button', js: ['src/page-selection-button.js'] });
  const store = createSettingsStore(env.api);
  const service = createShortcutService(env.api, { settingsStore: store, listActionsFor: listActions });
  const wanted = await service.sync();
  assert.equal(env.data.local[PAGE_CONFIG_KEY].floating, null, 'existing listeners receive a hide signal');
  assert.equal(env.data.scripts.has('hiraishin-selection-button'), false);
  assert.equal(env.data.scripts.has(OVERLAY_SCRIPT_ID), true);
  assert.equal('floatingButton' in await store.get(), false);
  await service.injectExisting(wanted.inject);
  assert.deepEqual(env.data.executed.map(item => item.files), [['ui/overlay.js']]);
  await service.sync();
  assert.equal(env.data.scripts.has('hiraishin-selection-button'), false, 'later syncs must not re-register the retired script');
});

test('the wheel runs only in the top frame while web shortcuts cover every frame', async () => {
  const env = createFakeChrome({ granted: true, tabs: [tab(1, 1, 0, true)] });
  const store = createSettingsStore(env.api);
  await store.update(settings => { settings.webShortcuts.bindings['close-right'] = 'Ctrl+Shift+Minus'; return settings; });
  const service = createShortcutService(env.api, { settingsStore: store, listActionsFor: listActions });
  const wanted = await service.sync();
  assert.equal(env.data.scripts.get(OVERLAY_SCRIPT_ID).allFrames, false);
  assert.equal(env.data.scripts.get(OVERLAY_SCRIPT_ID).runAt, 'document_start');
  assert.equal(env.data.scripts.get(SHORTCUT_SCRIPT_ID).allFrames, true);
  await service.injectExisting(wanted.inject);
  const byFile = Object.fromEntries(env.data.executed.map(item => [item.files[0], item.target.allFrames]));
  assert.deepEqual(byFile, { 'src/page-shortcuts.js': true, 'ui/overlay.js': false });
});

test('a wheel registered by an older version in every frame is narrowed to the top frame', async () => {
  const env = createFakeChrome({ granted: true, tabs: [tab(1, 1, 0, true)] });
  env.data.scripts.set(OVERLAY_SCRIPT_ID, { id: OVERLAY_SCRIPT_ID, js: ['ui/overlay.js'], matches: ['http://*/*', 'https://*/*'],
    allFrames: true, runAt: 'document_start', persistAcrossSessions: true });
  const service = createShortcutService(env.api, { settingsStore: createSettingsStore(env.api), listActionsFor: listActions });
  const wanted = await service.sync();
  assert.equal(env.data.scripts.get(OVERLAY_SCRIPT_ID).allFrames, false);
  assert.equal(wanted.inject.overlay, false, 'an existing registration is corrected in place, not re-injected');
});
