// Target model: which pages count as "Claude", where to open one, and how to pick the
// leftmost matching tab in the source window (spec §5).

// Order matters: the first entry is the default target and leads every target list and menu.
export const BUILTIN_TARGETS = [
  {
    id: 'chatgpt', name: 'ChatGPT', builtin: true, site: 'chatgpt',
    match: ['https://chatgpt.com/', 'https://chatgpt.com/?*', 'https://chatgpt.com/c/*'],
    openUrl: 'https://chatgpt.com/', origins: ['https://chatgpt.com/*'], capability: 'send',
  },
  {
    id: 'claude', name: 'Claude', builtin: true, site: 'claude',
    match: ['https://claude.ai/new', 'https://claude.ai/new?*', 'https://claude.ai/chat/*'],
    openUrl: 'https://claude.ai/new', origins: ['https://claude.ai/*'], capability: 'send',
  },
];

const CAPABILITY_RANK = { navigate: 0, fill: 1, send: 2 };

/**
 * Letters that identify a target at a glance. Site favicons would be more literal, but Chrome's
 * `_favicon` falls back to one generic globe for any site the browser has not cached, which is
 * exactly the fresh-install case where the marks must already differ. The letters carry the
 * distinction on their own, so every mark uses the same background.
 * @param {{ name?: string }} target
 * @returns {string}
 */
export function targetMonogram(target) {
  const name = (target?.name ?? '').trim();
  if (!name) return '?';
  const first = name[0];
  // Latin names take a second, distinguishing letter: ChatGPT reads CG, Claude reads CL.
  if (/[A-Za-z0-9]/.test(first)) {
    const inner = name.slice(1).match(/[A-Z0-9]/);
    return (first + (inner ? inner[0] : name[1] ?? '')).toUpperCase();
  }
  return first;
}

/** Glob match where "*" spans any characters; the URL fragment is ignored. */
export function matchesPattern(url, pattern) {
  if (typeof url !== 'string' || typeof pattern !== 'string') return false;
  const target = url.split('#')[0].toLowerCase();
  const source = pattern.toLowerCase().split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(target);
}

export function matchesTarget(url, target) {
  return target.match.some(pattern => matchesPattern(url, pattern));
}

function originOf(url) {
  try { return `${new URL(url).origin}/*`; } catch { return null; }
}

/** All targets visible to the user, with built-in capability capped by the settings level. */
export function resolveTargets(settings) {
  const builtin = BUILTIN_TARGETS.map(target => {
    const level = settings.targets.enabled[target.id] ?? target.capability;
    const capability = CAPABILITY_RANK[level] <= CAPABILITY_RANK[target.capability] ? level : target.capability;
    return { ...target, capability };
  });
  const custom = settings.targets.custom.map(target => ({
    ...target, builtin: false, site: 'generic',
    origins: [...new Set([target.openUrl, ...target.match].map(originOf).filter(Boolean))],
  }));
  return [...builtin, ...custom];
}

/** "default" resolves through settings; unknown ids fall back to the first built-in target. */
export function getTarget(settings, id) {
  const targets = resolveTargets(settings);
  const wanted = id === 'default' ? settings.defaultTargetId : id;
  return targets.find(target => target.id === wanted) ?? (id === 'default' ? targets[0] : null);
}

export function supports(target, mode) {
  return CAPABILITY_RANK[target.capability] >= CAPABILITY_RANK[mode];
}

export function createTargetService(api) {
  const inFlight = new Map();

  async function findMatching(target, windowId) {
    const tabs = await api.tabs.query({ windowId });
    return tabs.filter(tab => matchesTarget(tab.url || tab.pendingUrl || '', target))
      .sort((a, b) => a.index - b.index)[0] ?? null;
  }

  /**
   * Leftmost matching tab in the source window, or a new tab right of the source.
   * Concurrent calls for the same window and target share one result so rapid
   * triggers never open duplicates.
   */
  function findOrCreate(target, source) {
    const key = `${source.windowId}:${target.id}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const existing = await findMatching(target, source.windowId);
      if (existing) {
        if (!existing.active) await api.tabs.update(existing.id, { active: true });
        return { tab: existing, created: false };
      }
      const tab = await api.tabs.create({
        windowId: source.windowId, url: target.openUrl, index: source.index + 1, active: true,
      });
      return { tab, created: true };
    })();
    inFlight.set(key, task);
    return task.finally(() => inFlight.delete(key));
  }

  return {
    findMatching, findOrCreate,
    hasPermission: target => api.permissions.contains({ origins: target.origins }),
  };
}
