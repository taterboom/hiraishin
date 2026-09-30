// Typed message client for the service worker. Every page call goes through here.
import type { ActionResult, CollectResult, LicenseView, PanelState, Settings, SettingsView, TaskInfo, UsageStatsData } from './types';

export class ApiError extends Error {}

async function send<T>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new ApiError(response?.error || '操作未完成，请重试。');
  return response as T;
}

export const api = {
  getState: (windowId: number) => send<{ state: PanelState }>({ type: 'get-state', windowId }).then(r => r.state),
  runAction: (id: string, windowId: number, args?: Record<string, unknown>) => send<ActionResult>({ type: 'run-action', id, windowId, args }),
  previewPopupClose: (windowId: number) => send<{ confirmation: { token: string; count: number } }>({ type: 'popup-close-preview', windowId }).then(r => r.confirmation),
  confirmPopupClose: (windowId: number, token: string) => send<ActionResult>({ type: 'popup-close-confirm', windowId, token }),
  navigate: (windowId: number, direction: -1 | 1) => send<ActionResult>({ type: 'navigate', windowId, direction }),
  jump: (windowId: number, cursor: number, tabId: number) => send<ActionResult>({ type: 'jump', windowId, cursor, tabId }),
  closeRight: (windowId: number) => send<{ closedCount: number }>({ type: 'close-right', windowId }),
  listTasks: () => send<{ tasks: TaskInfo[] }>({ type: 'list-tasks' }).then(r => r.tasks),
  retryTask: (taskId: string, windowId: number) => send<ActionResult>({ type: 'retry-task', taskId, windowId }),
  removeTask: (taskId: string) => send<Record<string, never>>({ type: 'remove-task', taskId }),
  getSettings: () => send<SettingsView>({ type: 'get-settings' }),
  saveSettings: (settings: Settings) => send<SettingsView>({ type: 'save-settings', settings }),
  setWebBinding: (actionId: string, combo: string | null) => send<SettingsView>({ type: 'set-web-binding', actionId, combo }),
  syncPage: () => send<SettingsView>({ type: 'sync-page' }),
  getUsage: () => send<{ usage: UsageStatsData }>({ type: 'get-usage' }).then(r => r.usage),
  resetUsage: () => send<{ usage: UsageStatsData }>({ type: 'reset-usage' }).then(r => r.usage),
  getLicense: () => send<{ license: LicenseView }>({ type: 'get-license' }).then(r => r.license),
  startPurchase: () => send<{ license: LicenseView }>({ type: 'start-purchase' }).then(r => r.license),
  collectLicense: () => send<CollectResult>({ type: 'collect-license' }),
  activateLicense: (licenseKey: string) => send<{ license: LicenseView }>({ type: 'activate-license', licenseKey }).then(r => r.license),
  refreshLicense: () => send<{ license: LicenseView }>({ type: 'refresh-license' }).then(r => r.license),
};

export function domainFor(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome:') return `chrome://${parsed.hostname}`;
    if (parsed.protocol === 'file:') return '本地文件';
    if (parsed.protocol === 'chrome-extension:') return 'Chrome 扩展程序';
    return parsed.hostname || parsed.protocol;
  } catch {
    return '标签页';
  }
}
