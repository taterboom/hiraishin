// Local trial plus a cached Menkyo license. Everyday checks read storage and verify the cached
// token's signature locally; the network is used only to buy, collect, activate and for a daily
// refresh. A network or server failure never turns a purchase into "not purchased": only the
// service explicitly answering "revoked" does (docs/LICENSE_INTEGRATION.md §3).
import { MENKYO_URL, MENKYO_PUBLIC_JWK } from './license-config.js';

export const LICENSE_KEY = 'license';
export const SYNC_KEY = 'hiraishinLicense';
export const REFRESH_ALARM = 'hiraishin-license-refresh';
export const BUSINESS_KEY = 'hiraishin';

const DAY = 24 * 60 * 60 * 1000;
export const TRIAL_MS = 14 * DAY;
export const OFFLINE_GRACE_MS = 14 * DAY;
export const REFRESH_MS = DAY;
const BACKOFF_BASE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const SUCCESS = new Set(['ok', 'navigated', 'filled', 'sent']);

export class NetworkError extends Error {}

const b64urlBytes = text => {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), c => c.charCodeAt(0));
};
const b64urlJson = text => JSON.parse(new TextDecoder().decode(b64urlBytes(text)));

/** Local ES256 check of a Menkyo token; returns its payload only if authentic and ours. */
export async function verifyToken(token, publicJwk) {
  if (typeof token !== 'string' || !publicJwk) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    if (b64urlJson(parts[0]).alg !== 'ES256') return null;
    const key = await crypto.subtle.importKey('jwk', { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64urlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = b64urlJson(parts[1]);
    return payload.iss === 'menkyo' && payload.bk === BUSINESS_KEY && typeof payload.exp === 'number' ? payload : null;
  } catch {
    return null;
  }
}

export function normalizeLicense(raw) {
  const text = value => (typeof value === 'string' && value ? value : null);
  const time = value => (Number.isFinite(value) && value > 0 ? value : null);
  return {
    version: 1,
    trialStartedAt: time(raw?.trialStartedAt),
    credential: text(raw?.credential),
    licenseKey: text(raw?.licenseKey),
    token: text(raw?.token),
    nextRefreshAt: time(raw?.nextRefreshAt),
    failures: Number.isSafeInteger(raw?.failures) && raw.failures > 0 ? raw.failures : 0,
    revoked: raw?.revoked === true,
  };
}

/**
 * @typedef {{ fetch?: typeof globalThis.fetch, now?: () => number, random?: () => number,
 *   serviceUrl?: string | null, publicJwk?: JsonWebKey | null }} LicenseOptions
 */

/** @param {any} api @param {LicenseOptions} [options] */
export function createLicense(api, {
  fetch = globalThis.fetch?.bind(globalThis), now = Date.now, random = Math.random,
  serviceUrl = MENKYO_URL, publicJwk = MENKYO_PUBLIC_JWK,
} = {}) {
  // One queue for every read/modify/write, so a refresh never overwrites a concurrent activation.
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  const enqueue = task => {
    const result = tail.then(task);
    tail = result.then(() => {}, () => {});
    return result;
  };
  const read = async () => normalizeLicense((await api.storage.local.get(LICENSE_KEY))[LICENSE_KEY]);
  const write = state => api.storage.local.set({ [LICENSE_KEY]: state });
  // Mirrors the credential and key across the user's Chrome profile so a reinstall can recover.
  const mirror = async state => {
    await api.storage.sync?.set({ [SYNC_KEY]: { credential: state.credential, licenseKey: state.licenseKey } }).catch(() => {});
  };

  async function call(path, body) {
    if (!serviceUrl) throw new Error('购买服务尚未配置。');
    let response;
    try {
      response = await fetch(`${serviceUrl}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new NetworkError('无法连接授权服务，请检查网络后重试。');
    }
    if (response.status >= 500) throw new NetworkError('授权服务暂时不可用，请稍后重试。');
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  async function view(state) {
    const payload = await verifyToken(state.token, publicJwk);
    const time = now();
    const licensed = Boolean(payload) && time < payload.exp * 1000 + OFFLINE_GRACE_MS;
    const trialEndsAt = state.trialStartedAt ? state.trialStartedAt + TRIAL_MS : null;
    const trialActive = !trialEndsAt || time < trialEndsAt;
    return {
      state: licensed ? 'licensed' : state.revoked ? 'revoked' : trialActive ? 'trial' : 'expired',
      allowed: licensed || trialActive,
      trialStarted: Boolean(state.trialStartedAt), trialEndsAt,
      licenseKey: state.licenseKey, pendingPurchase: Boolean(state.credential),
      configured: Boolean(serviceUrl && publicJwk),
    };
  }

  const schedule = async state => {
    if (!state.token) { await api.alarms.clear(REFRESH_ALARM); return; }
    await api.alarms.create(REFRESH_ALARM, { when: state.nextRefreshAt ?? now() });
  };

  async function storeToken(state, token) {
    if (!(await verifyToken(token, publicJwk))) throw new Error('授权服务返回的凭据无法验证。');
    // Spread refreshes across the day so installs do not converge on one moment.
    Object.assign(state, { token, revoked: false, failures: 0, nextRefreshAt: now() + REFRESH_MS * (0.75 + random() * 0.5) });
  }

  async function activateNow(state, input) {
    const { status, body } = await call('/license/claim', { business_key: BUSINESS_KEY, license_key: String(input) });
    if (status !== 200) throw new Error(status === 400 ? '授权码格式不正确。' : '授权码无效或已被撤销。');
    await storeToken(state, body.token);
    state.licenseKey = String(input).trim().toUpperCase().replace(/\s+/g, '');
    state.credential = null;
    await write(state);
    await mirror(state);
    await schedule(state);
  }

  const refresh = () => enqueue(async () => {
    const state = await read();
    if (!state.token) return view(state);
    try {
      const { status, body } = await call('/license/refresh', { token: state.token });
      if (status === 200) await storeToken(state, body.token);
      else if (status === 403) Object.assign(state, { token: null, revoked: true, nextRefreshAt: null, failures: 0 });
      else throw new NetworkError(`unexpected ${status}`);
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      // Bounded exponential backoff: 1h, 2h, 4h … capped at the normal daily interval.
      state.failures += 1;
      state.nextRefreshAt = now() + Math.min(BACKOFF_BASE_MS * 2 ** (state.failures - 1), REFRESH_MS);
    }
    await write(state);
    await schedule(state);
    return view(state);
  });

  return {
    status: () => enqueue(async () => view(await read())),
    allowed: () => enqueue(async () => (await view(await read())).allowed),

    /** Start the local trial at the first successful, effective action. Later successes change nothing. */
    noteResult: result => (SUCCESS.has(result?.status) || result?.changed === true ? enqueue(async () => {
      const state = await read();
      if (state.trialStartedAt) return;
      state.trialStartedAt = now();
      await write(state);
    }) : Promise.resolve()),

    /** Menkyo generates the claim credential; nothing is stored server-side until payment. */
    startPurchase: () => enqueue(async () => {
      const { status, body } = await call('/purchase', { business_key: BUSINESS_KEY });
      if (status !== 200 || typeof body.claim_credential !== 'string' || typeof body.purchase_url !== 'string') {
        throw new Error('暂时无法开始购买，请稍后重试。');
      }
      const state = await read();
      state.credential = body.claim_credential;
      await write(state);
      await mirror(state);
      return body.purchase_url;
    }),

    /** One attempt to collect the paid license; the caller bounds retries. */
    collect: () => enqueue(async () => {
      const state = await read();
      if (!state.credential) return { status: 'none' };
      const { status, body } = await call('/license/collect', { business_key: BUSINESS_KEY, claim_credential: state.credential });
      if (status === 404) return { status: 'pending' };
      if (status === 403) {
        Object.assign(state, { credential: null, revoked: true });
        await write(state);
        return { status: 'revoked' };
      }
      if (status !== 200 || typeof body.license_key !== 'string') throw new Error('领取授权失败，请稍后重试。');
      await activateNow(state, body.license_key);
      return { status: 'activated', licenseKey: state.licenseKey };
    }),

    activate: input => enqueue(async () => {
      if (typeof input !== 'string' || !input.trim()) throw new Error('请输入授权码。');
      const state = await read();
      await activateNow(state, input);
      return view(state);
    }),

    refresh,

    /** On startup: keep the refresh alarm, and recover a key or pending purchase mirrored via sync. */
    ready: () => enqueue(async () => {
      const state = await read();
      if (!state.token && !state.credential && !state.licenseKey) {
        const synced = (await api.storage.sync?.get(SYNC_KEY).catch(() => ({})))?.[SYNC_KEY];
        if (typeof synced?.licenseKey === 'string') state.licenseKey = synced.licenseKey;
        if (typeof synced?.credential === 'string') state.credential = synced.credential;
        if (state.licenseKey || state.credential) await write(state);
      }
      if (!state.token && state.licenseKey && !state.revoked) {
        await activateNow(state, state.licenseKey).catch(error => console.warn('[Hiraishin license]', error.message));
      }
      await schedule(state);
    }),

    onAlarm: alarm => (alarm?.name === REFRESH_ALARM ? refresh() : Promise.resolve()),
  };
}
