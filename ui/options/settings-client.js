// Serialize this page's reads and writes. Build each edit from the latest saved settings,
// not the React render that happened to create the callback. A rejected save cannot block
// later edits, and a focus/permission refresh cannot publish an older view over a save.
/**
 * @param {Pick<typeof import('../shared/api').api, 'getSettings' | 'saveSettings' | 'setWebBinding' | 'syncPage'>} api
 * @param {(view: import('../shared/types').SettingsView) => void} publish
 */
export function createSettingsClient(api, publish) {
  let tail = Promise.resolve();
  /** @param {() => Promise<import('../shared/types').SettingsView>} task */
  const enqueue = task => {
    const result = tail.then(task).then(view => { publish(view); return view; });
    tail = result.then(() => {}, () => {});
    return result;
  };
  return {
    load: () => enqueue(() => api.getSettings()),
    sync: () => enqueue(() => api.syncPage()),
    /** @param {(settings: import('../shared/types').Settings) => void} mutate */
    save: mutate => enqueue(async () => {
      const view = await api.getSettings();
      const next = structuredClone(view.settings);
      mutate(next);
      return api.saveSettings(next);
    }),
    /** @param {string} id @param {string | null} combo */
    setBinding: (id, combo) => enqueue(() => api.setWebBinding(id, combo)),
  };
}
