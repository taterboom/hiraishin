import { createController } from './controller.js';

const controller = createController(chrome);
const report = promise => Promise.resolve(promise).catch(error => console.error('[Hiraishin]', error));

// Register synchronously so events waking the MV3 worker are never missed.
chrome.tabs.onActivated.addListener(info => report(controller.onActivated(info)));
chrome.tabs.onRemoved.addListener((tabId, info) => report(controller.removeTab(tabId, info.windowId)));
chrome.tabs.onDetached.addListener((tabId, info) => report(controller.removeTab(tabId, info.oldWindowId)));
chrome.tabs.onAttached.addListener((tabId, info) => report(controller.onAttached(tabId, info)));
chrome.tabs.onReplaced.addListener((addedId, removedId) => report(controller.onReplaced(addedId, removedId)));
chrome.windows.onRemoved.addListener(windowId => report(controller.onWindowRemoved(windowId)));
chrome.commands.onCommand.addListener((command, tab) => report(controller.onCommand(command, tab)));
chrome.contextMenus.onClicked.addListener((info, tab) => report(controller.onMenuClicked(info, tab)));
chrome.alarms.onAlarm.addListener(alarm => report(controller.onAlarm(alarm)));
chrome.permissions.onRemoved.addListener(() => report(controller.onPermissionsChanged()));
chrome.permissions.onAdded.addListener(() => report(controller.onPermissionsChanged()));
chrome.runtime.onInstalled.addListener(() => report(controller.ready()));
chrome.runtime.onStartup.addListener(() => report(controller.ready()));
chrome.notifications?.onClicked.addListener(id => {
  chrome.notifications.clear(id);
  report(chrome.runtime.openOptionsPage());
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'offscreen-copy' || message?.type === 'hiraishin-ping') return false; // Handled by other pages.
  controller.handleMessage(message, sender).then(
    result => sendResponse({ ok: true, ...(result ?? {}) }),
    error => sendResponse({ ok: false, error: error.message || '操作失败，请重试。' }),
  );
  return true;
});
