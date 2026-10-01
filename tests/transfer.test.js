import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransfer, TASKS_KEY, CLEANUP_ALARM, RETENTION_MS } from '../src/transfer.js';
import { createTargetService } from '../src/targets.js';
import { createSettingsStore, SETTINGS_KEY } from '../src/settings.js';
import { createSelectionReader } from '../src/selection.js';
import { createFakeChrome, tab } from './fake-chrome.js';
import { setLocale } from '../src/i18n.js';

setLocale('zh'); // The assertions below match the Chinese messages.

function setup({ settings = {}, adapter, selection = 'selected words', tabs, granted = true } = {}) {
  const env = createFakeChrome({
    tabs: tabs ?? [tab(1, 1, 0, true, { url: 'https://docs.example/a' }), tab(2, 1, 1, false, { url: 'https://claude.ai/chat/x' })],
    local: { [SETTINGS_KEY]: { version: 2, ...settings } },
  });
  if (granted) env.data.grantedOrigins.add('https://claude.ai/*').add('https://chatgpt.com/*');
  env.data.selectionText = selection;
  const calls = [];
  const states = { probe: { state: 'ready', draft: '' }, fill: { ok: true }, submit: { submitted: true }, focus: { ok: true }, ...adapter };
  env.data.adapter = async (op, payload, tabId) => {
    calls.push({ op, tabId, text: payload.text, mode: payload.mode });
    const value = states[op];
    return typeof value === 'function' ? value(payload, calls) : value;
  };
  let clock = 1_000_000;
  const transfer = createTransfer(env.api, {
    targets: createTargetService(env.api), settingsStore: createSettingsStore(env.api),
    readSelection: createSelectionReader(env.api), now: () => (clock += 1),
  });
  return { env, transfer, calls, tick: ms => { clock += ms; } };
}

test('send fills, submits, stays on the target and records a done task with no notification', async () => {
  const { env, transfer, calls } = setup();
  const result = await transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(result.status, 'sent');
  assert.equal(result.notify, false);
  assert.equal(env.active(1), 2, 'stays on the target by default');
  assert.deepEqual(calls.map(call => call.op), ['probe', 'fill', 'submit']);
  assert.equal(calls[1].text, 'selected words');
  assert.equal(calls[1].mode, 'replace');
  assert.deepEqual(Object.values(env.data.session[TASKS_KEY]), [], 'successful tasks leave no residue');
  assert.equal(env.data.alarms.has(CLEANUP_ALARM), false);
});

test('a target that closes mid-flight or a blocked source page is reported, never left running', async () => {
  const closing = setup({ adapter: { fill: () => { throw new Error('No tab with id: 2'); } } });
  closing.env.data.adapter = async (op, payload, tabId) => { if (op === 'fill') { closing.env.data.executeError = new Error('No tab with id: 2'); throw closing.env.data.executeError; } return { probe: { state: 'ready', draft: '' } }[op]; };
  const gone = await closing.transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(gone.status, 'target-gone');
  assert.equal(Object.values(closing.env.data.session[TASKS_KEY]).every(task => task.state !== 'running'), true);

  const blocked = setup();
  blocked.env.data.executeError = new Error('Cannot access a chrome:// URL');
  const result = await blocked.transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(result.status, 'selection-blocked');
  assert.match(result.message, /无法读取选区/);
});

test('return-after-send goes back only when the user is still on the target', async () => {
  const { env, transfer } = setup({ settings: { returnAfterSend: true } });
  const result = await transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(result.returned, true);
  assert.equal(env.active(1), 1);

  const away = setup({ settings: { returnAfterSend: true }, adapter: { submit: () => { away.env.setActive(1); return { submitted: true }; } } });
  const second = await away.transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(second.returned, false, 'the user already switched; do not steal focus');
});

test('fill appends and never submits; a non-empty draft blocks send and keeps the selection', async () => {
  const { env, transfer, calls } = setup({ adapter: { probe: { state: 'ready', draft: 'my draft' } } });
  const filled = await transfer.run({ mode: 'fill', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(filled.status, 'filled');
  assert.deepEqual(calls.map(call => call.op), ['probe', 'fill']);
  assert.equal(calls[1].mode, 'append');

  const blocked = await transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(blocked.status, 'draft');
  assert.equal(blocked.notify, true);
  assert.match(blocked.message, /草稿/);
  assert.equal(calls.filter(call => call.op === 'fill').length, 1, 'send did not touch the draft');
  const failed = (await transfer.list())[0];
  assert.equal(failed.status, 'draft');
  assert.equal(failed.text, 'selected words');
  assert.equal(env.data.alarms.get(CLEANUP_ALARM).when, failed.failedAt + RETENTION_MS);
});

test('login, generating, not-ready, uncertain and cannot-submit are reported distinctly', async () => {
  for (const [adapter, status] of [
    [{ probe: { state: 'login', draft: '' } }, 'login'],
    [{ probe: { state: 'generating', draft: '' } }, 'generating'],
    [{ probe: { state: 'missing', draft: '' } }, 'not-ready'],
    [{ submit: { submitted: 'uncertain' } }, 'uncertain'],
    [{ submit: { submitted: false, reason: 'send-disabled' } }, 'cannot-submit'],
    [{ fill: { ok: false } }, 'fill-failed'],
  ]) {
    const { transfer, tick } = setup({ adapter });
    const pending = transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
    // The readiness poll sleeps between probes; advance the fake clock past the timeout for 'missing'.
    const advance = setInterval(() => tick(5000), 1);
    const result = await pending;
    clearInterval(advance);
    assert.equal(result.status, status, JSON.stringify(adapter));
    assert.equal(result.notify, true);
  }
});

test('empty selections, missing permission and unsupported targets stop before touching the page', async () => {
  const empty = setup({ selection: '   ' });
  assert.equal((await empty.transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } })).status, 'no-selection');
  assert.equal(empty.calls.length, 0);

  const denied = setup({ granted: false });
  const result = await denied.transfer.run({ mode: 'fill', targetId: 'claude', ctx: { tabId: 1 } });
  assert.equal(result.status, 'needs-permission');
  assert.equal(denied.env.active(1), 2, 'the tab switch itself does not need permission');
  assert.equal(denied.calls.length, 0);

  const capped = setup({ settings: { targets: { enabled: { claude: 'navigate' } } } });
  assert.equal((await capped.transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } })).status, 'unsupported');
  assert.equal((await capped.transfer.run({ mode: 'go', targetId: 'claude', ctx: { tabId: 1 } })).status, 'navigated');
});

test('go creates the target right of the source when none matches and focuses the input', async () => {
  const { env, transfer, calls } = setup({ tabs: [tab(1, 1, 0, true, { url: 'https://docs.example/a' }), tab(2, 1, 1)] });
  const result = await transfer.run({ mode: 'go', targetId: 'chatgpt', ctx: { tabId: 1 } });
  assert.equal(result.status, 'navigated');
  assert.deepEqual(env.order(1).slice(0, 2), [1, env.data.created[0].id]);
  assert.equal(env.data.created[0].url, 'https://chatgpt.com/');
  assert.deepEqual(calls.map(call => call.op), ['focus']);
});

test('sends to one target run in order and the context-menu fallback text is used when injection fails', async () => {
  const order = [];
  const { env, transfer } = setup({ adapter: { fill: payload => { order.push(payload.text); return { ok: true }; } } });
  await Promise.all([
    transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1, selectionText: 'first' } }),
    transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1, selectionText: 'second' } }),
  ]);
  assert.deepEqual(order, ['first', 'second']);

  env.data.selectionText = '';
  const fallback = await transfer.run({ mode: 'fill', targetId: 'claude', ctx: { tabId: 1, fallbackText: 'menu text' } });
  assert.equal(fallback.status, 'filled');
  assert.match(fallback.formatNote, /右键/);
});

test('retry re-runs a failed task as fill with its saved text; expired tasks are purged', async () => {
  const { env, transfer, calls, tick } = setup({ adapter: { probe: { state: 'ready', draft: 'draft' } } });
  const blocked = await transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1 } });
  env.data.selectionText = '';
  const retried = await transfer.retry(blocked.taskId, { tabId: 2, windowId: 1 });
  assert.equal(retried.status, 'filled');
  assert.equal(calls.at(-1).text, 'selected words');
  assert.equal((await transfer.list()).length, 0);

  const again = await transfer.run({ mode: 'send', targetId: 'claude', ctx: { tabId: 1, selectionText: 'x' } });
  assert.equal(again.status, 'draft');
  tick(RETENTION_MS + 10);
  await transfer.onAlarm({ name: CLEANUP_ALARM });
  assert.equal((await transfer.list()).length, 0);
  assert.equal(env.data.alarms.has(CLEANUP_ALARM), false);
  await transfer.remove('missing');
});
