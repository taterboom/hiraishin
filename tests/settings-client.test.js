import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsClient } from '../ui/options/settings-client.js';
import { createController } from '../src/controller.js';
import { createFakeChrome } from './fake-chrome.js';

function setup() {
  const env = createFakeChrome();
  const controller = createController(env.api);
  const message = (type, data = {}) => controller.handleMessage({ type, ...data });
  const api = {
    getSettings: () => message('get-settings'),
    saveSettings: settings => message('save-settings', { settings }),
    setWebBinding: (actionId, combo) => message('set-web-binding', { actionId, combo }),
    syncPage: () => message('sync-page'),
  };
  const views = [];
  return { env, api, views, client: createSettingsClient(api, view => views.push(view)) };
}

test('rapid edits, shortcut changes and refreshes preserve each other', async () => {
  const { client, views } = setup();
  await client.load();
  await Promise.all([
    client.save(settings => { settings.overlay.holdCode = 'Control'; }),
    client.save(settings => { settings.overlay.slots = settings.overlay.slots.slice(0, 4); }),
    client.setBinding('copy-links', 'Ctrl+Shift+C'),
    client.load(),
    client.save(settings => { settings.overlay.slots[0] = 'copy-links'; }),
    client.save(settings => { settings.overlay.slots[1] = 'duplicate-tab'; }),
    client.sync(),
  ]);
  const final = views.at(-1).settings;
  assert.equal(final.overlay.holdCode, 'Control');
  assert.deepEqual(final.overlay.slots, ['copy-links', 'duplicate-tab', 'switch-previous-tab', 'close-right']);
  assert.equal(final.webShortcuts.bindings['copy-links'], 'Ctrl+Shift+C');
});

test('failed saves leave later edits usable and do not replay the failed change', async () => {
  const { api, client } = setup();
  const save = api.saveSettings;
  let first = true;
  api.saveSettings = settings => {
    if (first) { first = false; return Promise.reject(new Error('failed save')); }
    return save(settings);
  };
  const a = client.save(settings => { settings.overlay.holdCode = 'Control'; });
  const b = client.save(settings => { settings.returnAfterSend = true; });
  await assert.rejects(a, /failed save/);
  assert.equal((await b).settings.returnAfterSend, true);
  assert.equal((await client.load()).settings.overlay.holdCode, 'auto');
});
