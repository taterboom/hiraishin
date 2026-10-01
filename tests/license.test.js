import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, lockedMessage, SETTINGS_KEY } from '../src/controller.js';
import { LICENSE_KEY, SYNC_KEY, REFRESH_ALARM, TRIAL_MS, OFFLINE_GRACE_MS, REFRESH_MS } from '../src/license.js';
import { USAGE_KEY } from '../src/usage.js';
import { createFakeChrome, tab } from './fake-chrome.js';

const HOUR = 60 * 60 * 1000;
const KEY = 'MK-ABCDE-FGHJK-MNPQR-STVWX-YZ012';
const b64url = bytes => Buffer.from(bytes).toString('base64url');

// A real ES256 key pair stands in for Menkyo's signing key.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
const publicJwk = { kty, crv, x, y };

async function signToken(payload, privateKey = pair.privateKey) {
  const input = `${b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(signature))}`;
}

/** Fake Menkyo: `mode` simulates outages; `paid` controls whether the purchase has been confirmed. */
function fakeMenkyo(clock) {
  const server = { mode: 'up', paid: false, revoked: false, credential: 'cred-1', calls: [], bodies: [] };
  const token = async () => signToken({ iss: 'menkyo', bk: 'hiraishin', sub: 'hash', iat: Math.floor(clock.now / 1000), exp: Math.floor(clock.now / 1000) + 30 * 24 * 3600 });
  const reply = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  server.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    server.calls.push(path);
    server.bodies.push(body);
    if (server.mode === 'offline') throw new TypeError('Failed to fetch');
    if (server.mode === 'down') return reply(503);
    if (path === '/purchase') return reply(200, { claim_credential: server.credential, purchase_url: 'https://buy.stripe.com/test?client_reference_id=abc' });
    if (path === '/license/collect') {
      if (body.claim_credential !== server.credential || !server.paid) return reply(404, { error: 'not_found' });
      return reply(server.revoked ? 403 : 200, server.revoked ? { error: 'license_revoked' } : { license_key: KEY });
    }
    if (path === '/license/claim') {
      const key = String(body.license_key).trim().toUpperCase().replace(/\s+/g, '');
      return key === KEY && !server.revoked ? reply(200, { token: await token() }) : reply(404, { error: 'no_active_license' });
    }
    if (path === '/license/refresh') return server.revoked ? reply(403, { error: 'license_revoked' }) : reply(200, { token: await token() });
    return reply(404);
  };
  return server;
}

function browser({ license, settings = {}, tabs, granted = false, sync } = {}) {
  const clock = { now: Date.UTC(2026, 9, 1) };
  const server = fakeMenkyo(clock);
  const env = createFakeChrome({ tabs, granted, local: { [SETTINGS_KEY]: settings, ...(license ? { [LICENSE_KEY]: license(clock.now) } : {}) } });
  if (sync) env.data.sync[SYNC_KEY] = sync;
  const controller = createController(env.api, {
    license: { fetch: server.fetch, now: () => clock.now, random: () => 0.5, serviceUrl: 'https://menkyo.test', publicJwk },
  });
  env.data.onActivated = info => controller.onActivated(info);
  return {
    env, data: env.data, controller, clock, server,
    message: (type, options = {}, sender = popupSender) => controller.handleMessage({ type, ...options }, sender),
    license: async () => (await controller.handleMessage({ type: 'get-license' }, popupSender)).license,
    stored: () => env.data.local[LICENSE_KEY],
  };
}
const popupSender = { id: 'ext', url: 'chrome-extension://ext/popup.html' };
const pageSender = tabId => ({ id: 'ext', url: 'https://example.com/page', tab: { id: tabId }, frameId: 0 });
const expiredTrial = now => ({ version: 1, trialStartedAt: now - TRIAL_MS - 1 });

test('an expired trial refuses every path that performs an operation, and counts none of them', async () => {
  const env = browser({
    license: expiredTrial, granted: true,
    settings: { version: 4, overlay: { enabled: true, slots: ['duplicate-tab', 'close-right', null, null] },
      webShortcuts: { bindings: { 'duplicate-tab': 'Ctrl+Shift+D' } } },
    tabs: [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2)],
  });
  await env.controller.ready();
  env.env.setActive(2);
  await env.controller.onActivated({ tabId: 2, windowId: 1 });
  env.env.setActive(1);
  await env.controller.onActivated({ tabId: 1, windowId: 1 });
  // Startup injects content scripts into open pages; only what happens after this point matters.
  const before = { tabs: structuredClone(env.data.tabs), updates: env.data.updates.length, executed: env.data.executed.length };
  const locked = new RegExp(lockedMessage().slice(0, 5));

  // runAction entries return a refusal; command, web and overlay entries also notify.
  assert.equal((await env.controller.onCommand('duplicate-tab', { id: 1, windowId: 1 })).status, 'license-required');
  assert.equal((await env.message('run-action', { id: 'duplicate-tab', windowId: 1 })).status, 'license-required');
  assert.equal((await env.message('web-shortcut', { actionId: 'duplicate-tab', combo: 'Ctrl+Shift+D' }, pageSender(1))).status, 'license-required');
  assert.equal((await env.message('overlay-action', { id: 'duplicate-tab' }, pageSender(1))).status, 'license-required');
  assert.equal((await env.controller.onMenuClicked({ menuItemId: 'send:chatgpt', selectionText: 'x', frameId: 0 }, { id: 1, windowId: 1 })).status, 'license-required');
  // Paths that bypass runAction are refused before they preview or execute anything.
  await assert.rejects(env.message('overlay-action', { id: 'close-right' }, pageSender(1)), locked);
  await assert.rejects(env.message('overlay-confirm-action', { id: 'close-right', token: 't' }, pageSender(1)), locked);
  await assert.rejects(env.message('popup-close-preview', { windowId: 1 }), locked);
  await assert.rejects(env.message('popup-close-confirm', { windowId: 1, token: 't' }), locked);
  await assert.rejects(env.message('navigate', { windowId: 1, direction: -1 }), locked);
  await assert.rejects(env.message('close-right', { windowId: 1 }), locked);
  await assert.rejects(env.message('jump', { windowId: 1, cursor: 0, tabId: 1 }), locked);
  await assert.rejects(env.message('retry-task', { taskId: 'any', windowId: 1 }), locked);

  assert.deepEqual(env.data.tabs, before.tabs, 'no tab was created, moved or closed');
  assert.equal(env.data.updates.length, before.updates, 'no tab was activated');
  assert.equal(env.data.executed.length, before.executed, 'no transfer touched a page');
  assert.equal(env.data.notifications.length, 4, 'command, web shortcut, overlay and menu each notify once');
  assert.deepEqual(env.data.local[USAGE_KEY]?.actions ?? {}, {}, 'refused attempts are not counted');

  // Configuration, purchase and recovery stay reachable.
  assert.equal((await env.message('get-state', { windowId: 1 })).state.license.state, 'expired');
  assert.ok((await env.message('get-settings')).settings);
  assert.deepEqual((await env.message('list-tasks')).tasks, []);
  assert.ok(await env.message('get-usage'));
});

test('the same paths run normally during the trial and after purchase', async () => {
  for (const license of [undefined, now => ({ version: 1, trialStartedAt: now - TRIAL_MS - 1, token: null })]) {
    const env = browser({ license, tabs: [tab(1, 1, 0, true), tab(2, 1, 1)] });
    await env.controller.ready();
    if (license) await env.message('activate-license', { licenseKey: KEY });
    assert.equal((await env.message('run-action', { id: 'duplicate-tab', windowId: 1 })).status, 'ok');
    assert.equal((await env.message('close-right', { windowId: 1 })).closedCount, 1, 'the duplicate is active; tab 2 is to its right');
  }
});

test('the trial starts at the first successful action, not at failures, no-ops or refusals', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true)] });
  await env.controller.ready();
  assert.equal((await env.license()).trialStarted, false);
  await env.message('navigate', { windowId: 1, direction: -1 });
  await env.message('run-action', { id: 'move-tab-left', windowId: 1 });
  await env.message('close-right', { windowId: 1 });
  assert.equal(env.stored()?.trialStartedAt ?? null, null, 'no-ops leave the trial unstarted');
  const started = env.clock.now;
  assert.equal((await env.message('run-action', { id: 'duplicate-tab', windowId: 1 })).status, 'ok');
  assert.equal(env.stored().trialStartedAt, started);
  env.clock.now += HOUR;
  await env.message('run-action', { id: 'duplicate-tab', windowId: 1 });
  assert.equal(env.stored().trialStartedAt, started, 'later successes do not reset the start');
  assert.equal((await env.license()).trialEndsAt, started + TRIAL_MS);
  env.clock.now = started + TRIAL_MS + 1;
  assert.equal((await env.message('run-action', { id: 'duplicate-tab', windowId: 1 })).status, 'license-required');
});

test('purchase stores a claim credential, waits for payment, then collects and activates', async () => {
  const env = browser({ license: expiredTrial });
  await env.controller.ready();
  await env.message('start-purchase');
  assert.equal(env.data.created.at(-1).url, 'https://buy.stripe.com/test?client_reference_id=abc');
  assert.deepEqual(env.server.bodies[env.server.calls.lastIndexOf('/purchase')], { business_key: 'hiraishin', locale: 'zh' },
    'the checkout follows the interface language');
  assert.equal(env.stored().credential, 'cred-1');
  assert.equal(env.data.sync[SYNC_KEY].credential, 'cred-1', 'mirrored for recovery after reinstall');

  const pending = await env.message('collect-license');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.license.allowed, false);

  env.server.paid = true;
  const collected = await env.message('collect-license');
  assert.equal(collected.status, 'activated');
  assert.equal(collected.licenseKey, KEY);
  assert.equal(collected.license.state, 'licensed');
  assert.equal(env.stored().credential, null, 'the credential is dropped once the key is collected');
  assert.equal(env.data.sync[SYNC_KEY].licenseKey, KEY);
  assert.equal((await env.message('collect-license')).status, 'none');
});

test('activation accepts pasted keys regardless of case and spacing; wrong keys are refused', async () => {
  const env = browser({ license: expiredTrial });
  await assert.rejects(env.message('activate-license', { licenseKey: 'MK-00000-00000-00000-00000-00000' }), /授权码无效/);
  const { license } = await env.message('activate-license', { licenseKey: ` ${KEY.toLowerCase().replaceAll('-', ' - ')} ` });
  assert.equal(license.state, 'licensed');
  assert.equal(license.licenseKey, KEY);
});

test('only a signature from the Menkyo key, for this product, counts as purchased', async () => {
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const now = Math.floor(Date.UTC(2026, 9, 1) / 1000);
  const payload = { iss: 'menkyo', bk: 'hiraishin', sub: 'h', iat: now, exp: now + 3600 };
  const genuine = await signToken(payload);
  const [h, , s] = genuine.split('.');
  const tampered = `${h}.${b64url(JSON.stringify({ ...payload, exp: now + 10 ** 9 }))}.${s}`;
  for (const token of [await signToken(payload, other.privateKey), tampered, await signToken({ ...payload, bk: 'other' }), 'not.a.token']) {
    const env = browser({ license: n => ({ ...expiredTrial(n), token }) });
    assert.equal((await env.license()).allowed, false, token.slice(0, 20));
  }
  const env = browser({ license: n => ({ ...expiredTrial(n), token: genuine }) });
  assert.equal((await env.license()).state, 'licensed');
});

test('network and server failures keep a purchase within the offline grace; only revocation ends it', async () => {
  const env = browser({ license: expiredTrial });
  await env.message('activate-license', { licenseKey: KEY });
  const tokenExp = (env.clock.now + 30 * 24 * HOUR);

  for (const mode of ['offline', 'down']) {
    env.server.mode = mode;
    env.clock.now += HOUR;
    assert.equal((await env.message('refresh-license')).license.state, 'licensed', mode);
  }
  env.clock.now = tokenExp + OFFLINE_GRACE_MS - HOUR;
  assert.equal((await env.license()).allowed, true, 'still usable inside the grace period');
  env.clock.now = tokenExp + OFFLINE_GRACE_MS + HOUR;
  assert.equal((await env.license()).state, 'expired', 'grace is bounded');

  const revoked = browser({ license: expiredTrial });
  await revoked.message('activate-license', { licenseKey: KEY });
  revoked.server.revoked = true;
  const after = (await revoked.message('refresh-license')).license;
  assert.equal(after.state, 'revoked');
  assert.equal(after.allowed, false);
  assert.equal(after.licenseKey, KEY, 'the key stays visible so the user can contact support');
  assert.equal(revoked.data.alarms.has(REFRESH_ALARM), false, 'no further refreshes after revocation');
});

test('refresh runs about once a day, backs off on failure, and never polls continuously', async () => {
  const env = browser({ license: expiredTrial });
  await env.message('activate-license', { licenseKey: KEY });
  assert.equal(env.data.alarms.get(REFRESH_ALARM).when, env.clock.now + REFRESH_MS, 'daily (jitter fixed at the midpoint)');

  env.server.mode = 'offline';
  const delays = [];
  for (let i = 0; i < 7; i++) {
    await env.controller.onAlarm({ name: REFRESH_ALARM });
    delays.push((env.data.alarms.get(REFRESH_ALARM).when - env.clock.now) / HOUR);
  }
  assert.deepEqual(delays, [1, 2, 4, 8, 16, 24, 24]);

  env.server.mode = 'up';
  await env.controller.onAlarm({ name: REFRESH_ALARM });
  assert.equal(env.data.alarms.get(REFRESH_ALARM).when, env.clock.now + REFRESH_MS, 'success resets the schedule');
  const calls = env.server.calls.length;
  await env.controller.onAlarm({ name: 'hiraishin-task-cleanup' });
  assert.equal(env.server.calls.length, calls, 'other alarms do not trigger a refresh');
});

test('a reinstall on the same Chrome profile recovers the key through storage.sync', async () => {
  const env = browser({ sync: { credential: null, licenseKey: KEY } });
  await env.controller.ready();
  const license = await env.license();
  assert.equal(license.state, 'licensed');
  assert.equal(license.licenseKey, KEY);
});

test('everyday checks make no network requests', async () => {
  const env = browser({ tabs: [tab(1, 1, 0, true)] });
  await env.message('activate-license', { licenseKey: KEY });
  const calls = env.server.calls.length;
  for (let i = 0; i < 5; i++) await env.message('run-action', { id: 'duplicate-tab', windowId: 1 });
  await env.message('get-state', { windowId: 1 });
  assert.equal(env.server.calls.length, calls);
});
