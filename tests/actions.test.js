import test from 'node:test';
import assert from 'node:assert/strict';
import { listActions, getAction, searchActions } from '../src/actions.js';
import { normalizeSettings } from '../src/settings.js';

test('action ids are unique and web-triggerable actions exclude panel-input ones', () => {
  const settings = normalizeSettings({ version: 2, targets: { custom: [
    { id: 'notes', name: 'Notes', openUrl: 'https://notes.example/', capability: 'fill' },
    { id: 'wiki', name: 'Wiki', openUrl: 'https://wiki.example/', capability: 'navigate' },
  ] } });
  const actions = listActions(settings);
  assert.equal(new Set(actions.map(action => action.id)).size, actions.length);
  assert.equal(getAction('move-tab-to-index').web, false);
  assert.equal(getAction('move-tab-to-index').command, false);
  // Fill exists only where sending is impossible: notes can fill but not send, wiki only navigates.
  assert.deepEqual(actions.filter(action => action.id.startsWith('target:')).map(action => action.id),
    ['target:go-to-notes', 'target:fill-notes', 'target:go-to-wiki']);
  assert.equal(getAction('target:fill-notes', settings).requiresSelection, true);
  assert.equal(getAction('target:fill-notes'), null);
  assert.equal(getAction('fill-claude'), null, 'a send-capable target offers no separate fill action');
  assert.equal(getAction('send-claude').mode, 'send');
});

test('search ranks name prefixes above keyword matches', () => {
  const actions = listActions();
  assert.equal(searchActions(actions, '关闭')[0].id, 'close-right');
  assert.deepEqual(searchActions(actions, 'claude').map(action => action.id), ['go-to-claude', 'send-claude']);
  assert.equal(searchActions(actions, 'window').every(action => action.kind === 'new-window'), true);
  assert.equal(searchActions(actions, 'zzz').length, 0);
  assert.equal(searchActions(actions, '  ').length, actions.length);
});
