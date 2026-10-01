import { t } from './i18n.js';

// Notifications carry only failure, no-op, uncertain and needs-action states (spec §7.3, R14).
export function createNotifier(api) {
  /** @param {string} message @param {{ title?: string, id?: string }} [options] */
  return async function notify(message, { title = t('manifest.name'), id } = {}) {
    if (!api.notifications?.create) return false;
    try {
      await api.notifications.create(id ?? `hiraishin-${Date.now()}`, {
        type: 'basic', iconUrl: api.runtime.getURL('icons/128.png'), title, message,
      });
      return true;
    } catch {
      return false;
    }
  };
}
