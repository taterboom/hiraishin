import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabOps, movementRange } from '../src/tab-ops.js';
import { createFakeChrome, tab } from './fake-chrome.js';
import { setLocale } from '../src/i18n.js';

setLocale('zh'); // The assertions below match the Chinese messages.

test('movement stays inside the pinned region and the current tab group', () => {
  const tabs = [
    tab(1, 1, 0, false, { pinned: true }), tab(2, 1, 1, false, { pinned: true }),
    tab(3, 1, 2), tab(4, 1, 3, false, { groupId: 7 }), tab(5, 1, 4, true, { groupId: 7 }), tab(6, 1, 5), tab(7, 1, 6),
  ];
  assert.deepEqual(movementRange(tabs, tabs[4]).map(item => item.id), [4, 5]);
  assert.deepEqual(movementRange(tabs, tabs[1]).map(item => item.id), [1, 2]);
  assert.deepEqual(movementRange(tabs, tabs[5]).map(item => item.id), [6, 7]);
  assert.deepEqual(movementRange(tabs, tabs[2]).map(item => item.id), [3]);
});

test('left/right/first/last move within range and report boundaries as no-ops', async () => {
  const env = createFakeChrome({ tabs: [tab(1, 1, 0, false, { pinned: true }), tab(2, 1, 1), tab(3, 1, 2, true), tab(4, 1, 3)] });
  const ops = createTabOps(env.api);
  assert.equal((await ops.move(1, 'left')).status, 'ok');
  assert.deepEqual(env.order(1), [1, 3, 2, 4]);
  assert.equal((await ops.move(1, 'left')).status, 'noop', 'pinned region is a boundary');
  assert.equal((await ops.move(1, 'last')).index, 3);
  assert.deepEqual(env.order(1), [1, 2, 4, 3]);
  assert.equal((await ops.move(1, 'right')).status, 'noop');
  assert.equal((await ops.move(1, 'first')).index, 1);
  assert.deepEqual(env.order(1), [1, 3, 2, 4]);
  await assert.rejects(ops.move(1, 'sideways'), /无效/);
});

test('move to a position clamps into the region that matches the pinned state', async () => {
  const env = createFakeChrome({ tabs: [tab(1, 1, 0, false, { pinned: true }), tab(2, 1, 1, true), tab(3, 1, 2), tab(4, 1, 3)] });
  const ops = createTabOps(env.api);
  assert.equal((await ops.moveToIndex(1, 99)).index, 3);
  assert.deepEqual(env.order(1), [1, 3, 4, 2]);
  assert.equal((await ops.moveToIndex(1, 1)).index, 1, 'cannot enter the pinned region');
  assert.deepEqual(env.order(1), [1, 2, 3, 4]);
  assert.equal((await ops.moveToIndex(1, 2)).status, 'noop');
  await assert.rejects(ops.moveToIndex(1, Number.NaN), /位置/);
});

test('current-and-right moves to a new window keeping order, pinned state and groups', async () => {
  const env = createFakeChrome({
    tabs: [tab(1, 1, 0), tab(2, 1, 1, true, { pinned: true }), tab(3, 1, 2, false, { groupId: 5 }), tab(4, 1, 3, false, { groupId: 5 }), tab(5, 1, 4)],
    groups: { 5: { title: 'Research', color: 'blue' } },
  });
  const ops = createTabOps(env.api);
  const result = await ops.newWindow(1, 'with-right');
  assert.equal(result.movedCount, 4);
  assert.deepEqual(env.order(1), [1]);
  assert.deepEqual(env.order(result.windowId), [2, 3, 4, 5]);
  assert.equal(env.data.tabs.find(item => item.id === 2).pinned, true);
  const regrouped = env.data.tabs.find(item => item.id === 3).groupId;
  assert.notEqual(regrouped, 5);
  assert.equal(env.data.tabs.find(item => item.id === 4).groupId, regrouped);
  assert.equal(env.data.tabs.find(item => item.id === 5).groupId, -1);
  assert.deepEqual(env.data.groups.get(regrouped), { title: 'Research', color: 'blue' });
  assert.equal(env.active(result.windowId), 2);
  assert.equal((await ops.newWindow(1, 'current')).status, 'noop', 'a lone tab cannot be split off');
});

test('duplicate activates the copy next to its source; links copy in plain or Markdown form', async () => {
  const env = createFakeChrome({ tabs: [tab(1, 1, 0, true, { title: 'One [a]' }), tab(2, 1, 1), tab(3, 1, 2)] });
  const ops = createTabOps(env.api);
  const copy = await ops.duplicate(1);
  assert.deepEqual(env.order(1), [1, copy.tabId, 2, 3]);
  assert.equal(env.active(1), copy.tabId);
  env.setActive(1);
  assert.deepEqual(await ops.copyLinks(1, 'plain'), { status: 'ok', text: 'https://example.com/1', count: 1 });
  assert.equal((await ops.copyLinks(1, 'markdown')).text, '[One \\[a\\]](https://example.com/1)');
  env.data.tabs.find(item => item.id === 3).highlighted = true;
  const multi = await ops.copyLinks(1, 'markdown');
  assert.equal(multi.count, 2);
  assert.equal(multi.text, '- [One \\[a\\]](https://example.com/1)\n- [Tab 3](https://example.com/3)');
});

test('previous tab comes from lastAccessed, excluding the active tab and other windows', async () => {
  const env = createFakeChrome({ tabs: [
    tab(1, 1, 0, true, { lastAccessed: 50 }), tab(2, 1, 1, false, { lastAccessed: 40 }), tab(3, 1, 2, false, { lastAccessed: 45 }), tab(9, 2, 0, true, { lastAccessed: 99 }),
  ] });
  const ops = createTabOps(env.api);
  assert.equal((await ops.previousTab(1)).tabId, 3, 'the most recently active other tab, not the newest overall');
  assert.equal(env.active(1), 3);
  assert.equal((await ops.previousTab(1)).tabId, 1, 'toggling returns to the tab we came from');
  const lonely = createTabOps(createFakeChrome({ tabs: [tab(1, 1, 0, true)] }).api);
  assert.equal((await lonely.previousTab(1)).status, 'noop');
});

test('the neighbouring tab is the one beside it in the strip, wrapping at both ends', async () => {
  const env = createFakeChrome({ tabs: [
    tab(1, 1, 0, false, { pinned: true }), tab(2, 1, 1, true), tab(3, 1, 2), tab(9, 2, 0, true),
  ] });
  const ops = createTabOps(env.api);
  assert.equal((await ops.activateRelative(1, 1)).tabId, 3);
  assert.equal(env.active(1), 3);
  assert.equal((await ops.activateRelative(1, 1)).tabId, 1, 'past the last tab comes the first, pinned included');
  assert.equal((await ops.activateRelative(1, -1)).tabId, 3, 'and back the other way');
  assert.equal(env.active(2), 9, 'other windows are untouched');
  const lonely = createTabOps(createFakeChrome({ tabs: [tab(1, 1, 0, true)] }).api);
  assert.equal((await lonely.activateRelative(1, 1)).status, 'noop', 'nowhere to go in a one-tab window');
});
