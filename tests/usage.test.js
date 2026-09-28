import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageStore, normalizeUsage, USAGE_KEY } from '../src/usage.js';
import { createFakeChrome } from './fake-chrome.js';

test('concurrent counts are retained by action and source across store restarts', async () => {
  const env = createFakeChrome();
  const store = createUsageStore(env.api, { now: () => 1000 });
  await Promise.all(Array.from({ length: 40 }, (_, i) => store.record('copy-links', i % 2 ? 'overlay' : 'popup')));
  await store.record('send-default-target', 'web');
  const restored = await createUsageStore(env.api).get();
  assert.deepEqual(restored, { version: 1, startedAt: 1000, actions: {
    'copy-links': { overlay: 20, popup: 20 }, 'send-default-target': { web: 1 },
  } });
  assert.deepEqual(Object.keys(env.data.local), [USAGE_KEY]);
});

test('reset is ordered with pending operations and a failed write does not poison the queue', async () => {
  const env = createFakeChrome();
  const store = createUsageStore(env.api);
  await Promise.all([store.record('copy-links', 'popup'), store.reset(), store.record('copy-links', 'command')]);
  assert.deepEqual((await store.get()).actions, { 'copy-links': { command: 1 } });
  const set = env.api.storage.local.set;
  env.api.storage.local.set = async () => { throw new Error('full'); };
  await assert.rejects(store.record('copy-links', 'popup'), /full/);
  env.api.storage.local.set = set;
  await store.record('copy-links', 'popup');
  assert.deepEqual((await store.get()).actions, { 'copy-links': { popup: 1, command: 1 } });
  assert.deepEqual(await store.reset(), { version: 1, startedAt: null, actions: {} });
});

test('stored counts accept only bounded integers and known sources, never page data', () => {
  const normalized = normalizeUsage({ version: 1, startedAt: -1, url: 'https://private.example/', actions: {
    'copy-links': { popup: 3, command: -1, web: 0.2, menu: Infinity, text: 'selected text' },
    'https://private.example/': { popup: 9 },
  } });
  assert.deepEqual(normalized, { version: 1, startedAt: null, actions: { 'copy-links': { popup: 3 } } });
});
