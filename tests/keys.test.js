import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCombo, normalizeCombo, normalizeNative, comboFromEvent, nativeEligible, webEligible, reservedReason } from '../src/keys.js';
import { setLocale } from '../src/i18n.js';

setLocale('zh'); // The assertions below match the Chinese messages.

test('combos parse from manifest, symbol and loose spellings into one canonical form', () => {
  assert.equal(normalizeCombo('Ctrl+Shift+Minus'), 'Ctrl+Shift+Minus');
  assert.equal(normalizeCombo('shift + ctrl + -'), 'Ctrl+Shift+Minus');
  assert.equal(normalizeCombo('⌃⌘,'), 'Command+MacCtrl+Comma');
  assert.equal(normalizeCombo('Command+Shift+Y'), 'Shift+Command+Y');
  assert.equal(normalizeCombo('Alt+Left'), 'Alt+Left');
  assert.equal(normalizeCombo(''), '');
  assert.equal(normalizeCombo('Ctrl+'), '');
  assert.equal(normalizeCombo('Ctrl+A+B'), '');
  assert.deepEqual(parseCombo('Ctrl+Comma'), { modifiers: ['Ctrl'], key: 'Comma' });
});

test('native bindings from Chrome map Ctrl to Command on macOS only', () => {
  assert.equal(normalizeNative('Ctrl+Comma', 'mac'), 'Command+Comma');
  assert.equal(normalizeNative('MacCtrl+Comma', 'mac'), 'MacCtrl+Comma');
  assert.equal(normalizeNative('Ctrl+Comma', 'win'), 'Ctrl+Comma');
  assert.equal(normalizeNative('', 'mac'), '');
});

test('keyboard events become platform-specific combos and need a primary modifier', () => {
  const event = (code, mods) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  assert.equal(comboFromEvent(event('Minus', { ctrlKey: true }), 'win'), 'Ctrl+Minus');
  assert.equal(comboFromEvent(event('NumpadSubtract', { ctrlKey: true, shiftKey: true }), 'linux'), 'Ctrl+Shift+Minus');
  assert.equal(comboFromEvent(event('Minus', { ctrlKey: true }), 'mac'), 'MacCtrl+Minus');
  assert.equal(comboFromEvent(event('KeyK', { metaKey: true, shiftKey: true }), 'mac'), 'Shift+Command+K');
  assert.equal(comboFromEvent(event('KeyK', { shiftKey: true }), 'mac'), null);
  assert.equal(comboFromEvent(event('ShiftLeft', { shiftKey: true, ctrlKey: true }), 'win'), null);
});

test('native eligibility follows Chrome command rules; web eligibility is looser', () => {
  assert.equal(nativeEligible('Ctrl+Comma', 'win'), true);
  assert.equal(nativeEligible('Ctrl+Shift+Comma', 'win'), true);
  assert.equal(nativeEligible('Ctrl+Minus', 'win'), false);
  assert.equal(nativeEligible('Ctrl+Alt+A', 'win'), false);
  assert.equal(nativeEligible('Shift+A', 'win'), false);
  assert.equal(nativeEligible('Command+Comma', 'mac'), true);
  assert.equal(nativeEligible('Ctrl+Comma', 'mac'), false);
  assert.equal(webEligible('Ctrl+Minus'), true);
  assert.equal(webEligible('Shift+Minus'), false);
});

test('known browser and OS combos are flagged as reserved per platform', () => {
  assert.match(reservedReason('Ctrl+T', 'win'), /保留/);
  assert.equal(reservedReason('Ctrl+Minus', 'win'), '');
  assert.match(reservedReason('Command+Space', 'mac'), /macOS/);
  assert.equal(reservedReason('Command+Space', 'win'), '');
  assert.equal(reservedReason('nonsense', 'mac'), '');
});
