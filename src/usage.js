import { t } from './i18n.js';

// Local aggregate counters only: no page URLs, selected text, event log or network calls.
export const USAGE_KEY = 'usageStats';
export const USAGE_SOURCE_IDS = ['overlay', 'popup', 'command', 'web', 'menu', 'retry', 'other'];
export const usageSourceName = id => t(`bg.usage.source.${id}`);
/** id → display name. Each name is a getter, so reading it always gives the current language.
 *  @type {Readonly<Record<string, string>>} */
export const USAGE_SOURCES = Object.freeze(Object.defineProperties({}, Object.fromEntries(USAGE_SOURCE_IDS
  .map(id => [id, { get: () => usageSourceName(id), enumerable: true }]))));

const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const timestamp = value => Number.isFinite(value) && value > 0 ? value : null;

export function normalizeUsage(raw) {
  const actions = {};
  if (raw?.version === 1 && raw.actions && typeof raw.actions === 'object') {
    for (const [id, sources] of Object.entries(raw.actions)) {
      if (!/^[a-z][a-z0-9:-]{0,100}$/.test(id) || !sources || typeof sources !== 'object') continue;
      const valid = Object.fromEntries(USAGE_SOURCE_IDS.map(source => [source, count(sources[source])]).filter(([, n]) => n));
      if (Object.keys(valid).length) actions[id] = valid;
    }
  }
  return { version: 1, startedAt: raw?.version === 1 ? timestamp(raw.startedAt) : null, actions };
}

/** One queue protects read/modify/write across all actions, including concurrent transfers. */
export function createUsageStore(api, { now = Date.now } = {}) {
  let tail = Promise.resolve();
  const enqueue = task => {
    const result = tail.then(task);
    tail = result.then(() => {}, () => {});
    return result;
  };
  const read = async () => normalizeUsage((await api.storage.local.get(USAGE_KEY))[USAGE_KEY]);
  return {
    get: () => enqueue(read),
    record: (id, origin) => enqueue(async () => {
      if (typeof id !== 'string' || !/^[a-z][a-z0-9:-]{0,100}$/.test(id)) return;
      const stats = await read();
      const source = USAGE_SOURCE_IDS.includes(origin) ? origin : 'other';
      const sources = stats.actions[id] ?? {};
      sources[source] = Math.min(count(sources[source]) + 1, Number.MAX_SAFE_INTEGER);
      stats.actions[id] = sources;
      stats.startedAt ??= now();
      await api.storage.local.set({ [USAGE_KEY]: stats });
    }),
    reset: () => enqueue(async () => {
      const stats = normalizeUsage(null);
      await api.storage.local.set({ [USAGE_KEY]: stats });
      return stats;
    }),
  };
}
