import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesPattern, matchesTarget, resolveTargets, getTarget, createTargetService, BUILTIN_TARGETS } from '../src/targets.js';
import { normalizeSettings } from '../src/settings.js';
import { createFakeChrome, tab } from './fake-chrome.js';

const claude = BUILTIN_TARGETS.find(target => target.id === 'claude');
const chatgpt = BUILTIN_TARGETS.find(target => target.id === 'chatgpt');

test('built-in targets match conversation pages only', () => {
  assert.equal(matchesTarget('https://claude.ai/new', claude), true);
  assert.equal(matchesTarget('https://claude.ai/chat/abc-123#x', claude), true);
  assert.equal(matchesTarget('https://claude.ai/settings/profile', claude), false);
  assert.equal(matchesTarget('https://claude.ai/project/abc', claude), false);
  assert.equal(matchesTarget('https://chatgpt.com/', chatgpt), true);
  assert.equal(matchesTarget('https://chatgpt.com/?model=gpt', chatgpt), true);
  assert.equal(matchesTarget('https://chatgpt.com/c/123', chatgpt), true);
  assert.equal(matchesTarget('https://chatgpt.com/g/g-abc', chatgpt), false);
  assert.equal(matchesTarget('https://chat.openai.com/', chatgpt), false);
  assert.equal(matchesPattern('https://a.b/x.y', 'https://a.b/x.y'), true);
  assert.equal(matchesPattern('https://a.b/xzy', 'https://a.b/x.y'), false);
});

test('settings cap a built-in capability and add custom targets with derived origins', () => {
  const settings = normalizeSettings({ version: 2, defaultTargetId: 'notes', targets: {
    enabled: { chatgpt: 'fill' },
    custom: [{ id: 'notes', name: 'Notes', openUrl: 'https://notes.example/new', match: ['https://notes.example/*', 'https://alt.example/n/*'], capability: 'send' }],
  } });
  const targets = resolveTargets(settings);
  assert.deepEqual(targets.slice(0, 2).map(target => target.id), ['chatgpt', 'claude'], 'ChatGPT leads the list');
  assert.equal(targets.find(target => target.id === 'chatgpt').capability, 'fill');
  assert.equal(targets.find(target => target.id === 'claude').capability, 'send');
  const notes = targets.find(target => target.id === 'notes');
  assert.deepEqual(notes.origins, ['https://notes.example/*', 'https://alt.example/*']);
  assert.equal(notes.site, 'generic');
  assert.equal(getTarget(settings, 'default').id, 'notes');
  assert.equal(getTarget({ ...settings, defaultTargetId: 'missing' }, 'default').id, 'chatgpt');
  assert.equal(getTarget(settings, 'missing'), null);
});

test('find-or-create picks the leftmost match in the source window and never crosses windows', async () => {
  const env = createFakeChrome({ tabs: [
    tab(1, 1, 0, true, { url: 'https://docs.example/a' }),
    tab(2, 1, 1, false, { url: 'https://claude.ai/chat/right' }),
    tab(3, 1, 2, false, { url: 'https://claude.ai/settings' }),
    tab(10, 2, 0, true, { url: 'https://claude.ai/chat/other-window' }),
    tab(11, 2, 1, false, { url: 'https://docs.example/b' }),
  ] });
  const service = createTargetService(env.api);
  const source = await env.api.tabs.get(1);
  const first = await service.findOrCreate(claude, source);
  assert.equal(first.tab.id, 2);
  assert.equal(first.created, false);
  assert.equal(env.active(1), 2);
  const other = await env.api.tabs.get(11);
  const [a, b] = await Promise.all([service.findOrCreate(chatgpt, other), service.findOrCreate(chatgpt, other)]);
  assert.equal(a.created, true);
  assert.equal(b.tab.id, a.tab.id, 'concurrent triggers share one new tab');
  assert.equal(env.data.created.length, 1);
  assert.deepEqual(env.order(2), [10, 11, a.tab.id]);
  assert.equal(a.tab.url, 'https://chatgpt.com/');
  assert.equal(env.active(2), a.tab.id);
});
